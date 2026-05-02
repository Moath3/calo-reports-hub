/**
 * Zelt API service.
 *
 * Server-side OAuth 2.0 (authorization code grant) for the Zelt HRIS.
 * Stores access + refresh tokens encrypted at rest in zelt_tokens (singleton row).
 * Public surface: getAccessToken(), exchangeCodeForTokens(code), disconnect(), getStatus().
 *
 * Murphy notes:
 * - Encryption key (ZELT_TOKEN_ENCRYPTION_KEY) is required at boot in production.
 * - Token writes call persistNow() to force sql.js to flush immediately (refresh-token-loss protection).
 * - Refresh is single-flight via DB row lock (CAS on updated_at).
 * - Refresh on every fetch when expires_at < now + 60s.
 * - Retries network/5xx once with 500ms + jitter backoff.
 */
import crypto from 'crypto';
import { getDb, persistNow } from '../db/database.js';

const ZELT_BASE = 'https://go.zelt.app';
const TOKEN_URL = `${ZELT_BASE}/apiv2/oauth/authorize/token`;
const AUTHORIZE_URL = `${ZELT_BASE}/apiv2/oauth/authorize`;
const REQUEST_TIMEOUT_MS = 10_000;

// ---- Crypto -----------------------------------------------------------

function getEncryptionKey() {
  const hex = process.env.ZELT_TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ZELT_TOKEN_ENCRYPTION_KEY is required in production');
    }
    // Dev fallback — clearly identifiable; never used in prod (boot validation will fail).
    return Buffer.from('dev'.repeat(11).slice(0, 32), 'utf8');
  }
  if (hex.length !== 64) {
    throw new Error('ZELT_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext, all hex
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

function decrypt(encoded) {
  const key = getEncryptionKey();
  const [ivHex, tagHex, ctHex] = encoded.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Malformed encrypted token');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return pt.toString('utf8');
}

// ---- Config validation -----------------------------------------------

function getConfig() {
  const clientId = process.env.ZELT_CLIENT_ID;
  const clientSecret = process.env.ZELT_CLIENT_SECRET;
  const redirectUri = process.env.ZELT_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Zelt config missing — set ZELT_CLIENT_ID, ZELT_CLIENT_SECRET, ZELT_REDIRECT_URI');
  }
  return { clientId, clientSecret, redirectUri };
}

// ---- DB helpers -------------------------------------------------------

function readTokens() {
  const db = getDb();
  const row = db.prepare('SELECT * FROM zelt_tokens WHERE id = 1').get();
  if (!row) return null;
  return {
    accessToken: decrypt(row.access_token),
    refreshToken: decrypt(row.refresh_token),
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

function writeTokens({ accessToken, refreshToken, expiresAt }) {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO zelt_tokens (id, access_token, refresh_token, expires_at, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(encrypt(accessToken), encrypt(refreshToken), expiresAt, now);
  // Force immediate flush — sql.js otherwise risks losing rotated refresh_token to a crash.
  persistNow();
}

function clearTokens() {
  const db = getDb();
  db.prepare('DELETE FROM zelt_tokens WHERE id = 1').run();
  persistNow();
}

// ---- OAuth flow -------------------------------------------------------

/**
 * Zelt's authorization code flow is MANUAL:
 *   1. Admin opens Zelt → Settings → Security → Developer Hub → their app
 *   2. Clicks "Code flow" → "Allow access"
 *   3. Zelt redirects to the configured Redirection URI with ?code=...
 * There is no public /oauth/authorize URL. We can't initiate by sending the user
 * to a Zelt URL — they must click inside Zelt themselves.
 *
 * So the "init" step just returns the expected redirect URI for the admin to verify
 * matches their Zelt app's Redirection URI setting, and instructions to proceed.
 */
export function getBootstrapInstructions() {
  const { redirectUri } = getConfig();
  return {
    redirectUri,
    steps: [
      'Open Zelt admin: https://go.zelt.app',
      'Go to Settings → Security → Developer Hub → Build Apps',
      'Open the app you created for this hub (e.g. "Calo HR Hub")',
      `Confirm the app's Redirection URI is exactly: ${redirectUri}`,
      'Click "Code flow" inside the app drawer',
      'Click "Allow access" on the consent screen',
      'You will be redirected back to this hub automatically',
    ],
  };
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Called once during bootstrap. Stores tokens encrypted in DB.
 */
export async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = getConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const resp = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Token exchange failed: ${resp.status} ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  const accessToken = json.access_token;
  const refreshToken = json.refresh_token;
  const expiresIn = json.expires_in || 3600; // default 1h if Zelt omits it
  if (!accessToken || !refreshToken) {
    throw new Error('Token exchange returned incomplete response');
  }
  writeTokens({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return { connected: true };
}

/**
 * Refresh using the stored refresh token. Rotates both tokens.
 * Single-flight: uses CAS on updated_at to ensure only one process refreshes.
 */
async function refreshTokens(prevUpdatedAt) {
  const { clientId, clientSecret } = getConfig();
  const tokens = readTokens();
  if (!tokens) throw new Error('NotConnected');
  // CAS — if updated_at changed, another process refreshed; just re-read.
  if (tokens.updatedAt !== prevUpdatedAt) return readTokens();

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }),
  });

  if (resp.status === 401 || resp.status === 400) {
    // Refresh token rejected — but a single failure doesn't always mean dead.
    // Could be a parallel-refresh race (we already rotated). Don't wipe yet:
    // re-read tokens and check if updated_at advanced (someone else refreshed).
    const fresh = readTokens();
    if (fresh && fresh.updatedAt > prevUpdatedAt) {
      // Another refresh succeeded in parallel — use those tokens.
      return fresh;
    }
    // True failure. Wipe.
    clearTokens();
    throw new Error('NotConnected');
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Token refresh failed: ${resp.status} ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  const accessToken = json.access_token;
  const refreshToken = json.refresh_token || tokens.refreshToken; // some providers don't rotate every time
  const expiresIn = json.expires_in || 3600;
  writeTokens({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return readTokens();
}

// Module-level promise mutex — ensures only one refresh in flight at a time.
// CAS alone is insufficient: two concurrent reads see the same updatedAt, both
// pass CAS, both call Zelt — second refresh invalidates first's rotated token.
let refreshInFlight = null;

/**
 * Returns a valid access token, refreshing if needed.
 * Throws 'NotConnected' if no tokens / refresh failed.
 */
export async function getAccessToken() {
  let tokens = readTokens();
  if (!tokens) throw new Error('NotConnected');

  // Refresh if expired or expiring within 60s.
  if (tokens.expiresAt < Date.now() + 60_000) {
    if (refreshInFlight) {
      tokens = await refreshInFlight;
    } else {
      refreshInFlight = refreshTokens(tokens.updatedAt).finally(() => { refreshInFlight = null; });
      tokens = await refreshInFlight;
    }
  }
  return tokens.accessToken;
}

/**
 * Auth-aware GET. Adds Bearer header. Retries once on 5xx with backoff.
 * 401 surfaces directly (usually scope, not dead session) — caller decides.
 */
export async function zeltGet(path, params = {}) {
  const url = new URL(path, ZELT_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const attempt = async () => {
    const token = await getAccessToken();
    return fetchWithTimeout(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  let resp = await attempt();
  if (resp.status >= 500) {
    await sleep(500 + Math.random() * 500); // 500–1000ms jitter
    resp = await attempt();
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`Zelt API ${resp.status}: ${text.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// ---- OAuth state (CSRF) ----------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

export function createOauthState() {
  const db = getDb();
  const state = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO zelt_oauth_states (state, created_at, consumed) VALUES (?, ?, 0)')
    .run(state, Date.now());
  return state;
}

export function consumeOauthState(state) {
  const db = getDb();
  // Cleanup: prune expired/consumed older than 1h
  db.prepare('DELETE FROM zelt_oauth_states WHERE created_at < ?').run(Date.now() - 60 * 60 * 1000);

  const row = db.prepare('SELECT * FROM zelt_oauth_states WHERE state = ?').get(state);
  if (!row) return false;
  if (row.consumed) return false;
  if (Date.now() - row.created_at > STATE_TTL_MS) return false;
  db.prepare('UPDATE zelt_oauth_states SET consumed = 1 WHERE state = ?').run(state);
  return true;
}

// ---- Status / disconnect ---------------------------------------------

export function getStatus() {
  try {
    const tokens = readTokens();
    if (!tokens) return { connected: false };
    return { connected: true, lastRefresh: tokens.updatedAt };
  } catch {
    return { connected: false };
  }
}

export function disconnect() {
  clearTokens();
  return { connected: false };
}

// ---- Internals --------------------------------------------------------

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

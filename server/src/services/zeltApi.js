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
import { notifyAdminZeltRefreshFailing } from './emailService.js';

const ZELT_BASE = 'https://go.zelt.app';
const TOKEN_URL = `${ZELT_BASE}/apiv2/oauth/authorize/token`;
const AUTHORIZE_URL = `${ZELT_BASE}/apiv2/oauth/authorize`;
const REQUEST_TIMEOUT_MS = 30_000; // bumped from 10s — balance fetches walk many paginated calls; Zelt is sometimes slow under WAF backoff

// Browser-like User-Agent to avoid Akamai/CDN bot blocks. Default Node fetch
// UA ('node') gets 403'd at ~30 concurrent requests on Zelt.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

// Track consecutive refresh failures for diagnostics + admin alerting.
// We DELIBERATELY do NOT auto-wipe tokens after N failures — wiping would only
// turn a recoverable state ("refresh failing, will retry") into a fully broken
// one ("integration dead until admin re-bootstraps"), and Zelt's flow requires
// a manual click in their admin either way. So we keep the row, surface the
// failure via getStatus(), email the admin once per failing streak, and let
// the admin re-bootstrap on their schedule. INSERT...ON CONFLICT DO UPDATE
// will overwrite the stale row when they do.
let refreshFailureCount = 0;
let lastRefreshError = null;
let lastRefreshErrorAt = null;
let alertSentForCurrentStreak = false;
const ALERT_AFTER_N_FAILURES = 2; // email admin starting at this consecutive failure

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
    // Could be a parallel-refresh race (we already rotated). Don't act yet:
    // re-read tokens and check if updated_at advanced (someone else refreshed).
    const fresh = readTokens();
    if (fresh && fresh.updatedAt > prevUpdatedAt) {
      resetRefreshFailureState();
      return fresh;
    }
    const text = await resp.text().catch(() => '');
    // Zelt has been returning 401 with empty body. Capture diagnostic headers
    // (WWW-Authenticate often contains the OAuth error code: invalid_grant /
    // invalid_client / insufficient_scope) so the admin has actionable detail.
    const wwwAuth = resp.headers.get('www-authenticate') || '';
    const xError = resp.headers.get('x-error') || resp.headers.get('x-error-code') || '';
    const detail = [
      `${resp.status}`,
      text.slice(0, 200),
      wwwAuth && `www-authenticate=${wwwAuth}`,
      xError && `x-error=${xError}`,
    ].filter(Boolean).join(' | ');
    console.warn('[zelt] refresh 401 details:', detail);
    recordRefreshFailure(detail);
    // Soft fail — caller surfaces error but tokens remain in DB for the admin
    // to re-bootstrap when they're ready. We never auto-wipe.
    throw new Error('Refresh failed — admin must re-bootstrap');
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    recordRefreshFailure(`${resp.status} ${text.slice(0, 200)}`);
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
  resetRefreshFailureState();
  return readTokens();
}

function recordRefreshFailure(message) {
  refreshFailureCount += 1;
  lastRefreshError = message;
  lastRefreshErrorAt = Date.now();
  console.warn(`[zelt] refresh failed (${refreshFailureCount}x): ${message}`);
  if (refreshFailureCount >= ALERT_AFTER_N_FAILURES && !alertSentForCurrentStreak) {
    alertSentForCurrentStreak = true;
    // Fire-and-forget — don't block the refresh path on email delivery.
    notifyAdminZeltRefreshFailing({ failureCount: refreshFailureCount, lastError: message })
      .catch(e => console.error('[zelt] alert email failed:', e.message));
  }
}

function resetRefreshFailureState() {
  if (refreshFailureCount > 0) {
    console.log(`[zelt] refresh recovered after ${refreshFailureCount} failure(s)`);
  }
  refreshFailureCount = 0;
  lastRefreshError = null;
  lastRefreshErrorAt = null;
  alertSentForCurrentStreak = false;
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
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': UA,
        Accept: 'application/json',
      },
    });
  };

  // Try once; if the fetch is aborted by our timeout (slow Zelt response under
  // WAF backoff is the usual cause), retry once with a small jitter. Don't
  // retry forever — a genuinely stuck request should still surface as an error.
  let resp;
  try {
    resp = await attempt();
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[zelt] ${path} timed out — retrying once`);
      await sleep(500 + Math.random() * 500);
      resp = await attempt();
    } else {
      throw err;
    }
  }

  if (resp.status === 403) {
    // CDN/WAF bot-block at high concurrency. Wait longer + retry once.
    await sleep(1000 + Math.random() * 1500);
    resp = await attempt();
  } else if (resp.status >= 500) {
    await sleep(500 + Math.random() * 500);
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
    const status = { connected: true, lastRefresh: tokens.updatedAt };
    if (refreshFailureCount > 0) {
      status.refreshFailing = true;
      status.refreshFailureCount = refreshFailureCount;
      status.lastError = lastRefreshError;
      status.lastErrorAt = lastRefreshErrorAt;
    }
    return status;
  } catch {
    return { connected: false };
  }
}

/**
 * Awaits any in-flight token refresh — call this from the SIGTERM handler
 * before exiting so a deploy mid-refresh doesn't lose the rotated refresh
 * token. Returns immediately if no refresh is in flight.
 */
export async function drainRefresh() {
  if (refreshInFlight) {
    try { await refreshInFlight; }
    catch { /* ignore — best-effort drain on shutdown */ }
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

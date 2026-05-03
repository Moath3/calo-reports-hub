/**
 * Zelt bot service — cookie-based access to "internal" Zelt endpoints
 * (specifically /apiv2/absences/company/balance) that the OAuth partner
 * token cannot reach.
 *
 * The hub logs in once as a dedicated service user (ZELT_BOT_EMAIL /
 * ZELT_BOT_PASSWORD) via POST /apiv2/auth/login, captures the session
 * cookie, and reuses it. On 401 we re-login automatically.
 *
 * Single-flight login mutex prevents N parallel requests from each
 * triggering their own login. Cookie cached in-memory only — re-login
 * on cold start is cheap (~1 round-trip).
 *
 * Security:
 *   - Email + password live ONLY in render env, never logged, never
 *     sent to the browser.
 *   - Bot user has read-only "Manage absences for everyone" permission;
 *     write surface = zero in our codebase.
 *   - On 5xx we retry once with backoff; on 401 we re-login + retry.
 */

import { getDb, persistNow } from '../db/database.js';

const ZELT_BASE = 'https://go.zelt.app';
const LOGIN_URL = `${ZELT_BASE}/apiv2/auth/login`;
const HEARTBEAT_URL = `${ZELT_BASE}/apiv2/auth/me`;
const REQUEST_TIMEOUT_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000; // 15 min — keeps session rolling

let cookieJar = null;        // in-memory cache; backed by DB
let loginInFlight = null;    // Promise mutex for single-flight login
let heartbeatTimer = null;

// ---- Persistence -----------------------------------------------------

function loadCookieFromDb() {
  try {
    const row = getDb().prepare('SELECT cookie_jar FROM zelt_bot_session WHERE id = 1').get();
    if (row?.cookie_jar) {
      cookieJar = row.cookie_jar;
      console.log('[zelt-bot] cookie restored from DB');
    }
  } catch (e) { /* table may not exist yet */ }
}

function saveCookieToDb(jar) {
  try {
    getDb().prepare(`
      INSERT INTO zelt_bot_session (id, cookie_jar, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET cookie_jar = excluded.cookie_jar, updated_at = excluded.updated_at
    `).run(jar, Date.now());
    persistNow();
  } catch (e) { console.error('[zelt-bot] persist failed:', e.message); }
}

function clearCookieDb() {
  try {
    getDb().prepare('DELETE FROM zelt_bot_session WHERE id = 1').run();
    persistNow();
  } catch (e) { /* ignore */ }
}

function getCreds() {
  const email = process.env.ZELT_BOT_EMAIL;
  const password = process.env.ZELT_BOT_PASSWORD;
  if (!email || !password) {
    throw new Error('Zelt bot creds missing — set ZELT_BOT_EMAIL and ZELT_BOT_PASSWORD');
  }
  return { email, password };
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Log in as the bot user, capture the session cookie.
 * Single-flight: concurrent callers share the same login Promise.
 */
// Browser-like headers — Zelt's /auth/login may reject bare API requests
// that lack a User-Agent / Origin / Accept-Language combo.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://go.zelt.app',
  'Referer': 'https://go.zelt.app/',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

function extractCookies(resp) {
  const raw = typeof resp.headers.getSetCookie === 'function'
    ? resp.headers.getSetCookie()
    : (resp.headers.raw?.()['set-cookie'] || []);
  return raw.map(c => c.split(';')[0]).filter(Boolean);
}

// CSRF token: many modern SPA backends (Nest's csurf, Express csrf-csrf) set
// an XSRF-TOKEN cookie on the first GET, then require its value back as an
// X-XSRF-TOKEN header on subsequent POST. Forwarding only the cookie isn't
// enough.
function extractXsrfToken(cookieString) {
  if (!cookieString) return null;
  const m = cookieString.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function login() {
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    const { email, password } = getCreds();

    // Step 1: ssocheck (and any other "warmup" GET) to collect XSRF + session
    // cookies. Try a couple of paths since Zelt has used both shapes.
    let preLoginCookies = '';
    const warmupPaths = [
      `/apiv2/auth/ssocheck/${encodeURIComponent(email)}`,
      '/login',
    ];
    for (const path of warmupPaths) {
      try {
        const resp = await fetchWithTimeout(`${ZELT_BASE}${path}`, {
          headers: BROWSER_HEADERS,
        });
        const cookies = extractCookies(resp);
        if (cookies.length) {
          // Merge with existing
          const merged = new Map();
          for (const c of preLoginCookies.split('; ').filter(Boolean)) {
            merged.set(c.split('=')[0], c);
          }
          for (const c of cookies) merged.set(c.split('=')[0], c);
          preLoginCookies = Array.from(merged.values()).join('; ');
        }
      } catch (e) {
        console.warn(`[zelt-bot] warmup ${path} failed:`, e.message);
      }
    }

    const xsrfToken = extractXsrfToken(preLoginCookies);
    if (xsrfToken) console.log('[zelt-bot] captured XSRF token');

    // Step 2: POST login. Include X-XSRF-TOKEN header (CSRF-protected backends),
    // try {email,password} first, fall back to {username,password}.
    const bodies = [
      { email, password, rememberMe: false },
      { username: email, password },
    ];

    let lastErr = null;
    for (const body of bodies) {
      const headers = { ...BROWSER_HEADERS, 'Content-Type': 'application/json' };
      if (preLoginCookies) headers.Cookie = preLoginCookies;
      if (xsrfToken) headers['X-XSRF-TOKEN'] = xsrfToken;
      const resp = await fetchWithTimeout(LOGIN_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const cookies = extractCookies(resp);
        if (!cookies.length) throw new Error('Zelt bot login returned no Set-Cookie');
        // Merge ssocheck cookies + login cookies — login may override some,
        // but ssocheck-only cookies (e.g. csrf or session tracker) might be needed.
        const merged = new Map();
        for (const c of preLoginCookies.split('; ').filter(Boolean)) {
          const [name] = c.split('=');
          merged.set(name, c);
        }
        for (const c of cookies) {
          const [name] = c.split('=');
          merged.set(name, c);
        }
        cookieJar = Array.from(merged.values()).join('; ');
        saveCookieToDb(cookieJar);
        startHeartbeat();
        console.log(`[zelt-bot] logged in (${merged.size} cookies, body=${Object.keys(body).join('+')})`);
        return cookieJar;
      }
      const text = await resp.text().catch(() => '');
      lastErr = `${resp.status} ${text.slice(0, 200)}`;
      console.warn(`[zelt-bot] login attempt body=${Object.keys(body).join('+')} → ${resp.status}`);
    }
    throw new Error(`Zelt bot login failed: ${lastErr}`);
  })().finally(() => { loginInFlight = null; });
  return loginInFlight;
}

/**
 * Authenticated GET via the bot session cookie. Auto-logs in if no cookie,
 * auto-re-logs-in once on 401.
 */
export async function botGet(path, params = {}) {
  if (!cookieJar) {
    loadCookieFromDb();
    if (!cookieJar) await login();
    else startHeartbeat();
  }

  const url = new URL(path, ZELT_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const attempt = async (forceLogin = false) => {
    if (forceLogin) await login();
    return fetchWithTimeout(url.toString(), {
      headers: { Cookie: cookieJar, Accept: 'application/json' },
    });
  };

  let resp = await attempt();
  if (resp.status === 401) {
    cookieJar = null;
    clearCookieDb();
    resp = await attempt(true); // re-login + retry
  } else if (resp.status >= 500) {
    await sleep(500 + Math.random() * 500);
    resp = await attempt();
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`Zelt bot ${resp.status}: ${text.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

/**
 * Configured? Returns false if env vars are missing — caller can skip the
 * whole "Available Now" code path silently.
 */
export function botConfigured() {
  return !!(process.env.ZELT_BOT_EMAIL && process.env.ZELT_BOT_PASSWORD);
}

/**
 * Logout (clears cookie in-memory + DB + stops heartbeat).
 */
export function botLogout() {
  cookieJar = null;
  clearCookieDb();
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// Periodic heartbeat — keeps Zelt's rolling session alive indefinitely.
// Without this, the cookie expires after ~few hours of inactivity.
function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async () => {
    if (!cookieJar) return;
    try {
      const r = await fetchWithTimeout(HEARTBEAT_URL, {
        headers: { Cookie: cookieJar, Accept: 'application/json', 'User-Agent': BROWSER_HEADERS['User-Agent'] },
      });
      if (r.status === 401) {
        console.log('[zelt-bot] heartbeat got 401 — re-logging in');
        cookieJar = null;
        clearCookieDb();
        try { await login(); } catch (e) { console.error('[zelt-bot] heartbeat re-login failed:', e.message); }
      } else if (r.ok) {
        // Refresh the cookie's updated_at in DB so we don't lose track of when last activity was.
        saveCookieToDb(cookieJar);
      }
    } catch (e) {
      console.warn('[zelt-bot] heartbeat error:', e.message);
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Don't keep the process alive just for the heartbeat
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

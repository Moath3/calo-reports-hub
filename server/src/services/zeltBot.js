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

const ZELT_BASE = 'https://go.zelt.app';
const LOGIN_URL = `${ZELT_BASE}/apiv2/auth/login`;
const REQUEST_TIMEOUT_MS = 15_000;

let cookieJar = null;        // string of cookie pairs to send on every request
let loginInFlight = null;    // Promise mutex for single-flight login

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
async function login() {
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    const { email, password } = getCreds();
    const resp = await fetchWithTimeout(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Zelt bot login failed: ${resp.status} ${text.slice(0, 200)}`);
    }
    // Capture Set-Cookie header(s). Express-style cookies; we keep only name=value pairs.
    // Node's fetch exposes raw set-cookie via headers.getSetCookie() (Node 19+).
    const rawCookies = typeof resp.headers.getSetCookie === 'function'
      ? resp.headers.getSetCookie()
      : (resp.headers.raw?.()['set-cookie'] || []);
    if (!rawCookies.length) {
      throw new Error('Zelt bot login returned no Set-Cookie');
    }
    const pairs = rawCookies.map(c => c.split(';')[0]).filter(Boolean);
    cookieJar = pairs.join('; ');
    console.log(`[zelt-bot] logged in (${pairs.length} cookies)`);
    return cookieJar;
  })().finally(() => { loginInFlight = null; });
  return loginInFlight;
}

/**
 * Authenticated GET via the bot session cookie. Auto-logs in if no cookie,
 * auto-re-logs-in once on 401.
 */
export async function botGet(path, params = {}) {
  if (!cookieJar) await login();

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
 * Logout (clears in-memory cookie). Useful for rotation / disconnect flows.
 */
export function botLogout() {
  cookieJar = null;
}

// Shared Google service-account auth: parses GOOGLE_SERVICE_ACCOUNT_JSON once and
// mints OAuth access tokens, optionally impersonating a Workspace user via `sub`
// (domain-wide delegation, needed for Gmail send). Tokens cache per scope+sub.
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const cache = new Map(); // `${scope}|${sub}` -> { token, exp(unix) }

export function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  let sa;
  try { sa = JSON.parse(raw); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  if (!sa.client_email || !sa.private_key) throw new Error('Service account JSON missing client_email/private_key');
  // Render stores the PEM with literal \n — restore real newlines so it parses.
  sa.private_key = String(sa.private_key).replace(/\\n/g, '\n');
  return sa;
}

export function isConfigured() {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

export function serviceAccountEmail() {
  try { return serviceAccount()?.client_email || null; } catch { return null; }
}

export async function mintAccessToken({ scope, sub } = {}) {
  if (!scope) throw new Error('mintAccessToken: scope required');
  const key = `${scope}|${sub || ''}`;
  const now = Math.floor(Date.now() / 1000);
  const hit = cache.get(key);
  if (hit && hit.exp - 60 > now) return hit.token;
  const sa = serviceAccount();
  if (!sa) throw new Error('Google service account is not configured');
  const claims = { scope };
  if (sub) claims.sub = sub; // act as this Workspace user (domain-wide delegation)
  const assertion = jwt.sign(claims, sa.private_key, {
    algorithm: 'RS256', issuer: sa.client_email, audience: TOKEN_URI, expiresIn: 3600,
  });
  const res = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token exchange failed: ${body.error_description || body.error || res.status}`);
  }
  cache.set(key, { token: body.access_token, exp: now + (body.expires_in || 3600) });
  return body.access_token;
}

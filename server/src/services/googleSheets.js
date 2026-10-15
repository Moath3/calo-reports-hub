// Reads a masterfile Google Sheet via a service account and hands it back as XLSX
// bytes, so the client reuses its existing in-browser masterfile parser (tab
// auto-detect, normalization) unchanged. Auth is a self-signed service-account
// JWT exchanged for a Drive-readonly token — no googleapis dependency. The sheet
// must be shared (Viewer) with the service account's client_email.
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let cachedToken = null; // { token, exp(unix) }

function serviceAccount() {
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

export function defaultSheetId() {
  return process.env.MASTERFILE_SHEET_ID || null;
}

export function serviceAccountEmail() {
  try { return serviceAccount()?.client_email || null; } catch { return null; }
}

// Accepts a full sheet URL or a bare spreadsheet id.
export function extractSheetId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;
  const sa = serviceAccount();
  if (!sa) throw new Error('Google service account is not configured');
  const assertion = jwt.sign({ scope: SCOPE }, sa.private_key, {
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
  cachedToken = { token: body.access_token, exp: now + (body.expires_in || 3600) };
  return cachedToken.token;
}

async function driveGet(path, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const hint = res.status === 404 ? ' (not found — share the sheet with the service account email)'
      : res.status === 403 ? ' (forbidden — give the service account email Viewer access)' : '';
    throw new Error(`Google Drive ${res.status}${hint}: ${txt.slice(0, 160)}`);
  }
  return res;
}

// Exports the sheet (by URL/id, else MASTERFILE_SHEET_ID) as XLSX, base64-encoded.
export async function exportMasterfile(sheetIdInput) {
  const id = extractSheetId(sheetIdInput) || defaultSheetId();
  if (!id) throw new Error('No Google Sheet id — paste the sheet link or set MASTERFILE_SHEET_ID');
  const token = await getAccessToken();
  const meta = await driveGet(`files/${id}?fields=name&supportsAllDrives=true`, token)
    .then((r) => r.json()).catch(() => ({}));
  const res = await driveGet(`files/${id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`, token);
  const buf = Buffer.from(await res.arrayBuffer());
  return { fileName: meta.name ? `${meta.name}.xlsx` : 'masterfile.xlsx', xlsxBase64: buf.toString('base64'), sheetId: id };
}

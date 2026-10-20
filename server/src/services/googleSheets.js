// Reads a masterfile Google Sheet via the shared service account and hands it back
// as XLSX bytes, so the client reuses its existing in-browser masterfile parser
// (tab auto-detect, normalization) unchanged. The sheet must be shared (Viewer)
// with the service account's client_email.
import fetch from 'node-fetch';
import { isConfigured, serviceAccountEmail, mintAccessToken } from './googleAuth.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export { isConfigured, serviceAccountEmail };

export function defaultSheetId() {
  return process.env.MASTERFILE_SHEET_ID || null;
}

// Accepts a full sheet URL or a bare spreadsheet id.
export function extractSheetId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
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
  const token = await mintAccessToken({ scope: SCOPE });
  const meta = await driveGet(`files/${id}?fields=name&supportsAllDrives=true`, token)
    .then((r) => r.json()).catch(() => ({}));
  const res = await driveGet(`files/${id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`, token);
  const buf = Buffer.from(await res.arrayBuffer());
  return { fileName: meta.name ? `${meta.name}.xlsx` : 'masterfile.xlsx', xlsxBase64: buf.toString('base64'), sheetId: id };
}

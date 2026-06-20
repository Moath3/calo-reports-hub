// Shared helpers for the T&A file tools (identityMapping, parityCheck, runPeriod).
// Keeps one copy of the master-loader, the Excel-serial date parser, and the
// HH:MM parser so the three tools can't drift apart.
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { normalizeId } from '../identity/normalize.js';

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const pick = (headers, pats) => { for (const p of pats) { const h = headers.find((x) => p.test(norm(x))); if (h) return h; } return null; };
export const wbOf = (p) => XLSX.read(readFileSync(p), { type: 'buffer' });

// "9:00" / "10:56" -> minutes; blank or non-HH:MM -> null (mirrors the recon).
export const parseMinutes = (t) => {
  if (t == null || t === '') return null;
  const a = String(t).trim().split(':');
  if (a.length < 2) return null;
  const h = parseInt(a[0], 10), m = parseInt(a[1], 10);
  return (Number.isNaN(h) || Number.isNaN(m)) ? null : h * 60 + m;
};

// SheetJS parses CSV date cells as Excel serial numbers -> normalize to YYYY-MM-DD.
export const toYMD = (v) => {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

// "Label=path#Sheet;path;..." -> [{label, path, sheet}]  (label and #Sheet optional)
export function parseMastersSpec(spec) {
  return spec.split(';').map((s) => s.trim()).filter(Boolean).map((s, i) => {
    const eq = s.indexOf('=');
    const label = eq > 0 ? s.slice(0, eq).trim() : `Master${i + 1}`;
    let path = (eq > 0 ? s.slice(eq + 1) : s).trim();
    let sheet = null;
    const hash = path.lastIndexOf('#');
    if (hash > 0) { sheet = path.slice(hash + 1).trim(); path = path.slice(0, hash).trim(); }
    return { label, path, sheet };
  });
}

// Distinct badging employees from an attendance export, plus the detected columns.
export function loadAttendance(path) {
  const wb = wbOf(path);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const h = Object.keys(rows[0] || {});
  const cols = {
    id: pick(h, [/employee\s*id/i, /ac.?-?no/i, /emp.*no/i, /^id$/i]),
    name: pick(h, [/^name$/i, /first.*name/i, /name/i]),
    dept: pick(h, [/department/i, /dept/i]),
    date: pick(h, [/^date$/i, /date/i]),
    time: pick(h, [/total\s*time/i, /work.*time/i, /hours/i]),
  };
  return { rows, cols };
}

// Load one master: pick the active sheet + header row, then choose the join-key
// column as the ID column whose values best overlap the attendance IDs.
export function loadMaster({ path, label, sheet }, attIdSet) {
  const wb = wbOf(path);
  let sheetName = sheet && wb.SheetNames.includes(sheet) ? sheet : null;
  if (!sheetName) {
    const usable = wb.SheetNames.filter((s) => !/inactive|archive|dashboard|migration|crossboard|authentic|lookup|dropdown|template|zelt|secret|validation/i.test(s));
    sheetName = usable.find((s) => /emp\s*info|active/i.test(s)) || usable.find((s) => /production|all|master|full.?time|main/i.test(s)) || usable[0] || wb.SheetNames[0];
  }
  let rows = [], headers = [];
  for (const hr of [0, 1, 2]) {
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], hr ? { defval: '', range: hr } : { defval: '' });
    headers = Object.keys(rows[0] || {});
    if (pick(headers, [/full.*name|^name$|name/i]) && headers.some((x) => /emp|national|iqama|staff|badge|^id$/i.test(norm(x)))) break;
  }
  const name = pick(headers, [/full.*name/i, /name.*passport/i, /employee\s*name/i, /^name$/i, /name/i]);
  const pos = pick(headers, [/position/i, /job.*title/i, /designation/i, /\brole\b/i, /title/i]);
  const ent = pick(headers, [/legal\s*entity/i, /entity/i, /sponsor/i, /company/i, /location/i, /country/i]);
  const idCands = headers.filter((x) => /emp.*(no|number|id)|empl\.?\s*id|national.*id|iqama|staff.*no|badge|^id$|^no\.?$/i.test(norm(x)));
  let bestId = idCands[0] || null, bestOverlap = -1;
  for (const c of idCands) { const ov = rows.reduce((n, r) => n + (attIdSet.has(normalizeId(r[c])) ? 1 : 0), 0); if (ov > bestOverlap) { bestOverlap = ov; bestId = c; } }
  const records = rows
    .map((r) => ({ empId: String(r[bestId] ?? '').trim(), name: String(r[name] ?? '').trim(), position: pos ? String(r[pos] ?? '').trim() : '', entity: ent ? String(r[ent] ?? '').trim() : null, source: label }))
    .filter((p) => p.empId || p.name);
  return { records, meta: { sheetName, rows: rows.length, idCol: norm(bestId), overlap: bestOverlap, candidates: idCands.map(norm) } };
}

// Position keywords that mark a matched employee as out-of-scope (not blue-collar).
export const EXCLUDE_POSITION = /manager|supervisor|head\s*chef|sous\s*chef|\badmin\b|steward|director|coordinator|\blead\b|officer|chef\s*de\s*partie/i;

export const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

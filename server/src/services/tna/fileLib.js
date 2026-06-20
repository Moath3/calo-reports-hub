// Shared file helpers for the T&A engine — used by the Hub run service and the
// CLI tools. One copy of the master-loader, the Excel-serial date parser, and
// the HH:MM parser so the consumers can't drift apart.
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { normalizeId } from './identity/normalize.js';

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

// Normalize a date cell to YYYY-MM-DD. SheetJS gives Excel serials or Date for
// recognized dates, but leaves day-first text (dd/mm/yyyy, the GCC default) as a
// string — so parse the common string formats too. Unparseable -> '' so callers
// can skip/flag rather than silently mis-filter.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export const toYMD = (v) => {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO yyyy-mm-dd (optionally with time)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/); // numeric d/m/y (or m/d/y)
  if (m) {
    const a = +m[1], b = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    let day, mon;
    if (a > 12 && b <= 12) { day = a; mon = b; }       // first must be the day
    else if (b > 12 && a <= 12) { day = b; mon = a; }  // second must be the day
    else { day = a; mon = b; }                          // ambiguous -> day-first (GCC default)
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[/.\- ]([A-Za-z]{3,})[/.\- ](\d{2,4})$/); // dd-Mon-yyyy
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (mon) return `${y}-${String(mon).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  }
  return '';
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
// Probes the first few rows for the real header so a banner/title row above it
// (common in exported reports) can't silently shift every column to null.
export function loadAttendance(path) {
  const wb = wbOf(path);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  let rows = [], h = [];
  for (const hr of [0, 1, 2]) {
    rows = XLSX.utils.sheet_to_json(sheet, hr ? { defval: '', range: hr } : { defval: '' });
    h = Object.keys(rows[0] || {});
    if (h.some((x) => /employee\s*id|ac.?-?no|emp.*no|^id$/i.test(norm(x))) &&
        h.some((x) => /date|total\s*time|work.*time|hours/i.test(norm(x)))) break;
  }
  const cols = {
    id: pick(h, [/employee\s*id/i, /ac.?-?no/i, /emp.*no/i, /^id$/i]),
    name: pick(h, [/^name$/i, /first.*name/i, /name/i]),
    dept: pick(h, [/department/i, /dept/i]),
    date: pick(h, [/^date$/i, /date/i]),
    time: pick(h, [/total\s*time/i, /work.*time/i, /hours/i]),
    checkIn: pick(h, [/first.*check.?in/i, /check.?in/i, /first.*in/i, /clock.?in/i, /time.?in/i]),
    checkOut: pick(h, [/last.*check.?out/i, /check.?out/i, /last.*out/i, /clock.?out/i, /time.?out/i]),
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
// Word-boundary anchored so production titles aren't caught by substrings
// (e.g. "Stewarding Assistant" is NOT \bsteward\b; "Accommodation Steward" is).
export const EXCLUDE_POSITION = /\bmanager\b|\bsupervisor\b|head\s*chef|sous\s*chef|\badmin\b|\bsteward\b|\bdirector\b|\bcoordinator\b|\blead\b|\bofficer\b|chef\s*de\s*partie/i;

export const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

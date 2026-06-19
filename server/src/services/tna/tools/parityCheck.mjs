// Parity gate — does the engine's OT logic reproduce the recon's numbers?
// Runs the REAL classifyDay over an attendance export and diffs per-employee
// OT-days against the recon's Employee Detail sheet. Aggregate output only.
//
// Usage (PowerShell):
//   $env:TNA_ATTENDANCE = 'C:\path\First In Last Out ... .csv'
//   $env:TNA_RECON      = 'C:\path\CALO_May2026_Attendance_Report.xlsx'
//   # optional: $env:TNA_MONTH = '2026-05'   (default: derive from recon filename, else 2026-05)
//   node server/src/services/tna/tools/parityCheck.mjs
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { classifyDay } from '../otEngine.js';
import { DEFAULT_OT_CONFIG } from '../otConfig.js';

const ATT = process.env.TNA_ATTENDANCE;
const RECON = process.env.TNA_RECON;
if (!ATT || !RECON) { console.error('Set TNA_ATTENDANCE and TNA_RECON (see header).'); process.exit(1); }
const MONTH_PREFIX = process.env.TNA_MONTH || (RECON.match(/(20\d\d)[-_ ]?(0[1-9]|1[0-2])/) ? `${RegExp.$1}-${RegExp.$2}` : null)
  || (() => { const m = RECON.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*?(20\d\d)/i); if (!m) return '2026-05'; const mm = String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase()) + 1).padStart(2, '0'); return `${m[2]}-${mm}`; })();

// Match the recon's parse_hours("HH:MM") -> minutes; blank/non-HH:MM -> null.
const parseMin = (t) => {
  if (t == null || t === '') return null;
  const parts = String(t).trim().split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  return (Number.isNaN(h) || Number.isNaN(m)) ? null : h * 60 + m;
};
const toDateStr = (v) => {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); // Excel serial -> YMD
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

// ── Engine over the attendance ──────────────────────────────────────
const attWb = XLSX.read(readFileSync(ATT), { type: 'buffer' });
const att = XLSX.utils.sheet_to_json(attWb.Sheets[attWb.SheetNames[0]], { defval: '' });
const mine = new Map();
for (const r of att) {
  if (!toDateStr(r['Date']).startsWith(MONTH_PREFIX)) continue;
  const id = String(r['Employee ID'] ?? '').trim();
  if (!id) continue;
  if (!mine.has(id)) mine.set(id, { otDays: 0, presentDays: 0 });
  const rec = mine.get(id);
  rec.presentDays += 1;
  const min = parseMin(r['Total Time']);
  if (min != null) {
    const c = classifyDay({ workedMinutes: min, incomplete: false }, { status: 'work', scheduledMinutes: 540 }, DEFAULT_OT_CONFIG);
    if ((c.overtime || 0) > 0) rec.otDays += 1;
  }
}

// ── Recon's Employee Detail (truth) ─────────────────────────────────
const rWb = XLSX.read(readFileSync(RECON), { type: 'buffer' });
let det = null;
for (const hr of [0, 1, 2, 3]) {
  const rows = XLSX.utils.sheet_to_json(rWb.Sheets['Employee Detail'], hr ? { defval: '', range: hr } : { defval: '' });
  const h = rows.length ? Object.keys(rows[0]) : [];
  const idc = h.find((x) => /emp.*id/i.test(x));
  const otc = h.find((x) => /overtime\s*days/i.test(x));
  const pc = h.find((x) => /days\s*present/i.test(x));
  if (idc && otc) { det = { rows, idc, otc, pc }; break; }
}
if (!det) { console.log('Could not read recon Employee Detail sheet'); process.exit(1); }
const recon = new Map();
for (const r of det.rows) { const id = String(r[det.idc] ?? '').trim(); if (id) recon.set(id, { otDays: Number(r[det.otc]) || 0, presentDays: det.pc ? Number(r[det.pc]) || 0 : null }); }

// ── Diff over the recon's in-scope set ──────────────────────────────
let exact = 0, mismatch = 0, myTotalOt = 0, reconTotalOt = 0, myWithOt = 0, reconWithOt = 0, presentExact = 0;
const diffs = [];
for (const [id, rec] of recon) {
  const m = mine.get(id) || { otDays: 0, presentDays: 0 };
  reconTotalOt += rec.otDays; myTotalOt += m.otDays;
  if (rec.otDays > 0) reconWithOt += 1;
  if (m.otDays > 0) myWithOt += 1;
  if (rec.otDays === m.otDays) exact += 1; else { mismatch += 1; if (diffs.length < 12) diffs.push(`${id}: recon=${rec.otDays} mine=${m.otDays} (present recon=${rec.presentDays} mine=${m.presentDays})`); }
  if (rec.presentDays != null && rec.presentDays === m.presentDays) presentExact += 1;
}
console.log(`Month: ${MONTH_PREFIX}  |  Compared ${recon.size} in-scope employees (recon Employee Detail) vs engine`);
console.log(`OT-days per employee  -> exact match: ${exact}   mismatch: ${mismatch}`);
console.log(`TOTAL OT days         -> recon: ${reconTotalOt}   engine: ${myTotalOt}   ${reconTotalOt === myTotalOt ? 'MATCH' : 'DIFF'}`);
console.log(`Employees with OT     -> recon: ${reconWithOt}   engine: ${myWithOt}   ${reconWithOt === myWithOt ? 'MATCH' : 'DIFF'}`);
console.log(`Days-present exact match: ${presentExact}/${recon.size}`);
if (diffs.length) console.log('sample OT mismatches:', diffs);
process.exit(mismatch === 0 ? 0 : 1);

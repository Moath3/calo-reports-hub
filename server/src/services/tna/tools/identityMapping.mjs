// Identity mapping tool — match an attendance export against one or more HR
// masters (KSA Luqmat, KSA 3rd-party, GCC, …), auto-detecting the join-key
// column per master by overlap, and split the matched population into
// blue-collar production (in scope) vs managers/admins (excluded).
//
// Country-agnostic and master-agnostic: point it at any attendance + masters.
// Prints AGGREGATE stats only; name-level detail -> a local CSV.
//
// Usage (PowerShell):
//   $env:TNA_ATTENDANCE = 'C:\path\First In Last Out ... .csv'
//   $env:TNA_MASTERS    = 'Luqmat=C:\path\KSA Masterfile.xlsx#Luqmat Active;3rd-Party=C:\path\HR Masterfile 3rd Party.xlsx;GCC=C:\path\Calo Master Employee Tracker GCC.xlsx'
//   (append #SheetName to pin a tab and avoid contaminated sheets)
//   # optional: $env:TNA_DETAIL_CSV = 'C:\path\out.csv'   (default: ./tna-mapping-detail.csv)
//   node server/src/services/tna/tools/identityMapping.mjs
import { writeFileSync } from 'fs';
import { resolveIdentities } from '../identity/resolver.js';
import { normalizeId } from '../identity/normalize.js';
import { parseMastersSpec, loadAttendance, loadMaster, EXCLUDE_POSITION, csvCell } from './lib.mjs';

const ATT = process.env.TNA_ATTENDANCE;
const MASTERS_SPEC = process.env.TNA_MASTERS;
const DETAIL_CSV = process.env.TNA_DETAIL_CSV || 'tna-mapping-detail.csv';
if (!ATT || !MASTERS_SPEC) { console.error('Set TNA_ATTENDANCE and TNA_MASTERS (see header for format).'); process.exit(1); }
const MASTERS = parseMastersSpec(MASTERS_SPEC);

// ── Attendance: distinct badging employees ──────────────────────────
const { rows: attRows, cols } = loadAttendance(ATT);
const seen = new Map();
for (const r of attRows) { const c = String(r[cols.id] ?? '').trim(); if (c && !seen.has(c)) seen.set(c, { empCode: c, name: cols.name ? String(r[cols.name] ?? '').trim() : '', entity: cols.dept ? String(r[cols.dept] ?? '').trim() : null }); }
const bioEmployees = [...seen.values()];
const attIdSet = new Set(bioEmployees.map((b) => normalizeId(b.empCode)));
console.log(`Attendance: ${bioEmployees.length} distinct badging employees (id="${cols.id}" name="${cols.name}" dept="${cols.dept}")`);

const combined = MASTERS.flatMap((m) => {
  const { records, meta } = loadMaster(m, attIdSet);
  console.log(`[${m.label}] sheet="${meta.sheetName}" rows=${meta.rows} -> idCol="${meta.idCol}" (overlap ${meta.overlap})  candidates=[${meta.candidates.join(', ')}]`);
  return records;
});

// ── Match + scope ───────────────────────────────────────────────────
const { matched, review, unmatched } = resolveIdentities({ bioEmployees, masterfile: combined, zelt: [] });
const bySource = {};
let blueCollar = 0, excluded = 0, noPosition = 0;
for (const m of matched) {
  const rec = m.masterfile || m.zelt;
  bySource[rec?.source || '?'] = (bySource[rec?.source || '?'] || 0) + 1;
  const p = rec?.position || '';
  if (!p) noPosition += 1; else if (EXCLUDE_POSITION.test(p)) excluded += 1; else blueCollar += 1;
}
const pct = (n) => ((n / bioEmployees.length) * 100).toFixed(1) + '%';
console.log('\n=== MATCH (attendance -> masters) ===');
console.log(`matched: ${matched.length} (${pct(matched.length)})  by source: ${JSON.stringify(bySource)}`);
console.log(`review:  ${review.length} (${pct(review.length)})`);
console.log(`unmatched: ${unmatched.length} (${pct(unmatched.length)})`);
console.log('\n=== SCOPE (position filter) ===');
console.log(`blue-collar production (IN): ${blueCollar}   managers/admins (EXCLUDED): ${excluded}   no position: ${noPosition}`);

const lines = ['bucket,reason,empCode,attName,attDept,source,candName,position'];
for (const m of matched) { const r = m.masterfile || m.zelt; lines.push(['matched', '', m.empCode, m.bio.name, m.bio.entity, r?.source, r?.name, r?.position].map(csvCell).join(',')); }
for (const r of review) lines.push(['review', r.reason, r.empCode, r.bio.name, r.bio.entity, r.candidate?.source, r.candidate?.name, r.candidate?.position].map(csvCell).join(','));
for (const u of unmatched) lines.push(['unmatched', '', u.empCode, u.bio.name, u.bio.entity, '', '', ''].map(csvCell).join(','));
writeFileSync(DETAIL_CSV, lines.join('\n'));
console.log(`\nDetail -> ${DETAIL_CSV} (local only).`);

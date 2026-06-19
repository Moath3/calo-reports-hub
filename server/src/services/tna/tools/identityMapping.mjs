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
import * as XLSX from 'xlsx';
import { writeFileSync, readFileSync } from 'fs';
import { resolveIdentities } from '../identity/resolver.js';
import { normalizeId } from '../identity/normalize.js';

const ATT = process.env.TNA_ATTENDANCE;
const MASTERS_SPEC = process.env.TNA_MASTERS;
const DETAIL_CSV = process.env.TNA_DETAIL_CSV || 'tna-mapping-detail.csv';
if (!ATT || !MASTERS_SPEC) { console.error('Set TNA_ATTENDANCE and TNA_MASTERS (see header for format).'); process.exit(1); }

// "Label=path#Sheet;Label=path"  (label and #Sheet both optional)
// Pin #Sheet to dodge contaminated tabs (e.g. KSA "Luqmat Active", not "Luqmat Active Employees ").
const MASTERS = MASTERS_SPEC.split(';').map((s) => s.trim()).filter(Boolean).map((s, i) => {
  const eq = s.indexOf('=');
  const label = eq > 0 ? s.slice(0, eq).trim() : `Master${i + 1}`;
  let path = (eq > 0 ? s.slice(eq + 1) : s).trim();
  let sheet = null;
  const hash = path.lastIndexOf('#');
  if (hash > 0) { sheet = path.slice(hash + 1).trim(); path = path.slice(0, hash).trim(); }
  return { label, path, sheet };
});

const EXCLUDE_POSITION = /manager|supervisor|head\s*chef|sous\s*chef|\badmin\b|steward|director|coordinator|\blead\b|officer|chef\s*de\s*partie/i;
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const pick = (headers, pats) => { for (const p of pats) { const h = headers.find((x) => p.test(norm(x))); if (h) return h; } return null; };
const wbOf = (p) => XLSX.read(readFileSync(p), { type: 'buffer' });

// ── Attendance: distinct badging employees ──────────────────────────
const attWb = wbOf(ATT);
const attRows = XLSX.utils.sheet_to_json(attWb.Sheets[attWb.SheetNames[0]], { defval: '' });
const attH = Object.keys(attRows[0] || {});
const attId = pick(attH, [/employee\s*id/i, /ac.?-?no/i, /emp.*no/i, /^id$/i]);
const attName = pick(attH, [/^name$/i, /first.*name/i, /name/i]);
const attDept = pick(attH, [/department/i, /dept/i]);
const seen = new Map();
for (const r of attRows) { const c = String(r[attId] ?? '').trim(); if (c && !seen.has(c)) seen.set(c, { empCode: c, name: String(r[attName] ?? '').trim(), entity: attDept ? String(r[attDept] ?? '').trim() : null }); }
const bioEmployees = [...seen.values()];
const attIdSet = new Set(bioEmployees.map((b) => normalizeId(b.empCode)));
console.log(`Attendance: ${bioEmployees.length} distinct badging employees (id="${attId}" name="${attName}" dept="${attDept}")`);

// ── Master loader: pick active sheet + header row, choose id col by overlap ──
function loadMaster({ path, label, sheet }) {
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
    if (pick(headers, [/full.*name|^name$|name/i]) && headers.some((h) => /emp|national|iqama|staff|badge|^id$/i.test(norm(h)))) break;
  }
  const name = pick(headers, [/full.*name/i, /name.*passport/i, /employee\s*name/i, /^name$/i, /name/i]);
  const pos = pick(headers, [/position/i, /job.*title/i, /designation/i, /\brole\b/i, /title/i]);
  const ent = pick(headers, [/legal\s*entity/i, /entity/i, /sponsor/i, /company/i, /location/i, /country/i]);
  const idCands = headers.filter((h) => /emp.*(no|number|id)|empl\.?\s*id|national.*id|iqama|staff.*no|badge|^id$|^no\.?$/i.test(norm(h)));
  let bestId = idCands[0] || null, bestOverlap = -1;
  for (const c of idCands) { const ov = rows.reduce((n, r) => n + (attIdSet.has(normalizeId(r[c])) ? 1 : 0), 0); if (ov > bestOverlap) { bestOverlap = ov; bestId = c; } }
  const records = rows
    .map((r) => ({ empId: String(r[bestId] ?? '').trim(), name: String(r[name] ?? '').trim(), position: pos ? String(r[pos] ?? '').trim() : '', entity: ent ? String(r[ent] ?? '').trim() : null, source: label }))
    .filter((p) => p.empId || p.name);
  console.log(`[${label}] sheet="${sheetName}" rows=${rows.length} -> idCol="${norm(bestId)}" (overlap ${bestOverlap})  candidates=[${idCands.map(norm).join(', ')}]`);
  return records;
}

const combined = MASTERS.flatMap(loadMaster);

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

const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const lines = ['bucket,reason,empCode,attName,attDept,source,candName,position'];
for (const m of matched) { const r = m.masterfile || m.zelt; lines.push(['matched', '', m.empCode, m.bio.name, m.bio.entity, r?.source, r?.name, r?.position].map(cell).join(',')); }
for (const r of review) lines.push(['review', r.reason, r.empCode, r.bio.name, r.bio.entity, r.candidate?.source, r.candidate?.name, r.candidate?.position].map(cell).join(','));
for (const u of unmatched) lines.push(['unmatched', '', u.empCode, u.bio.name, u.bio.entity, '', '', ''].map(cell).join(','));
writeFileSync(DETAIL_CSV, lines.join('\n'));
console.log(`\nDetail -> ${DETAIL_CSV} (local only).`);

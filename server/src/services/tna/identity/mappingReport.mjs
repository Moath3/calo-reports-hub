// Identity mapping report — how well do BioTime employees match the HR
// Masterfile (and Zelt)? Run LOCALLY with your BioTime login.
//
// Prints AGGREGATE stats only (counts / match rate / review reasons). Writes a
// detailed name-level CSV (matched/review/unmatched) to a local file so the PII
// stays on your machine — share only the printed summary.
//
// Run (PowerShell):
//   $env:BIOTIME_USER='you'; $env:BIOTIME_PASS='...'
//   $env:MASTERFILE='C:\path\to\KSA Masterfile.xlsx'
//   # optional: $env:MASTERFILE_SHEET='Luqmat Active'
//   # optional overrides if auto-detect misses: $env:MASTERFILE_ID_COL='Employee ID' etc.
//   # optional Zelt export (.json array or .csv with id,name,entity): $env:ZELT_FILE='...'
//   node "server/src/services/tna/identity/mappingReport.mjs"
import * as XLSX from 'xlsx';
import { writeFileSync, readFileSync } from 'fs';
import { authenticate, fetchEmployees } from '../adapters/bioTimeClient.js';
import { resolveIdentities } from './resolver.js';

const env = process.env;
const BIO = { baseUrl: env.BIOTIME_URL || 'http://81.22.20.92:85', username: env.BIOTIME_USER, password: env.BIOTIME_PASS };

function die(msg) { console.error('ERROR:', msg); process.exit(1); }

// Pick a column header by override or keyword patterns.
function pickCol(headers, patterns, override) {
  if (override) return headers.includes(override) ? override : die(`override column "${override}" not found. Headers: ${headers.join(' | ')}`);
  for (const p of patterns) { const h = headers.find((x) => p.test(x)); if (h) return h; }
  return null;
}

function loadSheetRows(path, sheetName) {
  const wb = XLSX.readFile(path);
  const name = sheetName || wb.SheetNames[0];
  if (!wb.Sheets[name]) die(`sheet "${name}" not found. Sheets: ${wb.SheetNames.join(' | ')}`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
  return { rows, sheetName: name, allSheets: wb.SheetNames };
}

function mapPeople(rows, idCol, nameCol, entityCol) {
  return rows
    .map((r) => ({ empId: String(r[idCol] ?? '').trim(), name: String(r[nameCol] ?? '').trim(), entity: entityCol ? String(r[entityCol] ?? '').trim() : null }))
    .filter((p) => p.empId || p.name);
}

function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

async function main() {
  if (!BIO.username || !BIO.password) die('set BIOTIME_USER and BIOTIME_PASS');
  if (!env.MASTERFILE) die('set MASTERFILE to the masterfile .xlsx path');

  // 1) BioTime employees (live, your login)
  const token = await authenticate(BIO);
  const bioEmployees = await fetchEmployees(BIO, token);
  console.log(`BioTime employees pulled: ${bioEmployees.length}`);

  // 2) Masterfile
  const { rows, sheetName, allSheets } = loadSheetRows(env.MASTERFILE, env.MASTERFILE_SHEET);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  console.log(`Masterfile sheet: "${sheetName}" (sheets: ${allSheets.join(' | ')}) — ${rows.length} rows`);
  console.log(`Masterfile headers: ${headers.join(' | ')}`);
  const idCol = pickCol(headers, [/^emp(loyee)?\s*\.?\s*id$/i, /^id$/i, /\bid\b/i, /code/i], env.MASTERFILE_ID_COL);
  const nameCol = pickCol(headers, [/full\s*name/i, /employee\s*name/i, /^name$/i, /name/i], env.MASTERFILE_NAME_COL);
  const entityCol = pickCol(headers, [/entity/i, /legal/i, /sponsor/i, /company/i], env.MASTERFILE_ENTITY_COL);
  if (!idCol || !nameCol) die(`couldn't auto-detect ID/Name columns (id=${idCol}, name=${nameCol}). Re-run with MASTERFILE_ID_COL / MASTERFILE_NAME_COL set to the exact headers above.`);
  console.log(`Masterfile columns -> id="${idCol}", name="${nameCol}", entity="${entityCol || '(none)'}"`);
  const masterfile = mapPeople(rows, idCol, nameCol, entityCol);

  // 3) Zelt (optional file)
  let zelt = [];
  if (env.ZELT_FILE) {
    if (env.ZELT_FILE.endsWith('.json')) {
      zelt = JSON.parse(readFileSync(env.ZELT_FILE, 'utf8')).map((z) => ({ empId: String(z.empId ?? z.employeeId ?? z.id ?? '').trim(), name: String(z.name ?? '').trim(), entity: z.entity ?? null }));
    } else {
      const { rows: zr } = loadSheetRows(env.ZELT_FILE, env.ZELT_SHEET);
      const zh = zr.length ? Object.keys(zr[0]) : [];
      zelt = mapPeople(zr, pickCol(zh, [/^emp(loyee)?\s*\.?\s*id$/i, /^id$/i, /code/i], env.ZELT_ID_COL), pickCol(zh, [/^name$/i, /name/i], env.ZELT_NAME_COL), pickCol(zh, [/entity/i, /legal/i], env.ZELT_ENTITY_COL));
    }
    console.log(`Zelt employees loaded: ${zelt.length}`);
  } else {
    console.log('Zelt: skipped (set ZELT_FILE to include it)');
  }

  // 4) Resolve
  const { matched, review, unmatched } = resolveIdentities({ bioEmployees, masterfile, zelt });
  const reviewByReason = review.reduce((m, r) => { m[r.reason] = (m[r.reason] || 0) + 1; return m; }, {});
  const pct = (n) => `${((n / bioEmployees.length) * 100).toFixed(1)}%`;

  console.log('\n=== MAPPING RESULT (BioTime -> Masterfile' + (zelt.length ? '+Zelt' : '') + ') ===');
  console.log(`matched:   ${matched.length}  (${pct(matched.length)})`);
  console.log(`review:    ${review.length}  (${pct(review.length)})  by reason:`, reviewByReason);
  console.log(`unmatched: ${unmatched.length}  (${pct(unmatched.length)})`);

  // 5) Detailed CSV (local only — names included)
  const out = 'mapping-report-detail.csv';
  const lines = ['bucket,reason,empCode,bioName,bioEntity,candidateId,candidateName,nameSim'];
  for (const m of matched) lines.push(['matched', '', m.empCode, m.bio.name, m.bio.entity, (m.masterfile || m.zelt)?.empId, (m.masterfile || m.zelt)?.name, m.nameSim].map(csvCell).join(','));
  for (const r of review) lines.push(['review', r.reason, r.empCode, r.bio.name, r.bio.entity, r.candidate?.empId, r.candidate?.name, r.nameSim].map(csvCell).join(','));
  for (const u of unmatched) lines.push(['unmatched', '', u.empCode, u.bio.name, u.bio.entity, '', '', ''].map(csvCell).join(','));
  writeFileSync(out, lines.join('\n'));
  console.log(`\nDetailed name-level rows written locally to ${out} (NOT for sharing). Paste back only the MAPPING RESULT block + the headers/columns lines.`);
}

main().catch((e) => die(e.message));

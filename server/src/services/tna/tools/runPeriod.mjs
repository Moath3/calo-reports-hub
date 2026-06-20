// Period run — per-employee overtime using PER-COUNTRY thresholds (UAE after
// 10h; KSA, Kuwait, Bahrain after 9h), matched to HR masters and scoped to
// blue-collar production. Country is resolved from the attendance Department,
// falling back to the master's entity/location. Aggregate + per-country output;
// per-employee detail -> local CSV.
//
// Input is a daily-TOTALS export (one row per employee-day with a worked "Total
// Time" HH:MM), not raw punches — so each row is treated as a completed work day.
//
// Usage (PowerShell):
//   $env:TNA_ATTENDANCE = 'C:\path\Over time Punch IN & OUT Report ... .csv'
//   $env:TNA_MASTERS    = 'GCC=C:\path\Calo Master Employee Tracker GCC.xlsx'   (optional; enables scope + names)
//   # optional: $env:TNA_MONTH = '2026-05'   (YYYY-MM filter; omit for a custom pay period)
//   # optional: $env:TNA_DETAIL_CSV = 'C:\path\out.csv'   (default ./tna-period-detail.csv)
//   node server/src/services/tna/tools/runPeriod.mjs
import { writeFileSync } from 'fs';
import { classifyDay } from '../otEngine.js';
import { getOtConfig } from '../otConfig.js';
import { resolveCountry, canonicalEntity } from '../entityAliases.js';
import { normalizeId, normalizeName } from '../identity/normalize.js';
import { diceCoefficient } from '../identity/similarity.js';
import { parseMastersSpec, loadAttendance, loadMaster, parseMinutes, toYMD, EXCLUDE_POSITION, csvCell } from './lib.mjs';

const ATT = process.env.TNA_ATTENDANCE;
const MASTERS_SPEC = process.env.TNA_MASTERS || '';
const MONTH = process.env.TNA_MONTH || null;
const DETAIL_CSV = process.env.TNA_DETAIL_CSV || 'tna-period-detail.csv';
if (!ATT) { console.error('Set TNA_ATTENDANCE (see header for format).'); process.exit(1); }

// A matched master name agrees with the attendance name if they share a token
// (handles first-name-only attendance) or are similar overall; used only as a
// non-blocking collision flag, never to reject a match.
function nameAgrees(attName, masterName) {
  if (!attName || !masterName) return true; // can't judge -> don't flag
  const a = normalizeName(attName).split(' ').filter(Boolean);
  const b = new Set(normalizeName(masterName).split(' ').filter(Boolean));
  if (!a.length || !b.size) return true;
  if (a.some((t) => b.has(t))) return true;
  return diceCoefficient(a.slice().sort().join(' '), [...b].sort().join(' ')) >= 0.5;
}

// ── Pass 1: collect per-employee day minutes from the attendance ────
const { rows, cols } = loadAttendance(ATT);
const emp = new Map(); // id -> { empCode, name, dept, present, mins[] }
for (const r of rows) {
  if (MONTH && !toYMD(r[cols.date]).startsWith(MONTH)) continue;
  const id = String(r[cols.id] ?? '').trim();
  if (!id) continue;
  const dept = cols.dept ? String(r[cols.dept] ?? '').trim() : '';
  if (!emp.has(id)) emp.set(id, { empCode: id, name: cols.name ? String(r[cols.name] ?? '').trim() : '', dept, present: 0, mins: [] });
  const e = emp.get(id);
  e.present += 1;
  if (!e.dept && dept) e.dept = dept;
  const min = parseMinutes(r[cols.time]);
  if (min != null) e.mins.push(min);
}
console.log(`Attendance: ${emp.size} employees${MONTH ? ` in ${MONTH}` : ''} (id="${cols.id}" dept="${cols.dept}" time="${cols.time}" date="${cols.date}")`);

// ── Masters (optional): direct ID join -> position (scope) + entity (country) ──
// The join key was selected by overlap, so an exact (normalized) ID match is
// trustworthy here; we do NOT name-gate (attendance is often first-name only).
// We DO guard against collisions: two different people sharing a normalized ID
// (conflicting name AND entity) are left unmatched rather than silently merged.
const scopeBy = new Map(); // empCode -> { position, source, entity, nameMismatch }
let ambiguousIds = 0, nameMismatches = 0;
if (MASTERS_SPEC) {
  const attIdSet = new Set([...emp.keys()].map(normalizeId));
  const combined = parseMastersSpec(MASTERS_SPEC).flatMap((m) => {
    const { records, meta } = loadMaster(m, attIdSet);
    console.log(`[${m.label}] sheet="${meta.sheetName}" rows=${meta.rows} -> idCol="${meta.idCol}" (overlap ${meta.overlap})`);
    return records;
  });
  const groups = new Map(); // normId -> [records]
  for (const rec of combined) { const k = normalizeId(rec.empId); if (!k) continue; (groups.get(k) || groups.set(k, []).get(k)).push(rec); }
  const byId = new Map();
  for (const [k, recs] of groups) {
    const names = new Set(recs.map((r) => normalizeName(r.name)).filter(Boolean));
    const ents = new Set(recs.map((r) => canonicalEntity(r.entity)).filter(Boolean));
    if (names.size > 1 && ents.size > 1) { ambiguousIds += 1; continue; } // conflicting people -> don't auto-pick
    byId.set(k, recs.find((r) => r.position) || recs[0]);
  }
  for (const e of emp.values()) {
    const rec = byId.get(normalizeId(e.empCode));
    if (!rec) continue;
    const mismatch = !nameAgrees(e.name, rec.name);
    if (mismatch) nameMismatches += 1;
    scopeBy.set(e.empCode, { position: rec.position || '', source: rec.source || '', entity: rec.entity || null, nameMismatch: mismatch });
  }
  console.log(`Matched to masters (by ID): ${scopeBy.size}/${emp.size}`);
}

// ── Pass 2: per-country OT per employee ─────────────────────────────
const out = [];
for (const e of emp.values()) {
  const sc = scopeBy.get(e.empCode) || {};
  const country = resolveCountry(e.dept) || resolveCountry(sc.entity) || null;
  const cfg = getOtConfig(country || e.dept);
  let otDays = 0, otMin = 0, otDays9 = 0;
  for (const min of e.mins) {
    const c = classifyDay({ workedMinutes: min, incomplete: false }, { status: 'work', scheduledMinutes: cfg.standardDailyMinutes }, cfg);
    if ((c.overtime || 0) > 0) { otDays += 1; otMin += c.overtime; }
    if (min > 540) otDays9 += 1; // what a flat-9h rule would have counted (illustrative only)
  }
  const position = sc.position || '';
  const matched = scopeBy.has(e.empCode);
  const isExcluded = !!position && EXCLUDE_POSITION.test(position);
  const noPosition = matched && !position;
  const inScope = !MASTERS_SPEC || (matched && !!position && !isExcluded);
  out.push({ ...e, country: country || 'UNKNOWN', cfgMin: cfg.standardDailyMinutes, otDays, otMin, otDays9, position, source: sc.source || '', nameMismatch: !!sc.nameMismatch, matched, noPosition, isExcluded, inScope });
}

// ── Report ──────────────────────────────────────────────────────────
const inScopeRows = out.filter((e) => !MASTERS_SPEC || e.inScope);
const byCountry = {};
for (const e of inScopeRows) {
  const g = (byCountry[e.country] ||= { rule: e.cfgMin / 60 + 'h', emps: 0, present: 0, otDays: 0, otHours: 0, otDays9: 0 });
  g.emps += 1; g.present += e.present; g.otDays += e.otDays; g.otHours += e.otMin / 60; g.otDays9 += e.otDays9;
}
console.log('\n=== OVERTIME RULE: UAE after 10h | KSA / Kuwait / Bahrain after 9h ===');
if (MASTERS_SPEC) {
  console.log(`In scope (blue-collar): ${inScopeRows.length}   excluded (manager/admin): ${out.filter((e) => e.isExcluded).length}   no position (NOT counted): ${out.filter((e) => e.noPosition).length}   unmatched: ${out.filter((e) => !e.matched).length}`);
  const noPos = out.filter((e) => e.noPosition).length;
  if (noPos) console.log(`!! ${noPos} matched employees have a BLANK position and were NOT counted — fix the master or include them manually`);
  if (ambiguousIds) console.log(`!! ${ambiguousIds} IDs map to conflicting people in the masters (left unmatched) — check for reused/duplicate IDs`);
  if (nameMismatches) console.log(`!! ${nameMismatches} matched rows have a name that disagrees with the master (possible ID collision) — see nameMismatch in the CSV`);
}
const unknown = inScopeRows.filter((e) => e.country === 'UNKNOWN').length;
if (unknown) console.log(`!! ${unknown} in-scope employees have UNKNOWN country (scored at 9h default) — fix their Department/entity; their OT may be wrong`);
console.log('\nPer country (in-scope):');
for (const [c, g] of Object.entries(byCountry)) {
  console.log(`  ${c} (OT > ${g.rule}): ${g.emps} emp · ${g.present} present-days · ${g.otDays} OT-days · ${g.otHours.toFixed(1)} OT-hours` + (c === 'UAE' ? `   [at flat 9h it would be ${g.otDays9} OT-days]` : ''));
}
const tot = inScopeRows.reduce((a, e) => ({ otDays: a.otDays + e.otDays, otHours: a.otHours + e.otMin / 60 }), { otDays: 0, otHours: 0 });
console.log(`\nTOTAL in-scope: ${tot.otDays} OT-days · ${tot.otHours.toFixed(1)} OT-hours`);

// ── Detail CSV (local only) ─────────────────────────────────────────
const lines = ['empCode,name,country,dept,present,otDays,otHours,otDays_at_9h,source,position,inScope,nameMismatch'];
for (const e of out) lines.push([e.empCode, e.name, e.country, e.dept, e.present, e.otDays, (e.otMin / 60).toFixed(2), e.otDays9, e.source, e.position, e.inScope, e.nameMismatch].map(csvCell).join(','));
writeFileSync(DETAIL_CSV, lines.join('\n'));
console.log(`\nDetail -> ${DETAIL_CSV} (local only).`);

// CLI wrapper over the T&A run service. Per-country overtime (UAE 10h;
// KSA/Kuwait/Bahrain 9h), matched to HR masters, scoped to blue-collar.
// Aggregate + per-country output to the console; per-employee detail -> local CSV.
//
// Usage (PowerShell):
//   $env:TNA_ATTENDANCE = 'C:\path\Over time Punch IN & OUT Report ... .csv'
//   $env:TNA_MASTERS    = 'GCC=C:\path\Calo Master Employee Tracker GCC.xlsx'   (optional; enables scope + names)
//   # optional: $env:TNA_MONTH = '2026-05'   (YYYY-MM filter; omit for a custom pay period)
//   # optional: $env:TNA_DETAIL_CSV = 'C:\path\out.csv'   (default ./tna-period-detail.csv)
//   # optional: $env:TNA_XLSX = 'C:\path\out.xlsx'        (also write the Excel workbook)
//   node server/src/services/tna/tools/runPeriod.mjs
import { writeFileSync } from 'fs';
import { runPeriod, buildWorkbook } from '../runService.js';
import { parseMastersSpec, csvCell } from '../fileLib.js';

const ATT = process.env.TNA_ATTENDANCE;
const MASTERS_SPEC = process.env.TNA_MASTERS || '';
const MONTH = process.env.TNA_MONTH || null;
const DETAIL_CSV = process.env.TNA_DETAIL_CSV || 'tna-period-detail.csv';
if (!ATT) { console.error('Set TNA_ATTENDANCE (see header for format).'); process.exit(1); }

const masters = MASTERS_SPEC ? parseMastersSpec(MASTERS_SPEC) : [];
const r = runPeriod({ attendancePath: ATT, masters, month: MONTH });

console.log(`Attendance: ${r.attendance.employees} employees${MONTH ? ` in ${MONTH}` : ''} (id="${r.attendance.cols.id}" dept="${r.attendance.cols.dept}" time="${r.attendance.cols.time}" date="${r.attendance.cols.date}")`);
for (const m of r.masters) console.log(`[${m.label}] sheet="${m.sheetName}" rows=${m.rows} -> idCol="${m.idCol}" (overlap ${m.overlap})`);
if (MASTERS_SPEC) console.log(`Matched to masters (by ID): ${r.scope.matched}/${r.attendance.employees}`);
if (r.flags.mastersMatchedNone) console.log('!! master(s) provided but matched 0 employees — check the file or pin the right sheet (#SheetName)');

console.log('\n=== OVERTIME RULE: UAE after 10h | KSA / Kuwait / Bahrain after 9h ===');
if (MASTERS_SPEC) {
  console.log(`In scope (blue-collar): ${r.scope.inScope}   excluded (manager/admin): ${r.scope.excluded}   no position (NOT counted): ${r.scope.noPosition}   unmatched: ${r.scope.unmatched}`);
  if (r.scope.noPosition) console.log(`!! ${r.scope.noPosition} matched employees have a BLANK position and were NOT counted — fix the master or include them manually`);
  if (r.flags.ambiguousIds) console.log(`!! ${r.flags.ambiguousIds} IDs map to conflicting people in the masters (left unmatched) — check for reused/duplicate IDs`);
  if (r.flags.nameMismatches) console.log(`!! ${r.flags.nameMismatches} matched rows have a name that disagrees with the master (possible ID collision) — see nameMismatch in the CSV`);
}
if (r.flags.unknownCountry) console.log(`!! ${r.flags.unknownCountry} in-scope employees have UNKNOWN country (scored at 9h default) — fix their Department/entity; their OT may be wrong`);

console.log('\nPer country (in-scope):');
for (const g of r.byCountry) {
  console.log(`  ${g.country} (OT > ${g.rule}): ${g.emps} emp · ${g.present} present-days · ${g.otDays} OT-days · ${g.otHours.toFixed(1)} OT-hours` + (g.country === 'UAE' ? `   [at flat 9h it would be ${g.otDays9} OT-days]` : ''));
}
console.log(`\nTOTAL in-scope: ${r.totals.otDays} OT-days · ${r.totals.otHours.toFixed(1)} OT-hours`);
if (r.daily.periodStart) console.log(`Calendar ${r.daily.periodStart}..${r.daily.periodEnd}: ${r.daily.workDays.length} work-days / ${r.daily.offDays.length} off-days (inferred) · ${r.daily.totalAbsences} absences · ${r.daily.totalOvernight} overnight shifts`);

const header = 'empCode,name,country,dept,daysWorked,absentDays,overnightDays,present,otDays,otHours,otDays_at_9h,source,position,inScope,nameMismatch';
const lines = [header, ...r.rows.map((e) => [e.empCode, e.name, e.country, e.dept, e.daysWorked, e.absentDays, e.overnightDays, e.present, e.otDays, e.otHours, e.otDays9, e.source, e.position, e.inScope, e.nameMismatch].map(csvCell).join(','))];
writeFileSync(DETAIL_CSV, lines.join('\n'));
console.log(`\nDetail -> ${DETAIL_CSV} (local only).`);
if (process.env.TNA_XLSX) { writeFileSync(process.env.TNA_XLSX, buildWorkbook(r)); console.log(`Excel  -> ${process.env.TNA_XLSX}`); }

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPeriod, buildWorkbook } from './runService.js';

let seq = 0;
const tmpCsv = (content) => { const p = join(tmpdir(), `tna-rs-${process.pid}-${seq++}.csv`); writeFileSync(p, content); return p; };

test('runPeriod computes per-country OT from a totals export (no masters)', () => {
  // UAE 10h threshold: 10:30 (630) -> 30m OT; 9:00 (540) -> none.
  const p = tmpCsv('Employee ID,First Name,Department,Date,Total Time\nFTE1,Ali,CALO UAE,2026-06-01,10:30\nFTE1,Ali,CALO UAE,2026-06-02,9:00\n');
  try {
    const r = runPeriod({ attendancePath: p });
    assert.equal(r.attendance.employees, 1);
    assert.equal(r.byCountry.length, 1);
    assert.equal(r.byCountry[0].country, 'UAE');
    assert.equal(r.byCountry[0].otDays, 1);   // only the 10:30 day
    assert.equal(r.totals.otDays, 1);
    assert.ok(Buffer.isBuffer(buildWorkbook(r)));
  } finally { rmSync(p, { force: true }); }
});

test('runPeriod finds the header beneath a banner/title row', () => {
  const p = tmpCsv('CALO Attendance Report — June\nEmployee ID,First Name,Department,Date,Total Time\nFTE1,Ali,CALO UAE,2026-06-01,11:00\n');
  try {
    const r = runPeriod({ attendancePath: p });
    assert.equal(r.attendance.employees, 1);   // not silently zero
    assert.equal(r.byCountry[0].otDays, 1);    // 11:00 = 660 > 600 (UAE)
  } finally { rmSync(p, { force: true }); }
});

test('runPeriod throws a userError when no Employee ID column exists', () => {
  const p = tmpCsv('Foo,Bar\n1,2\n');
  try {
    assert.throws(() => runPeriod({ attendancePath: p }), (e) => e.userError === true && /Employee ID/.test(e.message));
  } finally { rmSync(p, { force: true }); }
});

test('calendar: infers work days, finds absences, flags overnight shifts', () => {
  // A works all 3 days; B is absent on the 2nd (a team work day); C works an
  // overnight on the 1st (in 22:00 -> out 06:00 next day).
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'A,Ann,CALO UAE,2026-06-01,08:00,17:00,9:00',
    'A,Ann,CALO UAE,2026-06-02,08:00,17:00,9:00',
    'A,Ann,CALO UAE,2026-06-03,08:00,17:00,9:00',
    'B,Bob,CALO UAE,2026-06-01,08:00,17:00,9:00',
    'B,Bob,CALO UAE,2026-06-03,08:00,17:00,9:00',
    'C,Cy,CALO UAE,2026-06-01,22:00,06:00,8:00',
    'C,Cy,CALO UAE,2026-06-02,08:00,17:00,9:00',
    'C,Cy,CALO UAE,2026-06-03,08:00,17:00,9:00',
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    assert.equal(r.daily.workDays.length, 3);
    assert.equal(r.daily.offDays.length, 0);
    const B = r.rows.find((x) => x.empCode === 'B');
    assert.equal(B.daysWorked, 2);
    assert.equal(B.absentDays, 1);
    assert.equal(B.absences[0].date, '2026-06-02');
    assert.equal(r.rows.find((x) => x.empCode === 'C').overnightDays, 1);
    assert.equal(r.daily.totalAbsences, 1);
    assert.equal(r.daily.totalOvernight, 1);
  } finally { rmSync(p, { force: true }); }
});

test('overnight is NOT flagged when check-in equals check-out', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'A,Ann,CALO UAE,2026-06-01,08:00,08:00,0:00',
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    assert.equal(r.rows[0].overnightDays, 0);
    assert.equal(r.daily.totalOvernight, 0);
  } finally { rmSync(p, { force: true }); }
});

test('rosterRecords (e.g. from Zelt) act as a master — match + position scope', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,Total Time',
    'FTE1,Ali,CALO UAE,2026-06-01,11:00',
    'FTE2,Sam,CALO UAE,2026-06-01,8:00',
  ].join('\n') + '\n');
  try {
    const rosterRecords = [
      { empId: 'FTE1', name: 'Ali Hassan', position: 'Cook', entity: 'CALO UAE', source: 'Zelt' },
      { empId: 'FTE2', name: 'Sam Omar', position: 'Kitchen Manager', entity: 'CALO UAE', source: 'Zelt' },
    ];
    const r = runPeriod({ attendancePath: p, rosterRecords });
    assert.equal(r.scope.matched, 2);
    assert.equal(r.scope.inScope, 1);   // FTE2 is a Manager -> excluded
    assert.equal(r.scope.excluded, 1);
    assert.equal(r.masters.find((m) => m.label === 'Zelt').overlap, 2);
  } finally { rmSync(p, { force: true }); }
});

test('report aggregates: byDate / byDept / topOt / missingHours, and aggregates carry no names', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,Total Time',
    'A,Ann,CALO UAE - Kitchen,2026-06-01,11:00',   // OT (11h > 10h UAE)
    'A,Ann,CALO UAE - Kitchen,2026-06-02,9:00',
    'B,Bob,CALO UAE - Kitchen,2026-06-01,12:00',    // OT
    'B,Bob,CALO UAE - Kitchen,2026-06-02,',          // missing hours
    'C,Cy,CALO UAE - Dispatch,2026-06-01,8:00',
    'C,Cy,CALO UAE - Dispatch,2026-06-02,8:00',
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    const d1 = r.byDate.find((x) => x.date === '2026-06-01');
    assert.equal(d1.present, 3);
    assert.equal(d1.onOt, 2);
    const kitchen = r.byDept.find((x) => x.dept.includes('Kitchen'));
    assert.equal(kitchen.employees, 2);
    assert.ok(kitchen.otDays >= 2);
    assert.ok(r.topOt.length >= 2);
    assert.ok(r.missingHours.some((m) => m.empCode === 'B' && m.date === '2026-06-02'));
    // The AI bundle must never carry employee names or IDs.
    const blob = JSON.stringify(r.aggregates);
    assert.ok(!/Ann|Bob|"name"|empCode/.test(blob), 'aggregates leaked names/ids');
  } finally { rmSync(p, { force: true }); }
});

test('duplicate / split-shift rows for one employee-day merge into a single day', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'A,Ann,CALO UAE,2026-06-01,08:00,12:00,4:00',
    'A,Ann,CALO UAE,2026-06-01,13:00,20:00,7:00',
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    assert.equal(r.rows[0].daysWorked, 1);     // one calendar day, not two
    assert.equal(r.rows[0].present, 1);
    assert.equal(r.rows[0].days[0].hours, 11); // 4h + 7h merged
    assert.equal(r.rows[0].otDays, 1);         // 11h > 10h (UAE) counted once
  } finally { rmSync(p, { force: true }); }
});

test('overnight split rows: in 20:00 Sep 8 / out 04:00 Sep 9 is ONE working day', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'N,Nidal,CALO RIYADH,2026-09-08,20:00,20:00,0:00',
    'N,Nidal,CALO RIYADH,2026-09-09,04:00,04:00,0:00',
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    const n = r.rows[0];
    assert.equal(n.present, 1);                // NOT 2
    assert.equal(n.days.length, 1);
    assert.equal(n.days[0].date, '2026-09-08'); // attributed to the shift start
    assert.equal(n.days[0].hours, 8);
    assert.equal(n.days[0].overnight, true);
    assert.equal(n.days[0].stitched, true);
    assert.equal(n.overnightDays, 1);
    assert.equal(n.otDays, 0);                 // 8h < 9h KSA threshold
    assert.equal(n.avgHours, 8);
    assert.equal(r.aggregates.workRate.stitchedOvernight, 1);
    assert.ok(Buffer.isBuffer(buildWorkbook(r)));
  } finally { rmSync(p, { force: true }); }
});

test('night-shift chain crossing midnight: correct hours and OT per shift, counted once', () => {
  // 19:00 → 05:00 = 10h shifts on Sep 8 and Sep 9. The export reports the
  // middle day as a bogus 05:00–19:00 14h span (prev out + next in).
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'N,Nidal,CALO RIYADH,2026-09-08,19:00,19:00,0:00',
    'N,Nidal,CALO RIYADH,2026-09-09,05:00,19:00,14:00',
    'N,Nidal,CALO RIYADH,2026-09-10,05:00,05:00,0:00',
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    const n = r.rows[0];
    assert.equal(n.present, 2);                       // two 10h shifts, not 3 days
    assert.deepEqual(n.days.map((d) => d.date), ['2026-09-08', '2026-09-09']);
    assert.deepEqual(n.days.map((d) => d.hours), [10, 10]);
    assert.equal(n.otDays, 2);                        // 10h > 9h KSA — 1h OT each
    assert.equal(n.otHours, 2);
    assert.equal(n.overnightDays, 2);
  } finally { rmSync(p, { force: true }); }
});

test('mispaired UAE export end-to-end: off day clean, fake OT gone, true OT kept', () => {
  // Direction-aware export: each row = tonight's in + this morning's out
  // (yesterday's shift). Off day Sep 10 shows only a lone morning out.
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'R,Ravi,CALO UAE,2026-09-08,21:14,8:04,10:49',
    'R,Ravi,CALO UAE,2026-09-09,20:50,8:07,11:16',
    'R,Ravi,CALO UAE,2026-09-10,,8:01,',
    'R,Ravi,CALO UAE,2026-09-11,22:16,,',
    'R,Ravi,CALO UAE,2026-09-12,21:08,8:01,10:53',
    'R,Ravi,CALO UAE,2026-09-13,,7:54,',
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    const n = r.rows[0];
    assert.equal(n.present, 4);                        // NOT 6 — off day + tail cleared
    assert.deepEqual(n.days.map((d) => d.date), ['2026-09-08', '2026-09-09', '2026-09-11', '2026-09-12']);
    assert.deepEqual(n.days.map((d) => d.hours), [10.88, 11.18, 9.75, 10.77]);
    assert.equal(n.otDays, 3);                         // UAE >10h: three of the four
    assert.equal(n.overnightDays, 4);
    assert.ok(n.days.every((d) => d.overnight && d.stitched));
  } finally { rmSync(p, { force: true }); }
});

test('month-first dates (9/8/2026) are detected from the file, not misread as Aug 9', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'A,Ann,CALO UAE,9/8/2026,08:00,17:00,9:00',    // ambiguous on its own
    'A,Ann,CALO UAE,9/27/2026,08:00,17:00,9:00',   // 27 can't be a month -> MDY file
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    assert.deepEqual(r.rows[0].days.map((d) => d.date), ['2026-09-08', '2026-09-27']);
  } finally { rmSync(p, { force: true }); }
});

test('Zelt roster dept/title surface per employee; disagreeing departments are flagged', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'A,Ann,CALO UAE - Kitchen,2026-06-01,08:00,17:00,9:00',
    'B,Bob,CALO UAE - Kitchen,2026-06-01,08:00,17:00,9:00',
  ].join('\n') + '\n');
  const rosterRecords = [
    { empId: 'A', name: 'Ann', position: 'Cook I', entity: 'CALO UAE', department: 'Kitchen', source: 'Zelt' },
    { empId: 'B', name: 'Bob', position: 'Driver', entity: 'CALO UAE', department: 'Delivery', source: 'Zelt' },
  ];
  try {
    const r = runPeriod({ attendancePath: p, rosterRecords });
    const a = r.rows.find((x) => x.empCode === 'A'), b = r.rows.find((x) => x.empCode === 'B');
    assert.equal(a.masterDept, 'Kitchen');
    assert.equal(a.deptMismatch, false);   // "CALO UAE - Kitchen" agrees with "Kitchen"
    assert.equal(b.masterDept, 'Delivery');
    assert.equal(b.deptMismatch, true);    // badges in Kitchen, Zelt says Delivery
    assert.equal(r.flags.deptMismatches, 1);
  } finally { rmSync(p, { force: true }); }
});

test('a single row claiming over 16h is a missing punch, not phantom OT', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'A,Ann,CALO UAE,2026-06-01,05:00,23:30,18:30',
    'A,Ann,CALO UAE,2026-06-02,08:00,17:00,9:00',
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    const a = r.rows[0];
    assert.equal(a.days[0].hours, null);   // 18h30 discarded for review
    assert.equal(a.otDays, 0);
    assert.ok(r.missingHours.some((m) => m.date === '2026-06-01'));
    const d2 = r.byDate.find((x) => x.date === '2026-06-02');
    assert.equal(d2.hours, 9);             // per-day total worked hours
  } finally { rmSync(p, { force: true }); }
});

test('raw transaction punch log: pairs across midnight with real check-in/out', () => {
  // Night worker: IN 19:00 Sep 8 → OUT 05:00 Sep 9 = one 10h day on Sep 8.
  // Also a same-day shift and an orphan OUT (previous shift's tail) at the top.
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,Time,Punch State',
    'N,Nidal,CALO KUWAIT,2026-09-08,05:00,Check Out',   // orphan (prev shift) -> incomplete, not scored
    'N,Nidal,CALO KUWAIT,2026-09-08,19:00,Check In',
    'N,Nidal,CALO KUWAIT,2026-09-09,05:00,Check Out',    // closes the 19:00 IN -> 10h on Sep 8
    'N,Nidal,CALO KUWAIT,2026-09-09,19:00,Check In',
    'N,Nidal,CALO KUWAIT,2026-09-10,05:00,Check Out',    // 10h on Sep 9
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    const n = r.rows[0];
    const d8 = n.days.find((d) => d.date === '2026-09-08');
    assert.equal(d8.checkIn, '19:00');
    assert.equal(d8.checkOut, '05:00');
    assert.equal(d8.hours, 10);
    assert.equal(d8.overnight, true);          // out clock (05:00) < in clock (19:00)
    const d9 = n.days.find((d) => d.date === '2026-09-09');
    assert.equal(d9.hours, 10);
    assert.equal(d9.overnight, true);
    assert.equal(n.overnightDays, 2);
    assert.ok(n.otDays >= 2);                   // 10h > 9h KWT threshold
  } finally { rmSync(p, { force: true }); }
});

test('"First Punch"/"Last Punch" summary headers populate check-in/out', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,Weekday,First Punch,Last Punch,Total Time',
    'A,Ann,CALO KUWAIT,2026-09-01,Tue,08:00,17:00,9:00',
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    const d = r.rows[0].days[0];
    assert.equal(d.checkIn, '08:00');
    assert.equal(d.checkOut, '17:00');
  } finally { rmSync(p, { force: true }); }
});

test('uploaded schedule drives exact absences + scheduled-vs-actual', () => {
  // N works 2 of 3 scheduled days; the OFF day is never an absence; the
  // scheduled work day with no punch IS an absence. Variance = actual − scheduled.
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'N,Nidal,CALO KUWAIT,2026-09-25,06:00,16:00,10:00',   // scheduled 06:00-15:00 (9h) -> +1h
    'N,Nidal,CALO KUWAIT,2026-09-27,22:00,22:00,0:00',    // overnight start (stitches w/ 09-28)
    'N,Nidal,CALO KUWAIT,2026-09-28,07:00,07:00,0:00',    // overnight end
  ].join('\n') + '\n');
  const schedule = {
    byEmpId: new Map([['N', new Map([
      ['2026-09-25', { type: 'work', start: 360, end: 900, overnight: false, raw: '06:00-15:00' }],
      ['2026-09-26', { type: 'off', raw: 'OFF' }],
      ['2026-09-27', { type: 'work', start: 1320, end: 420, overnight: true, raw: '22:00-07:00' }],
      ['2026-09-28', { type: 'work', start: 360, end: 900, overnight: false, raw: '06:00-15:00' }], // no punch -> absent
      ['2026-10-05', { type: 'work', start: 360, end: 900, overnight: false, raw: '06:00-15:00' }], // BEYOND the attendance window -> ignored
    ])]]),
    meta: { tab: 'Sep26-Oct26', matched: 1, periodStart: '2026-09-25', periodEnd: '2026-09-28' },
    unmatched: [{ name: 'Someone Else', position: 'Cook' }],
  };
  try {
    const r = runPeriod({ attendancePath: p, schedule });
    const n = r.rows[0];
    assert.equal(n.hasSchedule, true);
    const d25 = n.days.find((d) => d.date === '2026-09-25');
    assert.equal(d25.scheduled, '06:00-15:00');
    assert.equal(d25.varianceH, 1);                 // 10h actual − 9h scheduled
    const d27 = n.days.find((d) => d.date === '2026-09-27');
    assert.equal(d27.scheduled, '22:00-07:00');
    assert.equal(d27.schedOvernight, true);
    assert.equal(d27.hours, 9);                      // stitched 22:00→07:00
    // Sep 26 was OFF -> not an absence; Sep 28 scheduled work, no punch -> absent.
    assert.deepEqual(n.absences.map((a) => a.date), ['2026-09-28']);
    assert.equal(n.absentDays, 1);
    // Schedule-driven calendar: every scheduled day is present with its label,
    // even the no-punch ones.
    const d26 = n.days.find((d) => d.date === '2026-09-26');
    assert.equal(d26.scheduled, 'OFF');
    assert.equal(d26.schedType, 'off');
    assert.equal(d26.hours, null);
    const d28 = n.days.find((d) => d.date === '2026-09-28');
    assert.equal(d28.scheduled, '06:00-15:00');   // exact scheduled time shown on the no-show day
    assert.equal(d28.hours, null);
    assert.deepEqual(n.restDates, ['2026-09-26']); // OFF from the roster
    assert.equal(n.restDays, 1);
    // The Oct 5 scheduled day is beyond the attendance file window -> not shown, not absent.
    assert.equal(n.days.find((d) => d.date === '2026-10-05'), undefined);
    assert.ok(!n.absences.some((a) => a.date === '2026-10-05'));
    assert.equal(r.schedule.tab, 'Sep26-Oct26');
    assert.equal(r.schedule.unmatchedCount, 1);
    assert.equal(r.schedule.linkedInRun, 1);
  } finally { rmSync(p, { force: true }); }
});

test('work rate: avg hours and short/long day flags surface odd punches', () => {
  const p = tmpCsv([
    'Employee ID,First Name,Department,Date,First Check In,Last Check Out,Total Time',
    'A,Ann,CALO UAE,2026-06-01,08:00,17:00,9:00',
    'A,Ann,CALO UAE,2026-06-02,08:00,10:00,2:00',   // short day (<4h)
    'A,Ann,CALO UAE,2026-06-03,06:00,19:30,13:30',  // long day (>12h)
  ].join('\n') + '\n');
  try {
    const r = runPeriod({ attendancePath: p });
    const a = r.rows[0];
    assert.equal(a.shortDays, 1);
    assert.equal(a.longDays, 1);
    assert.equal(a.avgHours, +((9 + 2 + 13.5) / 3).toFixed(2));
    assert.equal(r.aggregates.workRate.shortDaysTotal, 1);
    assert.equal(r.aggregates.workRate.longDaysTotal, 1);
    assert.equal(r.aggregates.workRate.avgHoursPerDay, +((9 + 2 + 13.5) / 3).toFixed(2));
  } finally { rmSync(p, { force: true }); }
});

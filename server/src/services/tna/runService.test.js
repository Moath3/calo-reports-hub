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

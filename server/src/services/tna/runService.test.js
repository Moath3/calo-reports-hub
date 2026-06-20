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

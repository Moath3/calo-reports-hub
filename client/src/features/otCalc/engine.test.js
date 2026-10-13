// Engine regression tests (node:test). Run: node --test client/src/features/otCalc/engine.test.js
// engine.js is pure ESM with no browser deps, so it runs under node directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, detectMap, compute, buildMaster, buildView, roundOT, hourly, otAmt, payFactor } from './engine.js';

const HEAD = ['Emp ID', 'Name', 'Department', 'Date', 'Time', 'Punch State'];
const MAP = detectMap(HEAD);
const S = mergeSettings({});
const run = (rows, settings = S, master = null) => compute({ rows: [HEAD, ...rows], hdrIdx: 0, map: MAP, settings, master });

test('column auto-detection maps id/name/dept/date/time/state', () => {
  assert.deepEqual(MAP, { id: 0, name: 1, lname: -1, dept: 2, loc: -1, date: 3, time: 4, state: 5 });
});

test('OT math: 08:00-19:00 → span 660, break 60, normal 480, buffer 10, OT 110', () => {
  const D = run([
    ['E1', 'Ahmed', 'Kitchen', '2026-09-01', '08:00', 'Check In'],
    ['E1', 'Ahmed', 'Kitchen', '2026-09-01', '19:00', 'Check Out'],
  ]);
  const d = D.daily[0];
  assert.equal(d.span, 660); assert.equal(d.brk, 60); assert.equal(d.actual, 600);
  assert.equal(d.normal, 480); assert.equal(d.buf, 10); assert.equal(d.ot, 110); assert.equal(d.status, 'OT');
});

test('overnight shift merges into one row anchored to the start date', () => {
  const D = run([
    ['E2', 'Sara', 'Dispatch', '2026-09-01', '22:00', 'Check In'],
    ['E2', 'Sara', 'Dispatch', '2026-09-02', '06:00', 'Check Out'],
  ]);
  assert.equal(D.daily.length, 1);
  assert.equal(D.daily[0].date, '2026-09-01');
  assert.equal(D.daily[0].overnight, true);
  assert.equal(D.daily[0].span, 480);
  assert.equal(D.daily[0].ot, 0);
});

test('missing OUT becomes a Missing OUT exception, not a scored shift', () => {
  const D = run([['E3', 'Omar', 'Kitchen', '2026-09-01', '09:00', 'Check In']]);
  assert.equal(D.daily[0].issue, 'Missing OUT');
  assert.ok(D.exc.some((x) => x.type === 'Missing OUT' && x.id === 'E3'));
});

test('duplicate punches within the dup window are removed', () => {
  const D = run([
    ['E4', 'Lee', 'Kitchen', '2026-09-01', '08:00', 'Check In'],
    ['E4', 'Lee', 'Kitchen', '2026-09-01', '08:05', 'Check In'],   // dup (within 15m)
    ['E4', 'Lee', 'Kitchen', '2026-09-01', '17:00', 'Check Out'],
  ]);
  assert.equal(D.dupCount, 1);
  assert.equal(D.daily.length, 1);
  assert.equal(D.daily[0].span, 540); // 08:00 kept, not 08:05
});

test('OT rounding down to 30 min', () => {
  const D = run([
    ['E5', 'Kim', 'Kitchen', '2026-09-01', '08:00', 'Check In'],
    ['E5', 'Kim', 'Kitchen', '2026-09-01', '19:00', 'Check Out'],
  ], mergeSettings({ otRound: 'd30' }));
  assert.equal(D.daily[0].ot, 90); // 110 floored to nearest 30 below = 90
});

test('salary → hourly rate: /30 vs /365 basis', () => {
  assert.equal(hourly(3000, mergeSettings({ rateBasis: '30', rateHours: 8 })), 3000 / 30 / 8);        // 12.5
  assert.equal(hourly(3000, mergeSettings({ rateBasis: '365', rateHours: 8 })), 3000 * 12 / 365 / 8); // ~12.33
});

test('OT amount = min/60 × hourly × multiplier, company decimals', () => {
  assert.equal(otAmt(110, 3000, S, 2), 28.65);  // 110/60*12.5*1.25
});

test('buildView: amount scales by allowance factor + special allowance', () => {
  const D = run([
    ['E1', 'Ahmed', 'Kitchen', '2026-09-01', '08:00', 'Check In'],
    ['E1', 'Ahmed', 'Kitchen', '2026-09-01', '19:00', 'Check Out'],
  ]);
  const master = buildMaster([{ sn: 'Calo UAE MP', rows: [['Emp ID', 'Basic Salary', 'Status', 'Designation'], ['E1', 3000, 'Active', 'Cook']] }], 'Calo UAE MP');
  // full eligibility
  let V = buildView(D, { settings: S, master, dec: 2 });
  assert.equal(V.summary[0].amount, 28.65);
  assert.equal(V.summary[0].total, 28.65);
  // 50% allowance + 10 special
  V = buildView(D, { settings: S, master, excl: { E1: { pay: 'half' } }, special: { E1: 10 }, dec: 2 });
  assert.equal(V.summary[0].factor, 0.5);
  assert.equal(V.summary[0].amount, 14.33); // 28.65*0.5 rounded
  assert.equal(V.summary[0].total, 24.33);  // +10 special
});

test('no basic salary in master → factor 0, no OT amount', () => {
  const master = buildMaster([{ sn: 'Calo UAE MP', rows: [['Emp ID', 'Basic Salary', 'Status'], ['E9', '', 'Active']] }], 'Calo UAE MP');
  assert.equal(payFactor('E9', { master, excl: {} }), 0);
});

test('roundOT respects minimum-OT threshold', () => {
  assert.equal(roundOT(5, mergeSettings({ minOT: 10 })), 0);
  assert.equal(roundOT(20, mergeSettings({ minOT: 10 })), 20);
});

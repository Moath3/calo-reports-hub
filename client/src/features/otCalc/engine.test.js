// Engine regression tests (node:test). Run: node --test client/src/features/otCalc/engine.test.js
// engine.js is pure ESM with no browser deps, so it runs under node directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, detectMap, compute, buildMaster, buildView, buildSched, cycleKey, roundOT, hourly, otAmt, payFactor, famMatches } from './engine.js';

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

test('schedule-fill: a Missing OUT is completed from a matching scheduled shift', () => {
  // schedule: "September 2026" tab, header row of day numbers + ID col, EMP01 day 1 = 8am-5pm
  const dayHeader = ['ID', ...Array.from({ length: 31 }, (_, i) => i + 1)];
  const empRow = ['EMP01', '8am-5pm', ...Array(30).fill(null)];
  const sched = buildSched([{ sn: 'September 2026', y: 2026, m: 9, rows: [dayHeader, empRow] }], 'sched.xlsx');
  assert.ok(sched && sched.map['EMP01']['2026-09-01'] === '8am-5pm');

  // punch file: EMP01 checks IN at 08:00 but never OUT → Missing OUT
  const D = compute({
    rows: [HEAD, ['EMP01', 'Ali', 'Kitchen', '2026-09-01', '08:00', 'Check In']],
    hdrIdx: 0, map: MAP, settings: S, sched,
  });
  const d = D.daily[0];
  assert.equal(d.issue, null);            // the Missing OUT was resolved
  assert.equal(d.filled, 'OUT');
  assert.equal(d.span, 540);              // 08:00 → scheduled 17:00 = 9h
  assert.ok(d.flags.some((f) => f.type === 'Filled from schedule'));
  // and no Missing OUT exception survives
  assert.ok(!D.exc.some((x) => x.type === 'Missing OUT'));
});

test('cycleKey: payroll-cycle month (calendar + mid-month start + year rollover)', () => {
  assert.equal(cycleKey('2026-09-10', 1), '2026-09');   // calendar month
  assert.equal(cycleKey('2026-09-16', 16), '2026-10');  // on/after start → next cycle
  assert.equal(cycleKey('2026-09-15', 16), '2026-09');  // before start → same cycle
  assert.equal(cycleKey('2026-12-20', 16), '2027-01');  // December rolls to next year
});

test('famMatches: production matches, Non-Production does NOT (substring trap)', () => {
  assert.equal(famMatches('Production Crew', 'Production'), true);
  assert.equal(famMatches('Non-Production', 'Production'), false); // the bug: substring includes "production"
  assert.equal(famMatches('Non Production', 'Production'), false);
  assert.equal(famMatches('Office', 'production'), false);
  assert.equal(famMatches('anything', ''), true);
});

test('salary join is ID-normalized (case/whitespace mismatch still matches)', () => {
  const D = run([
    [' emp01 ', 'Ali', 'Kitchen', '2026-09-01', '08:00', 'Check In'],   // punch id has spaces + lowercase
    [' emp01 ', 'Ali', 'Kitchen', '2026-09-01', '19:00', 'Check Out'],
  ]);
  const master = buildMaster([{ sn: 'Calo UAE MP', rows: [['Emp ID', 'Basic Salary', 'Status'], ['EMP01', 3000, 'Active']] }], 'Calo UAE MP');
  const V = buildView(D, { settings: S, master, dec: 2 });
  const row = V.summary.find((x) => x.name === 'Ali');
  assert.equal(row.basic, 3000);   // matched despite ' emp01 ' vs 'EMP01'
  assert.ok(row.amount > 0);
  assert.equal(V.kpis.salaryMatched, 1);
});

test('production guardrail: Job Family column excludes non-production from OT pay', () => {
  const rows = [
    ['P1', 'Cook', 'Kitchen', '2026-09-01', '08:00', 'Check In'],
    ['P1', 'Cook', 'Kitchen', '2026-09-01', '19:00', 'Check Out'],
    ['O1', 'Manager', 'Admin', '2026-09-01', '08:00', 'Check In'],
    ['O1', 'Manager', 'Admin', '2026-09-01', '19:00', 'Check Out'],
  ];
  const D = compute({ rows: [HEAD, ...rows], hdrIdx: 0, map: MAP, settings: S });
  const master = buildMaster([{ sn: 'Calo UAE MP', rows: [
    ['Emp ID', 'Basic Salary', 'Status', 'Job Family'],
    ['P1', 3000, 'Active', 'Production'],
    ['O1', 6000, 'Active', 'Office'],
  ] }], 'Calo UAE MP');
  assert.equal(master.hasFamily, true);
  // prodOnly ON (default): P1 paid, O1 excluded (no pay, flagged)
  let V = buildView(D, { settings: S, master, dec: 2 });
  const p1 = V.summary.find((x) => x.id === 'P1');
  const o1 = V.summary.find((x) => x.id === 'O1');
  assert.ok(p1.amount > 0);
  assert.equal(o1.factor, 0);
  assert.equal(o1.prodExcluded, true);
  assert.equal(o1.amount, null);   // non-production salary is hidden entirely
  assert.equal(o1.basic, null);
  // prodOnly OFF: O1 now paid, salary shown
  V = buildView(D, { settings: mergeSettings({ prodOnly: false }), master, dec: 2 });
  assert.ok(V.summary.find((x) => x.id === 'O1').amount > 0);
});

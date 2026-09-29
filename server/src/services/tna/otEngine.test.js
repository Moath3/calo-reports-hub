import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairPunches } from './otEngine.js';
import { classifyDay } from './otEngine.js';
import { DEFAULT_OT_CONFIG as CFG, getOtConfig } from './otConfig.js';

const work = { status: 'work', scheduledMinutes: 540 };

test('UAE 10h threshold: 9.5h is regular, 10.5h has 30m OT', () => {
  const uae = getOtConfig('CALO UAE'); // 600 min
  assert.equal(classifyDay({ workedMinutes: 570, incomplete: false }, work, uae).overtime, 0);
  const r = classifyDay({ workedMinutes: 630, incomplete: false }, work, uae);
  assert.equal(r.regular, 600);
  assert.equal(r.overtime, 30);
});

test('KSA 9h threshold: same 9.5h day is already 30m OT', () => {
  const ksa = getOtConfig('CALO RIYADH'); // 540 min
  const r = classifyDay({ workedMinutes: 570, incomplete: false }, work, ksa);
  assert.equal(r.regular, 540);
  assert.equal(r.overtime, 30);
});

test('worked beyond 9h splits into regular 540 + overtime', () => {
  const r = classifyDay({ workedMinutes: 630, incomplete: false }, work, CFG);
  assert.equal(r.type, 'present');
  assert.equal(r.regular, 540);
  assert.equal(r.overtime, 90);
});

test('worked under 9h is all regular, with undertime noted', () => {
  const r = classifyDay({ workedMinutes: 420, incomplete: false }, work, CFG);
  assert.equal(r.regular, 420);
  assert.equal(r.overtime, 0);
  assert.equal(r.undertime, 120);
});

test('scheduled workday with no punches is absent', () => {
  const r = classifyDay({ workedMinutes: 0, incomplete: false }, work, CFG);
  assert.equal(r.type, 'absent');
  assert.equal(r.flag, 'absent');
});

test('work on a confirmed day off is flagged for review, never auto-OT', () => {
  const r = classifyDay({ workedMinutes: 300, incomplete: false }, { status: 'off' }, CFG);
  assert.equal(r.type, 'review');
  assert.equal(r.overtime, 0);
  assert.equal(r.flag, 'worked_on_dayoff');
});

test('punching while on leave is a leave conflict', () => {
  const r = classifyDay({ workedMinutes: 200, incomplete: false }, { status: 'leave' }, CFG);
  assert.equal(r.flag, 'leave_conflict');
});

test('incomplete punches are flagged and not scored', () => {
  const r = classifyDay({ workedMinutes: 0, incomplete: true }, work, CFG);
  assert.equal(r.type, 'incomplete');
  assert.equal(r.flag, 'incomplete_punches');
});

test('sums a single in/out pair to worked minutes', () => {
  const r = pairPunches([
    { punchTime: '2026-03-01 06:00:00', state: 'in' },
    { punchTime: '2026-03-01 16:30:00', state: 'out' },
  ]);
  assert.equal(r.workedMinutes, 630);
  assert.equal(r.incomplete, false);
});

test('sums multiple pairs (split shift) and ignores order', () => {
  const r = pairPunches([
    { punchTime: '2026-03-01 13:00:00', state: 'out' },
    { punchTime: '2026-03-01 09:00:00', state: 'in' },
    { punchTime: '2026-03-01 14:00:00', state: 'in' },
    { punchTime: '2026-03-01 18:00:00', state: 'out' },
  ]);
  assert.equal(r.workedMinutes, 240 + 240);
  assert.equal(r.incomplete, false);
});

test('flags incomplete when a punch is dangling', () => {
  const r = pairPunches([{ punchTime: '2026-03-01 06:00:00', state: 'in' }]);
  assert.equal(r.incomplete, true);
});

test('flags incomplete on two ins in a row', () => {
  const r = pairPunches([
    { punchTime: '2026-03-01 06:00:00', state: 'in' },
    { punchTime: '2026-03-01 07:00:00', state: 'in' },
    { punchTime: '2026-03-01 16:00:00', state: 'out' },
  ]);
  assert.equal(r.incomplete, true);
});

import { computeEmployeePeriod } from './otEngine.js';

test('aggregates a period into totals', () => {
  const days = [
    { date: '2026-03-01', punches: [
      { punchTime: '2026-03-01 06:00:00', state: 'in' },
      { punchTime: '2026-03-01 16:30:00', state: 'out' }], schedule: work },   // 630 -> 540 reg + 90 OT
    { date: '2026-03-02', punches: [], schedule: work },                        // absent
    { date: '2026-03-03', punches: [], schedule: { status: 'off' } },           // off
  ];
  const r = computeEmployeePeriod(days, CFG);
  assert.equal(r.regularMinutes, 540);
  assert.equal(r.overtimeMinutes, 90);
  assert.equal(r.absentDays, 1);
  assert.equal(r.flags.length, 1); // the absence
});

import { bucketPunchesByShiftDay } from './otEngine.js';

test('overnight raw punches: in 20:00 → out 04:00 next day is ONE day on the start date', () => {
  const buckets = bucketPunchesByShiftDay([
    { punchTime: '2026-09-08 20:00:00', state: 'in' },
    { punchTime: '2026-09-09 04:00:00', state: 'out' },
  ]);
  assert.equal(buckets.size, 1);
  assert.deepEqual(buckets.get('2026-09-08'), { workedMinutes: 480, incomplete: false });
});

test('overnight raw punches feed the period as one worked day, not two incomplete days', () => {
  const buckets = bucketPunchesByShiftDay([
    { punchTime: '2026-09-08 20:00:00', state: 'in' },
    { punchTime: '2026-09-09 04:00:00', state: 'out' },
  ]);
  const days = ['2026-09-08', '2026-09-09'].map((date) => ({
    date,
    paired: buckets.get(date) || { workedMinutes: 0, incomplete: false },
    schedule: work,
  }));
  const r = computeEmployeePeriod(days, CFG);
  assert.equal(r.incompleteDays, 0);      // the old per-day slicing produced 2
  assert.equal(r.regularMinutes, 480);    // 8h scored once, on Sep 8
  assert.equal(r.absentDays, 1);          // Sep 9 has no shift of its OWN start
});

test('a session over 16h is a missed punch: both days flagged, nothing scored', () => {
  const buckets = bucketPunchesByShiftDay([
    { punchTime: '2026-09-08 20:00:00', state: 'in' },
    { punchTime: '2026-09-09 20:00:00', state: 'out' },  // 24h later
  ]);
  assert.equal(buckets.get('2026-09-08').incomplete, true);
  assert.equal(buckets.get('2026-09-09').incomplete, true);
  assert.equal(buckets.get('2026-09-08').workedMinutes, 0);
});

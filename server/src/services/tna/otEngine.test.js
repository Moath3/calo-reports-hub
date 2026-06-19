import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairPunches } from './otEngine.js';
import { classifyDay } from './otEngine.js';
import { DEFAULT_OT_CONFIG as CFG } from './otConfig.js';

const work = { status: 'work', scheduledMinutes: 540 };

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

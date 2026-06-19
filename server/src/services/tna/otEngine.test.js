import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairPunches } from './otEngine.js';

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

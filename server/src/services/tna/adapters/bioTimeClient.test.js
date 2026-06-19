import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPunchState, mapTransaction } from './bioTimeClient.js';

test('maps in/out punch states', () => {
  assert.equal(mapPunchState('0'), 'in');   // Check In
  assert.equal(mapPunchState('1'), 'out');  // Check Out
  assert.equal(mapPunchState('3'), 'in');   // Break In
  assert.equal(mapPunchState('2'), 'out');  // Break Out
  assert.equal(mapPunchState('9'), null);   // unknown
});

test('maps a raw BioTime transaction to the engine shape', () => {
  const t = mapTransaction({ emp_code: '101', punch_time: '2026-03-01 06:00:00', punch_state: '0' });
  assert.deepEqual(t, { empCode: '101', punchTime: '2026-03-01 06:00:00', state: 'in' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagAccuracy } from './accuracy.js';

test('punched but unmatched => ghost', () => {
  const flags = flagAccuracy({
    matched: [], unmatched: [{ empCode: '777', bio: { name: 'X' } }],
    punchedEmpCodes: new Set(['777']),
  });
  assert.ok(flags.some(f => f.flag === 'ghost_punch' && f.empCode === '777'));
});

test('rostered but unmatched => stale_roster', () => {
  const flags = flagAccuracy({
    matched: [], unmatched: [],
    rosterEmpIds: new Set(['888']), matchedEmpIds: new Set(),
  });
  assert.ok(flags.some(f => f.flag === 'stale_roster' && f.empId === '888'));
});

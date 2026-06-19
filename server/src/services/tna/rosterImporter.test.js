import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importRoster } from './rosterImporter.js';
import { gridNormalizer } from './normalizers/gridNormalizer.js';

// aoa = array-of-arrays as SheetJS sheet_to_json({header:1}) returns.
// Row 0 header: empId, name, then day numbers. Cells: shift code.
const aoa = [
  ['Employee ID', 'Name', '2026-03-01', '2026-03-02', '2026-03-03'],
  ['101', 'Moath', '9', 'OFF', '9'],
  ['', 'Ghost', '9', '9', '9'],            // missing id -> error row
];

test('grid normalizer expands to canonical per-day rows', () => {
  const { roster, errors } = importRoster(aoa, gridNormalizer);
  const moath = roster.filter(r => r.empId === '101');
  assert.equal(moath.length, 3);
  assert.deepEqual(moath.map(r => r.status), ['work', 'off', 'work']);
  assert.equal(moath[0].scheduledMinutes, 540);
  assert.equal(errors.length, 1);            // the missing-id row
  assert.match(errors[0].message, /Employee ID/i);
});

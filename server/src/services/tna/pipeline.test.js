import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTnaPeriod } from './pipeline.js';
import { gridNormalizer } from './normalizers/gridNormalizer.js';
import { sample } from './__fixtures__/sample.js';

test('end-to-end: one matched employee, OT + off-day', () => {
  const out = runTnaPeriod({ ...sample, normalizer: gridNormalizer });
  assert.equal(out.summaries.length, 1);
  const s = out.summaries[0];
  assert.equal(s.empCode, '101');
  assert.equal(s.regularMinutes, 1080); // 540 + 540
  assert.equal(s.overtimeMinutes, 90);  // from Mar 1
  assert.equal(out.unmatched.length, 0);
});

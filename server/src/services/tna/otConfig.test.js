import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOtConfig, DEFAULT_OT_CONFIG } from './otConfig.js';

test('default config is a 9-hour (540 min) standard day', () => {
  assert.equal(DEFAULT_OT_CONFIG.standardDailyMinutes, 540);
});

test('getOtConfig returns the default for an unknown entity', () => {
  assert.equal(getOtConfig('Anything').standardDailyMinutes, 540);
});

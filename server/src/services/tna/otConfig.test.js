import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOtConfig, DEFAULT_OT_CONFIG } from './otConfig.js';

test('default config is a 9-hour (540 min) standard day', () => {
  assert.equal(DEFAULT_OT_CONFIG.standardDailyMinutes, 540);
});

test('getOtConfig returns the default for an unknown entity', () => {
  assert.equal(getOtConfig('Anything').standardDailyMinutes, 540);
  assert.equal(getOtConfig('Anything').country, null);
});

// TEMPORARY flat 9h rule (2026-10-06): UAE is 9h like the rest for now. Country
// resolution is still exercised so the per-country rule can be restored later.
test('UAE is a 9-hour (540 min) standard day (flat rule for now)', () => {
  assert.equal(getOtConfig('CALO UAE').standardDailyMinutes, 540);
  assert.equal(getOtConfig('CALO UAE').country, 'UAE');
  assert.equal(getOtConfig('CALO UAE - Dispatch').standardDailyMinutes, 540);
});

test('KSA, Kuwait and Bahrain are 9-hour (540 min) days', () => {
  assert.equal(getOtConfig('CALO RIYADH - Kitchen').standardDailyMinutes, 540);
  assert.equal(getOtConfig('CALO RIYADH - Kitchen').country, 'KSA');
  assert.equal(getOtConfig('Kuwait').standardDailyMinutes, 540);
  assert.equal(getOtConfig('Kuwait').country, 'KWT');
  assert.equal(getOtConfig('CALO Bahrain').standardDailyMinutes, 540);
  assert.equal(getOtConfig('CALO Bahrain').country, 'BHR');
});

test('a bare country code resolves too (all 9h for now)', () => {
  assert.equal(getOtConfig('UAE').standardDailyMinutes, 540);
  assert.equal(getOtConfig('KSA').standardDailyMinutes, 540);
});

test('UAE emirates still resolve to the UAE country code', () => {
  for (const x of ['Al Ain Hub', 'RAK Kitchen', 'Fujairah', 'CALO AUH']) {
    assert.equal(getOtConfig(x).country, 'UAE', x);
    assert.equal(getOtConfig(x).standardDailyMinutes, 540, x);
  }
});

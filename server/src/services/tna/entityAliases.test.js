import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEntity, sameEntity, resolveCountry } from './entityAliases.js';

test('maps known aliases to one canonical entity', () => {
  assert.equal(canonicalEntity('MP KSA'), canonicalEntity('Luqmat'));
});
test('sameEntity is alias-aware', () => {
  assert.ok(sameEntity('Basecamp KSA', 'Luqmat'));
  assert.ok(!sameEntity('Luqmat', 'MARS Egypt'));
});

test('resolveCountry maps departments/entities/locations to country codes', () => {
  assert.equal(resolveCountry('CALO UAE'), 'UAE');
  assert.equal(resolveCountry('CALO UAE - Dispatch'), 'UAE');
  assert.equal(resolveCountry('Dubai'), 'UAE');
  assert.equal(resolveCountry('CALO RIYADH - Kitchen'), 'KSA');
  assert.equal(resolveCountry('Jeddah Dispatch'), 'KSA');
  assert.equal(resolveCountry('Luqmat'), 'KSA');
  assert.equal(resolveCountry('Kuwait City'), 'KWT');
  assert.equal(resolveCountry('CALO Bahrain'), 'BHR');
  assert.equal(resolveCountry('Manama'), 'BHR');
});
test('resolveCountry returns null when no country is recognized', () => {
  assert.equal(resolveCountry(''), null);
  assert.equal(resolveCountry(null), null);
  assert.equal(resolveCountry('MARS Egypt'), null);
});

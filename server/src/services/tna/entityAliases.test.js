import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEntity, sameEntity } from './entityAliases.js';

test('maps known aliases to one canonical entity', () => {
  assert.equal(canonicalEntity('MP KSA'), canonicalEntity('Luqmat'));
});
test('sameEntity is alias-aware', () => {
  assert.ok(sameEntity('Basecamp KSA', 'Luqmat'));
  assert.ok(!sameEntity('Luqmat', 'MARS Egypt'));
});

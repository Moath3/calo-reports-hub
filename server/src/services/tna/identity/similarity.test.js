import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diceCoefficient } from './similarity.js';

test('identical strings score 1', () => {
  assert.equal(diceCoefficient('moath', 'moath'), 1);
});
test('near-identical names score high', () => {
  assert.ok(diceCoefficient('mohammed ali', 'mohamed ali') > 0.8);
});
test('different names score low', () => {
  assert.ok(diceCoefficient('moath alghoniman', 'sara hassan') < 0.3);
});

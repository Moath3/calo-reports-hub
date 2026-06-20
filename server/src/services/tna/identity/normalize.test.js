import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeId, normalizeName } from './normalize.js';

test('normalizeId strips leading zeros for numeric ids, spaces, case', () => {
  assert.equal(normalizeId(' 00123 '), '123');
  assert.equal(normalizeId('a07'), 'A07');         // alphanumeric: stem + padding preserved
  assert.equal(normalizeId('FTE0001'), 'FTE0001');
});
test('normalizeId keeps distinct alphanumeric ids distinct (no false collisions)', () => {
  assert.notEqual(normalizeId('FTE0001'), normalizeId('FTE1'));
  assert.notEqual(normalizeId('A07'), normalizeId('A7'));
});

test('normalizeName lowercases, strips punctuation/diacritics, token-sorts', () => {
  assert.equal(normalizeName('Al-Ghoniman,  Moath'), 'alghoniman moath');
  assert.equal(normalizeName('Moath  Alghoniman'), 'alghoniman moath');
});

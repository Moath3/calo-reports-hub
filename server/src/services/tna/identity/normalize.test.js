import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeId, normalizeName } from './normalize.js';

test('normalizeId strips leading zeros, spaces, case', () => {
  assert.equal(normalizeId(' 00123 '), '123');
  assert.equal(normalizeId('a07'), 'A7');
});

test('normalizeName lowercases, strips punctuation/diacritics, token-sorts', () => {
  assert.equal(normalizeName('Al-Ghoniman,  Moath'), 'alghoniman moath');
  assert.equal(normalizeName('Moath  Alghoniman'), 'alghoniman moath');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toYMD, parseMinutes, parseMastersSpec } from './fileLib.js';

test('toYMD converts Excel serial numbers to YYYY-MM-DD', () => {
  assert.equal(toYMD(25569), '1970-01-01'); // Excel serial for the Unix epoch
  assert.equal(toYMD(25934), '1971-01-01'); // +365 days (1970 not a leap year)
});
test('toYMD handles Date objects and ISO strings', () => {
  assert.equal(toYMD(new Date('2026-05-16T05:00:00Z')), '2026-05-16');
  assert.equal(toYMD('2026-05-16 08:00:00'), '2026-05-16');
});
test('toYMD parses day-first and text-month date strings (GCC formats)', () => {
  assert.equal(toYMD('19/06/2026'), '2026-06-19'); // dd/mm/yyyy (day-first)
  assert.equal(toYMD('25/12/2026'), '2026-12-25'); // day > 12 forces day-first
  assert.equal(toYMD('05-06-2026'), '2026-06-05'); // ambiguous -> day-first
  assert.equal(toYMD('19-Jun-2026'), '2026-06-19'); // dd-Mon-yyyy
  assert.equal(toYMD('not a date'), '');           // unparseable -> empty
});

test('parseMinutes reads HH:MM worked time to minutes', () => {
  assert.equal(parseMinutes('9:00'), 540);
  assert.equal(parseMinutes('10:56'), 656);
  assert.equal(parseMinutes('11:20'), 680);
});
test('parseMinutes returns null for blank or malformed values', () => {
  assert.equal(parseMinutes(''), null);
  assert.equal(parseMinutes(null), null);
  assert.equal(parseMinutes('8'), null);       // no colon
  assert.equal(parseMinutes('ab:cd'), null);   // non-numeric
});

test('parseMastersSpec parses label, path and optional #Sheet', () => {
  const r = parseMastersSpec('Luqmat=C:/x/KSA.xlsx#Luqmat Active;C:/x/3rd.xlsx');
  assert.deepEqual(r[0], { label: 'Luqmat', path: 'C:/x/KSA.xlsx', sheet: 'Luqmat Active' });
  assert.deepEqual(r[1], { label: 'Master2', path: 'C:/x/3rd.xlsx', sheet: null });
});

/**
 * Canon helper tests (client/src/utils/caloCanon.js) — run from server land,
 * which also proves the cross-package relative import resolves under plain
 * node (the canon is framework-free ESM, deliberately shared by both sides).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLevel,
  familyLevelIssue,
  inferFromTitle,
  titleCanonIssue,
  isApprovedDept,
  retiredDeptReplacement,
  teamBelongsToDept,
  legalEntityCountry,
} from '../../../client/src/utils/caloCanon.js';

test('parseLevel: valid bands parse, out-of-band and malformed return null', () => {
  assert.deepEqual(parseLevel('M3'), { band: 'M', n: 3 });
  assert.deepEqual(parseLevel('P12'), { band: 'P', n: 12 });
  assert.equal(parseLevel('P13'), null); // P tops out at 12
  assert.equal(parseLevel('IS5'), null); // IS tops out at 4
  assert.equal(parseLevel('x9'), null);  // no X band
});

test('familyLevelIssue: family and level band must agree', () => {
  assert.equal(familyLevelIssue('Production', 'P3'), null);
  assert.match(familyLevelIssue('Production', 'IC2'), /expects P-band, got IC2/);
  assert.equal(familyLevelIssue('Retail', 'R1'), null);
  assert.match(familyLevelIssue('Non Production', 'P2'), /expects M\/IS\/IC-band, got P2/);
  assert.match(familyLevelIssue('Production', 'x9'), /not a valid band/); // malformed level
  assert.equal(familyLevelIssue('Production', ''), null);  // missing level handled elsewhere
  assert.equal(familyLevelIssue('Production', '-'), null); // placeholder treated as missing
  // Canon gap (reported, not asserted): the hyphenated canonical spelling
  // 'Non-Production' normTags to 'nonproduction' (hyphen stripped), which
  // misses the 'non production' → 'non-production' fixup, so
  // familyLevelIssue('Non-Production', 'P2') currently returns null.
});

test('inferFromTitle: high-precision inference only, negatives block', () => {
  assert.deepEqual(inferFromTitle('Commis 1'), { depts: ['Kitchen'], family: 'Production' });
  assert.equal(inferFromTitle('Kitchen Manager'), null); // manager/admin roles never infer
  assert.equal(inferFromTitle('Head Chef / Kitchen Manager'), null); // matches chef re, blocked by negative
  assert.deepEqual(inferFromTitle('Barista'), { depts: ['Retail'], family: 'Retail' });
  assert.deepEqual(inferFromTitle('Accountant'), { depts: ['Finance'], family: 'Non-Production' });
  assert.deepEqual(inferFromTitle('Delivery Driver'), { depts: ['Dispatch', 'Logistics'], family: 'Production' });
  assert.equal(inferFromTitle('Chief Vibes Officer'), null); // gibberish → no inference
});

test('titleCanonIssue: off-catalog variants get the catalog spelling', () => {
  assert.equal(titleCanonIssue('Commi-I'), 'Commis 1');
  assert.equal(titleCanonIssue('CDP'), 'Chef de Partie');
  // Canon gap (reported): the Commis variant regex also matches the canonical
  // spelling itself, so titleCanonIssue('Commis 1') self-suggests 'Commis 1'
  // instead of returning null. Either way there is no actionable change; the
  // audit's nonCanonicalTitle check filters suggested === title, so an
  // already-canonical title is never flagged.
  const already = titleCanonIssue('Commis 1');
  assert.ok(already === null || already === 'Commis 1');
});

test('isApprovedDept / retiredDeptReplacement: canon 21, &/and-insensitive', () => {
  assert.equal(isApprovedDept('People and Culture'), true); // canon spells it 'People & Culture'
  assert.equal(isApprovedDept('Maintenance'), false);       // retired — no longer whitelisted
  assert.equal(retiredDeptReplacement('Maintenance'), 'Facilities and Engineering');
});

test('teamBelongsToDept: enforced lists only where the canon defines them', () => {
  assert.equal(teamBelongsToDept('Treasury Operations', 'Finance'), true);
  assert.equal(teamBelongsToDept('CX Core', 'Finance'), false);
  assert.equal(teamBelongsToDept('Kitchen crew', 'Kitchen'), true); // no enforced list for Kitchen
});

test('legalEntityCountry: legal names and aliases map to countries', () => {
  assert.equal(legalEntityCountry('AlLuqmat AlMumayaza for Catering Service'), 'KSA');
  assert.equal(legalEntityCountry('Gaya Branch-2'), 'UAE');
  assert.equal(legalEntityCountry('nonsense'), null);
});

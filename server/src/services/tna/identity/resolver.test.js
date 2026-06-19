import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentities } from './resolver.js';

const bio = [{ empCode: '101', name: 'Moath Alghoniman', entity: 'MP KSA' }];

test('exact id + matching name => matched', () => {
  const r = resolveIdentities({
    bioEmployees: bio,
    masterfile: [{ empId: '00101', name: 'Alghoniman Moath', entity: 'Luqmat' }],
    zelt: [{ empId: '101', name: 'Moath Alghoniman', entity: 'Luqmat' }],
  });
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].empCode, '101');
});

test('same id but very different name => review (possible id reuse)', () => {
  const r = resolveIdentities({
    bioEmployees: bio,
    masterfile: [{ empId: '101', name: 'Sara Hassan', entity: 'Luqmat' }],
    zelt: [],
  });
  assert.equal(r.matched.length, 0);
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].reason, 'id_name_mismatch');
});

test('no id match but strong name+entity => review (proposed), never auto-merged', () => {
  const r = resolveIdentities({
    bioEmployees: bio,
    masterfile: [{ empId: '999', name: 'Moath Alghoniman', entity: 'Luqmat' }],
    zelt: [],
  });
  assert.equal(r.matched.length, 0);
  assert.equal(r.review[0].reason, 'name_only_match');
});

test('no id and no name match => unmatched', () => {
  const r = resolveIdentities({ bioEmployees: bio, masterfile: [], zelt: [] });
  assert.equal(r.unmatched.length, 1);
});

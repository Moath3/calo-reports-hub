import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDepartmentsFromUsers, deriveEntitiesForDepartments, summarizeCompExpiry } from './zeltCompute.js';

test('deriveDepartmentsFromUsers: active users only, deduped, sorted', () => {
  const users = [
    { accountStatus: 'Active', role: { department: { name: 'Kitchen' } } },
    { accountStatus: 'Active', role: { department: { name: 'Dispatch' } } },
    { accountStatus: 'Active', role: { department: { name: 'Kitchen' } } },          // dup
    { accountStatus: 'Active', department: { name: ' Finance ' } },                   // alt path + trim
    { accountStatus: 'Terminated', role: { department: { name: 'GhostDept' } } },     // terminated -> excluded
    { accountStatus: 'Active', userEvent: { status: 'Resigned' }, role: { department: { name: 'LeaverDept' } } }, // resigned -> excluded
    { accountStatus: 'Active', leaveDate: '2026-01-01', role: { department: { name: 'LeavingDept' } } },          // leaveDate -> excluded
    { accountStatus: 'Active' },                                                       // no dept -> ignored
  ];
  assert.deepEqual(deriveDepartmentsFromUsers(users), ['Dispatch', 'Finance', 'Kitchen']);
});

test('deriveDepartmentsFromUsers: tolerates empty/garbage input', () => {
  assert.deepEqual(deriveDepartmentsFromUsers([]), []);
  assert.deepEqual(deriveDepartmentsFromUsers(null), []);
  assert.deepEqual(deriveDepartmentsFromUsers([{}, { role: {} }, { department: 42 }]), []);
});

test('deriveEntitiesForDepartments: only entities whose ACTIVE staff hold the departments', () => {
  const users = [
    { accountStatus: 'Active', role: { department: { name: 'Kitchen' } }, userContract: { entity: { legalName: 'Luqmat' } } },
    { accountStatus: 'Active', role: { department: { name: 'Kitchen' } }, userContract: { entity: { legalName: 'MP UAE' } } },
    { accountStatus: 'Active', role: { department: { name: 'Finance' } }, userContract: { entity: { legalName: 'Vresto UK' } } },   // other dept
    { accountStatus: 'Terminated', role: { department: { name: 'Kitchen' } }, userContract: { entity: { legalName: 'Fakihi' } } }, // terminated
  ];
  assert.deepEqual(deriveEntitiesForDepartments(users, ['kitchen']), ['Luqmat', 'MP UAE']); // case-insensitive match
  assert.deepEqual(deriveEntitiesForDepartments(users, []), []);
  assert.deepEqual(deriveEntitiesForDepartments(null, ['Kitchen']), []);
});

test('summarizeCompExpiry: counts, totals and production/non-production split', () => {
  const holders = [
    { isProduction: true,  compensatory: 12, compExpiringDays: 2, compExpiredDays: 0 },
    { isProduction: true,  compensatory: 5,  compExpiringDays: 0, compExpiredDays: 0 },
    { isProduction: false, compensatory: 11, compExpiringDays: 3, compExpiredDays: 1 },
    { isProduction: false, compensatory: 4,  compExpiringDays: 0, compExpiredDays: 0 },
  ];
  const s = summarizeCompExpiry(holders);
  assert.equal(s.all.holders, 4);
  assert.equal(s.all.highComp, 2);              // 12 and 11 are >= 10
  assert.equal(s.all.totalDays, 32);            // 12 + 5 + 11 + 4
  assert.equal(s.all.expiringEmployees, 2);
  assert.equal(s.all.expiringDays, 5);          // 2 + 3
  assert.equal(s.all.expiredEmployees, 1);
  assert.equal(s.all.expiredDays, 1);
  // Split
  assert.equal(s.production.holders, 2);
  assert.equal(s.production.expiringDays, 2);
  assert.equal(s.production.expiredDays, 0);
  assert.equal(s.nonProduction.holders, 2);
  assert.equal(s.nonProduction.expiringDays, 3);
  assert.equal(s.nonProduction.expiredDays, 1);
  // Window carries the 3 vs 9 month rule
  assert.deepEqual(s.window, { expiringSoonDays: 45, prodMonths: 9, nonProdMonths: 3 });
});

test('summarizeCompExpiry: empty input is all zeros, never throws', () => {
  const s = summarizeCompExpiry([]);
  assert.equal(s.all.holders, 0);
  assert.equal(s.all.totalDays, 0);
  assert.equal(s.all.expiringEmployees, 0);
  assert.equal(summarizeCompExpiry(null).all.holders, 0);
});

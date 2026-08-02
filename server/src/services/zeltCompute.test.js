import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDepartmentsFromUsers, deriveEntitiesForDepartments } from './zeltCompute.js';

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

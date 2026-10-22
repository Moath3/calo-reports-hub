// Run: node --test client/src/utils/sheetFieldMatcher.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchHeaders, COMPLIANCE_FIELDS } from './sheetFieldMatcher.js';

test('resolves messy real-world headers to the right columns', () => {
  const headers = ['Emp ID', 'Employee Name', 'Nationality', 'IQAMA Expiry Date', 'Passport Exp.', 'Work Permit Expiry', 'Sponsor Name', 'Visa Expiry', 'Emirates ID Expiry', 'Basic Salary'];
  const m = matchHeaders(headers, COMPLIANCE_FIELDS);
  assert.equal(m.employeeId.header, 'Emp ID');
  assert.equal(m.iqamaExpiry.header, 'IQAMA Expiry Date');
  assert.equal(m.passportExpiry.header, 'Passport Exp.');
  assert.equal(m.permitExpiry.header, 'Work Permit Expiry');
  assert.equal(m.agency.header, 'Sponsor Name');
  assert.equal(m.eidExpiry.header, 'Emirates ID Expiry');
});

test('a field with no column stays null (below threshold)', () => {
  const m = matchHeaders(['Name', 'Department', 'Grade'], COMPLIANCE_FIELDS);
  assert.equal(m.iqamaExpiry, null);
  assert.equal(m.visaExpiry, null);
  assert.ok(m.name);
});

test('each column is claimed once; strongest match wins a contested column', () => {
  // "Expiry" alone is ambiguous; a precise header must win it over a vague field.
  const headers = ['Iqama Expiry', 'Visa Expiry'];
  const m = matchHeaders(headers, COMPLIANCE_FIELDS);
  assert.equal(m.iqamaExpiry.index, 0);
  assert.equal(m.visaExpiry.index, 1);
  assert.notEqual(m.iqamaExpiry.index, m.visaExpiry.index);
});

test('custom field with synonyms matches', () => {
  const headers = ['Staff', 'Contract End Date'];
  const m = matchHeaders(headers, [{ key: 'contractEnd', label: 'Contract End', synonyms: ['contract end date', 'contract expiry'] }]);
  assert.equal(m.contractEnd.header, 'Contract End Date');
});

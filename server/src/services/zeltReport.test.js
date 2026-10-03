import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test, ALL_FIELDS, SENSITIVE_FIELDS } from './zeltReport.js';

const { ageFromDob, lengthOfServiceYears, matchesFilter, normTag, buildAggregates } = __test;

test('matchesFilter: empty filter matches everything; case/punctuation-insensitive', () => {
  assert.equal(matchesFilter('Retail', []), true);
  assert.equal(matchesFilter('Retail', null), true);
  assert.equal(matchesFilter('Calo Now', ['calo now']), true);
  assert.equal(matchesFilter('Calo-Now', ['Calo Now']), true);      // punctuation
  assert.equal(matchesFilter('Shared & Services', ['shared and services']), true); // & -> and
  assert.equal(matchesFilter('Retail', ['Calo Now', 'Retail']), true);
  assert.equal(matchesFilter('Subscription', ['Retail', 'Calo Now']), false);
  assert.equal(matchesFilter(null, ['Retail']), false);
});

test('ageFromDob computes whole years and rejects garbage', () => {
  const y = new Date().getFullYear();
  assert.equal(ageFromDob(`${y - 30}-01-01`), 30);
  assert.equal(ageFromDob(null), null);
  assert.equal(ageFromDob('not-a-date'), null);
  assert.equal(ageFromDob(`${y + 5}-01-01`), null); // future DOB rejected
});

test('lengthOfServiceYears is non-negative and one-decimal', () => {
  const twoYrsAgo = new Date(Date.now() - 2 * 365.25 * 86400000).toISOString();
  const los = lengthOfServiceYears(twoYrsAgo);
  assert.ok(los >= 1.9 && los <= 2.1, `got ${los}`);
  assert.equal(lengthOfServiceYears(null), null);
});

test('salary aggregates are totals/averages by currency — never per-person rows', () => {
  // Values chosen so no group total/avg coincides with any individual salary.
  const rows = [
    { businessLine: 'Retail', department: 'Dispatch', entity: 'Retail Dubai', org: 'MP UAE', salaryMonthly: 5000, currency: 'AED' },
    { businessLine: 'Retail', department: 'Dispatch', entity: 'Retail Dubai', org: 'MP UAE', salaryMonthly: 5500, currency: 'AED' },
    { businessLine: 'Calo Now', department: 'Kitchen', entity: 'Mountain Peak KSA', org: 'MP KSA', salaryMonthly: 3200, currency: 'SAR' },
    { businessLine: 'Calo Now', department: 'Kitchen', entity: 'Mountain Peak KSA', org: 'MP KSA', salaryMonthly: 3600, currency: 'SAR' },
  ];
  const agg = buildAggregates(rows, ['salaryMonthly', 'currency'], true);
  assert.equal(agg.headcount, 4);
  assert.equal(agg.byBusinessLine.find(b => b.key === 'Retail').count, 2);
  const aed = agg.salary.find(s => s.currency === 'AED');
  assert.equal(aed.employees, 2);
  assert.equal(aed.totalMonthly, 10500);
  assert.equal(aed.avgMonthly, 5250);
  // aggregates carry NO names/ids/individual salaries
  const blob = JSON.stringify(agg);
  assert.ok(!/5000|5500|3200|3600|employeeId|"name"/.test(blob), 'aggregate leaked a per-person figure');
});

test('non-admins never get salary aggregates even if salary fields requested', () => {
  const rows = [{ businessLine: 'Retail', salaryMonthly: 5000, currency: 'AED' }];
  const agg = buildAggregates(rows, ['salaryMonthly'], false);
  assert.equal(agg.salary, undefined);
  assert.equal(agg.headcount, 1);
});

test('field catalogue: every sensitive field is a known field', () => {
  for (const f of SENSITIVE_FIELDS) assert.ok(ALL_FIELDS.includes(f), `${f} missing from ALL_FIELDS`);
});

test('normTag normalizes case, ampersand and punctuation', () => {
  assert.equal(normTag('Calo Now'), 'calo now');
  assert.equal(normTag('R&D / Ops'), 'r and d ops');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMobilityFromUsers } from './zeltMobility.js';

// Frozen reference point → trailing window is 2025-07 .. 2026-06.
const NOW = new Date('2026-06-15T12:00:00Z');

// Raw Zelt-shaped fixtures — exercise the same field paths the live data uses
// (top-level, lifecycle.*, userContract vs contract entity, role.department).
function fixtureUsers() {
  return [
    // Mid-year joiner, currently active
    {
      userId: 'u1', displayName: 'Joiner Jane', employeeId: 'E001',
      accountStatus: 'Active', startDate: '2026-02-10',
      userContract: { entity: { legalName: 'Mountain Peak KSA' } },
      role: { department: { name: 'Kitchen' }, jobPosition: { title: 'Line Cook' } },
    },
    // Resigned leaver with both dates (voluntary, ~200 days tenure)
    {
      userId: 'u2', displayName: 'Resigned Rania', employeeId: 'E002',
      accountStatus: 'Deactivated', startDate: '2025-09-01', leaveDate: '2026-03-20',
      userEvent: { status: 'Resigned' },
      userContract: { entity: { legalName: 'Mountain Peak KSA' } },
      role: { department: { name: 'Kitchen' } },
    },
    // Terminated leaver with both dates (involuntary, 64 days tenure → early)
    {
      userId: 'u3', displayName: 'Terminated Tarek', employeeId: 'E003',
      accountStatus: 'Active', startDate: '2026-01-05', leaveDate: '2026-03-10',
      userEvent: { status: 'Terminated' },
      userContract: { entity: { legalName: 'Basecamp KSA' } },
      role: { department: { name: 'Dispatch' } },
    },
    // Leaver by status with NO leaveDate → excluded from the series, coverage only
    {
      userId: 'u4', displayName: 'Ghost Gone', employeeId: 'E004',
      accountStatus: 'Deactivated', startDate: '2024-01-01',
      userContract: { entity: { legalName: 'Mountain Peak KSA' } },
    },
    // Active with NO startDate → excluded from headcount, coverage only
    {
      userId: 'u5', displayName: 'No Start Nadia', employeeId: 'E005',
      accountStatus: 'Active',
      userContract: { entity: { legalName: 'Basecamp KSA' } },
      role: { department: { name: 'People and Culture' } },
    },
    // Long-tenured actives
    {
      userId: 'u6', displayName: 'Veteran Vik', employeeId: 'E006',
      accountStatus: 'Active', startDate: '2020-05-01',
      userContract: { entity: { legalName: 'Mountain Peak KSA' } },
      role: { department: { name: 'Kitchen' } },
    },
    // Nested paths: lifecycle.startDate + contract.entity
    {
      userId: 'u7', displayName: 'Nested Noor', employeeId: 'E007',
      accountStatus: 'Active', lifecycle: { startDate: '2023-03-15' },
      contract: { entity: { legalName: 'Basecamp KSA' } },
      role: { department: { name: 'Dispatch' } },
    },
    {
      userId: 'u8', displayName: 'Old Omar', employeeId: 'E008',
      accountStatus: 'Active', startDate: '2019-01-01',
      userContract: { entity: { legalName: 'Mountain Peak KSA' } },
      role: { department: { name: 'Kitchen' } },
    },
    // Duplicate row for u6 (same userId) — must be deduped away
    {
      userId: 'u6', displayName: 'Veteran Vik', employeeId: 'E006',
      accountStatus: 'Active', startDate: '2020-05-01',
      userContract: { entity: { legalName: 'Mountain Peak KSA' } },
    },
  ];
}

test('months: trailing 12 calendar months ending the current month', () => {
  const { months } = computeMobilityFromUsers(fixtureUsers(), NOW);
  assert.equal(months.length, 12);
  assert.equal(months[0].month, '2025-07');
  assert.equal(months[11].month, '2026-06');
});

test('known months: joiners and leavers land in the right buckets', () => {
  const { months } = computeMobilityFromUsers(fixtureUsers(), NOW);
  const feb = months.find(x => x.month === '2026-02');
  assert.equal(feb.joiners, 1);   // Joiner Jane
  assert.equal(feb.leavers, 0);

  const mar = months.find(x => x.month === '2026-03');
  assert.equal(mar.joiners, 0);
  assert.equal(mar.leavers, 2);   // Rania + Tarek
  assert.equal(mar.voluntary, 1);
  assert.equal(mar.involuntary, 1);
  // Start-of-March headcount 6, end 4 → avg 5 → 2/5 = 40%
  assert.equal(mar.headcount, 4);
  assert.equal(mar.turnoverPct, 40);
  assert.equal(mar.annualizedPct, 480);
});

test('totals across the trailing window', () => {
  const { totals, months } = computeMobilityFromUsers(fixtureUsers(), NOW);
  assert.equal(totals.headcountNow, 4);   // u1, u6, u7, u8
  assert.equal(totals.joiners12m, 3);     // u2 (Sep), u3 (Jan), u1 (Feb)
  assert.equal(totals.leavers12m, 2);
  assert.equal(totals.voluntary12m, 1);
  assert.equal(totals.involuntary12m, 1);
  // 2 leavers ÷ avg monthly headcount (49/12) × 100 = 48.98 → 49 at 1dp
  const avg = months.reduce((s, x) => s + x.headcount, 0) / months.length;
  assert.equal(totals.annualizedTurnoverPct, Math.round((2 / avg) * 1000) / 10);
  assert.equal(totals.annualizedTurnoverPct, 49);
});

test('early attrition: 1 of 2 dated leavers left inside 90 days', () => {
  const { totals } = computeMobilityFromUsers(fixtureUsers(), NOW);
  assert.equal(totals.earlyAttritionPct, 50); // Tarek 64d yes, Rania 200d no
});

test('tenure buckets of current actives', () => {
  const { tenure } = computeMobilityFromUsers(fixtureUsers(), NOW);
  assert.deepEqual(tenure, [
    { bucket: '<3m', count: 0 },
    { bucket: '3–12m', count: 1 },  // Jane, ~4 months
    { bucket: '1–2y', count: 0 },
    { bucket: '2–5y', count: 1 },   // Noor, ~3.25y
    { bucket: '5y+', count: 2 },    // Vik + Omar
  ]);
});

test('coverage: undated leaver and startless active are surfaced, not hidden', () => {
  const { coverage, totals } = computeMobilityFromUsers(fixtureUsers(), NOW);
  assert.equal(coverage.totalUsers, 8);      // 9 rows deduped to 8
  assert.equal(coverage.leaversNoDate, 1);   // Ghost Gone
  assert.equal(coverage.activesNoStart, 1);  // No Start Nadia
  // Nadia is active but has no startDate → not in headcountNow (4, not 5)
  assert.equal(totals.headcountNow, 4);
});

test('leaver list: trailing 12m, newest exit first, tenure + reason attached', () => {
  const { leavers } = computeMobilityFromUsers(fixtureUsers(), NOW);
  assert.equal(leavers.length, 2);
  assert.equal(leavers[0].name, 'Resigned Rania');
  assert.equal(leavers[0].leaveDate, '2026-03-20');
  assert.equal(leavers[0].reason, 'voluntary');
  assert.equal(leavers[0].tenureMonths, 6.6);
  assert.equal(leavers[1].name, 'Terminated Tarek');
  assert.equal(leavers[1].reason, 'involuntary');
  assert.equal(leavers[1].tenureMonths, 2.1);
});

test('byEntity: grouped, sorted by headcount desc', () => {
  const { byEntity } = computeMobilityFromUsers(fixtureUsers(), NOW);
  assert.equal(byEntity[0].key, 'Mountain Peak KSA');
  assert.equal(byEntity[0].headcount, 3);    // Jane, Vik, Omar
  assert.equal(byEntity[0].joiners12m, 2);   // Rania, Jane
  assert.equal(byEntity[0].leavers12m, 1);   // Rania
  const bc = byEntity.find(x => x.key === 'Basecamp KSA');
  assert.equal(bc.headcount, 1);             // Noor (Nadia has no startDate)
  assert.equal(bc.leavers12m, 1);            // Tarek
  assert.equal(bc.turnoverPct, 100);
});

test('user missing startDate never appears in the monthly headcount series', () => {
  const withNadia = computeMobilityFromUsers(fixtureUsers(), NOW);
  const withoutNadia = computeMobilityFromUsers(
    fixtureUsers().filter(u => u.userId !== 'u5'), NOW
  );
  assert.deepEqual(
    withNadia.months.map(m => m.headcount),
    withoutNadia.months.map(m => m.headcount)
  );
  assert.equal(withoutNadia.coverage.activesNoStart, 0);
});

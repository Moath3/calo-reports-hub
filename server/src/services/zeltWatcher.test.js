import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots, buildAggregates, SEVERITY, OWNERS } from './zeltWatcher.js';
import { generateHygieneDigest } from './aiService.js';

// ---- diffSnapshots (pure) ----------------------------------------------

const PREV_CHECKS = {
  missingEmployeeId: [
    { userId: 'u1', name: 'Alice Amber', status: 'Active' },
    { userId: 'u2', name: 'Bob Breeze', status: 'Active' },
  ],
  placeholderEmails: [
    { userId: 'u3', name: 'Cara Cliff', email: 'cara@dummy.com' },
  ],
  // Inventory list — must never produce flags or deltas
  departmentList: [{ department: 'Kitchen', activeUsers: 100 }],
};

const CURR_CHECKS = {
  missingEmployeeId: [
    { userId: 'u1', name: 'Alice Amber', status: 'Active' },
  ],
  placeholderEmails: [
    { userId: 'u3', name: 'Cara Cliff', email: 'cara@dummy.com' },
    { userId: 'u4', name: 'Dan Dune', email: 'tbu@calo.app', entity: 'Mountain Peak KSA' },
  ],
  departmentList: [{ department: 'Kitchen', activeUsers: 90 }],
};

test('diffSnapshots: a new flag appears with check, severity and owner attached', () => {
  const { newFlags } = diffSnapshots(PREV_CHECKS, CURR_CHECKS);
  assert.equal(newFlags.length, 1);
  assert.equal(newFlags[0].check, 'placeholderEmails');
  assert.equal(newFlags[0].userId, 'u4');
  assert.equal(newFlags[0].name, 'Dan Dune');
  assert.equal(newFlags[0].entity, 'Mountain Peak KSA');
  assert.equal(newFlags[0].severity, 'high');
  assert.equal(newFlags[0].owner, 'P&C Ops (Moath)');
});

test('diffSnapshots: a fixed record shows up as resolved', () => {
  const { resolved } = diffSnapshots(PREV_CHECKS, CURR_CHECKS);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].check, 'missingEmployeeId');
  assert.equal(resolved[0].userId, 'u2');
});

test('diffSnapshots: deltas only where counts changed, inventory lists ignored', () => {
  const { deltas } = diffSnapshots(PREV_CHECKS, CURR_CHECKS);
  assert.equal(deltas.length, 2);
  const missing = deltas.find(d => d.check === 'missingEmployeeId');
  assert.deepEqual(
    { before: missing.before, after: missing.after },
    { before: 2, after: 1 }
  );
  const emails = deltas.find(d => d.check === 'placeholderEmails');
  assert.deepEqual(
    { before: emails.before, after: emails.after },
    { before: 1, after: 2 }
  );
  assert.equal(deltas.find(d => d.check === 'departmentList'), undefined);
});

test('diffSnapshots: records without userId fall back to employeeId/name keys', () => {
  const prev = { duplicateEmployeeIds: [{ employeeId: 'E100', count: 2 }] };
  const curr = { duplicateEmployeeIds: [{ employeeId: 'E100', count: 2 }, { employeeId: 'E200', count: 3 }] };
  const { newFlags, resolved } = diffSnapshots(prev, curr);
  assert.equal(newFlags.length, 1);
  assert.equal(newFlags[0].employeeId, 'E200');
  assert.equal(resolved.length, 0);
});

test('severity and owner maps cover every audit check', () => {
  const checks = [
    'activeWithLeaveDate', 'activeButTerminated', 'duplicateEmployeeIds',
    'missingEmployeeId', 'duplicateNames', 'missingEntity', 'missingSite',
    'missingDepartment', 'missingManager', 'futureJoiners', 'staleCreated',
    'testUsers', 'unclassifiedCountry', 'unclassifiedOrganization',
    'unapprovedEntity', 'unapprovedDepartment', 'legacySiteAssigned',
    'currencyMismatch', 'brandDivisionAsEntity', 'rareJobTitles',
    'duplicateJobTitleVariants', 'placeholderEmails',
  ];
  for (const c of checks) {
    assert.ok(SEVERITY[c], `SEVERITY missing ${c}`);
    assert.ok(OWNERS[c], `OWNERS missing ${c}`);
  }
});

// ---- digest fallback (deterministic, no API key) -------------------------

function makeSnapshot(overrides = {}) {
  return {
    capturedAt: Date.parse('2026-06-24T06:00:00Z'),
    asOf: '2026-06-24T06:00:00.000Z',
    totalUsers: 100,
    totalFlagged: 6,
    bySeverity: { high: 4, medium: 2, low: 0, info: 0 },
    summary: { duplicateEmployeeIds: 4, missingManager: 2 },
    checks: {
      duplicateEmployeeIds: [
        { employeeId: 'E1', count: 2, users: [{ name: 'Alice Amber' }] },
        { employeeId: 'E2', count: 2, users: [{ name: 'Bob Breeze' }] },
        { employeeId: 'E3', count: 2, users: [{ name: 'Cara Cliff' }] },
        { employeeId: 'E4', count: 2, users: [{ name: 'Dan Dune' }] },
      ],
      missingManager: [
        { userId: 'u9', name: 'Eve East' },
        { userId: 'u10', name: 'Finn Frost' },
      ],
    },
    ...overrides,
  };
}

test('digest fallback: names the top check + owner, never an employee', async () => {
  const latest = makeSnapshot();
  const prev = makeSnapshot({
    totalFlagged: 4,
    summary: { duplicateEmployeeIds: 3, missingManager: 1 },
    checks: {
      duplicateEmployeeIds: latest.checks.duplicateEmployeeIds.slice(0, 3),
      missingManager: latest.checks.missingManager.slice(0, 1),
    },
  });

  const aggregates = buildAggregates(latest, prev, null);
  // Privacy: check-level counts only — no employee name survives aggregation.
  const serialized = JSON.stringify(aggregates);
  for (const name of ['Alice Amber', 'Bob Breeze', 'Eve East', 'Finn Frost']) {
    assert.ok(!serialized.includes(name), `aggregates leaked ${name}`);
  }

  // Force the deterministic fallback path (no API key).
  const savedKey = process.env.CLAUDE_API_KEY;
  delete process.env.CLAUDE_API_KEY;
  try {
    const { text, ai } = await generateHygieneDigest(aggregates);
    assert.equal(ai, false);
    assert.ok(text.includes('duplicateEmployeeIds'), 'top check name missing from digest');
    assert.ok(text.includes('P&C Ops (Moath)'), 'owner missing from digest');
    assert.ok(text.includes('6 flagged records'), 'headline total missing');
    for (const name of ['Alice Amber', 'Bob Breeze', 'Eve East', 'Finn Frost']) {
      assert.ok(!text.includes(name), `digest leaked ${name}`);
    }
    assert.ok(text.split('\n').length <= 12, 'digest exceeds 12 lines');
  } finally {
    if (savedKey !== undefined) process.env.CLAUDE_API_KEY = savedKey;
  }
});

test('buildAggregates: new/resolved counts and week-over-week trend', () => {
  const latest = makeSnapshot();
  const prev = makeSnapshot({
    checks: {
      duplicateEmployeeIds: latest.checks.duplicateEmployeeIds.slice(0, 3),
      missingManager: [
        latest.checks.missingManager[0],
        { userId: 'u11', name: 'Gone Gal' }, // resolved in latest
      ],
    },
    summary: { duplicateEmployeeIds: 3, missingManager: 2 },
  });
  const weekAgo = makeSnapshot({
    capturedAt: Date.parse('2026-06-17T06:00:00Z'),
    totalFlagged: 9,
  });

  const a = buildAggregates(latest, prev, weekAgo);
  assert.equal(a.newFlagsCount, 2);   // E4 + u10
  assert.equal(a.resolvedCount, 1);   // u11
  assert.equal(a.trend.delta, -3);    // 6 now vs 9 a week ago
  assert.equal(a.topChecks[0].check, 'duplicateEmployeeIds'); // high beats medium
  assert.equal(a.topChecks[0].delta, 1);
});

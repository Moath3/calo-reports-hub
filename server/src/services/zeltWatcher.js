/**
 * Zelt hygiene watcher.
 *
 * Snapshots the data-hygiene audit into zelt_audit_snapshots on a schedule,
 * diffs consecutive snapshots (new flags / resolved / count deltas) and posts
 * a weekly AI-written digest to Slack (SLACK_WEBHOOK_URL).
 *
 * Privacy rule: the digest and the AI prompt carry CHECK-LEVEL COUNTS ONLY —
 * no employee names ever leave the snapshot table.
 */
import { getDb, persistNow, kvGet, kvSet } from '../db/database.js';
import { runAudit } from './zeltAudit.js';
import { generateHygieneDigest } from './aiService.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SNAPSHOT_MIN_AGE_MS = 20 * HOUR_MS;   // snapshot at most ~once a day
const DIGEST_MIN_AGE_MS = 6.5 * DAY_MS;     // weekly digest, with slack for scheduler drift
const BOOT_CATCHUP_DELAY_MS = 3 * 60 * 1000; // one-shot check shortly after boot
const HISTORY_LIMIT = 30;
const TOP_CHECKS_LIMIT = 10;
const SLACK_TIMEOUT_MS = 10000;
const LAST_DIGEST_KEY = 'watcher_last_digest_at';

// Severity per check — mirrors the client's SEVERITY map in ZeltAuditPage.jsx
// (single server-side source for the watcher). 'info' checks are displayed
// but not counted as violations (inventory lists / known categorization quirks).
export const SEVERITY = {
  activeWithLeaveDate: 'high',
  activeButTerminated: 'info',
  duplicateEmployeeIds: 'high',
  brandDivisionAsEntity: 'info',
  legacySiteAssigned: 'high',
  currencyMismatch: 'high',
  placeholderEmails: 'high',
  missingEmployeeId: 'medium',
  duplicateNames: 'medium',
  missingEntity: 'medium',
  missingDepartment: 'low',
  missingSite: 'low',
  missingManager: 'medium',
  unapprovedEntity: 'medium',
  unapprovedDepartment: 'low',
  unclassifiedCountry: 'medium',
  unclassifiedOrganization: 'medium',
  duplicateJobTitleVariants: 'medium',
  rareJobTitles: 'low',
  futureJoiners: 'low',
  staleCreated: 'info',
  testUsers: 'medium',
  departmentList: 'info',
  entityList: 'info',
};

// Who chases each check.
export const OWNERS = {
  rareJobTitles: 'Pranav',
  duplicateJobTitleVariants: 'Pranav',
  unapprovedDepartment: 'Sasha',
  missingDepartment: 'Sasha',
  unapprovedEntity: 'People Ops',
  currencyMismatch: 'People Ops',
  brandDivisionAsEntity: 'People Ops',
  missingEntity: 'People Ops',
  legacySiteAssigned: 'People Ops',
  missingSite: 'People Ops',
  unclassifiedCountry: 'People Ops',
  unclassifiedOrganization: 'People Ops',
  duplicateEmployeeIds: 'P&C Ops (Moath)',
  missingEmployeeId: 'P&C Ops (Moath)',
  duplicateNames: 'P&C Ops (Moath)',
  placeholderEmails: 'P&C Ops (Moath)',
  activeWithLeaveDate: 'P&C Ops (Moath)',
  activeButTerminated: 'P&C Ops (Moath)',
  testUsers: 'P&C Ops (Moath)',
  staleCreated: 'P&C Ops (Moath)',
  futureJoiners: 'P&C Ops (Moath)',
  missingManager: 'P&C Ops (Moath)',
};
const DEFAULT_OWNER = 'P&C Ops (Moath)';

// One-line fix hint per check — goes into the digest next to the count.
export const FIX_HINTS = {
  activeWithLeaveDate: 'Finish the offboarding — deactivate or clear the leave date.',
  activeButTerminated: 'Complete the termination flow so status matches the event.',
  duplicateEmployeeIds: 'Reassign a unique employee ID to one of the pair.',
  missingEmployeeId: 'Backfill the employee ID from the masterfile.',
  duplicateNames: 'Check for duplicate profiles; merge or disambiguate.',
  missingEntity: 'Set the payroll entity on the contract.',
  missingDepartment: 'Assign an approved department.',
  missingSite: 'Assign the work site.',
  missingManager: 'Set the reporting manager.',
  futureJoiners: 'Confirm the start date is real, not a placeholder.',
  staleCreated: 'Archive or onboard — decide, do not park in Created.',
  testUsers: 'Deactivate test/support accounts.',
  unclassifiedCountry: 'Normalize the entity/site name so country can be derived.',
  unclassifiedOrganization: 'Tag the entity to a known organization.',
  unapprovedEntity: 'Rename to an approved payroll entity.',
  unapprovedDepartment: 'Move to an approved department or split as Business Line.',
  legacySiteAssigned: 'Move users off the [Not in use] site.',
  currencyMismatch: 'Fix the entity currency with Finance.',
  brandDivisionAsEntity: 'Move brand names to Organization; Entity = legal CR.',
  rareJobTitles: 'Merge one-off titles into canonical mastersheet titles.',
  duplicateJobTitleVariants: 'Pick one canonical title, migrate everyone, delete the rest.',
  placeholderEmails: 'Replace placeholder emails — they break notifications and SSO.',
};

// Inventory lists inside runAudit's checks — not violations. Never stored in
// snapshots, never diffed, never counted.
const INVENTORY_CHECKS = new Set(['departmentList', 'entityList']);

// ---- Pure helpers ------------------------------------------------------

function severityOf(check) {
  return SEVERITY[check] || 'medium';
}

function ownerOf(check) {
  return OWNERS[check] || DEFAULT_OWNER;
}

// Stable identity for a flagged record. Most checks carry userId; the
// aggregate checks fall back to employeeId, name, or the check-specific key.
function keyOf(record) {
  return record?.userId
    ?? record?.employeeId
    ?? record?.name
    ?? record?.legalName
    ?? record?.title
    ?? record?.canonical
    ?? JSON.stringify(record);
}

function flagEntry(check, record) {
  return {
    check,
    severity: severityOf(check),
    owner: ownerOf(check),
    userId: record?.userId ?? null,
    employeeId: record?.employeeId ?? null,
    name: record?.name ?? null,
    entity: record?.entity ?? record?.currentEntity ?? record?.legalName ?? null,
  };
}

/**
 * Diff two snapshots' checks objects. Pure — testable without a DB.
 * Returns { newFlags, resolved, deltas } (deltas only where the count changed).
 */
export function diffSnapshots(prevChecks, currChecks) {
  const newFlags = [];
  const resolved = [];
  const deltas = [];
  const names = new Set([...Object.keys(prevChecks || {}), ...Object.keys(currChecks || {})]);

  for (const check of names) {
    if (INVENTORY_CHECKS.has(check)) continue;
    const prev = Array.isArray(prevChecks?.[check]) ? prevChecks[check] : [];
    const curr = Array.isArray(currChecks?.[check]) ? currChecks[check] : [];
    const prevKeys = new Map(prev.map(r => [keyOf(r), r]));
    const currKeys = new Map(curr.map(r => [keyOf(r), r]));

    for (const [k, r] of currKeys) {
      if (!prevKeys.has(k)) newFlags.push(flagEntry(check, r));
    }
    for (const [k, r] of prevKeys) {
      if (!currKeys.has(k)) resolved.push(flagEntry(check, r));
    }
    if (prev.length !== curr.length) {
      deltas.push({
        check,
        before: prev.length,
        after: curr.length,
        owner: ownerOf(check),
        severity: severityOf(check),
      });
    }
  }
  return { newFlags, resolved, deltas };
}

// Counts + severity buckets from a checks object. totalFlagged excludes
// 'info' checks — those are inventories/quirks, not data debt (same rule the
// audit page's score uses: info carries zero penalty).
function summarizeChecks(checks) {
  const summary = {};
  const bySeverity = { high: 0, medium: 0, low: 0, info: 0 };
  let totalFlagged = 0;
  for (const [check, list] of Object.entries(checks || {})) {
    if (!Array.isArray(list)) continue;
    summary[check] = list.length;
    const sev = severityOf(check);
    bySeverity[sev] = (bySeverity[sev] || 0) + list.length;
    if (sev !== 'info') totalFlagged += list.length;
  }
  return { summary, bySeverity, totalFlagged };
}

function parseJsonOr(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function rowToSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    capturedAt: row.captured_at,
    asOf: row.as_of,
    totalUsers: row.total_users,
    totalFlagged: row.total_flagged,
    bySeverity: parseJsonOr(row.by_severity, {}),
    summary: parseJsonOr(row.summary, {}),
    checks: parseJsonOr(row.checks, {}),
  };
}

function lastSnapshots(limit) {
  return getDb().prepare(
    'SELECT id, captured_at, as_of, total_users, total_flagged, by_severity, summary, checks ' +
    'FROM zelt_audit_snapshots ORDER BY id DESC LIMIT ?'
  ).all(limit).map(rowToSnapshot);
}

// ---- Snapshot & diff ---------------------------------------------------

let snapshotRunning = false; // module-level guard against concurrent runs

export async function runSnapshotAndDiff() {
  if (snapshotRunning) throw new Error('Snapshot run already in progress');
  snapshotRunning = true;
  try {
    const report = await runAudit({ forceRefresh: true });

    // Store the flagged arrays only — never activeUsers or the inventory lists.
    const storedChecks = {};
    for (const [check, list] of Object.entries(report.checks || {})) {
      if (INVENTORY_CHECKS.has(check)) continue;
      if (Array.isArray(list)) storedChecks[check] = list;
    }
    const { summary, bySeverity, totalFlagged } = summarizeChecks(storedChecks);

    const prev = lastSnapshots(1)[0] || null;
    const capturedAt = Date.now();
    getDb().prepare(`
      INSERT INTO zelt_audit_snapshots (captured_at, as_of, total_users, total_flagged, by_severity, summary, checks)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      capturedAt,
      report.asOf,
      report.totalUsers,
      totalFlagged,
      JSON.stringify(bySeverity),
      JSON.stringify(summary),
      JSON.stringify(storedChecks),
    );
    persistNow();

    const diff = prev ? diffSnapshots(prev.checks, storedChecks) : null;
    return {
      snapshot: {
        capturedAt,
        asOf: report.asOf,
        totalUsers: report.totalUsers,
        totalFlagged,
        bySeverity,
        summary,
      },
      diff,
    };
  } finally {
    snapshotRunning = false;
  }
}

/**
 * State for the watch page: snapshot history (ASC), the latest snapshot's
 * summary, the diff between the last two snapshots, and digest metadata.
 */
export function getWatchState() {
  const rows = lastSnapshots(HISTORY_LIMIT).reverse(); // ASC — oldest first
  const latest = rows.length ? rows[rows.length - 1] : null;
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const lastDigestAt = kvGet(LAST_DIGEST_KEY);
  return {
    snapshots: rows.map(s => ({
      capturedAt: s.capturedAt,
      asOf: s.asOf,
      totalFlagged: s.totalFlagged,
      bySeverity: s.bySeverity,
    })),
    latest: latest
      ? {
          capturedAt: latest.capturedAt,
          asOf: latest.asOf,
          totalUsers: latest.totalUsers,
          totalFlagged: latest.totalFlagged,
          bySeverity: latest.bySeverity,
          summary: latest.summary,
        }
      : null,
    diff: latest && prev ? diffSnapshots(prev.checks, latest.checks) : null,
    lastRun: latest ? new Date(latest.capturedAt).toISOString() : null,
    lastDigestAt: lastDigestAt || null,
    slackConfigured: Boolean(process.env.SLACK_WEBHOOK_URL),
  };
}

// ---- Weekly digest -----------------------------------------------------

// Aggregates from snapshot objects. Pure — testable. NO employee names:
// only check-level counts, owners, and fix hints.
export function buildAggregates(latest, prev = null, weekAgo = null) {
  if (!latest) return null;
  const diff = prev ? diffSnapshots(prev.checks, latest.checks) : null;
  const sevRank = { high: 0, medium: 1, low: 2, info: 3 };

  const topChecks = Object.entries(latest.summary || {})
    .filter(([check, count]) => count > 0 && !INVENTORY_CHECKS.has(check) && severityOf(check) !== 'info')
    .map(([check, count]) => ({
      check,
      count,
      delta: count - (prev?.summary?.[check] || 0),
      severity: severityOf(check),
      owner: ownerOf(check),
      fixHint: FIX_HINTS[check] || 'Review and correct in Zelt.',
    }))
    .sort((a, b) => (sevRank[a.severity] - sevRank[b.severity]) || (b.count - a.count))
    .slice(0, TOP_CHECKS_LIMIT);

  return {
    asOf: latest.asOf,
    totalUsers: latest.totalUsers,
    totalFlagged: latest.totalFlagged,
    bySeverity: latest.bySeverity,
    trend: weekAgo
      ? {
          prevTotalFlagged: weekAgo.totalFlagged,
          delta: latest.totalFlagged - weekAgo.totalFlagged,
          since: new Date(weekAgo.capturedAt).toISOString(),
        }
      : null,
    newFlagsCount: diff ? diff.newFlags.length : 0,
    resolvedCount: diff ? diff.resolved.length : 0,
    topChecks,
  };
}

/**
 * Reads the last two snapshots (+ the one ~a week back for the trend) and
 * builds the digest aggregates. Returns null when there are no snapshots.
 */
export function buildDigestAggregates() {
  const rows = lastSnapshots(2);
  const latest = rows[0] || null;
  if (!latest) return null;
  const prev = rows[1] || null;

  // Week-over-week trend: newest snapshot at least ~6 days older than latest.
  const weekAgoRow = getDb().prepare(
    'SELECT id, captured_at, as_of, total_users, total_flagged, by_severity, summary, checks ' +
    'FROM zelt_audit_snapshots WHERE captured_at <= ? ORDER BY captured_at DESC LIMIT 1'
  ).get(latest.capturedAt - 6 * DAY_MS);

  return buildAggregates(latest, prev, rowToSnapshot(weekAgoRow));
}

/**
 * Sends the weekly Slack digest when due (kv timestamp missing or ≥ 6.5 days
 * old; `force` bypasses). Always resolves to { sent, skipped?, preview }.
 */
export async function sendWeeklyDigestIfDue({ force = false } = {}) {
  if (!force) {
    const last = kvGet(LAST_DIGEST_KEY);
    if (last && Date.now() - Date.parse(last) < DIGEST_MIN_AGE_MS) {
      return { sent: false, skipped: 'digest not due yet', preview: null };
    }
  }

  const aggregates = buildDigestAggregates();
  if (!aggregates) {
    return { sent: false, skipped: 'no snapshots yet', preview: null };
  }

  const { text } = await generateHygieneDigest(aggregates);

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    return { sent: false, skipped: 'SLACK_WEBHOOK_URL not set', preview: text };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { sent: false, skipped: `Slack POST failed (${res.status})`, preview: text };
    }
    kvSet(LAST_DIGEST_KEY, new Date().toISOString());
    return { sent: true, preview: text };
  } catch (err) {
    return { sent: false, skipped: `Slack POST failed: ${err.message}`, preview: text };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Scheduler ---------------------------------------------------------

let schedulerStarted = false;

async function watcherTick(label) {
  try {
    const latest = lastSnapshots(1)[0] || null;
    if (latest && Date.now() - latest.capturedAt < SNAPSHOT_MIN_AGE_MS) return;
    // runAudit throws if Zelt isn't connected — the catch below keeps the
    // scheduler alive through outages instead of crashing the server.
    await runSnapshotAndDiff();
    const digest = await sendWeeklyDigestIfDue();
    if (digest.sent) console.log('[zelt-watcher] weekly digest sent to Slack');
  } catch (err) {
    console.warn(`[zelt-watcher] ${label} skipped: ${err.message}`);
  }
}

/**
 * Hourly check: snapshot when the last one is ≥20h old, then send the weekly
 * digest if due. Plus a one-shot catch-up ~3 min after boot so a restarted
 * server doesn't wait an hour to resume the daily cadence.
 */
export function startWatcherScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const boot = setTimeout(() => watcherTick('boot catch-up'), BOOT_CATCHUP_DELAY_MS);
  const loop = setInterval(() => watcherTick('hourly tick'), HOUR_MS);
  boot.unref?.();
  loop.unref?.();
  console.log('[zelt-watcher] scheduler started (hourly check, ~daily snapshot, weekly digest)');
}

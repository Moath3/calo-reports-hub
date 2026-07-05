/**
 * Zelt mobility & turnover service.
 *
 * Derives joiner/leaver/turnover analytics from the full Zelt user list:
 * trailing-12-month series, tenure buckets, per-entity/per-department splits
 * and the trailing leaver list. Pure computation lives in
 * computeMobilityFromUsers() (testable, no I/O); getMobility() feeds it the
 * cached user list from zeltCompute and memoizes the result for ~15 min.
 *
 * Coverage honesty: users we can't place on the timeline (leavers with no
 * leaveDate, actives with no startDate) are EXCLUDED from the series and
 * surfaced in `coverage` instead of silently inflating headcount.
 */
import { fetchAllUsersForAudit } from './zeltCompute.js';

const MOBILITY_TTL_MS = 15 * 60 * 1000; // recomputing over ~2k users is cheap but the fetch isn't
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44; // mean Gregorian month — good enough for tenure display
const EARLY_ATTRITION_DAYS = 90;

const cache = { value: null, expiresAt: 0 };

// ---- Local field readers ----------------------------------------------
// zeltCompute doesn't export its readers; replicate the same field paths here
// (same fallback order) so both modules read a user record identically.

function readEmployeeId(u) {
  return (
    u?.employeeId ??
    u?.employeeNumber ??
    u?.externalId ??
    u?.basicInfo?.employeeId ??
    u?.basic?.employeeId ??
    u?.userBasic?.employeeId ??
    null
  );
}

function readName(u) {
  if (u?.displayName) return u.displayName;
  if (u?.fullName) return u.fullName;
  if (u?.name) return u.name;
  const firstName = u?.firstName || u?.basicInfo?.firstName || u?.userBasic?.firstName || '';
  const lastName = u?.lastName || u?.basicInfo?.lastName || u?.userBasic?.lastName || '';
  const composed = `${firstName} ${lastName}`.trim();
  return composed || '(unnamed)';
}

function readEntity(u) {
  return (
    u?.userContract?.entity?.legalName ??
    u?.contract?.entity?.legalName ??
    u?.entity?.legalName ??
    (typeof u?.entity === 'string' ? u.entity : null) ??
    u?.legalEntity?.name ??
    null
  );
}

function parseDateSafe(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function round1(v) {
  if (v == null || isNaN(v)) return v;
  return Math.round(v * 10) / 10;
}

// One derived record per user — everything downstream reads these, never the
// raw Zelt shape.
function deriveUser(u) {
  const status = u?.accountStatus || u?.status || u?.lifecycle?.status || null;
  const eventStatus = u?.userEvent?.status || u?.lifecycle?.status || null;
  const startDate = parseDateSafe(u?.startDate || u?.lifecycle?.startDate);
  const leaveDate = parseDateSafe(u?.leaveDate || u?.lifecycle?.leaveDate);

  // LEAVER = hard status, departure event, or a leave date on record.
  const isLeaver =
    status === 'Deactivated' || status === 'Terminated' ||
    ['Terminated', 'Resigned', 'Offboarded'].includes(eventStatus) ||
    Boolean(u?.leaveDate || u?.lifecycle?.leaveDate);

  let reason = 'unknown';
  if (eventStatus === 'Resigned') reason = 'voluntary';
  else if (eventStatus === 'Terminated' || eventStatus === 'Offboarded') reason = 'involuntary';

  return {
    name: readName(u),
    employeeId: readEmployeeId(u),
    entity: readEntity(u),
    department: u?.role?.department?.name || u?.department?.name || u?.department || null,
    site: u?.role?.site?.name || u?.site?.name || u?.site || null,
    jobTitle: u?.role?.jobPosition?.title || u?.jobTitle || u?.position || null,
    status,
    eventStatus,
    startDate,
    leaveDate,
    isLeaver,
    // "Currently employed" mirrors zeltCompute's balances filter: not a hard
    // leaver, no departure event, no leaveDate. (Created/Invited stay in.)
    isActive: !isLeaver,
    reason,
  };
}

// Headcount at a point in time. Only users with a startDate can be placed on
// the timeline; leavers with no leaveDate are excluded by the caller (they'd
// otherwise count as employed forever).
function employedAt(rec, t) {
  if (!rec.startDate) return false;
  if (rec.startDate.getTime() > t) return false;
  if (rec.leaveDate && rec.leaveDate.getTime() <= t) return false;
  // Leaver by status but no leaveDate → can't place the exit; excluded upstream.
  return true;
}

function tenureBucket(days) {
  if (days < EARLY_ATTRITION_DAYS) return '<3m';
  if (days < 365) return '3–12m';
  if (days < 365 * 2) return '1–2y';
  if (days < 365 * 5) return '2–5y';
  return '5y+';
}

const TENURE_BUCKETS = ['<3m', '3–12m', '1–2y', '2–5y', '5y+'];

/**
 * Pure computation — no I/O. `users` are raw Zelt user records, `now` fixes
 * the reference point (tests pass a frozen date).
 */
export function computeMobilityFromUsers(users, now = new Date()) {
  // Dedupe the way zeltCompute does — partner endpoint sometimes returns one
  // row per contract.
  const seen = new Map();
  for (const u of users || []) {
    const k = u.userId || u.id || readEmployeeId(u) || JSON.stringify(u).slice(0, 40);
    if (!seen.has(k)) seen.set(k, u);
  }
  const records = Array.from(seen.values()).map(deriveUser);

  // Coverage — excluded-from-series counts, surfaced honestly.
  const leaversNoDate = records.filter(r => r.isLeaver && !r.leaveDate).length;
  const activesNoStart = records.filter(r => r.isActive && !r.startDate).length;

  // Series population: placeable on the timeline (has startDate) and, if a
  // leaver, has a known exit date.
  const series = records.filter(r => r.startDate && !(r.isLeaver && !r.leaveDate));

  // Trailing 12 calendar months, ending the current month. All boundaries UTC.
  const nowMs = now.getTime();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const monthStart = Date.UTC(y, m - i, 1);
    const monthEnd = Date.UTC(y, m - i + 1, 1) - 1; // last ms of the month
    const d = new Date(monthStart);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

    const headStart = series.filter(r => employedAt(r, monthStart)).length;
    const headEnd = series.filter(r => employedAt(r, monthEnd)).length;
    const inMonth = (t) => t && t.getTime() >= monthStart && t.getTime() <= monthEnd;

    const joiners = records.filter(r => inMonth(r.startDate)).length;
    const monthLeavers = records.filter(r => inMonth(r.leaveDate));
    const leavers = monthLeavers.length;
    const voluntary = monthLeavers.filter(r => r.reason === 'voluntary').length;
    const involuntary = monthLeavers.filter(r => r.reason === 'involuntary').length;

    const avgHeadcount = (headStart + headEnd) / 2;
    const turnoverPct = avgHeadcount > 0 ? round1((leavers / avgHeadcount) * 100) : 0;

    months.push({
      month: key,
      headcount: headEnd,
      joiners,
      leavers,
      voluntary,
      involuntary,
      turnoverPct,
      annualizedPct: round1(turnoverPct * 12),
    });
  }
  const windowStart = Date.UTC(y, m - 11, 1);
  const windowEnd = Date.UTC(y, m + 1, 1) - 1;
  const inWindow = (t) => t && t.getTime() >= windowStart && t.getTime() <= windowEnd;

  // Totals over the trailing window.
  const headcountNow = series.filter(r => employedAt(r, nowMs)).length;
  const joiners12m = months.reduce((s, x) => s + x.joiners, 0);
  const leavers12m = months.reduce((s, x) => s + x.leavers, 0);
  const voluntary12m = months.reduce((s, x) => s + x.voluntary, 0);
  const involuntary12m = months.reduce((s, x) => s + x.involuntary, 0);
  const avgMonthlyHeadcount = months.reduce((s, x) => s + x.headcount, 0) / months.length;
  const annualizedTurnoverPct = avgMonthlyHeadcount > 0
    ? round1((leavers12m / avgMonthlyHeadcount) * 100)
    : 0;

  // Early attrition — share of 12m leavers who left within 90 days, among
  // leavers where both dates are known.
  const windowLeavers = records.filter(r => inWindow(r.leaveDate));
  const datedLeavers = windowLeavers.filter(r => r.startDate);
  const earlyLeavers = datedLeavers.filter(
    r => (r.leaveDate.getTime() - r.startDate.getTime()) / MS_PER_DAY < EARLY_ATTRITION_DAYS
  );
  const earlyAttritionPct = datedLeavers.length > 0
    ? round1((earlyLeavers.length / datedLeavers.length) * 100)
    : 0;

  // Tenure buckets of CURRENT actives (needs a startDate to compute tenure).
  const tenureCounts = Object.fromEntries(TENURE_BUCKETS.map(b => [b, 0]));
  for (const r of records) {
    if (!r.isActive || !r.startDate) continue;
    const days = (nowMs - r.startDate.getTime()) / MS_PER_DAY;
    if (days < 0) continue; // future joiner — not tenured yet
    tenureCounts[tenureBucket(days)] += 1;
  }
  const tenure = TENURE_BUCKETS.map(bucket => ({ bucket, count: tenureCounts[bucket] }));

  // Per-entity / per-department splits.
  const groupBy = (keyFn) => {
    const groups = new Map();
    for (const r of records) {
      const key = keyFn(r) || '(none)';
      const g = groups.get(key) || { key, headcount: 0, joiners12m: 0, leavers12m: 0 };
      if (r.isActive && r.startDate && employedAt(r, nowMs)) g.headcount += 1;
      if (inWindow(r.startDate)) g.joiners12m += 1;
      if (inWindow(r.leaveDate)) g.leavers12m += 1;
      groups.set(key, g);
    }
    return Array.from(groups.values())
      .map(g => ({
        ...g,
        turnoverPct: g.headcount > 0 ? round1((g.leavers12m / g.headcount) * 100) : 0,
      }))
      .sort((a, b) => b.headcount - a.headcount);
  };
  const byEntity = groupBy(r => r.entity);
  const byDept = groupBy(r => r.department);

  // Trailing-12m leaver list, newest exits first.
  const leavers = windowLeavers
    .map(r => ({
      name: r.name,
      employeeId: r.employeeId,
      entity: r.entity,
      dept: r.department,
      position: r.jobTitle,
      leaveDate: r.leaveDate.toISOString().slice(0, 10),
      tenureMonths: r.startDate
        ? round1((r.leaveDate.getTime() - r.startDate.getTime()) / MS_PER_DAY / DAYS_PER_MONTH)
        : null,
      reason: r.reason,
    }))
    .sort((a, b) => b.leaveDate.localeCompare(a.leaveDate));

  return {
    months,
    totals: {
      headcountNow,
      joiners12m,
      leavers12m,
      annualizedTurnoverPct,
      voluntary12m,
      involuntary12m,
      earlyAttritionPct,
    },
    tenure,
    byEntity,
    byDept,
    leavers,
    coverage: {
      totalUsers: records.length,
      leaversNoDate,
      activesNoStart,
    },
  };
}

/**
 * Public entry point — fetches the (cached) full user list and computes
 * mobility, memoized for ~15 min. Includes asOf so the client can show
 * data freshness.
 */
export async function getMobility() {
  if (cache.value && cache.expiresAt > Date.now()) return cache.value;
  const users = await fetchAllUsersForAudit();
  const result = { asOf: new Date().toISOString(), ...computeMobilityFromUsers(users) };
  cache.value = result;
  cache.expiresAt = Date.now() + MOBILITY_TTL_MS;
  return result;
}

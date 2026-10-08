/**
 * Zelt compute service.
 *
 * Pulls users + absences via the public partner API and derives "available now"
 * leave balance per user. We don't rely on an undocumented balance endpoint.
 *
 * Formula (validated against Zelt UI: Moath = 19.9):
 *   available_now = userAllowance + carryOver - daysTakenHistory - daysBookedUpcoming
 *
 * If a field is missing from the partner API response, we degrade gracefully and
 * mark each row with a confidence flag so the UI can surface uncertainty.
 *
 * Caching:
 *   - /entities cached 60min (entities rarely change)
 *   - /balances cached 5min per entity (balances move with bookings)
 */
import { zeltGet } from './zeltApi.js';
import { botGet, botConfigured } from './zeltBot.js';
import { getDb, persistNow } from '../db/database.js';
// Production vs non-production classification — drives the compensatory-day
// expiry window (production keeps 9 months, non-production expires in 3).
import { isProductionDept, isOfficeDept } from '../../../client/src/utils/caloCanon.js';

const ENTITIES_TTL_MS = 6 * 60 * 60 * 1000; // 6h — entities barely change
const BALANCES_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 100;
const MS_PER_DAY = 86_400_000; // 24h × 60m × 60s × 1000ms
const ABSENCE_USER_CHUNK_SIZE = 50; // users per /partner/absences batch call

const cache = {
  entities: { value: null, expiresAt: 0 },
  departments: { value: null, expiresAt: 0 },
  balances: new Map(), // key: entity → { value, expiresAt }
  // Company-wide live-balance map (output of tryFetchBalances), keyed by as-of
  // date. The balance endpoint is fetched company-wide regardless of entity, so
  // caching it lets a second entity (or a retry) skip the whole expensive pull.
  balancesMap: new Map(), // key: asOfDate|'now' → { value, expiresAt }
  // Heavyweight: full user list. Reused across entity picks for 5 min so
  // generating reports for two different entities doesn't refetch 1961 users.
  allUsers: { value: null, expiresAt: 0 },
  // Employee IDs barely change — cache 24h.
  basics: { value: new Map(), expiresAt: 0 },
};
const ALL_USERS_TTL_MS = 5 * 60 * 1000;
const BASICS_TTL_MS = 24 * 60 * 60 * 1000;

// ---- Public API ------------------------------------------------------

export async function listEntities() {
  if (cache.entities.value && cache.entities.expiresAt > Date.now()) {
    return cache.entities.value;
  }
  // Try the dedicated partner endpoints first — much faster than scanning all users.
  // Auth failures here (401 OAuth dead / 403 bot lacks partner scope) are NOT
  // fatal: we drop through to the bot-driven user scan, which only relies on
  // the bot session (which works independently of partner OAuth).
  for (const path of ENTITY_ENDPOINT_CANDIDATES) {
    try {
      const data = await zeltGet(path, { page: 1, pageSize: 200 });
      const items = readItems(data);
      if (items && items.length > 0) {
        const set = new Set();
        for (const entityItem of items) {
          const e = entityItem.legalName || entityItem.name || entityItem.entity?.legalName;
          if (e && typeof e === 'string') set.add(e.trim());
        }
        if (set.size > 0) {
          const entities = Array.from(set).sort();
          cache.entities = { value: entities, expiresAt: Date.now() + ENTITIES_TTL_MS };
          console.log(`[zelt] entities loaded from ${path} (${entities.length} entities)`);
          return entities;
        }
      }
    } catch (err) {
      // Used to throw on auth failures, but that short-circuited the
      // user-scan fallback below. The bot can derive entities even when
      // every partner endpoint is unreachable, so let it try.
      console.warn(`[zelt] entities endpoint ${path} failed: ${err.status || ''} ${err.message}`);
    }
  }

  // Final fallback: derive entities from the full user list. fetchAllUsers()
  // prefers the bot's /apiv2/users/cache (single non-paginated call, works
  // when partner OAuth is dead), which is exactly the path we need here.
  console.log('[zelt] partner entity endpoints unavailable; deriving entities from bot user list');
  const users = await fetchAllUsers();
  const set = new Set();
  for (const u of users) {
    const e = u?.userContract?.entity?.legalName || u?.entity?.legalName || u?.entity;
    if (e && typeof e === 'string') set.add(e.trim());
  }
  const entities = Array.from(set).sort();
  cache.entities = { value: entities, expiresAt: Date.now() + ENTITIES_TTL_MS };
  console.log(`[zelt] entities derived from ${users.length} users (${entities.length} entities)`);
  return entities;
}

// Pure derivation so it's unit-testable: department names of CURRENTLY
// EMPLOYED users only (same filter as the balances path), deduped + sorted.
// Terminated people shouldn't keep ghost departments alive in the dropdown.
export function deriveDepartmentsFromUsers(users) {
  const set = new Set();
  for (const u of users || []) {
    const status = u?.accountStatus || u?.status || u?.lifecycle?.status;
    if (status === 'Deactivated' || status === 'Terminated') continue;
    const eventStatus = u?.userEvent?.status || u?.lifecycle?.status;
    if (eventStatus === 'Terminated' || eventStatus === 'Resigned' || eventStatus === 'Offboarded') continue;
    if (u?.leaveDate || u?.lifecycle?.leaveDate) continue;
    const d = u?.role?.department?.name || u?.department?.name || u?.department;
    if (d && typeof d === 'string' && d.trim()) set.add(d.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Department list for the leave-balances filter. Derived from the user list
// (there's no dedicated partner endpoint for departments) and cached like
// entities — department names barely change.
export async function listDepartments() {
  if (cache.departments.value && cache.departments.expiresAt > Date.now()) {
    return cache.departments.value;
  }
  const users = await fetchAllUsers();
  const departments = deriveDepartmentsFromUsers(users);
  cache.departments = { value: departments, expiresAt: Date.now() + ENTITIES_TTL_MS };
  console.log(`[zelt] departments derived from ${users.length} users (${departments.length} departments)`);
  return departments;
}

// Entities that actually contain the given departments (among currently
// employed users). Lets the department-first mode fan out to only the relevant
// entities instead of hammering — and failing on — entities that can't
// contribute a single row.
export function deriveEntitiesForDepartments(users, departments) {
  const want = new Set((departments || []).map((d) => String(d).trim().toLowerCase()).filter(Boolean));
  if (!want.size) return [];
  const set = new Set();
  for (const u of users || []) {
    const status = u?.accountStatus || u?.status || u?.lifecycle?.status;
    if (status === 'Deactivated' || status === 'Terminated') continue;
    const eventStatus = u?.userEvent?.status || u?.lifecycle?.status;
    if (eventStatus === 'Terminated' || eventStatus === 'Resigned' || eventStatus === 'Offboarded') continue;
    if (u?.leaveDate || u?.lifecycle?.leaveDate) continue;
    const d = u?.role?.department?.name || u?.department?.name || u?.department;
    if (!d || typeof d !== 'string' || !want.has(d.trim().toLowerCase())) continue;
    const e = readEntity(u);
    if (e && typeof e === 'string' && e.trim()) set.add(e.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export async function entitiesForDepartments(departments) {
  const users = await fetchAllUsers();
  return deriveEntitiesForDepartments(users, departments);
}

// Public entry point: tries a fresh fetch, persists the result on success,
// and falls back to the last persisted snapshot (with stale=true and the
// captured-at timestamp) if the fresh path fully fails. Means a Zelt outage
// shows the last known balances + a banner instead of a hard error.
export async function getBalancesForEntity(entityName, asOfDate = null, departments = []) {
  try {
    const fresh = await fetchBalancesForEntityFresh(entityName, asOfDate, departments);
    // Dept-scoped fetches must NOT overwrite the full-entity snapshot — the
    // fallback below always serves the full snapshot and the route re-filters.
    if (!departments.length) saveBalanceSnapshot(entityName, asOfDate, fresh);
    return { ...fresh, stale: false };
  } catch (err) {
    const snapshot = loadBalanceSnapshot(entityName, asOfDate);
    if (snapshot) {
      console.warn(`[zelt] balance fetch failed for "${entityName}" (${err.message}); serving snapshot from ${new Date(snapshot.capturedAt).toISOString()}`);
      return {
        ...snapshot.data,
        stale: true,
        capturedAt: snapshot.capturedAt,
        staleReason: err.message,
      };
    }
    // No snapshot available → original behavior, propagate the error.
    throw err;
  }
}

/**
 * Roster for one or more entities — id / name / position / department, shaped
 * as T&A master records ({ empId, name, position, entity, department, source }).
 * Reuses the cached user list and the same "currently employed" filter as the
 * balances path, and fetches employeeId via the per-user basics endpoint when
 * the user list omits it. Pass '*' for the WHOLE roster (the automatic
 * fallback when a T&A run has no master files and no entity selection).
 */
export async function getRosterForEntities(entityNames) {
  const all = entityNames === '*' || (Array.isArray(entityNames) && entityNames.includes('*'));
  const wanted = all ? [] : (entityNames || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean);
  if (!all && !wanted.length) return [];
  const users = await fetchAllUsers();

  const seen = new Map();
  for (const u of users) {
    const k = u.userId || u.id || readEmployeeId(u) || JSON.stringify(u).slice(0, 40);
    if (!seen.has(k)) seen.set(k, u);
  }
  const targets = Array.from(seen.values()).filter((u) => {
    const status = u?.accountStatus || u?.status || u?.lifecycle?.status;
    if (status === 'Deactivated' || status === 'Terminated') return false;
    const eventStatus = u?.userEvent?.status || u?.lifecycle?.status;
    if (eventStatus === 'Terminated' || eventStatus === 'Resigned' || eventStatus === 'Offboarded') return false;
    if (u?.leaveDate || u?.lifecycle?.leaveDate) return false;
    const e = readEntity(u);
    if (all) return true; // whole-roster mode: entity not required for ID joins
    if (!e) return false;
    const eNorm = e.toLowerCase().trim();
    return wanted.some((w) => eNorm === w || eNorm.includes(w) || w.includes(eNorm));
  });

  // Backfill employeeId where the user list didn't include it.
  const needBasics = targets.filter((u) => readEmployeeId(u) == null).map((u) => u.userId || u.id);
  let basics = new Map();
  if (needBasics.length) {
    try { basics = await fetchUserBasics(needBasics); }
    catch (err) { console.warn(`[zelt] roster basics fetch failed: ${err.message}`); }
  }

  return targets
    .map((u) => {
      const userId = u.userId || u.id;
      return {
        empId: String(readEmployeeId(u) ?? basics.get(userId) ?? '').trim(),
        name: readName(u),
        position: u?.role?.jobPosition?.title || u?.jobTitle || u?.position || '',
        entity: readEntity(u),
        department: u?.role?.department?.name || u?.department?.name || '',
        source: 'Zelt',
      };
    })
    .filter((r) => r.empId || (r.name && r.name !== '(unnamed)'));
}

function saveBalanceSnapshot(entityName, asOfDate, data) {
  try {
    getDb().prepare(`
      INSERT INTO zelt_balance_snapshots (entity, as_of_date, data, captured_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity, as_of_date) DO UPDATE SET
        data = excluded.data,
        captured_at = excluded.captured_at
    `).run(entityName, asOfDate || '', JSON.stringify(data), Date.now());
    persistNow();
  } catch (e) {
    console.warn('[zelt] saveBalanceSnapshot failed:', e.message);
  }
}

function loadBalanceSnapshot(entityName, asOfDate) {
  try {
    const row = getDb().prepare(
      'SELECT data, captured_at FROM zelt_balance_snapshots WHERE entity = ? AND as_of_date = ?'
    ).get(entityName, asOfDate || '');
    if (!row) return null;
    return { data: JSON.parse(row.data), capturedAt: row.captured_at };
  } catch (e) {
    console.warn('[zelt] loadBalanceSnapshot failed:', e.message);
    return null;
  }
}

async function fetchBalancesForEntityFresh(entityName, asOfDate = null, departments = []) {
  // asOfDate: ISO date string (YYYY-MM-DD), past only, optional.
  // departments: optional — narrows the TARGETS before the expensive per-user
  // fetches, so a department query costs a handful of partner calls instead of
  // the whole entity's staff (which was bursting Zelt's partner rate limit).
  const deptNorm = (departments || []).map(d => String(d).trim().toLowerCase()).filter(Boolean).sort();
  const key = `${entityName.toLowerCase()}|${asOfDate || 'today'}${deptNorm.length ? '|' + deptNorm.join(',') : ''}`;
  const cached = cache.balances.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const entKey = entityName.toLowerCase().trim();
  const deptSet = new Set(deptNorm);

  const users = await fetchAllUsers();

  // Dedupe — partner endpoint sometimes returns one row per contract.
  const seen = new Map();
  for (const u of users) {
    const k = u.userId || u.id || u.employeeId || u.basicInfo?.employeeId || JSON.stringify(u).slice(0, 40);
    if (!seen.has(k)) seen.set(k, u);
  }
  const deduped = Array.from(seen.values());

  // Diagnostic — collect every entity name seen in user records so we can
  // surface it back if the filter returns zero (mismatch debugging).
  const entitiesSeen = new Set();

  // Filter to currently employed in the requested entity.
  // "Currently employed" = Active accountStatus AND no leaveDate AND
  //   userEvent.status !== "Terminated" (this catches mid-termination people
  //   whose leaveDate has already passed but accountStatus hasn't flipped yet).
  const targets = deduped.filter(u => {
    const status = u?.accountStatus || u?.status || u?.lifecycle?.status;
    if (status === 'Deactivated' || status === 'Terminated') return false;
    const eventStatus = u?.userEvent?.status || u?.lifecycle?.status;
    if (eventStatus === 'Terminated' || eventStatus === 'Resigned' || eventStatus === 'Offboarded') return false;
    if (u?.leaveDate || u?.lifecycle?.leaveDate) return false;
    const e = readEntity(u);
    if (e) entitiesSeen.add(e);
    if (!e) return false;
    const eNorm = e.toLowerCase().trim();
    if (!(eNorm === entKey || eNorm.includes(entKey) || entKey.includes(eNorm))) return false;
    if (deptSet.size) {
      const d = u?.role?.department?.name || u?.department?.name || u?.department;
      if (!d || typeof d !== 'string' || !deptSet.has(d.trim().toLowerCase())) return false;
    }
    return true;
  });

  const targetUserIds = targets.map(u => u.userId || u.id);
  // Map each user to production vs non-production so comp-day expiry can be
  // 9 months for production crew, 3 months for everyone else.
  // Company-wide (deduped), not just this entity's targets — tryFetchBalances
  // fetches balances company-wide and caches the map, so the production flags it
  // bakes into comp expiry must cover everyone, not only the current entity.
  const prodByUser = new Map(deduped.map(u => [u.userId || u.id, isProductionEmployee(u)]));

  // Skip the expensive per-user basics fetch if our user records already
  // contain employeeId (true when bot's /users/cache succeeded).
  const hasEmpIdAlready = targets.length > 0 && targets.every(u => readEmployeeId(u) != null);

  // Run absence fetch + (maybe) basic info + balance probe in parallel. Absence
  // history is useful, but it should not take down the leave portal when the
  // live bot balance endpoint is available and OAuth is the only broken layer.
  const [absencesResult, basicsResult, balancesResult] = await Promise.allSettled([
    fetchAbsencesByUser(targetUserIds),
    hasEmpIdAlready ? Promise.resolve(new Map()) : fetchUserBasics(targetUserIds),
    tryFetchBalances(targetUserIds, asOfDate, prodByUser),
  ]);

  const balancesByUser = balancesResult.status === 'fulfilled' ? balancesResult.value : new Map();
  if (balancesResult.status === 'rejected') {
    const err = balancesResult.reason;
    console.warn(`[zelt] live balance fetch failed (${err.status || ''} ${err.message}) - falling back to computed balances`);
  }

  let absencesByUser = new Map();
  if (absencesResult.status === 'fulfilled') {
    absencesByUser = absencesResult.value;
  } else if (balancesByUser.size > 0) {
    const err = absencesResult.reason;
    console.warn(`[zelt] absence fetch failed (${err.status || ''} ${err.message}) - continuing with live balances only`);
  } else {
    throw absencesResult.reason;
  }
  // When the absence fetch failed or came back partial, upcoming/pending are
  // understated for some employees — don't cache that so the next request
  // recomputes instead of serving wrong zeros for 5 minutes.
  const absencesDegraded = absencesResult.status === 'rejected' || absencesByUser.incomplete === true;

  const basicsByUser = basicsResult.status === 'fulfilled' ? basicsResult.value : new Map();
  if (basicsResult.status === 'rejected') {
    const err = basicsResult.reason;
    console.warn(`[zelt] basic-info fetch failed (${err.status || ''} ${err.message}) - employeeId may be unavailable`);
  }
  if (hasEmpIdAlready) console.log('[zelt] skipping per-user basics fetch (emp IDs already in user list)');

  const today = new Date();
  const rows = targets.map(u => {
    const userId = u.userId || u.id;
    const allowance = numberOr(
      u?.userContract?.allowance ??
      u?.contract?.allowance ??
      u?.allowance ??
      u?.absencePolicy?.allowance,
      null
    );
    const carryOver = numberOr(
      u?.carryOver ?? u?.userContract?.carryOver ?? u?.absencePolicy?.carryOver,
      0
    );
    const userAbs = absencesByUser.get(userId) || [];

    // Upcoming/pending leave comes from the ACTUAL absence requests, not the
    // balance aggregate — Zelt's balance endpoint reports unitsTaken.upcoming=0
    // here even when approved future leave exists, so relying on it zeroed the
    // column for everyone. We split annual absences by date + approval status.
    // Scope to the current holiday year (calendar), matching Zelt's balance tab —
    // the absence list spans multiple years, so unscoped history/upcoming would
    // pull in old and far-future leave.
    const hy = today.getUTCFullYear();
    const yearStart = new Date(Date.UTC(hy, 0, 1, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(hy, 11, 31, 23, 59, 59));
    let history = 0;        // annual taken so far this year
    let upcoming = 0;       // approved, future-dated (this year)
    let pendingDays = 0;    // awaiting approval, future-dated (this year)
    let confidence = 'high';

    for (const ab of userAbs) {
      const start = parseDateSafe(ab.start || ab.startDate);
      if (!start) { confidence = 'medium'; continue; }
      if (!isAnnualLeave(ab)) continue;
      if (start < yearStart || start > yearEnd) continue; // current holiday year only
      const status = String(ab.status || ab.state || '').toLowerCase();
      if (/reject|cancel|declin|withdraw/.test(status)) continue; // not counted
      const days = absenceDays(ab);
      if (days <= 0) continue;
      const isPending = /pending|await|request|review/.test(status);
      if (start <= today) history += days;
      else if (isPending) pendingDays += days;
      else upcoming += days;
    }

    // PREFERRED: use the live "Available Now" from Zelt's internal balance endpoint
    // (matches what the Zelt UI shows on each employee's Time Planner widget).
    let availableNow = null;
    const liveBalance = balancesByUser.get(userId);
    if (liveBalance) {
      availableNow = round1(liveBalance.available_now);
      confidence = 'high';
    } else if (allowance != null) {
      availableNow = round1(allowance + carryOver - history - upcoming);
    } else {
      confidence = 'low';
    }
    // Allowance from the user object is often blank — the balance endpoint's
    // cycle total (public holidays stripped) is the real annual allowance.
    const effAllowance = allowance ?? (liveBalance && liveBalance.total > 0 ? round1(liveBalance.total) : null);

    return {
      employeeId: readEmployeeId(u) ?? basicsByUser.get(userId) ?? null,
      userId,
      name: readName(u),
      site: u?.role?.site?.name || u?.site?.name || u?.site || null,
      department: u?.role?.department?.name || u?.department?.name || u?.department || null,
      jobTitle: u?.role?.jobPosition?.title || u?.jobTitle || u?.position || null,
      startDate: u.startDate || u?.lifecycle?.startDate || null,
      policy: liveBalance?.policyName || null,
      allowance: effAllowance,
      carryOver,
      history: round1(history),
      upcoming: round1(upcoming),
      pending: round1(pendingDays),
      zeltBalance: liveBalance ? round1(liveBalance.zelt_balance) : null,
      // Year-end projection: use Zelt's own "Remaining by Dec 31" (computed in
      // tryFetchBalances). Recomputing it from a different basis than
      // availableNow produced values below the current balance — don't.
      endOfYear: liveBalance ? round1(liveBalance.end_of_year) : null,
      compensatory: liveBalance ? round1(liveBalance.compensatory || 0) : null,
      // Dated compensatory additions + per-batch expiry (9 months for
      // production crew, 3 months for non-production).
      compAdditions: liveBalance?.compAdditions || [],
      compExpiringDays: liveBalance?.compExpiringDays ?? 0,
      compExpiredDays: liveBalance?.compExpiredDays ?? 0,
      isProduction: prodByUser.get(userId) === true,
      compExpiryMonths: liveBalance?.compExpiryMonths ?? (prodByUser.get(userId) === true ? COMP_EXPIRY_MONTHS_PROD : COMP_EXPIRY_MONTHS_NONPROD),
      // Flags: high annual (30+ available now) / high compensatory (10+) to chase.
      // Keyed off availableNow, not the Zelt balance (which is inflated by
      // public holidays and no longer shown).
      annualHigh: availableNow != null && availableNow >= 30,
      compHigh: liveBalance ? round1(liveBalance.compensatory || 0) >= 10 : false,
      compExpiring: !!(liveBalance?.compExpiringDays > 0),
      compExpired: !!(liveBalance?.compExpiredDays > 0),
      availableNow,
      confidence,
    };
  });

  rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const payload = {
    entity: entityName,
    // Reflect the requested as-of date so the UI header ("as of …") and any
    // consumer of this field match what was actually computed. Without this it
    // always stamped "now", making honored past-date requests look ignored.
    asOf: asOfDate ? new Date(asOfDate + 'T00:00:00Z').toISOString() : today.toISOString(),
    count: rows.length,
    flags: {
      annualHigh: rows.filter(r => r.annualHigh).length,  // 30+ annual days
      compHigh: rows.filter(r => r.compHigh).length,       // 10+ compensatory days
      compExpiring: rows.filter(r => r.compExpiring).length, // comp additions expiring soon
      compExpired: rows.filter(r => r.compExpired).length,   // comp additions already expired
    },
    rows,
    // Diagnostic: when 0 rows match, surface what entities WERE seen in user
    // records so we can spot normalization or field-path mismatches.
    diagnostic: rows.length === 0
      ? {
          reason: 'No employees matched the requested entity.',
          totalUsers: users.length,
          dedupedUsers: deduped.length,
          entitiesSeenInUserRecords: Array.from(entitiesSeen).sort(),
          requestedEntity: entityName,
        }
      : undefined,
  };
  if (!absencesDegraded) cache.balances.set(key, { value: payload, expiresAt: Date.now() + BALANCES_TTL_MS });
  return payload;
}

// Wrapper for the audit module — gives it the cached user list.
export async function fetchAllUsersForAudit() {
  return fetchAllUsers();
}

export function clearCaches() {
  cache.entities = { value: null, expiresAt: 0 };
  cache.departments = { value: null, expiresAt: 0 };
  cache.balances.clear();
  cache.balancesMap.clear();
  cache.allUsers = { value: null, expiresAt: 0 };
  cache.basics = { value: new Map(), expiresAt: 0 };
}

// ---- Internals -------------------------------------------------------

// Candidate endpoint paths Zelt might expose. We try them in order.
// First successful response wins; cache the winner for the rest of the session.
const USERS_ENDPOINT_CANDIDATES = [
  '/apiv2/partner/users',
  '/apiv2/partner/companies/users',
  '/apiv2/partner/findbycompanyid',
  '/apiv2/users/cache',
];
let resolvedUsersEndpoint = null;

// Try these for legal entities directly. NOTE: /apiv2/partner/sites returns
// SITES (KSA Production, Jeddah Production), not legal entities (Mountain Peak
// KSA, Basecamp KSA). Excluded — we want entities, not sites.
const ENTITY_ENDPOINT_CANDIDATES = [
  '/apiv2/partner/entities',
  '/apiv2/partner/legal-entities',
  '/apiv2/partner/companies/entities',
];

function readItems(json) {
  return json.items || json.data || (Array.isArray(json) ? json : []);
}

// Distinguishes "auth/connection broken" errors from "this endpoint isn't the
// right one." The endpoint-discovery loops below should swallow the latter
// (try the next candidate) but immediately rethrow the former — otherwise an
// expired/rejected access token surfaces as the misleading "no working users
// endpoint" error after probing each candidate.
function isAuthFailure(err) {
  return err.status === 401
    || err.status === 403
    || /NotConnected|Refresh failed/.test(err.message || '');
}

async function resolveUsersEndpoint() {
  if (resolvedUsersEndpoint) return resolvedUsersEndpoint;
  for (const path of USERS_ENDPOINT_CANDIDATES) {
    try {
      const probe = await zeltGet(path, { page: 1, pageSize: 1 });
      if (readItems(probe) != null) {
        resolvedUsersEndpoint = path;
        console.log(`[zelt] resolved users endpoint: ${path}`);
        return path;
      }
    } catch (err) {
      if (isAuthFailure(err)) throw err;
      console.warn(`[zelt] users endpoint ${path} failed: ${err.status || ''} ${err.message}`);
    }
  }
  throw new Error(
    'Could not find a working users endpoint on Zelt partner API. ' +
    'Tried: ' + USERS_ENDPOINT_CANDIDATES.join(', ') +
    '. Check render logs for upstream errors. May need scope confirmation from Zelt CSM.'
  );
}

async function fetchUsersFirstPages(maxPages) {
  const endpoint = await resolveUsersEndpoint();
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const json = await zeltGet(endpoint, { page, pageSize: PAGE_SIZE });
    const items = readItems(json);
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

const MAX_USER_PAGES = 50; // hard safety: 50 × PAGE_SIZE = 5000 users

async function fetchAllUsers() {
  // Cache full user list across calls — heaviest fetch in the system.
  if (cache.allUsers.value && cache.allUsers.expiresAt > Date.now()) {
    return cache.allUsers.value;
  }

  // FAST PATH: bot cookie can hit /apiv2/users/cache which returns ALL users in
  // a single non-paginated call AND includes employeeId natively (partner
  // endpoint omits it, forcing N extra calls). Cuts cold start by 15-30s.
  if (botConfigured()) {
    try {
      const data = await botGet('/apiv2/users/cache');
      const list = Array.isArray(data) ? data : readItems(data);
      if (list.length > 0) {
        cache.allUsers = { value: list, expiresAt: Date.now() + ALL_USERS_TTL_MS };
        console.log(`[zelt-bot] users/cache returned ${list.length} users in one call`);
        return list;
      }
    } catch (err) {
      console.warn(`[zelt-bot] users/cache failed (${err.status || ''} ${err.message}), falling back to partner endpoint`);
    }
  }

  // Fallback: partner endpoint, paginated.
  const endpoint = await resolveUsersEndpoint();
  const all = [];
  let page = 1;
  while (true) {
    const json = await zeltGet(endpoint, { page, pageSize: PAGE_SIZE });
    const items = readItems(json);
    all.push(...items);
    const totalPages = json.totalPages ?? null;
    if (totalPages != null) {
      if (page >= totalPages) break;
    } else if (items.length < PAGE_SIZE) {
      break;
    }
    page++;
    if (page > MAX_USER_PAGES) break;
  }
  cache.allUsers = { value: all, expiresAt: Date.now() + ALL_USERS_TTL_MS };
  return all;
}

// Fetches "Available Now" via the bot session against Zelt's internal
// /apiv2/absences/company/balance. Returns map: userId → balance summary.
const ANNUAL_POLICY_PROBE_LIMIT = 30;
const WORKDAY_MINUTES_FALLBACK = 480; // 8h × 60m — Zelt's default workday
// Zelt adds annual policies per legal entity over time (158 policies as of
// Oct 2026) — a forever-cached ID list silently skips employees on any policy
// created after the process started, so re-discover on a TTL.
const POLICY_IDS_TTL_MS = 6 * 60 * 60 * 1000;
let resolvedAnnualPolicyIds = null;
let resolvedAnnualPolicyAt = 0;
let resolvedCompPolicyIds = [];  // "Compensatory Days" policies — resolved alongside annual

async function tryFetchBalances(userIds, asOfDate = null, prodByUser = new Map()) {
  if (!userIds.length) return new Map();

  // Company-wide result, cached by as-of date — the balance endpoint is pulled
  // for everyone regardless of entity, so a second entity or a retry reuses it
  // instead of re-running the whole expensive fetch.
  const balKey = asOfDate || 'now';
  const balCached = cache.balancesMap.get(balKey);
  if (balCached && balCached.expiresAt > Date.now()) return balCached.value;
  const balances = new Map();

  // Use the bot session if configured — partner OAuth token can't reach
  // /apiv2/absences/company/balance (confirmed 401). Bot user is authorised
  // via "Manage absences for everyone" permission and cookie auth.
  if (!botConfigured()) {
    console.warn('[zelt] bot not configured (set ZELT_BOT_EMAIL/PASSWORD) — Available Now unavailable');
    return balances;
  }

  // Step 1: discover annual-vacation policy IDs (re-discovered on a TTL; a
  // failure is NOT cached — the next request retries instead of staying blank
  // until a restart).
  if (resolvedAnnualPolicyIds == null || Date.now() - resolvedAnnualPolicyAt > POLICY_IDS_TTL_MS) {
    try {
      const policies = await botGet('/apiv2/absence-policies/extended');
      const arr = Array.isArray(policies) ? policies : (policies?.items || []);
      // Skip unpaid policies — they're zero-balance shadow policies that
      // pollute the aggregated 'policy' column for users on the paid plan.
      resolvedAnnualPolicyIds = arr
        .filter(p => {
          const n = p.name || p.policyName || '';
          return /annual|vacation/i.test(n) && !/unpaid/i.test(n);
        })
        .map(p => p.id)
        .slice(0, ANNUAL_POLICY_PROBE_LIMIT);
      resolvedCompPolicyIds = arr
        .filter(p => /compensator/i.test(p.name || p.policyName || ''))
        .map(p => p.id)
        .slice(0, ANNUAL_POLICY_PROBE_LIMIT);
      resolvedAnnualPolicyAt = Date.now();
      console.log(`[zelt-bot] found ${resolvedAnnualPolicyIds.length} paid annual-vacation policies`);
    } catch (err) {
      console.warn(`[zelt-bot] /absence-policies/extended failed (${err.status || ''} ${err.message}) — Available Now unavailable this run`);
      if (resolvedAnnualPolicyIds == null) return balances; // nothing cached — retry next request
    }
  }
  if (!resolvedAnnualPolicyIds.length) return balances;

  // Step 2: pull balance per policy (paginated), aggregate by userId. Run in parallel.
  const policyResults = await Promise.all(resolvedAnnualPolicyIds.map(async (pid) => {
    const all = [];
    let page = 1;
    while (true) {
      try {
        const params = {
          policyId: pid,
          Calendar: 'current',
          page,
          pageSize: PAGE_SIZE,
        };
        if (asOfDate) params.asOfDate = asOfDate;
        const data = await botGet('/apiv2/absences/company/balance', params);
        const items = data.items || [];
        all.push(...items.map(item => ({ item, pid })));
        if (page >= (data.totalPages || 1)) break;
        page++;
      } catch (err) {
        console.warn(`[zelt-bot] /absences/company/balance pid=${pid} page=${page} failed: ${err.status || ''} ${err.message}`);
        break;
      }
    }
    return all;
  }));

  for (const policyItems of policyResults) {
    for (const { item, pid } of policyItems) {
      const uid = item.userId;
      const policyData = item[pid];
      if (!policyData) continue;
      const workdayMinutes = policyData.currentAverageWorkDayLength || WORKDAY_MINUTES_FALLBACK;
      // For PAST as-of-date queries: prefer Zelt's currentBalanceInDaysAsOfDate
      // — it's the exact balance on that day. Fall back to live formula otherwise.
      // Zelt counts PENDING requests INSIDE unitsTaken.upcoming/history, with
      // *Pending as the awaiting-approval SUBSET (verified live: one 31-day
      // pending request shows upcoming=14880 AND upcomingPending=14880, while
      // totalRegularUnits counts it once). Upcoming here = APPROVED only;
      // pending is reported separately.
      const upcApprovedMin = Math.max(0, (policyData.unitsTaken?.upcoming || 0) - (policyData.unitsTaken?.upcomingPending || 0));
      let accrued;
      if (asOfDate && policyData.currentBalanceInDaysAsOfDate != null) {
        accrued = policyData.currentBalanceInDaysAsOfDate;
      } else {
        // Live "Available now" = holidayAccruedToBookNow + APPROVED upcoming
        // bookings (don't subtract future bookings — locked rule from
        // leave-recon; unapproved requests must not inflate it).
        accrued = ((policyData.holidayAccruedToBookNow || 0) + upcApprovedMin) / workdayMinutes;
      }
      const upcoming = upcApprovedMin / workdayMinutes;
      const pending = ((policyData.unitsTaken?.historyPending || 0) + (policyData.unitsTaken?.upcomingPending || 0)) / workdayMinutes;
      // Zelt's headline number (what its own UI shows): full-cycle balance
      // today, in days. Kept verbatim so the page can be eyeballed against Zelt.
      const zeltBal = policyData.currentBalanceInDays != null
        ? policyData.currentBalanceInDays
        : (policyData.currentBalance || 0) / workdayMinutes;
      // totalAllowanceForCycle now has public holidays baked in (e.g. 36d shown
      // for a 21d allowance) — strip them to get the real annual allowance.
      const total = ((policyData.totalAllowanceForCycle || 0)
        - (policyData.unitsTaken?.totalPublicHolidays || 0)
        - (policyData.unitsLeft?.unusedPublicHolidays || 0)) / workdayMinutes;
      // Projected end-of-year (Dec 31) balance = full-cycle entitlement minus
      // everything taken/booked this cycle. Mirrors Zelt's "Remaining by Dec 31"
      // (Allowance − Taken − Booked), assuming no further leave is booked.
      const histDays = (policyData.unitsTaken?.history || 0) / workdayMinutes;
      const upcDays = (policyData.unitsTaken?.upcoming || 0) / workdayMinutes;
      const eoy = total - histDays - upcDays;
      const prev = balances.get(uid) || { available_now: 0, upcoming_booked: 0, pending: 0, zelt_balance: 0, total: 0, end_of_year: 0, compensatory: 0, policyName: null };
      balances.set(uid, {
        available_now: prev.available_now + accrued,
        upcoming_booked: prev.upcoming_booked + upcoming,
        pending: prev.pending + pending,
        zelt_balance: prev.zelt_balance + zeltBal,
        total: prev.total + total,
        end_of_year: prev.end_of_year + eoy,
        compensatory: prev.compensatory,
        policyName: prev.policyName || policyData.policyName || null,
      });
    }
  }

  // Compensatory Days balance per user (currentBalanceInDays, summed across the
  // comp policies). Added onto the same map so the leave page shows it alongside
  // annual.
  if (resolvedCompPolicyIds.length) {
    const compResults = await Promise.all(resolvedCompPolicyIds.map(async (pid) => {
      const all = [];
      let page = 1;
      while (true) {
        try {
          const params = { policyId: pid, Calendar: 'current', page, pageSize: PAGE_SIZE };
          if (asOfDate) params.asOfDate = asOfDate;
          const data = await botGet('/apiv2/absences/company/balance', params);
          all.push(...(data.items || []).map(item => ({ item, pid })));
          if (page >= (data.totalPages || 1)) break;
          page++;
        } catch { break; }
      }
      return all;
    }));
    const compHolders = []; // { uid, pid, wd } — users with a live comp balance
    for (const items of compResults) {
      for (const { item, pid } of items) {
        const d = item[pid];
        if (!d) continue;
        const wd = d.currentAverageWorkDayLength || WORKDAY_MINUTES_FALLBACK;
        const days = (asOfDate && d.currentBalanceInDaysAsOfDate != null)
          ? d.currentBalanceInDaysAsOfDate
          : (d.currentBalanceInDays != null ? d.currentBalanceInDays : (d.currentBalance || 0) / wd);
        const prev = balances.get(item.userId) || { available_now: 0, upcoming_booked: 0, pending: 0, zelt_balance: 0, total: 0, end_of_year: 0, compensatory: 0, policyName: null };
        balances.set(item.userId, { ...prev, compensatory: (prev.compensatory || 0) + (Number(days) || 0) });
        if ((Number(days) || 0) !== 0) compHolders.push({ uid: item.userId, pid, wd, isProd: prodByUser.get(item.userId) === true });
      }
    }
    // For each comp holder, pull the DATED one-off additions (date + note + days)
    // from the allowance endpoint, and compute a 9-month expiry PER addition.
    await enrichCompAdditions(compHolders, balances, asOfDate);
  }
  // Cache the full company-wide map (only meaningful results worth reusing).
  if (balances.size > 0) cache.balancesMap.set(balKey, { value: balances, expiresAt: Date.now() + BALANCES_TTL_MS });
  return balances;
}

const COMP_EXPIRY_MONTHS_PROD = 9;     // production crew: comp additions expire 9 months after the add date
const COMP_EXPIRY_MONTHS_NONPROD = 3;  // office / non-production: 3 months
const COMP_EXPIRING_SOON_DAYS = 45;    // flag additions expiring within this window

// Classify a Zelt user record as production vs non-production. Production crew
// (Kitchen/Dispatch/Stewarding/Logistics, or anyone sitting at a Production
// facility) keep the 9-month comp window; everyone else gets 3 months. Office
// departments are always non-production even when posted to a production site.
function isProductionEmployee(u) {
  const dept = u?.role?.department?.name || u?.department?.name || u?.department || '';
  const site = u?.role?.site?.name || u?.site?.name || u?.site || '';
  if (isOfficeDept(dept)) return false;      // Finance/Legal/People/… never production
  if (isProductionDept(dept)) return true;   // canonical production department
  if (/\bproduction\b/i.test(site)) return true; // "KSA Production", "Kuwait Production", …
  return false;                              // blank/other → non-production (shorter window)
}

function addMonths(iso, n) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() < day) d.setUTCDate(0); // clamp end-of-month overflow
  return d.toISOString().slice(0, 10);
}

// Transition rule (the per-batch expiry policy is not operational yet): every
// compensatory addition dated ON OR BEFORE the policy start keeps a single
// grace expiry — 9 months after 15 Oct 2026 = 15 Jul 2027 — instead of being
// retroactively expired on its own add-date + 3/9 months. Grants created AFTER
// the start follow the real per-type rule. Drop/extend COMP_POLICY_START once
// the policy goes live.
const COMP_POLICY_START = '2026-10-15';
const COMP_POLICY_GRACE_MONTHS = 9;
const COMP_OLD_EXPIRY = addMonths(`${COMP_POLICY_START}T00:00:00Z`, COMP_POLICY_GRACE_MONTHS); // '2027-07-15'

// Fetch each comp holder's one-off adjustment entries and attach compAdditions
// (with 9-month expiry) to their balance summary. Concurrency-capped for the WAF.
async function enrichCompAdditions(holders, balances, asOfDate) {
  if (!holders.length) return;
  const year = (asOfDate ? new Date(asOfDate) : new Date()).getUTCFullYear();
  const refNow = asOfDate ? new Date(asOfDate + 'T00:00:00Z') : new Date();
  const CONCURRENCY = 4;
  const queue = [...holders];
  const worker = async () => {
    while (queue.length) {
      const { uid, pid, wd, isProd } = queue.shift();
      // Production crew keep 9 months; office / non-production expire in 3.
      const expiryMonths = isProd ? COMP_EXPIRY_MONTHS_PROD : COMP_EXPIRY_MONTHS_NONPROD;
      try {
        const data = await botGet(`/apiv2/absence-policies/${pid}/users/${uid}/allowances/${year}`);
        const entries = (data?.oneOffAdjustmentEntries || []).filter(e => (e.value || 0) > 0); // additions only, not debits
        if (!entries.length) continue;
        const additions = entries.map(e => {
          const addDate = (e.createdAt || '').slice(0, 10);
          // Grace for existing days: anything added on/before the policy start
          // all expires together on 15 Jul 2027. Newer grants use the per-type
          // window (3mo non-production / 9mo production) from the add date.
          const grace = !!addDate && addDate <= COMP_POLICY_START;
          const expiresOn = grace ? COMP_OLD_EXPIRY : addMonths(e.createdAt, expiryMonths);
          const days = +((e.value || 0) / (wd || WORKDAY_MINUTES_FALLBACK)).toFixed(2);
          const exp = expiresOn ? new Date(expiresOn + 'T00:00:00Z') : null;
          const daysToExpiry = exp ? Math.round((exp - refNow) / 86400000) : null;
          const status = daysToExpiry == null ? 'active' : (daysToExpiry < 0 ? 'expired' : (daysToExpiry <= COMP_EXPIRING_SOON_DAYS ? 'expiring' : 'active'));
          return { addDate, days, note: e.notes || '', expiresOn, daysToExpiry, status, expiryMonths: grace ? null : expiryMonths, grace };
        }).sort((a, b) => (a.addDate < b.addDate ? -1 : 1));
        const expiringDays = additions.filter(a => a.status === 'expiring').reduce((s, a) => s + a.days, 0);
        const expiredDays = additions.filter(a => a.status === 'expired').reduce((s, a) => s + a.days, 0);
        const prev = balances.get(uid);
        if (prev) balances.set(uid, { ...prev, compAdditions: additions, compExpiringDays: round1(expiringDays), compExpiredDays: round1(expiredDays), compExpiryMonths: expiryMonths, isProduction: !!isProd });
      } catch { /* best-effort per user */ }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// ---- Company-wide compensatory-expiry aggregates (COUNTS ONLY) ----------
// Powers the weekly HR Hub Slack alert. Never returns names — only counts and
// day totals, split production (9-month window) vs non-production (3-month).

// Pure: roll a list of comp holders up into counts. A holder is
// { isProduction, compensatory, compExpiringDays, compExpiredDays }.
export function summarizeCompExpiry(holders) {
  const bucket = () => ({ holders: 0, highComp: 0, totalDays: 0, expiringEmployees: 0, expiringDays: 0, expiredEmployees: 0, expiredDays: 0 });
  const all = bucket(), production = bucket(), nonProduction = bucket();
  const add = (b, h) => {
    b.holders += 1;
    b.totalDays += Number(h.compensatory) || 0;
    if ((Number(h.compensatory) || 0) >= 10) b.highComp += 1;
    if ((Number(h.compExpiringDays) || 0) > 0) { b.expiringEmployees += 1; b.expiringDays += Number(h.compExpiringDays) || 0; }
    if ((Number(h.compExpiredDays) || 0) > 0) { b.expiredEmployees += 1; b.expiredDays += Number(h.compExpiredDays) || 0; }
  };
  for (const h of holders || []) {
    add(all, h);
    add(h.isProduction ? production : nonProduction, h);
  }
  const fin = (b) => ({ ...b, totalDays: round1(b.totalDays), expiringDays: round1(b.expiringDays), expiredDays: round1(b.expiredDays) });
  return {
    all: fin(all),
    production: fin(production),
    nonProduction: fin(nonProduction),
    window: { expiringSoonDays: COMP_EXPIRING_SOON_DAYS, prodMonths: COMP_EXPIRY_MONTHS_PROD, nonProdMonths: COMP_EXPIRY_MONTHS_NONPROD },
  };
}

// Async: scan every compensatory policy company-wide, enrich dated additions,
// and return counts PLUS a named per-employee list (name, employee ID, comp
// days, next expiry) for the HR Slack alert — the HR channel is restricted, so
// names are intended here. Independent of tryFetchBalances (leave page) so that
// path stays untouched. Best-effort: returns zeros/available:false on failure.
export async function getCompExpiryAggregates(asOfDate = null) {
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  if (!botConfigured()) {
    return { available: false, reason: 'Zelt bot not configured', asOf, ...summarizeCompExpiry([]) };
  }

  // Discover compensatory policy IDs (own lookup — does not touch the shared
  // annual/comp policy cache used by the leave page).
  let compPolicyIds = [];
  try {
    const policies = await botGet('/apiv2/absence-policies/extended');
    const arr = Array.isArray(policies) ? policies : (policies?.items || []);
    compPolicyIds = arr
      .filter(p => /compensator/i.test(p.name || p.policyName || ''))
      .map(p => p.id)
      .slice(0, ANNUAL_POLICY_PROBE_LIMIT);
  } catch (err) {
    return { available: false, reason: `policy lookup failed (${err.status || ''} ${err.message})`, asOf, ...summarizeCompExpiry([]) };
  }
  if (!compPolicyIds.length) {
    return { available: true, asOf, ...summarizeCompExpiry([]) };
  }

  // Employed users only → production/non-production map (same employed filter
  // as the balances path, minus the entity/department scoping).
  const users = await fetchAllUsers();
  const seen = new Map();
  for (const u of users) {
    const k = u.userId || u.id || u.employeeId || JSON.stringify(u).slice(0, 40);
    if (!seen.has(k)) seen.set(k, u);
  }
  const prodByUser = new Map();
  const nameByUser = new Map();
  const empIdByUser = new Map();
  for (const u of seen.values()) {
    const status = u?.accountStatus || u?.status || u?.lifecycle?.status;
    if (status === 'Deactivated' || status === 'Terminated') continue;
    const eventStatus = u?.userEvent?.status || u?.lifecycle?.status;
    if (eventStatus === 'Terminated' || eventStatus === 'Resigned' || eventStatus === 'Offboarded') continue;
    if (u?.leaveDate || u?.lifecycle?.leaveDate) continue;
    const uid = u.userId || u.id;
    prodByUser.set(uid, isProductionEmployee(u));
    nameByUser.set(uid, readName(u));
    empIdByUser.set(uid, readEmployeeId(u) ?? null);
  }

  // Comp balance per policy (paginated), employed users only.
  const balances = new Map();
  const compHolders = [];
  const compResults = await Promise.all(compPolicyIds.map(async (pid) => {
    const all = [];
    let page = 1;
    while (true) {
      try {
        const params = { policyId: pid, Calendar: 'current', page, pageSize: PAGE_SIZE };
        if (asOfDate) params.asOfDate = asOfDate;
        const data = await botGet('/apiv2/absences/company/balance', params);
        all.push(...(data.items || []).map(item => ({ item, pid })));
        if (page >= (data.totalPages || 1)) break;
        page++;
      } catch { break; }
    }
    return all;
  }));
  for (const items of compResults) {
    for (const { item, pid } of items) {
      if (!prodByUser.has(item.userId)) continue; // employed users only
      const d = item[pid];
      if (!d) continue;
      const wd = d.currentAverageWorkDayLength || WORKDAY_MINUTES_FALLBACK;
      const days = (asOfDate && d.currentBalanceInDaysAsOfDate != null)
        ? d.currentBalanceInDaysAsOfDate
        : (d.currentBalanceInDays != null ? d.currentBalanceInDays : (d.currentBalance || 0) / wd);
      const isProd = prodByUser.get(item.userId) === true;
      const prev = balances.get(item.userId) || { compensatory: 0, isProduction: isProd };
      balances.set(item.userId, { ...prev, compensatory: (prev.compensatory || 0) + (Number(days) || 0) });
      if ((Number(days) || 0) !== 0) compHolders.push({ uid: item.userId, pid, wd, isProd });
    }
  }
  await enrichCompAdditions(compHolders, balances, asOfDate);

  // Keep only employees who actually hold (or recently held) comp days. Build
  // the counts input AND the named list (for the HR Slack alert) in one pass.
  const holders = [];
  const list = [];
  for (const [uid, b] of balances) {
    const held = (Number(b.compensatory) || 0) > 0 || (b.compExpiringDays || 0) > 0 || (b.compExpiredDays || 0) > 0;
    if (!held) continue;
    holders.push({
      isProduction: b.isProduction === true,
      compensatory: b.compensatory || 0,
      compExpiringDays: b.compExpiringDays || 0,
      compExpiredDays: b.compExpiredDays || 0,
    });
    const adds = Array.isArray(b.compAdditions) ? b.compAdditions : [];
    const expiries = adds.map(a => a.expiresOn).filter(Boolean).sort();
    const status = adds.some(a => a.status === 'expired') ? 'expired'
      : adds.some(a => a.status === 'expiring') ? 'expiring' : 'active';
    list.push({
      name: nameByUser.get(uid) || '(unknown)',
      employeeId: empIdByUser.get(uid) || null,
      isProduction: b.isProduction === true,
      compDays: round1(b.compensatory || 0),
      nextExpiry: expiries[0] || null,
      status,
    });
  }
  // Soonest expiry first; employees with no dated expiry sort to the end.
  list.sort((a, b) => {
    if (a.nextExpiry && b.nextExpiry) return a.nextExpiry < b.nextExpiry ? -1 : (a.nextExpiry > b.nextExpiry ? 1 : (b.compDays - a.compDays));
    if (a.nextExpiry) return -1;
    if (b.nextExpiry) return 1;
    return b.compDays - a.compDays;
  });
  return { available: true, asOf, ...summarizeCompExpiry(holders), list };
}

// Company-wide compensatory ledger for an HR report: per employee, the dated
// additions (credits) and the comp days taken. Admin-only.
export async function getCompLedger() {
  const asOf = new Date().toISOString().slice(0, 10);
  const empty = (reason) => ({ available: !reason, reason: reason || null, asOf, summary: [], additions: [], taken: [] });
  if (!botConfigured()) return empty('Zelt bot not configured');

  let compPolicyIds = [];
  try {
    const policies = await botGet('/apiv2/absence-policies/extended');
    const arr = Array.isArray(policies) ? policies : (policies?.items || []);
    compPolicyIds = arr.filter(p => /compensator/i.test(p.name || p.policyName || '')).map(p => p.id).slice(0, ANNUAL_POLICY_PROBE_LIMIT);
  } catch (e) { return empty(`policy lookup failed (${e.status || ''} ${e.message})`); }
  if (!compPolicyIds.length) return { ...empty(), available: true };

  // Employed users → info (name, employeeId, entity, department, prod flag).
  const users = await fetchAllUsers();
  const seen = new Map();
  for (const u of users) { const k = u.userId || u.id || u.employeeId || JSON.stringify(u).slice(0, 40); if (!seen.has(k)) seen.set(k, u); }
  const info = new Map();
  for (const u of seen.values()) {
    const status = u?.accountStatus || u?.status || u?.lifecycle?.status;
    if (status === 'Deactivated' || status === 'Terminated') continue;
    const ev = u?.userEvent?.status || u?.lifecycle?.status;
    if (ev === 'Terminated' || ev === 'Resigned' || ev === 'Offboarded') continue;
    if (u?.leaveDate || u?.lifecycle?.leaveDate) continue;
    const uid = u.userId || u.id;
    info.set(uid, {
      name: readName(u),
      employeeId: readEmployeeId(u) ?? null,
      entity: readEntity(u),
      department: u?.role?.department?.name || u?.department?.name || u?.department || null,
      isProduction: isProductionEmployee(u),
    });
  }

  // Comp balances → holders (non-zero balance).
  const balances = new Map();
  const compHolders = [];
  const compResults = await Promise.all(compPolicyIds.map(async (pid) => {
    const all = []; let page = 1;
    while (true) {
      try {
        const data = await botGet('/apiv2/absences/company/balance', { policyId: pid, Calendar: 'current', page, pageSize: PAGE_SIZE });
        all.push(...(data.items || []).map(item => ({ item, pid })));
        if (page >= (data.totalPages || 1)) break;
        page++;
      } catch { break; }
    }
    return all;
  }));
  for (const items of compResults) {
    for (const { item, pid } of items) {
      if (!info.has(item.userId)) continue;
      const d = item[pid]; if (!d) continue;
      const wd = d.currentAverageWorkDayLength || WORKDAY_MINUTES_FALLBACK;
      const bal = d.currentBalanceInDays != null ? d.currentBalanceInDays : (d.currentBalance || 0) / wd;
      const prev = balances.get(item.userId) || { compensatory: 0, wd };
      balances.set(item.userId, { ...prev, compensatory: (prev.compensatory || 0) + (Number(bal) || 0), wd });
      if ((Number(bal) || 0) !== 0) compHolders.push({ uid: item.userId, pid, wd, isProd: info.get(item.userId).isProduction });
    }
  }
  // Pull the dated adjustments per holder: credits (value > 0) and debits
  // (value < 0 = comp used) across this year and last. Concurrency-capped.
  const years = [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1];
  const creditsByUid = new Map(), debitsByUid = new Map();
  const queue = [...compHolders];
  const worker = async () => {
    while (queue.length) {
      const { uid, pid, wd } = queue.shift();
      for (const yr of years) {
        try {
          const data = await botGet(`/apiv2/absence-policies/${pid}/users/${uid}/allowances/${yr}`);
          for (const e of (data?.oneOffAdjustmentEntries || [])) {
            const v = Number(e.value) || 0;
            if (v === 0) continue;
            const row = { date: (e.createdAt || '').slice(0, 10), days: round1(Math.abs(v) / (wd || WORKDAY_MINUTES_FALLBACK)), note: e.notes || '' };
            const m = v > 0 ? creditsByUid : debitsByUid;
            const arr = m.get(uid) || []; arr.push(row); m.set(uid, arr);
          }
        } catch { /* best-effort per user/year */ }
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  // Comp-policy absences (the other possible "taken" channel), holders only.
  const holderUids = [...new Set(compHolders.map(h => h.uid))];
  let absMap = new Map();
  try { absMap = await fetchAbsencesByUser(holderUids); } catch { /* best-effort */ }

  const summary = [], additions = [], taken = [];
  for (const uid of holderUids) {
    const i = info.get(uid) || {};
    const b = balances.get(uid) || { compensatory: 0, wd: WORKDAY_MINUTES_FALLBACK };
    const credits = (creditsByUid.get(uid) || []).sort((x, y) => (x.date < y.date ? -1 : 1));
    const debits = (debitsByUid.get(uid) || []).map(d => ({ ...d, note: d.note || 'adjustment' }));
    const compAbs = (absMap.get(uid) || [])
      .filter(ab => /compensat/i.test(String(ab.policy?.name || ab.policyName || ab.policy || '')))
      .map(ab => ({ date: String(ab.startDate || ab.start || '').slice(0, 10), days: round1(absenceDays(ab, b.wd)), note: `${ab.status || 'leave'} (absence)` }));
    const takenRows = [...debits, ...compAbs].sort((x, y) => (x.date < y.date ? -1 : 1));
    const totalAdded = round1(credits.reduce((s, a) => s + a.days, 0));
    const totalTaken = round1(takenRows.reduce((s, t) => s + t.days, 0));
    summary.push({ employeeId: i.employeeId, name: i.name, entity: i.entity, department: i.department, isProduction: i.isProduction === true, compBalance: round1(b.compensatory || 0), totalAdded, totalTaken });
    for (const a of credits) additions.push({ employeeId: i.employeeId, name: i.name, entity: i.entity, addDate: a.date, days: a.days, note: a.note });
    for (const t of takenRows) taken.push({ employeeId: i.employeeId, name: i.name, entity: i.entity, date: t.date, days: t.days, note: t.note });
  }
  summary.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { available: true, asOf, summary, additions, taken };
}

// Diagnostic: can the Hub's Zelt bot READ the dated compensatory-addition
// ledger (/absence-policies/{pid}/users/{uid}/allowances/{year})? Probes a few
// real comp holders and returns a NON-PII access result — HTTP status, counts
// and shape booleans only. Never returns names, dates or note text.
export async function probeCompAdditionsAccess() {
  const out = {
    botConfigured: botConfigured(),
    compPolicies: 0,
    holdersProbed: 0,
    allowancesOk: false,
    firstStatus: null,
    holdersWithEntries: 0,
    totalEntriesSeen: 0,
    shapeOk: null,
    note: null,
  };
  if (!botConfigured()) { out.note = 'Zelt bot not configured'; return out; }

  let compPolicyIds = [];
  try {
    const policies = await botGet('/apiv2/absence-policies/extended');
    const arr = Array.isArray(policies) ? policies : (policies?.items || []);
    compPolicyIds = arr.filter(p => /compensator/i.test(p.name || p.policyName || '')).map(p => p.id);
  } catch (err) {
    out.note = `policy lookup failed (${err.status || ''} ${err.message})`;
    return out;
  }
  out.compPolicies = compPolicyIds.length;
  if (!compPolicyIds.length) { out.note = 'no compensatory policies found'; return out; }

  // Gather up to 6 holders with a live comp balance (likeliest to have additions).
  const holders = [];
  for (const pid of compPolicyIds) {
    if (holders.length >= 6) break;
    try {
      const data = await botGet('/apiv2/absences/company/balance', { policyId: pid, Calendar: 'current', page: 1, pageSize: PAGE_SIZE });
      for (const it of (data.items || [])) {
        const d = it[pid];
        if ((Number(d?.currentBalanceInDays) || 0) > 0) {
          holders.push({ uid: it.userId, pid });
          if (holders.length >= 6) break;
        }
      }
    } catch { /* try next policy */ }
  }
  if (!holders.length) { out.note = 'no comp holders with a balance to probe'; return out; }

  const year = new Date().getUTCFullYear();
  for (const h of holders) {
    out.holdersProbed++;
    try {
      const data = await botGet(`/apiv2/absence-policies/${h.pid}/users/${h.uid}/allowances/${year}`);
      if (out.firstStatus == null) out.firstStatus = 200;
      out.allowancesOk = true;
      const entries = Array.isArray(data?.oneOffAdjustmentEntries) ? data.oneOffAdjustmentEntries : [];
      if (entries.length) {
        out.holdersWithEntries++;
        out.totalEntriesSeen += entries.length;
        if (out.shapeOk == null) out.shapeOk = ('createdAt' in entries[0] && 'value' in entries[0]);
      }
    } catch (err) {
      if (out.firstStatus == null) out.firstStatus = err.status || 'error';
    }
  }
  out.note = out.allowancesOk
    ? (out.holdersWithEntries
        ? 'Bot CAN read dated comp additions.'
        : 'Endpoint reachable, but none of the probed holders had one-off additions this year.')
    : `Allowances endpoint blocked for the bot (status ${out.firstStatus}).`;
  return out;
}

// Admin diagnostic: for one employee, dump the balance figures + the
// absence-derived taken/upcoming/pending, so a tool-vs-Zelt mismatch can be
// reconciled field by field.
export async function debugEmployeeBalance(empId) {
  const users = await fetchAllUsers();
  const u = users.find(x => String(readEmployeeId(x) || '').toLowerCase() === String(empId || '').toLowerCase());
  if (!u) return { error: 'employee not found', empId };
  const uid = u.userId || u.id;
  const [balMap, absMap] = await Promise.all([tryFetchBalances([uid]), fetchAbsencesByUser([uid])]);
  const lb = balMap.get(uid) || null;
  const userAbs = absMap.get(uid) || [];
  const today = new Date();
  const hy = today.getUTCFullYear();
  const yearStart = new Date(Date.UTC(hy, 0, 1)), yearEnd = new Date(Date.UTC(hy, 11, 31, 23, 59, 59));
  let history = 0, upcoming = 0, pending = 0, annual = 0;
  const byStatus = {};
  for (const ab of userAbs) {
    if (!isAnnualLeave(ab)) continue;
    annual++;
    const start = parseDateSafe(ab.start || ab.startDate);
    if (!start) continue;
    const st = String(ab.status || '').toLowerCase();
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (start < yearStart || start > yearEnd) continue;
    if (/reject|cancel|declin|withdraw/.test(st)) continue;
    const days = absenceDays(ab);
    const isPending = /pending|await|request|review/.test(st);
    if (start <= today) history += days;
    else if (isPending) pending += days;
    else upcoming += days;
  }
  return {
    empId, entity: readEntity(u),
    balanceEndpoint: lb ? { availableNow: round1(lb.available_now), upcomingBooked: round1(lb.upcoming_booked), pending: round1(lb.pending), endOfYear: round1(lb.end_of_year), total: round1(lb.total), zeltBalance: round1(lb.zelt_balance) } : null,
    absenceDerived: { history: round1(history), upcoming: round1(upcoming), pending: round1(pending), annualAbsencesAllYears: annual, byStatus },
  };
}

// Per-user basic info — the only place Zelt's partner API exposes employeeId.
// Probed once per session, then cached.
const BASIC_ENDPOINT_CANDIDATES = [
  uid => `/apiv2/partner/users/${uid}/basic`,
  uid => `/apiv2/partner/users/${uid}`,
  uid => `/apiv2/partner/users/basic/${uid}`,
];
let resolvedBasicEndpoint = null;

async function fetchUserBasics(userIds) {
  if (!userIds.length) return new Map();

  // Refresh cache if expired
  if (cache.basics.expiresAt < Date.now()) {
    cache.basics = { value: new Map(), expiresAt: Date.now() + BASICS_TTL_MS };
  }
  const cached = cache.basics.value;

  // Only fetch IDs we don't already have cached
  const toFetch = userIds.filter(uid => !cached.has(uid));
  if (toFetch.length === 0) {
    const out = new Map();
    for (const uid of userIds) if (cached.has(uid)) out.set(uid, cached.get(uid));
    return out;
  }

  // Probe once
  if (!resolvedBasicEndpoint) {
    for (const builder of BASIC_ENDPOINT_CANDIDATES) {
      try {
        const probe = await zeltGet(builder(userIds[0]));
        if (probe && (probe.employeeId || probe.basicInfo?.employeeId || probe.userBasic?.employeeId)) {
          resolvedBasicEndpoint = builder;
          console.log(`[zelt] resolved basic endpoint: ${builder('{id}')}`);
          break;
        }
      } catch (err) {
        if (isAuthFailure(err)) throw err;
        console.warn(`[zelt] basic endpoint ${builder('{id}')} failed: ${err.status || ''} ${err.message}`);
      }
    }
    if (!resolvedBasicEndpoint) {
      console.warn('[zelt] no working basic endpoint — employeeId will be unavailable');
      return new Map();
    }
  }

  // Parallel fetch with concurrency cap. Was 10 — Zelt's WAF (Akamai)
  // 403s at ~30 concurrent calls when the bigger entity-balance + absences
  // fetches are also running in parallel. Drop to 4 to stay well under the
  // bot-detection threshold.
  const CONCURRENCY = 4;
  const queue = [...toFetch];
  async function worker() {
    while (queue.length) {
      const uid = queue.shift();
      try {
        const data = await zeltGet(resolvedBasicEndpoint(uid));
        const employeeId = data.employeeId || data.basicInfo?.employeeId || data.userBasic?.employeeId;
        if (employeeId) cached.set(uid, employeeId);
      } catch { /* best-effort per-user lookup: one failure must not abort the batch */ }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Return only the requested IDs
  const out = new Map();
  for (const uid of userIds) if (cached.has(uid)) out.set(uid, cached.get(uid));
  return out;
}

async function fetchAbsencesByUser(userIds) {
  const map = new Map();
  map.incomplete = false;
  if (!userIds.length) return map;

  const year = new Date().getFullYear();
  // Run chunks IN PARALLEL — was serial, costing 5-10s per chunk × N chunks.
  const chunks = [];
  for (let i = 0; i < userIds.length; i += ABSENCE_USER_CHUNK_SIZE) chunks.push(userIds.slice(i, i + ABSENCE_USER_CHUNK_SIZE));

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fetchChunk = async (chunk) => {
    const all = [];
    let page = 1;
    while (true) {
      const json = await zeltGet('/apiv2/partner/absences', { userId: chunk.join(','), year, page, pageSize: PAGE_SIZE });
      const items = readItems(json);
      all.push(...items);
      const totalPages = json.totalPages ?? null;
      if (totalPages != null) {
        if (page >= totalPages) break;
      } else if (items.length < PAGE_SIZE) {
        break;
      }
      page++;
      if (page > MAX_USER_PAGES) break;
    }
    return all;
  };

  // Each chunk retries up to 3 times with backoff; a chunk that still fails
  // returns [] (so ONE bad chunk never zeroes everyone's upcoming/pending) and
  // marks the whole result incomplete so the caller won't cache the degraded data.
  let failed = 0;
  const results = await Promise.all(chunks.map(async (chunk) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await fetchChunk(chunk); }
      catch (err) {
        if (attempt === 2) { failed++; console.warn(`[zelt] absence chunk failed after retries (${err.status || ''} ${err.message})`); return []; }
        await sleep(400 * (attempt + 1));
      }
    }
    return [];
  }));

  for (const items of results) {
    for (const ab of items) {
      const uid = ab.userId || ab.user?.id || ab.user;
      if (uid == null) continue;
      const arr = map.get(uid) || [];
      arr.push(ab);
      map.set(uid, arr);
    }
  }
  map.incomplete = failed > 0;
  return map;
}

function absenceDays(ab, workdayMinutes = WORKDAY_MINUTES_FALLBACK) {
  // Prefer pre-computed day length if Zelt provides it.
  if (ab.lengthDays != null) return Number(ab.lengthDays) || 0;
  if (ab.totalDays != null) return Number(ab.totalDays) || 0;
  // The partner-absence record carries totalLength + lengthUnit. Zelt stores
  // these in MINUTES (same unit as the balance endpoint, where 480 = one day),
  // so convert to working days rather than counting calendar days (which would
  // over-count weekends inside a leave span).
  if (ab.totalLength != null) {
    // totalLength is in MINUTES regardless of lengthUnit (where "day" only means
    // the absence is booked in whole days); 480 min = one working day.
    return (Number(ab.totalLength) || 0) / (workdayMinutes || WORKDAY_MINUTES_FALLBACK);
  }
  const start = parseDateSafe(ab.start || ab.startDate);
  const end = parseDateSafe(ab.end || ab.endDate);
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / MS_PER_DAY) + 1); // calendar-days fallback
}

function isAnnualLeave(ab) {
  const policyName = String(ab.policyName || ab.policy?.name || ab.policy || '').toLowerCase();
  if (!policyName) return true; // assume yes if no name (safer to subtract)
  return policyName.includes('annual') || policyName.includes('vacation');
}

function parseDateSafe(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function numberOr(v, fallback) {
  const n = typeof v === 'number' ? v : v != null ? Number(v) : NaN;
  return isNaN(n) ? fallback : n;
}

function round1(v) {
  if (v == null || isNaN(v)) return v;
  return Math.round(v * 10) / 10;
}

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

// Debug helper. Returns FULL raw shape of first user — admin only, HR data
// is already what this app exposes. Used to map field paths.
export async function debugSampleUser() {
  const users = await fetchUsersFirstPages(1);
  if (!users.length) return { error: 'No users returned' };
  const u = users[0];
  // Find any keys that mention "id", "allowance", "days", "leave", "employee"
  // anywhere in the object — case-insensitive — to spot what we're missing.
  const interesting = findKeysByPattern(u, /id|allowance|days|leave|employee|contract/i);
  return {
    rawUser: u,
    extracted: {
      userId: u.userId || u.id,
      employeeId: readEmployeeId(u),
      name: readName(u),
      entity: readEntity(u),
    },
    keysContainingIdOrAllowance: interesting,
  };
}

function findKeysByPattern(obj, re, prefix = '', depth = 0, acc = []) {
  if (depth > 4 || obj === null || typeof obj !== 'object') return acc;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (re.test(k)) {
      acc.push({ path, value: typeof v === 'object' && v !== null ? '[object]' : v });
    }
    if (typeof v === 'object' && v !== null) {
      findKeysByPattern(v, re, path, depth + 1, acc);
    }
  }
  return acc;
}

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

const ENTITIES_TTL_MS = 6 * 60 * 60 * 1000; // 6h — entities barely change
const BALANCES_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 100;

const cache = {
  entities: { value: null, expiresAt: 0 },
  balances: new Map(), // key: entity → { value, expiresAt }
};

// ---- Public API ------------------------------------------------------

export async function listEntities() {
  if (cache.entities.value && cache.entities.expiresAt > Date.now()) {
    return cache.entities.value;
  }
  // Try a dedicated endpoint first — much faster than scanning all users.
  for (const path of ENTITY_ENDPOINT_CANDIDATES) {
    try {
      const data = await zeltGet(path, { page: 1, pageSize: 200 });
      const items = data.items || data.data || (Array.isArray(data) ? data : null);
      if (items && items.length > 0) {
        const set = new Set();
        for (const it of items) {
          const e = it.legalName || it.name || it.entity?.legalName;
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
      console.warn(`[zelt] entities endpoint ${path} failed: ${err.status || ''} ${err.message}`);
    }
  }

  // Fallback: scan users but cap at 5 pages (500 users) — usually enough to surface all entity names.
  console.log('[zelt] no dedicated entity endpoint, falling back to user scan (capped at 500 users)');
  const users = await fetchUsersFirstPages(5);
  const set = new Set();
  for (const u of users) {
    const e = u?.userContract?.entity?.legalName || u?.entity?.legalName || u?.entity;
    if (e && typeof e === 'string') set.add(e.trim());
  }
  const entities = Array.from(set).sort();
  cache.entities = { value: entities, expiresAt: Date.now() + ENTITIES_TTL_MS };
  return entities;
}

export async function getBalancesForEntity(entityName) {
  const key = entityName.toLowerCase();
  const cached = cache.balances.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const users = await fetchAllUsers();
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const yearEnd = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59);

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

  // Filter to currently employed in the requested entity
  const targets = deduped.filter(u => {
    const status = u?.accountStatus || u?.status || u?.lifecycle?.status;
    if (status === 'Deactivated' || status === 'Terminated') return false;
    if (u?.leaveDate || u?.lifecycle?.leaveDate) return false;
    const e = readEntity(u);
    if (e) entitiesSeen.add(e);
    if (!e) return false;
    const eNorm = e.toLowerCase().trim();
    // Exact first, then case-insensitive contains (handles minor variations)
    return eNorm === key || eNorm.includes(key) || key.includes(eNorm);
  });

  // Fetch absences year-to-date once, then group by userId
  const absencesByUser = await fetchAbsencesByUser(targets.map(u => u.userId || u.id));

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

    let history = 0;
    let upcoming = 0;
    let confidence = 'high';

    for (const ab of userAbs) {
      const days = absenceDays(ab);
      if (days <= 0) continue;
      const start = parseDateSafe(ab.start || ab.startDate);
      if (!start) { confidence = 'medium'; continue; }
      if (!isAnnualLeave(ab)) continue;
      if (start <= today) history += days;
      else upcoming += days;
    }

    let availableNow = null;
    if (allowance != null) {
      availableNow = round1(allowance + carryOver - history - upcoming);
    } else {
      confidence = 'low';
    }

    return {
      employeeId: readEmployeeId(u),
      userId,
      name: readName(u),
      site: u?.role?.site?.name || u?.site?.name || u?.site || null,
      department: u?.role?.department?.name || u?.department?.name || u?.department || null,
      jobTitle: u?.role?.jobPosition?.title || u?.jobTitle || u?.position || null,
      startDate: u.startDate || u?.lifecycle?.startDate || null,
      allowance,
      carryOver,
      history: round1(history),
      upcoming: round1(upcoming),
      availableNow,
      confidence,
    };
  });

  rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const payload = {
    entity: entityName,
    asOf: today.toISOString(),
    count: rows.length,
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
  cache.balances.set(key, { value: payload, expiresAt: Date.now() + BALANCES_TTL_MS });
  return payload;
}

export function clearCaches() {
  cache.entities = { value: null, expiresAt: 0 };
  cache.balances.clear();
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

async function fetchUsersFirstPages(maxPages) {
  const all = [];
  if (!resolvedUsersEndpoint) {
    // Run probe inline (same logic as fetchAllUsers, but cap pages).
    for (const path of USERS_ENDPOINT_CANDIDATES) {
      try {
        const probe = await zeltGet(path, { page: 1, pageSize: 1 });
        const items = probe.items || probe.data || (Array.isArray(probe) ? probe : null);
        if (items != null) { resolvedUsersEndpoint = path; break; }
      } catch { /* try next */ }
    }
    if (!resolvedUsersEndpoint) {
      throw new Error('No working users endpoint found on Zelt partner API.');
    }
  }
  for (let page = 1; page <= maxPages; page++) {
    const json = await zeltGet(resolvedUsersEndpoint, { page, pageSize: PAGE_SIZE });
    const items = json.items || json.data || (Array.isArray(json) ? json : []);
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchAllUsers() {
  let page = 1;
  const all = [];
  // Resolve endpoint on first call by probing each candidate
  if (!resolvedUsersEndpoint) {
    for (const path of USERS_ENDPOINT_CANDIDATES) {
      try {
        const probe = await zeltGet(path, { page: 1, pageSize: 1 });
        // Sanity check: must have items array or be an array
        const items = probe.items || probe.data || (Array.isArray(probe) ? probe : null);
        if (items != null) {
          resolvedUsersEndpoint = path;
          console.log(`[zelt] resolved users endpoint: ${path}`);
          break;
        }
      } catch (err) {
        console.warn(`[zelt] users endpoint ${path} failed: ${err.status || ''} ${err.message}`);
      }
    }
    if (!resolvedUsersEndpoint) {
      throw new Error(
        'Could not find a working users endpoint on Zelt partner API. ' +
        'Tried: ' + USERS_ENDPOINT_CANDIDATES.join(', ') +
        '. Check render logs for upstream errors. May need scope confirmation from Zelt CSM.'
      );
    }
  }

  while (true) {
    const json = await zeltGet(resolvedUsersEndpoint, { page, pageSize: PAGE_SIZE });
    const items = json.items || json.data || (Array.isArray(json) ? json : []);
    all.push(...items);
    const totalPages = json.totalPages ?? null;
    if (totalPages != null) {
      if (page >= totalPages) break;
    } else if (items.length < PAGE_SIZE) {
      break;
    }
    page++;
    if (page > 50) break; // hard safety: cap at 5000 users
  }
  return all;
}

async function fetchAbsencesByUser(userIds) {
  const map = new Map();
  if (!userIds.length) return map;

  const year = new Date().getFullYear();
  // Run chunks IN PARALLEL — was serial, costing 5-10s per chunk × N chunks.
  const chunks = [];
  for (let i = 0; i < userIds.length; i += 50) chunks.push(userIds.slice(i, i + 50));

  const results = await Promise.all(chunks.map(async (chunk) => {
    const all = [];
    let page = 1;
    while (true) {
      const json = await zeltGet('/apiv2/partner/absences', {
        userId: chunk.join(','),
        year,
        page,
        pageSize: PAGE_SIZE,
      });
      const items = json.items || json.data || (Array.isArray(json) ? json : []);
      all.push(...items);
      const totalPages = json.totalPages ?? null;
      if (totalPages != null) {
        if (page >= totalPages) break;
      } else if (items.length < PAGE_SIZE) {
        break;
      }
      page++;
      if (page > 50) break;
    }
    return all;
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
  return map;
}

function absenceDays(ab) {
  // Prefer pre-computed day length if Zelt provides it
  if (ab.lengthDays != null) return Number(ab.lengthDays) || 0;
  if (ab.totalDays != null) return Number(ab.totalDays) || 0;
  const start = parseDateSafe(ab.start || ab.startDate);
  const end = parseDateSafe(ab.end || ab.endDate);
  if (!start || !end) return 0;
  // Calendar days inclusive — matches the locked rule from leave-recon
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000) + 1);
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
  const fn = u?.firstName || u?.basicInfo?.firstName || u?.userBasic?.firstName || '';
  const ln = u?.lastName || u?.basicInfo?.lastName || u?.userBasic?.lastName || '';
  const composed = `${fn} ${ln}`.trim();
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

// Debug helper: returns one user with all top-level keys masked except names of fields,
// so we can identify field shape without leaking data. Used by /api/zelt/debug/sample.
export async function debugSampleUser() {
  const users = await fetchUsersFirstPages(1);
  if (!users.length) return { error: 'No users returned' };
  const u = users[0];
  const shape = describeShape(u);
  return {
    sampleKeys: Object.keys(u),
    shape,
    extracted: {
      userId: u.userId || u.id,
      employeeId: readEmployeeId(u),
      name: readName(u),
      entity: readEntity(u),
      hasUserContract: !!u.userContract,
      hasRole: !!u.role,
      hasLifecycle: !!u.lifecycle,
      allowanceCandidates: {
        userContractAllowance: u?.userContract?.allowance,
        contractAllowance: u?.contract?.allowance,
        allowance: u?.allowance,
      },
    },
  };
}

function describeShape(o, depth = 0) {
  if (depth > 3) return '…';
  if (o === null) return 'null';
  if (Array.isArray(o)) return `array[${o.length}]`;
  if (typeof o !== 'object') return typeof o;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = describeShape(v, depth + 1);
  }
  return out;
}

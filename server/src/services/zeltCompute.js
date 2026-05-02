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

const ENTITIES_TTL_MS = 6 * 60 * 60 * 1000; // 6h — entities barely change
const BALANCES_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 100;

const cache = {
  entities: { value: null, expiresAt: 0 },
  balances: new Map(), // key: entity → { value, expiresAt }
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
  // Try a dedicated endpoint first — much faster than scanning all users.
  for (const path of ENTITY_ENDPOINT_CANDIDATES) {
    try {
      const data = await zeltGet(path, { page: 1, pageSize: 200 });
      const items = readItems(data);
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
    return eNorm === key || eNorm.includes(key) || key.includes(eNorm);
  });

  const targetUserIds = targets.map(u => u.userId || u.id);

  // Skip the expensive per-user basics fetch if our user records already
  // contain employeeId (true when bot's /users/cache succeeded).
  const hasEmpIdAlready = targets.length > 0 && targets.every(u => readEmployeeId(u) != null);

  // Run absence fetch + (maybe) basic info + balance probe in parallel.
  const [absencesByUser, basicsByUser, balancesByUser] = await Promise.all([
    fetchAbsencesByUser(targetUserIds),
    hasEmpIdAlready ? Promise.resolve(new Map()) : fetchUserBasics(targetUserIds),
    tryFetchBalances(targetUserIds),
  ]);
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

    // PREFERRED: use the live "Available Now" from Zelt's internal balance endpoint
    // (matches what the Zelt UI shows on each employee's Time Planner widget).
    let availableNow = null;
    const liveBalance = balancesByUser.get(userId);
    if (liveBalance) {
      availableNow = round1(liveBalance.available_now);
      confidence = 'high';
    } else if (allowance != null) {
      // Fallback: compute from allowance + history + upcoming
      availableNow = round1(allowance + carryOver - history - upcoming);
    } else {
      confidence = 'low';
    }

    return {
      employeeId: readEmployeeId(u) ?? basicsByUser.get(userId) ?? null,
      userId,
      name: readName(u),
      site: u?.role?.site?.name || u?.site?.name || u?.site || null,
      department: u?.role?.department?.name || u?.department?.name || u?.department || null,
      jobTitle: u?.role?.jobPosition?.title || u?.jobTitle || u?.position || null,
      startDate: u.startDate || u?.lifecycle?.startDate || null,
      policy: liveBalance?.policyName || null,
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
let resolvedAnnualPolicyIds = null;

async function tryFetchBalances(userIds) {
  if (!userIds.length) return new Map();
  const balances = new Map();

  // Use the bot session if configured — partner OAuth token can't reach
  // /apiv2/absences/company/balance (confirmed 401). Bot user is authorised
  // via "Manage absences for everyone" permission and cookie auth.
  if (!botConfigured()) {
    console.warn('[zelt] bot not configured (set ZELT_BOT_EMAIL/PASSWORD) — Available Now unavailable');
    return balances;
  }

  // Step 1: discover annual-vacation policy IDs once
  if (resolvedAnnualPolicyIds == null) {
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
      console.log(`[zelt-bot] found ${resolvedAnnualPolicyIds.length} paid annual-vacation policies`);
    } catch (err) {
      console.warn(`[zelt-bot] /absence-policies/extended failed (${err.status || ''} ${err.message}) — Available Now unavailable`);
      resolvedAnnualPolicyIds = [];
    }
  }
  if (!resolvedAnnualPolicyIds.length) return balances;

  // Step 2: pull balance per policy (paginated), aggregate by userId. Run in parallel.
  const policyResults = await Promise.all(resolvedAnnualPolicyIds.map(async (pid) => {
    const all = [];
    let page = 1;
    while (true) {
      try {
        const data = await botGet('/apiv2/absences/company/balance', {
          policyId: pid,
          Calendar: 'current',
          page,
          pageSize: 100,
        });
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
      const wd = policyData.currentAverageWorkDayLength || WORKDAY_MINUTES_FALLBACK;
      // KEY: holidayAccruedToBookNow / workdayLength = "Available now"
      // Includes upcoming bookings already deducted. Add unitsTaken.upcoming back
      // per the locked rule from leave-recon (don't subtract future bookings).
      const accrued = ((policyData.holidayAccruedToBookNow || 0) + (policyData.unitsTaken?.upcoming || 0)) / wd;
      const upcoming = (policyData.unitsTaken?.upcoming || 0) / wd;
      const total = (policyData.totalAllowanceForCycle || 0) / wd;
      const prev = balances.get(uid) || { available_now: 0, upcoming_booked: 0, total: 0, policyName: null };
      balances.set(uid, {
        available_now: prev.available_now + accrued,
        upcoming_booked: prev.upcoming_booked + upcoming,
        total: prev.total + total,
        policyName: prev.policyName || policyData.policyName || null,
      });
    }
  }
  return balances;
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
        const eid = data.employeeId || data.basicInfo?.employeeId || data.userBasic?.employeeId;
        if (eid) cached.set(uid, eid);
      } catch { /* skip on error */ }
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

/**
 * Zelt report builder — generate a filtered people report straight from live
 * Zelt data: department / business line / org / entity / site, with optional
 * salary, age and gender.
 *
 * Why a cached "people index":
 *   Business Line, Organization, Job Family and Work Country are per-user
 *   CUSTOM fields on Zelt's `role` domain (NOT in /users/cache), and Zelt has
 *   no bulk ad-hoc report endpoint. Resolving them means one /role call per
 *   user. We do that ONCE, cache the enriched roster for 6h, and run every
 *   filter against the cache — so a report is instant and we never hammer
 *   Zelt's WAF per request.
 *
 * Sensitive fields (salary, age, gender) are fetched per-request for the
 * ALREADY-FILTERED subset only, are admin-gated at the route, and never leave
 * the server in any AI payload (aggregates to the narrative are PII-free).
 */
import { botGet, botConfigured } from './zeltBot.js';
import { fetchAllUsersForAudit } from './zeltCompute.js';

const INDEX_TTL_MS = 6 * 60 * 60 * 1000;   // 6h — role/BL/org barely change intraday
const ROLE_CONCURRENCY = 5;                 // stay well under Zelt's Akamai WAF threshold
const SENSITIVE_CONCURRENCY = 4;
const PAGE_SIZE = 100;

// Currently-employed, INCLUSIVE definition (matches the hygiene audit): keep
// Created/Invited because 3rd-party production workers never activate their
// Zelt accounts but are fully employed. Drop only terminal states + leavers.
const LIVE_STATUSES = new Set(['Active', 'Invited', 'Invited to Onboard', 'Created']);
const TERMINAL_EVENTS = new Set(['Terminated', 'Resigned', 'Offboarded']);
function isLive(u) {
  const status = u?.accountStatus || u?.status || u?.lifecycle?.status;
  if (!LIVE_STATUSES.has(status)) return false;
  const ev = u?.userEvent?.status || u?.lifecycle?.status;
  if (TERMINAL_EVENTS.has(ev)) return false;
  if (u?.leaveDate || u?.lifecycle?.leaveDate) return false;
  return true;
}

const readName = (u) => u?.displayName || u?.fullName || `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || '(unnamed)';
const readEmployeeId = (u) => u?.employeeId ?? u?.employeeNumber ?? u?.externalId ?? u?.basicInfo?.employeeId ?? null;
const readEntity = (u) => u?.userContract?.entity?.legalName ?? u?.contract?.entity?.legalName ?? (typeof u?.entity === 'string' ? u.entity : u?.entity?.legalName) ?? null;
const readDept = (u) => u?.role?.department?.name || u?.department?.name || (typeof u?.department === 'string' ? u.department : null) || null;
const readSite = (u) => u?.role?.site?.name || u?.site?.name || (typeof u?.site === 'string' ? u.site : null) || null;
const readTitle = (u) => u?.role?.jobPosition?.title || u?.jobTitle || u?.position || null;

// ---- Form field-id → name resolution --------------------------------------
// Role/salary custom fields are keyed by UUID in each user's customUpdates.
// We match by the human field NAME from /company/forms so we never hardcode
// per-company UUIDs.
let formMapCache = { value: null, expiresAt: 0 };
async function getFormFieldMap() {
  if (formMapCache.value && formMapCache.expiresAt > Date.now()) return formMapCache.value;
  const forms = await botGet('/apiv2/company/forms');
  const byForm = {};
  for (const f of (Array.isArray(forms) ? forms : [])) {
    const name = f.formName || f.name;
    const m = {}; // fieldId -> fieldName
    for (const fl of (f.fields || [])) {
      const id = fl.fieldId || fl.id;
      const nm = fl.fieldName || fl.name || fl.label;
      if (id && nm) m[id] = nm;
    }
    if (name) byForm[name] = m;
  }
  formMapCache = { value: byForm, expiresAt: Date.now() + INDEX_TTL_MS };
  return byForm;
}

// customUpdates[] -> { fieldName: value } using a fieldId->name map.
function namedCustom(customUpdates, idToName) {
  const out = {};
  for (const c of (customUpdates || [])) {
    const nm = idToName?.[c.fieldId];
    if (nm) out[nm] = c.value;
  }
  return out;
}

// ---- The people index -----------------------------------------------------
const index = { rows: null, builtAt: 0, building: false, progress: { done: 0, total: 0 }, error: null };

export function getIndexStatus() {
  return {
    ready: !!index.rows && (Date.now() - index.builtAt) < INDEX_TTL_MS,
    building: index.building,
    progress: index.progress,
    builtAt: index.builtAt || null,
    ageMinutes: index.builtAt ? Math.round((Date.now() - index.builtAt) / 60000) : null,
    count: index.rows?.length || 0,
    error: index.error,
  };
}

// Enrich one user's role domain -> BL/Org/JobFamily/WorkCountry/etc.
async function fetchRoleDims(userId, roleMap) {
  try {
    const rec = await botGet(`/apiv2/users/${userId}/role`);
    const eff = rec?.effectiveRecord || {};
    const c = namedCustom(eff.customUpdates, roleMap);
    return {
      businessLine: c['Business Line'] || null,
      org: c['Organization'] || null,
      jobFamily: c['Job Family'] || null,
      workCountry: c['Work Country'] || null,
      teamBranch: c['Team/Branch'] || null,
      locationBranch: c['Location/Branch'] || null,
      cityWork: c['City Work'] || null,
    };
  } catch {
    return {}; // best-effort: a per-user miss must not abort the whole index
  }
}

async function buildIndex() {
  if (index.building) return;
  if (!botConfigured()) { index.error = 'Zelt bot not configured'; return; }
  index.building = true;
  index.error = null;
  try {
    const roleMap = (await getFormFieldMap())['role'] || {};
    const users = (await fetchAllUsersForAudit()).filter(isLive);
    index.progress = { done: 0, total: users.length };
    const rows = new Array(users.length);
    const queue = users.map((u, i) => ({ u, i }));
    const worker = async () => {
      while (queue.length) {
        const { u, i } = queue.shift();
        const uid = u.userId || u.id;
        const dims = await fetchRoleDims(uid, roleMap);
        rows[i] = {
          userId: uid,
          employeeId: readEmployeeId(u),
          name: readName(u),
          department: readDept(u),
          jobTitle: readTitle(u),
          site: readSite(u),
          entity: readEntity(u),
          startDate: u.startDate || u?.lifecycle?.startDate || null,
          accountStatus: u.accountStatus || null,
          ...dims,
        };
        index.progress.done++;
      }
    };
    await Promise.all(Array.from({ length: ROLE_CONCURRENCY }, worker));
    index.rows = rows.filter(Boolean);
    index.builtAt = Date.now();
  } catch (err) {
    index.error = err.message || String(err);
  } finally {
    index.building = false;
  }
}

// Kick a build if stale and not already running. Returns current status.
export function warmIndex(force = false) {
  const fresh = index.rows && (Date.now() - index.builtAt) < INDEX_TTL_MS;
  if ((force || !fresh) && !index.building) buildIndex(); // fire-and-forget
  return getIndexStatus();
}

export function clearIndex() {
  index.rows = null; index.builtAt = 0; index.progress = { done: 0, total: 0 }; index.error = null;
  formMapCache = { value: null, expiresAt: 0 };
  leaveCache = { value: null, expiresAt: 0 };
}

// ---- Dimensions (filter options) ------------------------------------------
const uniqSorted = (rows, key) => [...new Set(rows.map(r => r[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

export function getDimensions() {
  const status = getIndexStatus();
  if (!status.ready) { warmIndex(); return { ready: false, status: getIndexStatus(), dimensions: null }; }
  const r = index.rows;
  return {
    ready: true,
    status,
    dimensions: {
      entities: uniqSorted(r, 'entity'),
      departments: uniqSorted(r, 'department'),
      sites: uniqSorted(r, 'site'),
      businessLines: uniqSorted(r, 'businessLine'),
      orgs: uniqSorted(r, 'org'),
      jobFamilies: uniqSorted(r, 'jobFamily'),
      workCountries: uniqSorted(r, 'workCountry'),
    },
  };
}

// ---- Sensitive enrichment (salary / age / gender) -------------------------
async function fetchSalary(userId, salaryMap) {
  try {
    const rec = await botGet(`/apiv2/users/${userId}/compensation`);
    const eff = rec?.effectiveRecord || {};
    const c = namedCustom(eff.customUpdates, salaryMap);
    const monthly = eff.compensationBreakdown?.fixedRates?.monthly ?? null;
    const annual = eff.compensationBreakdown?.fixedRates?.annual ?? null;
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    return {
      salaryMonthly: monthly != null ? Math.round(monthly) : null,
      salaryAnnual: annual != null ? Math.round(annual) : null,
      basicSalary: num(c['Basic Salary']),
      currency: eff.currency || eff.compensationBreakdown?.currency || null,
    };
  } catch { return {}; }
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

async function fetchPersonal(userId) {
  try {
    const p = await botGet(`/apiv2/users/${userId}/personal`);
    return { age: ageFromDob(p?.dob), gender: p?.gender || null, nationality: p?.nationality || null };
  } catch { return {}; }
}

// ---- Leave balances (annual + compensatory) -------------------------------
// Company-wide per-policy balance (same endpoint the leave page uses), summed
// per user. Each user sits on one annual + one comp policy, so summing across
// the policy set gives their balance. Cached 10m, fetched only when requested.
let leaveCache = { value: null, expiresAt: 0 };
const LEAVE_TTL_MS = 10 * 60 * 1000;
async function fetchLeaveBalanceMap() {
  if (leaveCache.value && leaveCache.expiresAt > Date.now()) return leaveCache.value;
  const pols = await botGet('/apiv2/absence-policies/extended');
  const arr = Array.isArray(pols) ? pols : (pols?.items || []);
  const nameOf = (p) => p.name || p.policyName || '';
  const annualIds = arr.filter(p => /annual|vacation/i.test(nameOf(p)) && !/unpaid/i.test(nameOf(p))).map(p => p.id).slice(0, 40);
  const compIds = arr.filter(p => /compensator/i.test(nameOf(p))).map(p => p.id).slice(0, 40);
  const map = new Map(); // userId -> { annualBalance, compensatoryBalance }
  const pull = async (ids, key) => {
    for (const pid of ids) {
      let page = 1;
      while (true) {
        let data;
        try { data = await botGet('/apiv2/absences/company/balance', { policyId: pid, Calendar: 'current', page, pageSize: PAGE_SIZE }); }
        catch { break; }
        for (const item of (data.items || [])) {
          const d = item[pid];
          if (!d) continue;
          const days = d.currentBalanceInDays != null
            ? d.currentBalanceInDays
            : (d.currentBalance || 0) / (d.currentAverageWorkDayLength || 480);
          const cur = map.get(item.userId) || {};
          cur[key] = (cur[key] || 0) + (Number(days) || 0);
          map.set(item.userId, cur);
        }
        if (page >= (data.totalPages || 1)) break;
        page++;
      }
    }
  };
  await pull(annualIds, 'annualBalance');
  await pull(compIds, 'compensatoryBalance');
  for (const v of map.values()) {
    if (v.annualBalance != null) v.annualBalance = Math.round(v.annualBalance * 10) / 10;
    if (v.compensatoryBalance != null) v.compensatoryBalance = Math.round(v.compensatoryBalance * 10) / 10;
  }
  leaveCache = { value: map, expiresAt: Date.now() + LEAVE_TTL_MS };
  return map;
}

async function enrichSensitive(rows, needSalary, needPersonal) {
  if (!needSalary && !needPersonal) return;
  let salaryMap = {};
  if (needSalary) salaryMap = (await getFormFieldMap())['salary'] || {};
  const queue = [...rows];
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift();
      if (needSalary) Object.assign(row, await fetchSalary(row.userId, salaryMap));
      if (needPersonal) Object.assign(row, await fetchPersonal(row.userId));
    }
  };
  await Promise.all(Array.from({ length: SENSITIVE_CONCURRENCY }, worker));
}

// ---- Field catalogue ------------------------------------------------------
// Admin-only, never sent to any AI payload. (Leave balances are NOT here —
// they're shown to all approved users, same as the leave page.)
export const SENSITIVE_FIELDS = new Set(['salaryMonthly', 'salaryAnnual', 'basicSalary', 'currency', 'age', 'gender', 'nationality']);
const BALANCE_FIELDS = ['annualBalance', 'compensatoryBalance'];
export const ALL_FIELDS = [
  'employeeId', 'name', 'department', 'jobTitle', 'site', 'entity',          // core identity
  'businessLine', 'org', 'jobFamily', 'workCountry', 'teamBranch', 'locationBranch', 'cityWork', // canon structure
  'startDate', 'accountStatus', 'lengthOfServiceYears',                      // dates & status
  'annualBalance', 'compensatoryBalance',                                    // leave balances (all users)
  'salaryMonthly', 'salaryAnnual', 'basicSalary', 'currency', 'age', 'gender', 'nationality', // sensitive (admin)
];

const normTag = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
function matchesFilter(value, allowed) {
  if (!allowed || !allowed.length) return true;        // empty filter = no constraint
  const v = normTag(value);
  return allowed.some(a => normTag(a) === v);
}

function lengthOfServiceYears(startDate) {
  if (!startDate) return null;
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, +(((Date.now() - d.getTime()) / (365.25 * 86400000)).toFixed(1)));
}

/**
 * Run a report.
 * @param {object} opts
 * @param {object} opts.filters - { entities, departments, sites, businessLines, orgs, jobFamilies, workCountries } (arrays)
 * @param {string[]} opts.fields - requested output fields (subset of ALL_FIELDS)
 * @param {boolean} opts.isAdmin - whether sensitive fields are permitted
 * @returns {Promise<object>} { rows, count, fields, aggregates, generatedAt, sensitiveDenied }
 */
export async function runReport({ filters = {}, fields = [], isAdmin = false }) {
  const status = getIndexStatus();
  if (!status.ready) { warmIndex(); const e = new Error('People index is still building — try again in a moment.'); e.code = 'INDEX_BUILDING'; e.status = status; throw e; }

  // Strip sensitive fields for non-admins.
  let sensitiveDenied = false;
  let outFields = fields.filter(f => ALL_FIELDS.includes(f));
  if (!isAdmin && outFields.some(f => SENSITIVE_FIELDS.has(f))) {
    sensitiveDenied = true;
    outFields = outFields.filter(f => !SENSITIVE_FIELDS.has(f));
  }
  if (!outFields.length) outFields = ['employeeId', 'name', 'department', 'entity'];

  // Filter the index.
  const f = filters;
  let rows = index.rows.filter(r =>
    matchesFilter(r.entity, f.entities) &&
    matchesFilter(r.department, f.departments) &&
    matchesFilter(r.site, f.sites) &&
    matchesFilter(r.businessLine, f.businessLines) &&
    matchesFilter(r.org, f.orgs) &&
    matchesFilter(r.jobFamily, f.jobFamilies) &&
    matchesFilter(r.workCountry, f.workCountries)
  );

  // Clone so we never mutate the cached index with sensitive data.
  rows = rows.map(r => ({ ...r, lengthOfServiceYears: lengthOfServiceYears(r.startDate) }));

  const needSalary = outFields.some(x => ['salaryMonthly', 'salaryAnnual', 'basicSalary', 'currency'].includes(x));
  const needPersonal = outFields.some(x => ['age', 'gender', 'nationality'].includes(x));
  if ((needSalary || needPersonal) && isAdmin) await enrichSensitive(rows, needSalary, needPersonal);

  // Leave balances (all users) — join from the company-wide balance map.
  if (outFields.some(x => BALANCE_FIELDS.includes(x))) {
    try {
      const lm = await fetchLeaveBalanceMap();
      for (const r of rows) {
        const b = lm.get(r.userId) || {};
        r.annualBalance = b.annualBalance ?? null;
        r.compensatoryBalance = b.compensatoryBalance ?? null;
      }
    } catch { /* leave the columns null if the balance endpoint is unavailable */ }
  }

  // Project to requested fields only (+ always carry name/employeeId for the table).
  const projected = rows.map(r => {
    const o = {};
    for (const k of outFields) o[k] = r[k] ?? null;
    o._employeeId = r.employeeId; o._name = r.name;
    return o;
  });
  projected.sort((a, b) => String(a._name).localeCompare(String(b._name)));

  return {
    rows: projected,
    count: projected.length,
    fields: outFields,
    aggregates: buildAggregates(rows, outFields, isAdmin),
    generatedAt: new Date().toISOString(),
    sensitiveDenied,
    indexAgeMinutes: status.ageMinutes,
  };
}

// Pure helpers exposed for unit tests (no I/O).
export const __test = { ageFromDob, lengthOfServiceYears, matchesFilter, normTag, buildAggregates };

// PII-FREE aggregates for KPI tiles + the report builder + the AI narrative:
// counts by dimension, and salary TOTALS/averages only (never per person).
function buildAggregates(rows, outFields, isAdmin) {
  const countBy = (key) => {
    const m = {};
    for (const r of rows) { const k = r[key] || '(none)'; m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count);
  };
  const agg = {
    headcount: rows.length,
    byBusinessLine: countBy('businessLine'),
    byDepartment: countBy('department'),
    byEntity: countBy('entity'),
    byOrg: countBy('org'),
  };
  if (isAdmin && outFields.some(f => ['salaryMonthly', 'basicSalary'].includes(f))) {
    const withSalary = rows.filter(r => r.salaryMonthly != null);
    const byCur = {};
    for (const r of withSalary) {
      const cur = r.currency || '?';
      (byCur[cur] ||= { currency: cur, count: 0, totalMonthly: 0 });
      byCur[cur].count++; byCur[cur].totalMonthly += r.salaryMonthly;
    }
    agg.salary = Object.values(byCur).map(s => ({
      currency: s.currency, employees: s.count,
      totalMonthly: Math.round(s.totalMonthly),
      avgMonthly: s.count ? Math.round(s.totalMonthly / s.count) : 0,
    }));
    agg.salaryCoverage = `${withSalary.length}/${rows.length}`;
  }
  // Leave-balance summary (not PII — averages/totals across the group).
  if (outFields.includes('annualBalance')) {
    const vals = rows.map(r => r.annualBalance).filter(v => v != null);
    if (vals.length) agg.annualBalance = {
      employees: vals.length,
      avgDays: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1),
      totalDays: +vals.reduce((a, b) => a + b, 0).toFixed(1),
    };
  }
  if (outFields.includes('compensatoryBalance')) {
    const vals = rows.map(r => r.compensatoryBalance).filter(v => v != null);
    if (vals.length) agg.compensatoryBalance = {
      employees: vals.length,
      avgDays: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1),
      totalDays: +vals.reduce((a, b) => a + b, 0).toFixed(1),
    };
  }
  return agg;
}

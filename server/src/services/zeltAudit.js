/**
 * Zelt data hygiene audit checks.
 *
 * Runs the codified checks from the original audit (project_zelt_findings)
 * AND the guide-driven checks (project zelt-audit/references/data-hygiene-guide.md)
 * against live Zelt data.
 */
import { fetchAllUsersForAudit, clearCaches } from './zeltCompute.js';

// ---- Guide-derived approved lists (data-hygiene-guide.md §3, §7, §11) ----

// Legal entities per guide (CR names). Anything else is wrong-named.
const APPROVED_ENTITIES = new Set([
  // Bahrain
  'Falcon', 'Calo Online Services', 'Vresto', 'Vresto 2', 'Vresto 3',
  // KSA
  'Calo Regional HQ', 'Luqmat', 'Fakeehi', 'Nasco', 'Jussur', 'Fakihi',
  // UAE
  'Gaya M', 'Gaya Catering 2', 'Gaya',
  // Kuwait
  'Calo Catering Services',
  // Qatar
  'Calo catering and hospitality services',
  // Oman
  'Al Ghad Al Mumtaz Company SPC',
  // UK
  'Calo Catering Services LTD', 'Calo Catering Services Ltd',
  // Remote
  'Remotepass',
].map(s => s.toLowerCase()));

// Departments per guide §7 (18 approved).
const APPROVED_DEPARTMENTS = new Set([
  'P&C', 'CX', 'Legal', 'Strategic Finance', 'Finance Operations',
  'Marketing & Growth', 'AI', 'Product', 'Engineering', 'Food',
  'CEO Office', 'Quality', 'Expansion', 'Supply Chain', 'Retail',
  'Calo Market', 'Calo 2.0', 'Calo Black',
  // Common variants seen in zelt data
  'People and Culture', 'Customer Experience', 'Marketing',
].map(s => s.toLowerCase()));

// Country codes by entity prefix — used to flag currency mismatches AND
// derive country from entity/site (zelt has no standalone country field).
const COUNTRY_PATTERNS = [
  { country: 'KSA',     pattern: /\b(KSA|saudi|riyadh|jeddah|dammam)/i, expectedCurrency: 'SAR' },
  { country: 'Bahrain', pattern: /\b(BH|bahrain|manama)/i,              expectedCurrency: 'BHD' },
  { country: 'UAE',     pattern: /\b(UAE|emirates|dubai|abu dhabi)/i,   expectedCurrency: 'AED' },
  { country: 'Kuwait',  pattern: /\b(KW|kuwait)/i,                      expectedCurrency: 'KWD' },
  { country: 'Qatar',   pattern: /\b(QA|qatar|doha)/i,                  expectedCurrency: 'QAR' },
  { country: 'Oman',    pattern: /\b(OM|oman|muscat)/i,                 expectedCurrency: 'OMR' },
  { country: 'UK',      pattern: /\b(UK|britain|england|london)/i,      expectedCurrency: 'GBP' },
  { country: 'Egypt',   pattern: /\begypt|cairo/i,                      expectedCurrency: 'EGP' },
  { country: 'Remote',  pattern: /\bremote/i,                           expectedCurrency: null  },
];

// Organization (guide §1) — local vs central, per-MP. 7 expected values.
const ORG_PATTERNS = [
  { org: 'Basecamp', pattern: /^basecamp/i },
  { org: 'MP KSA',   pattern: /mountain\s*peak.*ksa|^mp\s*ksa/i },
  { org: 'MP UAE',   pattern: /mountain\s*peak.*uae|^mp\s*uae/i },
  { org: 'MP BH',    pattern: /mountain\s*peak.*bh|mountain\s*peak.*bahrain|^mp\s*bh/i },
  { org: 'MP OM',    pattern: /mountain\s*peak.*oman|^mp\s*om/i },
  { org: 'MP QA',    pattern: /mountain\s*peak.*qatar|^mp\s*qa/i },
  { org: 'MP UK',    pattern: /mountain\s*peak.*uk|^mp\s*uk/i },
  { org: 'MP KW',    pattern: /mountain\s*peak.*kuwait|^mp\s*kw/i },
];

function classifyCountry(u) {
  const ent = readEntity(u) || '';
  const site = u?.role?.site?.name || '';
  for (const { country, pattern } of COUNTRY_PATTERNS) {
    if (pattern.test(ent) || pattern.test(site)) return country;
  }
  return 'Unclassified';
}

function classifyOrg(u) {
  const ent = readEntity(u) || '';
  for (const { org, pattern } of ORG_PATTERNS) {
    if (pattern.test(ent)) return org;
  }
  return 'Unclassified';
}

function looksLikeBrandDivisionName(name) {
  if (!name) return false;
  // Brand-division names are like "Basecamp KSA", "Mountain Peak UAE" — geo + brand.
  // Legal CR names are short proper nouns: Falcon, Vresto, Luqmat, Fakeehi, Nasco, Jussur.
  return /(basecamp|mountain\s*peak|mp\s+\w{2,3})/i.test(name);
}

function readEmployeeId(u) {
  return u?.employeeId ?? u?.basicInfo?.employeeId ?? null;
}

function readEntity(u) {
  return u?.userContract?.entity?.legalName || u?.contract?.entity?.legalName || null;
}

function isKsa(u) {
  const e = (readEntity(u) || '').toLowerCase();
  const s = (u?.role?.site?.name || '').toLowerCase();
  return e.includes('ksa') || s.includes('ksa') || s.includes('jeddah') || s.includes('riyadh');
}

export async function runAudit({ forceRefresh = false } = {}) {
  // Force-refresh wipes the entities + basics caches so the next fetch
  // re-pulls live data from Zelt. Use when the audit page's Refresh button
  // is clicked — without this, results are bounded by the 5min/24h cache TTLs.
  if (forceRefresh) clearCaches();
  const users = await fetchAllUsersForAudit();
  const today = new Date();
  const out = {
    asOf: today.toISOString(),
    totalUsers: users.length,
    statusCounts: {},
    checks: {},
  };

  for (const u of users) {
    const s = u?.accountStatus || u?.status || 'Unknown';
    out.statusCounts[s] = (out.statusCounts[s] || 0) + 1;
  }

  // 1. Active with leaveDate (mid-termination)
  out.checks.activeWithLeaveDate = users
    .filter(u => u.accountStatus === 'Active' && u.leaveDate)
    .map(u => ({ userId: u.userId, employeeId: readEmployeeId(u), name: u.displayName, leaveDate: u.leaveDate }));

  // 2. Active but userEvent.status indicates departure
  out.checks.activeButTerminated = users
    .filter(u => u.accountStatus === 'Active' && ['Terminated', 'Resigned', 'Offboarded'].includes(u?.userEvent?.status))
    .map(u => ({ userId: u.userId, employeeId: readEmployeeId(u), name: u.displayName, eventStatus: u.userEvent.status }));

  // 3. Duplicate employee IDs
  const eidMap = new Map();
  for (const u of users) {
    const eid = readEmployeeId(u);
    if (!eid) continue;
    eidMap.set(eid, [...(eidMap.get(eid) || []), { userId: u.userId, name: u.displayName, status: u.accountStatus }]);
  }
  out.checks.duplicateEmployeeIds = [...eidMap.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([eid, list]) => ({ employeeId: eid, count: list.length, users: list }));

  // 4. Missing employeeId
  out.checks.missingEmployeeId = users
    .filter(u => !readEmployeeId(u) && u.accountStatus !== 'Deactivated')
    .map(u => ({ userId: u.userId, name: u.displayName, status: u.accountStatus }));

  // 5. Duplicate display names
  const nameMap = new Map();
  for (const u of users) {
    if (u.accountStatus === 'Deactivated') continue;
    if (!u.displayName) continue;
    const k = u.displayName.toLowerCase().trim();
    nameMap.set(k, [...(nameMap.get(k) || []), { userId: u.userId, employeeId: readEmployeeId(u), status: u.accountStatus }]);
  }
  out.checks.duplicateNames = [...nameMap.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name: name.replace(/\b\w/g, c => c.toUpperCase()), count: list.length, users: list }));

  // 6. Missing required fields (active or onboarding)
  const onboardingStatuses = ['Active', 'Invited', 'Invited to Onboard', 'Created'];
  const isOnboarding = u => onboardingStatuses.includes(u.accountStatus);
  out.checks.missingEntity = users
    .filter(u => isOnboarding(u) && !readEntity(u))
    .map(u => ({ userId: u.userId, name: u.displayName, status: u.accountStatus }));
  out.checks.missingSite = users
    .filter(u => isOnboarding(u) && !u?.role?.site?.name)
    .map(u => ({ userId: u.userId, name: u.displayName, status: u.accountStatus }));
  out.checks.missingDepartment = users
    .filter(u => isOnboarding(u) && !u?.role?.department?.name)
    .map(u => ({ userId: u.userId, name: u.displayName, status: u.accountStatus }));
  out.checks.missingManager = users
    .filter(u => isOnboarding(u) && !u?.role?.managerId)
    .map(u => ({ userId: u.userId, name: u.displayName, status: u.accountStatus }));

  // 7. Future-dated joiners (>90 days out)
  out.checks.futureJoiners = users
    .filter(u => {
      if (!u.startDate) return false;
      const sd = new Date(u.startDate);
      return (sd - today) / (1000 * 60 * 60 * 24) > 90;
    })
    .map(u => ({ userId: u.userId, employeeId: readEmployeeId(u), name: u.displayName, startDate: u.startDate }));

  // 8. Stale "Created" status (>90 days, never onboarded)
  out.checks.staleCreated = users
    .filter(u => {
      if (u.accountStatus !== 'Created') return false;
      if (!u.startDate) return false;
      const sd = new Date(u.startDate);
      return (today - sd) / (1000 * 60 * 60 * 24) > 90;
    })
    .map(u => ({ userId: u.userId, employeeId: readEmployeeId(u), name: u.displayName, startDate: u.startDate }))
    .slice(0, 200); // cap — there are hundreds, surface a sample

  // 9. Test users on Active status
  out.checks.testUsers = users
    .filter(u => u.accountStatus === 'Active' && /test|support/i.test(u.displayName || ''))
    .map(u => ({ userId: u.userId, name: u.displayName, employeeId: readEmployeeId(u) }));

  // 10. Per-country active count (replaces the old KSA-only stat)
  const countryCounts = {};
  const orgCounts = {};
  for (const u of users) {
    if (u.accountStatus !== 'Active' || u.leaveDate) continue;
    if (['Terminated', 'Resigned', 'Offboarded'].includes(u?.userEvent?.status)) continue;
    const c = classifyCountry(u);
    countryCounts[c] = (countryCounts[c] || 0) + 1;
    const o = classifyOrg(u);
    orgCounts[o] = (orgCounts[o] || 0) + 1;
  }
  out.byCountry = countryCounts;
  out.byOrganization = orgCounts;

  // Users where we couldn't classify country or organization → flag for review
  out.checks.unclassifiedCountry = users
    .filter(u => u.accountStatus === 'Active' && !u.leaveDate && classifyCountry(u) === 'Unclassified')
    .map(u => ({
      userId: u.userId, employeeId: readEmployeeId(u), name: u.displayName,
      entity: readEntity(u), site: u?.role?.site?.name,
      suggestion: 'Country can\'t be derived from entity or site. Add Country as a standalone field, or normalize the entity/site name.',
    }));
  out.checks.unclassifiedOrganization = users
    .filter(u => u.accountStatus === 'Active' && !u.leaveDate && classifyOrg(u) === 'Unclassified')
    .map(u => ({
      userId: u.userId, employeeId: readEmployeeId(u), name: u.displayName,
      entity: readEntity(u),
      suggestion: 'Organization can\'t be derived (expected: Basecamp, MP KSA, MP UAE, MP BH, MP OM, MP QA, MP UK, MP KW). Tag the entity properly.',
    }));

  // ===== Guide-driven checks =====

  // 11. Entity not in approved CR list (data-hygiene-guide §3)
  out.checks.unapprovedEntity = users
    .filter(u => u.accountStatus === 'Active' && !u.leaveDate)
    .map(u => ({ user: u, entity: readEntity(u) }))
    .filter(({ entity }) => entity && !APPROVED_ENTITIES.has(entity.toLowerCase()))
    .map(({ user, entity }) => ({
      userId: user.userId, employeeId: readEmployeeId(user), name: user.displayName,
      currentEntity: entity,
      suggestion: `Rename to legal CR name (e.g. Falcon, Vresto, Luqmat, Fakeehi)`,
    }));

  // 12. Department not in approved list (guide §7 — 18 expected)
  out.checks.unapprovedDepartment = users
    .filter(u => u.accountStatus === 'Active' && !u.leaveDate)
    .map(u => ({ user: u, dept: u?.role?.department?.name }))
    .filter(({ dept }) => dept && !APPROVED_DEPARTMENTS.has(dept.toLowerCase()))
    .map(({ user, dept }) => ({
      userId: user.userId, employeeId: readEmployeeId(user), name: user.displayName,
      currentDepartment: dept,
      suggestion: `Move to approved dept or split out as Business Line (Lola, Calo Market, etc.)`,
    }));

  // 13. Legacy site — "[Not in use]" with active users still assigned
  out.checks.legacySiteAssigned = users
    .filter(u => u.accountStatus === 'Active' && !u.leaveDate && /not in use/i.test(u?.role?.site?.name || ''))
    .map(u => ({ userId: u.userId, employeeId: readEmployeeId(u), name: u.displayName, site: u.role.site.name }));

  // 14. Currency/country mismatch on entity
  const entitiesSeen = new Map();
  for (const u of users) {
    const e = u?.userContract?.entity;
    if (!e?.legalName) continue;
    if (!entitiesSeen.has(e.legalName)) entitiesSeen.set(e.legalName, e);
  }
  out.checks.currencyMismatch = [...entitiesSeen.values()]
    .filter(e => {
      for (const c of COUNTRY_PATTERNS) {
        if (c.pattern.test(e.legalName) && c.expectedCurrency) {
          return e.currency && e.currency !== c.expectedCurrency;
        }
      }
      return false;
    })
    .map(e => ({
      legalName: e.legalName,
      currentCurrency: e.currency,
      suggestion: `Currency on ${e.legalName} doesn't match the country prefix. Check with Finance.`,
    }));

  // 14b. Brand-division names that should be replaced by legal CR names.
  // The guide expects entity = legal CR (Falcon, Vresto, Luqmat, etc.) NOT
  // brand-division (Basecamp KSA, Mountain Peak KSA). Those should be the
  // Organization tag, not the Entity.
  out.checks.brandDivisionAsEntity = [...entitiesSeen.values()]
    .filter(e => looksLikeBrandDivisionName(e.legalName))
    .map(e => ({
      legalName: e.legalName,
      suggestion: 'This looks like a brand-division (Organization) name, not a legal CR. Move to Organization tag and rename Entity to its CR name (Falcon, Vresto, Luqmat, Fakeehi, Nasco, Jussur, Calo Catering Services LTD, etc.).',
    }));

  // 15. Single-occurrence job titles — likely typos / not in mastersheet
  const titleCounts = new Map();
  for (const u of users) {
    if (u.accountStatus !== 'Active') continue;
    const t = u?.role?.jobPosition?.title;
    if (!t) continue;
    titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
  }
  const totalUniqueTitles = titleCounts.size;
  out.checks.rareJobTitles = [...titleCounts.entries()]
    .filter(([, count]) => count === 1)
    .map(([title]) => ({
      title,
      suggestion: `Only one employee has this title. Verify it's in the mastersheet or merge to canonical title.`,
    }))
    .slice(0, 100);

  // 16. Case/whitespace duplicate job titles ("LINE COOK" vs "Line Cook")
  const titleNormMap = new Map();
  for (const t of titleCounts.keys()) {
    const norm = t.toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
    titleNormMap.set(norm, [...(titleNormMap.get(norm) || []), t]);
  }
  out.checks.duplicateJobTitleVariants = [...titleNormMap.entries()]
    .filter(([, variants]) => variants.length > 1)
    .map(([norm, variants]) => ({
      canonical: variants[0],
      variants,
      suggestion: `Pick one canonical form, migrate all employees, delete the others.`,
    }));

  // 17. Active users with placeholder emails
  out.checks.placeholderEmails = users
    .filter(u => u.accountStatus === 'Active' && !u.leaveDate &&
                /@dummy|@noreply|tbu/i.test(u?.emailAddress || ''))
    .map(u => ({
      userId: u.userId, employeeId: readEmployeeId(u), name: u.displayName,
      email: u.emailAddress,
      suggestion: 'Replace with real email — placeholder breaks notifications & SSO.',
    }));

  // Department list with frequency — "needs review" rather than "vs 18 expected"
  const deptCounts = {};
  for (const u of users) {
    if (u.accountStatus !== 'Active' || u.leaveDate) continue;
    const d = u?.role?.department?.name;
    if (d) deptCounts[d] = (deptCounts[d] || 0) + 1;
  }
  out.checks.departmentList = Object.entries(deptCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([dept, count]) => ({
      department: dept,
      activeUsers: count,
      suggestion: count < 3 ? 'Small dept — could be a Business Line miscategorised. Confirm.' : 'Confirm this is in the approved list.',
    }));

  // Entity list with classification (CR-name vs brand-division) — needed since
  // the "expected entities" set was incomplete & the brand vs CR split is the
  // real signal.
  out.checks.entityList = [...entitiesSeen.values()]
    .map(e => ({
      legalName: e.legalName,
      currency: e.currency,
      classification: looksLikeBrandDivisionName(e.legalName) ? 'Brand division (move to Organization)' : 'Likely legal CR',
    }));

  // Stats — actual counts only, no fake "expected" numbers.
  out.stats = {
    totalUniqueJobTitles: totalUniqueTitles,
    totalUniqueEntities: entitiesSeen.size,
    totalUniqueDepartments: Object.keys(deptCounts).length,
    totalCountries: Object.keys(countryCounts).length,
    totalOrganizations: Object.keys(orgCounts).length,
  };

  // Compact active-user list for client-side cross-checks against uploaded
  // masterfile sheets (KSA Luqmat, 3rd Party Production, etc.). Only the
  // join/comparison fields — no PII beyond what the audit page already shows.
  out.activeUsers = users
    .filter(u => u.accountStatus === 'Active')
    .map(u => ({
      userId: u.userId,
      employeeId: readEmployeeId(u),
      name: u.displayName,
      email: u.emailAddress || null,
      entity: readEntity(u),
      dept: u?.role?.department?.name || null,
      position: u?.role?.jobTitle || null,
      site: u?.role?.site?.name || null,
    }));

  // Headline counts
  out.summary = Object.fromEntries(
    Object.entries(out.checks).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])
  );

  return out;
}

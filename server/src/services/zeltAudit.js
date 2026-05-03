/**
 * Zelt data hygiene audit checks.
 *
 * Runs the codified checks from the original audit (project_zelt_findings)
 * AND the guide-driven checks (project zelt-audit/references/data-hygiene-guide.md)
 * against live Zelt data.
 */
import { fetchAllUsersForAudit } from './zeltCompute.js';

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

// Country codes by entity prefix — used to flag currency/country mismatches.
const ENTITY_COUNTRY_HINTS = [
  { entityPattern: /\b(KSA|saudi)/i, expectedCurrency: 'SAR' },
  { entityPattern: /\b(BH|bahrain)/i, expectedCurrency: 'BHD' },
  { entityPattern: /\b(UAE|emirates)/i, expectedCurrency: 'AED' },
  { entityPattern: /\b(KW|kuwait)/i, expectedCurrency: 'KWD' },
  { entityPattern: /\b(QA|qatar)/i, expectedCurrency: 'QAR' },
  { entityPattern: /\b(OM|oman)/i, expectedCurrency: 'OMR' },
  { entityPattern: /\b(UK|britain|england)/i, expectedCurrency: 'GBP' },
];

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

export async function runAudit() {
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

  // 10. KSA-related counts (sanity)
  out.checks.ksaActiveCount = users.filter(u => u.accountStatus === 'Active' && !u.leaveDate && isKsa(u)).length;

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
  // (entity row-level, not user-level — but we can sample once per unique entity)
  const entitiesSeen = new Map();
  for (const u of users) {
    const e = u?.userContract?.entity;
    if (!e?.legalName) continue;
    if (!entitiesSeen.has(e.legalName)) entitiesSeen.set(e.legalName, e);
  }
  out.checks.currencyMismatch = [...entitiesSeen.values()]
    .filter(e => {
      for (const hint of ENTITY_COUNTRY_HINTS) {
        if (hint.entityPattern.test(e.legalName)) {
          return e.currency && e.currency !== hint.expectedCurrency;
        }
      }
      return false;
    })
    .map(e => ({
      legalName: e.legalName,
      currentCurrency: e.currency,
      suggestion: `Currency on ${e.legalName} doesn't match the country prefix. Check with Finance.`,
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

  // Stats for the dashboard headline
  out.stats = {
    totalUniqueJobTitles: totalUniqueTitles,
    expectedJobTitles: 50, // per guide
    totalUniqueEntities: entitiesSeen.size,
    expectedEntities: APPROVED_ENTITIES.size,
    totalUniqueDepartments: new Set(users.map(u => u?.role?.department?.name).filter(Boolean)).size,
    expectedDepartments: 18,
  };

  // Headline counts
  out.summary = Object.fromEntries(
    Object.entries(out.checks).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])
  );

  return out;
}

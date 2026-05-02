/**
 * Zelt data hygiene audit checks.
 *
 * Runs the 14 codified checks from the original audit (project_zelt_findings)
 * against live Zelt data and returns flagged employees grouped by check type.
 *
 * Used by:
 *   - GET /api/zelt/audit — returns the full report
 *   - The "send digest" admin action
 */
import { fetchAllUsersForAudit } from './zeltCompute.js';

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

  // Headline counts
  out.summary = Object.fromEntries(
    Object.entries(out.checks).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])
  );

  return out;
}

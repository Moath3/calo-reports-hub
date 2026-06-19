// Cross-source discrepancy flags. Per-day flags (absent, incomplete, leave
// conflict, worked-on-dayoff) come from the OT engine; these are the
// population-level identity/eligibility flags.
export function flagAccuracy({ unmatched = [], punchedEmpCodes = new Set(), rosterEmpIds = new Set(), matchedEmpIds = new Set() }) {
  const flags = [];
  for (const u of unmatched) {
    if (punchedEmpCodes.has(u.empCode)) {
      flags.push({ flag: 'ghost_punch', empCode: u.empCode, detail: 'Punched in BioTime but not an active employee in Masterfile/Zelt' });
    }
  }
  for (const empId of rosterEmpIds) {
    if (!matchedEmpIds.has(empId)) {
      flags.push({ flag: 'stale_roster', empId, detail: 'Scheduled in the roster but not a current matched employee' });
    }
  }
  return flags;
}

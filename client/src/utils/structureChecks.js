/**
 * Masterfile structure checks — validates uploaded masterfile rows against the
 * 2026 Calo people-structure canon (caloCanon.js). Pure functions, no I/O.
 *
 * These are INTERNAL-consistency checks on the masterfile itself (retired
 * tags, family/level clashes, title intelligence, entity/country agreement),
 * complementing the Zelt-vs-masterfile cross-checks in masterfile.js.
 * Missing-field noise deliberately stays out — that belongs to the Zelt audit.
 */

import {
  norm,
  normTag,
  isApprovedBusinessLine,
  retiredBusinessLineReplacement,
  isApprovedDept,
  retiredDeptReplacement,
  familyLevelIssue,
  isProductionDept,
  isOfficeDept,
  isAdminTeam,
  ALL_RETAIL_BRANCHES,
  teamBelongsToDept,
  inferFromTitle,
  titleCanonIssue,
  legalEntityCountry,
} from './caloCanon.js';

// A field "counts" only when it's non-blank and not a dash placeholder.
const present = (v) => {
  const s = norm(v);
  return s !== '' && s !== '-';
};

// Active-row filter: exact 'Active' (case-insensitive). Blank status counts
// as active, consistent with the cross-check logic (some source sheets only
// list active employees and leave the column empty).
const isActiveRow = (row) => {
  const s = norm(row?.status).toLowerCase();
  return !s || s === 'active';
};

// Job family normalizer: 'Non Production' / 'NON-PRODUCTION' → 'non-production'.
// normTag strips hyphens, so 'Non-Production' arrives as 'nonproduction' and
// 'Non Production' as 'non production' — collapse both to 'non-production'.
const normFamily = (f) => normTag(f).replace(/^non\s*production$/, 'non-production');

// ── Country normalizer (for the entity-vs-work-country check) ─────────
// Maps the spellings seen in Work Country / Region / Working Location to the
// canonical country names used by legalEntityCountry(). Unknown values map to
// null so we never flag on a city/region we can't confidently classify.
const COUNTRY_ALIASES = {
  'ksa': 'KSA', 'sa': 'KSA', 'saudi': 'KSA', 'saudi arabia': 'KSA',
  'kingdom of saudi arabia': 'KSA', 'ksa saudi arabia': 'KSA',
  'bahrain': 'Bahrain', 'bh': 'Bahrain', 'kingdom of bahrain': 'Bahrain',
  'uae': 'UAE', 'ae': 'UAE', 'united arab emirates': 'UAE', 'dubai': 'UAE', 'abu dhabi': 'UAE',
  'kuwait': 'Kuwait', 'kw': 'Kuwait',
  'qatar': 'Qatar', 'qa': 'Qatar',
  'oman': 'Oman', 'om': 'Oman', 'sultanate of oman': 'Oman',
};
export function normalizeCountry(v) {
  if (!present(v)) return null;
  return COUNTRY_ALIASES[normTag(v)] || null;
}

// Flagged-record shape shared by every check.
const record = (row, detail) => ({
  empId: row.empId ?? null,
  name: row.name ?? null,
  source: row.source ?? null,
  dept: row.dept ?? null,
  position: row.position ?? null,
  businessLine: row.businessLine ?? null,
  team: row.team ?? null,
  jobFamily: row.jobFamily ?? null,
  roleLevel: row.roleLevel ?? null,
  detail,
});

/**
 * Run every structure check over the (active) masterfile rows.
 * Returns { checks: { name: [records] }, summary: { name: count } }.
 */
export function runStructureChecks(rows) {
  const checks = {
    mfRetiredBusinessLine: [],
    mfInvalidBusinessLine: [],
    mfRetiredDepartment: [],
    mfInvalidDepartment: [],
    mfFamilyLevelMismatch: [],
    mfDeptFamilyMismatch: [],
    mfHqProductionClash: [],
    mfRetailBranch: [],
    mfTeamNotInDept: [],
    mfTitleMismatch: [],
    mfTitleVariant: [],
    mfEntityCountry: [],
  };

  const active = (Array.isArray(rows) ? rows : []).filter(isActiveRow);

  for (const row of active) {
    const { businessLine, dept, team, jobFamily, roleLevel, position, legalEntity, workCountry } = row;

    // ── Business line: retired / invalid ──────────────────────────────
    if (present(businessLine)) {
      const replacement = retiredBusinessLineReplacement(businessLine);
      if (replacement) {
        checks.mfRetiredBusinessLine.push(record(row, `retag to ${replacement}`));
      } else if (!isApprovedBusinessLine(businessLine)) {
        checks.mfInvalidBusinessLine.push(record(row, `"${norm(businessLine)}" is not an approved business line`));
      }
    }

    // ── Department: retired / invalid ─────────────────────────────────
    if (present(dept)) {
      const replacement = retiredDeptReplacement(dept);
      if (replacement) {
        checks.mfRetiredDepartment.push(record(row, `retired department — retag to ${replacement}`));
      } else if (!isApprovedDept(dept)) {
        checks.mfInvalidDepartment.push(record(row, `"${norm(dept)}" is not in the approved 21-department list`));
      }
    }

    // ── Job family vs role level band ─────────────────────────────────
    // caloCanon's familyLevelIssue normalizes via normTag, which strips the
    // hyphen in 'Non-Production' to 'nonproduction' and then misses the
    // FAMILY_BANDS lookup. Feed it the space form so hyphenated spellings
    // still validate (canon nit — do not fix here, canon is frozen).
    const famForCanon = normFamily(jobFamily) === 'non-production' ? 'Non Production' : jobFamily;
    const famIssue = familyLevelIssue(famForCanon, roleLevel);
    if (famIssue) checks.mfFamilyLevelMismatch.push(record(row, famIssue));

    // ── Department vs job family ──────────────────────────────────────
    if (present(dept) && present(jobFamily)) {
      const fam = normFamily(jobFamily);
      if (isProductionDept(dept) && fam === 'non-production' && !isAdminTeam(team)) {
        checks.mfDeptFamilyMismatch.push(record(row, 'production dept + Non-Production without an Admin team'));
      } else if (isOfficeDept(dept) && fam === 'production') {
        checks.mfDeptFamilyMismatch.push(record(row, 'office dept tagged Production'));
      }
    }

    // ── MP HQ business line on a production department ────────────────
    if (present(businessLine) && present(dept) && normTag(businessLine) === normTag('MP HQ') && isProductionDept(dept)) {
      checks.mfHqProductionClash.push(record(row, 'MP HQ business line on a production department'));
    }

    // ── Retail branch tagging ─────────────────────────────────────────
    if (present(businessLine) && present(team)) {
      const bl = normTag(businessLine);
      const inBranchList = ALL_RETAIL_BRANCHES.some((b) => normTag(b) === normTag(team));
      if (bl === normTag('Retail') && !inBranchList) {
        checks.mfRetailBranch.push(record(row, 'retail staff need an outlet branch'));
      } else if (bl === normTag('On Demand - Admin') && inBranchList) {
        checks.mfRetailBranch.push(record(row, 'floating staff should carry no branch'));
      }
    }

    // ── Team membership under its department ──────────────────────────
    if (present(team) && present(dept) && !teamBelongsToDept(team, dept)) {
      checks.mfTeamNotInDept.push(record(row, `"${norm(team)}" is not a listed team under ${norm(dept)}`));
    }

    // ── Title intelligence: dept / family contradiction ───────────────
    if (present(position)) {
      const inferred = inferFromTitle(position);
      if (inferred) {
        const issues = [];
        if (present(dept) && !inferred.depts.some((d) => normTag(d) === normTag(dept))) {
          issues.push(`title implies ${inferred.depts.join('/')}, dept is ${norm(dept)}`);
        }
        if (inferred.family && present(jobFamily) && normFamily(inferred.family) !== normFamily(jobFamily)) {
          issues.push(`title implies ${inferred.family} family, tagged ${norm(jobFamily)}`);
        }
        if (issues.length) checks.mfTitleMismatch.push(record(row, issues.join('; ')));
      }

      // ── Title catalog spelling ──────────────────────────────────────
      const suggested = titleCanonIssue(position);
      if (suggested && norm(suggested) !== norm(position)) {
        checks.mfTitleVariant.push(record(row, `catalog spelling: ${suggested}`));
      }
    }

    // ── Legal entity country vs work country ──────────────────────────
    if (present(legalEntity) && present(workCountry)) {
      const entityCountry = legalEntityCountry(legalEntity);
      const work = normalizeCountry(workCountry);
      if (entityCountry && entityCountry !== 'Remote' && work && entityCountry !== work) {
        checks.mfEntityCountry.push(record(row, `legal entity is ${entityCountry}, work country is ${work}`));
      }
    }
  }

  const summary = {};
  for (const [name, records] of Object.entries(checks)) summary[name] = records.length;
  return { checks, summary };
}

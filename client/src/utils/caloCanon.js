// Calo people-structure canon — single source of truth for the 2026 field
// guide ("Calo people tags"). Encodes the approved values, the retired ones
// (with their replacements), and the cross-field rules that make a record
// internally consistent: Organization → Business Line → Department →
// Team/Branch → Job Title → Job Family → Role Level.
//
// Pure ESM, zero dependencies. Used by the client (masterfile structure
// checks) AND imported relatively by the server audit (zeltAudit.js) — keep it
// framework-free and side-effect-free.

// ── Normalizers ───────────────────────────────────────────────────────
export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Dept/BL comparison: case-insensitive, '&'/'and' equivalent, punctuation-light.
export const normTag = (s) => norm(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// ── Organization ──────────────────────────────────────────────────────
export const ORGS = ['Basecamp', 'MP KSA', 'MP UAE', 'MP BH', 'MP KW', 'MP QA', 'MP OM', 'MP UK'];

// ── Business Line ─────────────────────────────────────────────────────
export const BUSINESS_LINES = [
  'Subscription', 'Shared Services', 'MP HQ', 'Retail', 'On Demand - Admin',
  'Calo Now', 'Calo Market', 'B2B', 'Calo Black', 'Lola',
];
export const RETIRED_BUSINESS_LINES = {
  'core': 'Subscription',
  'hq cost': 'Shared Services or MP HQ (decide by who the role serves)',
  'calo 2.0': 'retired — no replacement',
  'athletes': 'retired — no replacement',
  'calo marketplace': 'Calo Market',
};

// ── Departments (exactly 21) ──────────────────────────────────────────
export const DEPARTMENTS = [
  'Kitchen', 'Dispatch', 'Stewarding', 'Logistics', 'Supply Chain', 'Quality',
  'Facilities and Engineering',
  'CEO Office', 'Finance', 'Legal', 'People & Culture', 'Marketing & Growth',
  'Business Development', 'Customer Experience', 'AI',
  'Engineering', 'Product', 'IT',
  'Food', 'Retail', 'Calo Market',
];
export const RETIRED_DEPARTMENTS = {
  'finance operations': 'Finance',
  'strategic finance': 'Finance',
  'central operations': 'reassign to the real function (Kitchen/Dispatch/Logistics/…)',
  'leadership': 'CEO Office or the leader’s own function',
  'expansion': 'Business Development',
  'maintenance': 'Facilities and Engineering',
};

// Departments whose CREWS are Production job-family. Desk roles inside them
// belong to the "<Dept> Admin" team and are Non-Production.
export const PRODUCTION_DEPTS = ['Kitchen', 'Dispatch', 'Stewarding', 'Logistics'];
// Office/HQ departments — Production job-family here is always wrong.
export const OFFICE_DEPTS = [
  'CEO Office', 'Finance', 'Legal', 'People & Culture', 'Marketing & Growth',
  'Business Development', 'Customer Experience', 'AI', 'Engineering', 'Product', 'IT', 'Food',
];

// ── Teams per department (from the guide; the full 70-team list lives in
// the cleanup workbook — only enforce membership for depts listed here) ──
export const TEAMS_BY_DEPT = {
  'Finance': ['Finance Ops', 'Strategic Finance', 'Treasury Operations'],
  'People & Culture': ['People Operations', 'People Partnering', 'Talent Acquisition', 'Nationalization', 'People Systems', 'Office Admin', 'IT'],
  'Customer Experience': ['CX Core', 'CX Quality', 'Retention'],
  'Marketing & Growth': ['Marketing', 'Design', 'Content', 'Campaigns & Events', 'Performance Marketing', 'Projects'],
  'Food': ['Food Experience', 'NPD', 'Nutrition', 'Training'],
  'Engineering': ['Software', 'Security', 'Automation'],
};
export const ADMIN_TEAMS = ['Kitchen Admin', 'Dispatch Admin', 'Logistics Admin', 'Supply Chain Admin', 'Retail Admin'];

// ── Job Family & Role Levels ──────────────────────────────────────────
export const JOB_FAMILIES = ['Production', 'Non-Production', 'Retail'];
export const LEVEL_BANDS = { M: [1, 5], IS: [1, 4], IC: [1, 4], P: [1, 12], R: [1, 4] };
export const FAMILY_BANDS = { 'production': ['P'], 'retail': ['R'], 'non-production': ['M', 'IS', 'IC'] };

// 'M3' -> {band:'M', n:3} | null when malformed.
export function parseLevel(level) {
  const m = norm(level).toUpperCase().match(/^(M|IS|IC|P|R)\s*-?\s*(\d{1,2})$/);
  if (!m) return null;
  const band = m[1], n = parseInt(m[2], 10);
  const range = LEVEL_BANDS[band];
  if (!range || n < range[0] || n > range[1]) return null;
  return { band, n };
}

// Family + level must agree (Production=P, Retail=R, Non-Production=M/IS/IC).
// Returns an issue string or null.
export function familyLevelIssue(family, level) {
  // normTag strips hyphens, so both 'Non-Production' and 'Non Production'
  // arrive as 'non production' or 'nonproduction' — map both to the key.
  const fam = normTag(family).replace(/^non\s*production$/, 'non-production');
  if (!fam || !norm(level) || norm(level) === '-') return null; // missing handled elsewhere
  const parsed = parseLevel(level);
  if (!parsed) return `level "${norm(level)}" is not a valid band (M1–M5, IS1–IS4, IC1–IC4, P1–P12, R1–R4)`;
  const bands = FAMILY_BANDS[fam];
  if (!bands) return null; // unknown family handled elsewhere
  if (!bands.includes(parsed.band)) return `family "${norm(family)}" expects ${bands.join('/')}-band, got ${parsed.band}${parsed.n}`;
  return null;
}

// ── Retail branches ───────────────────────────────────────────────────
export const RETAIL_BRANCHES = {
  KSA: ['ROSHN', 'Box@', 'Bay Gate', 'King Fahad', 'King Faisal', 'Kingdom Hospital', 'Qurtuba', 'Sedra', 'SNB', 'MOT'],
  Bahrain: ['Bahrain Cafe'],
  UAE: ['DWTC Cafe', 'Abu Dhabi'],
};
export const ALL_RETAIL_BRANCHES = Object.values(RETAIL_BRANCHES).flat();

// ── Legal entities (contract-level) → country ─────────────────────────
// Matches on the full legal name OR the "known as" alias, case-insensitive.
export const LEGAL_ENTITIES = [
  { match: /falcon hospitality|(^|\b)falcon(\b|$)/i, country: 'Bahrain', name: 'Falcon Hospitality W.L.L' },
  { match: /calo online services/i, country: 'Bahrain', name: 'Calo Online Services W.L.L' },
  { match: /calo cafe/i, country: 'Bahrain', name: 'Calo Cafe W.L.L' },
  { match: /v\s*resto|vresto/i, country: 'Bahrain', name: 'V Resto W.L.L' },
  { match: /calo headquarters|regional hq/i, country: 'KSA', name: 'Calo Headquarters Company (Regional)' },
  { match: /luqmat/i, country: 'KSA', name: 'AlLuqmat AlMumayaza for Catering Service' },
  { match: /alahlam|ahlam|fakihi|fakeehi/i, country: 'KSA', name: 'Alahlam Almomiza Human Resources Company' },
  { match: /nasco/i, country: 'KSA', name: 'Nasco Human Resources Company' },
  { match: /ewan/i, country: 'KSA', name: 'Ewan Human Resources Company' },
  { match: /jussur/i, country: 'KSA', name: 'Jussur Emdad Human Resources Company' },
  { match: /gaya/i, country: 'UAE', name: 'Gaya (Main / Branch 1-3)' },
  { match: /calo catering company|catering.*kw|calo catering kw/i, country: 'Kuwait', name: 'Calo Catering Company' },
  { match: /catering.*hospitality|calo catering qa/i, country: 'Qatar', name: 'Calo Catering & Hospitality Services' },
  { match: /al ghad/i, country: 'Oman', name: 'Al Ghad Al Mumtaz Company SPC' },
  { match: /remotepass|remote pass/i, country: 'Remote', name: 'RemotePass' },
];
export function legalEntityCountry(entity) {
  const s = norm(entity);
  if (!s || s === '-') return null;
  for (const e of LEGAL_ENTITIES) if (e.match.test(s)) return e.country;
  return null;
}

// ── Title intelligence ────────────────────────────────────────────────
// High-precision inference: what a job title implies about dept/family.
// Deliberately conservative — a missed inference is fine, a false flag is not.
// negative: skip inference when the title also matches this (e.g. admin/office roles).
export const TITLE_RULES = [
  { re: /commis|chef de partie|sous chef|head chef|\bcook\b|\bchef\b|baker|butcher|pastry/i, negative: /kitchen manager|admin/i, depts: ['Kitchen'], family: 'Production' },
  { re: /steward/i, negative: /admin/i, depts: ['Stewarding'], family: 'Production' },
  { re: /\bdriver\b|\brider\b|courier/i, negative: /admin/i, depts: ['Dispatch', 'Logistics'], family: 'Production' },
  { re: /dispatcher|dispatch (officer|captain|crew)/i, negative: /admin/i, depts: ['Dispatch'], family: 'Production' },
  { re: /barista|cafe (attendant|supervisor)/i, negative: null, depts: ['Retail'], family: 'Retail' },
  { re: /accountant|accounts? (payable|receivable)|treasury/i, negative: null, depts: ['Finance'], family: 'Non-Production' },
  { re: /recruit(er|ment)|talent acquisition|people (operations|partner)|\bhr\b|human resources/i, negative: null, depts: ['People & Culture'], family: 'Non-Production' },
  { re: /software|backend|frontend|full.?stack|devops|\bqa engineer\b/i, negative: null, depts: ['Engineering'], family: 'Non-Production' },
  { re: /nutrition(ist)?|dietit?ian/i, negative: null, depts: ['Food'], family: 'Non-Production' },
  { re: /procurement|\bbuyer\b|inventory (officer|controller|specialist)/i, negative: null, depts: ['Supply Chain'], family: null },
  { re: /legal counsel|paralegal|\blawyer\b/i, negative: null, depts: ['Legal'], family: 'Non-Production' },
];
// Infer from a title: { depts, family } | null.
export function inferFromTitle(title) {
  const t = norm(title);
  if (!t) return null;
  for (const r of TITLE_RULES) {
    if (r.re.test(t) && !(r.negative && r.negative.test(t))) return { depts: r.depts, family: r.family };
  }
  return null;
}

// ── Title canonicalization (catalog spellings) ────────────────────────
// Known off-catalog variants → the canonical title. Extend as found.
export const TITLE_VARIANTS = [
  { re: /^commis?\s*-?\s*(i|1)$/i, canonical: 'Commis 1' },
  { re: /^commis?\s*-?\s*(ii|2)$/i, canonical: 'Commis 2' },
  { re: /^commis?\s*-?\s*(iii|3)$/i, canonical: 'Commis 3' },
  { re: /^cdp$/i, canonical: 'Chef de Partie' },
  { re: /^(dcdp|demi\s*cdp)$/i, canonical: 'Demi Chef de Partie' },
  { re: /\bsr\.?\s/i, canonical: 'Senior …' },
  { re: /\bjr\.?\s/i, canonical: 'Junior …' },
];
// Returns the canonical suggestion when a title uses a known variant, else null.
export function titleCanonIssue(title) {
  const t = norm(title);
  if (!t) return null;
  for (const v of TITLE_VARIANTS) {
    if (!v.re.test(t)) continue;
    const suggested = v.canonical.includes('…') ? v.canonical.replace('…', t.replace(/\b(sr|jr)\.?\s/i, '')) : v.canonical;
    // Already canonical (e.g. 'Commis 1' matches the variant regex too) -> no issue.
    if (suggested.toLowerCase() === t.toLowerCase()) return null;
    return suggested;
  }
  return null;
}

// ── Membership helpers ────────────────────────────────────────────────
const DEPT_SET = new Set(DEPARTMENTS.map(normTag));
const BL_SET = new Set(BUSINESS_LINES.map(normTag));
const ORG_SET = new Set(ORGS.map(normTag));
export const isApprovedDept = (d) => DEPT_SET.has(normTag(d));
export const retiredDeptReplacement = (d) => RETIRED_DEPARTMENTS[normTag(d)] || null;
export const isApprovedBusinessLine = (b) => BL_SET.has(normTag(b));
export const retiredBusinessLineReplacement = (b) => RETIRED_BUSINESS_LINES[normTag(b)] || null;
export const isApprovedOrg = (o) => ORG_SET.has(normTag(o).replace('mountain peak', 'mp'));
export const isProductionDept = (d) => PRODUCTION_DEPTS.some((x) => normTag(x) === normTag(d));
export const isOfficeDept = (d) => OFFICE_DEPTS.some((x) => normTag(x) === normTag(d));
export const isAdminTeam = (t) => /\badmin\b/i.test(norm(t));
export function teamBelongsToDept(team, dept) {
  const list = TEAMS_BY_DEPT[DEPARTMENTS.find((d) => normTag(d) === normTag(dept))];
  if (!list) return true; // no enforced list for this dept
  const tn = normTag(team);
  if (!tn || tn === '-') return true; // missing team handled elsewhere
  return list.some((x) => normTag(x) === tn) || isAdminTeam(team);
}

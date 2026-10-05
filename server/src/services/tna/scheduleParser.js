// Parser for HR Ops's monthly staff schedule workbooks (the Kuwait format:
// one tab per month, a header row with "Name"/"Position" + real date columns,
// and shift cells like "06:00-15:00", "22:00-07:00" (overnight), "OFF", "AL",
// "PH", "SL". Produces a per-employee, per-date schedule the T&A run uses for
// exact off/leave/absence and scheduled-vs-actual. Names carry no IDs, so
// linkScheduleToRoster() fuzzy-matches them to the Zelt roster.
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { normalizeName } from './identity/normalize.js';
import { diceCoefficient } from './identity/similarity.js';

const ymd = (d) => {
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
};

// "15:00" | "7AM" | "7:00" | "5PM" | bare "7" -> minutes since midnight, or null.
export function parseClock(tok) {
  if (tok == null) return null;
  const s = String(tok).trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) { const h = +m[1], mi = +m[2]; return (h >= 0 && h <= 24 && mi < 60) ? h * 60 + mi : null; }
  m = s.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  if (m) { let h = +m[1] % 12; if (m[3] === 'PM') h += 12; return h * 60 + (+(m[2] || 0)); }
  m = s.match(/^(\d{1,2})$/);
  if (m) { const h = +m[1]; return (h >= 0 && h <= 24) ? h * 60 : null; }
  return null;
}

// Minutes a scheduled shift spans (handles midnight crossing).
export function scheduledMinutes(shift) {
  if (!shift || shift.type !== 'work' || shift.start == null || shift.end == null) return null;
  const end = shift.end === 0 ? 1440 : shift.end; // 00:00 end = midnight
  return shift.overnight || end <= shift.start ? (1440 - shift.start) + (shift.end === 0 ? 0 : shift.end) : end - shift.start;
}

// One schedule cell -> classification.
export function parseShiftCell(raw) {
  if (raw == null) return { type: 'none' };
  if (raw instanceof Date) return { type: 'none' }; // stray date echoed into a cell
  const s = String(raw).trim();
  if (!s) return { type: 'none' };
  const u = s.toUpperCase();
  if (/^OFF$/.test(u)) return { type: 'off', raw: s };
  if (/^PH$/.test(u) || /PUBLIC\s*HOLIDAY/.test(u)) return { type: 'off', leaveKind: 'ph', raw: s };
  if (/^A\.?\s*L\.?$/.test(u) || /ANNUAL/.test(u)) return { type: 'leave', leaveKind: 'annual', raw: s };
  if (/^S\.?\s*L\.?$/.test(u) || /SICK/.test(u)) return { type: 'leave', leaveKind: 'sick', raw: s };
  if (/^TIL$/.test(u)) return { type: 'leave', leaveKind: 'til', raw: s };
  if (/^ABSENT$/.test(u)) return { type: 'absent', raw: s };
  if (/^INDUCTION$/.test(u)) return { type: 'work', start: null, end: null, overnight: false, note: 'induction', raw: s };
  // weekday names / plain notes with no digits -> ignore
  if (!/\d/.test(u)) return { type: 'none', raw: s };
  // time window "A-B"
  const parts = s.split(/[-–]/);
  if (parts.length === 2) {
    const a = parseClock(parts[0]), b = parseClock(parts[1]);
    if (a != null && b != null) {
      const overnight = (b === 0) || (b <= a); // ends at/after midnight relative to start
      return { type: 'work', start: a, end: b, overnight, raw: s };
    }
  }
  return { type: 'unknown', raw: s };
}

// Is this row a section header ("KITCHEN TEAM", "Operations") rather than a
// person? Section headers have a name-ish cell but no real position.
function looksLikeSection(name, position) {
  if (position && String(position).trim()) return false;      // has a position -> a person
  const n = String(name || '').trim();
  if (!n) return true;
  if (/team|section|operations|support|dispatch|logistic|supply|kitchen/i.test(n) && n === n.toUpperCase()) return true;
  if (/^\d+$/.test(n)) return true;                           // stray count cell
  return false;
}

// Find the date row (most Date cells) and the Name/Position columns.
function locateLayout(aoa) {
  let dateRow = -1, best = 0, dateCols = [];
  for (let r = 0; r < Math.min(aoa.length, 12); r++) {
    const cols = [];
    for (let c = 0; c < aoa[r].length; c++) if (aoa[r][c] instanceof Date) cols.push(c);
    if (cols.length > best) { best = cols.length; dateRow = r; dateCols = cols; }
  }
  if (dateRow < 0 || best < 3) return null;
  // Name/Position columns: search the date row and the two rows above it.
  let nameCol = -1, posCol = -1;
  for (let r = Math.max(0, dateRow - 2); r <= dateRow; r++) {
    for (let c = 0; c < aoa[r].length; c++) {
      const v = String(aoa[r][c] ?? '').trim().toLowerCase();
      if (nameCol < 0 && /^name$/.test(v)) nameCol = c;
      if (posCol < 0 && /^position$/.test(v)) posCol = c;
    }
  }
  if (nameCol < 0) nameCol = 1;   // observed default (col B)
  if (posCol < 0) posCol = nameCol + 1;
  return { dateRow, dateCols, nameCol, posCol };
}

function parseSheet(aoa) {
  const layout = locateLayout(aoa);
  if (!layout) return null;
  const { dateRow, dateCols, nameCol, posCol } = layout;
  const colDate = new Map(dateCols.map(c => [c, ymd(aoa[dateRow][c])]).filter(([, d]) => d));
  const employees = [];
  const dates = new Set();
  for (let r = dateRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const name = row[nameCol], position = row[posCol];
    if (looksLikeSection(name, position)) continue;
    if (!name || !String(name).trim()) continue;
    const days = {};
    let hasAny = false;
    for (const [c, date] of colDate) {
      const shift = parseShiftCell(row[c]);
      if (shift.type === 'none') continue;
      days[date] = shift;
      dates.add(date);
      if (shift.type === 'work' || shift.type === 'off' || shift.type === 'leave') hasAny = true;
    }
    if (!hasAny) continue; // a name row with no real schedule content
    employees.push({ name: String(name).trim(), position: String(position || '').trim(), days });
  }
  if (!employees.length) return null;
  const sorted = [...dates].sort();
  return { employees, periodStart: sorted[0] || null, periodEnd: sorted[sorted.length - 1] || null, dateCount: sorted.length };
}

/**
 * Parse a schedule workbook. Picks the tab whose dates best overlap the
 * requested window (or the latest tab when no window is given).
 * @returns {{ tab, employees, periodStart, periodEnd, tabsConsidered }}
 */
export function parseScheduleWorkbook(pathOrBuffer, { periodStart = null, periodEnd = null } = {}) {
  const buf = typeof pathOrBuffer === 'string' ? readFileSync(pathOrBuffer) : pathOrBuffer;
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const candidates = [];
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const parsed = parseSheet(aoa);
    if (parsed) candidates.push({ tab: name, ...parsed });
  }
  if (!candidates.length) {
    const e = new Error('No schedule tab found — expected a sheet with a Name/Position header and dated day columns.');
    e.userError = true; throw e;
  }
  const overlap = (c) => {
    if (!periodStart || !periodEnd || !c.periodStart) return -1;
    const lo = c.periodStart > periodStart ? c.periodStart : periodStart;
    const hi = c.periodEnd < periodEnd ? c.periodEnd : periodEnd;
    return lo <= hi ? 1 : 0;
  };
  candidates.sort((a, b) => {
    const ov = overlap(b) - overlap(a);
    if (ov !== 0) return ov;
    return (b.periodEnd || '').localeCompare(a.periodEnd || ''); // else latest
  });
  const chosen = candidates[0];
  return { ...chosen, tabsConsidered: candidates.length };
}

/**
 * Link parsed schedule employees to the Zelt roster by name.
 * roster: [{ empId, name, ... }]. Returns the employees annotated with
 * employeeId (or null) + an `unmatched` list for review.
 */
export function linkScheduleToRoster(employees, roster = []) {
  const byNorm = new Map();   // normalized full name -> empId
  const byTokens = [];        // { tokens:Set, empId, name }
  for (const r of roster) {
    const n = normalizeName(r.name || '');
    if (!n) continue;
    if (!byNorm.has(n)) byNorm.set(n, r.empId);
    byTokens.push({ tokens: new Set(n.split(' ').filter(Boolean)), empId: r.empId, name: r.name, norm: n });
  }
  const unmatched = [];
  let matched = 0;
  for (const emp of employees) {
    const n = normalizeName(emp.name);
    const toks = n.split(' ').filter(Boolean);
    let hit = byNorm.get(n) || null;
    if (!hit && toks.length) {
      // token-subset: every schedule token appears in a roster name (handles
      // "Rakesh Ghosh" vs "Rakesh Kumar Ghosh"); then dice as a last resort.
      let bestDice = 0, bestId = null;
      for (const cand of byTokens) {
        const allIn = toks.every(t => cand.tokens.has(t));
        if (allIn) { hit = cand.empId; break; }
        const d = diceCoefficient(toks.slice().sort().join(' '), [...cand.tokens].sort().join(' '));
        if (d > bestDice) { bestDice = d; bestId = cand.empId; }
      }
      if (!hit && bestDice >= 0.72) hit = bestId; // conservative — avoid mis-assigning single names
    }
    emp.employeeId = hit;
    if (hit) matched += 1;
    else unmatched.push({ name: emp.name, position: emp.position });
  }
  return { employees, matched, unmatched };
}

/**
 * Full pipeline: parse + link + reshape into { byEmpId: Map<empId, Map<ymd, shift>> }
 * that runService consumes, plus meta for the report.
 */
export function buildScheduleIndex(pathOrBuffer, roster, window = {}) {
  const parsed = parseScheduleWorkbook(pathOrBuffer, window);
  const { employees, matched, unmatched } = linkScheduleToRoster(parsed.employees, roster);
  const byEmpId = new Map();
  for (const emp of employees) {
    if (!emp.employeeId) continue;
    const m = new Map(Object.entries(emp.days));
    byEmpId.set(String(emp.employeeId).trim(), m);
  }
  return {
    byEmpId,
    meta: {
      tab: parsed.tab,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      employees: employees.length,
      matched,
      unmatchedCount: unmatched.length,
    },
    unmatched,
  };
}

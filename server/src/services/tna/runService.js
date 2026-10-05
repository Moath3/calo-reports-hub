// T&A run service — the shared core behind both the Hub route and the CLI tool.
// Computes per-employee overtime using PER-COUNTRY thresholds (UAE after 10h;
// KSA/Kuwait/Bahrain after 9h), joins to HR masters by ID, scopes to blue-collar
// production, and returns a structured result (no I/O side effects beyond reading
// the given file paths). buildWorkbook() turns a result into an .xlsx Buffer.
import * as XLSX from 'xlsx';
import { classifyDay } from './otEngine.js';
import { getOtConfig } from './otConfig.js';
import { resolveCountry, canonicalEntity } from './entityAliases.js';
import { normalizeId, normalizeName } from './identity/normalize.js';
import { diceCoefficient } from './identity/similarity.js';
import { loadAttendance, loadMaster, parseMinutes, toYMD, detectDateOrder, EXCLUDE_POSITION } from './fileLib.js';
import { fixOvernightDays, MAX_SHIFT_MINUTES } from './overnight.js';
import { scheduledMinutes } from './scheduleParser.js';

// A matched master name agrees with the attendance name if they share a token
// (handles first-name-only attendance) or are similar overall; used only as a
// non-blocking collision flag, never to reject a match.
function nameAgrees(attName, masterName) {
  if (!attName || !masterName) return true;
  const a = normalizeName(attName).split(' ').filter(Boolean);
  const b = new Set(normalizeName(masterName).split(' ').filter(Boolean));
  if (!a.length || !b.size) return true;
  if (a.some((t) => b.has(t))) return true;
  return diceCoefficient(a.slice().sort().join(' '), [...b].sort().join(' ')) >= 0.5;
}

// A date counts as a work day only if at least this share of the active team
// badged in that day — so weekends/holidays drop out without a roster.
const WORKDAY_THRESHOLD = 0.5;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOf = (ymd) => WEEKDAYS[new Date(ymd + 'T00:00:00Z').getUTCDay()];
// Inclusive list of YYYY-MM-DD between start and end (UTC, no tz drift).
function eachDate(start, end) {
  const out = [], e = new Date(end + 'T00:00:00Z');
  for (let d = new Date(start + 'T00:00:00Z'); d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/**
 * Run a T&A period.
 * @param {object} opts
 * @param {string} opts.attendancePath - path to the attendance export (.csv/.xlsx)
 * @param {Array<{label:string,path:string,sheet?:string}>} [opts.masters] - HR master files
 * @param {Array<{empId:string,name:string,position:string,entity:string,source:string}>} [opts.rosterRecords] - pre-loaded roster (e.g. from Zelt), merged with file masters
 * @param {string|null} [opts.month] - optional 'YYYY-MM' filter on the Date column
 * @returns {object} structured result (see fields below)
 */
// Parse a Check In/Out state ("Check In", "IN", "I", "C/In", "duty on" …).
function punchDirection(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/\bout\b|check\s*-?\s*out|duty\s*off|^o$|c\/?\s*out|sign\s*out/.test(s)) return 'out';
  if (/\bin\b|check\s*-?\s*in|duty\s*on|^i$|c\/?\s*in|sign\s*in/.test(s)) return 'in';
  return null;
}
const HHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Build per-employee day records from a raw punch log. Pairs IN→OUT across the
// whole period, attributes each session to its shift-START date (so overnight
// shifts are one day with real check-in/out), and leaves orphan punches as
// incomplete days. Mutates `emp`.
function buildDaysFromTransactions(rows, cols, dateOrder, month, emp) {
  // Gather punches per employee: absolute minutes = dayIndex*1440 + timeOfDay.
  const byEmp = new Map();
  for (const r of rows) {
    const ymd = toYMD(r[cols.date], dateOrder);
    const tod = parseMinutes(r[cols.punchTime]);
    const dir = punchDirection(r[cols.state]);
    const id = String(r[cols.id] ?? '').trim();
    if (!ymd || tod == null || !dir || !id) continue;
    const dayAbs = Math.floor(Date.parse(ymd + 'T00:00:00Z') / 86400000);
    if (!byEmp.has(id)) byEmp.set(id, { name: cols.name ? String(r[cols.name] ?? '').trim() : '', dept: cols.dept ? String(r[cols.dept] ?? '').trim() : '', punches: [] });
    byEmp.get(id).punches.push({ ymd, tod, dir, abs: dayAbs * 1440 + tod });
  }
  for (const [id, { name, dept, punches }] of byEmp) {
    punches.sort((a, b) => a.abs - b.abs);
    const days = new Map();
    const touch = (ymd) => days.get(ymd) || { date: ymd, minutes: null, checkIn: '', checkOut: '' };
    let open = null;
    for (const p of punches) {
      if (p.dir === 'in') {
        if (open) { const r0 = touch(open.ymd); r0.checkIn = r0.checkIn || HHMM(open.tod); days.set(open.ymd, r0); } // unclosed IN -> incomplete day
        open = p;
      } else { // out
        if (!open) { const r0 = touch(p.ymd); r0.checkOut = r0.checkOut || HHMM(p.tod); days.set(p.ymd, r0); continue; } // orphan OUT
        const session = p.abs - open.abs;
        const rec = touch(open.ymd);
        rec.checkIn = HHMM(open.tod);
        rec.checkOut = HHMM(p.tod);
        rec.minutes = session; // >16h handled downstream (longShift -> flagged, not scored)
        days.set(open.ymd, rec);
        open = null;
      }
    }
    if (open) { const r0 = touch(open.ymd); r0.checkIn = r0.checkIn || HHMM(open.tod); days.set(open.ymd, r0); }
    // Apply the month filter on the shift-start date.
    for (const [ymd, rec] of [...days]) if (month && !ymd.startsWith(month)) days.delete(ymd);
    if (days.size) emp.set(id, { empCode: id, name, dept, days });
  }
}

export function runPeriod({ attendancePath, masters = [], rosterRecords = [], month = null, schedule = null }) {
  // ── Pass 1: per-employee day minutes from the attendance ──────────
  const { rows, cols } = loadAttendance(attendancePath);
  if (!cols.id) {
    const e = new Error('Could not detect an Employee ID column in the attendance file — check for a banner/title row above the header, or that the file has an "Employee ID" / "Emp No" column.');
    e.userError = true;
    throw e;
  }
  const emp = new Map(); // id -> { empCode, name, dept, days: Map<ymd, {date, minutes, checkIn, checkOut}> }
  const dateOrder = detectDateOrder(rows.map((r) => r[cols.date]));
  const fromTransactions = cols.isTransactions;
  if (fromTransactions) {
    // Raw punch log (one row per punch + a Check In/Out state) — the accurate
    // source. Pair IN→OUT across the WHOLE period and attribute each session to
    // its shift-START date, so night shifts crossing midnight are one correct
    // day with real check-in/out, not a min/max of the calendar day.
    buildDaysFromTransactions(rows, cols, dateOrder, month, emp);
  } else {
    for (const r of rows) {
      const ymd = toYMD(r[cols.date], dateOrder);
      if (!ymd) continue;                            // unparseable date -> skip
      if (month && !ymd.startsWith(month)) continue;
      const id = String(r[cols.id] ?? '').trim();
      if (!id) continue;
      const dept = cols.dept ? String(r[cols.dept] ?? '').trim() : '';
      if (!emp.has(id)) emp.set(id, { empCode: id, name: cols.name ? String(r[cols.name] ?? '').trim() : '', dept, days: new Map() });
      const e = emp.get(id);
      if (!e.dept && dept) e.dept = dept;
      const min = parseMinutes(r[cols.time]);
      const checkIn = cols.checkIn ? String(r[cols.checkIn] ?? '').trim() : '';
      const checkOut = cols.checkOut ? String(r[cols.checkOut] ?? '').trim() : '';
      // One record per employee-day. Split-shift / duplicate rows for the same day
      // are merged: minutes sum, earliest check-in and latest check-out kept — so
      // the OT path and the calendar path use the same per-day numbers.
      const rec = e.days.get(ymd) || { date: ymd, minutes: null, checkIn: '', checkOut: '' };
      if (min != null) rec.minutes = (rec.minutes || 0) + min;
      if (checkIn && (!rec.checkIn || parseMinutes(checkIn) < parseMinutes(rec.checkIn))) rec.checkIn = checkIn;
      if (checkOut && (!rec.checkOut || parseMinutes(checkOut) > parseMinutes(rec.checkOut))) rec.checkOut = checkOut;
      e.days.set(ymd, rec);
    }
  }
  if (emp.size === 0) {
    const e = new Error(rows.length ? 'No attendance rows matched — check the Date column format (e.g. dd/mm/yyyy) or the month filter.' : 'The attendance file has no data rows.');
    e.userError = true;
    throw e;
  }

  // The attendance file defines the reporting window. The schedule only drives
  // days INSIDE this range — a roster tab that extends past the attendance
  // (e.g. a Sep–Oct tab against a September file) must not add phantom Oct days
  // or flag them as absent.
  let attStart = null, attEnd = null;
  for (const e of emp.values()) for (const d of e.days.keys()) { if (!attStart || d < attStart) attStart = d; if (!attEnd || d > attEnd) attEnd = d; }
  const inAttWindow = (d) => d >= attStart && d <= attEnd;

  // ── Overnight repair ───────────────────────────────────────────────
  // Exports mangle night shifts two ways: the split flavor breaks one shift
  // across two calendar-day rows; the mispaired flavor (UAE) pairs tonight's
  // in with THIS morning's out, which belongs to yesterday's shift. Both are
  // normalized to ONE working day attributed to the PUNCH-IN date, so
  // present-days, hours and OT are counted once — and off days stay clean.
  // The transaction path already pairs punches correctly (overnight-aware), so
  // the summary-format stitching would only mis-handle already-correct days.
  let stitchedSessions = 0;
  if (!fromTransactions) for (const e of emp.values()) stitchedSessions += fixOvernightDays(e.days).stitched;

  // ── Masters (optional): collision-safe direct ID join ─────────────
  const scopeBy = new Map(); // empCode -> { position, source, entity, nameMismatch }
  const mastersMeta = [];
  let ambiguousIds = 0, nameMismatches = 0;
  const hasMasters = masters.length > 0 || rosterRecords.length > 0;
  if (hasMasters) {
    const attIdSet = new Set([...emp.keys()].map(normalizeId));
    const combined = masters.flatMap((m) => {
      const { records, meta } = loadMaster(m, attIdSet);
      mastersMeta.push({ label: m.label, ...meta });
      return records;
    });
    // Roster records (e.g. from Zelt) join the same way as file masters.
    if (rosterRecords.length) {
      const overlap = rosterRecords.reduce((n, r) => n + (attIdSet.has(normalizeId(r.empId)) ? 1 : 0), 0);
      mastersMeta.push({ label: 'Zelt', sheetName: 'roster', rows: rosterRecords.length, idCol: 'employeeId', overlap, candidates: ['employeeId'] });
      combined.push(...rosterRecords);
    }
    const groups = new Map();
    for (const rec of combined) { const k = normalizeId(rec.empId); if (!k) continue; (groups.get(k) || groups.set(k, []).get(k)).push(rec); }
    const byId = new Map();
    for (const [k, recs] of groups) {
      const ents = new Set(recs.map((r) => canonicalEntity(r.entity)).filter(Boolean));
      // Conflict = different ENTITIES, or names that genuinely disagree (not just
      // spelling variants of one person). Either way, two different people share
      // this ID -> don't auto-pick one; leave it unmatched and flag for review.
      const names = recs.map((r) => r.name).filter(Boolean);
      const namesConflict = names.some((n, i) => names.slice(i + 1).some((m) => !nameAgrees(n, m)));
      if (ents.size > 1 || namesConflict) { ambiguousIds += 1; continue; }
      byId.set(k, recs.find((r) => r.position) || recs[0]);
    }
    for (const e of emp.values()) {
      const rec = byId.get(normalizeId(e.empCode));
      if (!rec) continue;
      const mismatch = !nameAgrees(e.name, rec.name);
      if (mismatch) nameMismatches += 1;
      scopeBy.set(e.empCode, { position: rec.position || '', source: rec.source || '', entity: rec.entity || null, dept: rec.department || '', nameMismatch: mismatch });
    }
  }

  // A matched master/Zelt department agrees with the attendance department if
  // either contains the other or they share a real word (attendance depts look
  // like "CALO UAE - Kitchen" vs Zelt's "Kitchen").
  const deptAgrees = (attDept, mDept) => {
    if (!attDept || !mDept) return true;
    const a = attDept.toLowerCase(), b = mDept.toLowerCase();
    if (a.includes(b) || b.includes(a)) return true;
    const toks = new Set(a.split(/[^a-z]+/).filter((t) => t.length > 2));
    return b.split(/[^a-z]+/).some((t) => t.length > 2 && toks.has(t));
  };

  // ── Schedule (optional): HR Ops roster keyed by employee id ───────
  // schedule.byEmpId: Map<empId, Map<ymd, shift>> where shift =
  // { type:'work'|'off'|'leave'|'absent', start, end, overnight, leaveKind, raw }.
  const schedByEmp = new Map();
  if (schedule?.byEmpId instanceof Map) {
    for (const [id, m] of schedule.byEmpId) schedByEmp.set(normalizeId(id), m);
  }
  const hhmm = (min) => min == null ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const shiftLabel = (s) => {
    if (!s) return '';
    if (s.type === 'off') return s.leaveKind === 'ph' ? 'PH' : 'OFF';
    if (s.type === 'leave') return (s.leaveKind || 'leave').toUpperCase();
    if (s.type === 'absent') return 'ABSENT';
    if (s.type === 'work') return s.start != null ? `${hhmm(s.start)}-${hhmm(s.end)}` : (s.note || 'work');
    return s.raw || '';
  };

  // ── Pass 2: per-country OT per employee ───────────────────────────
  const outRows = [];
  for (const e of emp.values()) {
    const sc = scopeBy.get(e.empCode) || {};
    const sched = schedByEmp.get(normalizeId(e.empCode)) || null;
    const country = resolveCountry(e.dept) || resolveCountry(sc.entity) || null;
    const cfg = getOtConfig(country || e.dept);
    const cfgMin = cfg.standardDailyMinutes;
    let otDays = 0, otMin = 0, otDays9 = 0;
    const days = [...e.days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => {
      const ci = parseMinutes(d.checkIn), co = parseMinutes(d.checkOut);
      const overnight = ci != null && co != null && co < ci; // out clock strictly before in -> crossed midnight
      // Over 16h on one day means a missed punch, never a real shift — treat
      // as missing hours (review) instead of scoring phantom overtime, but keep
      // the raw figure + a flag so the report can surface the >16h anomaly.
      const longShift = d.minutes != null && d.minutes > MAX_SHIFT_MINUTES;
      const rawHours = d.minutes != null ? +(d.minutes / 60).toFixed(2) : null;
      const minutes = longShift ? null : d.minutes;
      let ot = false, dayOtMin = 0;
      if (minutes != null) {
        const c = classifyDay({ workedMinutes: minutes, incomplete: false }, { status: 'work', scheduledMinutes: cfgMin }, cfg);
        if ((c.overtime || 0) > 0) { otDays += 1; otMin += c.overtime; ot = true; dayOtMin = c.overtime; }
        if (minutes > 540) otDays9 += 1; // illustrative flat-9h comparison
      }
      const shift = sched ? sched.get(d.date) : null;
      const scheduled = shiftLabel(shift);
      const schedMin = shift && shift.type === 'work' ? scheduledMinutes(shift) : null;
      // Variance (actual − scheduled), in hours, when both are known.
      const varianceH = (minutes != null && schedMin != null) ? +((minutes - schedMin) / 60).toFixed(2) : null;
      return { date: d.date, weekday: weekdayOf(d.date), hours: minutes != null ? +(minutes / 60).toFixed(2) : null, rawHours, longShift, checkIn: d.checkIn || '', checkOut: d.checkOut || '', overnight, stitched: !!d.stitched, ot, otMin: dayOtMin, scheduled, schedType: shift?.type || null, schedOvernight: !!shift?.overnight, varianceH };
    });
    // Schedule-driven calendar: add a row for every SCHEDULED day the employee
    // didn't punch (OFF / leave / a no-show work day), carrying the exact
    // scheduled time or OFF label — so the report shows the roster for each day,
    // not only the days with attendance. These carry no hours (not scored).
    if (sched) {
      const have = new Set(days.map((d) => d.date));
      for (const [date, shift] of sched) {
        if (have.has(date) || !inAttWindow(date)) continue; // only within the attendance window
        days.push({ date, weekday: weekdayOf(date), hours: null, rawHours: null, longShift: false, checkIn: '', checkOut: '', overnight: false, stitched: false, ot: false, otMin: 0, scheduled: shiftLabel(shift), schedType: shift.type || null, schedOvernight: !!shift.overnight, varianceH: null });
      }
      days.sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    // Work rate: how long this person's typical day runs (8–12h is normal for
    // production; <4h or >12h days are flagged so odd punches stand out).
    const hoursDays = days.filter((d) => d.hours != null);
    const totalHours = +hoursDays.reduce((a, d) => a + d.hours, 0).toFixed(1);
    const avgHours = hoursDays.length ? +(totalHours / hoursDays.length).toFixed(2) : null;
    const shortDays = hoursDays.filter((d) => d.hours < 4).length;
    const longDays = hoursDays.filter((d) => d.hours > 12).length;
    // Scheduled-vs-actual roll-up (only meaningful when this person is on the
    // uploaded schedule). variance totals the signed actual−scheduled hours.
    const scheduledDays = sched ? days.filter((d) => d.schedType === 'work').length : 0;
    const varianceHours = sched ? +days.reduce((a, d) => a + (d.varianceH || 0), 0).toFixed(1) : null;
    const position = sc.position || '';
    const matched = scopeBy.has(e.empCode);
    const isExcluded = !!position && EXCLUDE_POSITION.test(position);
    const noPosition = matched && !position;
    const inScope = !hasMasters || (matched && !!position && !isExcluded);
    outRows.push({
      empCode: e.empCode, name: e.name, country: country || 'UNKNOWN', dept: e.dept,
      present: e.days.size, otDays, otHours: +(otMin / 60).toFixed(2), otDays9,
      source: sc.source || '', position, matched, noPosition, isExcluded, inScope, nameMismatch: !!sc.nameMismatch,
      masterDept: sc.dept || '', deptMismatch: matched && !deptAgrees(e.dept, sc.dept),
      daysWorked: e.days.size, overnightDays: days.filter((d) => d.overnight).length,
      longShiftDays: days.filter((d) => d.longShift).length,
      stitchedDays: days.filter((d) => d.stitched).length,
      totalHours, avgHours, shortDays, longDays, daysWithHours: hoursDays.length,
      hasSchedule: !!sched, scheduledDays, varianceHours,
      firstSeen: days.length ? days[0].date : null, lastSeen: days.length ? days[days.length - 1].date : null,
      days, absences: [], absentDays: 0,
    });
  }

  // ── Aggregate ─────────────────────────────────────────────────────
  const inScopeRows = outRows.filter((e) => !hasMasters || e.inScope);
  const byCountryMap = {};
  for (const e of inScopeRows) {
    const cfgMin = getOtConfig(e.country).standardDailyMinutes;
    const g = (byCountryMap[e.country] ||= { country: e.country, rule: `${cfgMin / 60}h`, emps: 0, present: 0, otDays: 0, otHours: 0, otDays9: 0 });
    g.emps += 1; g.present += e.present; g.otDays += e.otDays; g.otHours += e.otHours; g.otDays9 += e.otDays9;
  }
  const byCountry = Object.values(byCountryMap).map((g) => ({ ...g, otHours: +g.otHours.toFixed(1) }));
  const totals = {
    employees: inScopeRows.length,
    otDays: inScopeRows.reduce((a, e) => a + e.otDays, 0),
    // Sum the already-rounded per-country values so the displayed parts always
    // reconcile to the displayed total (no off-by-0.1 from independent rounding).
    otHours: +byCountry.reduce((a, g) => a + g.otHours, 0).toFixed(1),
  };

  // ── Calendar: infer work days from team attendance, then find absences ──
  // A date is a work day if >= WORKDAY_THRESHOLD of the active in-scope team
  // badged in that day (active = employees whose first..last seen span covers it).
  // Absence = a work day inside an employee's own span where they didn't badge.
  // The team signal (present/active per date) is built from in-scope employees.
  // Per-employee absence uses a LEAVE-ONE-OUT ratio (exclude the person under
  // test) so an absentee can't drag their own day below the threshold — without
  // it, single/tiny cohorts would silently swallow real absences.
  let daily = { periodStart: null, periodEnd: null, workDays: [], offDays: [], totalAbsences: 0, totalOvernight: 0, inferred: true, scheduled: schedByEmp.size > 0 };

  // (A) Scheduled employees: exact absences = scheduled WORK (or explicit
  // ABSENT) days with no actual worked hours. Iterate the SCHEDULE's dates (not
  // attendance), so a no-show on a day with no punch row still counts — and so
  // an overnight whose end-date row was consumed by stitching isn't missed.
  // OFF/PH/AL/SL are never absences.
  for (const e of outRows) {
    if (!e.hasSchedule) continue;
    const sched = schedByEmp.get(normalizeId(e.empCode));
    if (!sched) continue;
    const workedSet = new Set(e.days.filter((d) => d.hours != null && d.hours > 0).map((d) => d.date));
    const abs = [];
    for (const [date, shift] of sched) {
      if (!inAttWindow(date)) continue; // no attendance beyond the file window -> can't call it absent
      const isSchedWork = shift.type === 'work' || shift.type === 'absent';
      if (isSchedWork && !workedSet.has(date)) abs.push({ date, weekday: weekdayOf(date) });
    }
    abs.sort((a, b) => (a.date < b.date ? -1 : 1));
    e.absences = abs;
    e.absentDays = abs.length;
  }

  // (B) Non-scheduled employees: keep the team-attendance inference.
  const inDated = inScopeRows.filter((e) => e.firstSeen && !e.hasSchedule);
  if (inDated.length) {
    const periodStart = inDated.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), inDated[0].firstSeen);
    const periodEnd = inDated.reduce((m, e) => (e.lastSeen > m ? e.lastSeen : m), inDated[0].lastSeen);
    const present = Object.create(null), active = Object.create(null);
    for (const e of inDated) {
      const set = new Set(e.days.map((d) => d.date));
      for (const d of eachDate(e.firstSeen, e.lastSeen)) { active[d] = (active[d] || 0) + 1; if (set.has(d)) present[d] = (present[d] || 0) + 1; }
    }
    // Global work-day set for the summary (no leave-one-out).
    const workDaysSet = new Set();
    for (const d of eachDate(periodStart, periodEnd)) { const a = active[d] || 0, p = present[d] || 0; if (a > 0 && p / a >= WORKDAY_THRESHOLD) workDaysSet.add(d); }
    // Absences for every non-scheduled dated employee; in-scope members are
    // excluded from their own date's ratio so they can't suppress their own absence.
    for (const e of outRows) {
      if (!e.firstSeen || e.hasSchedule) continue;
      const set = new Set(e.days.map((d) => d.date));
      const inPool = e.inScope;
      const abs = [];
      for (const d of eachDate(e.firstSeen, e.lastSeen)) {
        const a = (active[d] || 0) - (inPool ? 1 : 0);
        const p = (present[d] || 0) - (inPool && set.has(d) ? 1 : 0);
        if (a > 0 && p / a >= WORKDAY_THRESHOLD && !set.has(d)) abs.push({ date: d, weekday: weekdayOf(d) });
      }
      e.absences = abs;
      e.absentDays = abs.length;
    }
    const allRange = eachDate(periodStart, periodEnd);
    daily.workDays = allRange.filter((d) => workDaysSet.has(d));
    daily.offDays = allRange.filter((d) => !workDaysSet.has(d));
    daily.periodStart = periodStart;
    daily.periodEnd = periodEnd;
  }

  // Period bounds + totals span BOTH paths (scheduled + inferred).
  const allSeen = inScopeRows.filter((e) => e.firstSeen);
  if (allSeen.length) {
    const ps = allSeen.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), allSeen[0].firstSeen);
    const pe = allSeen.reduce((m, e) => (e.lastSeen > m ? e.lastSeen : m), allSeen[0].lastSeen);
    daily.periodStart = daily.periodStart && daily.periodStart < ps ? daily.periodStart : ps;
    daily.periodEnd = daily.periodEnd && daily.periodEnd > pe ? daily.periodEnd : pe;
  }
  daily.totalAbsences = inScopeRows.reduce((a, e) => a + (e.absentDays || 0), 0);
  daily.totalOvernight = inScopeRows.reduce((a, e) => a + (e.overnightDays || 0), 0);

  // Rest / OFF days per employee: a date inside their active span that they
  // neither worked nor were absent on. For scheduled employees these are the
  // roster's OFF/leave days; for inferred ones they're the un-flagged gaps
  // (e.g. a night worker's weekly rest). Surfaced so the report shows rest,
  // not just worked days.
  for (const e of outRows) {
    if (e.hasSchedule) {
      // Scheduled: OFF comes straight from the roster (type 'off', incl. PH);
      // leave (AL/SL/TIL) is tracked separately.
      e.restDates = e.days.filter((d) => d.schedType === 'off').map((d) => d.date);
      e.restDays = e.restDates.length;
      e.leaveDates = e.days.filter((d) => d.schedType === 'leave').map((d) => d.date);
      e.leaveDays = e.leaveDates.length;
      continue;
    }
    if (!e.firstSeen) { e.restDates = []; e.restDays = 0; continue; }
    const worked = new Set(e.days.map((d) => d.date));
    const absent = new Set((e.absences || []).map((a) => a.date));
    const rest = [];
    for (const d of eachDate(e.firstSeen, e.lastSeen)) {
      if (!worked.has(d) && !absent.has(d)) rest.push(d);
    }
    e.restDates = rest;
    e.restDays = rest.length;
  }
  daily.totalRestDays = inScopeRows.reduce((a, e) => a + (e.restDays || 0), 0);

  const scope = {
    matched: scopeBy.size,
    inScope: inScopeRows.length,
    excluded: outRows.filter((e) => e.isExcluded).length,
    noPosition: outRows.filter((e) => e.noPosition).length,
    unmatched: hasMasters ? outRows.filter((e) => !e.matched).length : 0,
  };
  const flags = {
    ambiguousIds, nameMismatches,
    deptMismatches: outRows.filter((e) => e.deptMismatch).length,
    unknownCountry: inScopeRows.filter((e) => e.country === 'UNKNOWN').length,
    // master(s) supplied but nothing joined -> everyone is unmatched and the
    // totals read as a misleading zero; surface it loudly instead.
    mastersMatchedNone: hasMasters && scopeBy.size === 0,
  };

  // ── Report aggregates (drive the 9-sheet report + the AI narrative) ──
  const workDaySet = new Set(daily.workDays);
  // Per-date roll-up: who's present/absent/on-OT each day.
  const byDateMap = new Map();
  const touchDate = (date, weekday) => { let g = byDateMap.get(date); if (!g) { g = { date, weekday, present: 0, absent: 0, hours: 0, onOt: 0, otHours: 0 }; byDateMap.set(date, g); } return g; };
  for (const e of inScopeRows) {
    for (const d of e.days) { const g = touchDate(d.date, d.weekday); g.present += 1; g.hours += d.hours || 0; if (d.ot) { g.onOt += 1; g.otHours += d.otMin / 60; } }
    for (const a of e.absences) { touchDate(a.date, a.weekday).absent += 1; }
  }
  const byDate = [...byDateMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((g) => ({ ...g, hours: +g.hours.toFixed(1), otHours: +g.otHours.toFixed(1), isWorkDay: workDaySet.has(g.date) }));

  // Per-department (with country) roll-up.
  const byDeptMap = new Map();
  for (const e of inScopeRows) {
    const key = (e.dept || '(no dept)') + '||' + e.country;
    let g = byDeptMap.get(key);
    if (!g) { g = { dept: e.dept || '(no dept)', country: e.country, employees: 0, presentDays: 0, otDays: 0, otHours: 0, absences: 0 }; byDeptMap.set(key, g); }
    g.employees += 1; g.presentDays += e.present; g.otDays += e.otDays; g.otHours += e.otHours; g.absences += e.absentDays;
  }
  const byDept = [...byDeptMap.values()].map((g) => ({ ...g, otHours: +g.otHours.toFixed(1) })).sort((a, b) => b.otDays - a.otDays);

  const topOt = inScopeRows.filter((e) => e.otDays > 0).sort((a, b) => b.otDays - a.otDays || b.otHours - a.otHours).slice(0, 10)
    .map((e) => ({ empCode: e.empCode, name: e.name, country: e.country, dept: e.dept, otDays: e.otDays, otHours: e.otHours }));
  const topAbsent = inScopeRows.filter((e) => e.absentDays > 0).sort((a, b) => b.absentDays - a.absentDays).slice(0, 10)
    .map((e) => ({ empCode: e.empCode, name: e.name, dept: e.dept, absentDays: e.absentDays }));

  // Missing-hours employee-days (row present but no Total Time) — our stand-in
  // for "incomplete punches" since the totals export has no raw punches.
  const missingHours = [];
  for (const e of inScopeRows) for (const d of e.days) if (d.hours == null) missingHours.push({ empCode: e.empCode, name: e.name, dept: e.dept, date: d.date, weekday: d.weekday, checkIn: d.checkIn || '', checkOut: d.checkOut || '' });

  // PII-FREE bundle for the AI narrative — counts/totals/dept-names only, NO
  // employee names or IDs.
  const aggregates = {
    period: { start: daily.periodStart, end: daily.periodEnd, workDays: daily.workDays.length, offDays: daily.offDays.length },
    totals,
    byCountry,
    scope,
    flags,
    topDepts: byDept.slice(0, 8).map((d) => ({ dept: d.dept, country: d.country, employees: d.employees, otDays: d.otDays, otHours: d.otHours, absences: d.absences })),
    absencesTotal: daily.totalAbsences,
    overnightTotal: daily.totalOvernight,
    missingHoursDays: missingHours.length,
    workRate: (() => {
      const h = inScopeRows.reduce((a, e) => a + (e.totalHours || 0), 0);
      const n = inScopeRows.reduce((a, e) => a + (e.daysWithHours || 0), 0);
      return {
        avgHoursPerDay: n ? +(h / n).toFixed(2) : null,
        shortDaysTotal: inScopeRows.reduce((a, e) => a + e.shortDays, 0),
        longDaysTotal: inScopeRows.reduce((a, e) => a + e.longDays, 0),
        stitchedOvernight: stitchedSessions,
      };
    })(),
  };

  // Schedule summary (present only when a schedule was uploaded).
  const scheduleOut = schedule ? {
    tab: schedule.meta?.tab || null,
    periodStart: schedule.meta?.periodStart || null,
    periodEnd: schedule.meta?.periodEnd || null,
    scheduledEmployees: schedule.meta?.matched ?? schedByEmp.size,
    linkedInRun: inScopeRows.filter((e) => e.hasSchedule).length,
    unmatched: schedule.unmatched || [],
    unmatchedCount: (schedule.unmatched || []).length,
  } : null;

  return {
    attendance: { employees: emp.size, cols },
    masters: mastersMeta,
    scope,
    flags,
    byCountry,
    totals,
    daily,
    byDate,
    byDept,
    topOt,
    topAbsent,
    missingHours,
    aggregates,
    schedule: scheduleOut,
    rows: outRows,
  };
}

// Turn a result into an .xlsx Buffer: a Summary sheet + a per-employee Detail sheet.
export function buildWorkbook(result) {
  const wb = XLSX.utils.book_new();
  const s = result.scope, f = result.flags;
  const summary = [
    ['CALO Time & Attendance — Overtime'],
    ['Overtime rule', 'UAE after 10h · KSA / Kuwait / Bahrain after 9h'],
    [],
    ['Scope', `in-scope: ${s.inScope}`, `excluded (mgr/admin): ${s.excluded}`, `no position: ${s.noPosition}`, `unmatched: ${s.unmatched}`],
    ['Flags', `unknown country: ${f.unknownCountry}`, `name mismatches: ${f.nameMismatches}`, `ambiguous IDs: ${f.ambiguousIds}`],
    [],
    ['Country', 'OT rule', 'Employees', 'Present-days', 'OT-days', 'OT-hours', 'OT-days @ flat 9h'],
    ...result.byCountry.map((g) => [g.country, `> ${g.rule}`, g.emps, g.present, g.otDays, g.otHours, g.otDays9]),
    [],
    ['TOTAL', '', result.totals.employees, '', result.totals.otDays, result.totals.otHours, ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

  const detail = result.rows.map((r) => ({
    'Emp Code': r.empCode, Name: r.name, Country: r.country, Department: r.dept,
    'Dept (Zelt/master)': r.masterDept || '', 'Dept mismatch': r.deptMismatch ? 'yes' : '',
    'Present-days': r.present, 'Total hours': r.totalHours ?? '', 'OT-days': r.otDays, 'OT-hours': r.otHours, 'OT-days @ 9h': r.otDays9,
    'Avg h/day': r.avgHours ?? '', 'Overnight days': r.overnightDays || 0,
    'Short days (<4h)': r.shortDays || 0, 'Long days (>12h)': r.longDays || 0,
    Source: r.source, 'Title (Zelt/master)': r.position, 'In scope': r.inScope ? 'yes' : 'no', 'Name mismatch': r.nameMismatch ? 'yes' : '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Detail');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

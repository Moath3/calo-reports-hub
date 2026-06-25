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
import { loadAttendance, loadMaster, parseMinutes, toYMD, EXCLUDE_POSITION } from './fileLib.js';

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
export function runPeriod({ attendancePath, masters = [], rosterRecords = [], month = null }) {
  // ── Pass 1: per-employee day minutes from the attendance ──────────
  const { rows, cols } = loadAttendance(attendancePath);
  if (!cols.id) {
    const e = new Error('Could not detect an Employee ID column in the attendance file — check for a banner/title row above the header, or that the file has an "Employee ID" / "Emp No" column.');
    e.userError = true;
    throw e;
  }
  const emp = new Map(); // id -> { empCode, name, dept, days: Map<ymd, {date, minutes, checkIn, checkOut}> }
  for (const r of rows) {
    const ymd = toYMD(r[cols.date]);
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
  if (emp.size === 0) {
    const e = new Error(rows.length ? 'No attendance rows matched — check the Date column format (e.g. dd/mm/yyyy) or the month filter.' : 'The attendance file has no data rows.');
    e.userError = true;
    throw e;
  }

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
      scopeBy.set(e.empCode, { position: rec.position || '', source: rec.source || '', entity: rec.entity || null, nameMismatch: mismatch });
    }
  }

  // ── Pass 2: per-country OT per employee ───────────────────────────
  const outRows = [];
  for (const e of emp.values()) {
    const sc = scopeBy.get(e.empCode) || {};
    const country = resolveCountry(e.dept) || resolveCountry(sc.entity) || null;
    const cfg = getOtConfig(country || e.dept);
    const cfgMin = cfg.standardDailyMinutes;
    let otDays = 0, otMin = 0, otDays9 = 0;
    const days = [...e.days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => {
      const ci = parseMinutes(d.checkIn), co = parseMinutes(d.checkOut);
      const overnight = ci != null && co != null && co < ci; // out clock strictly before in -> crossed midnight
      let ot = false, dayOtMin = 0;
      if (d.minutes != null) {
        const c = classifyDay({ workedMinutes: d.minutes, incomplete: false }, { status: 'work', scheduledMinutes: cfgMin }, cfg);
        if ((c.overtime || 0) > 0) { otDays += 1; otMin += c.overtime; ot = true; dayOtMin = c.overtime; }
        if (d.minutes > 540) otDays9 += 1; // illustrative flat-9h comparison
      }
      return { date: d.date, weekday: weekdayOf(d.date), hours: d.minutes != null ? +(d.minutes / 60).toFixed(2) : null, checkIn: d.checkIn || '', checkOut: d.checkOut || '', overnight, ot, otMin: dayOtMin };
    });
    const position = sc.position || '';
    const matched = scopeBy.has(e.empCode);
    const isExcluded = !!position && EXCLUDE_POSITION.test(position);
    const noPosition = matched && !position;
    const inScope = !hasMasters || (matched && !!position && !isExcluded);
    outRows.push({
      empCode: e.empCode, name: e.name, country: country || 'UNKNOWN', dept: e.dept,
      present: e.days.size, otDays, otHours: +(otMin / 60).toFixed(2), otDays9,
      source: sc.source || '', position, matched, noPosition, isExcluded, inScope, nameMismatch: !!sc.nameMismatch,
      daysWorked: e.days.size, overnightDays: days.filter((d) => d.overnight).length,
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
  let daily = { periodStart: null, periodEnd: null, workDays: [], offDays: [], totalAbsences: 0, totalOvernight: 0, inferred: true };
  const inDated = inScopeRows.filter((e) => e.firstSeen);
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
    // Absences for every dated employee; in-scope members are excluded from their
    // own date's ratio so they can't suppress their own absence.
    for (const e of outRows) {
      if (!e.firstSeen) continue;
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
    daily = {
      periodStart, periodEnd,
      workDays: allRange.filter((d) => workDaysSet.has(d)),
      offDays: allRange.filter((d) => !workDaysSet.has(d)),
      totalAbsences: inDated.reduce((a, e) => a + e.absentDays, 0),
      totalOvernight: inScopeRows.reduce((a, e) => a + (e.overnightDays || 0), 0),
      inferred: true,
    };
  }

  const scope = {
    matched: scopeBy.size,
    inScope: inScopeRows.length,
    excluded: outRows.filter((e) => e.isExcluded).length,
    noPosition: outRows.filter((e) => e.noPosition).length,
    unmatched: hasMasters ? outRows.filter((e) => !e.matched).length : 0,
  };
  const flags = {
    ambiguousIds, nameMismatches,
    unknownCountry: inScopeRows.filter((e) => e.country === 'UNKNOWN').length,
    // master(s) supplied but nothing joined -> everyone is unmatched and the
    // totals read as a misleading zero; surface it loudly instead.
    mastersMatchedNone: hasMasters && scopeBy.size === 0,
  };

  // ── Report aggregates (drive the 9-sheet report + the AI narrative) ──
  const workDaySet = new Set(daily.workDays);
  // Per-date roll-up: who's present/absent/on-OT each day.
  const byDateMap = new Map();
  const touchDate = (date, weekday) => { let g = byDateMap.get(date); if (!g) { g = { date, weekday, present: 0, absent: 0, onOt: 0, otHours: 0 }; byDateMap.set(date, g); } return g; };
  for (const e of inScopeRows) {
    for (const d of e.days) { const g = touchDate(d.date, d.weekday); g.present += 1; if (d.ot) { g.onOt += 1; g.otHours += d.otMin / 60; } }
    for (const a of e.absences) { touchDate(a.date, a.weekday).absent += 1; }
  }
  const byDate = [...byDateMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((g) => ({ ...g, otHours: +g.otHours.toFixed(1), isWorkDay: workDaySet.has(g.date) }));

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
  };

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
    'Present-days': r.present, 'OT-days': r.otDays, 'OT-hours': r.otHours, 'OT-days @ 9h': r.otDays9,
    Source: r.source, Position: r.position, 'In scope': r.inScope ? 'yes' : 'no', 'Name mismatch': r.nameMismatch ? 'yes' : '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Detail');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

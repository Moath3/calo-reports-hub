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
 * @param {Array<{label:string,path:string,sheet?:string}>} [opts.masters] - HR masters
 * @param {string|null} [opts.month] - optional 'YYYY-MM' filter on the Date column
 * @returns {object} structured result (see fields below)
 */
export function runPeriod({ attendancePath, masters = [], month = null }) {
  // ── Pass 1: per-employee day minutes from the attendance ──────────
  const { rows, cols } = loadAttendance(attendancePath);
  if (!cols.id) {
    const e = new Error('Could not detect an Employee ID column in the attendance file — check for a banner/title row above the header, or that the file has an "Employee ID" / "Emp No" column.');
    e.userError = true;
    throw e;
  }
  const emp = new Map(); // id -> { empCode, name, dept, present, mins[], days: Map<date,...> }
  for (const r of rows) {
    const ymd = toYMD(r[cols.date]);
    if (month && !ymd.startsWith(month)) continue;
    const id = String(r[cols.id] ?? '').trim();
    if (!id) continue;
    const dept = cols.dept ? String(r[cols.dept] ?? '').trim() : '';
    if (!emp.has(id)) emp.set(id, { empCode: id, name: cols.name ? String(r[cols.name] ?? '').trim() : '', dept, present: 0, mins: [], days: new Map() });
    const e = emp.get(id);
    e.present += 1;
    if (!e.dept && dept) e.dept = dept;
    const min = parseMinutes(r[cols.time]);
    if (min != null) e.mins.push(min);
    // Per-day calendar record. A shift whose check-out clock time is at/before
    // its check-in crossed midnight (overnight); Total Time already accounts for
    // it, and we attribute the day to the check-in date (the export's Date).
    const checkIn = cols.checkIn ? String(r[cols.checkIn] ?? '').trim() : '';
    const checkOut = cols.checkOut ? String(r[cols.checkOut] ?? '').trim() : '';
    const ci = parseMinutes(checkIn), co = parseMinutes(checkOut);
    const overnight = ci != null && co != null && co <= ci;
    if (ymd) e.days.set(ymd, { date: ymd, minutes: min, checkIn, checkOut, overnight });
  }

  // ── Masters (optional): collision-safe direct ID join ─────────────
  const scopeBy = new Map(); // empCode -> { position, source, entity, nameMismatch }
  const mastersMeta = [];
  let ambiguousIds = 0, nameMismatches = 0;
  if (masters.length) {
    const attIdSet = new Set([...emp.keys()].map(normalizeId));
    const combined = masters.flatMap((m) => {
      const { records, meta } = loadMaster(m, attIdSet);
      mastersMeta.push({ label: m.label, ...meta });
      return records;
    });
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
  const hasMasters = masters.length > 0;

  // ── Pass 2: per-country OT per employee ───────────────────────────
  const outRows = [];
  for (const e of emp.values()) {
    const sc = scopeBy.get(e.empCode) || {};
    const country = resolveCountry(e.dept) || resolveCountry(sc.entity) || null;
    const cfg = getOtConfig(country || e.dept);
    let otDays = 0, otMin = 0, otDays9 = 0;
    for (const min of e.mins) {
      const c = classifyDay({ workedMinutes: min, incomplete: false }, { status: 'work', scheduledMinutes: cfg.standardDailyMinutes }, cfg);
      if ((c.overtime || 0) > 0) { otDays += 1; otMin += c.overtime; }
      if (min > 540) otDays9 += 1; // illustrative flat-9h comparison
    }
    const position = sc.position || '';
    const matched = scopeBy.has(e.empCode);
    const isExcluded = !!position && EXCLUDE_POSITION.test(position);
    const noPosition = matched && !position;
    const inScope = !hasMasters || (matched && !!position && !isExcluded);
    const cfgMin = cfg.standardDailyMinutes;
    const days = [...e.days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({
      date: d.date, weekday: weekdayOf(d.date),
      hours: d.minutes != null ? +(d.minutes / 60).toFixed(2) : null,
      checkIn: d.checkIn || '', checkOut: d.checkOut || '', overnight: d.overnight,
      ot: d.minutes != null && d.minutes > cfgMin,
    }));
    outRows.push({
      empCode: e.empCode, name: e.name, country: country || 'UNKNOWN', dept: e.dept,
      present: e.present, otDays, otHours: +(otMin / 60).toFixed(2), otDays9,
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
  let daily = { periodStart: null, periodEnd: null, workDays: [], offDays: [], totalAbsences: 0, totalOvernight: 0, inferred: true };
  const dated = inScopeRows.filter((e) => e.firstSeen);
  if (dated.length) {
    const periodStart = dated.reduce((m, e) => (e.firstSeen < m ? e.firstSeen : m), dated[0].firstSeen);
    const periodEnd = dated.reduce((m, e) => (e.lastSeen > m ? e.lastSeen : m), dated[0].lastSeen);
    const present = Object.create(null), active = Object.create(null);
    const spans = dated.map((e) => ({ e, set: new Set(e.days.map((d) => d.date)), span: eachDate(e.firstSeen, e.lastSeen) }));
    for (const { set, span } of spans) {
      for (const d of span) { active[d] = (active[d] || 0) + 1; if (set.has(d)) present[d] = (present[d] || 0) + 1; }
    }
    const workDaysSet = new Set();
    for (const d of eachDate(periodStart, periodEnd)) {
      const a = active[d] || 0, p = present[d] || 0;
      if (a > 0 && p / a >= WORKDAY_THRESHOLD) workDaysSet.add(d);
    }
    for (const { e, set, span } of spans) {
      e.absences = span.filter((d) => workDaysSet.has(d) && !set.has(d)).map((d) => ({ date: d, weekday: weekdayOf(d) }));
      e.absentDays = e.absences.length;
    }
    const allRange = eachDate(periodStart, periodEnd);
    daily = {
      periodStart, periodEnd,
      workDays: allRange.filter((d) => workDaysSet.has(d)),
      offDays: allRange.filter((d) => !workDaysSet.has(d)),
      totalAbsences: dated.reduce((a, e) => a + e.absentDays, 0),
      totalOvernight: inScopeRows.reduce((a, e) => a + (e.overnightDays || 0), 0),
      inferred: true,
    };
  }

  return {
    attendance: { employees: emp.size, cols },
    masters: mastersMeta,
    scope: {
      matched: scopeBy.size,
      inScope: inScopeRows.length,
      excluded: outRows.filter((e) => e.isExcluded).length,
      noPosition: outRows.filter((e) => e.noPosition).length,
      unmatched: hasMasters ? outRows.filter((e) => !e.matched).length : 0,
    },
    flags: {
      ambiguousIds, nameMismatches,
      unknownCountry: inScopeRows.filter((e) => e.country === 'UNKNOWN').length,
      // master(s) supplied but nothing joined -> everyone is unmatched and the
      // totals read as a misleading zero; surface it loudly instead.
      mastersMatchedNone: hasMasters && scopeBy.size === 0,
    },
    byCountry,
    totals,
    daily,
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

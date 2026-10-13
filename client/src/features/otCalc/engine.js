// Attendance & OT engine — a faithful client-side port of the standalone
// "Attendance & OT Calculator" (vanilla-JS artifact), adapted to pure functions
// (settings `S` passed in, no globals). All time math is UTC-second based on
// purpose, to avoid DST drift — do not swap to local Date.
//
// Pipeline: rows + column map -> punch records (ts/state) -> per-employee dedup
// -> cluster into shifts -> evalShift (span/break/OT) -> daily rows + exceptions
// -> buildView aggregates per-employee summary + salary-based OT amount.

export const DEFAULTS = {
  std: 8, fmt: 'hhmm', otRound: 'none', minOT: 0, breakMin: 60, breakFrom: 5,
  gap: 4, win: 18, maxShift: 14, minSpan: 30, lenient: 'strict', dateOrder: 'DMY',
  showNoTx: false, rateBasis: '30', rateHours: 8, otMult: 1.25, cycleStart: 1,
  dupWin: 15, schedTol: 4, buffer: 10,
};

export function mergeSettings(partial) { return { ...DEFAULTS, ...(partial || {}) }; }

// ---- small helpers ----
const pad = (n) => String(n).padStart(2, '0');
export const isBlank = (v) => v == null || String(v).trim() === '';
export function num(v) {
  if (isBlank(v)) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function validYMD(y, m, d) {
  if (y < 100) y += 2000;
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCDate() !== d) return null;
  return { y, m, d };
}
function serialParts(n) {
  const t = new Date(Math.round((n - 25569) * 86400) * 1000);
  return { date: { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }, sec: t.getUTCHours() * 3600 + t.getUTCMinutes() * 60 + t.getUTCSeconds() };
}
export function tsDate(ts) { const d = new Date(ts * 1000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
export function tsTime(ts) { const d = new Date(ts * 1000); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }

// Parse a date and/or time value from a cell. Returns {date,sec,badDate,badTime}.
export function parseDT(v, isTime, dateOrder = 'DMY') {
  if (isBlank(v)) return {};
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return { badDate: 1, badTime: 1 };
    if (v < 1) return { sec: Math.round(v * 86400) % 86400 };
    const p = serialParts(v); const frac = Math.abs(v - Math.floor(v)) > 1e-7;
    if (p.date.y < 1990 || p.date.y > 2100) return { badDate: 1, badTime: 1 };
    return { date: p.date, sec: (frac || isTime) ? p.sec : null };
  }
  const s = String(v).trim(); let date = null, rest = s, m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?=[T\s]|$)/))) { date = validYMD(+m[1], +m[2], +m[3]); rest = s.slice(m[0].length); }
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?=[T\s]|$)/))) {
    const a = +m[1], b = +m[2]; let d, mo;
    if (a > 12) { d = a; mo = b; } else if (b > 12) { d = b; mo = a; } else if (dateOrder === 'MDY') { mo = a; d = b; } else { d = a; mo = b; }
    date = validYMD(+m[3], mo, d); rest = s.slice(m[0].length);
  } else if ((m = s.match(/^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]+(\d{2,4})(?=[T\s]|$)/))) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 3)]; date = mo ? validYMD(+m[3], mo, +m[1]) : null; rest = s.slice(m[0].length);
  } else if ((m = s.match(/^(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})(?=[T\s]|$)/))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)]; date = mo ? validYMD(+m[3], mo, +m[2]) : null; rest = s.slice(m[0].length);
  }
  // time portion from the remainder (or the whole string if time-only)
  let sec = null; const tsrc = (date ? rest : s).trim().replace(/^[tT]/, '');
  const tm = tsrc.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP][mM])?/);
  if (tm) {
    let h = +tm[1]; const mi = +tm[2]; const se = tm[3] ? +tm[3] : 0; const ap = (tm[4] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    if (h >= 0 && h < 24 && mi >= 0 && mi < 60) sec = h * 3600 + mi * 60 + se;
  }
  if (!date && sec == null) return isTime ? { badTime: 1 } : { badDate: 1 };
  return { date: date || undefined, sec: (isTime || sec != null) ? sec : null };
}

export function normState(v) {
  if (isBlank(v)) return 'UNK';
  const s = String(v).trim().toLowerCase();
  if (/break|lunch|rest/.test(s)) return 'BRK';
  if (s === '0' || s === '4' || s === 'i') return 'IN';
  if (s === '1' || s === '5' || s === 'o') return 'OUT';
  if (s === '2' || s === '3') return 'BRK';
  if (/out|exit|leave|departure/.test(s)) return 'OUT';
  if (/in\b|^in|entry|enter|arrival/.test(s)) return 'IN';
  return 'UNK';
}

// ---- column detection ----
export const ROLES = [
  { k: 'id', l: 'Employee ID', req: 1 }, { k: 'name', l: 'Employee name (or first name)' }, { k: 'lname', l: 'Last name (optional)' },
  { k: 'dept', l: 'Department' }, { k: 'loc', l: 'Location / site' }, { k: 'date', l: 'Date', req: 1 }, { k: 'time', l: 'Time', req: 1 }, { k: 'state', l: 'Punch type (IN/OUT)' },
];
export const nh = (h) => String(h == null ? '' : h).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
export const TESTS = {
  id: (h) => /^(emp|employee|staff|person|personnel|badge|user|payroll|ac|worker|member)\.?\s*(id|code|no|no\.|number|#)$/.test(h) || /^(id|code|emp id|empid|empcode|emp code|employee code|employee number|staff number|ac no|ac\.no\.?|person id|user id|badge number|employee no)$/.test(h),
  fname: (h) => /^first\s*name$|^given\s*name$/.test(h),
  lname: (h) => /^(last|sur|family)\s*name$|^surname$/.test(h),
  name: (h) => /name/.test(h) && !/dep|dept|device|terminal|location|company|branch|area|site|first|last|sur|family|user\s*name|shift|job|position|title|nationality/.test(h),
  dept: (h) => /dep(t|artment)|division|section|business unit|cost cent/.test(h),
  loc: (h) => /location|site|branch|area|terminal|device\s*(name|alias)|door|reader|zone|store|kitchen name/.test(h) && !/source/.test(h),
  datetime: (h) => /(date.*time|time.*date|timestamp)/.test(h),
  date: (h) => /date|^day$/.test(h) && !/update|time|birth|join|hire|end/.test(h),
  time: (h) => /time|punch|clock/.test(h) && !/date|overtime|lifetime|runtime/.test(h),
  state: (h) => /punch\s*state|punch\s*type|check\s*type|in\s*\/?\s*out|direction|event|record\s*type|^type$|^status$|^state$/.test(h),
};
export const MTESTS = {
  basic: (h) => /^basic(\s*(salary|pay|wage))?(\s*\(aed\))?$/.test(h),
  gross: (h) => /gross/.test(h),
  status: (h) => /^(employee\s*|employment\s*)?status$/.test(h),
  desig: (h) => /designation|job\s*title|position/.test(h),
  hire: (h) => /hire\s*date|joining\s*date|date\s*of\s*join|^doj$/.test(h),
  lwd: (h) => /last\s*working|termination|exit\s*date|resignation\s*date/.test(h),
};
export function scoreHeader(row) {
  if (!row) return 0; let s = 0; const seen = {};
  row.forEach((c) => { const h = nh(c); if (!h) return; for (const k in TESTS) { if (!seen[k] && TESTS[k](h)) { seen[k] = 1; s++; break; } } });
  return s;
}
export function detectMap(headers) {
  const H = headers.map(nh), taken = new Set(), map = { id: -1, name: -1, lname: -1, dept: -1, loc: -1, date: -1, time: -1, state: -1 };
  const pick = (fn) => { for (let i = 0; i < H.length; i++) { if (!taken.has(i) && H[i] && fn(H[i])) { taken.add(i); return i; } } return -1; };
  map.id = pick(TESTS.id);
  const fn = pick(TESTS.fname);
  if (fn >= 0) { map.name = fn; map.lname = pick(TESTS.lname); } else map.name = pick(TESTS.name);
  map.dept = pick(TESTS.dept); map.loc = pick(TESTS.loc); map.state = pick(TESTS.state);
  const dt = H.findIndex((h, i) => !taken.has(i) && TESTS.datetime(h));
  map.date = pick(TESTS.date); map.time = pick(TESTS.time);
  if (dt >= 0) { if (map.date < 0) map.date = dt; if (map.time < 0) map.time = dt; taken.add(dt); }
  if (map.id < 0) map.id = pick((h) => /\bid\b|code|no\.?$/.test(h));
  return map;
}

// ---- OT math ----
export function roundOT(m, S) {
  if (m <= 0) return 0;
  if (S.otRound === 'd15') m = Math.floor(m / 15) * 15;
  else if (S.otRound === 'd30') m = Math.floor(m / 30) * 30;
  else if (S.otRound === 'n15') m = Math.round(m / 15) * 15;
  if (m < (+S.minOT || 0)) m = 0;
  return m;
}
export function hourly(b, S) { if (!(b > 0)) return null; const h = +S.rateHours || 8; return S.rateBasis === '365' ? b * 12 / 365 / h : b / 30 / h; }
export function otAmt(min, b, S, dec) { const h = hourly(b, S); if (h == null) return null; const f = Math.pow(10, dec); return Math.round((min || 0) / 60 * h * (+S.otMult || 1.25) * f) / f; }

function mkRow(e, date, o) {
  return Object.assign({
    id: e.id, name: e.name || '(no name)', dept: e.dept || '', loc: e.loc || '', date, month: date.slice(0, 7),
    inTs: null, outTs: null, span: null, brk: null, buf: null, normal: null, actual: null, std: null, ot: null,
    status: '', flags: [], notes: '', punches: [], issue: null, issueDetail: '',
  }, o);
}

function evalShift(e, ps, hasState, stdMin, minTs, maxTs, S) {
  let first = null, last = null;
  if (!hasState) { first = ps[0]; last = ps.length > 1 ? ps[ps.length - 1] : null; }
  else { for (const p of ps) { if (p.state === 'IN') { first = p; break; } } for (let i = ps.length - 1; i >= 0; i--) { if (ps[i].state === 'OUT') { last = ps[i]; break; } } }
  let issue = null;
  if (!(first && last && last.ts > first.ts)) {
    if (!first && !last) issue = ps.some((p) => p.state === 'UNK') ? 'Unrecognised punch type' : 'Missing IN';
    else if (!first) issue = 'Missing IN'; else if (!last) issue = 'Missing OUT'; else issue = 'OUT before IN';
  }
  const flags = []; let corrected = null;
  const spanAll = ps[ps.length - 1].ts - ps[0].ts;
  if (issue && S.lenient === 'lenient' && ps.length >= 2 && spanAll >= Math.max(S.minSpan, 1) * 60) { corrected = issue; issue = null; first = ps[0]; last = ps[ps.length - 1]; }
  const anchor = first || ps[0];
  const row = mkRow(e, anchor.dateKey, { punches: ps, firstTs: ps[0].ts });
  ps.forEach((p) => { p.use = p.state === 'BRK' ? 'Break punch (not used in span)' : p.state === 'UNK' ? 'Unrecognised punch type' : 'Intermediate punch'; });
  if (issue) {
    row.status = issue === 'Missing IN' ? 'Missing IN' : issue === 'Missing OUT' ? 'Missing OUT' : 'Invalid';
    row.issue = issue;
    if (first) { row.inTs = first.ts; first.use = 'First IN'; }
    if (last) { row.outTs = last.ts; last.use = 'Last OUT'; }
    const types = ps.map((p) => tsTime(p.ts) + ' ' + (p.state === 'ANY' ? 'punch' : p.state)).join(', ');
    let d = issue === 'Missing IN' ? 'Check OUT found without a Check IN' : issue === 'Missing OUT' ? 'Check IN found without a Check OUT' : issue === 'OUT before IN' ? 'The Check OUT is earlier than the Check IN. Likely the wrong button was pressed' : 'Punch type could not be read';
    d += ' · Punches: ' + types;
    if (issue === 'Missing IN' && ps[ps.length - 1].ts - minTs < S.win * 3600) d += ' · May have started before the report period';
    if (issue === 'Missing OUT' && maxTs - ps[0].ts < S.win * 3600) d += ' · May still be in progress at report cut-off';
    row.issueDetail = d; row.std = stdMin;
  } else {
    first.use = corrected ? 'Start (punch type corrected)' : 'First IN'; last.use = corrected ? 'End (punch type corrected)' : 'Last OUT';
    row.inTs = first.ts; row.outTs = last.ts;
    const span = Math.floor((last.ts - first.ts) / 60);
    const brk = span >= (+S.breakFrom || 0) * 60 ? (+S.breakMin || 0) : 0;
    const act = Math.max(0, span - brk);
    row.span = span; row.brk = brk; row.actual = act; row.std = stdMin;
    row.normal = Math.min(act, stdMin);
    row.buf = Math.min(Math.max(0, act - stdMin), Math.max(0, +S.buffer || 0));
    row.ot = roundOT(act - stdMin - row.buf, S);
    row.status = row.ot > 0 ? 'OT' : act >= stdMin ? 'Normal' : 'Below Standard';
    row.overnight = row.outTs != null && tsDate(row.outTs) !== row.date;
    if (corrected) flags.push({ sev: 'action', type: 'Punch type corrected', detail: corrected + ' in the original punches. Hours use first and last punch (' + tsTime(first.ts) + ' to ' + tsTime(last.ts) + '). Please confirm.' });
    if (span > S.maxShift * 60) flags.push({ sev: 'action', type: 'Long shift', detail: 'Span of ' + Math.floor(span / 60) + 'h' + (span % 60) + 'm is over ' + S.maxShift + ' h. Check for a missed OUT and IN.' });
    if (span < S.minSpan) flags.push({ sev: 'action', type: 'Very short span', detail: 'Only ' + span + ' min between IN and OUT. Possibly accidental punches.' });
  }
  if (ps.length > 2) flags.push({ sev: 'info', type: 'Multiple punches', detail: ps.length + ' punches in this shift.' });
  row.flags = flags;
  return row;
}

// Build the salary master directory from parsed sheets ([{sn, rows}]).
export function buildMaster(sheets, companyTab, dateOrder = 'DMY', fileName = 'master') {
  const want = companyTab;
  if (want) { const only = sheets.filter((sh) => nh(sh.sn) === nh(want)); if (only.length) sheets = only; }
  const list = [], byId = {}, used = [];
  sheets.forEach((sh) => {
    let hi = -1, bs = 0;
    for (let i = 0; i < Math.min(sh.rows.length, 25); i++) { const row = sh.rows[i] || []; const sc = scoreHeader(row) + (row.some((c) => MTESTS.basic(nh(c))) ? 2 : 0); if (sc > bs) { bs = sc; hi = i; } }
    if (hi < 0) return;
    const H = (sh.rows[hi] || []).map(nh); const m = detectMap(sh.rows[hi]);
    const f = (t) => H.findIndex((h) => h && MTESTS[t](h));
    const c = { basic: f('basic'), gross: f('gross'), status: f('status'), desig: f('desig'), hire: f('hire'), lwd: f('lwd') };
    if (m.id < 0 || c.basic < 0) return; used.push(sh.sn);
    const val = (r, i) => i >= 0 && !isBlank(r[i]) ? String(r[i]).trim() : '';
    const dk = (v) => { const d = parseDT(v, false, dateOrder).date; return d ? d.y + '-' + pad(d.m) + '-' + pad(d.d) : ''; };
    for (let k = hi + 1; k < sh.rows.length; k++) {
      const r = sh.rows[k]; if (!r) continue;
      const id = val(r, m.id); if (!id || !/\d/.test(id) || /\s/.test(id)) continue;
      let nm = val(r, m.name); if (m.lname >= 0 && val(r, m.lname)) nm = (nm + ' ' + val(r, m.lname)).trim();
      const status = val(r, c.status);
      const e = {
        id, name: nm, dept: val(r, m.dept), desig: val(r, c.desig), status: status || '—',
        active: !/inactive|resign|terminat|abscond|left|exit|cancel/i.test(status),
        basic: c.basic >= 0 ? num(r[c.basic]) : null, gross: c.gross >= 0 ? num(r[c.gross]) : null,
        hire: c.hire >= 0 ? dk(r[c.hire]) : '', lwd: c.lwd >= 0 ? dk(r[c.lwd]) : '', sheet: sh.sn,
      };
      list.push(e);
      const o = byId[id];
      if (!o) byId[id] = e;
      else {
        const score = (x) => (x.active ? 2 : 0) + (x.basic > 0 ? 1 : 0);
        const keep = score(e) > score(o) ? e : o;
        if (o.active && e.active && o.basic > 0 && e.basic > 0 && o.basic !== e.basic) keep.conflict = 'Listed more than once as active with different basic salaries (' + o.basic + ' in ' + o.sheet + ', ' + e.basic + ' in ' + e.sheet + '). Using ' + keep.basic + '.';
        byId[id] = keep;
      }
    }
  });
  return used.length ? { file: fileName, list: Object.values(byId), byId, sheets: used, rows: list.length } : null;
}

// Core compute: rows + map (+ optional master) -> processed data D.
export function compute({ rows, hdrIdx = 0, rowOffset = 0, map, master = null, settings }) {
  const S = settings; const hasState = map.state >= 0;
  const recs = [], invalid = [];
  const g = (r, k) => (map[k] >= 0 ? r[map[k]] : null);
  for (let k = hdrIdx + 1; k < rows.length; k++) {
    const r = rows[k];
    if (!r || r.every(isBlank)) continue;
    const rowNo = k + 1 + rowOffset;
    const id = isBlank(g(r, 'id')) ? '' : String(g(r, 'id')).trim();
    let name = isBlank(g(r, 'name')) ? '' : String(g(r, 'name')).trim();
    if (map.lname >= 0 && !isBlank(g(r, 'lname'))) name = (name + ' ' + String(g(r, 'lname')).trim()).trim();
    const dept = isBlank(g(r, 'dept')) ? '' : String(g(r, 'dept')).trim();
    const loc = isBlank(g(r, 'loc')) ? '' : String(g(r, 'loc')).trim();
    const dv = g(r, 'date'), tv = g(r, 'time');
    const dp = parseDT(dv, false, S.dateOrder), tp = (map.time === map.date) ? dp : parseDT(tv, true, S.dateOrder);
    const date = dp.date || tp.date; const sec = tp.sec != null ? tp.sec : dp.sec;
    const rec = { rowNo, raw: r, id, name, dept, loc, state: hasState ? normState(g(r, 'state')) : 'ANY', use: '', ts: null, dateKey: '' };
    if (!id) rec.bad = 'Blank employee ID';
    else if (!date) rec.bad = (isBlank(dv) && isBlank(tv)) ? 'Blank date' : 'Invalid date';
    else if (sec == null) rec.bad = isBlank(tv) ? 'Blank time' : 'Invalid time';
    if (!rec.bad) { rec.ts = Date.UTC(date.y, date.m - 1, date.d) / 1000 + sec; rec.dateKey = tsDate(rec.ts); }
    if (rec.bad) { rec.use = 'Excluded: ' + rec.bad; invalid.push(rec); }
    recs.push(rec);
  }

  // employee directory
  const emp = {};
  recs.forEach((r) => { if (r.bad) return; if (!emp[r.id]) emp[r.id] = { id: r.id, name: r.name, dept: r.dept, loc: r.loc, inReport: true, m: master ? master.byId[r.id] : undefined }; });

  // group by employee
  const byEmp = new Map();
  let minTs = Infinity, maxTs = -Infinity;
  recs.forEach((r) => { if (r.bad) return; if (!byEmp.has(r.id)) byEmp.set(r.id, []); byEmp.get(r.id).push(r); if (r.ts < minTs) minTs = r.ts; if (r.ts > maxTs) maxTs = r.ts; });

  const ORD = { IN: 0, ANY: 1, BRK: 2, UNK: 3, OUT: 4 };
  const daily = []; let dupCount = 0;
  const stdMin = S.std * 60, gapSec = S.gap * 3600, winSec = S.win * 3600;
  byEmp.forEach((list, id) => {
    list.sort((a, b) => a.ts - b.ts || ORD[a.state] - ORD[b.state] || a.rowNo - b.rowNo);
    const kept = []; const dupWin = Math.max(0, +S.dupWin || 0) * 60;
    list.forEach((r) => {
      const p = kept[kept.length - 1];
      if (p && p.state === r.state && (Math.floor(p.ts / 60) === Math.floor(r.ts / 60) || r.ts - p.ts <= dupWin)) {
        dupCount++;
        if (r.state === 'OUT' && r.ts > p.ts) { p.use = 'Duplicate – removed'; p.removed = 1; kept[kept.length - 1] = r; }
        else { r.use = 'Duplicate – removed'; r.removed = 1; }
      } else kept.push(r);
    });
    // cluster kept punches into shifts
    const clusters = []; let cur = null;
    kept.forEach((r) => {
      let nw = !cur;
      if (cur) {
        const last = cur[cur.length - 1], gapLast = r.ts - last.ts, fromStart = r.ts - cur[0].ts;
        if (fromStart > winSec) nw = true;
        else if (r.state === 'OUT') { if (last.state === 'OUT' && gapLast > gapSec) nw = true; }
        else if (r.state === 'ANY') { if (!(cur.length % 2 === 1) && gapLast > gapSec) nw = true; }
        else if (gapLast > gapSec) nw = true;
      }
      if (nw) { cur = []; clusters.push(cur); }
      cur.push(r);
    });
    clusters.forEach((ps) => daily.push(evalShift(emp[id], ps, hasState, stdMin, minTs, maxTs, S)));
  });

  // period + date list
  const period = { min: Number.isFinite(minTs) ? tsDate(minTs) : '', max: Number.isFinite(maxTs) ? tsDate(maxTs) : '' };
  const dates = [];
  if (period.min) { let t = Date.parse(period.min + 'T00:00:00Z'); const end = Date.parse(period.max + 'T00:00:00Z'); while (t <= end) { dates.push(new Date(t).toISOString().slice(0, 10)); t += 86400000; } }

  // master-only employees (active, in-range, not punching)
  const exc = [];
  const addExc = (sev, type, e, date, detail, opts = {}) => exc.push({ sev, type, id: e.id, name: e.name, dept: e.dept, date: date || '', detail, nodate: !!opts.nodate });
  const repSheets = new Set();
  if (master) Object.values(emp).forEach((e) => { if (e.m) repSheets.add(e.m.sheet); });
  if (master && period.min) master.list.forEach((mrow) => {
    if (emp[mrow.id] || !mrow.active || !repSheets.has(mrow.sheet)) return;
    if (mrow.hire && mrow.hire > period.max) return; if (mrow.lwd && mrow.lwd < period.min) return;
    emp[mrow.id] = { id: mrow.id, name: mrow.name, dept: mrow.dept, loc: '', inReport: false, m: mrow };
  });
  if (master) Object.values(emp).forEach((e) => {
    if (!e.inReport) return;
    if (!e.m) addExc('action', 'Not in salary master', e, '', 'Employee ID not found in the master. Treated as not OT-eligible until added.', { nodate: 1 });
    else {
      if (!(e.m.basic > 0)) addExc('info', 'Not OT-eligible (no basic salary)', e, '', 'No basic salary in the master (' + e.m.sheet + '), so no OT is paid.', { nodate: 1 });
      if (e.m.conflict) addExc('action', 'Duplicate in salary master', e, '', e.m.conflict, { nodate: 1 });
      if (!e.m.active) addExc('action', 'Inactive in master but punching', e, '', 'Master status is "' + e.m.status + '" but the employee has punches.', { nodate: 1 });
    }
  });

  // per-shift issues/flags -> exceptions
  daily.forEach((d) => {
    if (d.issue) exc.push({ sev: d.issue === 'Missing IN' || d.issue === 'Missing OUT' ? 'action' : 'action', type: d.issue, id: d.id, name: d.name, dept: d.dept, date: d.date, detail: d.issueDetail });
    (d.flags || []).forEach((f) => exc.push({ sev: f.sev, type: f.type, id: d.id, name: d.name, dept: d.dept, date: d.date, detail: f.detail }));
  });

  // no-transaction days (employees in report with 0 punches on a date in range) — only when requested
  const started = {}; daily.forEach((d) => { started[d.id + '|' + d.date] = 1; });

  return { recs, invalid, daily, exc, emp, period, dates, dupCount, minTs: Number.isFinite(minTs) ? minTs : null, maxTs: Number.isFinite(maxTs) ? maxTs : null };
}

// ---- eligibility / allowances ----
export const PAYF = { p75: 0.75, half: 0.5, p25: 0.25, none: 0 };
export const PAYOPT = [['full', 'Full OT allowance (100%)'], ['p75', '75% OT allowance'], ['half', '50% OT allowance'], ['p25', '25% OT allowance'], ['none', 'No OT allowance']];
export const EXCL_REASONS = ['Managerial role', 'Disciplinary action', 'Other'];
export function exOf(excl, id) { const x = excl[id]; if (!x) return null; return typeof x === 'string' ? { pay: 'none', reason: x } : x; }
export function eligBasic(master, id) { if (!master) return true; const m = master.byId[id]; return !!(m && m.basic > 0); }
export function payFactor(id, { master, excl }) {
  if (!master) return 1;
  if (!eligBasic(master, id)) return 0;
  const x = exOf(excl, id); if (!x) return 1;
  if (x.noElig) return 0;
  if (!x.pay || x.pay === 'full') return 1;
  return PAYF[x.pay] != null ? PAYF[x.pay] : 0;
}

// Aggregate daily rows into a per-employee summary + apply salary/eligibility.
export function buildView(D, { settings, master, excl = {}, special = {}, dec = 2 }) {
  const S = settings; if (!D) return { summary: [], kpis: {} };
  const byEmp = new Map();
  const ensure = (e) => { if (!byEmp.has(e.id)) byEmp.set(e.id, { id: e.id, name: e.name, dept: e.dept, loc: e.loc, days: 0, otDays: 0, span: 0, brk: 0, normal: 0, ot: 0, missIn: 0, missOut: 0, invalid: 0, exc: 0 }); return byEmp.get(e.id); };
  // seed from employee directory so master-only / no-tx employees appear
  Object.values(D.emp).forEach((e) => ensure(e));
  D.daily.forEach((d) => {
    const s = ensure(d);
    if (d.issue) { if (d.issue === 'Missing IN') s.missIn++; else if (d.issue === 'Missing OUT') s.missOut++; else s.invalid++; return; }
    s.days++; if (d.ot > 0) s.otDays++;
    s.span += d.span || 0; s.brk += d.brk || 0; s.normal += d.normal || 0; s.ot += d.ot || 0;
  });
  D.exc.forEach((x) => { const s = byEmp.get(x.id); if (s) s.exc++; });

  const summary = [];
  byEmp.forEach((s) => {
    const m = master ? master.byId[s.id] : null;
    const basic = m ? m.basic : null;
    const rate = basic != null ? hourly(basic, S) : null;
    const factor = payFactor(s.id, { master, excl });
    const amount = (master && rate != null) ? (otAmt(s.ot, basic, S, dec) || 0) * factor : null;
    const sp = +special[s.id] || 0;
    summary.push({
      ...s, desig: m ? m.desig : '', status: m ? m.status : '', basic, rate,
      otRate: rate != null ? rate * (+S.otMult || 1.25) : null,
      eligible: factor > 0, factor, special: sp,
      amount: amount != null ? Math.round(amount * Math.pow(10, dec)) / Math.pow(10, dec) : null,
      total: amount != null ? Math.round((amount + sp) * Math.pow(10, dec)) / Math.pow(10, dec) : (sp || null),
    });
  });
  summary.sort((a, b) => b.ot - a.ot || (a.name || '').localeCompare(b.name || ''));

  // KPIs
  const emps = summary.length;
  const totHours = summary.reduce((t, s) => t + s.span, 0);
  const normalH = summary.reduce((t, s) => t + s.normal, 0);
  const otH = summary.reduce((t, s) => t + s.ot, 0);
  const payOtH = summary.reduce((t, s) => t + s.ot * (s.factor || 0), 0);
  const otEmps = summary.filter((s) => s.ot > 0).length;
  const totalAmount = master ? summary.reduce((t, s) => t + (s.amount || 0), 0) : null;
  const totalPayable = master ? summary.reduce((t, s) => t + (s.total || 0), 0) : null;
  const missIn = summary.reduce((t, s) => t + s.missIn, 0);
  const missOut = summary.reduce((t, s) => t + s.missOut, 0);
  const attendanceDays = summary.reduce((t, s) => t + s.days, 0);
  const kpis = { emps, attendanceDays, totHours, normalH, otH, payOtH, otEmps, missIn, missOut, exceptions: D.exc.length, totalAmount, totalPayable, dupCount: D.dupCount };

  // department rollup
  const byDept = new Map();
  summary.forEach((s) => { const k = s.dept || '(none)'; if (!byDept.has(k)) byDept.set(k, { dept: k, emps: 0, otEmps: 0, ot: 0, payOt: 0, amount: 0 }); const d = byDept.get(k); d.emps++; if (s.ot > 0) d.otEmps++; d.ot += s.ot; d.payOt += s.ot * (s.factor || 0); d.amount += s.amount || 0; });

  return { summary, kpis, byDept: [...byDept.values()].sort((a, b) => b.ot - a.ot) };
}

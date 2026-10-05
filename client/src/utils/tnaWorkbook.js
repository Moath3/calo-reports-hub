// CALO-branded Time & Attendance workbook (exceljs). Pure builder: takes the
// ExcelJS module (injected so it works in the Vite client AND in Node tooling),
// the run result (incl. narrative), and options, and returns a populated
// Workbook. No I/O here — callers write the buffer.
//
// Streamlined to what HR Ops actually needs:
//   1 Summary      — KPIs, exec summary, per-country/dept OT, per-employee totals
//   2 Daily Log    — attendance by day: check-in/out, hours, OT, overnight 🌙,
//                    >16h flag, and (when a schedule is uploaded) Scheduled +
//                    Variance
//   3 Flags        — everything to chase: overnight, >16h, incomplete punches,
//                    absences, identity/dept anomalies
//   +  Schedule — Unmatched (only when a schedule was uploaded and some names
//                 couldn't be linked to Zelt)

const GREEN = 'FF02B376', LIGHT = 'FFE7F7F0', ZEBRA = 'FFF4FBF8', INK = 'FF1A2B23', MUTE = 'FF6B7B74', WHITE = 'FFFFFFFF', AMBER = 'FF9A6F0E';
const F = (size, opts = {}) => ({ name: 'Calibri', size, color: { argb: INK }, ...opts });
const thin = { style: 'thin', color: { argb: 'FFD9E2DD' } };
const box = { top: thin, bottom: thin, left: thin, right: thin };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const headCell = (c) => { c.fill = fill(GREEN); c.font = F(11, { bold: true, color: { argb: WHITE } }); c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = box; };
const colLetter = (n) => String.fromCharCode(64 + n);

// Write a bordered/zebra table starting at row `top`. cols: [{header,align}].
// `rows` is an array of cell-value arrays. Returns the next free row (+1 gap).
function writeTable(ws, top, cols, rows) {
  const hr = ws.getRow(top);
  cols.forEach((c, i) => { const cell = hr.getCell(i + 1); cell.value = c.header; headCell(cell); });
  rows.forEach((cells, ri) => {
    const row = ws.getRow(top + 1 + ri);
    cells.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.border = box; cell.font = F(10);
      cell.alignment = { horizontal: cols[i]?.align || 'left', vertical: 'middle' };
      if (ri % 2) cell.fill = fill(ZEBRA);
    });
  });
  return top + 1 + rows.length + 1;
}

// A full-sheet table (frozen header + autofilter + column widths). On big sheets
// (thousands of rows — e.g. KSA Daily Log / Incomplete Punches) per-cell styling
// would create 100k+ style objects and freeze the browser during writeBuffer, so
// we skip per-cell borders/zebra there and keep only the styled header.
const STYLE_ROW_LIMIT = 1500;
function tableSheet(wb, name, cols, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  ws.columns = cols.map((c) => ({ width: c.width || 14 }));
  cols.forEach((c, i) => { const cell = ws.getRow(1).getCell(i + 1); cell.value = c.header; headCell(cell); });
  ws.autoFilter = `A1:${colLetter(cols.length)}1`;
  const light = rows.length > STYLE_ROW_LIMIT;
  rows.forEach((cells, ri) => {
    const row = ws.addRow(cells);
    if (light) return; // keep large sheets responsive — header stays styled
    row.eachCell((cell, i) => {
      cell.border = box; cell.font = F(10);
      cell.alignment = { horizontal: cols[i - 1]?.align || 'left', vertical: 'middle' };
      if (ri % 2) cell.fill = fill(ZEBRA);
    });
  });
  return ws;
}

const yn = (b) => (b ? 'yes' : 'no');

export function buildBrandedWorkbook(ExcelJS, data, { inScopeOnly = true, month = '' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CALO Reports Hub';
  const rows = data.rows || [];
  const exportRows = rows.filter((r) => !inScopeOnly || r.inScope);
  const nar = data.narrative || { execSummary: '', insights: [] };
  const d = data.daily || {};
  const t = data.totals || {};
  const s = data.scope || {};
  const f = data.flags || {};
  const periodLabel = d.periodStart ? `${d.periodStart} → ${d.periodEnd}` : (month || 'full file');
  const hasSchedule = !!data.schedule;

  // ── 1. Summary ───────────────────────────────────────────────────────
  const one = wb.addWorksheet('Summary', { views: [{ showGridLines: false }], pageSetup: { fitToWidth: 1, orientation: 'portrait', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } } });
  one.columns = [{ width: 24 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 13 }];
  const banner = (row, text, font, h) => { one.mergeCells(`A${row}:F${row}`); const c = one.getCell(`A${row}`); c.value = text; c.font = font; c.alignment = { vertical: 'middle', wrapText: true }; if (h) one.getRow(row).height = h; };
  banner(1, 'calo', F(28, { bold: true, color: { argb: GREEN } }), 36);
  banner(2, 'Time & Attendance — Summary', F(15, { bold: true }));
  banner(3, `Period ${periodLabel}   ·   Rule: UAE 10h · KSA/Kuwait/Bahrain 9h   ·   ${inScopeOnly ? 'in-scope only' : 'all employees'}`, F(9, { color: { argb: MUTE } }));
  if (hasSchedule) banner(4, `Schedule: ${data.schedule.tab} — ${data.schedule.linkedInRun} linked${data.schedule.unmatchedCount ? `, ${data.schedule.unmatchedCount} unmatched (see last sheet)` : ''}`, F(9, { color: { argb: GREEN } }));

  // KPI strip — the four the report is about + absences/overnight.
  const longShiftTotal = exportRows.reduce((a, e) => a + (e.longShiftDays || 0), 0);
  const kpis = [
    ['In scope', s.inScope || 0], ['OT-days', t.otDays || 0], ['OT-hours', t.otHours || 0],
    ['Absences', d.totalAbsences || 0], ['Overnight', d.totalOvernight || 0],
    ['>16h flags', longShiftTotal],
  ];
  const kr = hasSchedule ? 6 : 5;
  const kLabel = one.getRow(kr), kVal = one.getRow(kr + 1);
  kpis.forEach(([label, val], i) => {
    const lc = kLabel.getCell(i + 1); lc.value = label; lc.fill = fill(LIGHT); lc.font = F(9, { bold: true, color: { argb: MUTE } }); lc.alignment = { horizontal: 'center' }; lc.border = box;
    const vc = kVal.getCell(i + 1); vc.value = val; vc.font = F(15, { bold: true, color: { argb: i === 1 ? GREEN : (i === 5 && longShiftTotal ? AMBER : INK) } }); vc.alignment = { horizontal: 'center' }; vc.border = box;
  });

  // Executive summary (AI) + what to watch
  let r = kr + 3;
  one.mergeCells(`A${r}:F${r}`); const eh = one.getCell(`A${r}`); eh.value = 'EXECUTIVE SUMMARY' + (nar.ai ? '' : ' (auto)'); eh.font = F(10, { bold: true, color: { argb: MUTE } }); r += 1;
  one.mergeCells(`A${r}:F${r + 2}`); const eb = one.getCell(`A${r}`); eb.value = nar.execSummary || '—'; eb.font = F(10); eb.alignment = { vertical: 'top', wrapText: true }; one.getRow(r).height = 48; r += 4;
  (nar.insights || []).slice(0, 5).forEach((ins) => { one.mergeCells(`A${r}:F${r}`); const c = one.getCell(`A${r}`); c.value = '•  ' + ins; c.font = F(9, { color: { argb: INK } }); c.alignment = { wrapText: true }; r += 1; });
  r += 1;

  // Per-country
  r = writeTable(one, r,
    [{ header: 'Country' }, { header: 'Rule' }, { header: 'Emp', align: 'right' }, { header: 'OT-days', align: 'right' }, { header: 'OT-hours', align: 'right' }, { header: 'Absences', align: 'right' }],
    (data.byCountry || []).map((g) => {
      const dept = (data.byDept || []).filter((x) => x.country === g.country);
      const abs = dept.reduce((a, x) => a + x.absences, 0);
      return [g.country, `> ${g.rule}`, g.emps, g.otDays, g.otHours, abs];
    }));

  // Per-department
  r = writeTable(one, r, [{ header: 'Department' }, { header: 'Country' }, { header: 'Emp', align: 'right' }, { header: 'OT-days', align: 'right' }, { header: 'OT-hrs', align: 'right' }, { header: 'Absences', align: 'right' }],
    (data.byDept || []).slice(0, 12).map((g) => [g.dept, g.country, g.employees, g.otDays, g.otHours, g.absences]));

  // Top OT
  writeTable(one, r, [{ header: 'Top overtime (employee)' }, { header: 'Dept' }, { header: 'OT-days', align: 'right' }, { header: 'OT-hrs', align: 'right' }],
    (data.topOt || []).slice(0, 8).map((e) => [e.name || e.empCode, e.dept, e.otDays, e.otHours]));

  // Per-employee totals (the old Employee Detail, folded in)
  tableSheet(wb, 'Employee Totals', [
    { header: 'Emp Code', width: 13 }, { header: 'Name', width: 24 }, { header: 'Country', width: 9 }, { header: 'Department', width: 20 },
    ...(hasSchedule ? [{ header: 'Dept (Zelt)', width: 15 }, { header: 'Title (Zelt)', width: 18 }] : [{ header: 'Dept (Zelt)', width: 15 }, { header: 'Title (Zelt)', width: 18 }]),
    { header: 'Days', width: 7, align: 'right' }, { header: 'Absent', width: 8, align: 'right' }, { header: 'Nights', width: 8, align: 'right' }, { header: '>16h', width: 7, align: 'right' },
    { header: 'Total h', width: 9, align: 'right' }, { header: 'Avg h/day', width: 10, align: 'right' }, { header: 'OT-days', width: 9, align: 'right' }, { header: 'OT-hours', width: 10, align: 'right' },
    ...(hasSchedule ? [{ header: 'Sched days', width: 10, align: 'right' }, { header: 'Variance h', width: 10, align: 'right' }] : []),
    { header: 'In scope', width: 9 }, { header: 'Flag', width: 22 },
  ], exportRows.map((e) => [
    e.empCode, e.name || '', e.country, e.dept || '', e.masterDept || '', e.position || '',
    e.daysWorked, e.absentDays, e.overnightDays, e.longShiftDays || 0,
    e.totalHours ?? '', e.avgHours ?? '', e.otDays, e.otHours,
    ...(hasSchedule ? [e.scheduledDays ?? '', e.varianceHours ?? ''] : []),
    yn(e.inScope),
    [e.nameMismatch ? 'name mismatch' : '', e.deptMismatch ? 'dept mismatch' : ''].filter(Boolean).join(' · '),
  ]));

  // ── 2. Daily Log — attendance by day ─────────────────────────────────
  const log = [];
  exportRows.forEach((e) => (e.days || []).forEach((day) => {
    const overnight = day.overnight ? (day.stitched ? '🌙 stitched' : '🌙 yes') : '';
    const longFlag = day.longShift ? `⚠ ${day.rawHours}h` : '';
    const base = [e.empCode, e.name || '', e.country, e.dept || '', day.date, day.weekday, day.checkIn || '', day.checkOut || '', day.hours, overnight, longFlag];
    if (hasSchedule) base.push(day.scheduled || '', day.varianceH ?? '');
    log.push(base);
  }));
  tableSheet(wb, 'Daily Log', [
    { header: 'Emp Code', width: 13 }, { header: 'Name', width: 22 }, { header: 'Country', width: 9 }, { header: 'Department', width: 18 }, { header: 'Date', width: 12 },
    { header: 'Weekday', width: 10 }, { header: 'Check In', width: 10 }, { header: 'Check Out', width: 10 }, { header: 'Hours', width: 8, align: 'right' },
    { header: 'Overnight', width: 12 }, { header: '>16h flag', width: 11 },
    ...(hasSchedule ? [{ header: 'Scheduled', width: 13 }, { header: 'Variance h', width: 10, align: 'right' }] : []),
  ], log);

  // ── 3. Flags — everything to chase, in one place ─────────────────────
  const flagRows = [];
  for (const e of exportRows) {
    for (const day of (e.days || [])) {
      if (day.longShift) flagRows.push(['>16h shift', e.empCode, e.name || '', e.dept || '', day.date, `${day.rawHours}h (${day.checkIn || '?'}–${day.checkOut || '?'}) — likely a missed punch, not scored`]);
      else if (day.overnight) flagRows.push(['Overnight', e.empCode, e.name || '', e.dept || '', day.date, `${day.checkIn || '?'}–${day.checkOut || '?'}${day.stitched ? ' (stitched from split rows)' : ''}`]);
    }
  }
  for (const m of (data.missingHours || [])) {
    flagRows.push(['Incomplete punch', m.empCode, m.name || '', m.dept || '', m.date, m.checkIn && !m.checkOut ? 'no check-out' : (!m.checkIn && m.checkOut ? 'no check-in' : 'no total time')]);
  }
  for (const e of exportRows) {
    for (const a of (e.absences || [])) flagRows.push(['Absence', e.empCode, e.name || '', e.dept || '', a.date, hasSchedule && e.hasSchedule ? 'scheduled to work, no punch' : 'work day, no punch (inferred)']);
  }
  // Identity / scope anomalies (whole roster, not just in-scope)
  for (const e of rows) {
    if (e.country === 'UNKNOWN' && e.inScope) flagRows.push(['Unknown country', e.empCode, e.name || '', e.dept || '', '', 'Scored at 9h default — fix Department/entity']);
    if (e.nameMismatch) flagRows.push(['Name mismatch', e.empCode, e.name || '', e.dept || '', '', 'Attendance name disagrees with Zelt/master']);
    if (e.deptMismatch) flagRows.push(['Dept mismatch', e.empCode, e.name || '', e.dept || '', '', `Zelt says "${e.masterDept}"`]);
    if (e.noPosition) flagRows.push(['No position', e.empCode, e.name || '', e.dept || '', '', 'Matched but position blank — not counted']);
  }
  const typeOrder = { '>16h shift': 0, Overnight: 1, 'Incomplete punch': 2, Absence: 3 };
  flagRows.sort((a, b) => (typeOrder[a[0]] ?? 9) - (typeOrder[b[0]] ?? 9) || String(a[4]).localeCompare(String(b[4])));
  tableSheet(wb, 'Flags', [
    { header: 'Flag', width: 16 }, { header: 'Emp Code', width: 13 }, { header: 'Name', width: 24 }, { header: 'Department', width: 20 }, { header: 'Date', width: 12 }, { header: 'Detail', width: 52 },
  ], flagRows);

  // ── Schedule — Unmatched (only when a schedule was uploaded) ──────────
  if (hasSchedule && (data.schedule.unmatched || []).length) {
    tableSheet(wb, 'Schedule — Unmatched', [
      { header: 'Name (in schedule)', width: 30 }, { header: 'Position', width: 28 }, { header: 'Action', width: 44 },
    ], data.schedule.unmatched.map((u) => [u.name, u.position || '', 'No confident Zelt match — add/fix the Zelt record or correct the name in the schedule']));
  }

  return wb;
}

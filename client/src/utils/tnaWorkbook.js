// CALO-branded Time & Attendance workbook (exceljs). Pure builder: takes the
// ExcelJS module (injected so it works in the Vite client AND in Node tooling),
// the run result (incl. narrative), and options, and returns a populated
// Workbook with the 9-sheet report. No I/O here — callers write the buffer.
//
// Sheets: 1 One Page Summary · 2 Executive Summary · 3 Overtime Analysis ·
// 4 Employee Detail · 5 Daily Tracking · 6 Daily Log · 7 Absent Employees ·
// 8 Location & Dept · 9 Incomplete Punches · 10 Data Anomalies.

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

// A full-sheet table (frozen header + autofilter + column widths).
function tableSheet(wb, name, cols, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  ws.columns = cols.map((c) => ({ width: c.width || 14 }));
  cols.forEach((c, i) => { const cell = ws.getRow(1).getCell(i + 1); cell.value = c.header; headCell(cell); });
  ws.autoFilter = `A1:${colLetter(cols.length)}1`;
  rows.forEach((cells, ri) => {
    const row = ws.addRow(cells);
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

  // ── 1. One Page Summary ─────────────────────────────────────────────
  const one = wb.addWorksheet('One Page Summary', { views: [{ showGridLines: false }], pageSetup: { fitToWidth: 1, orientation: 'portrait', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } } });
  one.columns = [{ width: 22 }, { width: 14 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 }];
  const banner = (row, text, font, h) => { one.mergeCells(`A${row}:F${row}`); const c = one.getCell(`A${row}`); c.value = text; c.font = font; c.alignment = { vertical: 'middle', wrapText: true }; if (h) one.getRow(row).height = h; };
  banner(1, 'calo', F(28, { bold: true, color: { argb: GREEN } }), 36);
  banner(2, 'Time & Attendance — One Page Summary', F(15, { bold: true }));
  banner(3, `Period ${periodLabel}   ·   Rule: UAE 10h · KSA/Kuwait/Bahrain 9h   ·   ${inScopeOnly ? 'in-scope only' : 'all employees'}`, F(9, { color: { argb: MUTE } }));

  // KPI strip
  const kpis = [
    ['In scope', s.inScope || 0], ['OT-days', t.otDays || 0], ['OT-hours', t.otHours || 0],
    ['Absences', d.totalAbsences || 0], ['Overnight', d.totalOvernight || 0],
    ['Incomplete', (data.missingHours || []).length],
  ];
  const kLabel = one.getRow(5), kVal = one.getRow(6);
  kpis.forEach(([label, val], i) => {
    const lc = kLabel.getCell(i + 1); lc.value = label; lc.fill = fill(LIGHT); lc.font = F(9, { bold: true, color: { argb: MUTE } }); lc.alignment = { horizontal: 'center' }; lc.border = box;
    const vc = kVal.getCell(i + 1); vc.value = val; vc.font = F(15, { bold: true, color: { argb: i === 1 ? GREEN : INK } }); vc.alignment = { horizontal: 'center' }; vc.border = box;
  });

  // Executive summary (AI)
  let r = 8;
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

  // Top OT + Top absentees (5 each)
  r = writeTable(one, r, [{ header: 'Top overtime (employee)' }, { header: 'Dept' }, { header: 'OT-days', align: 'right' }, { header: 'OT-hrs', align: 'right' }],
    (data.topOt || []).slice(0, 5).map((e) => [e.name || e.empCode, e.dept, e.otDays, e.otHours]));
  r = writeTable(one, r, [{ header: 'Top absences (employee)' }, { header: 'Dept' }, { header: 'Absent', align: 'right' }],
    (data.topAbsent || []).slice(0, 5).map((e) => [e.name || e.empCode, e.dept, e.absentDays]));

  // ── 2. Executive Summary ────────────────────────────────────────────
  const ex = wb.addWorksheet('Executive Summary', { views: [{ showGridLines: false }] });
  ex.columns = [{ width: 26 }, { width: 24 }, { width: 24 }, { width: 24 }];
  ex.mergeCells('A1:D1'); const ext = ex.getCell('A1'); ext.value = 'Executive Summary'; ext.font = F(16, { bold: true }); ex.getRow(1).height = 28;
  ex.mergeCells('A2:D2'); const exs = ex.getCell('A2'); exs.value = `Period ${periodLabel}` + (nar.ai ? '' : '  ·  summary auto-generated (AI unavailable)'); exs.font = F(9, { color: { argb: MUTE } });
  ex.mergeCells('A4:D7'); const exb = ex.getCell('A4'); exb.value = nar.execSummary || '—'; exb.font = F(11); exb.alignment = { vertical: 'top', wrapText: true };
  let er = 9;
  ex.getCell(`A${er}`).value = 'What to watch'; ex.getCell(`A${er}`).font = F(11, { bold: true, color: { argb: GREEN } }); er += 1;
  (nar.insights || []).forEach((ins) => { ex.mergeCells(`A${er}:D${er}`); const c = ex.getCell(`A${er}`); c.value = '•  ' + ins; c.font = F(10); c.alignment = { wrapText: true }; ex.getRow(er).height = 28; er += 1; });
  er += 1;
  writeTable(ex, er, [{ header: 'Figure' }, { header: 'Value', align: 'right' }], [
    ['In-scope employees', s.inScope || 0], ['Total OT-days', t.otDays || 0], ['Total OT-hours', t.otHours || 0],
    ['Inferred absences', d.totalAbsences || 0], ['Overnight shifts', d.totalOvernight || 0],
    ['Excluded (mgr/admin)', s.excluded || 0], ['Unmatched', s.unmatched || 0],
  ]);

  // ── 3. Overtime Analysis ────────────────────────────────────────────
  const ot = wb.addWorksheet('Overtime Analysis', { views: [{ showGridLines: false }] });
  ot.columns = [{ width: 26 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }];
  let orow = writeTable(ot, 1, [{ header: 'Country' }, { header: 'Rule' }, { header: 'Employees', align: 'right' }, { header: 'OT-days', align: 'right' }, { header: 'OT-hours', align: 'right' }, { header: 'OT-days @9h', align: 'right' }],
    (data.byCountry || []).map((g) => [g.country, `> ${g.rule}`, g.emps, g.otDays, g.otHours, g.otDays9]));
  orow = writeTable(ot, orow, [{ header: 'Department' }, { header: 'Country' }, { header: 'Employees', align: 'right' }, { header: 'OT-days', align: 'right' }, { header: 'OT-hours', align: 'right' }],
    (data.byDept || []).map((g) => [g.dept, g.country, g.employees, g.otDays, g.otHours]));
  writeTable(ot, orow, [{ header: 'Top OT — employee' }, { header: 'Country' }, { header: 'Dept' }, { header: 'OT-days', align: 'right' }, { header: 'OT-hours', align: 'right' }],
    (data.topOt || []).map((e) => [e.name || e.empCode, e.country, e.dept, e.otDays, e.otHours]));

  // ── 4. Employee Detail ──────────────────────────────────────────────
  tableSheet(wb, 'Employee Detail', [
    { header: 'Emp Code', width: 14 }, { header: 'Name', width: 24 }, { header: 'Country', width: 10 }, { header: 'Department', width: 22 }, { header: 'Position', width: 20 },
    { header: 'Days', width: 8, align: 'right' }, { header: 'Absent', width: 8, align: 'right' }, { header: 'Nights', width: 8, align: 'right' },
    { header: 'OT-days', width: 9, align: 'right' }, { header: 'OT-hours', width: 10, align: 'right' }, { header: 'In scope', width: 9 }, { header: 'Flag', width: 16 },
  ], exportRows.map((e) => [e.empCode, e.name || '', e.country, e.dept || '', e.position || '', e.daysWorked, e.absentDays, e.overnightDays, e.otDays, e.otHours, yn(e.inScope), e.nameMismatch ? 'name mismatch' : '']));

  // ── 5. Daily Tracking ───────────────────────────────────────────────
  tableSheet(wb, 'Daily Tracking', [
    { header: 'Date', width: 12 }, { header: 'Weekday', width: 10 }, { header: 'Present', width: 9, align: 'right' }, { header: 'Absent', width: 9, align: 'right' },
    { header: 'On OT', width: 9, align: 'right' }, { header: 'OT-hours', width: 10, align: 'right' }, { header: 'Work day', width: 10 },
  ], (data.byDate || []).map((g) => [g.date, g.weekday, g.present, g.absent, g.onOt, g.otHours, yn(g.isWorkDay)]));

  // ── 6. Daily Log ────────────────────────────────────────────────────
  const log = [];
  exportRows.forEach((e) => (e.days || []).forEach((day) => log.push([e.empCode, e.name || '', e.country, e.dept || '', day.date, day.weekday, day.hours, day.checkIn || '', day.checkOut || '', day.overnight ? 'yes' : ''])));
  tableSheet(wb, 'Daily Log', [
    { header: 'Emp Code', width: 14 }, { header: 'Name', width: 22 }, { header: 'Country', width: 9 }, { header: 'Department', width: 20 }, { header: 'Date', width: 12 },
    { header: 'Weekday', width: 10 }, { header: 'Hours', width: 9, align: 'right' }, { header: 'Check In', width: 10 }, { header: 'Check Out', width: 10 }, { header: 'Overnight', width: 10 },
  ], log);

  // ── 7. Absent Employees ─────────────────────────────────────────────
  tableSheet(wb, 'Absent Employees', [
    { header: 'Emp Code', width: 14 }, { header: 'Name', width: 24 }, { header: 'Department', width: 22 }, { header: 'Absent days', width: 11, align: 'right' }, { header: 'Dates', width: 50 }, { header: 'Excuse', width: 24 },
  ], exportRows.filter((e) => e.absentDays > 0).sort((a, b) => b.absentDays - a.absentDays)
    .map((e) => [e.empCode, e.name || '', e.dept || '', e.absentDays, (e.absences || []).map((a) => a.date).join(', '), '']));

  // ── 8. Location & Dept ──────────────────────────────────────────────
  tableSheet(wb, 'Location & Dept', [
    { header: 'Department', width: 26 }, { header: 'Country', width: 10 }, { header: 'Employees', width: 11, align: 'right' }, { header: 'Present-days', width: 12, align: 'right' },
    { header: 'OT-days', width: 9, align: 'right' }, { header: 'OT-hours', width: 10, align: 'right' }, { header: 'Absences', width: 10, align: 'right' },
  ], (data.byDept || []).map((g) => [g.dept, g.country, g.employees, g.presentDays, g.otDays, g.otHours, g.absences]));

  // ── 9. Incomplete Punches ───────────────────────────────────────────
  // Employee-days with a punch but no Total Time (clocked in but not out, or
  // vice-versa) — the biometric "incomplete punches" to chase.
  tableSheet(wb, 'Incomplete Punches', [
    { header: 'Emp Code', width: 14 }, { header: 'Name', width: 24 }, { header: 'Department', width: 22 }, { header: 'Date', width: 12 },
    { header: 'Weekday', width: 10 }, { header: 'Check In', width: 10 }, { header: 'Check Out', width: 10 }, { header: 'Issue', width: 16 },
  ], (data.missingHours || []).map((m) => [
    m.empCode, m.name || '', m.dept || '', m.date, m.weekday, m.checkIn || '', m.checkOut || '',
    m.checkIn && !m.checkOut ? 'no check-out' : (!m.checkIn && m.checkOut ? 'no check-in' : 'no total time'),
  ]));

  // ── 10. Data Anomalies (identity / scope data-quality flags) ─────────
  const anomalies = [];
  for (const e of rows) {
    if (e.country === 'UNKNOWN' && e.inScope) anomalies.push(['Unknown country', e.empCode, e.name || '', e.dept || '', 'Scored at 9h default — fix Department/entity']);
    if (e.nameMismatch) anomalies.push(['Name mismatch', e.empCode, e.name || '', e.dept || '', 'Attendance name disagrees with master — possible ID collision']);
    if (e.noPosition) anomalies.push(['No position', e.empCode, e.name || '', e.dept || '', 'Matched but master position is blank — not counted']);
    if (e.matched === false && data.masters && data.masters.length) anomalies.push(['Unmatched', e.empCode, e.name || '', e.dept || '', 'Not found in any uploaded master']);
  }
  tableSheet(wb, 'Data Anomalies', [
    { header: 'Type', width: 18 }, { header: 'Emp Code', width: 14 }, { header: 'Name', width: 24 }, { header: 'Department', width: 22 }, { header: 'Detail', width: 50 },
  ], anomalies);

  return wb;
}

// OT calculator Excel export (exceljs). Pass-1 sheets: OT Payroll (when a salary
// master is loaded and the viewer may see salary), Department Summary, Employee
// Summary, Daily Attendance, Exceptions, Rules Used. Pure builder — the caller
// writes the buffer and triggers the download.
const GREEN = 'FF02B376', WHITE = 'FFFFFFFF', INK = 'FF1A2B23', ZEBRA = 'FFF4FBF8';
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { argb: 'FFD9E2DD' } };
const box = { top: thin, bottom: thin, left: thin, right: thin };

function hhmm(min) { if (min == null || Number.isNaN(min)) return ''; const m = Math.round(min); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function tsTime(ts) { if (ts == null) return ''; const d = new Date(ts * 1000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }

function addSheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  ws.columns = columns.map((c) => ({ width: c.width || 14 }));
  const hr = ws.getRow(1);
  columns.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header; cell.fill = fill(GREEN);
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: WHITE } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = box;
  });
  hr.height = 24;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const heavy = rows.length <= 3000;
  rows.forEach((r, ri) => {
    const row = ws.addRow(columns.map((c) => r[c.key]));
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = { name: 'Calibri', size: 10, color: { argb: INK } };
      cell.alignment = { horizontal: c.align || 'left', vertical: 'middle' };
      if (c.num) cell.numFmt = c.numFmt || '0.##';
      if (heavy) { cell.border = box; if (ri % 2) cell.fill = fill(ZEBRA); }
    });
  });
  return ws;
}

export function buildOtWorkbook(ExcelJS, { D, view, settings, company, master, showSalary }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CALO Reports Hub';
  wb.created = new Date();
  const dec = company?.dec ?? 2;
  const money = dec === 3 ? '#,##0.000' : '#,##0.00';
  const sum = view.summary || [];
  const sal = !!(master && showSalary);

  // OT Payroll (salary) — only with a master and salary-visible viewer
  if (sal) {
    addSheet(wb, 'OT Payroll', [
      { header: 'Employee ID', key: 'id', width: 14 },
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Designation', key: 'desig', width: 20 },
      { header: 'Department', key: 'dept', width: 18 },
      { header: 'Master Status', key: 'status', width: 14 },
      { header: 'Working Days', key: 'days', width: 12, align: 'right', num: true },
      { header: 'Days with OT', key: 'otDays', width: 12, align: 'right', num: true },
      { header: 'Total OT (HH:MM)', key: 'otHHMM', width: 14, align: 'right' },
      { header: 'Total OT Hours', key: 'otHours', width: 13, align: 'right', num: true },
      { header: 'Basic Salary', key: 'basic', width: 13, align: 'right', num: true, numFmt: money },
      { header: 'Hourly Basic Rate', key: 'rate', width: 15, align: 'right', num: true, numFmt: money },
      { header: 'OT Hourly Rate', key: 'otRate', width: 14, align: 'right', num: true, numFmt: money },
      { header: 'Allowance Paid %', key: 'pct', width: 14, align: 'right' },
      { header: 'OT Allowance', key: 'amount', width: 13, align: 'right', num: true, numFmt: money },
      { header: 'Special Allowance', key: 'special', width: 15, align: 'right', num: true, numFmt: money },
      { header: 'Total OT Payable', key: 'total', width: 15, align: 'right', num: true, numFmt: money },
    ], sum.filter((s) => s.ot > 0 || s.special > 0).map((s) => ({
      id: s.id, name: s.name, desig: s.desig, dept: s.dept, status: s.status,
      days: s.days, otDays: s.otDays, otHHMM: hhmm(s.ot), otHours: round(s.ot / 60, 2),
      basic: s.basic, rate: s.rate != null ? round(s.rate, 4) : null, otRate: s.otRate != null ? round(s.otRate, 4) : null,
      pct: Math.round((s.factor || 0) * 100) + '%', amount: s.amount, special: s.special || 0, total: s.total,
    })));
  }

  // Department Summary
  addSheet(wb, 'Department Summary', [
    { header: 'Department', key: 'dept', width: 22 },
    { header: 'Employees', key: 'emps', width: 12, align: 'right', num: true },
    { header: 'Employees with OT', key: 'otEmps', width: 15, align: 'right', num: true },
    { header: 'OT (HH:MM)', key: 'otHHMM', width: 12, align: 'right' },
    { header: 'OT Hours', key: 'otHours', width: 11, align: 'right', num: true },
    ...(sal ? [{ header: 'OT Allowance', key: 'amount', width: 13, align: 'right', num: true, numFmt: money }] : []),
  ], (view.byDept || []).map((d) => ({ dept: d.dept, emps: d.emps, otEmps: d.otEmps, otHHMM: hhmm(d.ot), otHours: round(d.ot / 60, 2), amount: sal ? round(d.amount, dec) : undefined })));

  // Employee Summary
  addSheet(wb, 'Employee Summary', [
    { header: 'Employee ID', key: 'id', width: 14 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Department', key: 'dept', width: 18 },
    { header: 'Working Days', key: 'days', width: 12, align: 'right', num: true },
    { header: 'Days with OT', key: 'otDays', width: 12, align: 'right', num: true },
    { header: 'Total Hours (HH:MM)', key: 'totH', width: 16, align: 'right' },
    { header: 'Break', key: 'brk', width: 10, align: 'right' },
    { header: 'Normal (HH:MM)', key: 'normalH', width: 13, align: 'right' },
    { header: 'OT (HH:MM)', key: 'otHHMM', width: 11, align: 'right' },
    { header: 'OT Hours', key: 'otHours', width: 10, align: 'right', num: true },
    { header: 'Missing IN', key: 'missIn', width: 11, align: 'right', num: true },
    { header: 'Missing OUT', key: 'missOut', width: 11, align: 'right', num: true },
    { header: 'Exceptions', key: 'exc', width: 11, align: 'right', num: true },
  ], sum.map((s) => ({
    id: s.id, name: s.name, dept: s.dept, days: s.days, otDays: s.otDays,
    totH: hhmm(s.span), brk: hhmm(s.brk), normalH: hhmm(s.normal), otHHMM: hhmm(s.ot), otHours: round(s.ot / 60, 2),
    missIn: s.missIn, missOut: s.missOut, exc: s.exc,
  })));

  // Daily Attendance
  addSheet(wb, 'Daily Attendance', [
    { header: 'Employee ID', key: 'id', width: 14 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Department', key: 'dept', width: 16 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Check IN', key: 'in', width: 10, align: 'center' },
    { header: 'Check OUT', key: 'out', width: 11, align: 'center' },
    { header: '+1 day', key: 'next', width: 8, align: 'center' },
    { header: 'Total (HH:MM)', key: 'span', width: 12, align: 'right' },
    { header: 'Break', key: 'brk', width: 9, align: 'right' },
    { header: 'Buffer', key: 'buf', width: 9, align: 'right' },
    { header: 'Normal', key: 'normal', width: 10, align: 'right' },
    { header: 'OT (HH:MM)', key: 'ot', width: 11, align: 'right' },
    ...(sal ? [{ header: 'OT Amount', key: 'amount', width: 12, align: 'right', num: true, numFmt: money }] : []),
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Review notes', key: 'notes', width: 40 },
  ], (D.daily || []).map((d) => ({
    id: d.id, name: d.name, dept: d.dept, date: d.date,
    in: d.inTs != null ? tsTime(d.inTs) : '', out: d.outTs != null ? tsTime(d.outTs) : '',
    next: d.overnight ? '+1' : '', span: hhmm(d.span), brk: d.brk != null ? hhmm(d.brk) : '', buf: d.buf != null ? hhmm(d.buf) : '',
    normal: d.normal != null ? hhmm(d.normal) : '', ot: d.ot != null ? hhmm(d.ot) : '',
    amount: sal ? otAmtFor(d, view, dec) : undefined,
    status: d.status, notes: (d.issueDetail || '') + (d.flags && d.flags.length ? (d.issueDetail ? ' | ' : '') + d.flags.map((f) => f.type).join(', ') : ''),
  })));

  // Exceptions
  addSheet(wb, 'Exceptions', [
    { header: 'Priority', key: 'sev', width: 10 },
    { header: 'Exception', key: 'type', width: 26 },
    { header: 'Employee ID', key: 'id', width: 14 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Department', key: 'dept', width: 16 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Details', key: 'detail', width: 60 },
  ], (D.exc || []).slice().sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'action' ? -1 : 1)).map((x) => ({
    sev: x.sev === 'action' ? 'Action' : 'Info', type: x.type, id: x.id, name: x.name, dept: x.dept, date: x.date || '', detail: x.detail,
  })));

  // Rules Used
  const ws = wb.addWorksheet('Rules Used');
  ws.columns = [{ width: 28 }, { width: 50 }];
  const rr = [
    ['Company', company?.name || ''], ['Currency', company?.cur || ''],
    ['Period', (D.period?.min || '') + ' to ' + (D.period?.max || '')],
    ['Standard hours/day', settings.std], ['Break (min)', settings.breakMin], ['Break applies when span ≥ (h)', settings.breakFrom],
    ['Daily OT buffer (min)', settings.buffer], ['OT rounding', settings.otRound], ['Minimum OT (min)', settings.minOT],
    ['Rest gap (h)', settings.gap], ['Max shift / pairing window (h)', settings.win], ['Long-shift flag (h)', settings.maxShift],
    ['Rate basis', settings.rateBasis === '365' ? 'Basic × 12 ÷ 365 ÷ ' + settings.rateHours + 'h' : 'Basic ÷ 30 ÷ ' + settings.rateHours + 'h'],
    ['OT multiplier', settings.otMult],
    ['OT formula', 'OT = worked − break − standard(' + settings.std + 'h) − buffer(' + settings.buffer + 'm), rounded, ≥ 0'],
  ];
  rr.forEach((row, i) => { const r = ws.addRow(row); r.getCell(1).font = { bold: true, color: { argb: INK } }; if (i % 2) r.eachCell((c) => { c.fill = fill(ZEBRA); }); });
  return wb;
}

function round(n, d) { if (n == null || Number.isNaN(n)) return null; const f = Math.pow(10, d); return Math.round(n * f) / f; }
function otAmtFor(d, view, dec) {
  // per-shift amount is illustrative: hourly from the employee's summary row
  const s = (view.summary || []).find((x) => x.id === d.id);
  if (!s || s.rate == null || !(d.ot > 0)) return null;
  return round(d.ot / 60 * s.otRate * (s.factor || 1), dec);
}

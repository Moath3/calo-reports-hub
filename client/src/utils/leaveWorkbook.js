// CALO-branded leave-balances workbook (exceljs). Pure builder: inject the
// ExcelJS module so it runs in the Vite client AND in Node tooling/tests. No
// I/O here — callers write the buffer.
//
// One sheet, "Leave Balances": a green-headed table with friendly column names,
// zebra striping, and CONDITIONAL HIGHLIGHTING on the two balance cells that HR
// chases:
//   Annual Balance     — yellow 30–50 days, red above 50
//   Compensatory Days  — yellow 5–10 days,  red above 10
// This replaces the old plain TRUE/FALSE flag columns.

const GREEN = 'FF02B376', WHITE = 'FFFFFFFF', INK = 'FF1A2B23', ZEBRA = 'FFF4FBF8';
const YELLOW = 'FFFDE68A', YELLOW_INK = 'FF7A5B00';
const RED = 'FFF6B6B6', RED_INK = 'FF7F1D1D';

const thin = { style: 'thin', color: { argb: 'FFD9E2DD' } };
const box = { top: thin, bottom: thin, left: thin, right: thin };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const F = (size, opts = {}) => ({ name: 'Calibri', size, color: { argb: INK }, ...opts });
const colLetter = (n) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const STYLE_ROW_LIMIT = 2500; // skip zebra/borders above this (keeps big sheets fast); highlights always apply

// Friendly column catalogue + how to pull/format each value. `highlight` marks
// the two conditionally-coloured balance cells.
function leaveColumns(multi) {
  const cols = [
    { header: 'Employee ID', key: 'employeeId', width: 13 },
    { header: 'Name', key: 'name', width: 24 },
  ];
  if (multi) cols.push({ header: 'Entity', key: 'entity', width: 20 });
  cols.push(
    { header: 'Department', key: 'department', width: 18 },
    { header: 'Job Title', key: 'jobTitle', width: 22 },
    { header: 'Site', key: 'site', width: 18 },
    { header: 'Type', key: 'type', width: 15, align: 'center' },
    { header: 'Policy', key: 'policy', width: 18 },
    { header: 'Start Date', key: 'startDate', width: 13, align: 'center', date: true },
    { header: 'Annual Allowance', key: 'allowance', width: 15, align: 'right', num: true },
    { header: 'Available Now', key: 'availableNow', width: 14, align: 'right', num: true, highlight: 'annual' },
    { header: 'Upcoming Booked', key: 'upcoming', width: 15, align: 'right', num: true },
    { header: 'Pending Approval', key: 'pending', width: 15, align: 'right', num: true },
    { header: 'Balance by Dec 31', key: 'endOfYear', width: 16, align: 'right', num: true },
    { header: 'Compensatory Days', key: 'compensatory', width: 16, align: 'right', num: true, highlight: 'comp' },
    { header: 'Comp Expiring (≤45d)', key: 'compExpiringDays', width: 18, align: 'right', num: true },
    { header: 'Comp Expired', key: 'compExpiredDays', width: 13, align: 'right', num: true },
  );
  return cols;
}

function cellValue(row, col) {
  if (col.key === 'type') return row.isProduction ? 'Production' : 'Non-production';
  const v = row[col.key];
  if (col.date) { const d = v ? new Date(v) : null; return (d && !Number.isNaN(d.getTime())) ? d : null; }
  if (col.num) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return v == null ? null : v;
}

// yellow 30–50 / red >50 for annual; yellow 5–10 / red >10 for comp.
export function leaveHighlight(kind, v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (kind === 'annual') { if (n > 50) return 'red'; if (n >= 30) return 'yellow'; return null; }
  if (kind === 'comp') { if (n > 10) return 'red'; if (n >= 5) return 'yellow'; return null; }
  return null;
}

export function buildLeaveWorkbook(ExcelJS, data, { asOfDate = '' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CALO Reports Hub';
  wb.created = new Date();

  const rows = data?.rows || [];
  const multi = !!data?.multi;
  const cols = leaveColumns(multi);

  const ws = wb.addWorksheet('Leave Balances', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  ws.columns = cols.map((c) => ({ width: c.width || 14 }));

  // Row 1 — CALO-green header.
  const hr = ws.getRow(1);
  cols.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.fill = fill(GREEN);
    cell.font = F(11, { bold: true, color: { argb: WHITE } });
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = box;
  });
  hr.height = 24;
  ws.autoFilter = `A1:${colLetter(cols.length)}1`;

  const heavy = rows.length <= STYLE_ROW_LIMIT;
  rows.forEach((r, ri) => {
    const row = ws.addRow(cols.map((c) => cellValue(r, c)));
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = F(10);
      cell.alignment = { horizontal: c.align || 'left', vertical: 'middle' };
      if (c.num) cell.numFmt = '0.#';
      if (c.date) cell.numFmt = 'dd-mmm-yyyy';
      if (heavy) {
        cell.border = box;
        if (ri % 2) cell.fill = fill(ZEBRA);
      }
      // Conditional highlight always applied — the whole point of the export.
      if (c.highlight) {
        const hl = leaveHighlight(c.highlight, r[c.key]);
        if (hl === 'yellow') { cell.fill = fill(YELLOW); cell.font = F(10, { bold: true, color: { argb: YELLOW_INK } }); }
        else if (hl === 'red') { cell.fill = fill(RED); cell.font = F(10, { bold: true, color: { argb: RED_INK } }); }
      }
    });
  });

  return wb;
}

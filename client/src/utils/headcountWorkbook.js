// CALO-branded headcount workbook (exceljs). Pure builder: inject the ExcelJS
// module so it runs in the Vite client and in Node tooling/tests. One sheet,
// green-headed, a clean full-employee roster for HR headcount.

const GREEN = 'FF02B376', WHITE = 'FFFFFFFF', INK = 'FF1A2B23', ZEBRA = 'FFF4FBF8';
const thin = { style: 'thin', color: { argb: 'FFD9E2DD' } };
const box = { top: thin, bottom: thin, left: thin, right: thin };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const F = (size, opts = {}) => ({ name: 'Calibri', size, color: { argb: INK }, ...opts });
const colLetter = (n) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const COLS = [
  { header: 'Employee ID', key: 'employeeId', width: 14 },
  { header: 'Name', key: 'name', width: 32 },
  { header: 'Position', key: 'position', width: 28 },
  { header: 'Department', key: 'department', width: 20 },
  { header: 'Business Line', key: 'businessLine', width: 20 },
  { header: 'Organization', key: 'org', width: 20 },
  { header: 'Joining Date', key: 'startDate', width: 14, align: 'center', date: true },
];

export function buildHeadcountWorkbook(ExcelJS, data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CALO Reports Hub';
  wb.created = new Date();
  const rows = data?.rows || [];

  const ws = wb.addWorksheet('Headcount', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  ws.columns = COLS.map((c) => ({ width: c.width }));

  const hr = ws.getRow(1);
  COLS.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.fill = fill(GREEN);
    cell.font = F(11, { bold: true, color: { argb: WHITE } });
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = box;
  });
  hr.height = 22;
  ws.autoFilter = `A1:${colLetter(COLS.length)}1`;

  rows.forEach((r, ri) => {
    const row = ws.addRow(COLS.map((c) => {
      const v = r[c.key];
      if (c.date) { const d = v ? new Date(v) : null; return (d && !Number.isNaN(d.getTime())) ? d : null; }
      return v == null ? '' : v;
    }));
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = F(10);
      cell.alignment = { horizontal: c.align || 'left', vertical: 'middle' };
      if (c.date) cell.numFmt = 'dd-mmm-yyyy';
      cell.border = box;
      if (ri % 2) cell.fill = fill(ZEBRA);
    });
  });

  return wb;
}

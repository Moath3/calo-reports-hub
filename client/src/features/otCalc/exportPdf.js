// OT calculator PDF export (jsPDF + autotable). Pure builder: the caller passes
// the lazily-imported jsPDF + autoTable, we return the doc. CALO-green brand
// band, KPI row, Department Summary + Employee OT Payroll tables, sign-off blocks.
// Basic salary + rates are deliberately omitted from the PDF (hand-out document).
const GREEN = [2, 179, 118], INK = [26, 43, 35], GREY = [120, 130, 125];

function hhmm(min) { if (min == null || Number.isNaN(min)) return ''; const m = Math.round(min); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function money(n, dec) { if (n == null || Number.isNaN(Number(n))) return '—'; return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }); }

export function buildOtPdf(jsPDF, autoTable, { D, view, company, showSalary, status }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const dec = company?.dec ?? 2;
  const sal = !!(showSalary && view.summary.some((s) => s.rate != null));
  const k = view.kpis;

  // Header band
  doc.setFillColor(...GREEN); doc.rect(0, 0, W, 60, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Overtime Report', 32, 27);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`${company?.name || ''}   ·   ${D.period?.min || ''} to ${D.period?.max || ''}${status ? '   ·   ' + String(status).toUpperCase() : ''}`, 32, 45);

  // KPI row
  let y = 80;
  const kpis = [['Employees', String(k.emps ?? 0)], ['OT hours', ((k.otH || 0) / 60).toFixed(1)], ['Employees with OT', String(k.otEmps ?? 0)], ['Exceptions', String(k.exceptions ?? 0)]];
  if (sal && k.totalPayable != null) kpis.push([`OT payable (${company.cur})`, money(k.totalPayable, dec)]);
  const tileW = (W - 64) / kpis.length;
  kpis.forEach(([label, val], i) => {
    const x = 32 + i * tileW;
    doc.setDrawColor(222, 230, 226); doc.roundedRect(x, y, tileW - 10, 44, 4, 4, 'S');
    doc.setTextColor(...GREY); doc.setFontSize(8); doc.text(label.toUpperCase(), x + 10, y + 16);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(String(val), x + 10, y + 36); doc.setFont('helvetica', 'normal');
  });
  y += 62;

  // Department Summary
  autoTable(doc, {
    startY: y,
    head: [['Department', 'Employees', 'With OT', 'OT (HH:MM)', 'OT hours', ...(sal ? [`OT allowance (${company.cur})`] : [])]],
    body: (view.byDept || []).map((d) => [d.dept, d.emps, d.otEmps, hhmm(d.ot), (d.ot / 60).toFixed(1), ...(sal ? [money(d.amount, dec)] : [])]),
    foot: [['TOTAL', k.emps ?? '', k.otEmps ?? '', hhmm(k.otH), ((k.otH || 0) / 60).toFixed(1), ...(sal ? [money(k.totalAmount, dec)] : [])]],
    styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: GREEN }, footStyles: { fillColor: [240, 251, 248], textColor: INK, fontStyle: 'bold' },
    margin: { left: 32, right: 32 },
  });
  y = doc.lastAutoTable.finalY + 18;

  // Employee OT Payroll (OT employees only)
  const rows = view.summary.filter((s) => s.ot > 0 || (s.special || 0) > 0);
  autoTable(doc, {
    startY: y,
    head: [['#', 'ID', 'Name', 'Designation', 'Dept', 'Days', 'OT days', 'OT (HH:MM)', ...(sal ? ['Paid %', `OT allowance`, 'Special', 'Total payable'] : [])]],
    body: rows.map((s, i) => [i + 1, s.id, s.name, s.desig || '', s.dept, s.days, s.otDays, hhmm(s.ot),
      ...(sal ? [Math.round((s.factor || 0) * 100) + '%', money(s.amount, dec), money(s.special || 0, dec), money(s.total, dec)] : [])]),
    styles: { fontSize: 7.5, cellPadding: 2.5 }, headStyles: { fillColor: GREEN }, margin: { left: 32, right: 32 },
    didDrawPage: () => {
      const H = doc.internal.pageSize.getHeight();
      doc.setFontSize(7); doc.setTextColor(...GREY);
      doc.text('Confidential — CALO People', 32, H - 14);
    },
  });
  y = doc.lastAutoTable.finalY + 28;

  // Sign-off blocks
  const H = doc.internal.pageSize.getHeight();
  if (y > H - 70) { doc.addPage(); y = 60; }
  const blocks = ['Prepared by', 'Reviewed by', 'Approved by'];
  const bw = (W - 64) / 3;
  blocks.forEach((label, i) => {
    const x = 32 + i * bw;
    doc.setDrawColor(180, 190, 185); doc.line(x, y + 30, x + bw - 24, y + 30);
    doc.setTextColor(...GREY); doc.setFontSize(8); doc.text(label, x, y + 44);
  });
  return doc;
}

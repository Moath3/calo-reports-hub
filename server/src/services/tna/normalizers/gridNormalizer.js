import { codeToSchedule } from '../rosterModel.js';

// Generic "employees down, dates across" grid. Header row: [idCol, nameCol, ...dateCols].
// Returns { rows, errors }. Each error: { row, message }.
export function gridNormalizer(aoa) {
  const rows = [];
  const errors = [];
  if (!aoa || aoa.length < 2) return { rows, errors: [{ row: 0, message: 'Empty roster sheet' }] };
  const header = aoa[0];
  const dates = header.slice(2);
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    const empId = String(r[0] || '').trim();
    const name = String(r[1] || '').trim();
    if (!empId) { errors.push({ row: i, message: 'Missing Employee ID' }); continue; }
    dates.forEach((date, j) => {
      const code = r[2 + j];
      if (code == null || code === '') return; // blank cell = no schedule that day
      const sched = codeToSchedule(code);
      if (!sched) { errors.push({ row: i, message: `Unknown shift code "${code}" for ${empId} on ${date}` }); return; }
      rows.push({ empId, name, date: String(date), ...sched });
    });
  }
  return { rows, errors };
}

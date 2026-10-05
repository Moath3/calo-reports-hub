import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { parseShiftCell, parseClock, scheduledMinutes, linkScheduleToRoster, parseScheduleWorkbook, buildScheduleIndex } from './scheduleParser.js';

test('parseClock handles 24h, am/pm and bare-hour forms', () => {
  assert.equal(parseClock('15:00'), 900);
  assert.equal(parseClock('7AM'), 420);
  assert.equal(parseClock('5PM'), 1020);
  assert.equal(parseClock('7:00'), 420);
  assert.equal(parseClock('00:00'), 0);
  assert.equal(parseClock('12PM'), 720);
  assert.equal(parseClock('12AM'), 0);
  assert.equal(parseClock('junk'), null);
});

test('parseShiftCell classifies day, night, leave and off tokens', () => {
  assert.deepEqual(parseShiftCell('06:00-15:00'), { type: 'work', start: 360, end: 900, overnight: false, raw: '06:00-15:00' });
  const night = parseShiftCell('22:00-07:00');
  assert.equal(night.type, 'work'); assert.equal(night.overnight, true);
  const midnight = parseShiftCell('15:00-00:00');
  assert.equal(midnight.overnight, true);
  assert.equal(parseShiftCell('7AM - 5PM').start, 420);
  assert.equal(parseShiftCell('7:00- 16:00').end, 960);   // messy spacing
  assert.equal(parseShiftCell('OFF').type, 'off');
  assert.equal(parseShiftCell('PH').type, 'off');
  assert.equal(parseShiftCell('PH').leaveKind, 'ph');
  assert.equal(parseShiftCell('AL').leaveKind, 'annual');
  assert.equal(parseShiftCell('SL').leaveKind, 'sick');
  assert.equal(parseShiftCell('SICK LEAVE').leaveKind, 'sick');
  assert.equal(parseShiftCell('ABSENT').type, 'absent');
  assert.equal(parseShiftCell('').type, 'none');
  assert.equal(parseShiftCell('THURSDAY').type, 'none');
});

test('scheduledMinutes spans midnight correctly', () => {
  assert.equal(scheduledMinutes(parseShiftCell('06:00-15:00')), 540);
  assert.equal(scheduledMinutes(parseShiftCell('22:00-07:00')), 540);  // 9h overnight
  assert.equal(scheduledMinutes(parseShiftCell('15:00-00:00')), 540);  // 9h to midnight
  assert.equal(scheduledMinutes(parseShiftCell('OFF')), null);
});

test('linkScheduleToRoster matches by exact, token-subset and dice; lists unmatched', () => {
  const roster = [
    { empId: 'FTE1', name: 'Rakesh Kumar Ghosh' },
    { empId: 'FTE2', name: 'Jesus Vinas' },
    { empId: 'FTE3', name: 'Aamir Siddiquie' },
  ];
  const emps = [
    { name: 'Rakesh Ghosh', position: 'CDP', days: {} },   // token-subset of FTE1
    { name: 'JESUS VINAS', position: 'KM', days: {} },      // exact (case-insensitive)
    { name: 'Totally Unknown Person', position: 'X', days: {} },
  ];
  const { matched, unmatched, employees } = linkScheduleToRoster(emps, roster);
  assert.equal(employees[0].employeeId, 'FTE1');
  assert.equal(employees[1].employeeId, 'FTE2');
  assert.equal(employees[2].employeeId, null);
  assert.equal(matched, 2);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].name, 'Totally Unknown Person');
});

// Integration: parse the real HR Ops workbook if it's on this machine.
const REAL = 'C:\\Users\\Pc Force\\Downloads\\KUWAIT MONTHLY SCHEDULE.xlsx';
test('parses the real Kuwait schedule workbook', { skip: !existsSync(REAL) }, () => {
  const parsed = parseScheduleWorkbook(REAL, { periodStart: '2026-09-25', periodEnd: '2026-10-22' });
  assert.ok(parsed.employees.length >= 50, `got ${parsed.employees.length} employees`);
  assert.ok(parsed.periodStart && parsed.periodEnd);
  // at least some employees have real work shifts with times
  const withTimes = parsed.employees.filter(e => Object.values(e.days).some(s => s.type === 'work' && s.start != null));
  assert.ok(withTimes.length >= 20, `only ${withTimes.length} employees had timed shifts`);
  // overnight shifts exist in the data
  const anyOvernight = parsed.employees.some(e => Object.values(e.days).some(s => s.overnight));
  assert.ok(anyOvernight, 'expected at least one overnight scheduled shift');
});

test('buildScheduleIndex links to a roster and returns byEmpId + unmatched', { skip: !existsSync(REAL) }, () => {
  const parsed = parseScheduleWorkbook(REAL, { periodStart: '2026-09-25', periodEnd: '2026-10-22' });
  const roster = parsed.employees.slice(0, 10).map((e, i) => ({ empId: `FTE${i}`, name: e.name }));
  const idx = buildScheduleIndex(REAL, roster, { periodStart: '2026-09-25', periodEnd: '2026-10-22' });
  assert.ok(idx.byEmpId.size >= 5);
  assert.ok(idx.meta.tab);
  assert.ok(Array.isArray(idx.unmatched));
});

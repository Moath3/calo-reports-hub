// Pure attendance/OT engine. Input is already normalized (state: 'in'|'out',
// punchTime parseable by Date). No I/O — adapters do the source-specific mapping.

const MINUTES = 60000;

// Pair consecutive in→out punches; sum the intervals. Any dangling in,
// out-without-in, or in-after-in marks the day incomplete (do not score it).
export function pairPunches(punches) {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.punchTime) - new Date(b.punchTime)
  );
  let workedMinutes = 0;
  let openIn = null;
  let incomplete = false;
  for (const p of sorted) {
    if (p.state === 'in') {
      if (openIn) incomplete = true;
      openIn = p;
    } else if (p.state === 'out') {
      if (!openIn) { incomplete = true; continue; }
      workedMinutes += (new Date(p.punchTime) - new Date(openIn.punchTime)) / MINUTES;
      openIn = null;
    }
  }
  if (openIn) incomplete = true;
  return { workedMinutes: Math.round(workedMinutes), incomplete };
}

// Classify one employee-day. schedule: { status:'work'|'off'|'leave', scheduledMinutes? }
// The roster is the source of truth for off-days; work on a confirmed day off is
// flagged for review and never counted as overtime.
export function classifyDay({ workedMinutes, incomplete }, schedule, config) {
  if (incomplete) {
    return { type: 'incomplete', regular: 0, overtime: 0, flag: 'incomplete_punches' };
  }
  if (schedule.status === 'off' || schedule.status === 'leave') {
    if (workedMinutes > 0) {
      return {
        type: 'review', regular: 0, overtime: 0,
        flag: schedule.status === 'leave' ? 'leave_conflict' : 'worked_on_dayoff',
      };
    }
    return { type: schedule.status, regular: 0, overtime: 0 };
  }
  // scheduled work day
  if (workedMinutes === 0) {
    return { type: 'absent', regular: 0, overtime: 0, flag: 'absent' };
  }
  const std = config.standardDailyMinutes;
  if (workedMinutes > std) {
    return { type: 'present', regular: std, overtime: workedMinutes - std };
  }
  return { type: 'present', regular: workedMinutes, overtime: 0, undertime: std - workedMinutes };
}

// Aggregate an employee's days into period totals + a per-day flag list.
// days: [{ date, punches[], schedule }]
export function computeEmployeePeriod(days, config) {
  let regularMinutes = 0, overtimeMinutes = 0, undertimeMinutes = 0;
  let absentDays = 0, incompleteDays = 0;
  const flags = [];
  for (const day of days) {
    const paired = pairPunches(day.punches || []);
    const c = classifyDay(paired, day.schedule, config);
    regularMinutes += c.regular || 0;
    overtimeMinutes += c.overtime || 0;
    undertimeMinutes += c.undertime || 0;
    if (c.type === 'absent') absentDays += 1;
    if (c.type === 'incomplete') incompleteDays += 1;
    if (c.flag) flags.push({ date: day.date, flag: c.flag });
  }
  return { regularMinutes, overtimeMinutes, undertimeMinutes, absentDays, incompleteDays, flags };
}

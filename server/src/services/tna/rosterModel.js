// Canonical roster row the engine consumes:
// { empId, name, date, status: 'work'|'off'|'leave', shiftStart?, shiftEnd?, scheduledMinutes }
export const SHIFT_CODES = {
  OFF: { status: 'off', scheduledMinutes: 0 },
  '9': { status: 'work', scheduledMinutes: 540 },
  AL:  { status: 'leave', scheduledMinutes: 0 },
  SL:  { status: 'leave', scheduledMinutes: 0 },
};

export function codeToSchedule(code) {
  const key = String(code || '').trim().toUpperCase();
  return SHIFT_CODES[key] || null; // null = unknown code (caller logs an error)
}

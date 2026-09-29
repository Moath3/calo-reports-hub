// Overnight-shift stitching for per-calendar-day attendance exports.
//
// First-In/Last-Out exports aggregate punches per CALENDAR day, so a night
// shift (in 20:00 Sep 8 → out 04:00 Sep 9) arrives split across two rows:
// Sep 8 holds a dangling evening punch and Sep 9 holds a dangling morning
// punch (or, in a run of consecutive night shifts, a bogus 04:00–20:00 span
// that is really "previous shift's out + next shift's in"). Left alone, that
// counts as TWO present days with wrong hours. This module re-joins those
// rows into one working day attributed to the SHIFT-START date.
import { parseMinutes } from './fileLib.js';

// A punch at/after 16:00 can start a night shift; one before 12:00 can end it.
// The gap between them (12:00–16:00) can do neither, which keeps a normal
// 08:00–17:00 day row from ever being mistaken for a shift boundary.
export const EVENING_MIN = 16 * 60;
export const MORNING_MAX = 12 * 60;
// Plausibility window for one stitched session. People work 8–12h shifts;
// under 4h is punch noise, over 16h means a missed punch — don't stitch.
export const MIN_SHIFT_MINUTES = 4 * 60;
export const MAX_SHIFT_MINUTES = 16 * 60;
// A single row spanning 13h+ first-in..last-out is treated as a chain middle
// (out-of-previous-shift + in-of-next), never as one real 13h+ shift.
const SUSPICIOUS_SPAN = 13 * 60;

const nextDay = (ymd) => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// A row is a dangling evening shift-start when its latest punch is in the
// evening and the row carries no real same-day work: a single effective punch
// (first == last, or one side missing) and no positive total.
function eveningStart(rec) {
  const fi = parseMinutes(rec.checkIn), lo = parseMinutes(rec.checkOut);
  const start = lo ?? fi;
  if (start == null || start < EVENING_MIN) return null;
  if (rec._eveningOnly) return start;
  const singlePunch = fi == null || lo == null || fi === lo;
  const noTotal = rec.minutes == null || rec.minutes === 0;
  return singlePunch && noTotal ? start : null;
}

/**
 * Stitch split overnight rows in place. days: Map<ymd, rec> where rec =
 * { date, minutes, checkIn, checkOut } (the runService per-employee shape).
 * Mutates recs (sets minutes/checkOut/stitched, may delete consumed rows).
 * Returns { stitched, removed } counts.
 */
export function stitchOvernightDays(days) {
  let stitched = 0, removed = 0;
  const dates = [...days.keys()].sort();
  for (const date of dates) {
    const A = days.get(date);
    if (!A) continue; // consumed by an earlier stitch
    const B = days.get(nextDay(date));
    if (!B) continue;
    const fiB = parseMinutes(B.checkIn), loB = parseMinutes(B.checkOut);

    // Midnight-split rows: the export cut the shift at 00:00 and computed real
    // partial totals on both sides (Sep 8 20:00–23:59 4:00 + Sep 9 00:00–04:00
    // 4:00). Rejoin by summing the two partial totals.
    const loA = parseMinutes(A.checkOut);
    if (loA != null && loA >= 23 * 60 + 45 && fiB != null && fiB <= 15
      && A.minutes > 0 && B.minutes > 0 && loB != null && loB <= MORNING_MAX
      && A.minutes + B.minutes <= MAX_SHIFT_MINUTES) {
      A.minutes += B.minutes;
      A.checkOut = B.checkOut;
      A.stitched = true;
      days.delete(B.date);
      stitched += 1; removed += 1;
      continue;
    }

    const start = eveningStart(A);
    if (start == null) continue;
    const end = fiB ?? loB;
    if (end == null || end > MORNING_MAX) continue;

    // Next-day row shapes we can consume:
    //  solo      — just the morning out-punch (single punch / no total)
    //  composite — chain middle: morning out + evening in reported as one
    //              implausible 13h+ span (total absent or ≈ the naive span)
    const solo = fiB == null || loB == null || fiB === loB
      || B.minutes == null || B.minutes === 0;
    const span = fiB != null && loB != null ? loB - fiB : 0;
    const composite = !solo && loB >= EVENING_MIN && span >= SUSPICIOUS_SPAN
      && (B.minutes == null || B.minutes === 0 || Math.abs(B.minutes - span) <= 20);
    if (!solo && !composite) continue;

    const session = (24 * 60 - start) + end;
    if (session < MIN_SHIFT_MINUTES || session > MAX_SHIFT_MINUTES) continue;

    const endStr = B.checkIn || B.checkOut;
    A.minutes = session;
    A.checkIn = A.checkOut || A.checkIn; // the evening punch is the shift start
    A.checkOut = endStr;
    A.stitched = true;
    delete A._eveningOnly;
    stitched += 1;

    if (composite) {
      // The evening punch left on B starts the NEXT night's shift — rewrite B
      // as a dangling evening row so the following iteration stitches it too.
      B.checkIn = B.checkOut;
      B.checkOut = '';
      B.minutes = null;
      B._eveningOnly = true;
    } else {
      days.delete(B.date);
      removed += 1;
    }
  }
  // A trailing rewritten row whose morning-out falls outside the export window
  // stays evening-only; drop the marker so it reads as a normal dangling row.
  for (const rec of days.values()) delete rec._eveningOnly;
  return { stitched, removed };
}

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

const shiftDay = (ymd, n) => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nextDay = (ymd) => shiftDay(ymd, 1);
const dayDiff = (a, b) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const fmtHM = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

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

// ── Mispaired (direction-aware) exports — the UAE flavor ─────────────────────
// Some BioTime exports pair each row as [first check-IN of day D] + [last
// check-OUT of day D]. For night staff, this morning's out actually closes
// YESTERDAY's shift, so "Total Time" quietly mixes two different shifts, and
// around off days the previous shift's out shows up as a lone punch that makes
// the off day look worked.
//
// The giveaway, per employee: lone MORNING-OUT rows right after a night row
// AND lone EVENING-IN rows right before a morning-out-bearing row — both
// appear at every off-day boundary in this flavor. The split (min/max) flavor
// never produces them: its dangling rows keep first == last punch instead.
export function isMispairedFormat(days) {
  let outOnly = 0, inOnly = 0;
  for (const rec of days.values()) {
    const fi = parseMinutes(rec.checkIn), lo = parseMinutes(rec.checkOut);
    if (fi == null && lo != null && lo <= MORNING_MAX) {
      const prev = days.get(shiftDay(rec.date, -1));
      const pfi = prev ? parseMinutes(prev.checkIn) : null;
      if (pfi != null && pfi >= EVENING_MIN) outOnly += 1;
    }
    if (fi != null && fi >= EVENING_MIN && lo == null && !rec.minutes) {
      const next = days.get(nextDay(rec.date));
      const nlo = next ? parseMinutes(next.checkOut) : null;
      if (nlo != null && nlo <= MORNING_MAX) inOnly += 1;
    }
  }
  return outOnly >= 1 && inOnly >= 1;
}

/**
 * Re-pair a mispaired employee in place: every check-in is closed by the NEXT
 * morning's check-out, and the working day is the PUNCH-IN date. Lone
 * morning-out rows (shift tails on off days) are deleted — no shift started
 * there. Unclosed check-ins stay as incomplete days for review.
 */
export function repairMispairedDays(days) {
  let stitched = 0, removed = 0;
  let open = null; // { rec, min } — a check-in waiting for its morning out
  const markIncomplete = (rec) => { rec.minutes = null; rec.checkOut = ''; };
  for (const date of [...days.keys()].sort()) {
    const rec = days.get(date);
    const fi = parseMinutes(rec.checkIn), lo = parseMinutes(rec.checkOut);
    if (fi != null) rec.checkIn = fmtHM(fi); // canonicalize fraction cells

    const closesPrev = lo != null && (fi == null || fi > lo);
    if (closesPrev) {
      if (open) {
        const span = dayDiff(open.rec.date, date) * 1440 - open.min + lo;
        if (span >= MIN_SHIFT_MINUTES && span <= MAX_SHIFT_MINUTES) {
          open.rec.minutes = span;
          open.rec.checkOut = fmtHM(lo);
          open.rec.stitched = true;
          stitched += 1;
        } else {
          markIncomplete(open.rec); // implausible pairing — missed punch
        }
        open = null;
      }
      if (fi == null) {
        // Only the morning out: the tail of a shift (or an orphan) — the day
        // itself was not worked. Off days stay clean.
        days.delete(date);
        removed += 1;
        continue;
      }
      markIncomplete(rec); // the out is consumed; tonight's in opens below
    } else if (fi != null && lo != null && fi < lo) {
      // Same-day complete row (day shift) — trust it as-is.
      if (open) markIncomplete(open.rec);
      open = null;
      rec.checkOut = fmtHM(lo);
      if (rec.minutes == null) rec.minutes = lo - fi;
      continue;
    }
    if (fi != null && (lo == null || fi > lo)) {
      if (open) markIncomplete(open.rec); // two ins in a row — first never closed
      open = { rec, min: fi };
    }
  }
  if (open) markIncomplete(open.rec); // shift may end after the export window
  return { stitched, removed, repaired: true };
}

// Entry point for the run service: pick the right treatment per employee.
export function fixOvernightDays(days) {
  return isMispairedFormat(days) ? repairMispairedDays(days) : stitchOvernightDays(days);
}

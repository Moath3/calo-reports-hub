import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stitchOvernightDays, fixOvernightDays, isMispairedFormat } from './overnight.js';
import { parseMinutes } from './fileLib.js';

const daysMap = (recs) => new Map(recs.map((r) => [r.date, { ...r }]));
const rec = (date, checkIn, checkOut, minutes = null) => ({ date, minutes, checkIn, checkOut });

test('split overnight: evening IN row + morning OUT row become one day on the shift-start date', () => {
  // The user's exact case: in 20:00 Sep 8, out 04:00 Sep 9 = ONE 8h day on Sep 8.
  const days = daysMap([
    rec('2026-09-08', '20:00', '20:00', 0),   // export saw a single evening punch
    rec('2026-09-09', '04:00', '04:00', 0),   // and a single morning punch next day
  ]);
  const { stitched, removed } = stitchOvernightDays(days);
  assert.equal(stitched, 1);
  assert.equal(removed, 1);
  assert.equal(days.size, 1);
  const d = days.get('2026-09-08');
  assert.equal(d.minutes, 480);               // 20:00 → 04:00 = 8h
  assert.equal(d.checkIn, '20:00');
  assert.equal(d.checkOut, '04:00');
  assert.equal(d.stitched, true);
});

test('split overnight with blank opposite punches stitches the same way', () => {
  const days = daysMap([
    rec('2026-09-08', '20:00', '', null),
    rec('2026-09-09', '', '04:00', null),
  ]);
  stitchOvernightDays(days);
  assert.equal(days.size, 1);
  assert.equal(days.get('2026-09-08').minutes, 480);
  assert.equal(days.get('2026-09-08').checkOut, '04:00');
});

test('chain of consecutive night shifts: composite middle rows re-attributed one day each', () => {
  // Night worker in 20:00 / out 04:00 every day. The export shows the middle
  // days as a bogus 04:00–20:00 16h span (prev shift's out + next shift's in).
  const days = daysMap([
    rec('2026-09-08', '20:00', '20:00', 0),
    rec('2026-09-09', '04:00', '20:00', 960),
    rec('2026-09-10', '04:00', '20:00', 960),
    rec('2026-09-11', '04:00', '04:00', 0),
  ]);
  const { stitched } = stitchOvernightDays(days);
  assert.equal(stitched, 3);
  assert.deepEqual([...days.keys()].sort(), ['2026-09-08', '2026-09-09', '2026-09-10']);
  for (const d of ['2026-09-08', '2026-09-09', '2026-09-10']) {
    assert.equal(days.get(d).minutes, 480, `${d} should be one 8h shift`);
    assert.equal(days.get(d).checkIn, '20:00');
    assert.equal(days.get(d).checkOut, '04:00');
  }
});

test('midnight-split rows with partial totals are summed onto the start date', () => {
  const days = daysMap([
    rec('2026-09-08', '20:00', '23:59', 239),
    rec('2026-09-09', '00:00', '04:00', 240),
  ]);
  stitchOvernightDays(days);
  assert.equal(days.size, 1);
  const d = days.get('2026-09-08');
  assert.equal(d.minutes, 479);
  assert.equal(d.checkOut, '04:00');
  assert.equal(d.stitched, true);
});

test('normal day rows are never stitched', () => {
  // Complete rows with real totals must pass through untouched — including a
  // 17:00 checkout followed by an 08:00 check-in (NOT an overnight pair).
  const days = daysMap([
    rec('2026-09-08', '08:00', '17:00', 540),
    rec('2026-09-09', '08:00', '17:00', 540),
  ]);
  const { stitched } = stitchOvernightDays(days);
  assert.equal(stitched, 0);
  assert.equal(days.size, 2);
  assert.equal(days.get('2026-09-08').minutes, 540);
});

test('rows without a Total Time column but with two distinct punches are not stitched', () => {
  // No totals in the export at all: a complete 08:00→17:00 day still has two
  // different punches, which is a complete same-day pair, not a dangling one.
  const days = daysMap([
    rec('2026-09-08', '08:00', '17:00', null),
    rec('2026-09-09', '08:00', '17:00', null),
  ]);
  assert.equal(stitchOvernightDays(days).stitched, 0);
  assert.equal(days.size, 2);
});

test('implausibly long stitches are refused (missed punch, not a 17h shift)', () => {
  const days = daysMap([
    rec('2026-09-08', '16:00', '16:00', 0),
    rec('2026-09-09', '11:00', '11:00', 0),  // 19h later — missed a punch somewhere
  ]);
  assert.equal(stitchOvernightDays(days).stitched, 0);
  assert.equal(days.size, 2);
});

test('non-adjacent dates are never stitched', () => {
  const days = daysMap([
    rec('2026-09-08', '20:00', '20:00', 0),
    rec('2026-09-10', '04:00', '04:00', 0),  // a day gap — not the same shift
  ]);
  assert.equal(stitchOvernightDays(days).stitched, 0);
  assert.equal(days.size, 2);
});

test('an afternoon-ending next day row is not consumed as a morning out', () => {
  const days = daysMap([
    rec('2026-09-08', '20:00', '20:00', 0),
    rec('2026-09-09', '13:00', '13:00', 0),  // 13:00 is past the morning cutoff
  ]);
  assert.equal(stitchOvernightDays(days).stitched, 0);
});

// ── Mispaired (UAE) flavor ──────────────────────────────────────────────────

test('mispaired export re-paired: off day cleared, every shift on its punch-in day', () => {
  // Real UAE pattern: each row = tonight's IN + THIS morning's OUT (which
  // belongs to yesterday's shift). Off day (Sep 10) holds only a lone out.
  const days = daysMap([
    rec('2026-09-08', '21:14', '8:04', 649),   // 8:04 closes a pre-window shift
    rec('2026-09-09', '20:50', '8:07', 676),   // 8:07 actually closes Sep 8
    rec('2026-09-10', '', '8:01', null),        // off day: lone out closes Sep 9
    rec('2026-09-11', '22:16', '', null),       // resume: in-only
    rec('2026-09-12', '21:08', '8:01', 653),
    rec('2026-09-13', '', '7:54', null),
  ]);
  const r = fixOvernightDays(days);
  assert.equal(r.repaired, true);
  assert.deepEqual([...days.keys()].sort(), ['2026-09-08', '2026-09-09', '2026-09-11', '2026-09-12']);
  assert.equal(days.get('2026-09-08').minutes, 653);   // 21:14 → 8:07 = 10h53
  assert.equal(days.get('2026-09-09').minutes, 671);   // 20:50 → 8:01 = 11h11
  assert.equal(days.get('2026-09-11').minutes, 585);   // 22:16 → 8:01 = 9h45
  assert.equal(days.get('2026-09-12').minutes, 646);   // 21:08 → 7:54 = 10h46
  assert.equal(days.get('2026-09-08').checkOut, '8:07');
  assert.equal(days.get('2026-09-08').stitched, true);
});

test('mispaired export: inflated total replaced by the true shift length (fake OT killed)', () => {
  const days = daysMap([
    rec('2026-09-23', '20:49', '8:00', 671),
    rec('2026-09-24', '19:51', '8:13', 741),   // export claims 12:21 — fake OT
    rec('2026-09-25', '', '5:31', null),        // the REAL out: 19:51 → 5:31
    rec('2026-09-26', '19:00', '', null),
    rec('2026-09-27', '', '5:00', null),
  ]);
  fixOvernightDays(days);
  assert.equal(days.get('2026-09-24').minutes, 580);   // 9h40, not 12h21
});

test('mispaired export: same-day day-shift rows pass through untouched', () => {
  const days = daysMap([
    rec('2026-09-24', '19:51', '8:13', 741),
    rec('2026-09-25', '', '5:31', null),
    rec('2026-09-26', '6:54', '17:26', 632),   // moved to day shift
    rec('2026-09-27', '21:00', '', null),       // back to nights
    rec('2026-09-28', '', '5:00', null),
  ]);
  const r = fixOvernightDays(days);
  assert.equal(r.repaired, true);
  assert.equal(days.get('2026-09-26').minutes, 632);
  assert.equal(days.get('2026-09-26').stitched, undefined);
  assert.equal(days.get('2026-09-27').minutes, 480);   // 21:00 → 5:00
});

test('KSA split rows are NOT mistaken for the mispaired format', () => {
  const days = daysMap([
    rec('2026-09-08', '20:00', '20:00', 0),
    rec('2026-09-09', '04:00', '04:00', 0),
  ]);
  assert.equal(isMispairedFormat(days), false);
  const r = fixOvernightDays(days);           // falls through to the stitcher
  assert.ok(!r.repaired);
  assert.equal(days.get('2026-09-08').minutes, 480);
});

test('normal day workers are NOT detected as mispaired', () => {
  const days = daysMap([
    rec('2026-09-08', '08:00', '17:00', 540),
    rec('2026-09-09', '08:00', '17:00', 540),
  ]);
  assert.equal(isMispairedFormat(days), false);
});

test('parseMinutes reads raw Excel time fractions', () => {
  assert.equal(parseMinutes(0.70972222222222), 1022);  // 17:02
  assert.equal(parseMinutes('0.5'), 720);
  assert.equal(parseMinutes('8:30'), 510);
  assert.equal(parseMinutes(''), null);
});

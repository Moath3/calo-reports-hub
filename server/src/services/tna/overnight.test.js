import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stitchOvernightDays } from './overnight.js';

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

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

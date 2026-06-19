// Sørensen–Dice coefficient over character bigrams. Robust for name typos and
// word-order (callers token-sort via normalizeName first). Returns 0..1.
export function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const A = bigrams(a), B = bigrams(b);
  let overlap = 0;
  for (const [bg, c] of A) if (B.has(bg)) overlap += Math.min(c, B.get(bg));
  return (2 * overlap) / ((a.length - 1) + (b.length - 1));
}

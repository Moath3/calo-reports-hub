// Known cross-system entity aliases (Masterfile / Zelt / BioTime use different
// names for the same legal entity). Extend as Rathi/Finance confirm GCC aliases.
const ALIAS_GROUPS = [
  ['luqmat', 'mp ksa', 'mountain peak ksa', 'basecamp ksa'],
];
const TO_CANONICAL = new Map();
for (const group of ALIAS_GROUPS) {
  const canonical = group[0];
  for (const name of group) TO_CANONICAL.set(name, canonical);
}
const norm = (e) => String(e == null ? '' : e).trim().toLowerCase();

export function canonicalEntity(entity) {
  const n = norm(entity);
  return TO_CANONICAL.get(n) || n;
}
export function sameEntity(a, b) {
  return canonicalEntity(a) === canonicalEntity(b);
}

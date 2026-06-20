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

// Map any entity / department / location / country string to a GCC country code.
// Used to select the per-country OT threshold (UAE 10h vs KSA/KWT/BHR 9h).
// First match wins; returns null when nothing is recognized (caller decides).
const COUNTRY_PATTERNS = [
  ['UAE', /\buae\b|u\.a\.e|united\s*arab|emirat|dubai|abu\s*dhabi|sharjah|ajman/i],
  ['KSA', /\bksa\b|saudi|riyadh|jeddah|jaddah|dammam|khobar|makkah|mecca|madinah|medina|luqmat|\bmp\s*ksa\b|basecamp\s*ksa/i],
  ['KWT', /\bkwt\b|kuwait/i],
  ['BHR', /\bbhr\b|bahrain|manama|\bbh\b/i],
];
export function resolveCountry(text) {
  const s = String(text == null ? '' : text);
  for (const [code, re] of COUNTRY_PATTERNS) if (re.test(s)) return code;
  return null;
}

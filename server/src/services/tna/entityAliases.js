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

// Map any entity / department / location / country string to a GCC country code,
// to select the per-country OT threshold (UAE 10h vs KSA/KWT/BHR 9h).
//
// STRONG signals are explicit country codes, full country names and canonical
// brand aliases; BROAD adds cities/emirates/regions on top. On a clean
// single-country string this is just a match. When a string names more than one
// country (a contaminated cell), we never silently pick UAE (the only 10h rule):
// a unique strong signal wins, else we fall back to a 9h country so the safe
// payroll default is to count MORE overtime, not less.
const STRONG_PATTERNS = [
  ['UAE', /\buae\b|u\.a\.e|united\s*arab/i],
  ['KSA', /\bksa\b|saudi|luqmat|\bmp\s*ksa\b|basecamp\s*ksa/i],
  ['KWT', /\bkwt\b|kuwait/i],
  ['BHR', /\bbhr\b|bahrain/i],
];
const COUNTRY_PATTERNS = [
  ['UAE', /\buae\b|u\.a\.e|united\s*arab|emirat|dubai|abu\s*dhabi|\bauh\b|sharjah|ajman|ras\s*al\s*khaimah|\brak\b|fujairah|umm\s*al\s*quwain|\buaq\b|al\s*ain/i],
  ['KSA', /\bksa\b|saudi|luqmat|\bmp\s*ksa\b|basecamp\s*ksa|riyadh|jeddah|jaddah|dammam|khobar|makkah|mecca|madinah|medina|tabuk|buraidah|qassim|yanbu|jubail|hofuf|abha/i],
  ['KWT', /\bkwt\b|kuwait/i],
  ['BHR', /\bbhr\b|bahrain|manama|\briffa\b|muharraq/i],
];
export function resolveCountry(text) {
  const s = String(text == null ? '' : text);
  const matched = [...new Set(COUNTRY_PATTERNS.filter(([, re]) => re.test(s)).map(([c]) => c))];
  if (matched.length <= 1) return matched[0] || null;
  const strong = [...new Set(STRONG_PATTERNS.filter(([, re]) => re.test(s)).map(([c]) => c))];
  if (strong.length === 1) return strong[0];
  return matched.find((c) => c !== 'UAE') || matched[0]; // ambiguous: prefer a 9h country
}

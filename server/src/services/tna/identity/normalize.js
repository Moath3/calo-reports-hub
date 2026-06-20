export function normalizeId(id) {
  if (id == null) return '';
  const s = String(id).trim().toUpperCase().replace(/\s+/g, '');
  // strip leading zeros ONLY for purely numeric ids ('00123' -> '123'), so
  // zero-padding still compares across systems while alphanumeric ids keep
  // their stem and distinct ids never collide ('A07' != 'A7', 'FTE0001' != 'FTE1').
  return /^\d+$/.test(s) ? s.replace(/^0+(\d)/, '$1') : s;
}

export function normalizeName(name) {
  if (name == null) return '';
  const cleaned = String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')                      // punctuation removed (joins hyphenated names; spaces preserved by \s)
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').filter(Boolean).sort().join(' '); // token-sort
}

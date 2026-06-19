export function normalizeId(id) {
  if (id == null) return '';
  const s = String(id).trim().toUpperCase().replace(/\s+/g, '');
  // strip zeros that lead the numeric run, so ids compare across systems
  // ('A07' -> 'A7', '00123' -> '123', '101' -> '101')
  return s.replace(/(^|\D)0+(\d)/g, '$1$2');
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

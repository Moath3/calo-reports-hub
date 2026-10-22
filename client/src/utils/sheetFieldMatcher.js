// Fuzzy header resolver: given target fields (label + spellings) and a sheet's
// header row, find which column each field is in, wherever it sits and however it
// is spelled. Returns a per-field match with a confidence score so the UI can show
// and let the user override low-confidence guesses. Pure — no browser deps.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);

// Best score in [0,1] between one target and one header string.
function scoreOne(target, header) {
  const h = norm(header);
  if (!h) return 0;
  const cands = [target.label, ...(target.synonyms || [])].map(norm).filter(Boolean);
  const hTokens = new Set(tokens(header));
  let best = 0;
  for (const c of cands) {
    if (!c) continue;
    if (h === c) return 1;
    if (h.includes(c) || c.includes(h)) { best = Math.max(best, 0.85); continue; }
    const ct = tokens(c);
    if (ct.length) {
      const inter = ct.filter((t) => hTokens.has(t)).length;
      const dice = (2 * inter) / (ct.length + hTokens.size);
      best = Math.max(best, dice);
    }
  }
  return best;
}

// targets: [{ key, label, synonyms?: [] }]; headers: string[].
// Greedy, highest-confidence assignment first so a strong match claims its column
// before a weaker field can steal it. Returns { [key]: {header,index,score}|null }.
export function matchHeaders(headers, targets, { threshold = 0.5 } = {}) {
  const cells = [];
  targets.forEach((t) => headers.forEach((h, i) => {
    const score = scoreOne(t, h);
    if (score >= threshold) cells.push({ key: t.key, index: i, header: h, score });
  }));
  cells.sort((a, b) => b.score - a.score);
  const out = Object.fromEntries(targets.map((t) => [t.key, null]));
  const usedCols = new Set();
  const usedKeys = new Set();
  for (const c of cells) {
    if (usedKeys.has(c.key) || usedCols.has(c.index)) continue;
    out[c.key] = { header: c.header, index: c.index, score: Math.round(c.score * 100) / 100 };
    usedKeys.add(c.key);
    usedCols.add(c.index);
  }
  return out;
}

// Compliance fields the HR team needs read out of the KSA/UAE masterfiles. Spellings
// cover what the sheets actually use; the UI lets the user add/override.
export const COMPLIANCE_FIELDS = [
  { key: 'employeeId', label: 'Employee ID', synonyms: ['emp id', 'fte', 'employee number', 'staff id', 'empl id', 'id number'] },
  { key: 'name', label: 'Name', synonyms: ['full name', 'employee name', 'staff name'] },
  { key: 'nationality', label: 'Nationality', synonyms: ['nation', 'citizenship'] },
  { key: 'agency', label: 'Agency', synonyms: ['sponsor', 'manpower', 'manpower agency', 'vendor', 'supplier', 'supplied by'] },
  { key: 'iqamaExpiry', label: 'Iqama Expiry', synonyms: ['iqama expiry date', 'iqama exp', 'iqama expiration', 'residence permit expiry', 'residency expiry'] },
  { key: 'visaExpiry', label: 'Visa Expiry', synonyms: ['visa expiry date', 'visa exp', 'visa expiration'] },
  { key: 'permitExpiry', label: 'Work Permit Expiry', synonyms: ['work permit expiry', 'labour card expiry', 'labor card expiry', 'lc expiry', 'work permit exp'] },
  { key: 'passportExpiry', label: 'Passport Expiry', synonyms: ['passport expiry date', 'passport exp', 'passport expiration'] },
  { key: 'eidExpiry', label: 'Emirates ID Expiry', synonyms: ['eid expiry', 'emirates id expiry', 'emirates id exp', 'eid exp', 'national id expiry'] },
];

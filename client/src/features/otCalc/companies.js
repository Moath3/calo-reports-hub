// Calo entities for the OT calculator — currency + decimals drive money
// formatting, `tab` pins which sheet of the salary master to use (blank = any
// sheet that has an ID + Basic column). Ported from the standalone calculator.
export const COMPANIES = [
  { key: 'ksa-mp', name: 'Calo KSA MP', cur: 'SAR', dec: 2, tab: '' },
  { key: 'ksa-retail', name: 'Calo KSA Retail', cur: 'SAR', dec: 2, tab: '' },
  { key: 'uae-mp', name: 'Calo UAE MP', cur: 'AED', dec: 2, tab: 'Calo UAE MP' },
  { key: 'uae-retail', name: 'Calo UAE Retail', cur: 'AED', dec: 2, tab: 'Calo UAE Retail' },
  { key: 'bh-mp', name: 'Calo Bahrain MP', cur: 'BHD', dec: 3, tab: '' },
  { key: 'bh-retail', name: 'Calo Bahrain Retail', cur: 'BHD', dec: 3, tab: '' },
  { key: 'kw-mp', name: 'Calo Kuwait MP', cur: 'KWD', dec: 3, tab: '' },
  { key: 'qa-mp', name: 'Calo Qatar MP', cur: 'QAR', dec: 2, tab: '' },
  { key: 'om-mp', name: 'Calo Oman MP', cur: 'OMR', dec: 3, tab: '' },
];

export const DEFAULT_COMPANY = COMPANIES[0].key;

export function companyByKey(k) { return COMPANIES.find((c) => c.key === k) || COMPANIES[0]; }

export function fmtMoney(n, dec = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

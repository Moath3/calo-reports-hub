// OT policy config. TEMPORARY (2026-10-06, per request): a FLAT 9h/day OT
// threshold for ALL countries. The per-country map is kept below so the UAE 10h
// rule can be restored by flipping one line. The threshold is keyed by country
// code (resolved from any entity / department / location string), so a
// mixed-country run can still differ per employee once re-enabled. Phase-2
// statutory rules (Friday/holiday rate, Ramadan reduced hours, weekly caps)
// attach here without touching the engine.
import { resolveCountry } from './entityAliases.js';

export const DEFAULT_OT_CONFIG = {
  standardDailyMinutes: 540, // 9 hours — current flat rule for every country
  country: null,
};

// Daily standard before overtime, by country code. FLAT 9h for now.
// To restore the statutory UAE rule, set UAE back to 600 (10 hours).
const OT_BY_COUNTRY = {
  UAE: { standardDailyMinutes: 540 }, // 9h for now (was 10h / 600)
  KSA: { standardDailyMinutes: 540 }, // 9 hours
  KWT: { standardDailyMinutes: 540 }, // 9 hours
  BHR: { standardDailyMinutes: 540 }, // 9 hours
};

// entityOrCountry: a country code ('UAE') or any string we can resolve a country
// from ('CALO UAE - Dispatch', 'Riyadh Kitchen', 'Luqmat'). Unknown -> 9h default.
export function getOtConfig(entityOrCountry) {
  const country = resolveCountry(entityOrCountry);
  return { ...DEFAULT_OT_CONFIG, ...(OT_BY_COUNTRY[country] || {}), country };
}

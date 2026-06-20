// OT policy config. The daily-OT threshold is per country: UAE counts overtime
// after 10 hours; KSA, Kuwait and Bahrain after 9 hours. The threshold is keyed
// by country code (resolved from any entity / department / location string), so
// a mixed-country run picks the right rule per employee. Phase-2 statutory rules
// (Friday/holiday rate, Ramadan reduced hours, weekly caps) attach here without
// touching the engine.
import { resolveCountry } from './entityAliases.js';

export const DEFAULT_OT_CONFIG = {
  standardDailyMinutes: 540, // 9 hours — the GCC norm (KSA, Kuwait, Bahrain)
  country: null,
};

// Daily standard before overtime, by country code.
const OT_BY_COUNTRY = {
  UAE: { standardDailyMinutes: 600 }, // 10 hours
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

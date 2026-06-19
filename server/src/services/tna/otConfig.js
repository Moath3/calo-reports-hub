// OT policy config. v1 is uniform across all GCC entities: a 9-hour standard
// day; worked time beyond that on a scheduled workday is overtime. The
// per-entity override hook is where phase-2 statutory rules (Friday/holiday
// rate, Ramadan reduced hours, weekly caps) will attach without touching the engine.
export const DEFAULT_OT_CONFIG = {
  standardDailyMinutes: 540, // 9 hours
};

const ENTITY_OT_CONFIG = {
  // 'Some Entity': { standardDailyMinutes: 480 },
};

export function getOtConfig(entity) {
  return { ...DEFAULT_OT_CONFIG, ...(ENTITY_OT_CONFIG[entity] || {}) };
}

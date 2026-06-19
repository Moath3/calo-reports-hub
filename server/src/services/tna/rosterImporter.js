// Thin wrapper: run a per-dept/region normalizer over the parsed sheet (aoa)
// and return the canonical roster + a flat error list. Swap the normalizer per
// sheet format; the canonical output is the stable contract the pipeline uses.
export function importRoster(aoa, normalizer) {
  const { rows, errors } = normalizer(aoa);
  return { roster: rows, errors };
}

import { normalizeId, normalizeName } from './normalize.js';
import { diceCoefficient } from './similarity.js';
import { sameEntity } from '../entityAliases.js';

const NAME_MATCH = 0.85;      // confirm an id match
const NAME_PROPOSE = 0.90;    // propose a name-only match (stricter)

// Join BioTime employees to Masterfile + Zelt. Primary key: employee id.
// Name similarity confirms id matches and recovers id-less ones — but a
// name-only match is only ever *proposed* (review), never auto-merged.
export function resolveIdentities({ bioEmployees, masterfile = [], zelt = [] }) {
  const byId = (list) => {
    const m = new Map();
    for (const r of list) m.set(normalizeId(r.empId), r);
    return m;
  };
  const mfById = byId(masterfile);
  const zById = byId(zelt);

  const matched = [], review = [], unmatched = [];

  for (const bioEmp of bioEmployees) {
    const id = normalizeId(bioEmp.empCode);
    const bioName = normalizeName(bioEmp.name);
    const mf = mfById.get(id);
    const z = zById.get(id);

    if (mf || z) {
      // id matched in at least one source — confirm by name
      const ref = mf || z;
      const sim = diceCoefficient(bioName, normalizeName(ref.name));
      if (sim >= NAME_MATCH) {
        matched.push({ empCode: bioEmp.empCode, bio: bioEmp, masterfile: mf || null, zelt: z || null, nameSim: sim });
      } else {
        review.push({ empCode: bioEmp.empCode, bio: bioEmp, candidate: ref, nameSim: sim, reason: 'id_name_mismatch' });
      }
      continue;
    }

    // no id match — try to recover by name within the same entity
    let best = null;
    for (const cand of [...masterfile, ...zelt]) {
      if (!sameEntity(bioEmp.entity, cand.entity)) continue;
      const sim = diceCoefficient(bioName, normalizeName(cand.name));
      if (!best || sim > best.sim) best = { cand, sim };
    }
    if (best && best.sim >= NAME_PROPOSE) {
      review.push({ empCode: bioEmp.empCode, bio: bioEmp, candidate: best.cand, nameSim: best.sim, reason: 'name_only_match' });
    } else {
      unmatched.push({ empCode: bioEmp.empCode, bio: bioEmp });
    }
  }
  return { matched, review, unmatched };
}

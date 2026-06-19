import { computeEmployeePeriod } from './otEngine.js';
import { getOtConfig } from './otConfig.js';
import { importRoster } from './rosterImporter.js';
import { resolveIdentities } from './identity/resolver.js';
import { normalizeId } from './identity/normalize.js';
import { flagAccuracy } from './accuracy.js';

function eachDate(start, end) {
  const out = []; const d = new Date(start + 'T00:00:00Z'); const last = new Date(end + 'T00:00:00Z');
  while (d <= last) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// Pure orchestration. All inputs are plain data (adapters fetch/parse upstream).
export function runTnaPeriod({ period, bioEmployees, punches, rosterAoa, normalizer, masterfile, zelt }) {
  const { roster, errors: rosterErrors } = importRoster(rosterAoa, normalizer);

  const identity = resolveIdentities({ bioEmployees, masterfile, zelt });

  // index punches + roster by normalized id
  const punchesByEmp = new Map();
  for (const p of punches) {
    const id = normalizeId(p.empCode);
    if (!punchesByEmp.has(id)) punchesByEmp.set(id, []);
    punchesByEmp.get(id).push(p);
  }
  const rosterByEmp = new Map();
  for (const r of roster) {
    const id = normalizeId(r.empId);
    if (!rosterByEmp.has(id)) rosterByEmp.set(id, new Map());
    rosterByEmp.get(id).set(r.date, r);
  }

  const dates = eachDate(period.start, period.end);
  const summaries = [];
  for (const m of identity.matched) {
    const id = normalizeId(m.empCode);
    const empPunches = punchesByEmp.get(id) || [];
    const sched = rosterByEmp.get(id) || new Map();
    const days = dates.map(date => ({
      date,
      punches: empPunches.filter(p => String(p.punchTime).slice(0, 10) === date),
      schedule: sched.get(date) || { status: 'off' }, // no roster entry = treat as off (flagged if worked)
    }));
    const entity = m.masterfile?.entity || m.zelt?.entity || m.bio.entity;
    const period = computeEmployeePeriod(days, getOtConfig(entity));
    summaries.push({ empCode: m.empCode, name: m.bio.name, entity, ...period });
  }

  const accuracyFlags = flagAccuracy({
    unmatched: identity.unmatched,
    punchedEmpCodes: new Set(punches.map(p => p.empCode)),
    rosterEmpIds: new Set(roster.map(r => normalizeId(r.empId))),
    matchedEmpIds: new Set(identity.matched.map(m => normalizeId(m.empCode))),
  });

  return { summaries, review: identity.review, unmatched: identity.unmatched, accuracyFlags, rosterErrors };
}

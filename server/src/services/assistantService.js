// Read-only natural-language data assistant over the live Zelt datasets.
// The AI only PLANS (which dataset + which filters); the server executes the plan
// deterministically, so every number comes from Zelt, never the model. Salary stays
// admin-only because the plan runs through runReport's own role scrub.
import { runReport, runHeadcount, getDimensions } from './zeltReport.js';
import { getMobility } from './zeltMobility.js';
import { callAI, extractJSON, getAvailableProviders } from './aiService.js';

const DATASETS = {
  roster: 'People roster — any list/count of staff, with filters, grouping, leave balances, and (admin only) salary. Use for "who / how many" people questions.',
  headcount: 'Official headcount (clean roster, test/ghost accounts removed). Supports a point-in-time month via asOf "2026-MM". Ignores filters.',
  turnover: 'Mobility / turnover over the rolling 12 months: leavers, turnover %, and breakdowns by org / business line / department.',
};

const FILTER_KEYS = ['entities', 'departments', 'businessLines', 'orgs', 'jobFamilies', 'workCountries', 'sites'];
const GROUP_FIELDS = ['businessLine', 'department', 'entity', 'org'];
const ROSTER_DEFAULT_FIELDS = ['name', 'jobTitle', 'department', 'entity', 'businessLine', 'org', 'accountStatus'];
const ROW_CAP = 500;

const cap = (arr) => (arr.length > ROW_CAP ? { rows: arr.slice(0, ROW_CAP), capped: true } : { rows: arr, capped: false });
const aggKey = (g) => 'by' + g.charAt(0).toUpperCase() + g.slice(1); // businessLine -> byBusinessLine
const cols = (keys) => keys.map((k) => ({ key: k, label: k }));
const fmt = (v) => (typeof v === 'number' ? v.toLocaleString() : String(v ?? ''));

async function dimensions() {
  const d = await getDimensions();
  if (!d.ready) { const e = new Error('People index is still building — try again in a moment.'); e.code = 'INDEX_BUILDING'; throw e; }
  return d.dimensions;
}

// Map the model's filter values onto the exact dimension strings (case-insensitive),
// dropping anything that doesn't exist so a mis-read filter can't silently skew a count.
function normalizeFilters(filters = {}, dims = {}) {
  const out = {}; const dropped = [];
  for (const key of FILTER_KEYS) {
    const vals = Array.isArray(filters[key]) ? filters[key] : [];
    if (!vals.length) continue;
    const canon = new Map((dims[key] || []).map((d) => [String(d).toLowerCase(), d]));
    const keep = [];
    for (const v of vals) {
      const hit = canon.get(String(v).toLowerCase());
      if (hit) keep.push(hit); else dropped.push(`${key}:${v}`);
    }
    if (keep.length) out[key] = keep;
  }
  return { filters: out, dropped };
}

function plannerPrompt(dims, isAdmin) {
  const list = (a = []) => (a.length ? a.slice(0, 60).join(', ') + (a.length > 60 ? `, …(+${a.length - 60})` : '') : '(none)');
  return `You translate an HR data question into a JSON query plan. You NEVER answer with numbers — a separate system runs the query and returns the real data. Pick ONE dataset and the filters/options that best fit the question.

DATASETS:
${Object.entries(DATASETS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

FILTER VALUES (use the EXACT strings below; each filter is an array; omit a filter that wasn't asked for):
- entities: ${list(dims.entities)}
- departments: ${list(dims.departments)}
- businessLines: ${list(dims.businessLines)}
- orgs: ${list(dims.orgs)}
- jobFamilies: ${list(dims.jobFamilies)}
- workCountries: ${list(dims.workCountries)}
- sites: ${list(dims.sites)}

Return STRICT JSON only, no prose, no code fences:
{"dataset":"roster|headcount|turnover|null",
 "filters":{"entities":[],"departments":[],"businessLines":[],"orgs":[],"jobFamilies":[],"workCountries":[],"sites":[]},
 "fields":["name","jobTitle","department","entity","businessLine","org","accountStatus","startDate","email","annualBalance","compensatoryBalance"${isAdmin ? ',"salaryMonthly","currency"' : ''}],
 "groupBy":"businessLine|department|entity|org|null",
 "view":"summary|leavers|byOrg|byBusinessLine|byDept|null",
 "asOf":"2026-MM|null",
 "note":"one short line on how you read the question",
 "reply":"only when dataset is null: a short reply saying what you CAN pull"}

RULES:
- roster: set "fields" (default ${JSON.stringify(ROSTER_DEFAULT_FIELDS)}). For "by X" / "breakdown" / "per X" / "how many in each", set "groupBy" (only the group + count is returned).
- turnover: set "view" (default "summary"); use "leavers" for "who left".
- headcount: set "asOf" for a past month ("2026-MM"), else null for current.
${isAdmin ? '- Salary fields allowed (this user is an admin).' : '- NEVER include salary/pay fields; this user is not an admin.'}
- If the question is not about people data, set dataset to null and fill "reply".`;
}

export async function planQuery(question, history = [], isAdmin = false) {
  if (!getAvailableProviders().length) { const e = new Error('AI provider not configured (set CLAUDE_API_KEY).'); e.code = 'NO_AI'; throw e; }
  const dims = await dimensions();
  const convo = (history || []).slice(-6).map((m) => `${m.role === 'assistant' ? 'A' : 'Q'}: ${m.content}`).join('\n');
  const user = (convo ? convo + '\n' : '') + 'Q: ' + String(question || '').slice(0, 1000);
  const r = await callAI(undefined, plannerPrompt(dims, isAdmin), user, { requestType: 'assistant-plan', maxTokens: 700 });
  const plan = extractJSON(r.text);
  if (!plan || typeof plan !== 'object') { const e = new Error('Could not understand the question — try rephrasing.'); e.code = 'NO_PLAN'; throw e; }
  return plan;
}

export async function runPlan(plan, isAdmin = false) {
  const dims = await dimensions();
  const { filters, dropped } = normalizeFilters(plan.filters, dims);
  if (plan.dataset === 'roster') return rosterResult(plan, filters, dropped, isAdmin);
  if (plan.dataset === 'headcount') return headcountResult(plan, dropped);
  if (plan.dataset === 'turnover') return turnoverResult(plan, filters, dropped);
  const e = new Error('No dataset selected.'); e.code = 'NO_DATASET'; throw e;
}

function summaryFromAgg(agg) {
  const s = [{ label: 'Headcount', value: agg.headcount }];
  if (agg.annualBalance) s.push({ label: 'Avg annual leave', value: `${agg.annualBalance.avgDays}d` });
  if (agg.compensatoryBalance) s.push({ label: 'Avg comp', value: `${agg.compensatoryBalance.avgDays}d` });
  for (const x of agg.salary || []) s.push({ label: `Payroll ${x.currency}/mo`, value: x.totalMonthly.toLocaleString() });
  return s;
}

async function rosterResult(plan, filters, dropped, isAdmin) {
  const fields = Array.isArray(plan.fields) && plan.fields.length ? plan.fields : ROSTER_DEFAULT_FIELDS;
  const res = await runReport({ filters, fields, isAdmin });
  const notes = [];
  if (dropped.length) notes.push(`Ignored unknown filters: ${dropped.join(', ')}`);
  if (res.sensitiveDenied) notes.push('Salary columns hidden (admin only).');
  const source = `Zelt live roster index · index ${res.indexAgeMinutes}m old`;

  if (plan.groupBy && GROUP_FIELDS.includes(plan.groupBy)) {
    const groups = res.aggregates[aggKey(plan.groupBy)] || [];
    const { rows, capped } = cap(groups.map((g) => ({ [plan.groupBy]: g.key, count: g.count })));
    return { columns: cols([plan.groupBy, 'count']), rows, total: groups.length, capped,
      summary: [{ label: 'Total', value: res.count }], source, asOf: res.generatedAt, notes };
  }
  const { rows, capped } = cap(res.rows);
  return { columns: cols(res.fields), rows, total: res.count, capped,
    summary: summaryFromAgg(res.aggregates), source, asOf: res.generatedAt, notes };
}

async function headcountResult(plan, dropped) {
  const asOf = /^2026-(0[1-9]|1[0-2])$/.test(plan.asOf || '') ? plan.asOf : null;
  const res = await runHeadcount(asOf);
  const { rows, capped } = cap(res.rows);
  const notes = dropped.length ? [`Ignored unknown filters: ${dropped.join(', ')}. Headcount ignores filters — use the roster dataset to filter.`] : [];
  return {
    columns: cols(['employeeId', 'name', 'position', 'department', 'businessLine', 'org', 'startDate']),
    rows, total: res.count, capped,
    summary: [{ label: asOf ? `Headcount ${asOf}` : 'Headcount now', value: res.count }],
    source: `Zelt headcount roster${asOf ? ` · as of ${asOf}` : ''} · index ${res.indexAgeMinutes}m old`,
    asOf: res.generatedAt, notes,
  };
}

async function turnoverResult(plan, filters, dropped) {
  const m = await getMobility(false, filters);
  const notes = dropped.length ? [`Ignored unknown filters: ${dropped.join(', ')}`] : [];
  const asOf = m.asOf || new Date().toISOString();
  const source = 'Zelt mobility · rolling 12 months';
  const summary = Object.entries(m.totals || {}).slice(0, 4).map(([k, v]) => ({ label: k, value: fmt(v) }));

  if (plan.view === 'leavers') {
    const leavers = Array.isArray(m.leavers) ? m.leavers : [];
    const keys = leavers.length ? Object.keys(leavers[0]).filter((k) => !k.startsWith('_')) : ['name', 'date'];
    const { rows, capped } = cap(leavers);
    return { columns: cols(keys), rows, total: leavers.length, capped,
      summary: [{ label: 'Leavers (12m)', value: leavers.length }], source, asOf, notes };
  }
  const byView = { byOrg: 'byOrg', byBusinessLine: 'byBusinessLine', byDept: 'byDept' };
  if (byView[plan.view] && Array.isArray(m[byView[plan.view]])) {
    const groups = m[byView[plan.view]].map((g) => (g && g.key != null ? { group: g.key, count: g.count ?? g.leavers ?? 0 } : g));
    const { rows, capped } = cap(groups);
    return { columns: cols(rows.length ? Object.keys(rows[0]) : ['group', 'count']), rows, total: groups.length, capped,
      summary, source, asOf, notes };
  }
  // summary view: the totals object as metric/value rows
  const rows = Object.entries(m.totals || {}).map(([metric, value]) => ({ metric, value: fmt(value) }));
  return { columns: cols(['metric', 'value']), rows, total: rows.length, capped: false, summary, source, asOf, notes };
}

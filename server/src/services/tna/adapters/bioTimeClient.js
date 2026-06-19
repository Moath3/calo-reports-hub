// BioTime (ZKTeco) API adapter. All HTTP goes through an injected fetchFn so
// unit tests run against fakes — no live calls in the suite.

// ZKTeco punch_state codes. in = arriving/returning; out = leaving.
const IN_STATES = new Set(['0', '3', '4']);   // Check-In, Break-In, OT-In
const OUT_STATES = new Set(['1', '2', '5']);  // Check-Out, Break-Out, OT-Out

export function mapPunchState(state) {
  const s = String(state);
  if (IN_STATES.has(s)) return 'in';
  if (OUT_STATES.has(s)) return 'out';
  return null;
}

export function mapTransaction(raw) {
  return {
    empCode: String(raw.emp_code),
    punchTime: raw.punch_time,
    state: mapPunchState(raw.punch_state),
  };
}

export async function authenticate({ baseUrl, username, password }, fetchFn = fetch) {
  const res = await fetchFn(`${baseUrl}/jwt-api-token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`BioTime auth failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { token } = await res.json();
  if (!token) throw new Error('BioTime auth returned no token');
  return token;
}

const DEFAULT_PAGE_SIZE = 500;

// Generic paged GET. Sends Authorization: JWT <token>; follows `next` (or stops
// when a page returns no rows). Returns the concatenated `data` arrays.
export async function fetchAllPages(baseUrl, path, params, token, fetchFn = fetch) {
  const out = [];
  let page = 1;
  for (;;) {
    const qs = new URLSearchParams({ ...params, page: String(page), page_size: String(params.page_size || DEFAULT_PAGE_SIZE) });
    const res = await fetchFn(`${baseUrl}${path}?${qs}`, { headers: { Authorization: `JWT ${token}` } });
    if (!res.ok) throw new Error(`BioTime ${path} failed: ${res.status}`);
    const body = await res.json();
    const data = body.data || [];
    out.push(...data);
    if (!body.next || data.length === 0) break;
    page += 1;
  }
  return out;
}

export async function fetchTransactions({ baseUrl }, { startTime, endTime, token }, fetchFn = fetch) {
  const raw = await fetchAllPages(baseUrl, '/iclock/api/transactions/',
    { start_time: startTime, end_time: endTime }, token, fetchFn);
  return raw.map(mapTransaction).filter((t) => t.state !== null);
}

export async function fetchEmployees({ baseUrl }, token, fetchFn = fetch) {
  const raw = await fetchAllPages(baseUrl, '/personnel/api/employees/', {}, token, fetchFn);
  return raw.map((e) => ({
    empCode: String(e.emp_code),
    name: [e.first_name, e.last_name].filter(Boolean).join(' ').trim(),
    entity: e.department?.dept_name || null,
  }));
}

// Authenticate once, then pull the punch window + employee list in the shape
// runTnaPeriod() consumes ({ punches, bioEmployees }).
export async function loadBioTimeSources(config, { startTime, endTime }, fetchFn = fetch) {
  const token = await authenticate(config, fetchFn);
  const [punches, bioEmployees] = await Promise.all([
    fetchTransactions(config, { startTime, endTime, token }, fetchFn),
    fetchEmployees(config, token, fetchFn),
  ]);
  return { punches, bioEmployees };
}

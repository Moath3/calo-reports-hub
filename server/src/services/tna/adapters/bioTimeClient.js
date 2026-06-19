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

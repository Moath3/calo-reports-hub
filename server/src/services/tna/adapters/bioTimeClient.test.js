import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPunchState, mapTransaction } from './bioTimeClient.js';

test('maps in/out punch states', () => {
  assert.equal(mapPunchState('0'), 'in');   // Check In
  assert.equal(mapPunchState('1'), 'out');  // Check Out
  assert.equal(mapPunchState('3'), 'in');   // Break In
  assert.equal(mapPunchState('2'), 'out');  // Break Out
  assert.equal(mapPunchState('9'), null);   // unknown
});

test('maps a raw BioTime transaction to the engine shape', () => {
  const t = mapTransaction({ emp_code: '101', punch_time: '2026-03-01 06:00:00', punch_state: '0' });
  assert.deepEqual(t, { empCode: '101', punchTime: '2026-03-01 06:00:00', state: 'in' });
});

import { authenticate } from './bioTimeClient.js';

function fakeFetch(routes) {
  return async (url, opts) => {
    const r = routes.find(x => url.includes(x.match));
    if (!r) throw new Error('no route for ' + url);
    return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };
}

test('authenticate posts creds and returns the token', async () => {
  let sentBody = null;
  const ff = async (url, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ token: 'abc.def.ghi' }) }; };
  const token = await authenticate({ baseUrl: 'http://x', username: 'u', password: 'p' }, ff);
  assert.equal(token, 'abc.def.ghi');
  assert.deepEqual(sentBody, { username: 'u', password: 'p' });
});

test('authenticate throws on non-200', async () => {
  const ff = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'bad' });
  await assert.rejects(() => authenticate({ baseUrl: 'http://x', username: 'u', password: 'p' }, ff), /auth failed: 401/);
});

import { fetchAllPages } from './bioTimeClient.js';

test('fetchAllPages concatenates pages until next is null', async () => {
  const pages = {
    1: { data: [{ id: 1 }, { id: 2 }], next: 'p2' },
    2: { data: [{ id: 3 }], next: null },
  };
  const ff = async (url) => {
    const m = url.match(/page=(\d+)/);
    return { ok: true, status: 200, json: async () => pages[m[1]] };
  };
  const all = await fetchAllPages('http://x', '/p/', {}, 'tok', ff);
  assert.deepEqual(all.map(r => r.id), [1, 2, 3]);
});

import { fetchTransactions, fetchEmployees } from './bioTimeClient.js';

test('fetchTransactions maps + drops unknown states', async () => {
  const ff = async () => ({ ok: true, status: 200, json: async () => ({ next: null, data: [
    { emp_code: '101', punch_time: '2026-03-01 06:00:00', punch_state: '0' },
    { emp_code: '101', punch_time: '2026-03-01 16:00:00', punch_state: '1' },
    { emp_code: '101', punch_time: '2026-03-01 17:00:00', punch_state: '9' }, // unknown -> dropped
  ] }) });
  const out = await fetchTransactions({ baseUrl: 'http://x' }, { startTime: '2026-03-01 00:00:00', endTime: '2026-03-01 23:59:59', token: 't' }, ff);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { empCode: '101', punchTime: '2026-03-01 06:00:00', state: 'in' });
});

test('fetchEmployees maps to {empCode,name,entity}', async () => {
  const ff = async () => ({ ok: true, status: 200, json: async () => ({ next: null, data: [
    { emp_code: '101', first_name: 'Moath', last_name: 'Alghoniman', department: { dept_name: 'CALO BAHRAIN - Kitchen' } },
  ] }) });
  const out = await fetchEmployees({ baseUrl: 'http://x' }, 't', ff);
  assert.deepEqual(out[0], { empCode: '101', name: 'Moath Alghoniman', entity: 'CALO BAHRAIN - Kitchen' });
});

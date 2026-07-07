import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeClaudeFailure, extractJSON, getModelIds } from './aiService.js';

const body = (type, message) => JSON.stringify({ type: 'error', error: { type, message } });

test('describeClaudeFailure: 401 points at CLAUDE_API_KEY and Console-key requirement', () => {
  const m = describeClaudeFailure(401, body('authentication_error', 'invalid x-api-key'), 'claude-opus-4-7');
  assert.match(m, /CLAUDE_API_KEY/);
  assert.match(m, /Console key/);
  assert.match(m, /invalid x-api-key/);
});

test('describeClaudeFailure: 404 names the model and the env override', () => {
  const m = describeClaudeFailure(404, body('not_found_error', 'model: claude-opus-4-7'), 'claude-opus-4-7');
  assert.match(m, /"claude-opus-4-7"/);
  assert.match(m, /CLAUDE_OPUS_MODEL/);
});

test('describeClaudeFailure: 400 model-not-supported is treated like missing model access', () => {
  const m = describeClaudeFailure(400, body('invalid_request_error', 'the requested model is not supported'), 'claude-opus-4-7');
  assert.match(m, /not available on this Anthropic org/);
});

test('describeClaudeFailure: 429 points at billing/credits', () => {
  const m = describeClaudeFailure(429, body('rate_limit_error', 'rate limited'), 'claude-sonnet-4-6');
  assert.match(m, /credits|Billing/);
});

test('describeClaudeFailure: 529 reads as transient', () => {
  assert.match(describeClaudeFailure(529, 'overloaded', 'claude-sonnet-4-6'), /overloaded/i);
});

test('describeClaudeFailure: tolerates non-JSON bodies', () => {
  const m = describeClaudeFailure(418, '<html>teapot</html>', 'claude-sonnet-4-6');
  assert.match(m, /418/);
});

test('getModelIds returns both configured model ids', () => {
  const ids = getModelIds();
  assert.ok(ids.sonnet && ids.opus);
});

test('extractJSON: plain, fenced, and prose-wrapped JSON all parse; truncated returns null', () => {
  assert.deepEqual(extractJSON('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJSON('Sure! Here it is: {"a":1}'), { a: 1 });
  assert.equal(extractJSON('{"a": 1, "b": [1,2'), null);
});

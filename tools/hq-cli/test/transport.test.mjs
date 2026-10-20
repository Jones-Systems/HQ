import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.ts';
import { PlannerClient, MAX_RESPONSE_BYTES } from '../src/transport.ts';
import { version } from '../src/schema.ts';
import { harness, json, state, item, date } from './fixtures.mjs';

test('unsafe URLs are rejected locally including credentials, remote HTTP, queries, fragments and base paths', async () => {
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/?key=1', 'https://example.com/#', 'https://example.com/?', 'file:///etc/hosts', 'https://example.com/base', ' https://example.com', 'https:\\example.com']) {
    const h = harness({});
    const result = await run(['planner', 'status', '--planner-url', url], h.deps);
    assert.equal(result.exitCode, 2, url);
    assert.equal(h.calls.length, 0);
  }
  for (const url of ['http://localhost:3210', 'http://127.0.0.1:3210', 'http://[::1]:3210', 'https://example.com']) {
    assert.equal((await run(['planner', 'status', '--planner-url', url], harness({ '/api/version': { state_version: 1 } }).deps)).exitCode, 0);
  }
});

test('typed adapter refuses an invalid route even if called outside parser', async () => {
  const h = harness({});
  const client = new PlannerClient('http://127.0.0.1', h.deps.fetch);
  await assert.rejects(client.read({ kind: 'item', id: '../admin' }, version), e => e.code === 'usage_error');
  await assert.rejects(client.read({ kind: 'export' }, version), e => e.code === 'usage_error');
  assert.equal(h.calls.length, 0);
});

for (const [native, expected] of [['ECONNREFUSED', 'connection_refused'], ['ENOTFOUND', 'dns_failure'], ['EAI_AGAIN', 'dns_failure'], ['ECONNRESET', 'network_error']]) test(`read ${native} is unavailable with known no-write effect`, async () => {
  const result = await run(['planner', 'status'], { env: { HQ_PLANNER_URL: 'http://localhost:3210' }, fetch: async () => { throw new TypeError('fetch failed', { cause: { code: native } }); } });
  assert.equal(result.exitCode, 6);
  assert.equal(result.result.error.code, expected);
  assert.equal(result.result.effect, 'none');
});

test('timeout is bounded even when injected fetch ignores abort; no write is claimed unknown', async () => {
  let signal;
  const result = await run(['planner', 'status', '--timeout-ms', '5'], { env: { HQ_PLANNER_URL: 'http://localhost:3210' }, fetch: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  assert.equal(result.exitCode, 6);
  assert.equal(result.result.error.code, 'timeout');
  assert.equal(result.result.effect, 'none');
  assert.equal(signal.aborted, true);
});

test('body reading shares the request timeout', async () => {
  const result = await run(['planner', 'status', '--timeout-ms', '5'], harness({ '/api/version': () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }) }).deps);
  assert.equal(result.result.error.code, 'timeout');
});

test('redirects are refused without a follow-up request', async () => {
  const h = harness({ '/api/version': () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example' } }) });
  const result = await run(['planner', 'status'], h.deps);
  assert.equal(result.result.error.code, 'redirect_refused');
  assert.equal(h.calls.length, 1);
});

test('HTTP access/validation/not-found/server errors map to stable codes and preserve no effect', async () => {
  for (const [status, exit, code] of [[403, 6, 'access_refused'], [421, 6, 'access_refused'], [400, 3, 'validation_error'], [422, 3, 'validation_error'], [404, 5, 'not_found'], [500, 6, 'service_unavailable'], [503, 6, 'service_unavailable']]) {
    const result = await run(['planner', 'status'], harness({ '/api/version': () => json({ error: 'synthetic' }, status) }).deps);
    assert.equal(result.exitCode, exit);
    assert.equal(result.result.error.code, code);
    assert.equal(result.result.effect, 'none');
    if (status === 421) assert.match(result.result.error.details.hint, /--allowed-host/);
  }
});

test('malformed response shape, JSON, media type, item identity and calendar data never appear successful', async () => {
  for (const response of [() => json({ state_version: '1' }), () => new Response('{bad', { headers: { 'content-type': 'application/json' } }), () => new Response('<html>bad</html>')]) {
    const value = await run(['planner', 'status'], harness({ '/api/version': response }).deps);
    assert.equal(value.result.error.code, 'bad_response');
    assert.equal(value.exitCode, 6);
  }
  for (const value of [item({ id: 'wrong001' }), item({ dates: [date({ value: '2026-02-30' })] }), item({ dates: [date({ time: '10:00' })] }), { id: 'item0001' }]) {
    assert.equal((await run(['planner', 'items', 'get', 'item0001'], harness({ '/api/items/item0001': { item: value } }).deps)).result.error.code, 'bad_response');
  }
  const invalidTimezone = state({ settings: { default_tz: 'Not/AZone', week_start: 'sun', stale_days: 21 } });
  assert.equal((await run(['planner', 'now'], harness({ '/api/state': invalidTimezone }).deps)).result.error.code, 'bad_response');
});

test('read size is bounded by declared content-length and actual streamed bytes', async () => {
  for (const response of [() => json({ state_version: 1 }, 200, { 'content-length': String(MAX_RESPONSE_BYTES + 1) }), () => new Response(new Uint8Array(MAX_RESPONSE_BYTES + 1), { headers: { 'content-type': 'application/json' } })]) {
    const result = await run(['planner', 'status'], harness({ '/api/version': response }).deps);
    assert.equal(result.result.error.code, 'response_too_large');
  }
});

test('additive backend properties are ignored but known malformed properties are rejected', async () => {
  const clean = await run(['planner', 'items', 'get', 'item0001'], harness({ '/api/items/item0001': { item: { ...item(), internal_only: 'omit' }, extra: true } }).deps);
  assert.equal(clean.exitCode, 0);
  assert.equal(Object.hasOwn(clean.result.data.item, 'internal_only'), false);
  const malformed = await run(['planner', 'status'], harness({ '/api/version': { state_version: 1, features: 'bad' } }).deps);
  assert.equal(malformed.result.error.code, 'bad_response');
});

test('unreachable discovery describes the failure instead of claiming a live adapter', async () => {
  const result = await run(['capabilities'], harness({ '/api/version': () => { throw new Error('offline'); } }).deps);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.data.domains[0].availability, 'unreachable');
  assert.match(result.result.data.domains[0].reason, /network_error/);
});

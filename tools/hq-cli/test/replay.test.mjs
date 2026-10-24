import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../src/cli.ts';
import { server, json, item, replay, scratch, info } from './write-fixtures.mjs';

test('unknown → exact retention-aware resend → replayed never uses a new ID or outer request header', async t => {
  const f = await scratch(t);
  const first = server(() => { throw new Error('Lost response'); });
  const unknown = await run(['planner', 'items', 'create', '--title', 'Synthetic 🧭', '--request-id', 'request-1234'], first.deps);
  assert.equal(unknown.exitCode, 7); assert.equal(first.writes().length, 1);
  const path = await f.write('unknown.json', unknown.result);
  const second = server(call => { assert.equal(call.path, '/api/requests/replay'); return json({ outcome: 'replayed', status: 201, response: { item: item(), state_version: 9 } }, 200, { 'X-Replayed': '1' }); });
  const resolved = await run(['planner', 'replay', '--request-file', path], second.deps);
  assert.equal(resolved.exitCode, 0); assert.equal(resolved.result.effect, 'replayed');
  const sent = second.writes()[0];
  assert.equal(sent.headers['X-Request-Id'], undefined); assert.equal(sent.headers['X-Planning-Request'], '1');
  assert.deepEqual(sent.parsed, { mode: 'resend', request_id: 'request-1234', method: 'POST', path: '/api/items', body_b64: unknown.result.replay.body_b64, sent_after_version: 8 });
  assert.equal(Buffer.from(sent.parsed.body_b64, 'base64').toString(), first.writes()[0].body);
  assert.equal(second.writes().length, 1);
});

test('check uses lookup once, reports not_applied, and never follows with normal send', async t => {
  const f = await scratch(t); const path = await f.write('request.json', replay());
  const h = server(call => { assert.equal(call.parsed.mode, 'lookup'); return json({ outcome: 'not_applied' }); });
  const r = await run(['planner', 'replay', '--request-file', path, '--check'], h.deps);
  assert.equal(r.exitCode, 0); assert.equal(r.result.effect, 'none'); assert.deepEqual(r.result.data, { outcome: 'not_applied' }); assert.equal(h.writes().length, 1);
});

for (const mode of ['resend', 'lookup']) test(`contradictory ${mode} outcome remains unknown and preserves recovery without retry`, async t => {
  const f = await scratch(t);
  const doc = replay();
  const path = await f.write('request.json', doc);
  const h = server(call => {
    assert.equal(call.path, '/api/requests/replay');
    assert.equal(call.parsed.mode, mode);
    return json(mode === 'resend' ? { outcome: 'not_applied' } : { outcome: 'applied_now', status: 201, response: { item: item(), state_version: 9 } });
  });
  const r = await run(['planner', 'replay', '--request-file', path, ...(mode === 'lookup' ? ['--check'] : [])], h.deps);
  assert.equal(r.exitCode, 7);
  assert.equal(r.result.ok, false);
  assert.equal(r.result.effect, 'unknown');
  assert.equal(r.result.error.code, 'bad_response');
  assert.match(r.result.error.details.hint, /Never blindly retry/);
  assert.equal(r.result.request_id, doc.request_id);
  assert.deepEqual(r.result.replay, doc);
  assert.equal(h.writes().length, 1);
  assert.deepEqual(h.calls.map(call => [call.method, call.path]), [['GET', '/api/version'], ['POST', '/api/requests/replay']]);
  assert.deepEqual(h.writes()[0].parsed, { mode, request_id: doc.request_id, method: doc.method, path: doc.path, body_b64: doc.body_b64, sent_after_version: doc.sent_after_version });
  assert.equal(h.writes()[0].headers['X-Request-Id'], undefined);
});

test('resend applied_now returns applied; mismatch and retention indeterminate preserve distinct outcomes', async t => {
  const f = await scratch(t); const path = await f.write('request.json', replay());
  const applied = server(() => json({ outcome: 'applied_now', status: 201, response: { item: item(), state_version: 9 } }));
  assert.equal((await run(['planner', 'replay', '--request-file', path], applied.deps)).result.effect, 'applied');
  const reused = server(() => json({ error: 'request_id_reused', message: 'Different bytes' }, 422));
  assert.equal((await run(['planner', 'replay', '--request-file', path], reused.deps)).exitCode, 4);
  const expired = server(() => json({ error: 'replay_indeterminate', message: 'Evicted', sent_after_version: 8, evicted_through_version: 12 }, 409), { ...info, state_version: 20 });
  const r = await run(['planner', 'replay', '--request-file', path], expired.deps);
  assert.equal(r.exitCode, 7); assert.equal(r.result.effect, 'unknown'); assert.equal(r.result.error.code, 'replay_indeterminate'); assert.match(r.result.error.details.hint, /Read back/); assert.equal(expired.writes().length, 1);
});

test('endpoint overrides, unsupported inner routes, invalid/future V and altered base64 are refused before a write', async t => {
  const f = await scratch(t);
  const h = server(() => assert.fail('Must not write'));
  for (const doc of [replay({ method: 'DELETE' }), replay({ path: '/api/examples' }), replay({ path: '/api/items?secret=1' }), replay({ sent_after_version: true }), replay({ sent_after_version: -1 }), replay({ sent_after_version: 9 }), replay({ body_b64: 'not_base64' }), replay({ body_b64: Buffer.from('[]').toString('base64') }), replay({ method: 'PATCH', path: '/api/items/item0001', body_b64: Buffer.from('{"patch":{"title":"X"}}').toString('base64') })]) {
    const path = await f.write('request.json', doc);
    assert.equal((await run(['planner', 'replay', '--request-file', path], h.deps)).exitCode, 2);
  }
  const path = await f.write('request.json', replay());
  const n = h.calls.length;
  assert.equal((await run(['planner', 'replay', '--request-file', path, '--planner-url', 'https://different.example'], h.deps)).exitCode, 2);
  assert.equal(h.calls.length, n);
  assert.equal(h.writes().length, 0);
});

test('legacy create/batch/settings recovery is unsupported and sends zero writes', async t => {
  const f = await scratch(t);
  for (const [method, path, body] of [['POST', '/api/items', { fields: { title: 'Synthetic' } }], ['POST', '/api/items/batch', { items: [{ title: 'Synthetic' }] }], ['PUT', '/api/settings', { settings: { week_start: 'mon' } }]]) {
    const file = await f.write('request.json', replay({ method, path, body_b64: Buffer.from(JSON.stringify(body)).toString('base64') }));
    const h = server(() => assert.fail('Must not replay unsafe legacy write'), { state_version: 8 });
    const r = await run(['planner', 'replay', '--request-file', file], h.deps);
    assert.equal(r.exitCode, 7); assert.equal(r.result.error.code, 'replay_unsupported'); assert.equal(r.result.effect, 'unknown'); assert.equal(h.writes().length, 0); assert.match(r.result.error.details.hint, /Never blindly retry/);
  }
});

test('legacy revision-guarded replay preserves exact whitespace bytes and original request ID', async t => {
  const f = await scratch(t);
  const raw = ' { "revision": 3, "patch": {"title":"Synthetic"} }\n';
  const file = await f.write('request.json', replay({ method: 'PATCH', path: '/api/items/item0001', body_b64: Buffer.from(raw).toString('base64') }));
  const h = server(call => { assert.equal(call.body, raw); assert.equal(call.headers['X-Request-Id'], 'request-1234'); return json({ item: item({ revision: 4 }), state_version: 9 }, 200, { 'X-Replayed': '1' }); }, { state_version: 8 });
  const r = await run(['planner', 'replay', '--request-file', file], h.deps);
  assert.equal(r.exitCode, 0); assert.equal(r.result.effect, 'replayed');
  const conflict = server(() => json({ error: 'revision_conflict', message: 'Stale', current: item({ revision: 4 }) }, 409), { state_version: 8 });
  const c = await run(['planner', 'replay', '--request-file', file], conflict.deps);
  assert.equal(c.exitCode, 4); assert.equal(c.result.error.details.current.revision, 4); assert.equal(c.result.error.details.possibly_already_applied, true); assert.match(c.result.error.details.hint, /Possibly already applied/);
  const check = server(() => assert.fail('Legacy check must not resend'), { state_version: 8 });
  assert.equal((await run(['planner', 'replay', '--request-file', file, '--check'], check.deps)).result.error.code, 'replay_unsupported');
});

test('legacy move/archive/restore/reviewed use guarded route; replay rejects unresolved relative dates', async t => {
  const f = await scratch(t);
  for (const action of ['move', 'archive', 'restore', 'reviewed']) {
    const body = { revision: 3, ...(action === 'move' ? { status: 'next' } : {}) };
    const path = await f.write('request.json', replay({ path: `/api/items/item0001/${action}`, body_b64: Buffer.from(JSON.stringify(body)).toString('base64') }));
    const h = server(() => json({ item: item({ revision: 4 }), state_version: 9 }), { state_version: 8 });
    assert.equal((await run(['planner', 'replay', '--request-file', path], h.deps)).exitCode, 0); assert.equal(h.writes().length, 1);
  }
  const path = await f.write('request.json', replay({ body_b64: Buffer.from(JSON.stringify({ fields: { title: 'X', dates: [{ kind: 'target', value: 'today' }] } })).toString('base64') }));
  const h = server(() => assert.fail('Must not send'));
  assert.equal((await run(['planner', 'replay', '--request-file', path], h.deps)).exitCode, 2); assert.equal(h.calls.length, 0);
});

test('captured contract replay exchanges map to stable outcomes and the CLI sends their exact bytes', async t => {
  const f = await scratch(t);
  const exchange = name => JSON.parse(readFileSync(new URL(`../../../services/planner/contract/exchanges/${name}.json`, import.meta.url), 'utf8'));
  const respond = captured => { const headers = { ...captured.response.headers }; delete headers['Content-Length']; return new Response(JSON.stringify(captured.response.body), { status: captured.response.status, headers }); };
  const version = exchange('26-version').response.body;
  for (const [name, check, exitCode, effect, outcome, exact] of [
    ['19-replay-retained', true, 0, 'replayed', 'replayed', true],
    ['20-replay-not-applied', true, 0, 'none', 'not_applied', true],
    ['21-replay-apply', false, 0, 'applied', 'applied_now', true],
    ['22-replay-apply-repeated', false, 0, 'replayed', 'replayed', true],
    ['23-replay-indeterminate', true, 7, 'unknown', undefined, false],
  ]) {
    const captured = exchange(name);
    const { mode, sent_after_version, ...inner } = JSON.parse(captured.request.body_utf8);
    assert.equal(mode, check ? 'lookup' : 'resend', name);
    const path = await f.write('request.json', replay({ ...inner, sent_after_version: sent_after_version ?? 0 }));
    const h = server(() => respond(captured), version);
    const r = await run(['planner', 'replay', '--request-file', path, ...(check ? ['--check'] : [])], h.deps);
    assert.equal(r.exitCode, exitCode, `${name} ${JSON.stringify(r.result)}`);
    assert.equal(r.result.effect, effect, name);
    assert.equal(h.writes().length, 1, name);
    if (exact) assert.equal(h.writes()[0].body, captured.request.body_utf8, name);
    if (outcome) assert.equal(r.result.data.outcome, outcome, name);
    else { assert.equal(r.result.error.code, 'replay_indeterminate'); assert.equal(r.result.error.details.evicted_through_version, 0); assert.equal(Object.hasOwn(r.result.error.details, 'sent_after_version'), false); }
  }
});

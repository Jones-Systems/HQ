import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { run } from '../src/cli.ts';
import { schemas, commands } from '../src/commands.ts';
import { conforms } from '../src/schema.ts';
import { atomicJSON } from '../src/files.ts';
import { server, json, item, scratch, itemReply, info } from './write-fixtures.mjs';

test('every single mutation uses its canonical closed route/body and a version preread', async () => {
  const cases = [
    [['items', 'create', '--title', 'Synthetic'], 'POST', '/api/items', { fields: { title: 'Synthetic' } }],
    [['items', 'update', 'item0001', '--revision', '3', '--title', 'Changed'], 'PATCH', '/api/items/item0001', { revision: 3, patch: { title: 'Changed' } }],
    [['items', 'move', 'item0001', '--revision', '3', '--status', 'next', '--after-id', 'item0002'], 'POST', '/api/items/item0001/move', { revision: 3, status: 'next', after_id: 'item0002' }],
    ...['archive', 'restore', 'reviewed'].map(action => [['items', action, 'item0001', '--revision', '3'], 'POST', `/api/items/item0001/${action}`, { revision: 3 }]),
    [['settings', 'set', '--week-start', 'mon', '--stale-days', '30'], 'PUT', '/api/settings', { settings: { week_start: 'mon', stale_days: 30 } }],
  ];
  for (const [args, method, path, body] of cases) {
    const h = server(call => call.path === '/api/settings' ? json({ settings: { default_tz: 'America/New_York', week_start: 'mon', stale_days: 30 }, state_version: 9 }) : itemReply(call));
    const r = await run(['planner', ...args, '--request-id', 'request-1234'], h.deps);
    assert.equal(r.exitCode, 0, JSON.stringify(r)); assert.equal(r.result.effect, 'applied');
    assert.equal(h.calls[0].path, '/api/version'); assert.equal(h.writes().length, 1);
    const send = h.writes()[0]; assert.equal(send.method, method); assert.equal(send.path, path); assert.deepEqual(send.parsed, body);
    assert.equal(send.headers['X-Planning-Request'], '1'); assert.equal(send.headers['X-Request-Id'], 'request-1234'); assert.equal(send.headers.Origin, undefined);
    assert.equal(r.result.replay.sent_after_version, 8); assert.equal(r.result.replay.body_b64, Buffer.from(send.body).toString('base64'));
    assert.equal(conforms(schemas([commands.find(c => c.id === r.result.command)])[0].output, r.result), true, r.result.command);
  }
});

test('fields files permit rich editable arrays and explicit nullable clearing; duplicate flags are rejected', async t => {
  const f = await scratch(t);
  const fields = await f.write('fields.json', { title: 'Synthetic', area: null, next_steps: [{ text: 'First step', done: false }], references: [{ kind: 'doc', label: 'Reference', url: 'https://example.com' }] });
  const h = server(call => itemReply(call, { next_steps: [{ id: 'step0001', text: 'First step', done: false }], references: [{ id: 'refs0001', kind: 'doc', label: 'Reference', url: 'https://example.com' }] }));
  assert.equal((await run(['planner', 'items', 'create', '--fields-file', fields], h.deps)).exitCode, 0);
  assert.equal((await run(['planner', 'items', 'create', '--fields-file', fields, '--title', 'Duplicate'], h.deps)).exitCode, 2);
  assert.equal(h.writes().length, 1);
});

test('failed version preread always exits 6 and sends no mutation', async () => {
  for (const version of [() => json({ error: 'not_found', message: 'Missing' }, 404), () => json({ state_version: false }), () => { throw new Error('Offline'); }]) {
    const h = server(() => assert.fail('Must not write'), version);
    const r = await run(['planner', 'items', 'create', '--title', 'Synthetic'], h.deps);
    assert.equal(r.exitCode, 6); assert.equal(r.result.effect, 'none'); assert.equal(r.result.error.code, 'version_unavailable'); assert.equal(h.writes().length, 0);
  }
});

for (const kind of ['reset', 'timeout', 'malformed', '5xx', 'wrong-item']) test(`uncertain ${kind} emits one exact-byte replay document with no retry`, async () => {
  const h = server(() => {
    if (kind === 'reset') throw Object.assign(new Error(), { code: 'ECONNRESET' });
    if (kind === 'timeout') return new Promise(() => {});
    if (kind === 'malformed') return json({ ok: true });
    if (kind === '5xx') return json({ error: 'internal', message: 'Failed' }, 500);
    return json({ item: item({ id: 'wrong001' }), state_version: 9 });
  });
  const r = await run(['planner', 'items', 'update', 'item0001', '--revision', '3', '--title', 'Unicode 🧭', '--timeout-ms', '5', '--request-id', 'request-1234'], h.deps);
  assert.equal(r.exitCode, 7, JSON.stringify(r)); assert.equal(r.result.effect, 'unknown'); assert.equal(h.writes().length, 1);
  assert.equal(Buffer.from(r.result.replay.body_b64, 'base64').toString(), h.writes()[0].body);
  assert.equal(r.result.replay.planner_url, 'http://127.0.0.1:3210'); assert.equal(r.result.request_id, 'request-1234');
});

test('known connection refusal and DNS failure remain no effect; service errors map correctly', async () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND']) {
    const h = server(() => { throw Object.assign(new Error(), { code }); });
    const r = await run(['planner', 'items', 'create', '--title', 'Synthetic'], h.deps);
    assert.equal(r.exitCode, 6); assert.equal(r.result.effect, 'none');
  }
  for (const [status, code, exit] of [[422, 'invalid', 3], [422, 'request_id_reused', 4], [409, 'order_conflict', 4], [404, 'not_found', 5], [413, 'too_large', 3], [403, 'forbidden', 6], [421, 'host', 6]]) {
    const h = server(() => json({ error: code, message: 'Synthetic error', errors: [{ field: 'title', message: 'Bad title' }] }, status));
    const r = await run(['planner', 'items', 'create', '--title', 'Synthetic'], h.deps);
    assert.equal(r.exitCode, exit, code); assert.equal(r.result.effect, 'none');
  }
});

test('intent is atomically present before first send and updated with known result', async t => {
  const f = await scratch(t);
  const path = f.path('intent.json');
  const h = server(call => {
    const intent = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(intent.schema, 'hq.planner.replay/v1'); assert.equal(intent.sent_after_version, 8);
    assert.equal(Buffer.from(intent.body_b64, 'base64').toString(), call.body);
    assert.deepEqual(readdirSync(f.root), ['intent.json']);
    return itemReply(call);
  });
  const r = await run(['planner', 'items', 'create', '--title', 'Synthetic', '--intent-file', path], h.deps);
  assert.equal(r.exitCode, 0); assert.deepEqual(await f.read('intent.json'), r.result);
  assert.deepEqual(readdirSync(f.root), ['intent.json']);
});

test('intent write failure prevents sending; rename failure cleans its exact temp', async t => {
  const f = await scratch(t);
  const h = server(() => assert.fail('Must not send'));
  const r = await run(['planner', 'items', 'create', '--title', 'Synthetic', '--intent-file', f.path('missing/intent.json')], h.deps);
  assert.equal(r.exitCode, 2); assert.equal(h.writes().length, 0);
  assert.throws(() => atomicJSON(f.root, { example: true }));
  assert.deepEqual(readdirSync(f.root), []);
});

test('invalid local mutations fail without POST, and request IDs are bounded', async () => {
  const h = server(() => assert.fail('Must not send'));
  for (const args of [['items', 'update', 'item0001', '--revision', '0', '--title', 'X'], ['items', 'create', '--title', '   '], ['settings', 'set'], ['items', 'move', 'item0001', '--revision', '3', '--status', 'next', '--before-id', 'item0002', '--after-id', 'item0003'], ['items', 'create', '--title', 'X', '--request-id', 'bad'], ['items', 'create', '--title', 'X', '--request-id', 'x'.repeat(65)]]) assert.equal((await run(['planner', ...args], h.deps)).exitCode, 2);
  assert.equal(h.writes().length, 0);
});

test('Unicode title length follows characters, not UTF-16 code units', async () => {
  const h = server(call => itemReply(call));
  const r = await run(['planner', 'items', 'create', '--title', '🧭'.repeat(200)], h.deps);
  assert.equal(r.exitCode, 0);
});


test('atomic intent temp is cleaned on handled SIGINT and SIGTERM before process exit', async t => {
  const f = await scratch(t);
  const moduleURL = new URL('../src/files.ts', import.meta.url).href;
  for (const [signal, exit] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const script = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
      const original = fs.writeFileSync;
      fs.writeFileSync = (...args) => { original(...args); process.emit(process.env.TEST_SIGNAL); };
      syncBuiltinESMExports();
      const { atomicJSON } = await import(process.env.TEST_MODULE);
      atomicJSON(process.env.TEST_TARGET, { synthetic: true });`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TEST_MODULE: moduleURL, TEST_TARGET: f.path('intent.json'), TEST_SIGNAL: signal } });
    assert.equal(child.status, exit, child.stderr);
    assert.deepEqual(readdirSync(f.root), []);
  }
});

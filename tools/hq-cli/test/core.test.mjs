import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run, parse } from '../src/cli.ts';
import { commands, schemas } from '../src/commands.ts';
import { conforms } from '../src/schema.ts';
import { harness, state, item, date } from './fixtures.mjs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { readJSON, atomicJSON } from '../src/files.ts';
import { scratch } from './write-fixtures.mjs';
const noNetwork = { env: {}, fetch: async () => { assert.fail('Unexpected network'); } };

test('unconfigured discovery never fetches and identifies every unavailable domain honestly', async () => {
  const { exitCode, result } = await run(['capabilities'], noNetwork);
  assert.equal(exitCode, 0);
  assert.equal(result.effect, 'none');
  assert.equal(result.data.domains[0].availability, 'unconfigured');
  assert.equal(result.data.multiple_boards, false);
  assert.equal(result.data.domains.length, 6);
  for (const domain of result.data.domains) { assert.ok(domain.reason.length); assert.deepEqual(domain.features, []); }
  assert.equal((await run(['planner', 'status'], noNetwork)).exitCode, 6);
});

test('discovery reports live features, excludes server implementation metadata, tolerates legacy API', async () => {
  const h = harness({ '/api/version': { state_version: 2, api: 2, features: ['items.batch_create', 'requests.replay'], commit: 'should-not-leak' } });
  const capabilities = await run(['capabilities'], h.deps);
  assert.equal(capabilities.result.data.domains[0].availability, 'live');
  assert.deepEqual(capabilities.result.data.domains[0].features, ['items.batch_create', 'requests.replay']);
  assert.ok(!JSON.stringify(capabilities).includes('should-not-leak'));
  const legacy = await run(['planner', 'status'], harness({ '/api/version': { state_version: 7 } }).deps);
  assert.deepEqual(legacy.result.data, { availability: 'live', api: 1, features: [], state_version: 7 });
});

test('commands, help and schema are local discovery even without service configuration', async () => {
  for (const args of [['commands'], ['--help'], ['planner', 'items', 'get', '--help'], ['schema']]) {
    const value = await run(args, noNetwork);
    assert.equal(value.exitCode, 0, JSON.stringify(value));
    assert.ok(value.result.data.commands.length >= 10);
  }
  const found = await run(['schema', 'planner.items.list'], noNetwork);
  assert.equal(found.result.data.commands.length, 1);
  assert.equal(found.result.data.commands[0].input.additionalProperties, false);
  assert.deepEqual(found.result.data.commands[0].input.properties.kind.enum, ['project', 'idea', 'goal', 'chore']);
  assert.equal((await run(['schema', 'unknown.command'], noNetwork)).exitCode, 2);
});

test('parser rejects unknown commands, options, duplicates, missing values and invalid positional IDs without fetch', async () => {
  for (const args of [[], ['planner', 'items', 'create'], ['planner', 'items', 'get'], ['planner', 'items', 'get', '../bad'], ['planner', 'status', '--bogus', '1'], ['planner', 'now', '--days', '0'], ['planner', 'now', '--days=32'], ['planner', 'now', '--days', '2', '--days', '3'], ['planner', 'status', '--planner-url'], ['commands', 'extra'], ['planner', 'items', 'get', '--item-id', 'item0001']]) {
    const value = await run(args, noNetwork);
    assert.equal(value.exitCode, 2, JSON.stringify(args));
    assert.equal(value.result.schema, 'hq.cli.result/v1');
    assert.equal(value.result.effect, 'none');
    assert.equal(value.result.error.code, 'usage_error');
  }
});

test('explicit CLI URL wins over environment, options work before and after command, every route is GET without Origin', async () => {
  const h = harness({ '/api/items/item0001': { item: item() } });
  const result = await run(['--planner-url', 'https://planner.example', 'planner', 'items', 'get', 'item0001', '--timeout-ms=500'], h.deps);
  assert.equal(result.exitCode, 0);
  assert.equal(h.calls[0].url, 'https://planner.example/api/items/item0001');
  assert.equal(h.calls[0].options.method, 'GET');
  assert.equal(h.calls[0].options.redirect, 'manual');
  assert.equal(h.calls[0].options.credentials, 'omit');
  assert.deepEqual(h.calls[0].options.headers, { Accept: 'application/json' });
});

test('every implemented command returns the data fields its closed schema describes', async () => {
  const h = harness({ '/api/state': state({ items: [item({ dates: [date()] })] }), '/api/version': { state_version: 3, api: 2, features: [] }, '/api/items/item0001': { item: item() }, '/api/items/item0001/history': { history: [{ at: '2026-10-20T12:00:00Z', action: 'created', detail: { fields: [], changes: { status: [null, 'inbox'] } } }] } });
  for (const command of commands.filter(c => !c.write)) {
    const args = [...command.words];
    if (command.positional === 'item_id') args.push('item0001');
    const value = await run(args, h.deps);
    assert.equal(value.exitCode, 0, command.id + JSON.stringify(value));
    assert.equal(conforms(schemas([command])[0].output, value.result), true, command.id);
  }
});

test('symlink launcher resolves checkout with spaces and prints exactly one JSON document for success, help and usage failure', async () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const scratch = await mkdtemp(resolve(root, '.launcher-test-'));
  try {
    const target = resolve(scratch, 'hq command');
    await symlink(resolve(root, '../bin/hq'), target);
    for (const [args, exit] of [[['commands'], 0], [['--help'], 0], [['unknown'], 2]]) {
      const p = spawnSync(target, args, { encoding: 'utf8', env: { ...process.env, HQ_PLANNER_URL: '' } });
      assert.equal(p.error, undefined);
      assert.equal(p.status, exit, p.stderr);
      assert.equal(p.stdout.trim().split('\n').length, 1);
      assert.equal(JSON.parse(p.stdout).schema, 'hq.cli.result/v1');
      assert.equal(p.stderr, '');
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('input-file errors keep their specific message instead of a generic read failure', async t => {
  const f = await scratch(t);
  const path = await f.write('large.json', { synthetic: 'x'.repeat(64) });
  assert.throws(() => readJSON(path, 16), e => e.code === 'usage_error' && /size limit/.test(e.message));
});

test('atomic intent write makes the rename durable by syncing the file and then its directory', async t => {
  const f = await scratch(t);
  const target = f.path('intent.json');
  const synced = [];
  const original = fs.fsyncSync;
  fs.fsyncSync = fd => { synced.push({ directory: fs.fstatSync(fd).isDirectory(), renamed: fs.existsSync(target) }); return original(fd); };
  syncBuiltinESMExports();
  try { atomicJSON(target, { synthetic: true }); }
  finally { fs.fsyncSync = original; syncBuiltinESMExports(); }
  assert.deepEqual(synced, [{ directory: false, renamed: false }, { directory: true, renamed: true }]);
  assert.deepEqual(fs.readdirSync(f.root), ['intent.json']);
});

for (const [signal, exit] of [['SIGINT', 130], ['SIGTERM', 143]]) test(`a real ${signal} delivered while the intent file is written is honored, not swallowed`, async t => {
  const f = await scratch(t);
  const script = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    const original = fs.fsyncSync; let armed = true;
    fs.fsyncSync = fd => { if (armed) { armed = false; process.kill(process.pid, process.env.TEST_SIGNAL); } return original(fd); };
    syncBuiltinESMExports();
    const { atomicJSON } = await import(process.env.TEST_MODULE);
    await new Promise(done => fs.readFile(process.env.TEST_TARGET + '.missing', () => done()));
    atomicJSON(process.env.TEST_TARGET, { synthetic: true });
    for (let i = 0; i < 3; i++) await new Promise(done => setImmediate(done));
    await new Promise(done => setTimeout(done, 50));
    process.stdout.write('continued');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TEST_MODULE: new URL('../src/files.ts', import.meta.url).href, TEST_TARGET: f.path('intent.json'), TEST_SIGNAL: signal } });
  assert.equal(child.stdout, '', 'the process must not continue toward a send after the signal');
  assert.equal(child.status, exit, child.stderr);
  assert.deepEqual(fs.readdirSync(f.root), ['intent.json']);
});

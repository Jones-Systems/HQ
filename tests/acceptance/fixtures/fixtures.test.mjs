import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, isolatedEnvironment } from '../runtime.mjs';
import { startFixture, canonical } from './http.mjs';
import { setupFixtures } from './setup.mjs';
import { row, scenarioGaps, fullOutcome } from './results.mjs';
import { encodeWork, encodeSocial, sendHttp } from '../../../apps/desktop/electron/services.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const exchanges = join(repo, 'modules/work/live/test/contract/exchanges');
const capture = async name => JSON.parse(await readFile(join(exchanges, name), 'utf8'));
async function owned(run) {
  const runtime = await createRuntime(join(repo, '.t3/acceptance-self-test'));
  try { await run(runtime); } finally { await runtime.close(); }
  await assert.rejects(access(runtime.root), { code: 'ENOENT' });
}
function call(fixture, encoded) {
  return sendHttp(new URL(encoded.path, fixture.origin), { ...encoded, headers: { ...(encoded.requestId ? { 'X-Request-Id': encoded.requestId } : {}) } });
}
test('all inherited HQ variables removed; only owned userData is admitted', () => {
  const env = isolatedEnvironment('/synthetic', { HQ_USER_DATA_DIR: '/unowned', HQ_QUALIFY_X: '1', HQ_SERVICE: 'real', SAFE: 'yes', NODE_OPTIONS: '--inspect' });
  assert.deepEqual(Object.keys(env).filter(k => k.startsWith('HQ_')), ['HQ_USER_DATA_DIR']);
  assert.equal(env.HQ_USER_DATA_DIR, '/synthetic/profile');
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.SAFE, 'yes');
});
test('result rows cannot turn missing prerequisites, held or absent scenarios into full pass', () => {
  assert.throws(() => row('x', 'pass', [{ id: 'build', status: 'held' }], ['claimed']));
  assert.notEqual(fullOutcome([]), 'passed');
  assert.notEqual(fullOutcome(scenarioGaps()), 'passed');
  assert.notEqual(fullOutcome([row('x', 'held', [{ id: 'build', status: 'held' }])]), 'passed');
});
test('closed HTTP fixture reproduces checked-in Planner exchanges without module imports', () => owned(async runtime => {
  let checked = 0;
  let fixture;
  for (const name of (await readdir(exchanges)).sort()) {
    const exchange = await capture(name);
    const { request, response } = exchange;
    // Batch/import are outside main's closed acceptance routes.
    const { closedRoute } = await import('./http.mjs');
    if (!closedRoute('work', request.method, request.path)) continue;
    fixture = await startFixture(runtime, 'work', { recordsName: `exchange-${String.fromCharCode(97 + checked)}` });
    const body = request.body_utf8 ? JSON.parse(request.body_utf8) : undefined;
    fixture.enqueue({ method: request.method, path: request.path, body, response });
    const result = await fetch(fixture.origin + request.path, { method: request.method,
      headers: request.headers, ...(body === undefined ? {} : { body: request.body_utf8 }) });
    assert.equal(result.status, response.status, name);
    assert.deepEqual(await result.json(), response.body, name);
    assert.equal(fixture.ledger.at(-1).body, canonical(body ?? null));
    checked++;
  }
  assert.ok(checked >= 20);
  assert.equal(fixture.ledger.length, 1);
  const denied = await fetch(fixture.origin + '/api/private');
  assert.equal(denied.status, 404);
}));
test('landed Work encoder, lost writes, retained records, missing baseline and malformed responses', () => owned(async runtime => {
  const fixture = await startFixture(runtime, 'work');
  const exchange = await capture('03-create.json');
  const fields = JSON.parse(exchange.request.body_utf8).fields;
  const encoded = encodeWork('create', { requestId: 'acceptance-write', fields });
  assert.equal(encoded.path, exchange.request.path);
  assert.equal(encoded.method, exchange.request.method);
  assert.equal(encoded.body, canonical(JSON.parse(exchange.request.body_utf8)));
  fixture.enqueue({ method: encoded.method, path: encoded.path, body: JSON.parse(encoded.body), response: exchange.response, mode: 'applied-but-response-lost' });
  assert.deepEqual(await call(fixture, encoded), { ok: false, kind: 'unknown' });
  const replay = encodeWork('replay', { requestId: 'acceptance-write', mode: 'lookup', original: { route: 'create', params: { requestId: 'acceptance-write', fields } }, sentAfterVersion: 0 });
  const retained = await call(fixture, replay);
  assert.equal(retained.body.outcome, 'replayed');
  assert.deepEqual(retained.body.response, exchange.response.body);
  assert.equal(retained.replayed, true);
  const replacement = await startFixture(runtime, 'work', { reads: { '/api/state': (await capture('02-state-empty.json')).response } });
  const state = await call(replacement, encodeWork('state', {}));
  assert.deepEqual(state.body.items, [exchange.response.body.item]);
  assert.equal(state.body.state_version, 1);
  assert.equal((await call(replacement, replay)).body.outcome, 'replayed');
  const unknown = encodeWork('replay', { requestId: 'acceptance-unseen', mode: 'lookup', original: { route: 'create', params: { requestId: 'acceptance-unseen', fields } } });
  assert.equal((await call(fixture, unknown)).body.error, 'replay_indeterminate');
  const notApplied = encodeWork('create', { requestId: 'acceptance-unseen', fields });
  fixture.enqueue({ method: 'POST', path: '/api/items', mode: 'not-applied' });
  assert.equal((await call(fixture, notApplied)).kind, 'unknown');
  const lookup = encodeWork('replay', { requestId: 'acceptance-unseen', mode: 'lookup', original: { route: 'create', params: { requestId: 'acceptance-unseen', fields } }, sentAfterVersion: 0 });
  assert.equal((await call(fixture, lookup)).body.outcome, 'not_applied');
  fixture.enqueue({ method: 'POST', path: '/api/requests/replay', mode: 'indeterminate' });
  const evicted = await call(fixture, lookup);
  assert.equal(evicted.status, 409);
  assert.equal(evicted.body.error, 'replay_indeterminate');
  assert.ok(evicted.body.evicted_through_version > evicted.body.sent_after_version);
  fixture.enqueue({ method: 'POST', path: '/api/items', mode: 'malformed', response: exchange.response });
  assert.equal((await call(fixture, notApplied)).kind, 'unknown');
  fixture.enqueue({ method: 'GET', path: '/api/state', mode: 'unavailable' });
  assert.equal((await call(fixture, encodeWork('state', {}))).kind, 'unavailable');
  fixture.enqueue({ method: 'POST', path: '/api/items', response: { status: 503, body: { error: 'unavailable' } } });
  const serverFailure = await call(fixture, notApplied);
  assert.equal(serverFailure.ok, true);
  assert.equal(serverFailure.status, 503);
  assert.equal(fixture.ledger[0].requestId, 'acceptance-write');
  assert.equal(fixture.ledger[0].count, 1);
  // No session-intent provider or automatic replay is installed by a new fixture.
  assert.equal(replacement.ledger.length, 2);
}));
test('Social codec uses raw native bodies and lost/malformed mutations stay unknown', () => owned(async runtime => {
  const fixture = await startFixture(runtime, 'social');
  const encoded = encodeSocial('addBrand', { name: 'Synthetic brand' });
  fixture.enqueue({ method: 'POST', path: '/api/brands', response: { status: 200, body: { id: 'brand001', name: 'Synthetic brand' } } });
  assert.deepEqual((await call(fixture, encoded)).body, { id: 'brand001', name: 'Synthetic brand' });
  for (const mode of ['malformed', 'applied-but-response-lost', 'not-applied']) {
    fixture.enqueue({ method: 'POST', path: '/api/brands', mode, response: { status: 200, body: { id: 'brand002', name: 'Synthetic brand' } } });
    assert.equal((await call(fixture, encoded)).kind, 'unknown');
  }
  assert.equal(fixture.ledger.length, 4);
  const workspace = await call(fixture, encodeSocial('workspace', {}));
  assert.deepEqual(workspace.body.brands.map(brand => brand.id), ['brand001', 'brand002']);
}));
test('owned config binds loopback services and committed synthetic Wiki provenance', () => owned(async runtime => {
  const profile = join(runtime.root, 'profile');
  const fixtures = await setupFixtures(runtime, repo, profile);
  const config = JSON.parse(await readFile(join(profile, 'service-config.json')));
  assert.equal(config.work, fixtures.work.origin);
  assert.equal(new URL(config.social).hostname, '127.0.0.1');
  for (const source of fixtures.wiki.sources) {
    const git = args => execFileSync('git', [`--git-dir=${source.gitDir}`, ...args], { cwd: repo, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
    assert.equal(git(['config', '--get', 'remote.origin.url']), source.expectedRemote);
    assert.equal(git(['rev-parse', 'main']), fixtures.wiki.commits[source.namespace]);
    assert.ok(git(['ls-tree', '-r', '--name-only', 'main']).includes('index.md'));
  }
}));

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, isolatedEnvironment } from '../runtime.mjs';
import { assertNoServiceMutations, startReadFixture } from './http.mjs';
import { setupFixtures } from './setup.mjs';
import { row, scenarioGaps, fullOutcome } from './results.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
async function owned(run) {
  const runtime = await createRuntime(join(repo, '.t3/acceptance-self-test'));
  try { await run(runtime); } finally { await runtime.close(); }
  await assert.rejects(access(runtime.root), { code: 'ENOENT' });
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
test('shell fixture serves only explicit reads; mutations and unknown paths fail closed', () => owned(async runtime => {
  const fixture = await startReadFixture(runtime, { '/api/workspace': { status: 200, body: { brands: [] } } });
  const read = await fetch(fixture.origin + '/api/workspace');
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { brands: [] });
  for (const [method, path] of [['POST', '/api/workspace'], ['POST', '/api/brands'], ['GET', '/api/private']]) {
    const denied = await fetch(fixture.origin + path, { method });
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: 'fixture_closed_route' });
  }
  assert.deepEqual(fixture.ledger.map(entry => [entry.method, entry.path, entry.status, entry.count]), [
    ['GET', '/api/workspace', 200, 1], ['POST', '/api/workspace', 404, 2],
    ['POST', '/api/brands', 404, 3], ['GET', '/api/private', 404, 4],
  ]);
}));
test('zero-mutation oracle fails unsolicited rejected writes and retains raw evidence', () => owned(async runtime => {
  for (const [service, path] of [['Work before intentional capture', '/api/state'], ['Social throughout native invocation', '/api/workspace']]) {
    const fixture = await startReadFixture(runtime, { [path]: { status: 200, body: {} } });
    const read = await fetch(fixture.origin + path);
    await read.arrayBuffer();
    assertNoServiceMutations(fixture.ledger, service);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const boundary = fixture.ledger.length;
      const denied = await fetch(fixture.origin + path, { method });
      assert.equal(denied.status, 404);
      assert.deepEqual(await denied.json(), { error: 'fixture_closed_route' });
      const evidence = structuredClone(fixture.ledger);
      assert.throws(() => assertNoServiceMutations(fixture.ledger.slice(boundary), service), error =>
        error.code === 'ERR_ASSERTION' && error.message.includes(`${service}: expected zero mutation attempts`));
      assert.deepEqual(fixture.ledger, evidence);
      assert.deepEqual(fixture.ledger.at(-1), { method, path, status: 404, count: fixture.ledger.length });
    }
  }
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

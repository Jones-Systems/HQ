// The dev-preview tools import the repository's acceptance runtime and fixtures read-only. If another
// change alters what they export, fail here, in portable CI, rather than in someone's first capture.
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { connect, createRuntime, isolatedEnvironment, until } from '../../../tests/acceptance/runtime.mjs';
import { startReadFixture } from '../../../tests/acceptance/fixtures/http.mjs';
import { createWikiCorpus } from '../../../tests/acceptance/fixtures/wiki.mjs';

test('the acceptance modules still export the functions the session uses', () => {
  for (const fn of [createRuntime, connect, until, isolatedEnvironment, startReadFixture, createWikiCorpus]) assert.equal(typeof fn, 'function', fn.name);
  assert.equal(createRuntime.length, 1);
  assert.ok(connect.length >= 1 && createWikiCorpus.length === 3 && startReadFixture.length === 2);
});

test('the runtime still owns a scratch root, loopback servers and children, and removes them on close', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'hq-dev-preview-test-'));
  try {
    const runtime = await createRuntime(join(parent, 'scratch'));
    const { origin, ledger } = await startReadFixture(runtime, { '/ok': { status: 200, body: { fine: true } } });
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.deepEqual(await (await fetch(`${origin}/ok`)).json(), { fine: true });
    assert.equal((await fetch(`${origin}/closed`)).status, 404);
    assert.deepEqual(ledger.map(entry => entry.path), ['/ok', '/closed']);
    const env = isolatedEnvironment(runtime.root, { HQ_SECRET: 'x', KEEP: 'y', NODE_OPTIONS: '--inspect' });
    assert.equal(env.KEEP, 'y');
    assert.equal(env.HQ_SECRET, undefined);
    assert.equal(env.HQ_USER_DATA_DIR, join(runtime.root, 'profile'));
    const result = await runtime.close();
    assert.equal(result.rootAbsent, true);
    await assert.rejects(stat(runtime.root));
  } finally { await rm(parent, { recursive: true, force: true }); }
});

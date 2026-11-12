import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../runtime.mjs';
import { startSocial } from './social.mjs';
import { createWikiCorpus } from './wiki.mjs';
import { RECOVERY_SCENARIOS, recoveryOutcome, scenarioGaps, row, replaceRow, fullOutcome } from './results.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
async function owned(run) {
  const runtime = await createRuntime(join(repo, '.t3/acceptance-self-test'));
  try { await run(runtime); }
  finally {
    const cleanup = await runtime.close();
    assert.equal(cleanup.rootAbsent, true);
    assert.equal(cleanup.capturedChildrenClosed, true);
    assert.equal(cleanup.remainingChildren, 0);
  }
  await assert.rejects(access(runtime.root), { code: 'ENOENT' });
}

test('real synthetic Social saves once on response loss; rejection is not applied and execution is denied', () => owned(async runtime => {
  const social = await startSocial(runtime, repo);
  const workspace = await fetch(social.origin + '/api/workspace', { signal: AbortSignal.timeout(5000) });
  const token = (await workspace.json()).csrf;
  const post = (path, body) => fetch(social.origin + path, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Workspace-Token': token,
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const body = { title: 'Synthetic fixture draft', body: 'Synthetic only', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 };
  social.armSave('lose');
  assert.throws(() => social.armSave('reject'));
  await assert.rejects(post('/api/content', body));
  const applied = await social.state();
  assert.equal(applied.content.length, 1);
  assert.equal(applied.content[0].title, body.title);
  assert.equal(social.ledger.filter(entry => entry.method === 'POST').length, 1);
  assert.equal(social.ledger.at(-1).responseLost, true);
  social.armSave('reject');
  const denied = await post('/api/content', { ...body, id: applied.content[0].id, version: applied.content[0].version, title: 'Rejected' });
  assert.equal(denied.status, 422); await denied.arrayBuffer();
  assert.deepEqual((await social.state()).content, applied.content);
  const blocked = await post('/api/runs', { tool: 'any', input: {}, is_example: true });
  assert.equal(blocked.status, 404); await blocked.arrayBuffer();
  assert.deepEqual((await social.state()).runs, []);
  assert.equal(social.ledger.some(entry => JSON.stringify(entry).includes(token)), false, 'workspace token never retained');
  await social.stop();
  await assert.rejects(social.state());
}));

test('partial Social startup and deliberate failure close children and scratch without touching a peer', async () => {
  await owned(async peer => {
    const marker = join(peer.root, 'peer.txt');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(marker, 'keep');
    await assert.rejects(owned(async runtime => {
      await startSocial(runtime, repo);
      throw new Error('deliberate fixture failure');
    }), /deliberate fixture failure/);
    await assert.rejects(owned(runtime => startSocial(runtime, join(runtime.root, 'missing-repository'))), /Social startup failed/);
    assert.equal(await readFile(marker, 'utf8'), 'keep');
  });
});

test('Wiki unavailability control restores only owned synthetic repositories on cleanup', () => owned(async runtime => {
  const profile = join(runtime.root, 'profile'); await mkdir(profile);
  const corpus = await createWikiCorpus(runtime, repo, profile);
  assert.ok(Object.values(corpus.commits).every(commit => /^[a-f0-9]{40}$/.test(commit)));
  await assert.rejects(corpus.setAvailable('../outside', false), /Invalid synthetic Wiki control/);
  await corpus.setAvailable('bl', false);
  await assert.rejects(access(corpus.sources[0].gitDir), { code: 'ENOENT' });
  await corpus.setAvailable('bl', true);
  await access(corpus.sources[0].gitDir);
  await corpus.setAvailable('bl', false);
}));

test('recovery subset requires every observed row without releasing existing gap and held obligations', () => {
  const rows = scenarioGaps(), prerequisite = [{ id: 'native', status: 'pass' }];
  for (const id of ['native-prerequisites', 'renderer-isolation', 'domain-round-trip', 'shell-restart', ...RECOVERY_SCENARIOS]) {
    assert.notEqual(recoveryOutcome(rows), 'recovery-passed');
    replaceRow(rows, row(id, 'pass', prerequisite, ['observed']));
  }
  assert.equal(recoveryOutcome(rows), 'recovery-passed');
  assert.equal(fullOutcome(rows), 'platform-or-integration-gap');
  assert.equal(rows.find(row => row.id === 'local-folder-source').status, 'held');
  assert.equal(rows.find(row => row.id === 'capability-closure').status, 'gap');
  assert.equal(recoveryOutcome([...rows, rows[0]]), 'failed');
  replaceRow(rows, row('wiki-committed-corpus', 'fail', prerequisite, ['first failure']));
  assert.equal(recoveryOutcome(rows), 'failed');
});

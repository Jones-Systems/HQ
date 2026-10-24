import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, lstat, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../runtime.mjs';
import { startPlanner } from './planner.mjs';
import { galleryBytes, sha256, startGallery, writeGalleryCorpus } from './remote-gallery.mjs';
import { createLocalFolder, PREVIEW_PNG } from './local-folder.mjs';
import { row, replaceRow, scenarioGaps, selectedOutcome, fullOutcome, routineOutcome, ROUTINE_SCENARIOS, SELECTED_SCENARIOS } from './results.mjs';

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

test('selected passes replace reserved gaps; held edges and duplicate IDs cannot pass', () => {
  const rows = scenarioGaps(), prerequisite = [{ id: 'native', status: 'pass' }];
  for (const id of ['native-prerequisites', 'renderer-isolation', 'domain-round-trip', 'shell-restart', ...SELECTED_SCENARIOS]) replaceRow(rows, row(id, 'pass', prerequisite, ['observed']));
  assert.equal(rows.filter(r => r.id === 'work-service-replay').length, 1);
  assert.equal(selectedOutcome(rows), 'selected-passed');
  assert.equal(selectedOutcome(rows, { distinctHost: true }), 'platform-or-integration-gap');
  replaceRow(rows, row('remote-gallery-distinct-host', 'pass', prerequisite, ['observed remote process/forward']));
  assert.equal(selectedOutcome(rows, { distinctHost: true }), 'selected-passed');
  assert.equal(selectedOutcome([...rows, row('domain-Wiki', 'gap', [{ id: 'mounted', status: 'gap' }])]), 'platform-or-integration-gap');
  assert.equal(fullOutcome(rows), 'platform-or-integration-gap');
  replaceRow(rows, row('local-folder-source', 'held', prerequisite, ['thumbnail unavailable']));
  assert.equal(selectedOutcome(rows), 'platform-or-integration-gap');
  replaceRow(rows, row('work-service-replay', 'fail', prerequisite, ['first failure']));
  assert.equal(selectedOutcome(rows), 'failed');
  assert.throws(() => replaceRow([...rows, rows[0]], rows[0]), /Duplicate result row/);
});

test('four routine journeys require every result; release holds stay visible and any observed failure fails', () => {
  const rows = scenarioGaps(), prerequisite = [{ id: 'native', status: 'pass' }];
  assert.equal(1 + ROUTINE_SCENARIOS.length, 4);
  for (const id of ['native-prerequisites', 'renderer-isolation', 'domain-round-trip', 'shell-restart', ...ROUTINE_SCENARIOS]) {
    assert.notEqual(routineOutcome(rows), 'routine-passed');
    replaceRow(rows, row(id, 'pass', prerequisite, ['observed']));
  }
  assert.equal(routineOutcome(rows), 'routine-passed');
  assert.equal(rows.find(r => r.id === 'local-folder-source').status, 'held');
  assert.equal(rows.find(r => r.id === 'social-save-and-unknown').status, 'gap');
  assert.equal(rows.find(r => r.id === 'wiki-committed-corpus').status, 'gap');
  assert.equal(selectedOutcome(rows), 'platform-or-integration-gap');
  assert.equal(fullOutcome(rows), 'platform-or-integration-gap');
  assert.equal(routineOutcome([...rows, rows[0]]), 'failed');
  for (const id of ['native-prerequisites', 'remote-gallery-source', 'local-folder-source']) {
    const failed = structuredClone(rows);
    replaceRow(failed, row(id, 'fail', prerequisite, ['first failure']));
    assert.equal(routineOutcome(failed), 'failed');
  }
  assert.equal(routineOutcome([...rows, row('domain-Wiki', 'gap', [{ id: 'mounted', status: 'gap' }])]), 'platform-or-integration-gap');
});

test('real Planner commits once before response loss; lookup and retained DB restart preserve one item/version', () => owned(async runtime => {
  const planner = await startPlanner(runtime, repo);
  const before = await planner.state();
  const requestId = 'acceptance-fixture-create';
  const body = JSON.stringify({ fields: { title: 'Synthetic fixture capture', status: 'inbox' } });
  planner.loseNextCreateResponse();
  await assert.rejects(fetch(planner.origin + '/api/items', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Planning-Request': '1', 'X-Request-Id': requestId,
  }, body, signal: AbortSignal.timeout(5000) }));
  const applied = await planner.state();
  assert.equal(applied.items.length, 1);
  assert.equal(applied.state_version, before.state_version + 1);
  assert.equal(planner.ledger[0].responseLost, true);
  const lookup = await fetch(planner.origin + '/api/requests/replay', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Planning-Request': '1' },
    body: JSON.stringify({ request_id: requestId, mode: 'lookup', method: 'POST', path: '/api/items',
      body_b64: Buffer.from(body).toString('base64'), sent_after_version: before.state_version }), signal: AbortSignal.timeout(5000) });
  assert.equal(lookup.status, 200);
  assert.equal((await lookup.json()).outcome, 'replayed');
  await planner.restart();
  const retained = await planner.state();
  assert.deepEqual(retained.items, applied.items);
  assert.equal(retained.state_version, applied.state_version);
  assert.equal(planner.ledger.length, 2, 'oracle reads bypass the app request ledger');
  const read = await fetch(planner.origin + '/api/state', { signal: AbortSignal.timeout(5000) });
  assert.equal((await read.json()).items[0].id, applied.items[0].id);
  assert.deepEqual(planner.ledger.map(entry => [entry.method, entry.path]), [['POST', '/api/items'], ['POST', '/api/requests/replay'], ['GET', '/api/state']]);
  assert.equal(planner.processes.length, 2);
  for (const [method, path] of [['GET', '/api/private'], ['PUT', '/api/settings'], ['POST', '/api/items/ignored/archive']]) {
    const denied = await fetch(planner.origin + path, { method, signal: AbortSignal.timeout(1000) });
    assert.equal(denied.status, 404);
    await denied.arrayBuffer();
  }
  const afterDenied = await planner.state();
  for (const key of ['items', 'settings', 'state_version']) assert.deepEqual(afterDenied[key], retained[key], `denied routes preserve ${key}`);
}));

test('Planner and gallery close after deliberate failure; a peer root/listener survives', async () => {
  const parent = join(repo, '.t3/acceptance-self-test');
  const runtime = await createRuntime(parent), peer = await createRuntime(parent);
  let planner, gallery;
  try {
    const peerGallery = await startGallery(peer);
    await assert.rejects((async () => {
      try {
        planner = await startPlanner(runtime, repo);
        gallery = await startGallery(runtime);
        throw new Error('deliberate scenario failure');
      } finally { await runtime.close(); }
    })(), /deliberate scenario failure/);
    await assert.rejects(access(runtime.root), { code: 'ENOENT' });
    for (const process of planner.processes) assert.throws(() => globalThis.process.kill(process.pid, 0), { code: 'ESRCH' });
    for (const origin of [planner.origin, gallery.origin]) await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1000) }));
    const response = await fetch(peerGallery.origin + 'registry-export-manifest.json', { signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 200); await response.arrayBuffer();
    await access(peer.root);
  } finally { await runtime.close(); await peer.close(); }
});

test('gallery corpus is portable and immutable; wire faults have distinct digest/parse/connectivity evidence', () => owned(async runtime => {
  const gallery = await startGallery(runtime);
  const manifest = JSON.parse(galleryBytes()['registry-export-manifest.json']);
  for (const [path, digest] of Object.entries(manifest.files)) {
    const response = await fetch(gallery.origin + path, { signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 200);
    assert.equal(sha256(Buffer.from(await response.arrayBuffer())), digest);
    assert.equal(gallery.ledger.at(-1).sha256, digest);
  }
  gallery.setMode('bad-digest');
  const bad = await fetch(gallery.origin + 'data/gallery-index.json', { signal: AbortSignal.timeout(1000) });
  assert.notEqual(sha256(Buffer.from(await bad.arrayBuffer())), manifest.files['data/gallery-index.json']);
  gallery.setMode('malformed');
  const malformed = await fetch(gallery.origin + 'registry-export-manifest.json', { signal: AbortSignal.timeout(1000) });
  await assert.rejects(malformed.json(), SyntaxError);
  gallery.setMode('normal');
  const refused = await fetch(gallery.origin + 'not-in-corpus', { signal: AbortSignal.timeout(1000) });
  assert.equal(refused.status, 404); await refused.arrayBuffer();
  await gallery.stop();
  await assert.rejects(fetch(gallery.origin, { signal: AbortSignal.timeout(1000) }));
  assert.deepEqual(await gallery.diskDigests(), gallery.digests);
  const portable = await writeGalleryCorpus(join(runtime.root, 'remote-export'));
  assert.deepEqual(portable.digests, gallery.digests);
  await assert.rejects(writeGalleryCorpus(portable.root), { code: 'EEXIST' });
  const cancelled = join(runtime.root, 'cancelled-export');
  const controller = new AbortController();
  const exporting = writeGalleryCorpus(cancelled, { signal: controller.signal });
  controller.abort(new Error('deliberate export cancellation'));
  await assert.rejects(exporting, /deliberate export cancellation/);
  await assert.rejects(access(cancelled), { code: 'ENOENT' });
}));

test('local selection contains only synthetic files and exact negative fixtures', () => owned(async runtime => {
  const profile = join(runtime.root, 'profile'); await mkdir(profile);
  const fixture = await createLocalFolder(runtime, profile);
  const config = JSON.parse(await readFile(join(profile, 'design-catalog.json'), 'utf8'));
  assert.equal(config.root.rootId, fixture.rootId);
  assert.equal(config.generation, fixture.generation);
  assert.equal((await lstat(join(fixture.root, 'Symlink-child'))).isSymbolicLink(), true);
  assert.equal((await lstat(join(fixture.root, 'Escape-preview/.hq'))).isSymbolicLink(), true);
  assert.equal((await lstat(join(fixture.root, 'Linked-preview/.hq/preview.png'))).isSymbolicLink(), true);
  assert.equal(fixture.previewDigest, `sha256:${sha256(PREVIEW_PNG)}`);
  await fixture.makeUnavailable();
  await assert.rejects(access(fixture.root), { code: 'ENOENT' });
}));

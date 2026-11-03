import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImportsController, summarizePlan } from '../src/controller.ts';
import { listRecords, planImport } from '../src/importer.ts';
import { checkHtmlBundle, checkPng, checkRecording, checkUrl, isSafeBundlePath } from '../src/media.ts';
import { mp4, png, PROJECT, setup, source, webm } from './fixtures.ts';

test('controller: pick → preview → apply → repeat is a no-op → undo', async () => {
  const { storage, deps, clock } = setup();
  let seed = 0;
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(seed) });
  let notifications = 0;
  controller.subscribe(() => { notifications += 1; });
  await controller.choose();
  assert.equal(controller.getState().status, 'planned');
  assert.equal(controller.getState().summary!.canApply, true);
  assert.equal(storage.commitCalls, 0, 'previewing writes nothing');
  await controller.apply();
  assert.equal(controller.getState().status, 'applied');
  assert.equal(controller.getState().history.length, 1);
  assert.ok(notifications > 0);

  clock.tick();
  await controller.choose();
  assert.equal(controller.getState().summary!.canApply, false);
  assert.match(controller.getState().summary!.headline, /change nothing/u);
  const commits = storage.commitCalls;
  await controller.apply();
  assert.equal(storage.commitCalls, commits, 'apply on a no-op plan writes nothing');

  seed = 0;
  clock.tick();
  await controller.undo(controller.getState().history[0]!.importId);
  assert.match(controller.getState().message!, /removed 4/u);
  assert.equal(controller.getState().history[0]!.undone, true);
  assert.equal((await listRecords(deps, PROJECT)).every((record) => record.tombstone !== null), true);
});

test('controller: missing capabilities are reported unavailable, never faked', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT);
  assert.equal(controller.getState().canPick, false);
  assert.equal(controller.getState().canSave, false);
  await controller.choose();
  assert.match(controller.getState().message!, /unavailable/u);
  const bundle = await controller.exportNow();
  assert.ok(bundle);
  assert.equal(controller.getState().lastExport!.saved, null);
  assert.match(controller.getState().message!, /Saving to disk is unavailable/u);
});

test('controller: the private draft backup needs explicit confirmation; switching choice clears it', async () => {
  const { deps } = setup();
  const saved: string[] = [];
  const controller = createImportsController(deps, PROJECT, { saveBundle: async (_bytes, name, kind) => { saved.push(`${kind}:${name}`); return true; } });
  controller.setExportChoice('draft-backup');
  assert.equal(await controller.exportNow(), null);
  assert.equal(saved.length, 0);
  controller.setConfirmPrivate(true);
  const drafts = await controller.exportNow();
  assert.equal(drafts!.privacy, 'private');
  controller.setExportChoice('export');
  assert.equal(controller.getState().confirmPrivate, false);
  controller.setExportChoice('draft-backup');
  assert.equal(await controller.exportNow(), null, 'confirmation does not persist across choices');
  assert.deepEqual(saved, ['draft-backup:hq-design-draft-backup-20261020120000.json']);
});

test('controller: conflicts surface and resolve explicitly', async () => {
  const { deps, clock } = setup();
  let seed = 0;
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(seed) });
  await controller.choose();
  await controller.apply();
  const { editImportedRecord } = await import('../src/importer.ts');
  const record = (await listRecords(deps, PROJECT)).find((item) => item.itemKey === 'screens/home.png')!;
  await editImportedRecord(deps, record.recordId, { notes: 'mine' });
  seed = 1;
  clock.tick();
  await controller.choose();
  assert.match(controller.getState().summary!.detail, /1 conflicts/u);
  await controller.apply();
  assert.equal(controller.getState().conflicts.length, 1);
  await controller.resolve(controller.getState().conflicts[0]!.recordId, 'keep-current');
  assert.equal(controller.getState().conflicts.length, 0);
});

test('rejections explain that nothing was written', async () => {
  const { deps } = setup();
  const result = await planImport(deps, { projectId: PROJECT, source: source(0, { version: 7 }) });
  const summary = summarizePlan(result);
  assert.equal(summary.canApply, false);
  assert.match(summary.headline, /newer format version.*Nothing was written/u);
});

test('media checks: signatures, dimensions, safe paths and URL policy', () => {
  assert.deepEqual(checkPng(png(1, 2)), { ok: true, value: { w: 1, h: 2 } });
  assert.equal(checkPng(png(0, 2)).ok, false);
  assert.equal(checkPng(png(40_000, 2)).ok, false);
  assert.equal(checkRecording('video/mp4', mp4()).ok, true);
  assert.equal(checkRecording('video/webm', webm()).ok, true);
  assert.equal(checkRecording('video/webm', mp4()).ok, false);
  assert.equal(checkRecording('video/quicktime', mp4()).ok, false);
  for (const path of ['../x', '/abs', 'C:/x', 'a\\b', 'a//b', './a', 'a/./b', '']) assert.equal(isSafeBundlePath(path), false, path);
  assert.equal(isSafeBundlePath('assets/img/logo.png'), true);
  // Encoded dot segments and trailing space/dot segments normalise into traversal elsewhere.
  for (const path of ['%2e%2e/x', '.%2E/x', 'a/%2e%2e/b', 'a%2Fb', '.. /x', 'x./y', 'a/b.', 'a /b']) assert.equal(isSafeBundlePath(path), false, path);
  for (const path of ['index.html', 'css/site.css', 'my file.html', '.well-known/a.json']) assert.equal(isSafeBundlePath(path), true, path);
  const html = { path: 'index.html', mediaType: 'text/html', bytes: new Uint8Array(1) };
  assert.equal(checkHtmlBundle('index.html', [html, { ...html, path: 'INDEX.html' }]).ok, false, 'case-folded duplicate');
  assert.equal(checkHtmlBundle('main.html', [html]).ok, false);
  assert.equal(checkHtmlBundle('index.html', [html, { path: 'run.exe', mediaType: 'application/x-msdownload', bytes: new Uint8Array(1) }]).ok, false);
  assert.deepEqual(checkUrl('HTTPS://Example.COM/a b'), { ok: true, value: { url: 'https://example.com/a%20b' } });
  for (const url of ['javascript:alert(1)', 'file:///x', 'https://u:p@example.com', ' https://example.com', 'not a url']) assert.equal(checkUrl(url).ok, false, url);
});

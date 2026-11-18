import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GALLERY_TITLE, sha256 } from '../fixtures/remote-gallery.mjs';
import { uiDriver } from './ui.mjs';

const SOURCE_SECTION = 'section[aria-label="Project sources"]';
export async function localFolderScenario(context) {
  context.begin('local-folder-source');
  const ui = uiDriver(context), fixture = context.fixtures.local;
  await context.domain('Design');
  await ui.click('Refresh', 'section[aria-label="Project folders"]');
  await context.until(() => ui.evaluate(`document.querySelectorAll('.hqp-tile-source').length === ${fixture.eligible.length}`), 'eligible local folder cards');
  assert.deepEqual(await ui.evaluate(`[...document.querySelectorAll('.hqp-tile-source .hqp-tile-title')].map(e => e.textContent).sort()`), fixture.eligible);
  const preview = await ui.evaluate(`window.hqServices.design.call('catalog.preview', {ref:${JSON.stringify({ digest: fixture.previewDigest, mediaType: 'image/png', bytes: context.fixtures.previewBytes })}}).then(r => r.ok ? {ok:true,bytes:Array.from(r.value)} : r)`);
  assert.equal(preview.ok, true);
  assert.equal(`sha256:${sha256(Buffer.from(preview.bytes))}`, fixture.previewDigest);
  await context.capture('local-folder-catalog');
  await ui.sources();
  await ui.click('Refresh Local projects', SOURCE_SECTION);
  const ready = await ui.sourceRow('Local projects', 'ready');
  const entries = (await ui.readSources('list')).filter(item => item.entry.rootId === fixture.rootId).map(item => item.entry);
  assert.deepEqual(entries.map(entry => entry.relativePath).sort(), fixture.eligible);
  for (const entry of entries) assert.deepEqual(entry.previews.map(ref => ref.digest), entry.relativePath === 'Alpha-preview' ? [fixture.previewDigest] : []);
  assert.ok(ready.generation > fixture.generation);
  const persisted = JSON.parse(await readFile(join(context.profile, 'design-catalog.json'), 'utf8'));
  assert.equal(persisted.generation, ready.generation);
  await context.restartApp();
  await ui.sources();
  assert.deepEqual(await ui.sourceRow('Local projects', 'ready'), ready);
  assert.deepEqual((await ui.readSources('list')).filter(item => item.entry.rootId === fixture.rootId).map(item => item.entry), entries);
  await fixture.makeUnavailable();
  await ui.click('Refresh Local projects', SOURCE_SECTION);
  const stale = await ui.sourceRow('Local projects', 'stale');
  assert.equal(stale.lastSuccessAt, ready.lastSuccessAt);
  assert.deepEqual((await ui.readSources('list')).filter(item => item.entry.rootId === fixture.rootId).map(item => item.entry), entries);
  await context.domain('Design');
  await ui.click('Refresh', 'section[aria-label="Project folders"]');
  await context.until(() => ui.evaluate(`document.querySelector('section[aria-label="Project folders"] [role="alert"]')?.textContent.includes('Cached projects remain available')`), 'failed local refresh retains cards');
  assert.deepEqual(await ui.evaluate(`[...document.querySelectorAll('.hqp-tile-source .hqp-tile-title')].map(e => e.textContent).sort()`), fixture.eligible);
  await context.capture('local-folder-last-good');
  context.held({ scenario: 'HQ-07', eligible: fixture.eligible, previewDigest: fixture.previewDigest,
    generationBeforeRestart: ready.generation, generationAfterRestart: ready.generation, lastGoodAfterFailure: true,
    selection: 'Harness-preseeded persisted root; native chooser untested',
    heldEdge: 'Displayed preview image: modules/design/app/compose/bridged-workspace.ts readThumbnail always throws; catalog.preview bytes verified, no rendered thumbnail claim. Requires production-owner binding.',
    negatives: ['symlink child', 'hidden/invalid segment', 'ordinary file', 'symlink preview', 'escaping .hq directory', 'bad raster bytes'] });
}

export async function galleryScenario(context, gallery = context.fixtures.gallery) {
  const distinct = gallery.distinctHost === true;
  context.begin(distinct ? 'remote-gallery-distinct-host' : 'remote-gallery-source');
  const ui = uiDriver(context);
  const label = distinct ? 'Acceptance distinct-host gallery' : 'Acceptance gallery';
  const capture = name => context.capture((distinct ? 'gallery-host-' : 'gallery-') + name);
  const ledger = () => gallery.readLedger ? gallery.readLedger() : gallery.ledger;
  async function captureSettings(name) {
    await ui.evaluate(`new Promise(resolve => { document.querySelector(${JSON.stringify(SOURCE_SECTION)}).scrollIntoView({block:'start'}); requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))); })`);
    await context.until(() => ui.evaluate(`document.querySelector(${JSON.stringify(SOURCE_SECTION)}).getBoundingClientRect().top < 100`), 'Project sources section visible for evidence');
    await capture(name);
  }
  await ui.sources();
  await ui.fill('Gallery label', label);
  await ui.fill('Gallery base URL', gallery.origin);
  await ui.click('Enroll gallery', SOURCE_SECTION);
  const ready = await ui.sourceRow(label, 'ready');
  const listed = (await ui.readSources('list')).filter(item => item.entry.hostId === ready.hostId);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].entry.displayName, GALLERY_TITLE);
  assert.equal(listed[0].entry.metadata.inventoryIntegrity, 'sha256-verified');
  const expected = ['registry-export-manifest.json', 'data/gallery-index.json', 'projects/synthetic/data/collection.json'];
  const enrolledLedger = await ledger();
  assert.deepEqual(enrolledLedger.map(entry => entry.path), expected.map(path => '/' + path));
  for (const entry of enrolledLedger) {
    assert.equal(entry.method, 'GET'); assert.equal(entry.status, 200);
    assert.equal(entry.sha256, gallery.digests[entry.path.slice(1)]);
  }
  const registryPath = join(context.profile, 'sources/registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const saved = registry.sources.find(source => source.sourceId === ready.sourceId);
  assert.equal(saved.base, gallery.origin);
  assert.deepEqual(saved.snapshot.entries, listed.map(item => item.entry));
  await context.domain('Design');
  await ui.click('Refresh sources', 'section[aria-label="Interactive project"]');
  await context.until(() => ui.evaluate(`document.querySelector('select[aria-label="Interactive source project"]')?.textContent.includes(${JSON.stringify(GALLERY_TITLE)})`), 'gallery project visible');
  await capture('enrolled');
  await ui.sources();
  await ui.sourceRow(label, 'ready');
  await captureSettings('enrolled-settings');
  await context.restartApp();
  await ui.sources();
  assert.deepEqual(await ui.sourceRow(label, 'ready'), ready);
  assert.deepEqual((await ui.readSources('list')).filter(item => item.entry.hostId === ready.hostId), listed);
  assert.equal((await ledger()).length, 3, 'restart reads persisted snapshot without fetching it again');
  const failures = [];
  for (const mode of ['bad-digest', 'malformed', 'down']) {
    if (mode === 'down') await gallery.stop(); else await gallery.setMode(mode);
    await ui.click(`Refresh ${label}`, SOURCE_SECTION);
    const stale = await ui.sourceRow(label, 'stale');
    assert.ok(stale.generation > (failures.at(-1)?.generation ?? ready.generation));
    assert.equal(stale.lastSuccessAt, ready.lastSuccessAt);
    assert.deepEqual((await ui.readSources('list')).filter(item => item.entry.hostId === ready.hostId).map(item => item.entry), saved.snapshot.entries);
    const current = JSON.parse(await readFile(registryPath, 'utf8')).sources.find(source => source.sourceId === ready.sourceId);
    assert.deepEqual(current.snapshot, saved.snapshot);
    failures.push({ mode, state: stale.state, generation: stale.generation });
  }
  await captureSettings('last-good-stale');
  await context.domain('Design');
  await ui.click('Refresh sources', 'section[aria-label="Interactive project"]');
  await context.until(() => ui.evaluate(`document.querySelector('select[aria-label="Interactive source project"]')?.textContent.includes(${JSON.stringify(GALLERY_TITLE)})`), 'last good gallery still visible');
  await ui.sources();
  const selector = `${SOURCE_SECTION} .wiki-manager-source`;
  assert.equal(await ui.evaluate(`(() => { const r = [...document.querySelectorAll(${JSON.stringify(selector)})].find(r => r.querySelector('strong')?.textContent === ${JSON.stringify(label)}); const b = [...(r?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'Remove enrollment'); if (!b || b.disabled) return false; b.click(); return true; })()`), true);
  await context.until(async () => !(await ui.readSources('status')).some(source => source.sourceId === ready.sourceId), 'gallery enrollment removed');
  assert.equal((await ui.readSources('list')).some(item => item.entry.hostId === ready.hostId), false);
  assert.deepEqual(await gallery.diskDigests(), gallery.digests);
  assert.equal(JSON.parse(await readFile(registryPath, 'utf8')).sources.find(source => source.sourceId === ready.sourceId)?.active, false);
  await context.until(() => ui.evaluate(`![...document.querySelectorAll(${JSON.stringify(selector)} + ' strong')].some(node => node.textContent === ${JSON.stringify(label)})`), 'removed gallery absent from settings');
  await captureSettings('removed');
  if (distinct) await gallery.restore();
  const removedLedger = await ledger();
  await context.restartApp();
  await ui.sources();
  assert.equal((await ui.readSources('status')).some(source => source.sourceId === ready.sourceId), false);
  assert.deepEqual(await gallery.diskDigests(), gallery.digests);
  assert.deepEqual(await ledger(), removedLedger, 'removed enrollment stays absent without fetch after restore/restart');
  await captureSettings('removed-after-restart');
  context.passed({ scenario: distinct ? 'HQ-09H' : 'HQ-09', topology: distinct ? 'distinct-host HTTP behind owned SSH relay' : 'same-host loopback', sourceId: ready.sourceId, hostId: ready.hostId,
    digests: gallery.digests, generationBeforeRestart: ready.generation, failures, removalRetainsFiles: true,
    restartWithoutFetch: true, removedRestartWithoutFetch: true,
    ...(distinct ? { binding: gallery.binding, remoteObservations: gallery.observations } : { distinctHostQualification: 'Separate HQ-09H row requires explicit host binding' }) });
}

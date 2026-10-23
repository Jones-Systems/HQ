import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createProjectsController } from '../src/controller.ts';
import { stableStringify } from '../src/content.ts';
import { createProvisionalLocalRegistry } from '../src/registry.ts';
import { exportSessionMemory, importSessionMemory, memoryFor, parseDestination, toDestination } from '../src/session.ts';
import { projectId, versionId, viewId } from '../src/ids.ts';
import type { CatalogReadPort, ProjectRegistryPort } from '../src/contract.ts';
import {
  createFakeCatalog, createFakeClock, createFakeThumbnailPort, createSpyStorage, seedSyntheticWorkspace, sequentialIds, syntheticCatalogEntry,
} from '../fakes/index.ts';

const DRAFT_SEEDS = [
  ['drafts', 'design.requests/draft-1', { text: 'unsent request draft', attachments: ['img-1'] }],
  ['workspace', 'design.requests/drafts/draft-2', { text: 'another unsent draft' }],
  ['workspace', 'design.annotations/drafts/p-1', { note: 'unsaved annotation' }],
] as const;

const isDraft = (namespace: string, key: string) => /draft/iu.test(namespace) || /draft/iu.test(key);

async function setup(count = 3) {
  const storage = createSpyStorage();
  const thumbnails = createFakeThumbnailPort();
  const clock = createFakeClock();
  const seeded = await seedSyntheticWorkspace(storage, thumbnails, count, { clock });
  for (const [namespace, key, value] of DRAFT_SEEDS) storage.seed(namespace, key, value);
  const registry = createProvisionalLocalRegistry({ storage, clock, ids: sequentialIds('registry') });
  const controller = createProjectsController({ registry, storage, thumbnails, clock, ids: sequentialIds('new') });
  await controller.start();
  return { storage, thumbnails, controller, seeded };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('project switching', () => {
  test('A→B→A restores selection, filters, collapsed views and scroll', async () => {
    const { controller, seeded } = await setup();
    const [A, B] = seeded.projectIds as [ReturnType<typeof projectId>, ReturnType<typeof projectId>];
    controller.openProject(A);
    await settle();
    assert.equal(controller.getSnapshot().active?.status, 'ready');
    const contentA = seeded.contents[0]!;
    const versionA = contentA.versions.at(-1)!;
    controller.select(versionA.viewId, versionA.id);
    controller.setDetailFilters({ query: 'view', kinds: ['page'] });
    controller.toggleView(contentA.views[0]!.id);
    controller.setDetailScroll(12, 340);
    const rememberedA = memoryFor(controller.getSnapshot().session, A);

    controller.openProject(B);
    await settle();
    const onB = controller.getSnapshot();
    assert.equal(onB.active?.projectId, B);
    assert.deepEqual(memoryFor(onB.session, B).selection, { viewId: null, versionId: null }, 'B starts with its own memory');
    controller.select(seeded.contents[1]!.versions[0]!.viewId, seeded.contents[1]!.versions[0]!.id);
    controller.setDetailFilters({ query: 'other' });
    controller.setDetailScroll(0, 99);

    controller.openProject(A);
    const backOnA = controller.getSnapshot();
    assert.equal(backOnA.active?.status, 'ready', 'A renders from its local copy without waiting');
    assert.deepEqual(memoryFor(backOnA.session, A), rememberedA);
    assert.deepEqual(memoryFor(backOnA.session, A).selection, { viewId: versionA.viewId, versionId: versionA.id });
    assert.deepEqual(memoryFor(backOnA.session, A).filters, { query: 'view', kinds: ['page'] });
    assert.deepEqual(memoryFor(backOnA.session, A).scroll, { x: 12, y: 340 });
    assert.equal(memoryFor(backOnA.session, B).scroll.y, 99, 'B memory kept independently');
  });

  test('gallery filters, collapsed groups and scroll survive opening a project and going back', async () => {
    const { controller, seeded } = await setup();
    controller.setGalleryFilters({ query: 'synthetic', sort: 'recent' });
    controller.toggleGroup('origin:workspace');
    controller.setGalleryScroll(480);
    const before = controller.getSnapshot().session.gallery;
    controller.openProject(seeded.projectIds[0]!);
    controller.backToGallery();
    assert.deepEqual(controller.getSnapshot().session.gallery, before);
  });

  test('switching never writes: zero StoragePort writes, zero draft-namespace writes, drafts byte-identical', async () => {
    const { controller, storage, seeded } = await setup();
    const draftBytes = DRAFT_SEEDS.map(([namespace, key]) => storage.raw(namespace, key));
    const writesBefore = storage.writes().length;
    const [A, B] = seeded.projectIds as [ReturnType<typeof projectId>, ReturnType<typeof projectId>];
    for (let round = 0; round < 5; round += 1) {
      controller.openProject(A);
      await settle();
      controller.select(seeded.contents[0]!.versions[0]!.viewId, seeded.contents[0]!.versions[0]!.id);
      controller.setDetailScroll(0, round * 10);
      controller.openProject(B);
      await settle();
      controller.backToGallery();
      controller.applyDestination(toDestination({ ...controller.getSnapshot().session, screen: 'project', activeProjectId: A }));
    }
    await settle();
    assert.equal(storage.writes().length - writesBefore, 0, 'navigation performed no writes at all');
    assert.equal(storage.calls.filter((call) => isDraft(call.namespace, call.key)).length, 0, 'no reads or writes touched draft namespaces');
    assert.deepEqual(DRAFT_SEEDS.map(([namespace, key]) => storage.raw(namespace, key)), draftBytes);
  });

  test('edits write only this section\'s workspace documents', async () => {
    const { controller, storage, seeded } = await setup();
    controller.openProject(seeded.projectIds[0]!);
    await settle();
    const view = seeded.contents[0]!.views[0]!;
    assert.deepEqual(await controller.addView('Checkout', 'screen'), { ok: true });
    assert.deepEqual(await controller.addVersion({ viewId: view.id, label: 'New', origin: 'owner-created', capture: { route: '/x', viewport: { w: 800, h: 600, dpr: 1 } } }), { ok: true });
    assert.deepEqual(await controller.createProject('Fresh'), { ok: true });
    assert.ok(storage.writes().length >= 3);
    for (const call of storage.writes()) {
      assert.equal(call.namespace, 'workspace');
      assert.ok(call.key.startsWith('design.projects/'), call.key);
      assert.ok(!isDraft(call.namespace, call.key));
    }
  });

  test('adding a version through the controller keeps earlier versions immutable and selects the new one', async () => {
    const { controller, seeded } = await setup();
    const A = seeded.projectIds[0]!;
    controller.openProject(A);
    await settle();
    const before = controller.getSnapshot().active;
    assert.equal(before?.status, 'ready');
    const earlier = before?.status === 'ready' ? before.content.versions : [];
    const view = seeded.contents[0]!.views[0]!;
    await controller.addVersion({ viewId: view.id, label: 'Later', origin: 'owner-created', capture: { route: '/later', viewport: { w: 390, h: 844, dpr: 3 } } });
    const after = controller.getSnapshot().active;
    assert.equal(after?.status, 'ready');
    if (after?.status !== 'ready') return;
    assert.equal(after.content.versions.length, earlier.length + 1);
    // Persisted and re-read: earlier versions are value-identical, field for field.
    earlier.forEach((version, index) => assert.equal(stableStringify(after.content.versions[index]), stableStringify(version)));
    assert.equal(memoryFor(controller.getSnapshot().session, A).selection.versionId, after.content.versions.at(-1)!.id);
  });

  test('rapid A→B→C shows only C even when earlier loads resolve late', async () => {
    const { controller, storage, seeded } = await setup();
    const [A, B, C] = seeded.projectIds as [ReturnType<typeof projectId>, ReturnType<typeof projectId>, ReturnType<typeof projectId>];
    const hold = storage.holdReads();
    controller.openProject(A);
    controller.openProject(B);
    controller.openProject(C);
    assert.deepEqual([controller.getSnapshot().active?.status, controller.getSnapshot().active?.projectId], ['loading', C]);
    hold.release();
    await settle();
    const snapshot = controller.getSnapshot();
    assert.equal(snapshot.active?.projectId, C);
    assert.equal(snapshot.active?.status, 'ready');
    assert.equal(snapshot.session.activeProjectId, C);
    // A and B's late results only filled their local copies.
    controller.openProject(A);
    assert.equal(controller.getSnapshot().active?.status, 'ready');
  });

  test('warm catalog with a never-resolving thumbnail transport and registry renders immediately', async () => {
    const storage = createSpyStorage();
    const thumbnails = createFakeThumbnailPort();
    thumbnails.mode = 'never';
    const catalog: CatalogReadPort = createFakeCatalog([
      syntheticCatalogEntry(1, { status: 'stale' }), syntheticCatalogEntry(2, { status: 'offline', host: 'fake-host-b', hostLabel: 'Synthetic host B' }),
    ]);
    const registry: ProjectRegistryPort = {
      provenance: { kind: 'provisional-local', label: 'never-resolving synthetic registry' },
      list: () => new Promise(() => {}), create: () => new Promise(() => {}),
    };
    const controller = createProjectsController({ registry, storage, thumbnails, catalog, clock: createFakeClock() });
    void controller.start();
    const snapshot = controller.getSnapshot();
    const items = snapshot.gallery.flatMap((group) => group.items);
    assert.equal(items.length, 2, 'cached source entries are visible without waiting');
    assert.equal(snapshot.registry.status, 'loading');
    assert.deepEqual(items.map((item) => item.kind === 'source' ? item.freshness.status : null), ['stale', 'offline']);
  });

  test('a project id not in the registry stays unresolved rather than matched by title', async () => {
    const { controller } = await setup();
    controller.applyDestination('projects/unknown-project');
    await settle();
    const active = controller.getSnapshot().active;
    assert.equal(active?.projectId, 'unknown-project');
    assert.equal(active?.record, undefined);
  });
});

describe('session memory and destinations', () => {
  test('destinations round-trip and unknown destinations are ignored', () => {
    assert.deepEqual(parseDestination('projects'), { screen: 'gallery' });
    assert.deepEqual(parseDestination(`projects/${encodeURIComponent('a/b c')}`), { screen: 'project', projectId: 'a/b c' });
    assert.equal(parseDestination('requests/123'), null);
    assert.equal(parseDestination('projects/%E0%A4%A'), null);
  });

  test('exported memory restores per-project selection, filters and scroll', async () => {
    const { controller, seeded } = await setup();
    const A = seeded.projectIds[0]!;
    controller.openProject(A);
    controller.select(viewId('fake-view-1-1'), versionId('fake-version-1-1-1'));
    controller.setDetailFilters({ kinds: ['page', 'screen'] });
    controller.setDetailScroll(3, 210);
    controller.setGalleryFilters({ freshness: ['stale'] });
    const restored = importSessionMemory(JSON.parse(JSON.stringify(exportSessionMemory(controller.getSnapshot().session))));
    assert.deepEqual(memoryFor(restored, A), memoryFor(controller.getSnapshot().session, A));
    assert.deepEqual(restored.gallery.filters.freshness, ['stale']);
    assert.equal(restored.screen, 'gallery', 'restoring memory does not reopen or submit anything');
  });
});

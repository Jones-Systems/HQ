import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createProjectsController } from '../src/controller.ts';
import { addView } from '../src/content.ts';
import { createProvisionalLocalRegistry } from '../src/registry.ts';
import { ProjectContentRepository } from '../src/repository.ts';
import { viewId, type ProjectId } from '../src/ids.ts';
import type { ProjectStoragePort } from '../src/contract.ts';
import { createFakeClock, createFakeThumbnailPort, createSpyStorage, seedSyntheticWorkspace, sequentialIds } from '../fakes/index.ts';

const settle = () => new Promise((resolve) => setImmediate(resolve));

interface ReadFaults { failing: boolean; held: Promise<void> | null }

async function setup() {
  const spy = createSpyStorage();
  const faults: ReadFaults = { failing: false, held: null };
  // The controller reads through this wrapper; the outside writer talks to the real storage.
  const storage: ProjectStoragePort = {
    writeDocument: spy.writeDocument.bind(spy),
    async readDocument(namespace, key) {
      if (faults.failing) throw new Error('storage lost');
      const value = await spy.readDocument(namespace, key);
      if (faults.held) await faults.held; // the value was read before the hold, so it can be older than a later write
      return value;
    },
  };
  const thumbnails = createFakeThumbnailPort();
  const clock = createFakeClock();
  const seeded = await seedSyntheticWorkspace(spy, thumbnails, 3, { clock });
  const registry = createProvisionalLocalRegistry({ storage, clock, ids: sequentialIds('registry') });
  const changed: ProjectId[] = [];
  const controller = createProjectsController({ registry, storage, thumbnails, clock, ids: sequentialIds('new'), onContentChange: (project) => changed.push(project) });
  await controller.start();
  // A writer outside the controller, such as a live capture or an import.
  const outside = new ProjectContentRepository(spy, clock);
  const addOutside = (project: ProjectId, id: string) => outside.update(project, (content, now) =>
    addView(content, { id: viewId(id), title: `Outside ${id}`, kind: 'page' }, now));
  return { spy, faults, controller, seeded, changed, addOutside };
}

const viewIds = (controller: ReturnType<typeof createProjectsController>) => {
  const active = controller.getSnapshot().active;
  return active?.status === 'ready' ? active.content.views.map((view): string => view.id) : null;
};

describe('Projects refresh after writes made elsewhere', () => {
  test('re-reads the open project and its gallery summary, and leaves a never-shown project unread', async () => {
    const { spy, controller, seeded, addOutside } = await setup();
    const [A, B] = seeded.projectIds as [ProjectId, ProjectId];
    controller.openProject(A);
    await settle();
    const before = controller.getSnapshot();
    assert.equal(before.summaries.get(A)?.viewCount, seeded.contents[0]!.views.length);
    await addOutside(A, 'outside-1');
    assert.equal(viewIds(controller)?.includes('outside-1'), false, 'the controller does not guess; it is told');
    const readsBefore = spy.calls.filter((call) => call.op === 'read').length;
    await controller.refreshContent(A);
    assert.equal(viewIds(controller)?.includes('outside-1'), true);
    assert.equal(controller.getSnapshot().summaries.get(A)?.viewCount, seeded.contents[0]!.views.length + 1);
    assert.equal(spy.calls.filter((call) => call.op === 'read').length, readsBefore + 1, 'one read');
    // B was never loaded here, so there is nothing stale to refresh and nothing to read.
    await addOutside(B, 'outside-b');
    const readsAfterA = spy.calls.filter((call) => call.op === 'read').length;
    await controller.refreshContent(B);
    assert.equal(spy.calls.filter((call) => call.op === 'read').length, readsAfterA);
    controller.openProject(B);
    await settle();
    assert.equal(viewIds(controller)?.includes('outside-b'), true, 'its first open reads fresh content');
  });

  test('a refresh that finds the same stored revision publishes nothing', async () => {
    const { controller, seeded } = await setup();
    const A = seeded.projectIds[0]!;
    controller.openProject(A);
    await settle();
    const snapshot = controller.getSnapshot();
    let notified = 0;
    const stop = controller.subscribe(() => { notified += 1; });
    await controller.refreshContent(A);
    stop();
    assert.equal(notified, 0);
    assert.equal(controller.getSnapshot(), snapshot);
  });

  test('a read already in flight when the write lands is followed by another read', async () => {
    const { faults, controller, seeded, addOutside } = await setup();
    const A = seeded.projectIds[0]!;
    controller.openProject(A);
    await settle();
    let release!: () => void;
    faults.held = new Promise<void>((resolve) => { release = resolve; });
    const first = controller.refreshContent(A); // reads the stored document, then waits
    await settle();
    await addOutside(A, 'outside-late');
    const second = controller.refreshContent(A); // told after the write; must not settle for the older read
    await settle();
    faults.held = null;
    release();
    await Promise.all([first, second]);
    assert.equal(viewIds(controller)?.includes('outside-late'), true);
  });

  test('keeps the last good content visible when the refresh read fails, and recovers on the next one', async () => {
    const { faults, controller, seeded, addOutside } = await setup();
    const A = seeded.projectIds[0]!;
    controller.openProject(A);
    await settle();
    const known = viewIds(controller);
    await addOutside(A, 'outside-2');
    faults.failing = true;
    await controller.refreshContent(A);
    assert.deepEqual(viewIds(controller), known, 'stale beats empty');
    faults.failing = false;
    await controller.refreshContent(A);
    assert.equal(viewIds(controller)?.includes('outside-2'), true);
  });

  test('stops after dispose', async () => {
    const { spy, controller, seeded, addOutside } = await setup();
    const A = seeded.projectIds[0]!;
    controller.openProject(A);
    await settle();
    controller.dispose();
    await addOutside(A, 'outside-3');
    const reads = spy.calls.filter((call) => call.op === 'read').length;
    await controller.refreshContent(A);
    assert.equal(spy.calls.filter((call) => call.op === 'read').length, reads);
  });
});

describe('Projects reports its own content writes', () => {
  test('announces each committed edit once, with the project that changed', async () => {
    const { controller, seeded, changed } = await setup();
    const A = seeded.projectIds[0]!;
    controller.openProject(A);
    await settle();
    const result = await controller.addView('Pricing', 'page');
    assert.equal(result.ok, true);
    assert.deepEqual(changed, [A]);
    assert.equal(controller.getSnapshot().edit.status, 'idle');
  });

  test('announces a refused edit too, and reloads what the other writer saved', async () => {
    const { controller, seeded, changed, addOutside } = await setup();
    const A = seeded.projectIds[0]!;
    controller.openProject(A);
    await settle();
    await addOutside(A, 'outside-4');
    const result = await controller.addView('Pricing', 'page');
    assert.equal(result.ok, false, 'the cached revision was stale');
    assert.deepEqual(changed, [A], 'a conflict means another writer changed the project, so readers re-read');
    assert.equal(viewIds(controller)?.includes('outside-4'), true);
    const retry = await controller.addView('Pricing', 'page');
    assert.equal(retry.ok, true);
    assert.deepEqual(changed, [A, A]);
  });

  test('a failing listener cannot turn a saved edit into a failed one', async () => {
    const spy = createSpyStorage();
    const thumbnails = createFakeThumbnailPort();
    const clock = createFakeClock();
    const seeded = await seedSyntheticWorkspace(spy, thumbnails, 1, { clock });
    const registry = createProvisionalLocalRegistry({ storage: spy, clock, ids: sequentialIds('registry') });
    const controller = createProjectsController({ registry, storage: spy, thumbnails, clock, ids: sequentialIds('new'),
      onContentChange: () => { throw new Error('listener failed'); } });
    await controller.start();
    controller.openProject(seeded.projectIds[0]!);
    await settle();
    assert.deepEqual(await controller.addView('Pricing', 'page'), { ok: true });
  });
});

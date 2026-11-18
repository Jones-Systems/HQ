import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createProjectContentEvents } from '../content-events.ts';
import { createDesignWorkspace } from '../workspace.ts';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createTransportDouble } from './bridge-double.ts';

it('notifies only the changed project and counts its revisions', () => {
  const events = createProjectContentEvents();
  const seen: string[] = [];
  events.subscribe('a', () => seen.push('a'));
  events.subscribe('b', () => seen.push('b'));
  assert.equal(events.revision('a'), 0);
  events.notify('a');
  events.notify('a');
  assert.deepEqual(seen, ['a', 'a']);
  assert.equal(events.revision('a'), 2);
  assert.equal(events.revision('b'), 0);
});

it('unsubscribes idempotently and isolates a failing listener', () => {
  const events = createProjectContentEvents();
  let calls = 0;
  events.subscribe('a', () => { throw new Error('reader failed'); });
  const stop = events.subscribe('a', () => { calls += 1; });
  events.notify('a');
  stop();
  stop();
  events.notify('a');
  assert.equal(calls, 1);
  assert.equal(events.revision('a'), 2);
});

it('tells every-project listeners which project changed, isolates their failures, and unsubscribes idempotently', () => {
  const events = createProjectContentEvents();
  const seen: string[] = [];
  events.subscribeAll(() => { throw new Error('reader failed'); });
  const stop = events.subscribeAll((projectId) => seen.push(projectId));
  events.subscribe('a', () => seen.push('only-a'));
  events.notify('a');
  events.notify('b');
  assert.deepEqual(seen, ['only-a', 'a', 'b']);
  stop();
  stop();
  events.notify('b');
  assert.deepEqual(seen, ['only-a', 'a', 'b']);
  assert.equal(events.revision('b'), 2);
});

it('gives every-project listeners the same rules as project listeners', async () => {
  const events = createProjectContentEvents();
  let calls = 0;
  const listener = () => { calls += 1; };
  const first = events.subscribeAll(listener);
  events.subscribeAll(listener);
  events.notify('a');
  assert.equal(calls, 2, 'each subscription is its own, even for the same function');
  first();
  events.notify('a');
  assert.equal(calls, 3);
  const seen: string[] = [];
  let stopSecond = () => {};
  events.subscribeAll(() => { seen.push('first'); stopSecond(); });
  stopSecond = events.subscribeAll(() => seen.push('second'));
  events.notify('b');
  assert.deepEqual(seen, ['first'], 'a listener removed during the notification is not called afterwards');
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    events.subscribeAll(async () => { throw new Error('async reader failed'); });
    events.notify('c');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

it('keeps each subscription separate, even for the same function', () => {
  const events = createProjectContentEvents();
  let calls = 0;
  const listener = () => { calls += 1; };
  const first = events.subscribe('a', listener);
  events.subscribe('a', listener);
  events.notify('a');
  assert.equal(calls, 2);
  first();
  events.notify('a');
  assert.equal(calls, 3);
});

it('does not call a listener that an earlier listener removed during the same notification', () => {
  const events = createProjectContentEvents();
  const seen: string[] = [];
  let stopSecond = () => {};
  events.subscribe('a', () => { seen.push('first'); stopSecond(); });
  stopSecond = events.subscribe('a', () => seen.push('second'));
  events.notify('a');
  assert.deepEqual(seen, ['first']);
});

it('absorbs an asynchronous listener failure instead of leaving an unhandled rejection', async () => {
  const events = createProjectContentEvents();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    events.subscribe('a', async () => { throw new Error('async reader failed'); });
    events.notify('a');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

it('gives each workspace one feed, in both the in-memory and the bridged composition', () => {
  const memory = createDesignWorkspace(null);
  const bridged = createDesignWorkspace(createBridgeWorkspaceDocuments(createTransportDouble().transport));
  assert.ok(bridged.bridged);
  assert.equal(typeof memory.contentEvents.subscribe, 'function');
  assert.notEqual(memory.contentEvents, bridged.contentEvents);
  assert.notEqual(createDesignWorkspace(null).contentEvents, memory.contentEvents);
});

it('isolates synthetic stores with their feeds while project edits reach readers in the same workspace', async () => {
  const first = createDesignWorkspace(null);
  const second = createDesignWorkspace(null);
  const project = { id: 'workspace-feed-isolation', name: 'Synthetic project' };
  const [a, b] = await Promise.all([first.contentFor(project), second.contentFor(project)]);
  assert.notEqual(a.repository, b.repository);
  assert.notEqual(a.storage, b.storage);
  const controller = await first.projectsFor(project);
  controller.openProject(a.content.projectId);
  const revision = first.contentEvents.revision(project.id);
  const otherRevision = second.contentEvents.revision(project.id);
  const seen: number[] = [];
  const stop = first.contentEvents.subscribe(project.id, () => seen.push(first.contentEvents.revision(project.id)));
  try {
    assert.deepEqual(await controller.addView('Workspace-local view', 'page'), { ok: true });
    assert.deepEqual(seen, [revision + 1]);
    assert.equal(second.contentEvents.revision(project.id), otherRevision);
    assert.ok((await first.readContent(project)).views.some((view) => view.title === 'Workspace-local view'));
    assert.ok(!(await second.readContent(project)).views.some((view) => view.title === 'Workspace-local view'));
  } finally {
    stop();
    controller.dispose();
  }
});

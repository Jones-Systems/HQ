import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CollectionId, ReferenceId } from '../src/contract.ts';
import { fakePorts } from '../src/fakes.ts';
import { ReferenceLibrary } from '../src/service.ts';
import { buildLibraryView } from '../ui/view-model.ts';
import { appScreenshot, nativeReference, screenshot } from './fixtures.ts';

const project = { id: 'project-alpha', name: 'Alpha' };

async function setup() {
  const ports = fakePorts();
  const library = await ReferenceLibrary.open(ports);
  const ids: ReferenceId[] = [];
  for (const candidate of [screenshot(), appScreenshot(), nativeReference()]) {
    ids.push((await library.importReference(candidate) as { id: ReferenceId }).id);
  }
  return { ports, library, ids };
}

test('cards carry derived evidence labels; only native evidence reads as native execution', async () => {
  const { library, ids } = await setup();
  const view = buildLibraryView(library.state, library.access, { query: '', collectionId: null, selectedId: null }, project);
  const byId = new Map(view.cards.map((card) => [card.id, card]));
  assert.equal(byId.get(ids[1]!)!.evidenceLabel, 'Screenshot of iOS app');
  assert.equal(byId.get(ids[1]!)!.isNativeExecution, false);
  assert.equal(byId.get(ids[1]!)!.caveat, 'Static image — not native execution');
  assert.equal(byId.get(ids[2]!)!.isNativeExecution, true);
  assert.equal(byId.get(ids[0]!)!.sourceLabel, 'example.com/pricing');
  assert.equal(byId.get(ids[1]!)!.sourceLabel, 'Example Notes · iOS · editor');
  assert.equal(byId.get(ids[2]!)!.thumbnail, null, 'native reference without image asset has no thumbnail');
});

test('use-in-project state and deleted collections in the view', async () => {
  const { library, ids } = await setup();
  await library.useInProject(ids[0]!, project.id);
  const created = await library.createCollection('Mobile');
  const collectionId = (created as { value: CollectionId }).value;
  await library.addToCollection(collectionId, ids[1]!);
  let view = buildLibraryView(library.state, library.access, { query: '', collectionId, selectedId: ids[0]! }, project);
  assert.deepEqual(view.cards.map((card) => card.id), [ids[1]]);
  assert.deepEqual(view.collections.map((item) => [item.name, item.count, item.selected]), [['Mobile', 1, true]]);
  assert.deepEqual(view.detail!.usedIn, ['project-alpha']);

  await library.deleteCollection(collectionId);
  view = buildLibraryView(library.state, library.access, { query: '', collectionId, selectedId: null }, project);
  assert.equal(view.collections.length, 0);
  assert.equal(view.allSelected, true, 'a deleted selected collection falls back to all references');
  assert.equal(view.cards.length, 3);
  assert.equal(view.cards.find((card) => card.id === ids[0])!.usedInCurrentProject, true);
});

test('read-only and fenced access produce banners and disable editing', async () => {
  const { ports, library, ids } = await setup();
  ports.storage.failNextWrite = 'before-apply';
  await library.setTags(ids[0]!, ['x']);
  const view = buildLibraryView(library.state, library.access, { query: '', collectionId: null, selectedId: null }, project);
  assert.equal(view.canEdit, false);
  assert.match(view.banner!, /may or may not have completed/u);
  const empty = buildLibraryView({ schema: 'hq.design.references/v1', references: {}, collections: {}, uses: {} }, { mode: 'writable' },
    { query: '', collectionId: null, selectedId: null }, null);
  assert.match(empty.emptyMessage!, /No references yet/u);
});

test('thumbnail presentation follows source kind and stored dimensions', async () => {
  const { thumbnailPresentation } = await import('../ui/view-model.ts');
  const ios = { kind: 'app', platform: 'ios', appId: 'com.example.app', appName: 'Example', screen: null } as const;
  const web = { kind: 'url', url: 'https://example.test/' } as const;
  assert.equal(thumbnailPresentation(ios, 1179, 2556), 'phone');
  assert.equal(thumbnailPresentation(ios, null, null), 'phone', 'a phone app screen is never cropped when its size is unknown');
  assert.equal(thumbnailPresentation(ios, 2556, 1179), 'contained', 'a landscape phone capture stays whole without a portrait frame');
  assert.equal(thumbnailPresentation({ ...ios, platform: 'ipados' }, 1640, 2360), 'contained');
  assert.equal(thumbnailPresentation({ ...ios, platform: 'android' }, 1080, 2400), 'phone');
  assert.equal(thumbnailPresentation(web, 1440, 900), 'banner');
  assert.equal(thumbnailPresentation(web, null, null), 'banner');
  assert.equal(thumbnailPresentation(web, 800, 800), 'contained', 'square images stay whole');
  assert.equal(thumbnailPresentation(web, 390, 844), 'contained', 'portrait website captures stay whole');
  const { library, ids } = await setup();
  const view = buildLibraryView(library.state, library.access, { query: '', collectionId: null, selectedId: null }, null);
  assert.deepEqual(ids.map((id) => view.cards.find((card) => card.id === id)?.thumbnail?.presentation ?? null), ['banner', 'phone', null]);
});

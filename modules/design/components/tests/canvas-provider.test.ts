import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComponentId, DesignSystemId, MotionStudyId, ProjectId, VariantId } from '../src/contract.ts';
import { SYNTHETIC_BUTTON } from '../src/fixtures.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import {
  COMPONENTS_PROVIDER_ID, componentItemKey, createComponentsCanvasProvider, motionItemKey, parseItemKey,
} from '../src/review/canvas-provider.ts';
import { seededWorkspace } from './helpers.ts';

const PROJECT = 'synthetic-project' as ProjectId;
const STUDY = 'synthetic-card-entrance' as MotionStudyId;

async function provided() {
  const workspace = await seededWorkspace();
  await workspace.library.setProjectMembership({
    projectId: PROJECT,
    components: [{ componentId: workspace.button.componentId, revision: 1 }],
    studies: [{ studyId: STUDY, revision: 1 }],
  });
  const provider = createComponentsCanvasProvider({
    library: workspace.library, digest: webCryptoDigest, designSystemId: 'synthetic-system' as DesignSystemId,
  });
  return { ...workspace, provider };
}

test('lists exact-revision variant and motion items for a project, all labelled web-sandbox', async () => {
  const { provider, button } = await provided();
  const items = await provider.listItems(PROJECT);
  assert.equal(provider.providerId, COMPONENTS_PROVIDER_ID);
  assert.deepEqual(items.map((item) => item.kind), [...Array(5).fill('component-variant'), 'motion-study']);
  for (const item of items) {
    assert.equal(item.evidence, 'web-sandbox');
    assert.equal(item.revision, 1);
    assert.equal(item.projectId, PROJECT);
    assert.equal(item.key, `${COMPONENTS_PROVIDER_ID}/${item.kind}/${encodeURIComponent(item.entityId)}`);
    assert.match(item.sourceRevision, /^sha256:[0-9a-f]{64}$/u);
  }
  assert.equal(items[0]?.sourceRevision, button.digest);
  assert.deepEqual(items[0]?.intrinsicSize, SYNTHETIC_BUTTON.size);
  assert.equal(new Set(items.map((item) => item.key)).size, items.length, 'keys are unique');
  assert.deepEqual(await provider.listItems('other-project' as ProjectId), []);
});

test('a newer revision does not move existing items: keys stay bound to their revision', async () => {
  const { provider, library, button } = await provided();
  const before = await provider.listItems(PROJECT);
  await library.saveSource({ ...SYNTHETIC_BUTTON, name: 'Synthetic Button (edited)' });
  assert.deepEqual(await provider.listItems(PROJECT), before);
  const pinned = await provider.resolveItem(componentItemKey(PROJECT, button.componentId, 1, 'primary' as VariantId));
  assert.equal(pinned.status === 'ok' && pinned.item.sourceRevision, button.digest);
  const newer = await provider.resolveItem(componentItemKey(PROJECT, button.componentId, 2, null));
  assert.equal(newer.status === 'ok' && newer.item.title, 'Synthetic Button (edited) r2');
});

test('unknown or malformed keys resolve to missing instead of failing or granting anything', async () => {
  const { provider, button } = await provided();
  for (const key of [
    componentItemKey(PROJECT, button.componentId, 9, null),
    componentItemKey(PROJECT, button.componentId, 1, 'nope' as VariantId),
    motionItemKey(PROJECT, 'missing' as MotionStudyId, 1),
    `${COMPONENTS_PROVIDER_ID}/component-variant/${encodeURIComponent('p/synthetic-button/latest/~default')}`,
    'hq.design.flows/screen/x',
  ]) {
    assert.deepEqual(await provider.resolveItem(key), { status: 'missing', key });
  }
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(provider.listItems(PROJECT, aborted.signal));
});

test('keys round-trip through parsing with encoded identifiers', () => {
  const key = componentItemKey('p/1' as ProjectId, 'a/b c' as ComponentId, 3, 'v/1' as VariantId);
  assert.equal(key.split('/').length, 3);
  assert.deepEqual(parseItemKey(key), { kind: 'component-variant', projectId: 'p/1', componentId: 'a/b c', revision: 3, variantId: 'v/1' });
  assert.deepEqual(parseItemKey(motionItemKey(PROJECT, STUDY, 2)), { kind: 'motion-study', projectId: PROJECT, studyId: STUDY, revision: 2 });
});

test('listing and resolving write nothing to storage', async () => {
  const { provider, storage } = await provided();
  const writes = storage.writes.length;
  await provider.listItems(PROJECT);
  await provider.resolveItem(motionItemKey(PROJECT, STUDY, 1));
  assert.equal(storage.writes.length, writes);
});

test('project membership must name exact revisions that exist', async () => {
  const { library, button } = await provided();
  await assert.rejects(library.setProjectMembership({ projectId: PROJECT, components: [{ componentId: button.componentId, revision: 7 }], studies: [] }), RangeError);
  await assert.rejects(library.setProjectMembership({ projectId: PROJECT, components: [{ componentId: button.componentId } as never], studies: [] }), /exact component revisions/u);
});

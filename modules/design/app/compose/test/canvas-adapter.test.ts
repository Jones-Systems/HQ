import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { providerId, projectId as canvasProjectId, type CanvasItemRef } from '../../../canvas/src/contract.ts';
import { createProviderRegistry } from '../../../canvas/src/providers.ts';
import { createFlowCanvasProvider } from '../../../flows/src/canvas.ts';
import { createFakeFlowStorage } from '../../../flows/src/fakes.ts';
import { createFlowRepository } from '../../../flows/src/repository.ts';
import { projectId as flowsProjectId } from '../../../flows/src/contract.ts';
import { checkout } from '../../../flows/test/fixtures.ts';
import { brandId } from '../../../components/src/model/ids.ts';
import { webCryptoDigest } from '../../../components/src/model/jcs.ts';
import { createComponentsCanvasProvider } from '../../../components/src/review/canvas-provider.ts';
import { createMemoryStorage } from '../../../components/src/workspace/fakes.ts';
import { ComponentLibrary } from '../../../components/src/workspace/library.ts';
import { SYNTHETIC_CARD, SYNTHETIC_CARD_VARIANTS, SYNTHETIC_MOTION, SYNTHETIC_SYSTEM } from '../../../components/src/fixtures.ts';
import type { ProjectId as ComponentsProjectId } from '../../../components/src/contract.ts';
import { createCanvasProviderAdapter, MAX_ENTITY_ID, type AsyncCanvasSource, type SourceItem } from '../canvas-adapter.ts';
import { FAKE_TAG, SYNTHETIC_TAG, WORKSPACE_TAG } from '../labels.ts';

const PROJECT = canvasProjectId('project-synthetic');

async function flowsAdapter(tag = FAKE_TAG) {
  const repository = createFlowRepository(createFakeFlowStorage());
  await repository.save(checkout());
  return {
    repository,
    adapter: createCanvasProviderAdapter({ source: createFlowCanvasProvider(repository), label: 'Flows', tag, toSourceProject: (id) => flowsProjectId(id) }),
  };
}

async function componentsAdapter() {
  const library = new ComponentLibrary(createMemoryStorage(), webCryptoDigest);
  const card = await library.saveSource(SYNTHETIC_CARD);
  await library.saveVariants(card, { componentId: card.componentId, sourceRevision: 1, variants: SYNTHETIC_CARD_VARIANTS });
  await library.saveDesignSystem(SYNTHETIC_SYSTEM);
  const study = await library.saveMotionStudy(SYNTHETIC_MOTION);
  await library.setProjectMembership({
    projectId: brandId('ProjectId', PROJECT), components: [{ componentId: card.componentId, revision: 1 }], studies: [{ studyId: study.id, revision: 1 }],
  });
  const source = createComponentsCanvasProvider({ library, digest: webCryptoDigest, designSystemId: null });
  return createCanvasProviderAdapter({
    source, label: 'Components', tag: SYNTHETIC_TAG, toSourceProject: (id): ComponentsProjectId => brandId('ProjectId', id),
  });
}

describe('flows (T11) behind the canvas (T3) provider shape', () => {
  it('lists the flow map and the prototype player as placeable items with exact-revision refs', async () => {
    const { adapter } = await flowsAdapter();
    const report = await adapter.refresh(PROJECT);
    assert.deepEqual([report.listed, report.errors, report.skipped], [2, [], []]);
    const items = adapter.list(PROJECT);
    assert.deepEqual(items.map((item) => item.kind).sort(), ['flow-map', 'flow-player']);
    for (const item of items) {
      assert.equal(item.ref.providerId, 'hq.design.flows');
      assert.match(item.ref.revision, /^sha256:[0-9a-f]{64}$/u, 'revision is the flow\'s content digest, never "latest"');
      assert.match(item.ref.entityId, /^hq\.design\.flows\/(flow-map|flow-player)\//u);
      assert.equal(adapter.describe(item.ref)?.title, item.title);
    }
  });

  it('labels data from a fake store in the provider label, every title and every item\'s details', async () => {
    const { adapter } = await flowsAdapter(FAKE_TAG);
    await adapter.refresh(PROJECT);
    assert.equal(adapter.label, 'Flows (fake)');
    for (const item of adapter.list(PROJECT)) {
      assert.match(item.title, /\(fake\)$/u);
      assert.ok(item.details?.some((detail) => detail.label === 'Data' && detail.value === FAKE_TAG.text));
    }
  });

  it('shows a workspace record without a data warning but still states that web evidence is not native', async () => {
    const { adapter } = await flowsAdapter(WORKSPACE_TAG);
    await adapter.refresh(PROJECT);
    const [item] = adapter.list(PROJECT);
    assert.equal(adapter.label, 'Flows');
    assert.doesNotMatch(item!.title, /\(workspace\)/u);
    assert.equal(item!.provenance, 'web-approximation');
    assert.ok(item!.details?.some((detail) => detail.label === 'Evidence' && /not native evidence/u.test(detail.value)));
  });

  it('never rebinds: after the flow changes, the old pinned revision is unavailable instead of resolving to the new one', async () => {
    const { adapter, repository } = await flowsAdapter();
    await adapter.refresh(PROJECT);
    const pinned = adapter.list(PROJECT).find((item) => item.kind === 'flow-map')!.ref;
    await repository.save({ ...checkout(), title: 'Checkout, edited' });
    const report = await adapter.refresh(PROJECT, [pinned]);
    assert.deepEqual(report.unavailable, [pinned.entityId]);
    assert.equal(adapter.describe(pinned), null);
    assert.equal(adapter.describe({ ...pinned, revision: adapter.list(PROJECT).find((item) => item.kind === 'flow-map')!.ref.revision })?.kind, 'flow-map');
  });

  it('answers the canvas registry as ready, missing-item or missing-provider without ever throwing', async () => {
    const { adapter } = await flowsAdapter();
    await adapter.refresh(PROJECT);
    const registry = createProviderRegistry();
    registry.register(adapter);
    const ref = adapter.list(PROJECT)[0]!.ref;
    assert.equal(registry.describe(ref).status, 'ready');
    assert.equal(registry.describe({ ...ref, revision: 'sha256:00' }).status, 'missing-item');
    assert.equal(registry.describe({ ...ref, providerId: providerId('someone-else') }).status, 'missing-provider');
    assert.equal(registry.catalog(PROJECT)[0]?.items.length, 2);
  });

  it('exposes nothing for another project', async () => {
    const { adapter } = await flowsAdapter();
    const report = await adapter.refresh(canvasProjectId('another-project'));
    assert.equal(report.listed, 0);
    assert.deepEqual(adapter.list(canvasProjectId('another-project')), []);
  });
});

describe('components (T10) behind the canvas (T3) provider shape', () => {
  it('maps web-sandbox evidence to component-sandbox provenance and labels the synthetic data', async () => {
    const adapter = await componentsAdapter();
    await adapter.refresh(PROJECT);
    const items = adapter.list(PROJECT);
    assert.ok(items.length >= 2);
    for (const item of items) {
      assert.equal(item.provenance, 'component-sandbox');
      assert.match(item.title, /\(synthetic\)$/u);
      assert.match(item.ref.revision, /^sha256:[0-9a-f]{64}$/u);
    }
    assert.deepEqual([...new Set(items.map((item) => item.kind))].sort(), ['component-variant', 'motion-study']);
  });

  it('resolves pinned placements and reports ones the provider no longer has', async () => {
    const adapter = await componentsAdapter();
    await adapter.refresh(PROJECT);
    const pinned = adapter.list(PROJECT)[0]!.ref;
    const gone: CanvasItemRef = { providerId: pinned.providerId, entityId: 'hq.design.components/motion-study/project-synthetic%2Fno-such%2F1', revision: 'sha256:00' };
    const report = await adapter.refresh(PROJECT, [pinned, gone]);
    assert.equal(report.pinned, 1);
    assert.deepEqual(report.unavailable, [gone.entityId]);
    assert.equal(adapter.describe(gone), null);
  });

  it('does not expose another project\'s components under this canvas project', async () => {
    const adapter = await componentsAdapter();
    await adapter.refresh(canvasProjectId('other-project'));
    assert.deepEqual(adapter.list(canvasProjectId('other-project')), []);
  });
});

describe('adapter identity rules', () => {
  const item = (patch: Partial<SourceItem> = {}): SourceItem => ({
    key: 'p/x/1', providerId: 'hq.test', kind: 'k', projectId: 'project-synthetic', title: 'T', sourceRevision: 'rev-1',
    intrinsicSize: { width: 10, height: 10 }, evidence: 'web-approximation', ...patch,
  });
  const source = (items: SourceItem[], fail = false): AsyncCanvasSource<string, SourceItem> => ({
    providerId: 'hq.test',
    async listItems() { if (fail) throw new Error('offline'); return items; },
    async resolveItem(key) { const found = items.find((candidate) => candidate.key === key); return found ? { status: 'ok', item: found } : { status: 'missing', key }; },
  });
  const make = (items: SourceItem[], fail = false) => createCanvasProviderAdapter({ source: source(items, fail), label: 'Test', tag: SYNTHETIC_TAG, toSourceProject: (id) => id });

  it('skips items from another provider, another project, or with an id the canvas cannot store', async () => {
    const adapter = make([
      item(), item({ key: 'p/other-provider', providerId: 'hq.someone-else' }), item({ key: 'p/other-project', projectId: 'elsewhere' }),
      item({ key: 'k'.repeat(MAX_ENTITY_ID + 1) }),
    ]);
    const report = await adapter.refresh(PROJECT);
    assert.equal(report.listed, 1);
    assert.equal(report.skipped.length, 3);
  });

  it('survives a provider failure: the error is reported and the cache from the last good refresh is kept', async () => {
    let fail = false;
    const base = source([item()]);
    const adapter = createCanvasProviderAdapter({
      source: { ...base, listItems: (project, signal) => (fail ? Promise.reject(new Error('offline')) : base.listItems(project, signal)) },
      label: 'Test', tag: SYNTHETIC_TAG, toSourceProject: (id) => id,
    });
    await adapter.refresh(PROJECT);
    fail = true;
    const report = await adapter.refresh(PROJECT);
    assert.deepEqual(report.errors, ['list: offline']);
    assert.equal(adapter.list(PROJECT).length, 1);
    assert.equal((await make([], true).refresh(PROJECT)).errors.length, 1);
  });

  it('notifies subscribers after every refresh and stops after unsubscribe', async () => {
    const adapter = make([item()]);
    let calls = 0;
    const stop = adapter.subscribe!(() => { calls += 1; });
    await adapter.refresh(PROJECT);
    stop();
    await adapter.refresh(PROJECT);
    assert.equal(calls, 1);
  });

  it('describes with copies, so a canvas caller cannot mutate the cached source size', async () => {
    const adapter = make([item()]);
    await adapter.refresh(PROJECT);
    const [first] = adapter.list(PROJECT);
    assert.deepEqual(first!.intrinsicSize, { width: 10, height: 10 });
    assert.notEqual(first!.intrinsicSize, adapter.list(PROJECT)[0]!.intrinsicSize);
  });
});

import { describe, expect, it } from 'vitest';
import { createCompareController, type CompareController } from './controller.ts';
import { createFakeCaptureImages, createFakeCatalog, createFakePreview, createFakeStorage, sampleCatalogData } from './fakes.ts';
import { comparisonId, projectId, versionId } from './ids.ts';
import { createComparison } from './model.ts';
import { presetById } from './presets.ts';

const phone = presetById('phone')!.viewport;

async function settle(controller: CompareController) {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
  return controller.getSnapshot();
}

/** A project that has versions in its catalog but no panels yet, as a project that just gained versions in Projects will. */
function emptyComparison(options: { preview?: boolean } = {}) {
  const data = sampleCatalogData();
  const catalog = createFakeCatalog(data);
  const controller = createCompareController(createComparison(comparisonId('cmp-empty'), projectId('sample-project'), []), {
    catalog, captures: createFakeCaptureImages(), storage: createFakeStorage(), preview: options.preview === false ? null : createFakePreview(),
  });
  return { data, catalog, controller };
}

describe('catalog discovery', () => {
  it('lists the project’s views and versions on demand and leaves pinned panels alone', async () => {
    const { controller, catalog } = emptyComparison();
    expect(controller.getSnapshot().catalog).toEqual({ status: 'idle', views: [] });
    expect(catalog.calls.listViews).toBe(0);
    const loading = controller.loadCatalog();
    expect(controller.getSnapshot().catalog.status).toBe('loading');
    await loading;
    const snap = controller.getSnapshot();
    expect(snap.catalog.status).toBe('ready');
    expect(snap.catalog.views.map((view) => view.name)).toEqual(['Home', 'Pricing']);
    expect([...snap.versions.values()].flat().map((version) => version.versionId)).toEqual(['home-v1', 'home-v2', 'home-v3', 'pricing-v1']);
    expect(snap.comparison.panels).toEqual([]);
    expect(snap.dirty).toBe(false);
  });

  it('reads the catalog once however many times it is asked', async () => {
    const { controller, catalog } = emptyComparison();
    await Promise.all([controller.loadCatalog(), controller.loadCatalog()]);
    await controller.loadCatalog();
    expect(catalog.calls.listViews).toBe(1);
  });

  it('reports a failed read without throwing, and tries again when asked', async () => {
    const data = sampleCatalogData();
    const real = createFakeCatalog(data);
    let failures = 1;
    const controller = createCompareController(createComparison(comparisonId('cmp-x'), projectId('sample-project'), []), {
      catalog: { ...real, async listViews(project, signal) { if (failures-- > 0) throw new Error('offline'); return real.listViews(project, signal); } },
    });
    await controller.loadCatalog();
    expect(controller.getSnapshot().catalog).toMatchObject({ status: 'failed', views: [] });
    await controller.loadCatalog();
    expect(controller.getSnapshot().catalog.status).toBe('ready');
  });
});

describe('catalog refresh', () => {
  /** A catalog whose views can change under the controller, as they do while someone adds versions in Projects. */
  function changing() {
    const real = createFakeCatalog(sampleCatalogData());
    const state = { fail: false, only: null as string | null };
    const controller = createCompareController(createComparison(comparisonId('cmp-r'), projectId('sample-project'), []), {
      catalog: {
        ...real,
        async listViews(project, signal) {
          if (state.fail) throw new Error('offline');
          const views = await real.listViews(project, signal);
          return state.only === null ? views : views.filter((view) => view.name === state.only);
        },
      },
    });
    return { controller, state };
  }

  it('reads again in place when asked to, without reporting a new load', async () => {
    const { controller, state } = changing();
    state.only = 'Home';
    await controller.loadCatalog();
    expect(controller.getSnapshot().catalog.views.map((view) => view.name)).toEqual(['Home']);
    state.only = null;
    const statuses: string[] = [];
    controller.subscribe(() => statuses.push(controller.getSnapshot().catalog.status));
    await controller.loadCatalog({ refresh: true });
    expect(controller.getSnapshot().catalog.views.map((view) => view.name)).toEqual(['Home', 'Pricing']);
    expect(statuses).not.toContain('loading');
  });

  it('keeps the list it had when a refresh fails', async () => {
    const { controller, state } = changing();
    await controller.loadCatalog();
    state.fail = true;
    await controller.loadCatalog({ refresh: true });
    expect(controller.getSnapshot().catalog.status).toBe('ready');
    expect(controller.getSnapshot().catalog.views.map((view) => view.name)).toEqual(['Home', 'Pricing']);
  });
});

describe('adding a panel for an exact version', () => {
  it('starts with a baseline, then a candidate, then references, pinned to exact versions', async () => {
    const { controller } = emptyComparison();
    await controller.addVersionPanel(versionId('home-v1'));
    await controller.addVersionPanel(versionId('home-v2'));
    await controller.addVersionPanel(versionId('home-v3'));
    const { panels } = (await settle(controller)).comparison;
    expect(panels.map((panel) => [panel.role, panel.source.versionId, panel.source.kind])).toEqual([
      ['baseline', 'home-v1', 'static-capture'], ['candidate', 'home-v2', 'static-capture'], ['reference', 'home-v3', 'static-capture'],
    ]);
    expect(controller.getSnapshot().dirty).toBe(true);
    expect(controller.getSnapshot().runtime.get(panels[1].id)?.status).toBe('ready');
  });

  it('takes the capture at the previous panel’s viewport when the version has one', async () => {
    const { controller } = emptyComparison();
    await controller.addVersionPanel(versionId('home-v1'));
    await controller.applyPreset((await settle(controller)).comparison.panels[0].id, 'laptop');
    await controller.addVersionPanel(versionId('home-v2'));
    const { panels } = (await settle(controller)).comparison;
    expect(panels.map((panel) => panel.presetId)).toEqual(['laptop', 'laptop']);
  });

  it('falls back to a live preview for a version with no capture, and says so when there is nothing to show', async () => {
    const data = sampleCatalogData();
    const bare = { ...data.versions[0], versionId: versionId('bare-v1'), captures: [] };
    const make = (withPreview: boolean) => createCompareController(createComparison(comparisonId('cmp-bare'), projectId('sample-project'), []), {
      catalog: createFakeCatalog({ views: data.views, versions: [...data.versions, bare] }),
      captures: createFakeCaptureImages(), preview: withPreview ? createFakePreview() : null,
    });
    const live = make(true);
    await live.addVersionPanel(versionId('bare-v1'));
    expect(live.getSnapshot().comparison.panels[0]).toMatchObject({ source: { kind: 'live-preview', versionId: 'bare-v1' }, viewport: phone });
    const none = make(false);
    await none.addVersionPanel(versionId('bare-v1'));
    expect(none.getSnapshot().comparison.panels).toEqual([]);
    expect(none.getSnapshot().lastError).toBe('no-capture');
  });

  it('refuses a version the catalog does not know and a comparison that is full', async () => {
    const { controller } = emptyComparison();
    await controller.addVersionPanel(versionId('nope-v9'));
    expect(controller.getSnapshot().lastError).toBe('unknown-version');
    expect(controller.getSnapshot().comparison.panels).toEqual([]);
    for (let i = 0; i < 12; i += 1) await controller.addVersionPanel(versionId('home-v1'));
    await controller.addVersionPanel(versionId('home-v2'));
    expect(controller.getSnapshot().comparison.panels).toHaveLength(12);
    expect(controller.getSnapshot().lastError).toBe('too-many-panels');
  });
});

describe('dismissing an error', () => {
  it('clears the last error and nothing else', async () => {
    const { controller } = emptyComparison();
    await controller.addVersionPanel(versionId('nope-v9'));
    const before = controller.getSnapshot();
    expect(before.lastError).toBe('unknown-version');
    controller.dismissError();
    expect(controller.getSnapshot()).toEqual({ ...before, lastError: null });
  });
});

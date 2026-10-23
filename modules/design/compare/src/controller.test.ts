import { describe, expect, it } from 'vitest';
import { createCompareController, type CompareController } from './controller.ts';
import { createFakeCaptureImages, createFakeCatalog, createFakePreview, createFakeStorage, sampleCatalogData, type FakePreviewOptions } from './fakes.ts';
import { comparisonId, panelId, projectId, versionId } from './ids.ts';
import { createComparison, liveSource, staticSource } from './model.ts';
import { comparisonKey, parseComparison } from './persist.ts';
import { presetById } from './presets.ts';

const phone = presetById('phone')!.viewport;
const [a, b, c] = ['a', 'b', 'c'].map(panelId);

function setup(previewOptions: FakePreviewOptions = {}) {
  const data = sampleCatalogData();
  const catalog = createFakeCatalog(data);
  const preview = createFakePreview(previewOptions);
  const images = createFakeCaptureImages();
  const storage = createFakeStorage();
  const v = (id: string) => data.versions.find((item) => item.versionId === id)!;
  const initial = createComparison(comparisonId('cmp-1'), projectId('sample-project'), [
    { id: a, role: 'baseline', source: staticSource(v('home-v1').captures[0]), viewport: phone, width: 380 },
    { id: b, role: 'candidate', source: liveSource(v('home-v2')), viewport: phone, width: 420 },
    { id: c, source: liveSource(v('pricing-v1')), viewport: phone, width: 300 },
  ]);
  const controller = createCompareController(initial, { catalog, preview, captures: images, storage });
  return { data, catalog, preview, images, storage, controller, v };
}

async function settle(controller: CompareController) {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  return controller.getSnapshot();
}

describe('compare controller with labelled fakes', () => {
  it('resolves static captures and fake live previews with exact versions and labels', async () => {
    const { controller, catalog, preview, images } = setup();
    const snap = await settle(controller);
    expect(snap.preview).toEqual({ qualification: 'labelled-fake', label: 'Fake preview' });
    const runA = snap.runtime.get(a)!;
    expect(runA).toMatchObject({ status: 'ready', session: null, contentSize: { width: 390, height: 2532 } });
    expect(runA.imageSrc).toMatch(/^data:image\/svg\+xml/);
    const runB = snap.runtime.get(b)!;
    expect(runB).toMatchObject({ status: 'ready', qualification: 'labelled-fake', capture: null });
    expect(runB.session?.versionId).toBe('home-v2');
    expect(preview.opened.map((request) => request.versionId)).toEqual(['home-v2', 'pricing-v1']);
    expect(images.reads).toEqual(['cap-home-v1-390x844']);
    expect(new Set(catalog.calls.getVersion)).toEqual(new Set(['home-v1', 'home-v2', 'pricing-v1']));
    expect(snap.versions.get(runB.version!.viewId)!.map((item) => item.versionId)).toEqual(['home-v1', 'home-v2', 'home-v3']);
  });

  it('resize through the controller changes only that panel width', async () => {
    const { controller } = setup();
    await settle(controller);
    controller.resize(a, 700);
    expect(controller.getSnapshot().comparison.panels.map((panel) => panel.width)).toEqual([700, 420, 300]);
    expect(controller.getSnapshot().dirty).toBe(true);
  });

  it('synced scroll uses resolved content sizes, and off unlinks', async () => {
    const { controller } = setup({ pages: (id) => (id === 'pricing-v1' ? 2 : 3) });
    await settle(controller);
    controller.setSyncScroll(true, a);
    controller.scroll(a, { x: 0, y: 844 }); // home-v1 capture: range 1688 -> ratio 0.5
    const ys = () => controller.getSnapshot().comparison.panels.map((panel) => panel.scroll.y);
    expect(ys()).toEqual([844, 844, 422]); // home-v2 live: 3 pages (range 1688); pricing: 2 pages (range 844)
    controller.setSyncScroll(false, a);
    controller.scroll(b, { x: 0, y: 100 });
    expect(ys()).toEqual([844, 100, 422]);
  });

  it('choosing a version resolves that exact id; a newer version is never followed', async () => {
    const { controller, catalog, v } = setup();
    await settle(controller);
    catalog.addVersion({ ...v('home-v2'), versionId: versionId('home-v9'), label: 'Home v9', createdAt: '2026-10-20T00:00:00Z' });
    await settle(controller);
    expect(controller.getSnapshot().comparison.panels.map((panel) => panel.source.versionId)).toEqual(['home-v1', 'home-v2', 'pricing-v1']);
    await controller.selectVersion(a, versionId('home-v3'));
    const panelA = controller.getSnapshot().comparison.panels[0];
    expect(panelA.source).toMatchObject({ kind: 'static-capture', versionId: 'home-v3', captureId: 'cap-home-v3-390x844' });
    expect(catalog.calls.getVersion.at(-1)).toBe('home-v3');
    const before = controller.getSnapshot().comparison;
    await controller.selectVersion(a, versionId('does-not-exist'));
    expect(controller.getSnapshot().comparison).toBe(before);
    expect(controller.getSnapshot().lastError).toBe('unknown-version');
  });

  it('a pinned capture that is missing or digest-mismatched fails visibly without substitution', async () => {
    const data = sampleCatalogData();
    const capture = { ...data.versions[0].captures[0], captureDigest: `sha256:${'0'.repeat(64)}` };
    const initial = createComparison(comparisonId('cmp-x'), projectId('sample-project'), [
      { id: a, source: staticSource(capture), viewport: phone },
    ]);
    const images = createFakeCaptureImages();
    const controller = createCompareController(initial, { catalog: createFakeCatalog(data), captures: images });
    const run = (await settle(controller)).runtime.get(a)!;
    expect(run).toMatchObject({ status: 'failed', imageSrc: null });
    expect(run.error).toMatch(/nothing is substituted/);
    expect(images.reads).toEqual([]);
  });

  it('without a preview capability a live panel is unavailable, never a capture stand-in', async () => {
    const data = sampleCatalogData();
    const initial = createComparison(comparisonId('cmp-y'), projectId('sample-project'), [
      { id: b, source: liveSource(data.versions[1]), viewport: phone },
    ]);
    const controller = createCompareController(initial, { catalog: createFakeCatalog(data), captures: createFakeCaptureImages() });
    const snap = await settle(controller);
    expect(snap.preview).toBeNull();
    expect(snap.runtime.get(b)).toMatchObject({ status: 'unavailable', imageSrc: null, capture: null, session: null });
  });

  it('discards and closes a stale preview session after the viewport changes', async () => {
    const { controller, preview } = setup({ manual: true, ignoreAbort: true });
    await settle(controller);
    expect(preview.pending()).toBe(2);
    controller.applyPreset(b, 'tablet-portrait');
    await settle(controller);
    expect(controller.getSnapshot().runtime.get(b)!.status).toBe('loading');
    preview.release(); // the stale phone-sized session for b resolves first, late
    const done = await settle(controller);
    expect(preview.closed).toEqual(['fake-session-1']);
    expect(done.runtime.get(b)!.session!.viewport).toEqual({ w: 820, h: 1180, dpr: 2 });
    expect(done.runtime.get(b)!.session!.sessionId).toBe('fake-session-3');
    expect(preview.opened.filter((request) => request.versionId === 'home-v2').map((request) => request.viewport.w)).toEqual([390, 820]);
  });

  it('an aborting adapter never reports the stale result', async () => {
    const { controller, preview } = setup({ manual: true });
    await settle(controller);
    controller.applyPreset(b, 'tablet-portrait');
    await settle(controller);
    preview.release();
    const done = await settle(controller);
    expect(preview.closed).toEqual([]);
    expect(done.runtime.get(b)).toMatchObject({ status: 'ready', error: null });
    expect(done.runtime.get(b)!.session!.viewport.w).toBe(820);
  });

  it('rejects a preview session reporting a different version', async () => {
    const { controller, preview } = setup({ misreport: (request) => (request.versionId === 'home-v2' ? versionId('home-v3') : null) });
    const snap = await settle(controller);
    expect(snap.runtime.get(b)).toMatchObject({ status: 'failed', session: null });
    expect(preview.closed).toHaveLength(1);
  });

  it('removing a panel and disposing close their sessions', async () => {
    const { controller, preview } = setup();
    await settle(controller);
    controller.removePanel(c);
    expect(preview.closed).toEqual(['fake-session-2']);
    expect(controller.getSnapshot().runtime.has(c)).toBe(false);
    controller.dispose();
    expect(preview.closed).toEqual(['fake-session-2', 'fake-session-1']);
  });

  it('adds a panel pinned to the same exact source without touching others', async () => {
    const { controller } = setup();
    await settle(controller);
    controller.addPanel(b);
    const panels = controller.getSnapshot().comparison.panels;
    expect(panels.map((panel) => [panel.id, panel.width, panel.source.versionId])).toEqual([
      ['a', 380, 'home-v1'], ['b', 420, 'home-v2'], ['c', 300, 'pricing-v1'], ['panel-4', 420, 'home-v2'],
    ]);
  });

  it('saves the layout through the injected storage only on explicit save', async () => {
    const { controller, storage } = setup();
    await settle(controller);
    controller.resize(b, 640);
    expect(storage.writes).toEqual([]);
    storage.failNextWrite = true;
    expect(await controller.save()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ dirty: true, lastError: 'save-failed' });
    expect(await controller.save()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ dirty: false, lastError: null });
    const saved = parseComparison(storage.documents.get(comparisonKey('cmp-1'))!);
    expect(saved).toEqual({ status: 'ok', state: controller.getSnapshot().comparison });
  });
});

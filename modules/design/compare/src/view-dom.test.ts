// @vitest-environment happy-dom
import { toastStore } from '@hq/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompareController, type CompareController } from './controller.ts';
import { createFakeCaptureImages, createFakeCatalog, createFakePreview, createFakeStorage, sampleCatalogData, type FakeStorage } from './fakes.ts';
import { comparisonId, panelId, projectId, versionId } from './ids.ts';
import { createComparison, liveSource, staticSource } from './model.ts';
import { presetById } from './presets.ts';
import { CompareWorkspace, type CompareWorkspaceProps } from './view/index.tsx';

const phone = presetById('phone')!.viewport;
const [a, b, c] = ['a', 'b', 'c'].map(panelId);

function sample(storage: FakeStorage = createFakeStorage()) {
  const data = sampleCatalogData();
  const v = (id: string) => data.versions.find((item) => item.versionId === id)!;
  const controller = createCompareController(createComparison(comparisonId('cmp-1'), projectId('sample-project'), [
    { id: a, role: 'baseline', source: staticSource(v('home-v1').captures[0]), viewport: phone, width: 380 },
    { id: b, role: 'candidate', source: staticSource(v('home-v2').captures[0]), viewport: phone, width: 420 },
    { id: c, source: liveSource(v('pricing-v1')), viewport: phone, width: 300 },
  ]), { catalog: createFakeCatalog(data), preview: createFakePreview(), captures: createFakeCaptureImages(), storage });
  return { controller, storage };
}

function empty(withVersions: boolean) {
  const data = sampleCatalogData();
  return createCompareController(createComparison(comparisonId('cmp-empty'), projectId('sample-project'), []), {
    catalog: createFakeCatalog(withVersions ? data : { views: [], versions: [] }), preview: createFakePreview(), captures: createFakeCaptureImages(), storage: createFakeStorage(),
  });
}

const settle = () => act(async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); });
async function show(controller: CompareController, props: Partial<CompareWorkspaceProps> = {}) {
  const view = render(createElement(CompareWorkspace, { controller, ...props }));
  await settle();
  return view;
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const panelEl = (id: string) => document.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)!;
const panelCount = () => document.querySelectorAll('[data-panel-id]').length;
const sliderEl = () => screen.getByRole('slider');
function openDetails(id: string) {
  const toggle = within(panelEl(id)).getByRole('button', { name: /Details/ });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
}
const describedBy = (element: Element) => (element.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');

beforeEach(() => { document.documentElement.setAttribute('data-hq-motion', 'reduce'); });
afterEach(() => {
  cleanup();
  toastStore.dismiss();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-hq-motion');
});

describe('mode switching', () => {
  it('shows side by side first, swipes the baseline against the candidate, and switches back', async () => {
    const { controller } = sample();
    await show(controller);
    expect(button('Side by side').getAttribute('aria-pressed')).toBe('true');
    expect(button('Swipe').getAttribute('aria-pressed')).toBe('false');
    expect(panelCount()).toBe(3);
    expect(screen.queryByRole('slider')).toBeNull();

    fireEvent.click(button('Swipe'));
    expect(button('Swipe').getAttribute('aria-pressed')).toBe('true');
    expect(sliderEl().getAttribute('aria-valuenow')).toBe('50');
    expect(panelCount()).toBe(0);
    const layers = [...document.querySelectorAll('.cmp-layer')].map((layer) => layer.getAttribute('data-layer'));
    expect(layers).toEqual(['baseline', 'candidate']);
    expect(screen.getByText(/1 other panel is hidden while you swipe/)).toBeTruthy();
    // Both captures stay their own pixels: no filter, blend or opacity on either layer.
    for (const layer of document.querySelectorAll<HTMLElement>('.cmp-layer')) {
      expect(layer.getAttribute('style') ?? '').not.toMatch(/opacity|filter|blend/);
    }

    fireEvent.click(button('Side by side'));
    expect(screen.queryByRole('slider')).toBeNull();
    expect(panelCount()).toBe(3);
  });

  it('keeps the swipe position when you leave and come back', async () => {
    const { controller } = sample();
    await show(controller);
    fireEvent.click(button('Swipe'));
    fireEvent.keyDown(sliderEl(), { key: 'End' });
    fireEvent.click(button('Side by side'));
    fireEvent.click(button('Swipe'));
    expect(sliderEl().getAttribute('aria-valuenow')).toBe('100');
  });

  it('keeps Swipe visible but unavailable without a candidate, with the reason on focus and a guarded click', async () => {
    const { controller } = sample();
    await show(controller);
    await act(async () => { controller.setRole(b, 'reference'); });
    const swipe = button('Swipe');
    expect(swipe.getAttribute('aria-disabled')).toBe('true');
    expect((swipe as HTMLButtonElement).disabled).toBe(false);
    expect(describedBy(swipe)).toMatch(/Swipe needs a candidate panel/);
    fireEvent.click(swipe);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(swipe.getAttribute('aria-pressed')).toBe('false');
  });

  it('explains each way Swipe can be unavailable', async () => {
    const { controller } = sample();
    await show(controller);
    await act(async () => { controller.setRole(b, 'baseline'); });
    expect(describedBy(button('Swipe'))).toMatch(/needs a candidate/);
    await act(async () => { controller.setRole(a, 'candidate'); controller.setRole(c, 'candidate'); });
    expect(describedBy(button('Swipe'))).toMatch(/needs a candidate|candidates/);
    await act(async () => { controller.setRole(b, 'reference'); controller.setRole(a, 'candidate'); controller.setRole(c, 'candidate'); });
    expect(describedBy(button('Swipe'))).toMatch(/needs a baseline panel/);
  });

  it('falls back to side by side if the pair stops being swipeable while you swipe', async () => {
    const { controller } = sample();
    await show(controller);
    fireEvent.click(button('Swipe'));
    await act(async () => { controller.setRole(b, 'reference'); });
    expect(screen.queryByRole('slider')).toBeNull();
    expect(panelCount()).toBe(3);
    expect(button('Swipe').getAttribute('aria-pressed')).toBe('false');
  });

  it('tells the toolbar slot which mode is on so annotation tools can step aside', async () => {
    const { controller } = sample();
    const seen: string[] = [];
    await show(controller, { renderTools: ({ mode, hasCapture }) => { seen.push(`${mode}:${hasCapture}`); return null; } });
    fireEvent.click(button('Swipe'));
    expect(seen).toContain('side-by-side:true');
    expect(seen).toContain('swipe:true');
  });
});

describe('swipe divider', () => {
  async function swiping() {
    const { controller } = sample();
    await show(controller);
    fireEvent.click(button('Swipe'));
    return { controller, slider: sliderEl() };
  }

  it('is a slider with 0–100 and a spoken value', async () => {
    const { slider } = await swiping();
    expect(slider.getAttribute('aria-orientation')).toBe('horizontal');
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('100');
    expect(slider.getAttribute('aria-valuetext')).toBe('50% baseline, 50% candidate');
    expect(slider.getAttribute('aria-label')).toBe('Swipe divider between baseline and candidate');
    expect(slider.tabIndex).toBe(0);
    expect(describedBy(slider)).toMatch(/arrow keys/);
  });

  it('moves 1% on the arrow keys, 10% with Shift, and clamps at both ends', async () => {
    const { slider } = await swiping();
    const value = () => slider.getAttribute('aria-valuenow');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(value()).toBe('51');
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(value()).toBe('61');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(value()).toBe('59');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(value()).toBe('0');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true });
    expect(value()).toBe('0');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(value()).toBe('100');
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(value()).toBe('100');
    expect(slider.getAttribute('aria-valuetext')).toBe('100% baseline, 0% candidate');
  });

  it('ignores keys it does not own and modified arrows, so browser shortcuts still work', async () => {
    const { slider } = await swiping();
    fireEvent.keyDown(slider, { key: 'Tab' });
    fireEvent.keyDown(slider, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(slider, { key: 'ArrowRight', metaKey: true });
    expect(slider.getAttribute('aria-valuenow')).toBe('50');
  });

  it('recentres on double-click', async () => {
    const { slider } = await swiping();
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.doubleClick(slider);
    expect(slider.getAttribute('aria-valuenow')).toBe('50');
  });

  it('follows a drag across the stage and stops when the pointer is released', async () => {
    const { slider } = await swiping();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const sizer = this.classList.contains('cmp-sizer');
      return { x: 100, y: 0, left: 100, top: 0, right: 500, bottom: 800, width: sizer ? 400 : 0, height: sizer ? 800 : 0, toJSON: () => ({}) } as DOMRect;
    });
    fireEvent.pointerDown(slider, { clientX: 200, button: 0, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('25');
    fireEvent.pointerMove(slider, { clientX: 400, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('75');
    fireEvent.pointerMove(slider, { clientX: 9000, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('100');
    fireEvent.pointerUp(slider, { pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 150, pointerId: 1 });
    expect(slider.getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('swipe with different viewports', () => {
  it('shows a notice with a Match viewports action instead of a misleading swipe, then swipes once they match', async () => {
    const { controller } = sample();
    await show(controller);
    await act(async () => { controller.setRole(c, 'reference'); controller.applyPreset(b, 'tablet-portrait'); });
    // b is a static capture: tablet has no capture for home-v2, so use a live panel as the candidate instead.
    await act(async () => { await controller.selectVersion(b, versionId('home-v2'), 'live-preview'); controller.applyPreset(b, 'laptop'); });
    fireEvent.click(button('Swipe'));
    expect(screen.queryByRole('slider')).toBeNull();
    expect(document.body.textContent).not.toContain('Drag the divider');
    const notice = document.querySelector<HTMLElement>('.cmp-swipe-notice')!;
    expect(notice.textContent).toContain('different viewports');
    expect(notice.textContent).toContain('390 × 844 @3x');
    expect(notice.textContent).toContain('1440 × 900 @2x');
    await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'Match viewports' })); });
    await settle();
    expect(document.querySelector('.cmp-swipe-notice')).toBeNull();
    expect(sliderEl().getAttribute('aria-valuenow')).toBe('50');
    expect(document.body.textContent).toContain('Drag the divider');
  });
});

describe('panel details', () => {
  it('puts source, provenance, selects, the exact version id and panel actions behind Details', async () => {
    const { controller } = sample();
    await show(controller);
    const first = panelEl('a');
    expect(first.querySelector('.cmp-details-body')).toBeNull();
    expect(first.querySelectorAll('select')).toHaveLength(1);
    expect(within(first).getByLabelText('Version')).toBeTruthy();
    const toggle = within(first).getByRole('button', { name: /Details/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(first.querySelector('.cmp-details')!.id);
    const badge = first.querySelector('.cmp-source-badge')!;
    expect(badge.getAttribute('data-evidence')).toBe('browser-capture');
    expect(badge.textContent).toContain('Static capture');
    expect(first.querySelector('.cmp-caveats')!.textContent).toContain('Browser capture; not native evidence.');
    expect(first.querySelector('.cmp-version-id')!.textContent).toBe('home-v1');
    for (const label of ['Source', 'Viewport', 'Role']) expect(within(first).getByLabelText(label)).toBeTruthy();
    expect(within(first).getByRole('button', { name: 'Duplicate' })).toBeTruthy();
    expect(within(first).getByRole('button', { name: 'Remove' })).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() => expect(first.querySelector('.cmp-details-body')).toBeNull());
  });

  it('still changes role, viewport and source from Details', async () => {
    const { controller } = sample();
    await show(controller);
    const third = panelEl('c');
    fireEvent.click(within(third).getByRole('button', { name: /Details/ }));
    await act(async () => { fireEvent.change(within(third).getByLabelText('Role'), { target: { value: 'candidate' } }); });
    expect(controller.getSnapshot().comparison.panels.find((panel) => panel.id === c)!.role).toBe('candidate');
    await act(async () => { fireEvent.change(within(third).getByLabelText('Viewport'), { target: { value: 'laptop' } }); });
    expect(controller.getSnapshot().comparison.panels.find((panel) => panel.id === c)!.presetId).toBe('laptop');
    await act(async () => { fireEvent.change(within(third).getByLabelText('Source'), { target: { value: 'static-capture' } }); });
    await settle();
    expect(controller.getSnapshot().comparison.panels.find((panel) => panel.id === c)!.source.kind).toBe('static-capture');
  });

  it('labels a fake live preview in the one-line header, without opening Details', async () => {
    const { controller } = sample();
    await show(controller);
    expect(within(panelEl('c')).getByText('Fake preview')).toBeTruthy();
    expect(within(panelEl('a')).queryByText('Fake preview')).toBeNull();
    expect(screen.getByText('Labelled fake previews')).toBeTruthy();
  });

  it('changes the version from the header menu, offering the whole project by label', async () => {
    const { controller } = sample();
    await show(controller);
    const select = within(panelEl('a')).getByLabelText('Version') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['Home v1', 'Home v2', 'Home v3', 'Pricing v1']);
    await act(async () => { fireEvent.change(select, { target: { value: 'home-v3' } }); });
    await settle();
    expect(controller.getSnapshot().comparison.panels[0].source.versionId).toBe('home-v3');
  });
});

describe('adding, duplicating and removing panels', () => {
  it('adds a panel for a chosen version from the toolbar menu', async () => {
    const { controller } = sample();
    await show(controller);
    fireEvent.click(button(/Add panel/));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Home v1', 'Home v2', 'Home v3', 'Pricing v1']);
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Home v3' })); });
    await settle();
    expect(panelCount()).toBe(4);
    expect(controller.getSnapshot().comparison.panels[3].source.versionId).toBe('home-v3');
  });

  it('duplicates and removes from Details, and keeps the last panel', async () => {
    const { controller } = sample();
    await show(controller);
    fireEvent.click(within(panelEl('a')).getByRole('button', { name: /Details/ }));
    await act(async () => { fireEvent.click(within(panelEl('a')).getByRole('button', { name: 'Duplicate' })); });
    await settle();
    expect(panelCount()).toBe(4);
    const added = controller.getSnapshot().comparison.panels[3].id;
    fireEvent.click(within(panelEl(added)).getByRole('button', { name: /Details/ }));
    await act(async () => { fireEvent.click(within(panelEl(added)).getByRole('button', { name: 'Remove' })); });
    await waitFor(() => expect(panelCount()).toBe(3));
    await act(async () => { controller.removePanel(b); controller.removePanel(c); });
    await settle();
    expect(panelCount()).toBe(1);
    openDetails('a');
    const remove = within(panelEl('a')).getByRole('button', { name: 'Remove' });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(remove)).toBe('A comparison keeps at least one panel.');
    fireEvent.click(remove);
    expect(panelCount()).toBe(1);
  });

  it('holds the add action at the panel limit, with the reason', async () => {
    const { controller } = sample();
    await show(controller);
    await act(async () => { for (let i = 0; i < 9; i += 1) controller.addPanel(a); });
    await settle();
    expect(panelCount()).toBe(12);
    const add = button('Add panel');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(add)).toBe('A comparison holds up to 12 panels.');
    openDetails('a');
    expect(describedBy(within(panelEl('a')).getByRole('button', { name: 'Duplicate' }))).toBe('A comparison holds up to 12 panels.');
  });
});

describe('toolbar', () => {
  it('shows synced scroll as a toggle with its state in words', async () => {
    const { controller } = sample();
    await show(controller);
    const toggle = button(/Synced scroll/);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toBe('Synced scroll Off');
    await act(async () => { fireEvent.click(toggle); });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toBe('Synced scroll On');
    expect(controller.getSnapshot().comparison.syncScroll).toBe(true);
  });

  it('holds Match viewports with a reason while every panel already matches, and runs it when they differ', async () => {
    const { controller } = sample();
    await show(controller);
    const match = button('Match viewports');
    expect(match.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(match)).toBe('Every panel already uses the baseline’s viewport.');
    await act(async () => { controller.applyPreset(c, 'laptop'); });
    await settle();
    expect(match.getAttribute('aria-disabled')).toBeNull();
    await act(async () => { fireEvent.click(match); });
    expect(controller.getSnapshot().comparison.panels[2].presetId).toBe('phone');
  });

  it('turns a refused change into an in-place notice that can be dismissed', async () => {
    const { controller } = sample();
    await show(controller);
    await act(async () => { await controller.selectVersion(a, versionId('nope-v9')); });
    const notice = screen.getByText('Nothing changed').closest('.hq-notice')!;
    expect(notice.textContent).toContain('That exact version is not available.');
    expect(panelCount()).toBe(3);
    await act(async () => { fireEvent.click(within(notice as HTMLElement).getByRole('button', { name: 'Dismiss' })); });
    await waitFor(() => expect(screen.queryByText('Nothing changed')).toBeNull());
  });
});

describe('saving the layout', () => {
  it('has nothing to save until something changes, then says Unsaved changes', async () => {
    const { controller } = sample();
    await show(controller);
    const save = button('Save layout');
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(save)).toBe('There are no unsaved changes.');
    expect(screen.getByText('Saved')).toBeTruthy();
    await act(async () => { controller.resize(a, 500); });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(save.getAttribute('aria-disabled')).toBeNull();
  });

  it('shows Saving… while the write is in flight, then Saved', async () => {
    let release: () => void = () => undefined;
    const storage = createFakeStorage();
    storage.write = () => new Promise<void>((resolve) => { release = resolve; });
    const { controller } = sample(storage);
    await show(controller);
    await act(async () => { controller.resize(a, 500); });
    await act(async () => { fireEvent.click(button('Save layout')); });
    expect(screen.getAllByText('Saving…').length).toBeGreaterThan(0);
    expect(button(/Saving/).getAttribute('aria-busy')).toBe('true');
    await act(async () => { release(); });
    await settle();
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.queryByText('Saving…')).toBeNull();
    expect(controller.getSnapshot().dirty).toBe(false);
  });

  it('on failure says what was kept, raises one error toast and can retry', async () => {
    const storage = createFakeStorage();
    const { controller } = sample(storage);
    await show(controller);
    await act(async () => { controller.resize(a, 500); });
    storage.failNextWrite = true;
    await act(async () => { fireEvent.click(button('Save layout')); });
    await settle();
    expect(screen.getByText('Couldn’t save')).toBeTruthy();
    expect(screen.getByText('changes kept here')).toBeTruthy();
    const toasts = toastStore.getSnapshot();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tone: 'danger', title: 'Couldn’t save the layout' });
    expect(toasts[0].description).toContain('Nothing was lost');
    expect(toasts[0].action?.label).toBe('Retry');
    expect(controller.getSnapshot().dirty).toBe(true);
    // The failure keeps the screen: panels stay, and the layout is still unsaved.
    expect(panelCount()).toBe(3);
    await act(async () => { fireEvent.click(within(screen.getByText('Couldn’t save').closest('.hq-indicator') as HTMLElement).getByRole('button', { name: 'Retry' })); });
    await settle();
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(controller.getSnapshot().dirty).toBe(false);
    expect(toastStore.getSnapshot()).toHaveLength(0);
  });
});

describe('empty states', () => {
  it('asks you to add versions in Projects when there are none, and takes you there', async () => {
    const onOpenProjects = vi.fn();
    await show(empty(false), { onOpenProjects });
    expect(screen.getByText('Add versions in Projects to compare them.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add panel/ })).toBeNull();
    fireEvent.click(button('Open Projects'));
    expect(onOpenProjects).toHaveBeenCalledTimes(1);
  });

  it('keeps Open Projects visible but unavailable where Projects cannot be opened', async () => {
    await show(empty(false));
    const open = button('Open Projects');
    expect(open.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(open)).toBe('Projects isn’t available from here.');
    fireEvent.click(open);
  });

  it('shows a skeleton while the catalog loads', () => {
    render(createElement(CompareWorkspace, { controller: empty(true) }));
    expect(screen.getByText('Loading versions…')).toBeTruthy();
    expect(document.querySelector('.cmp-empty-state')!.getAttribute('aria-busy')).toBe('true');
  });

  it('offers Add panel once the catalog has versions, and the first panel becomes the baseline', async () => {
    const controller = empty(true);
    await show(controller, { onOpenProjects: () => undefined });
    expect(screen.getByText('Choose a version to start comparing.')).toBeTruthy();
    fireEvent.click(button(/Add panel/));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Home v1' })); });
    await settle();
    expect(panelCount()).toBe(1);
    expect(controller.getSnapshot().comparison.panels[0].role).toBe('baseline');
    expect(document.querySelector('.cmp-empty-state')).toBeNull();
  });

  it('reads the catalog again on every visit, so versions added in Projects show up', async () => {
    const data = sampleCatalogData();
    const real = createFakeCatalog(data);
    let visible = false;
    const controller = createCompareController(createComparison(comparisonId('cmp-visit'), projectId('sample-project'), []), {
      catalog: { ...real, listViews: async (project, signal) => (visible ? real.listViews(project, signal) : []) },
      preview: createFakePreview(), captures: createFakeCaptureImages(), storage: createFakeStorage(),
    });
    const first = await show(controller, { onOpenProjects: () => undefined });
    expect(screen.getByText('Add versions in Projects to compare them.')).toBeTruthy();
    first.unmount();
    visible = true;
    await show(controller, { onOpenProjects: () => undefined });
    expect(screen.getByText('Choose a version to start comparing.')).toBeTruthy();
  });

  it('tells the tools slot there are no panels yet', async () => {
    const seen: boolean[] = [];
    await show(empty(true), { renderTools: ({ hasPanels }) => { seen.push(hasPanels); return null; } });
    expect(seen.at(-1)).toBe(false);
  });
});

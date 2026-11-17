// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises';
import { URL as NodeURL } from 'node:url';
import { createElement, useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render as renderDom, waitFor } from '@testing-library/react';
import { prerenderToNodeStream } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SectionFrame } from '../../../app/compose/views/SectionFrame.tsx';
import { CACHED_TAG, FAKE_TAG, SYNTHETIC_TAG, WORKSPACE_TAG } from '../../../app/compose/labels.ts';
import type { ModulePort, ResolvedAppearance } from '@hq/contracts';
import { ModuleNavHostProvider } from '@hq/ui';
import type { DesignSectionProps } from '../../contract.ts';
import { createDesignCore } from '../../src/domain-core.ts';
import { createDesignDomain } from '../../src/domain.tsx';
import { createFakeShell, createFakeStorage, FAKE_DESKTOP, type FakeStorage } from '../../src/fakes.ts';
import { tabStops } from '../../src/focus.ts';
import { DEFAULT_LAYOUT, resizePanel } from '../../src/panels.ts';
import { buildRegistry } from '../../src/registry.ts';
import { sectionPayloadsFor } from '../../src/section-payload.ts';
import { sessionKey } from '../../src/session.ts';
import type { SectionView } from '../../src/view/SectionOutlet.tsx';

const registry = buildRegistry<SectionView>(import.meta.glob('../../harness/sections/*/design-module.ts', { eager: true }));

async function render(appearance: ResolvedAppearance, destination: string): Promise<string> {
  const shell = createFakeShell({ id: 'alpha', name: 'Alpha site' }, appearance);
  const domain = createDesignDomain({ registry, storage: createFakeStorage(), shell, mac: false });
  const port: ModulePort = { context: shell.getSnapshot().context, destination, appearance, desktop: FAKE_DESKTOP, navigate: () => undefined };
  const { prelude } = await prerenderToNodeStream(createElement(domain.Component, port));
  let html = '';
  for await (const part of prelude) html += String(part);
  return html;
}

const tag = (html: string, pattern: RegExp) => html.match(pattern)?.[0] ?? '';
const surfaces = (html: string) => html.match(/<(?:img|iframe)[^>]*data-hqd-surface="[^"]+"[^>]*>/gu) ?? [];
const styleOf = (element: string) => /style="([^"]*)"/u.exec(element)?.[1] ?? '';

describe('rendered chrome and captured surfaces', () => {
  it('dark tokens recolour the chrome but never captures or previews', async () => {
    const light = await render('light', 'review/canvas');
    const dark = await render('dark', 'review/canvas');
    const chromeLight = styleOf(tag(light, /<div class="hqd-chrome"[^>]*>/u));
    const chromeDark = styleOf(tag(dark, /<div class="hqd-chrome"[^>]*>/u));
    expect(chromeLight).toContain('--hqd-background:#f8f9fb');
    expect(chromeDark).toContain('--hqd-background:#17191d');
    expect(chromeDark).toContain('color-scheme:dark');
    expect(chromeDark).not.toBe(chromeLight);

    const lightSurfaces = surfaces(light);
    const darkSurfaces = surfaces(dark);
    expect(lightSurfaces).toHaveLength(3); // two captures, one producer preview
    expect(darkSurfaces).toEqual(lightSurfaces); // byte-identical elements in both themes
    for (const element of darkSurfaces) {
      expect(styleOf(element)).toBe('color-scheme:normal;filter:none;mix-blend-mode:normal;opacity:1;isolation:isolate;forced-color-adjust:none;background-color:transparent');
      expect(element).not.toContain('--hqd-');
    }
  });

  it('renders every tab stop in model order with no negative tabindex', async () => {
    const html = await render('light', 'review/canvas');
    const rendered = [...html.matchAll(/<[a-z]+[^>]*data-hqd-stop="([^"]+)"[^>]*>/gu)];
    const expected = tabStops({
      location: { nav: 'review', section: 'canvas' }, sectionsByNav: registry.byNav,
      visible: { sidebar: true, inspector: true }, lastSection: {},
    }).map((stop) => stop.id);
    expect(rendered.map((match) => match[1])).toEqual(expected);
    for (const [element] of rendered) {
      expect(element).not.toContain('tabindex="-1"');
      expect(/^<button|tabindex="0"/u.test(element!)).toBe(true);
    }
  });

  it('marks the current area and section without duplicating shell project context', async () => {
    const html = await render('light', 'requests/requests');
    expect(tag(html, /<button[^>]*data-hqd-stop="nav:requests"[^>]*>/u)).toContain('aria-current="page"');
    expect(tag(html, /<button[^>]*data-hqd-stop="section:requests"[^>]*>/u)).toContain('aria-current="page"');
    expect(html).toContain('FAKE draft fixture');
    expect(html).not.toContain('class="hqd-project"');
  });

  it('an unknown destination falls back to Projects and an empty area explains itself', async () => {
    const html = await render('light', 'home');
    expect(tag(html, /<button[^>]*data-hqd-stop="nav:projects"[^>]*>/u)).toContain('aria-current="page"');
    const runs = await render('light', 'runs');
    expect(runs).toContain('No Runs sections are installed yet.');
  });

  it('the chrome stylesheet is scoped and never targets captures or previews', async () => {
    const css = await readFile(new NodeURL('../../src/view/design-ui.css', import.meta.url), 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/@media[^{]*\{([\s\S]*?\})\s*\}/gu, '$1');
    const selectors = [...rules.matchAll(/([^{}]+)\{[^{}]*\}/gu)].flatMap((match) => match[1]!.split(',').map((s) => s.trim()));
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) expect(selector.startsWith('.hqd-chrome')).toBe(true);
    expect(rules).not.toMatch(/data-hqd-surface|\b(?:img|iframe|video|canvas|picture)\b/u);
    expect(rules).not.toMatch(/\b(?:filter|mix-blend-mode|backdrop-filter)\s*:|invert\(/u);
  });
});

afterEach(cleanup);

describe('persistent panel edges', () => {
  it.each(['sidebar', 'inspector'] as const)('collapses %s by pointer and restores the saved width from the same focused grip', (panel) => {
    const shell = createFakeShell({ id: 'alpha', name: 'Alpha site' });
    const storage = createFakeStorage();
    const domain = createDesignDomain({ registry: buildRegistry<SectionView>({}), storage, shell, mac: false });
    const port: ModulePort = { context: shell.getSnapshot().context, destination: 'projects', appearance: 'light', desktop: FAKE_DESKTOP, navigate: () => undefined };
    const screen = renderDom(createElement(domain.Component, port));
    const grip = screen.getByRole('separator', { name: `Resize ${panel}` });
    Object.defineProperty(grip, 'setPointerCapture', { value: () => undefined, configurable: true });
    const originalWidth = Number(grip.getAttribute('aria-valuenow'));
    fireEvent.pointerDown(grip, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: panel === 'sidebar' ? 0 : 1000 });
    fireEvent.pointerUp(grip, { pointerId: 1, clientX: panel === 'sidebar' ? 0 : 1000 });
    expect(screen.queryByRole('complementary', { name: panel === 'sidebar' ? 'Projects sections' : 'Inspector' })).toBeNull();
    expect(screen.getByRole('separator', { name: `Resize ${panel}` })).toBe(grip);
    expect(document.activeElement).toBe(grip);
    expect(grip.getAttribute('aria-valuenow')).toBe('0');
    expect(grip.getAttribute('aria-valuemin')).toBe('0');
    domain.deactivate();
    const saved = domain.serialize('alpha')!;
    expect(JSON.parse(saved).panels[panel]).toEqual({ size: originalWidth, collapsed: true });
    fireEvent.keyDown(grip, { key: 'Enter' });
    expect(grip.getAttribute('aria-valuenow')).toBe(String(originalWidth));
    expect(document.activeElement).toBe(grip);
    fireEvent.keyDown(grip, { key: 'Home' });
    expect(grip.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.pointerDown(grip, { pointerId: 2, clientX: 500 });
    fireEvent.pointerUp(grip, { pointerId: 2, clientX: 500 });
    expect(grip.getAttribute('aria-valuenow')).toBe(String(originalWidth));
    expect(JSON.parse(saved).panels[panel].collapsed).toBe(true);
  });
});

describe('section provenance', () => {
  it.each([[FAKE_TAG, 'Example'], [SYNTHETIC_TAG, 'Synthetic'], [CACHED_TAG, 'Cached']] as const)('keeps %j provenance visible without source entry diagnostics', (tag, label) => {
    const html = renderToStaticMarkup(createElement(SectionFrame, {
      lane: 'internal lane', entry: 'modules/design/private-entry.tsx', tags: [tag], notes: ['Capture capability unavailable'], children: 'Section content',
    }));
    const screen = renderDom(createElement(SectionFrame, { lane: 'internal lane', entry: 'modules/design/private-entry.tsx', tags: [tag], children: 'Section content' }));
    expect(screen.getByText(label).closest('details')).toBeNull();
    expect(html).toContain(tag.text);
    expect(html).toContain('Capture capability unavailable');
    expect(html).toContain('About data');
    expect(html).not.toContain('private-entry.tsx');
    expect(html).not.toContain('real entry');
  });

  it('does not print a WORKSPACE banner for real stored records', () => {
    const html = renderToStaticMarkup(createElement(SectionFrame, { lane: 'Requests', entry: 'internal-source.tsx', tags: [WORKSPACE_TAG], children: 'Saved request' }));
    expect(html).not.toContain('hq-status-label');
    expect(html).not.toContain('WORKSPACE');
    expect(html).toContain('Workspace record');
  });
});

it('previews pointer widths continuously, commits only on release and cancels without persistence', () => {
  const shell = createFakeShell({ id: 'resize', name: 'Resize fixture' }, 'light');
  const domain = createDesignDomain({ registry, storage: createFakeStorage(), shell, mac: false });
  const port: ModulePort = { context: shell.getSnapshot().context, destination: 'projects/projects', appearance: 'light', desktop: FAKE_DESKTOP, navigate: () => undefined };
  const mounted = renderDom(createElement(domain.Component, port));
  const grip = mounted.getByRole('separator', { name: 'Resize sidebar' });
  grip.setPointerCapture = () => undefined;
  const width = () => Number(grip.getAttribute('aria-valuenow'));
  const drag = (target: number, release: 'pointerUp' | 'pointerCancel' = 'pointerUp') => {
    const start = width();
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: start });
    for (const sample of [200, 150, 120, 90, target]) {
      fireEvent.pointerMove(grip, { pointerId: 1, clientX: sample });
      expect(width()).toBe(sample);
    }
    fireEvent[release](grip, { pointerId: 1, clientX: target });
  };
  drag(70); expect(width()).toBe(80);
  fireEvent.keyDown(grip, { key: 'End' }); expect(width()).toBe(420);
  drag(30, 'pointerCancel'); expect(width()).toBe(420);
  drag(30); expect(width()).toBe(0);
  expect(grip.tabIndex).toBe(0);
  fireEvent.keyDown(grip, { key: 'Enter' }); expect(width()).toBe(420);
});

// ---- sub-routes, section payload and hosted chrome ----
// Fixture sections only: they prove routing and chrome behaviour, not any real section's layout.

const COMPARE_ROUTES = { fixed: [
  { id: 'strip', title: 'Strip' }, { id: 'before-after', title: 'Before / after' }, { id: 'swipe', title: 'Swipe stage' }, { id: 'matrix', title: 'Matrix' },
], navChildren: true };
const COMPONENT_ROUTES = { fixed: [{ id: 'tokens', title: 'Tokens' }, { id: 'motion', title: 'Motion' }], navChildren: true, itemPrefix: 'item' };

const mountedSections: string[] = [];
const receivedProps: { sectionId: string; sub: string | null; subExplicit: boolean }[] = [];

function FixtureView(props: DesignSectionProps) {
  receivedProps.push({ sectionId: props.sectionId, sub: props.sub, subExplicit: props.subExplicit });
  useEffect(() => { mountedSections.push(props.sectionId); }, [props.sectionId]);
  return createElement('div', { 'data-fixture': props.sectionId },
    createElement('button', { type: 'button', onClick: () => props.navigateSub('swipe') }, 'Choose swipe'));
}

const fixtureEntry = (id: string, nav: string, extra: Record<string, unknown> = {}) => ({
  designModule: { schema: 'hq.design.section/v1', id, title: id[0]!.toUpperCase() + id.slice(1), nav, view: async () => FixtureView, ...extra },
});
const fixtureRegistry = buildRegistry<SectionView>({
  '../../canvas/design-module.ts': fixtureEntry('canvas', 'review'),
  '../../compare/design-module.ts': fixtureEntry('compare', 'review', { subRoutes: COMPARE_ROUTES }),
  '../../components/design-module.ts': fixtureEntry('components', 'resources', { subRoutes: COMPONENT_ROUTES }),
});

interface MountOptions {
  readonly destination: string;
  /** null mounts without any module-nav provider, which is how every existing caller renders. */
  readonly hosted: boolean | null;
  readonly storage?: FakeStorage;
}

function mountDesign({ destination, hosted, storage = createFakeStorage() }: MountOptions) {
  const shell = createFakeShell({ id: 'alpha', name: 'Alpha site' });
  const domain = createDesignDomain({ registry: fixtureRegistry, storage, shell, mac: false });
  const navigated: string[] = [];
  const portFor = (next: string): ModulePort => ({
    context: shell.getSnapshot().context, destination: next, appearance: 'light', desktop: FAKE_DESKTOP, navigate: (target) => { navigated.push(target); },
  });
  const tree = (next: string) => hosted === null
    ? createElement(domain.Component, portFor(next))
    : createElement(ModuleNavHostProvider, { enabled: hosted }, createElement(domain.Component, portFor(next)));
  const screen = renderDom(tree(destination));
  return { screen, domain, navigated, storage, to: (next: string) => screen.rerender(tree(next)) };
}

const stopOf = (id: string) => document.querySelector<HTMLElement>(`[data-hqd-stop="${id}"]`);
const focusedStopId = () => document.activeElement?.getAttribute('data-hqd-stop') ?? null;
const crumbOf = () => Array.from(document.querySelectorAll('.hqd-crumb li')).map((item) => item.textContent);
const lastProps = () => receivedProps[receivedProps.length - 1];

describe('hosted chrome', () => {
  beforeEach(() => { mountedSections.length = 0; receivedProps.length = 0; });

  it.each([null, false] as const)('keeps Design\'s own navigation when no shell hosts it (%s)', async (hosted) => {
    const { screen } = mountDesign({ destination: 'review/canvas', hosted });
    await screen.findByRole('button', { name: 'Choose swipe' });
    expect(document.querySelector('[data-hqd-hosted]')).toBeNull();
    expect(document.querySelector('.hqd-pagehead')).toBeNull();
    expect(document.querySelector('.hqd-crumb')).toBeNull();
    expect(document.querySelector('.hqd-subnav')).not.toBeNull();
    expect(document.getElementById('hqd-sidebar')).not.toBeNull();
    for (const id of ['nav:review', 'section:canvas', 'splitter:sidebar', 'toggle:sidebar']) expect(stopOf(id), id).not.toBeNull();
    expect(screen.queryByText('Expand or compact navigation')).toBeNull();
  });

  it('hosted omits the duplicated area bar, sidebar, sidebar splitter and sidebar toggle, and keeps the model order', async () => {
    const { screen } = mountDesign({ destination: 'review/compare', hosted: true });
    await screen.findByRole('button', { name: 'Choose swipe' });
    expect(document.querySelector('[data-hqd-hosted]')).not.toBeNull();
    expect(document.querySelector('.hqd-subnav')).toBeNull();
    expect(document.getElementById('hqd-sidebar')).toBeNull();
    expect(document.querySelector('[data-hqd-stop^="nav:"], [data-hqd-stop^="section:"], [data-hqd-stop="splitter:sidebar"], [data-hqd-stop="toggle:sidebar"]')).toBeNull();
    expect(screen.getByRole('button', { name: /Commands/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inspector' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeTruthy();
    const rendered = Array.from(document.querySelectorAll('[data-hqd-stop]')).map((element) => element.getAttribute('data-hqd-stop'));
    expect(rendered).toEqual(tabStops({
      location: { nav: 'review', section: 'compare' }, sectionsByNav: fixtureRegistry.byNav,
      visible: { sidebar: false, inspector: true }, lastSection: {}, hosted: true,
    }).map((stop) => stop.id));
    expect(screen.getByText('Expand or compact navigation')).toBeTruthy();
  });

  it('the hosted page head names group, section and view, and follows the route', async () => {
    const { screen, to } = mountDesign({ destination: 'review/compare', hosted: true });
    await screen.findByRole('button', { name: 'Choose swipe' });
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(crumbOf()).toEqual(['Review', 'Compare', 'Strip']);
    expect(document.querySelector('.hqd-crumb li:last-child')?.getAttribute('aria-current')).toBe('page');
    to('review/compare/swipe');
    expect(crumbOf()).toEqual(['Review', 'Compare', 'Swipe stage']);
    to('review/canvas');
    await waitFor(() => expect(crumbOf()).toEqual(['Review', 'Canvas']));
    to('resources/components/item/Button%20Primary');
    await waitFor(() => expect(crumbOf()).toEqual(['Resources', 'Components', 'Button Primary']));
  });

  it('passes the effective view and whether the route named it, and leaves a section without views alone', async () => {
    const { screen, to } = mountDesign({ destination: 'review/compare', hosted: true });
    await screen.findByRole('button', { name: 'Choose swipe' });
    expect(lastProps()).toEqual({ sectionId: 'compare', sub: 'strip', subExplicit: false });
    to('review/compare/matrix');
    expect(lastProps()).toEqual({ sectionId: 'compare', sub: 'matrix', subExplicit: true });
    to('review/compare/nope');
    expect(lastProps()).toEqual({ sectionId: 'compare', sub: 'strip', subExplicit: false });
    to('review/canvas/swipe');
    await waitFor(() => expect(lastProps()?.sectionId).toBe('canvas'));
    expect(lastProps()).toEqual({ sectionId: 'canvas', sub: null, subExplicit: false });
    await waitFor(() => expect(mountedSections).toEqual(['compare', 'canvas']));
  });

  it('a section\'s navigateSub navigates, remembers the choice for this project, and never remounts the section', async () => {
    const { screen, domain, navigated, to, storage } = mountDesign({ destination: 'review/compare', hosted: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose swipe' }));
    expect(navigated).toEqual(['review/compare/swipe']);
    expect(lastProps()).toEqual({ sectionId: 'compare', sub: 'swipe', subExplicit: false });
    domain.deactivate();
    expect(JSON.parse(storage.data.get(sessionKey('alpha'))!).sections.compare).toEqual({ v: 1, view: 'swipe', data: null });
    to('review/compare/swipe');
    expect(lastProps()).toEqual({ sectionId: 'compare', sub: 'swipe', subExplicit: true });
    to('review/compare/matrix');
    expect(lastProps()).toEqual({ sectionId: 'compare', sub: 'matrix', subExplicit: true });
    expect(mountedSections).toEqual(['compare']);
    expect(domain.navSource.currentId('alpha', 'review/compare')).toBe('view:compare:swipe');
    expect(domain.navSource.currentId('beta', 'review/compare')).toBe('view:compare:strip');
  });

  it('bare and restored destinations show the remembered view but are never rewritten or persisted', async () => {
    const seed = createDesignCore(createFakeStorage());
    sectionPayloadsFor(seed.sessions).setView('alpha', 'compare', 'matrix');
    const seeded = seed.serialize('alpha')!;
    const storage = createFakeStorage({ [sessionKey('alpha')]: seeded });
    const { screen, domain, navigated } = mountDesign({ destination: 'review/compare', hosted: true, storage });
    await screen.findByRole('button', { name: 'Choose swipe' });
    expect(lastProps()).toEqual({ sectionId: 'compare', sub: 'matrix', subExplicit: false });
    expect(crumbOf()).toEqual(['Review', 'Compare', 'Matrix']);
    await new Promise((done) => { setTimeout(done, 20); });
    expect(navigated).toEqual([]);
    domain.deactivate();
    expect(storage.writes).toEqual([]);
    expect(storage.data.get(sessionKey('alpha'))).toBe(seeded);
  });

  it('hosted, Mod+K opens Design\'s palette only for a key that starts inside Design', async () => {
    const { screen } = mountDesign({ destination: 'review/compare', hosted: true });
    await screen.findByRole('button', { name: 'Choose swipe' });
    expect(fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true }), 'body focus is left to the shell').toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    expect(fireEvent.keyDown(stopOf('workspace')!, { key: 'k', ctrlKey: true })).toBe(false);
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('standalone, Mod+K from the body still opens Design\'s palette', async () => {
    const { screen } = mountDesign({ destination: 'review/compare', hosted: null });
    await screen.findByRole('button', { name: 'Choose swipe' });
    expect(fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('hosted, Mod+\\ is forwarded untouched; standalone it still collapses the sidebar', async () => {
    const hosted = mountDesign({ destination: 'review/compare', hosted: true });
    await hosted.screen.findByRole('button', { name: 'Choose swipe' });
    const before = hosted.domain.serialize('alpha');
    expect(fireEvent.keyDown(stopOf('workspace')!, { key: '\\', ctrlKey: true }), 'not default-prevented, so the shell receives it').toBe(true);
    expect(hosted.domain.serialize('alpha')).toBe(before);
    cleanup();
    const standalone = mountDesign({ destination: 'review/compare', hosted: null });
    await standalone.screen.findByRole('button', { name: 'Choose swipe' });
    expect(document.getElementById('hqd-sidebar')).not.toBeNull();
    expect(fireEvent.keyDown(stopOf('workspace')!, { key: '\\', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(document.getElementById('hqd-sidebar')).toBeNull());
  });

  it('hosted F6 cycles the workspace and the inspector, and Alt+digit navigates then focuses the workspace', async () => {
    const { screen, navigated } = mountDesign({ destination: 'review/compare', hosted: true });
    await screen.findByRole('button', { name: 'Choose swipe' });
    stopOf('workspace')?.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'F6' });
    expect(focusedStopId()).toBe('splitter:inspector');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'F6' });
    expect(focusedStopId()).toBe('workspace');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'F6', shiftKey: true });
    expect(focusedStopId()).toBe('splitter:inspector');
    stopOf('palette')?.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'F6' });
    expect(focusedStopId()).toBe('workspace');
    stopOf('palette')?.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: '¡', code: 'Digit3', altKey: true });
    expect(navigated).toEqual(['review/canvas']);
    await waitFor(() => expect(focusedStopId()).toBe('workspace'));
  });

  it('standalone Alt+digit still focuses the area button', async () => {
    const { screen, navigated } = mountDesign({ destination: 'review/compare', hosted: null });
    await screen.findByRole('button', { name: 'Choose swipe' });
    stopOf('palette')?.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: '¡', code: 'Digit3', altKey: true });
    expect(navigated).toEqual(['review/canvas']);
    await waitFor(() => expect(focusedStopId()).toBe('nav:review'));
  });

  it('the palette lists each view; choosing one navigates with it and remembers it', async () => {
    const { screen, domain, navigated } = mountDesign({ destination: 'review/canvas', hosted: true });
    await screen.findByRole('button', { name: 'Choose swipe' });
    fireEvent.click(screen.getByRole('button', { name: /Commands/u }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'swipe' } });
    fireEvent.click(await screen.findByRole('option', { name: /Open Compare · Swipe stage/u }));
    expect(navigated).toEqual(['review/compare/swipe']);
    domain.deactivate();
    expect(JSON.parse(domain.serialize('alpha')!).sections.compare).toEqual({ v: 1, view: 'swipe', data: null });
    expect(JSON.parse(domain.serialize('alpha')!).lastSection.review).toBe('compare');
  });

  it('hosted never rewrites the stored sidebar preference; only inspector changes are saved', async () => {
    const seed = createDesignCore(createFakeStorage());
    seed.sessions.setPanels('alpha', resizePanel(DEFAULT_LAYOUT, 'sidebar', 60, 1400));
    const seeded = seed.serialize('alpha')!;
    const stored = JSON.parse(seeded).panels.sidebar;
    expect(stored).toEqual({ size: 300, collapsed: false });
    const storage = createFakeStorage({ [sessionKey('alpha')]: seeded });
    const { screen, domain } = mountDesign({ destination: 'review/compare', hosted: true, storage });
    await screen.findByRole('button', { name: 'Choose swipe' });
    fireEvent.click(screen.getByRole('button', { name: 'Inspector' }));
    domain.deactivate();
    let saved = JSON.parse(storage.data.get(sessionKey('alpha'))!).panels;
    expect(saved.sidebar).toEqual(stored);
    expect(saved.inspector.collapsed).toBe(true);
    fireEvent.keyDown(stopOf('splitter:inspector')!, { key: 'Enter' });
    domain.deactivate();
    saved = JSON.parse(storage.data.get(sessionKey('alpha'))!).panels;
    expect(saved.sidebar).toEqual(stored);
    expect(saved.inspector.collapsed).toBe(false);
  });
});

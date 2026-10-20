// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises';
import { URL as NodeURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render as renderDom } from '@testing-library/react';
import { prerenderToNodeStream } from 'react-dom/static';
import { afterEach, describe, expect, it } from 'vitest';
import { SectionFrame } from '../../../app/compose/views/SectionFrame.tsx';
import { CACHED_TAG, FAKE_TAG, SYNTHETIC_TAG, WORKSPACE_TAG } from '../../../app/compose/labels.ts';
import type { ModulePort, ResolvedAppearance } from '@hq/contracts';
import { createDesignDomain } from '../../src/domain.tsx';
import { createFakeShell, createFakeStorage, FAKE_DESKTOP } from '../../src/fakes.ts';
import { tabStops } from '../../src/focus.ts';
import { buildRegistry } from '../../src/registry.ts';
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

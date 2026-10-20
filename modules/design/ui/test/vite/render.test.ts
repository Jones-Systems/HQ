import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
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

describe('rendered chrome (react-dom/static, Node)', () => {
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

  it('marks the current area and section, and shows the project without switching it', async () => {
    const html = await render('light', 'requests/requests');
    expect(tag(html, /<button[^>]*data-hqd-stop="nav:requests"[^>]*>/u)).toContain('aria-current="page"');
    expect(tag(html, /<button[^>]*data-hqd-stop="section:requests"[^>]*>/u)).toContain('aria-current="page"');
    expect(html).toContain('FAKE draft fixture');
    expect(html).toContain('Alpha site');
  });

  it('an unknown destination falls back to Projects and an empty area explains itself', async () => {
    const html = await render('light', 'home');
    expect(tag(html, /<button[^>]*data-hqd-stop="nav:projects"[^>]*>/u)).toContain('aria-current="page"');
    const runs = await render('light', 'runs');
    expect(runs).toContain('No Runs sections are installed yet.');
  });

  it('the chrome stylesheet is scoped and never targets captures or previews', async () => {
    const css = await readFile(new URL('../../src/view/design-ui.css', import.meta.url), 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/@media[^{]*\{([\s\S]*?\})\s*\}/gu, '$1');
    const selectors = [...rules.matchAll(/([^{}]+)\{[^{}]*\}/gu)].flatMap((match) => match[1]!.split(',').map((s) => s.trim()));
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) expect(selector.startsWith('.hqd-chrome')).toBe(true);
    expect(rules).not.toMatch(/data-hqd-surface|\b(?:img|iframe|video|canvas|picture)\b/u);
    expect(rules).not.toMatch(/\b(?:filter|mix-blend-mode|backdrop-filter)\s*:|invert\(/u);
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OverlayFrame } from './contract.ts';
import { createCompareController } from './controller.ts';
import { createFakeCaptureImages, createFakeCatalog, createFakePreview, sampleCatalogData } from './fakes.ts';
import { comparisonId, panelId, projectId } from './ids.ts';
import { createComparison, liveSource, staticSource } from './model.ts';
import { presetById } from './presets.ts';
import { CompareWorkspace } from './view/index.tsx';

const phone = presetById('phone')!.viewport;

async function renderedWorkspace() {
  const data = sampleCatalogData();
  const v = (id: string) => data.versions.find((item) => item.versionId === id)!;
  const initial = createComparison(comparisonId('cmp-1'), projectId('sample-project'), [
    { id: panelId('a'), role: 'baseline', source: staticSource(v('home-v1').captures[0]), viewport: phone, width: 380 },
    { id: panelId('b'), role: 'candidate', source: liveSource(v('home-v2')), viewport: phone, width: 420 },
    { id: panelId('c'), source: liveSource(v('pricing-v1')), viewport: phone, width: 300 },
  ]);
  const controller = createCompareController(initial, {
    catalog: createFakeCatalog(data), preview: createFakePreview(), captures: createFakeCaptureImages(),
  });
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  return controller;
}

function panelMarkup(html: string, id: string): string {
  const start = html.indexOf(`data-panel-id="${id}"`);
  const end = html.indexOf('data-panel-id=', start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

// React server rendering proves the produced markup and attributes, not browser layout or scrolling.
describe('CompareWorkspace markup (react-dom/server)', () => {
  it('renders each panel at its own width, and resizing panel 1 changes only its markup width', async () => {
    const controller = await renderedWorkspace();
    const widths = (html: string) => [...html.matchAll(/<section class="cmp-panel"[^>]*style="width:(\d+)px;flex-basis:(\d+)px"/g)].map((m) => Number(m[1]));
    const before = renderToStaticMarkup(createElement(CompareWorkspace, { controller }));
    expect(widths(before)).toEqual([380, 420, 300]);
    controller.resize(panelId('a'), 610);
    const after = renderToStaticMarkup(createElement(CompareWorkspace, { controller }));
    expect(widths(after)).toEqual([610, 420, 300]);
    expect(panelMarkup(after, 'b')).toBe(panelMarkup(before, 'b'));
    expect(panelMarkup(after, 'c')).toBe(panelMarkup(before, 'c'));
  });

  it('draws static captures and fake live previews differently and keeps provenance behind Details', async () => {
    const html = renderToStaticMarkup(createElement(CompareWorkspace, { controller: await renderedWorkspace() }));
    const a = panelMarkup(html, 'a');
    const b = panelMarkup(html, 'b');
    expect(a).toContain('data-source-kind="static-capture"');
    expect(a).toMatch(/<img class="cmp-capture" src="data:image\/svg\+xml/);
    expect(b).toContain('data-source-kind="live-preview"');
    expect(b).not.toContain('<img');
    // A fake live preview is labelled in the one-line header; the source badge and caveats wait behind Details.
    expect(b).toContain('<span class="cmp-chip cmp-chip-fake">Fake preview</span>');
    expect(a).not.toContain('cmp-chip-fake');
    expect(html).toContain('Labelled fake previews');
    expect(a).not.toContain('cmp-details-body');
    expect(a).toContain('aria-expanded="false"');
    // The Version menu offers the project's versions by label; exact ids live in Details.
    expect(b).toMatch(/<option value="home-v2" selected="">Home v2<\/option>/);
    expect(b).toContain('<option value="home-v3">Home v3</option>');
    expect(b).toContain('<option value="pricing-v1">Pricing v1</option>');
    expect(html).not.toMatch(/<option[^>]*>[^<]*latest/i);
    expect(html).not.toContain('<iframe');
  });

  it('marks roles, exposes keyboard resize separators and synced-scroll state', async () => {
    const controller = await renderedWorkspace();
    let html = renderToStaticMarkup(createElement(CompareWorkspace, { controller }));
    expect([...html.matchAll(/data-role="(\w+)"/g)].map((m) => m[1])).toEqual(['baseline', 'candidate', 'reference']);
    expect([...html.matchAll(/role="separator"[^>]*aria-label="Resize panel (\d)"[^>]*aria-valuenow="(\d+)"/g)].map((m) => [m[1], m[2]]))
      .toEqual([['1', '380'], ['2', '420'], ['3', '300']]);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Synced scroll <span class="cmp-toggle-state">Off<\/span>/);
    controller.setSyncScroll(true, panelId('a'));
    html = renderToStaticMarkup(createElement(CompareWorkspace, { controller }));
    expect(html).toMatch(/aria-pressed="true"[^>]*>Synced scroll <span class="cmp-toggle-state">On<\/span>/);
  });

  it('hands overlay slots the exact source frame of each panel', async () => {
    const frames: OverlayFrame[] = [];
    renderToStaticMarkup(createElement(CompareWorkspace, {
      controller: await renderedWorkspace(), renderOverlay: (frame) => { frames.push(frame); return null; },
    }));
    expect(frames.map((frame) => [frame.panelId, frame.versionId, frame.sourceKind, frame.captureDigest === null])).toEqual([
      ['a', 'home-v1', 'static-capture', false], ['b', 'home-v2', 'live-preview', true], ['c', 'pricing-v1', 'live-preview', true],
    ]);
    expect(frames[0]).toMatchObject({ route: '/', state: 'default', viewport: phone, scroll: { x: 0, y: 0 }, scale: (380 - 24) / 390 });
    expect(frames[2].route).toBe('/pricing');
  });
});

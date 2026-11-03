// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewCapability, PreviewSession } from './contract.ts';
import { createCompareController } from './controller.ts';
import { createFakeCaptureImages, createFakeCatalog, sampleCatalogData } from './fakes.ts';
import { comparisonId, panelId, projectId } from './ids.ts';
import { createComparison, liveSource, staticSource } from './model.ts';
import { CompareWorkspace } from './view/CompareWorkspace.tsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function fixture() {
  const data = sampleCatalogData();
  const version = data.versions[0];
  const viewport = { ...version.captures[0].viewport, dpr: 3 };
  const close = vi.fn();
  let sequence = 0;
  const preview: PreviewCapability = {
    qualification: 'labelled-fake', label: 'Synthetic host test',
    open: vi.fn(async () => ({
      kind: 'live-preview', sessionId: `synthetic-${++sequence}`, versionId: version.versionId,
      qualification: 'labelled-fake', viewport, contentSize: viewportToContent(viewport),
      surface: { kind: 'host-surface', surfaceId: 'synthetic-surface' }, close,
    } satisfies PreviewSession)),
  };
  const captures = createFakeCaptureImages();
  const read = vi.spyOn(captures, 'readCapture');
  const controller = createCompareController(createComparison(comparisonId('host-test'), projectId('sample-project'), [
    { id: panelId('live'), source: liveSource(version), viewport, width: 420 },
    { id: panelId('capture'), source: staticSource(version.captures[0]), viewport: version.captures[0].viewport, width: 420 },
  ]), { catalog: createFakeCatalog(data), preview, captures });
  await waitFor(() => expect(controller.getSnapshot().runtime.get(panelId('live'))?.status).toBe('ready'));
  return { controller, preview, read, close, version };
}
function viewportToContent(viewport: { w: number; h: number }) { return { width: viewport.w, height: viewport.h }; }

// DOM bounds are synthetic: these checks do not qualify an Electron view.
describe('host surface placement and stale sessions', () => {
  it('reports window DIP, tracks movement, hides for overlays and unmounts', async () => {
    let x = 12.5;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x, y: 24, width: 320, height: 240, top: 24, left: x, right: x + 320, bottom: 264, toJSON() {},
    }));
    const { controller } = await fixture();
    const place = vi.fn();
    const props = { controller, rendererZoomFactor: 1.25, onHostSurfacePlacement: place };
    const view = render(createElement(CompareWorkspace, props));
    expect(place).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'synthetic-1' }), {
      rect: { x: 15.625, y: 30, width: 400, height: 300 }, visible: true,
    });
    x = 40;
    act(() => window.dispatchEvent(new Event('scroll')));
    expect(place.mock.lastCall?.[1].rect.x).toBe(50);
    view.rerender(createElement(CompareWorkspace, { ...props, overlaysOpen: true }));
    expect(place.mock.lastCall?.[1].visible).toBe(false);
    view.rerender(createElement(CompareWorkspace, props));
    expect(place.mock.lastCall?.[1].visible).toBe(true);
    view.unmount();
    expect(place.mock.lastCall?.[1].visible).toBe(false);
    controller.dispose();
  });

  it('fences stale notifications, hides stale sessions, and never substitutes capture bytes for live', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 20, width: 300, height: 200, top: 20, left: 10, right: 310, bottom: 220, toJSON() {},
    });
    const { controller, preview, read, close, version } = await fixture();
    const place = vi.fn();
    const host = vi.fn(() => createElement('span', null, 'Synthetic hosted surface'));
    const view = render(createElement(CompareWorkspace, { controller, onHostSurfacePlacement: place, renderHostSurface: host }));
    expect(preview.open).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(host.mock.calls.length).toBeGreaterThan(0);
    expect(view.container.querySelector('[data-panel-id="live"] img')).toBeNull();
    expect(view.container.querySelector('[data-panel-id="capture"] img')).not.toBeNull();
    expect(view.container.querySelector('iframe')).toBeNull();
    act(() => controller.markPreviewStale(panelId('live'), 'obsolete-session'));
    expect(controller.getSnapshot().runtime.get(panelId('live'))?.status).toBe('ready');
    act(() => controller.markPreviewStale(panelId('live'), 'synthetic-1'));
    expect(view.container.querySelector('[data-panel-id="live"]')?.getAttribute('data-preview-status')).toBe('stale');
    expect(view.getByText('Stale preview session. Reopen the preview to continue.')).toBeTruthy();
    expect(view.queryByText('Synthetic hosted surface')).toBeNull();
    expect(place.mock.lastCall?.[1].visible).toBe(false);
    await act(() => controller.selectVersion(panelId('live'), version.versionId, 'static-capture'));
    expect(close).toHaveBeenCalledTimes(1);
    await act(() => controller.selectVersion(panelId('live'), version.versionId, 'live-preview'));
    await waitFor(() => expect(controller.getSnapshot().runtime.get(panelId('live'))?.status).toBe('ready'));
    act(() => controller.markPreviewStale(panelId('live'), 'synthetic-1'));
    expect(controller.getSnapshot().runtime.get(panelId('live'))?.status).toBe('ready');
    view.unmount();
    controller.dispose();
  });
});

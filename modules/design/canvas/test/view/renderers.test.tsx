import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SurfaceProps } from '../../../ui/contract.ts';
import { CaptureBody, createCanvasRenderers } from '../../../app/compose/canvas-renderers.tsx';
import type { CaptureValue, FlowSummary, LoadCache, Loaded } from '../../../app/compose/canvas-load-cache.ts';
import { PROJECT_VERSIONS_PROVIDER_ID } from '../../../app/compose/project-versions.ts';
import { FLOWS_PROVIDER_ID } from '../../../flows/src/canvas.ts';
import { addPlacement } from '../../src/arrangement.ts';
import { canvasItemId, providerId, type CanvasItemDescriptor, type Placement } from '../../src/contract.ts';
import { createCanvasState } from '../../src/controller.ts';
import { createFakeProvider } from '../../src/fakes.ts';
import { createProviderRegistry } from '../../src/providers.ts';
import { CanvasView, faceBody } from '../../src/view/CanvasView.tsx';
import { sampleArrangement } from '../fixtures.ts';

/** A cache that always answers with one state, counting what was asked for. */
function fixed<T>(state: Loaded<T>): LoadCache<T> & { readonly wanted: ReturnType<typeof vi.fn> } {
  const wanted = vi.fn();
  return { wanted, peek: () => state, want: wanted, subscribe: () => () => {}, retryFailed: () => {}, dispose: () => {} };
}

const surface = (kind: SurfaceProps['data-hqd-surface']): SurfaceProps => ({
  'data-hqd-surface': kind,
  style: { colorScheme: 'normal', filter: 'none', mixBlendMode: 'normal', opacity: 1, isolation: 'isolate', forcedColorAdjust: 'none', backgroundColor: 'transparent' },
});

const URL_OF_CAPTURE = 'data:image/png;base64,AAAA';
const capture = (state: Loaded<CaptureValue>) => renderToStaticMarkup(
  <CaptureBody cache={fixed(state)} entityId="entity" revision="r1" title="Home v1" surface={surface} />,
);

describe('the capture inside its frame', () => {
  it('shows a skeleton while it loads', () => {
    const markup = capture({ status: 'loading' });
    expect(markup).toContain('hq-canvas-skeleton');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain('<img');
  });

  it('says there is no capture yet, rather than leaving the frame blank', () => {
    const markup = capture({ status: 'ready', value: null });
    expect(markup).toContain('<div class="hq-canvas-placeholder"><span>No capture yet</span></div>');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('data-hq-content');
  });

  it('says the capture is unavailable when it could not be read', () => {
    expect(capture({ status: 'failed' })).toContain('<span>Capture unavailable</span>');
  });

  it('draws the capture as preserved content on the shared capture surface, named for assistive technology', () => {
    const markup = capture({ status: 'ready', value: { url: URL_OF_CAPTURE } });
    expect(markup).toContain('data-hq-content="captured"');
    expect(markup).toContain('data-hqd-surface="capture"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Capture of Home v1"');
    expect(markup).toContain(`src="${URL_OF_CAPTURE}"`);
    expect(markup).toContain('alt=""');
    expect(markup).toContain('draggable="false"');
    expect(markup).toMatch(/color-scheme:normal/u);
    expect(markup).toMatch(/filter:none/u);
    expect(markup).toMatch(/mix-blend-mode:normal/u);
    expect(markup).toMatch(/isolation:isolate/u);
  });

  it('puts no title or provenance over the pixels: that is the frame caption', () => {
    const markup = capture({ status: 'ready', value: { url: URL_OF_CAPTURE } });
    expect(markup).not.toContain('<strong');
    expect(markup).not.toContain('Static capture');
  });

  it('asks its cache for the capture of exactly this revision of this version', () => {
    const cache = fixed<CaptureValue>({ status: 'loading' });
    // Server rendering does not run effects, so only the key the view reads is visible here.
    const peek = vi.spyOn(cache, 'peek');
    renderToStaticMarkup(<CaptureBody cache={cache} entityId="entity" revision="r1" title="Home v1" surface={surface} />);
    expect(peek).toHaveBeenCalledWith('r1|entity');
  });
});

const descriptor = (overrides: Partial<CanvasItemDescriptor> = {}): CanvasItemDescriptor => ({
  ref: { providerId: providerId(PROJECT_VERSIONS_PROVIDER_ID), entityId: 'entity', revision: 'r1' },
  title: 'Home v1', kind: 'view-version', intrinsicSize: { width: 1280, height: 800 }, provenance: 'static-capture', details: [],
  ...overrides,
});
const placement = {} as Placement;

function renderers(captures: Loaded<CaptureValue> = { status: 'loading' }, flows: Loaded<FlowSummary> = { status: 'loading' }) {
  return createCanvasRenderers({ captures: fixed(captures), flows: fixed(flows), surface });
}

describe('canvas renderers', () => {
  it('draws project versions as a capture with size and provenance for the caption', () => {
    const drawn = renderers({ status: 'ready', value: { url: URL_OF_CAPTURE } })[PROJECT_VERSIONS_PROVIDER_ID]!(descriptor(), placement);
    expect(drawn).toMatchObject({ meta: '1280×800 · Static capture' });
    expect(renderToStaticMarkup(<>{faceBody(drawn)}</>)).toContain('data-hq-content="captured"');
  });

  it('shows a flow by its title and step count, not by a digest', () => {
    const flow = descriptor({
      ref: { providerId: providerId(FLOWS_PROVIDER_ID), entityId: `${FLOWS_PROVIDER_ID}/flow-map/flow-1`, revision: 'sha256:0123456789abcdef' },
      title: 'sha256:0123456789abcdef', kind: 'flow-map', provenance: 'reference',
    });
    const drawn = renderers(undefined, { status: 'ready', value: { title: 'Checkout', steps: 3 } })[FLOWS_PROVIDER_ID]!(flow, placement);
    const markup = renderToStaticMarkup(<>{faceBody(drawn)}</>);
    expect(markup).toContain('<strong>Checkout</strong>');
    expect(markup).toContain('Flow map · 3 steps');
    expect(markup).not.toContain('sha256');
    expect(drawn).toMatchObject({ meta: 'Reference' });
  });

  it('says "Prototype" for a flow player and "1 step" in the singular', () => {
    const player = descriptor({ kind: 'flow-player', ref: { providerId: providerId(FLOWS_PROVIDER_ID), entityId: 'e', revision: 'r' } });
    const drawn = renderers(undefined, { status: 'ready', value: { title: 'Sign in', steps: 1 } })[FLOWS_PROVIDER_ID]!(player, placement);
    expect(renderToStaticMarkup(<>{faceBody(drawn)}</>)).toContain('Prototype · 1 step<');
  });

  it('keeps the flow frame labelled while it loads and when it fails', () => {
    const flow = descriptor({ kind: 'flow-map', ref: { providerId: providerId(FLOWS_PROVIDER_ID), entityId: 'e', revision: 'r' } });
    const loading = renderers()[FLOWS_PROVIDER_ID]!(flow, placement);
    expect(renderToStaticMarkup(<>{faceBody(loading)}</>)).toContain('aria-busy="true"');
    const failed = renderers(undefined, { status: 'failed' })[FLOWS_PROVIDER_ID]!(flow, placement);
    expect(renderToStaticMarkup(<>{faceBody(failed)}</>)).toContain('Flow map unavailable');
  });

  it('only covers the providers it knows, leaving the rest to the canvas placeholder', () => {
    expect(Object.keys(renderers()).sort()).toEqual([FLOWS_PROVIDER_ID, PROJECT_VERSIONS_PROVIDER_ID].sort());
  });
});

describe('capture on the canvas', () => {
  function canvas(captures: Loaded<CaptureValue>) {
    const registry = createProviderRegistry();
    registry.register(createFakeProvider(PROJECT_VERSIONS_PROVIDER_ID, 'Versions', [
      { entityId: 'entity', revision: 'r1', title: 'Home v1', kind: 'view-version', provenance: 'static-capture', size: { width: 1280, height: 800 }, bytes: new Uint8Array() },
    ]));
    const arrangement = addPlacement(sampleArrangement(), {
      id: canvasItemId('captured'), ref: { providerId: providerId(PROJECT_VERSIONS_PROVIDER_ID), entityId: 'entity', revision: 'r1' },
      frame: { x: 2000, y: 0, width: 640, height: 400 },
    });
    return renderToStaticMarkup(<CanvasView state={createCanvasState(arrangement)} dispatch={() => {}} registry={registry} platform="other" renderers={renderers(captures)} />);
  }

  it('keeps the capture in the frame body and the title and viewport in a caption outside it', () => {
    const markup = canvas({ status: 'ready', value: { url: URL_OF_CAPTURE } });
    const card = markup.slice(markup.indexOf('data-kind="view-version"'));
    const body = card.slice(card.indexOf('hq-canvas-card-body'), card.indexOf('hq-canvas-caption'));
    const caption = card.slice(card.indexOf('hq-canvas-caption'));
    expect(body).toContain('data-hq-content="captured"');
    expect(caption).toContain('<strong title="Home v1">Home v1</strong>');
    expect(caption).toContain('1280×800 · Static capture');
    expect(caption.slice(0, caption.indexOf('</div>'))).not.toContain('data-hq-content');
  });

  it('shows the labelled fallback in the frame when there is no capture', () => {
    expect(canvas({ status: 'ready', value: null })).toContain('<span>No capture yet</span>');
  });
});

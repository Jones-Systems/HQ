import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { canvasItemId, providerId } from '../../src/contract.ts';
import { addPlacement } from '../../src/arrangement.ts';
import { createCanvasState, reduceCanvas, visibleArrangement, type CanvasState } from '../../src/controller.ts';
import { inspect } from '../../src/inspector.ts';
import { createProviderRegistry } from '../../src/providers.ts';
import { CanvasView } from '../../src/view/CanvasView.tsx';
import { Inspector } from '../../src/view/Inspector.tsx';
import { A, B, C, sampleArrangement, sampleProvider } from '../fixtures.ts';

/** React server rendering: proves markup and attributes, not layout or input handling. */
function setup(state: CanvasState = createCanvasState(sampleArrangement())) {
  const registry = createProviderRegistry();
  registry.register(sampleProvider());
  return { state, registry };
}

const noop = () => {};

describe('CanvasView markup', () => {
  it('renders items through providers with a camera transform and roving focus', () => {
    const base = createCanvasState(sampleArrangement(), { camera: { x: 100, y: 50, zoom: 2 } });
    const { state, registry } = setup(reduceCanvas(reduceCanvas(base, { type: 'select', ids: [B, C] }), { type: 'focus', id: C }));
    const html = renderToStaticMarkup(<CanvasView state={state} dispatch={noop} registry={registry} platform="other" />);
    expect(html).toContain('transform:translate(-200px, -100px) scale(2)');
    expect(html).toContain('aria-label="Home v1"');
    expect(html).toMatch(/data-node-id="item-c"[^>]*aria-pressed="true"[^>]*tabindex="0"/u);
    expect(html).toMatch(/data-node-id="item-a"[^>]*aria-pressed="false"[^>]*tabindex="-1"/u);
    expect(html).toContain('Web approximation — not native evidence');
    expect(html.match(/class="hq-canvas-selection"/gu)?.length).toBe(2);
    expect(html).toContain('>Desktop</span>');
  });

  it('keeps a placement whose provider is missing and labels it', () => {
    const { registry } = setup();
    const arrangement = addPlacement(sampleArrangement(), {
      id: canvasItemId('orphan'), ref: { providerId: providerId('gone'), entityId: 'x', revision: 'r9' }, frame: { x: 0, y: 900, width: 100, height: 100 },
    });
    const html = renderToStaticMarkup(<CanvasView state={createCanvasState(arrangement, { readOnly: true })} dispatch={noop} registry={registry} platform="mac" />);
    expect(html).toContain('x @ r9');
    expect(html).toContain('Provider not available');
    expect(html).toContain('aria-label="Design canvas (read-only)"');
  });

  it('uses a root-supplied renderer for its provider', () => {
    const { state, registry } = setup();
    const html = renderToStaticMarkup(<CanvasView state={state} dispatch={noop} registry={registry} platform="other"
      renderers={{ 'synthetic-views': (descriptor) => <figure data-testid="custom">{descriptor.title}</figure> }} />);
    expect(html.match(/data-testid="custom"/gu)?.length).toBe(3);
  });
});

describe('Inspector markup', () => {
  it('shows source identity read-only and arrangement fields editable', () => {
    const { state, registry } = setup();
    const model = inspect(visibleArrangement(state), [A], registry);
    const html = renderToStaticMarkup(<Inspector model={model} selection={[A]} gridSize={8} gridSnap readOnly={false} hiddenIds={[]} dispatch={noop} />);
    expect(html).toContain('<dt>Pinned revision</dt><dd>version-1</dd>');
    expect(html).toContain('<dt>Provenance</dt><dd>Static capture</dd>');
    expect(html).toContain('<dt>Artboard</dt><dd>Desktop</dd>');
    expect(html).not.toMatch(/<input[^>]*value="version-1"/u);
    for (const label of ['X', 'Y', 'W', 'H']) expect(html).toContain(`aria-label="${label}"`);
  });

  it('offers align and distribute for multi-selection, disabled when read-only', () => {
    const { state, registry } = setup();
    const model = inspect(visibleArrangement(state), [A, B, C], registry);
    const html = renderToStaticMarkup(<Inspector model={model} selection={[A, B, C]} gridSize={8} gridSnap readOnly hiddenIds={[]} dispatch={noop} />);
    expect(html).toContain('3 selected');
    expect(html).toContain('Align left');
    expect(html).toContain('Distribute horizontally');
    expect(html).toMatch(/<fieldset disabled="" class="hq-inspector-actions">/u);
  });
});

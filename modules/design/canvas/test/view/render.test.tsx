// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SecondaryBar, SecondaryPanel } from '../../../ui/src/secondary-panels.tsx';
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
    const focused = reduceCanvas(reduceCanvas(createCanvasState(sampleArrangement()), { type: 'select', ids: [B, C] }), { type: 'focus', id: C });
    const { state, registry } = setup(reduceCanvas(focused, { type: 'camera', camera: { x: 100, y: 50, zoom: 2 } }));
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


afterEach(() => {
  cleanup();
  localStorage.removeItem('hq.design.secondary.test-panel.v1');
  localStorage.removeItem('hq.design.secondary.test-tools.v1');
});

describe('secondary panel controls', () => {
  it('keeps draft input mounted, focus reachable and the resized width across collapse and remount', () => {
    const panel = () => <SecondaryPanel name="test-panel" label="Test inspector" initial={280}><input aria-label="Inspector draft" defaultValue="kept" /></SecondaryPanel>;
    const mounted = render(panel());
    const grip = screen.getByRole('separator', { name: 'Resize Test inspector' });
    fireEvent.keyDown(grip, { key: 'ArrowLeft' });
    expect(grip.getAttribute('aria-valuenow')).toBe('288');
    const field = screen.getByLabelText('Inspector draft') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'unsaved' } });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'Home' });
    expect(grip.getAttribute('aria-valuenow')).toBe('0');
    expect(document.activeElement).toBe(grip);
    expect(screen.queryByRole('textbox', { name: 'Inspector draft' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show Test inspector' }));
    expect(grip.getAttribute('aria-valuenow')).toBe('288');
    expect((screen.getByRole('textbox', { name: 'Inspector draft' }) as HTMLInputElement).value).toBe('unsaved');
    fireEvent.keyDown(grip, { key: 'Home' });
    mounted.unmount();
    render(panel());
    const restoredGrip = screen.getByRole('separator', { name: 'Resize Test inspector' });
    expect(restoredGrip.getAttribute('aria-valuenow')).toBe('0');
    restoredGrip.focus();
    fireEvent.keyDown(restoredGrip, { key: 'Enter' });
    expect(restoredGrip.getAttribute('aria-valuenow')).toBe('288');
    expect(document.activeElement).toBe(restoredGrip);
  });

  it('drags an end panel to zero using pointer capture and restores its previous width', () => {
    render(<SecondaryPanel name="test-panel" label="Test inspector" initial={280}><input aria-label="Inspector draft" /></SecondaryPanel>);
    const grip = screen.getByRole('separator', { name: 'Resize Test inspector' });
    const capture = vi.fn();
    const release = vi.fn();
    Object.assign(grip, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release });
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(grip, { pointerId: 1, clientX: 300 });
    expect(capture).toHaveBeenCalledWith(1);
    expect(release).toHaveBeenCalledWith(1);
    expect(grip.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.keyDown(grip, { key: 'Enter' });
    expect(grip.getAttribute('aria-valuenow')).toBe('280');
  });

  it('remembers a closed tool row and leaves its reopen button available', () => {
    const tools = () => <SecondaryBar name="test-tools" label="Test tools"><button>Action</button></SecondaryBar>;
    const mounted = render(tools());
    fireEvent.click(screen.getByRole('button', { name: 'Hide Test tools' }));
    expect(screen.queryByRole('button', { name: 'Action' })).toBeNull();
    mounted.unmount();
    render(tools());
    const show = screen.getByRole('button', { name: 'Show Test tools' });
    show.focus();
    fireEvent.click(show);
    expect(screen.getByRole('button', { name: 'Action' })).toBeTruthy();
    expect(document.activeElement).toBe(show);
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { artboardId } from '../../src/contract.ts';
import { createCanvasState, reduceCanvas, type CanvasAction, type CanvasState } from '../../src/controller.ts';
import { createFakeProvider } from '../../src/fakes.ts';
import { MAX_ZOOM, MIN_ZOOM } from '../../src/geometry.ts';
import type { Platform } from '../../src/input.ts';
import { createProviderRegistry } from '../../src/providers.ts';
import { NEW_ITEM_BOX, Toolbar, placementFrame } from '../../src/view/Toolbar.tsx';
import { B, PROJECT, rect, ref, sampleArrangement, sampleProvider } from '../fixtures.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const viewport = { width: 1000, height: 700 };
const fresh = () => createCanvasState(sampleArrangement(), { viewport });
const newIds = () => { let counter = 0; return { next: (kind: 'item' | 'artboard') => `${kind}-new-${(counter += 1)}` }; };

function setup(initial: CanvasState = fresh(), platform: Platform = 'other') {
  const registry = createProviderRegistry();
  registry.register(sampleProvider());
  const dispatch = vi.fn<(action: CanvasAction) => void>();
  const ids = newIds();
  const view = (state: CanvasState, on: Platform = platform) =>
    <Toolbar state={state} dispatch={dispatch} registry={registry} projectId={PROJECT} ids={ids} platform={on} />;
  const mounted = render(view(initial));
  return { dispatch, registry, rerenderWith: (state: CanvasState, on?: Platform) => mounted.rerender(view(state, on)) };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const wrapperOf = (name: string | RegExp) => button(name).closest('.hq-canvas-tool') as HTMLElement;
const tipOf = (name: string | RegExp) => wrapperOf(name).querySelector('[role="tooltip"]') as HTMLElement;
const describedBy = (target: HTMLElement) => document.getElementById(target.getAttribute('aria-describedby')!) as HTMLElement;
const names = (group: HTMLElement) => within(group).getAllByRole('button').map((item) => item.getAttribute('aria-label'));
const edited = (state: CanvasState) => reduceCanvas(state, { type: 'edit', edit: { kind: 'add-artboard', id: artboardId('made'), name: 'Made', frame: rect(0, 0, 10, 10) } });
const noDialog = (name: string) => waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());

/** Say whether focus counts as coming from the keyboard (`:focus-visible`); every other selector answers as usual. */
function focusFromKeyboard(visible: boolean) {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function patched(this: Element, selector: string) {
    return selector === ':focus-visible' ? visible : matches.call(this, selector);
  });
}

describe('toolbar groups and names', () => {
  it('groups history, insert and view, with an accessible name on every button', () => {
    setup();
    const bar = screen.getByRole('toolbar', { name: 'Canvas tools' });
    expect(names(within(bar).getByRole('group', { name: 'History' }))).toEqual(['Undo', 'Redo']);
    expect(names(within(bar).getByRole('group', { name: 'Insert' }))).toEqual(['Add item', 'Add artboard']);
    expect(names(within(bar).getByRole('group', { name: 'View' }))).toEqual(['Zoom out', 'Zoom 100%, reset to 100%', 'Zoom in', 'Fit all', 'Fit selection']);
  });

  it('draws icons as 16px SVG on currentColor, hidden from assistive technology', () => {
    setup();
    for (const name of ['Undo', 'Redo', 'Add item', 'Add artboard', 'Zoom out', 'Zoom in', 'Fit all', 'Fit selection']) {
      const icon = button(name).querySelector('svg')!;
      expect(icon.getAttribute('width'), name).toBe('16');
      expect(icon.getAttribute('height'), name).toBe('16');
      expect(icon.getAttribute('stroke'), name).toBe('currentColor');
      expect(icon.getAttribute('stroke-width'), name).toBe('1.5');
      expect(icon.closest('[aria-hidden="true"]'), name).not.toBeNull();
    }
  });

  it('names the shortcut in the tooltip of an available action, for the platform in use', () => {
    const { rerenderWith } = setup(edited(fresh()));
    expect(tipOf('Undo').textContent).toBe('Undo (Ctrl+Z)');
    expect(tipOf('Zoom in').textContent).toBe('Zoom in (+)');
    expect(tipOf('Fit all').textContent).toBe('Fit all (Shift+1)');
    rerenderWith(edited(fresh()), 'mac');
    expect(tipOf('Undo').textContent).toBe('Undo (⌘Z)');
  });

  it('leaves the browser title off the buttons, so the tooltip is the only one', () => {
    setup();
    expect(button('Undo').getAttribute('title') ?? '').toBe('');
  });
});

describe('unavailable actions say why', () => {
  it('keeps Undo and Redo in place with the reason, focusable, described by it, and inert', () => {
    const { dispatch } = setup();
    const undo = button('Undo');
    expect(undo.getAttribute('aria-disabled')).toBe('true');
    expect(undo.hasAttribute('disabled')).toBe(false);
    expect(describedBy(undo).textContent).toBe('Nothing to undo');
    expect(describedBy(button('Redo')).textContent).toBe('Nothing to redo');
    undo.focus();
    expect(document.activeElement).toBe(undo);
    fireEvent.click(undo);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('undoes once there is something to undo, and says nothing is left to redo', () => {
    const { dispatch } = setup(edited(fresh()));
    expect(button('Undo').hasAttribute('aria-disabled')).toBe(false);
    expect(button('Undo').hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(button('Undo'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'undo' });
    expect(describedBy(button('Redo')).textContent).toBe('Nothing to redo');
  });

  it('shows the reason on keyboard focus, on hover after a short wait, and closes it with Escape', () => {
    vi.useFakeTimers();
    focusFromKeyboard(true);
    setup();
    const wrapper = wrapperOf('Undo');
    expect(wrapper.hasAttribute('data-tip')).toBe(false);
    act(() => { fireEvent.focus(button('Undo')); });
    expect(wrapper.getAttribute('data-tip')).toBe('open');
    act(() => { fireEvent.keyDown(button('Undo'), { key: 'Escape' }); });
    expect(wrapper.hasAttribute('data-tip')).toBe(false);
    act(() => { fireEvent.blur(button('Undo')); });
    act(() => { fireEvent.pointerEnter(wrapper); });
    expect(wrapper.hasAttribute('data-tip')).toBe(false);
    act(() => { vi.advanceTimersByTime(500); });
    expect(wrapper.getAttribute('data-tip')).toBe('open');
    act(() => { fireEvent.pointerLeave(wrapper); });
    expect(wrapper.hasAttribute('data-tip')).toBe(false);
  });

  it('does not show the tooltip for focus that came from a pointer press', () => {
    focusFromKeyboard(false);
    setup();
    act(() => { fireEvent.focus(button('Undo')); });
    expect(wrapperOf('Undo').hasAttribute('data-tip')).toBe(false);
  });

  it('asks for a selection before Fit selection, and enables it once there is one', () => {
    const { dispatch, rerenderWith } = setup();
    const fit = button('Fit selection');
    expect(fit.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(fit).textContent).toBe('Select an item first');
    fireEvent.click(fit);
    expect(dispatch).not.toHaveBeenCalled();
    rerenderWith(reduceCanvas(fresh(), { type: 'select', ids: [B] }));
    expect(button('Fit selection').hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(button('Fit selection'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'fit', target: 'selection', ease: true });
  });

  it('explains a read-only canvas on every edit action, and an empty one on Fit all', () => {
    const { rerenderWith } = setup(createCanvasState(sampleArrangement(), { readOnly: true, viewport }));
    for (const name of ['Undo', 'Redo', 'Add item', 'Add artboard']) {
      expect(button(name).getAttribute('aria-disabled'), name).toBe('true');
      expect(describedBy(button(name)).textContent, name).toBe('This canvas is read-only');
    }
    rerenderWith(createCanvasState({ ...sampleArrangement(), items: [], artboards: [] }, { viewport }));
    expect(describedBy(button('Fit all')).textContent).toBe('Nothing on the canvas yet');
  });

  it('asks to finish the current move before undoing', () => {
    // Only the presence of a gesture matters to the toolbar; its shape belongs to the controller.
    setup({ ...edited(fresh()), gesture: { kind: 'pan' } } as unknown as CanvasState);
    expect(describedBy(button('Undo')).textContent).toBe('Finish the current move first');
  });

  it('refuses to go past the zoom limits, saying so', () => {
    const at = (zoom: number) => reduceCanvas(fresh(), { type: 'camera', camera: { x: 0, y: 0, zoom } });
    const { rerenderWith } = setup(at(MIN_ZOOM));
    expect(describedBy(button('Zoom out')).textContent).toBe('Already at the smallest zoom');
    expect(button('Zoom in').hasAttribute('aria-disabled')).toBe(false);
    rerenderWith(at(MAX_ZOOM));
    expect(describedBy(button('Zoom in')).textContent).toBe('Already at the largest zoom');
    expect(button('Zoom out').hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('view actions ease the camera', () => {
  it('sends eased zoom, preset and fit actions about the centre of the view', () => {
    const { dispatch, rerenderWith } = setup();
    fireEvent.click(button('Zoom in'));
    fireEvent.click(button('Zoom out'));
    fireEvent.click(button('Fit all'));
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'zoom-at', anchor: { x: 500, y: 350 }, factor: 1.25, ease: true },
      { type: 'zoom-at', anchor: { x: 500, y: 350 }, factor: 1 / 1.25, ease: true },
      { type: 'fit', target: 'all', ease: true },
    ]);
    rerenderWith(reduceCanvas(fresh(), { type: 'zoom-to', zoom: 0.55 }));
    const readout = button('Zoom 55%, reset to 100%');
    expect(readout.textContent).toBe('55%');
    fireEvent.click(readout);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'zoom-to', zoom: 1, ease: true });
  });

  it('keeps the 100% preset in place, saying it is already there', () => {
    const { dispatch } = setup();
    const preset = button('Zoom 100%, reset to 100%');
    expect(preset.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(preset).textContent).toBe('Already at 100%');
    fireEvent.click(preset);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('adding things', () => {
  it('opens the item list, adds the item at its own size at the centre of the view, and selects it', async () => {
    const { dispatch } = setup();
    fireEvent.click(button('Add item'));
    expect(button('Add item').getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('dialog', { name: 'Add item' });
    expect(within(panel).getByText('Synthetic views (fake)')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: /Home v1/u }));
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'edit', edit: { kind: 'add-placement', id: 'item-new-1', ref: ref('view-home', 'version-1'), frame: { x: 340, y: 250, width: 320, height: 200 } } },
      { type: 'select', ids: ['item-new-1'] },
    ]);
    await noDialog('Add item');
  });

  it('places new things at the centre of what the user is looking at, not at the origin', () => {
    // The camera is the world point at the top-left of the view: the centre is (1000 + 500 / 2, 200 + 350 / 2).
    const { dispatch } = setup(reduceCanvas(fresh(), { type: 'camera', camera: { x: 1000, y: 200, zoom: 2 } }));
    fireEvent.click(button('Add item'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add item' })).getByRole('button', { name: /Home v1/u }));
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ edit: { frame: { x: 1090, y: 275, width: 320, height: 200 } } });
  });

  it('closes the list with Escape and gives focus back to its button', async () => {
    setup();
    fireEvent.click(button('Add item'));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add item' }), { key: 'Escape' });
    expect(document.activeElement).toBe(button('Add item'));
    await noDialog('Add item');
  });

  it('closes the list on a press outside it', async () => {
    setup();
    fireEvent.click(button('Add item'));
    expect(screen.getByRole('dialog', { name: 'Add item' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await noDialog('Add item');
  });

  it('says what to do when no provider has anything to add', () => {
    const registry = createProviderRegistry();
    registry.register(createFakeProvider('empty', 'Empty', []));
    render(<Toolbar state={fresh()} dispatch={() => {}} registry={registry} projectId={PROJECT} ids={newIds()} platform="other" />);
    fireEvent.click(button('Add item'));
    expect(screen.getByText(/Nothing to add yet/u)).toBeTruthy();
  });

  it('adds an artboard at its preset size, centred on the view, and selects it', () => {
    const { dispatch } = setup();
    fireEvent.click(button('Add artboard'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add artboard' })).getByRole('button', { name: /Phone/u }));
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'edit', edit: { kind: 'add-artboard', id: 'artboard-new-1', name: 'Phone', frame: { x: 305, y: -72, width: 390, height: 844 } } },
      { type: 'select', ids: ['artboard-new-1'] },
    ]);
  });
});

describe('placementFrame', () => {
  it('keeps a small item as it is and scales a large one down to the box, keeping its shape', () => {
    expect(placementFrame({ width: 200, height: 100 }, { x: 500, y: 300 })).toEqual({ x: 400, y: 250, width: 200, height: 100 });
    expect(placementFrame({ width: 1280, height: 800 }, { x: 0, y: 0 })).toEqual({ x: -240, y: -150, width: 480, height: 300 });
    expect(placementFrame({ width: 390, height: 844 }, { x: 0, y: 0 }).height).toBe(NEW_ITEM_BOX.height);
  });

  it('never makes a frame smaller than one unit, and lands on whole units', () => {
    expect(placementFrame({ width: 0, height: 0 }, { x: 0, y: 0 }).width).toBe(1);
    const odd = placementFrame({ width: 101, height: 51 }, { x: 10.4, y: 20.6 });
    expect(Number.isInteger(odd.x) && Number.isInteger(odd.y)).toBe(true);
  });
});

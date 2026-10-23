import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDragController, MOUSE_THRESHOLD_PX, TOUCH_HOLD_MS, type DropTarget } from '../drag';

// Synthetic pointer sequences against the controller; no real pointer or touch hardware.

function setup(target: DropTarget | null = { status: 'next', index: 0 }) {
  const drops: [string, DropTarget][] = [];
  const views: unknown[] = [];
  const controller = createDragController({
    hitTest: () => target,
    onChange: (view) => views.push(view),
    onDrop: (id, at) => drops.push([id, at]),
  });
  return { controller, drops, views };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('drag controller', () => {
  it('starts a mouse drag only after the 5 px threshold, then drops on the target', () => {
    const { controller, drops } = setup();
    controller.pointerDown({ id: 'a', pointerId: 1, pointerType: 'mouse', x: 10, y: 10 });
    controller.pointerMove(1, 10 + MOUSE_THRESHOLD_PX - 1, 10);
    expect(controller.dragging).toBe(false);
    controller.pointerMove(1, 10 + MOUSE_THRESHOLD_PX, 10);
    expect(controller.dragging).toBe(true);
    controller.pointerUp(1);
    expect(drops).toEqual([['a', { status: 'next', index: 0 }]]);
    expect(controller.consumeClick()).toBe(true);
    expect(controller.consumeClick()).toBe(false);
  });

  it('treats a press without travel as a click, not a drag', () => {
    const { controller, drops } = setup();
    controller.pointerDown({ id: 'a', pointerId: 1, pointerType: 'mouse', x: 10, y: 10 });
    controller.pointerUp(1);
    expect(drops).toEqual([]);
    expect(controller.consumeClick()).toBe(false);
  });

  it('starts a touch drag only after a 320 ms hold', () => {
    const { controller, drops } = setup();
    controller.pointerDown({ id: 'a', pointerId: 7, pointerType: 'touch', x: 50, y: 50 });
    controller.pointerMove(7, 52, 52);
    vi.advanceTimersByTime(TOUCH_HOLD_MS - 1);
    expect(controller.dragging).toBe(false);
    vi.advanceTimersByTime(1);
    expect(controller.dragging).toBe(true);
    controller.pointerMove(7, 300, 50);
    controller.pointerUp(7);
    expect(drops).toEqual([['a', { status: 'next', index: 0 }]]);
  });

  it('lets a touch swipe scroll: travel before the hold cancels the drag', () => {
    const { controller, drops } = setup();
    controller.pointerDown({ id: 'a', pointerId: 7, pointerType: 'touch', x: 50, y: 50 });
    controller.pointerMove(7, 50, 80);
    vi.advanceTimersByTime(TOUCH_HOLD_MS * 2);
    expect(controller.dragging).toBe(false);
    controller.pointerUp(7);
    expect(drops).toEqual([]);
  });

  it('cancels on Escape or pointercancel: nothing moves and the next click is swallowed', () => {
    const { controller, drops, views } = setup();
    controller.pointerDown({ id: 'a', pointerId: 1, pointerType: 'mouse', x: 0, y: 0 });
    controller.pointerMove(1, 40, 0);
    controller.cancel();
    controller.pointerUp(1);
    expect(drops).toEqual([]);
    expect(views.at(-1)).toBeNull();
    expect(controller.consumeClick()).toBe(true);
  });

  it('does not drop outside every column', () => {
    const { controller, drops } = setup(null);
    controller.pointerDown({ id: 'a', pointerId: 1, pointerType: 'pen', x: 0, y: 0 });
    controller.pointerMove(1, 40, 0);
    controller.pointerUp(1);
    expect(drops).toEqual([]);
  });

  it('ignores other pointers', () => {
    const { controller, drops } = setup();
    controller.pointerDown({ id: 'a', pointerId: 1, pointerType: 'mouse', x: 0, y: 0 });
    controller.pointerMove(2, 40, 0);
    expect(controller.dragging).toBe(false);
    controller.pointerMove(1, 40, 0);
    controller.pointerUp(2);
    expect(controller.dragging).toBe(true);
    controller.pointerUp(1);
    expect(drops).toHaveLength(1);
  });
});

describe('click suppression after a drag', () => {
  it('lasts one task, so a drag that ends off its card does not swallow a later real click', () => {
    const { controller } = setup();
    controller.pointerDown({ id: 'a', pointerId: 1, pointerType: 'mouse', x: 0, y: 0 });
    controller.pointerMove(1, 40, 0);
    controller.pointerUp(1);
    vi.advanceTimersByTime(0);
    expect(controller.consumeClick()).toBe(false);
  });

  it('is cleared by the next press', () => {
    const { controller } = setup();
    controller.pointerDown({ id: 'a', pointerId: 1, pointerType: 'mouse', x: 0, y: 0 });
    controller.pointerMove(1, 40, 0);
    controller.pointerUp(1);
    controller.pointerDown({ id: 'b', pointerId: 2, pointerType: 'mouse', x: 0, y: 0 });
    controller.pointerUp(2);
    expect(controller.consumeClick()).toBe(false);
  });
});

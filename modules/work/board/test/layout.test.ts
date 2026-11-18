import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Item } from '../../core';
import { planColumn } from '../BoardColumn';
import { createDragController, type DragEnd, type DropTarget } from '../drag';
import { describeDrop } from '../moves';
import { item } from './fixtures';

// The drag layout rules (where the gap opens, when letting go changes nothing), the words on the drop badge, and the
// controller's end report that the ghost's settle and flight back are driven by. Pure functions; no DOM.

const cards: Item[] = ['a', 'b', 'c'].map((id, index) => item(id, id.toUpperCase(), 'next', 1024 * (index + 1)));
const layout = (plan: ReturnType<typeof planColumn>) => plan.entries.map((entry) => (entry.type === 'gap' ? '·' : entry.item.id)).join('');
const over = (status: DropTarget['status'], index: number, zone?: 'tab'): { id: string; target: DropTarget } => ({ id: 'a', target: { status, index, ...(zone ? { zone } : {}) } });

describe('planColumn', () => {
  it('lays out a column untouched when nothing is dragged', () => {
    const plan = planColumn(cards, 'next', null);
    expect(layout(plan)).toBe('abc');
    expect(plan.gap).toBe(false);
  });

  it('opens a gap before the card the pointer is over, among the cards without the dragged one', () => {
    // 'a' is dragged over its own column: others are b, c.
    expect(layout(planColumn(cards, 'next', over('next', 1)))).toBe('ab·c');
    expect(layout(planColumn(cards, 'next', over('next', 2)))).toBe('abc·');
  });

  it('keeps the dragged card in its slot and opens no gap over that slot: letting go there changes nothing', () => {
    const plan = planColumn(cards, 'next', over('next', 0));
    expect(layout(plan)).toBe('abc');
    expect(plan.gap).toBe(false);
    expect(plan.slotActive).toBe(true);
    // For a middle card, the slot is where its own index points.
    const middle = planColumn(cards, 'next', { id: 'b', target: { status: 'next', index: 1 } });
    expect(middle.slotActive).toBe(true);
    expect(layout(middle)).toBe('abc');
    expect(layout(planColumn(cards, 'next', { id: 'b', target: { status: 'next', index: 0 } }))).toBe('·abc');
  });

  it('opens the gap in another column at the top, in the middle or at the end, and in an empty column', () => {
    const others = [item('x', 'X', 'active', 1), item('y', 'Y', 'active', 2)];
    expect(layout(planColumn(others, 'active', over('active', 0)))).toBe('·xy');
    expect(layout(planColumn(others, 'active', over('active', 1)))).toBe('x·y');
    expect(layout(planColumn(others, 'active', over('active', 99)))).toBe('xy·');
    const empty = planColumn([], 'done', over('done', 0));
    expect(layout(empty)).toBe('·');
    expect(empty.gap).toBe(true);
  });

  it('opens no gap in columns the pointer is not over, or when it is over a status tab', () => {
    expect(planColumn(cards, 'next', over('active', 0)).gap).toBe(false);
    expect(planColumn(cards, 'next', over('next', 1, 'tab')).gap).toBe(false);
    expect(planColumn(cards, 'next', { id: 'a', target: null }).gap).toBe(false);
  });
});

describe('describeDrop', () => {
  const request = (status: DropTarget['status']) => ({ id: 'a', status, anchor: { place: 'top' as const } });
  it('names the effect of letting go', () => {
    expect(describeDrop(request('active'), 'next', 'active')).toBe('Move to Active');
    expect(describeDrop(request('next'), 'next', 'next')).toBe('Reorder in Next');
    expect(describeDrop(null, 'next', 'next')).toBe('Stays in Next');
    expect(describeDrop(null, 'next', null)).toBe('Drop on a column');
  });
});

describe('drag controller end report', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function run(target: DropTarget | null) {
    const ends: DragEnd[] = [];
    const order: string[] = [];
    const controller = createDragController({
      hitTest: () => target,
      onChange: (view) => order.push(view ? 'change' : 'cleared'),
      onDrop: () => order.push('drop'),
      onEnd: (end) => { ends.push(end); order.push(`end:${end.reason}`); },
    });
    controller.pointerDown({ id: 'a', pointerId: 1, pointerType: 'mouse', x: 0, y: 0 });
    controller.pointerMove(1, 20, 30);
    return { controller, ends, order };
  }

  it('reports a drop with its target before the view clears, then drops', () => {
    const { controller, ends, order } = run({ status: 'next', index: 2 });
    controller.pointerUp(1);
    expect(ends).toEqual([{ reason: 'drop', id: 'a', target: { status: 'next', index: 2 }, x: 20, y: 30 }]);
    expect(order).toEqual(['change', 'end:drop', 'cleared', 'drop']);
  });

  it('reports a release over no column as a drop without a target, and drops nothing', () => {
    const { controller, ends, order } = run(null);
    controller.pointerUp(1);
    expect(ends[0]).toMatchObject({ reason: 'drop', target: null });
    expect(order).toEqual(['change', 'end:drop', 'cleared']);
  });

  it('reports Escape and cancel as a cancel with no target, and drops nothing', () => {
    const { controller, ends, order } = run({ status: 'next', index: 0 });
    controller.cancel();
    expect(ends).toEqual([{ reason: 'cancel', id: 'a', target: null, x: 20, y: 30 }]);
    expect(order).toEqual(['change', 'end:cancel', 'cleared']);
    controller.cancel();
    expect(ends).toHaveLength(1);
  });

  it('reports nothing for a press that never became a drag', () => {
    const ends: DragEnd[] = [];
    const controller = createDragController({ hitTest: () => null, onChange: () => {}, onDrop: () => {}, onEnd: (end) => ends.push(end) });
    controller.pointerDown({ id: 'a', pointerId: 1, pointerType: 'mouse', x: 0, y: 0 });
    controller.pointerUp(1);
    controller.cancel();
    expect(ends).toEqual([]);
  });
});

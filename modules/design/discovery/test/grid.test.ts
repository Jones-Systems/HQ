import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GRID, gridMetrics, planGridWindow, planPreviewWindow } from '../src/previews.ts';
import { moveGridIndex } from '../src/view-model.ts';

test('auto-fill: columns follow the container width and share the space equally', () => {
  assert.equal(gridMetrics(0).columns, 1, 'an unmeasured container is one column');
  assert.equal(gridMetrics(Number.NaN).columns, 1);
  assert.equal(gridMetrics(219).columns, 1);
  assert.equal(gridMetrics(220).columns, 1);
  assert.equal(gridMetrics(454).columns, 2, 'two minimum cards and one gap');
  assert.equal(gridMetrics(453).columns, 1);
  // The 572px column of the default window leaves 524px inside the padding.
  const narrow = gridMetrics(524);
  assert.equal(narrow.columns, 2);
  assert.equal(narrow.cardWidth, (524 - DEFAULT_GRID.gap) / 2);
  assert.equal(narrow.previewHeight, Math.round(narrow.cardWidth / 1.6), 'previews are 16:10');
  assert.equal(narrow.cardHeight, narrow.previewHeight + DEFAULT_GRID.metaHeight);
  assert.equal(narrow.rowHeight, narrow.cardHeight + DEFAULT_GRID.gap);
  assert.equal(gridMetrics(1040).columns, 4);
  for (const width of [454, 524, 700, 1040, 1500]) {
    const { columns, cardWidth } = gridMetrics(width);
    assert.ok(Math.abs(columns * cardWidth + (columns - 1) * DEFAULT_GRID.gap - width) < 1e-6, `${width}px is filled exactly`);
    assert.ok(cardWidth >= DEFAULT_GRID.minCardWidth, 'no card is narrower than the minimum');
  }
  assert.equal(gridMetrics(600, { minCardWidth: 100, gap: 0 }).columns, 6, 'options override the defaults');
});

test('rows × columns become card indices: visible rows first, then the prefetch rows', () => {
  const win = planGridWindow({ total: 500, columns: 4, rowHeight: 250, scrollTop: 5000, viewportHeight: 750, prefetchRows: 2 });
  assert.equal(win.totalRows, 125);
  assert.equal(win.totalHeight, 125 * 250);
  assert.equal(win.firstRow, 20);
  assert.equal(win.offsetTop, 5000);
  // ceil(750 / 250) + 1 rows are on screen, one of them partial.
  assert.equal(win.visible.length, 4 * 4);
  assert.deepEqual([win.visible[0], win.visible.at(-1)], [80, 95]);
  assert.deepEqual(win.prefetch, [96, 97, 98, 99, 100, 101, 102, 103]);
});

test('one column behaves exactly like the original list window', () => {
  const grid = planGridWindow({ total: 500, columns: 1, rowHeight: 50, scrollTop: 5000, viewportHeight: 1150, prefetchRows: 6 });
  const list = planPreviewWindow(500, 100, 24, 6);
  assert.deepEqual(grid.visible, list.visible);
  assert.deepEqual(grid.prefetch, list.prefetch);
});

test('the window stops at the last card and survives a short, empty or over-scrolled list', () => {
  const tail = planGridWindow({ total: 10, columns: 4, rowHeight: 100, scrollTop: 200, viewportHeight: 300, prefetchRows: 3 });
  assert.equal(tail.totalRows, 3);
  assert.deepEqual(tail.visible, [8, 9], 'the partial last row holds two cards');
  assert.deepEqual(tail.prefetch, []);
  const over = planGridWindow({ total: 10, columns: 4, rowHeight: 100, scrollTop: 99_999, viewportHeight: 300, prefetchRows: 3 });
  assert.equal(over.firstRow, 2, 'a stale scroll position clamps to the last row');
  const empty = planGridWindow({ total: 0, columns: 3, rowHeight: 100, scrollTop: 0, viewportHeight: 300, prefetchRows: 3 });
  assert.deepEqual([empty.visible, empty.prefetch, empty.totalHeight], [[], [], 0]);
  const negative = planGridWindow({ total: 9, columns: 3, rowHeight: 100, scrollTop: -40, viewportHeight: 100, prefetchRows: 0 });
  assert.equal(negative.firstRow, 0);
  assert.deepEqual(negative.visible, [0, 1, 2, 3, 4, 5], 'ceil(100/100) + 1 rows');
  assert.deepEqual(negative.prefetch, []);
  assert.equal(planGridWindow({ total: 5, columns: 0, rowHeight: 0, scrollTop: 0, viewportHeight: 10, prefetchRows: 0 }).columns, 1, 'degenerate input is clamped');
});

test('only cards in the planned window are ever requested: 500 cards at 4 columns mount 24', () => {
  const win = planGridWindow({ total: 500, columns: 4, rowHeight: 248, scrollTop: 0, viewportHeight: 480, prefetchRows: 2 });
  assert.equal(win.visible.length + win.prefetch.length, (Math.ceil(480 / 248) + 1 + 2) * 4);
  assert.ok(win.visible.length + win.prefetch.length < 40);
});

test('roving focus moves by card, by row and to the ends', () => {
  const options = { columns: 3, total: 8 };
  assert.equal(moveGridIndex(4, 'ArrowRight', options), 5);
  assert.equal(moveGridIndex(4, 'ArrowLeft', options), 3);
  assert.equal(moveGridIndex(4, 'ArrowUp', options), 1);
  assert.equal(moveGridIndex(4, 'ArrowDown', options), 7);
  assert.equal(moveGridIndex(0, 'ArrowLeft', options), null, 'nothing before the first card');
  assert.equal(moveGridIndex(1, 'ArrowUp', options), null, 'nothing above the first row');
  assert.equal(moveGridIndex(7, 'ArrowRight', options), null, 'nothing after the last card');
  assert.equal(moveGridIndex(7, 'ArrowDown', options), null, 'nothing below the last row');
  assert.equal(moveGridIndex(5, 'ArrowDown', options), 7, 'a short last row lands on its last card');
  assert.equal(moveGridIndex(4, 'Home', options), 3);
  assert.equal(moveGridIndex(4, 'End', options), 5);
  assert.equal(moveGridIndex(7, 'End', options), 7, 'the short last row ends at the last card');
  assert.equal(moveGridIndex(4, 'Home', { ...options, ctrl: true }), 0);
  assert.equal(moveGridIndex(4, 'End', { ...options, ctrl: true }), 7);
  assert.equal(moveGridIndex(1, 'PageDown', { ...options, pageRows: 1 }), 4);
  assert.equal(moveGridIndex(1, 'PageDown', { ...options, pageRows: 9 }), 7, 'page keys clamp to the ends');
  assert.equal(moveGridIndex(7, 'PageUp', { ...options, pageRows: 9 }), 0);
  assert.equal(moveGridIndex(2, 'a', options), null, 'other keys are not navigation');
  assert.equal(moveGridIndex(0, 'ArrowRight', { columns: 3, total: 0 }), null, 'an empty grid has nowhere to go');
  assert.equal(moveGridIndex(3, 'ArrowDown', { columns: 1, total: 5 }), 4, 'one column is a list');
});

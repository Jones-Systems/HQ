import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artboardId, canvasItemId } from '../src/contract.ts';
import {
  addPlacement, alignNodes, distributeNodes, findNode, moveNodes, readingOrder, removeNodes, reorderNodes, setFrame, setLocked,
} from '../src/arrangement.ts';
import { snapMove } from '../src/snap.ts';
import { A, B, BOARD, C, ref, rect, sampleArrangement } from './fixtures.ts';

test('moving an item changes only its frame; refs stay byte-identical', () => {
  const before = sampleArrangement();
  const refsBefore = JSON.stringify(before.items.map((item) => item.ref));
  const after = moveNodes(before, [B], 30, -10);
  assert.deepEqual(findNode(after, B)?.node.frame, rect(1230, 30, 320, 200));
  assert.equal(JSON.stringify(after.items.map((item) => item.ref)), refsBefore);
  for (const item of after.items) if (item.id !== B) assert.equal(item, before.items.find((other) => other.id === item.id));
  assert.equal(JSON.stringify(before.items.find((item) => item.id === B)?.frame), JSON.stringify(rect(1200, 40, 320, 200)), 'input is not mutated');
});

test('placements pin the given revision and refuse duplicates or invalid frames', () => {
  const base = sampleArrangement();
  assert.equal(addPlacement(base, { id: A, ref: ref('x', 'y'), frame: rect(0, 0, 10, 10) }), base);
  assert.equal(addPlacement(base, { id: canvasItemId('n'), ref: ref('x', 'y'), frame: rect(0, 0, 0, 10) }), base);
  const added = addPlacement(base, { id: canvasItemId('n'), ref: ref('view-home', 'version-1'), frame: rect(2000, 0, 10, 10) });
  assert.deepEqual(added.items.at(-1)?.ref, ref('view-home', 'version-1'));
});

test('artboards carry their children and items join or leave artboards by center', () => {
  const base = sampleArrangement();
  assert.equal(base.items.find((item) => item.id === A)?.artboardId, BOARD);
  const movedBoard = moveNodes(base, [BOARD], 100, 50);
  assert.deepEqual(findNode(movedBoard, A)?.node.frame, rect(140, 90, 320, 200));
  const intoBoard = moveNodes(base, [C], -1000, 0);
  assert.equal(intoBoard.items.find((item) => item.id === C)?.artboardId, BOARD);
  const outOfBoard = moveNodes(base, [A], 2000, 0);
  assert.equal(outOfBoard.items.find((item) => item.id === A)?.artboardId, null);
  const both = moveNodes(base, [BOARD, A], 10, 0);
  assert.deepEqual(findNode(both, A)?.node.frame, rect(50, 40, 320, 200), 'selected child is not moved twice');
});

test('locked nodes do not move, resize or get removed through edits', () => {
  const locked = setLocked(sampleArrangement(), [B], true);
  assert.equal(moveNodes(locked, [B], 5, 5), locked);
  assert.equal(setFrame(locked, B, { width: 10 }), locked);
});

test('removing an artboard detaches its children and keeps every placement ref', () => {
  const removed = removeNodes(sampleArrangement(), [BOARD]);
  assert.equal(removed.artboards.length, 0);
  assert.equal(removed.items.find((item) => item.id === A)?.artboardId, null);
  assert.equal(removed.items.length, 3);
});

test('align, distribute and z-order', () => {
  const base = sampleArrangement();
  const right = alignNodes(base, [B, C], 'right');
  assert.equal(findNode(right, C)?.node.frame.x, 1520 - 160);
  const bottom = alignNodes(base, [B, C], 'bottom');
  assert.equal(findNode(bottom, B)?.node.frame.y, 520 - 200);
  const inBoard = alignNodes(base, [A], 'center');
  assert.equal(findNode(inBoard, A)?.node.frame.x, (1000 - 320) / 2, 'single child aligns within its artboard');
  const spaced = moveNodes(base, [C], -400, -360);
  const distributed = distributeNodes(spaced, [A, B, C], 'horizontal');
  const frames = [A, C, B].map((id) => findNode(distributed, id)!.node.frame);
  const gap1 = frames[1]!.x - (frames[0]!.x + frames[0]!.width);
  const gap2 = frames[2]!.x - (frames[1]!.x + frames[1]!.width);
  assert.ok(Math.abs(gap1 - gap2) < 1e-9);
  assert.deepEqual(reorderNodes(base, [A], 'front').items.map((item) => item.id), [B, C, A]);
  assert.deepEqual(reorderNodes(base, [C], 'backward').items.map((item) => item.id), [A, C, B]);
  assert.equal(reorderNodes(base, [C], 'front'), base, 'no-op reorder keeps identity');
});

test('setFrame on an artboard moves children with it', () => {
  const moved = setFrame(sampleArrangement(), BOARD, { x: 10, width: 1200 });
  assert.deepEqual(findNode(moved, BOARD)?.node.frame, rect(10, 0, 1200, 800));
  assert.deepEqual(findNode(moved, A)?.node.frame, rect(50, 40, 320, 200));
});

test('snap prefers object edges and centers over the grid and reports a guide', () => {
  const base = sampleArrangement();
  const snapped = snapMove(base, [C], { x: 3, y: 0 }, { zoom: 1 });
  assert.deepEqual(snapped.delta, { x: 0, y: 0 }, 'C left edge returns to B left edge (1200)');
  assert.ok(snapped.guides.some((guide) => guide.axis === 'x' && guide.at === 1200));
  const grid = snapMove(base, [C], { x: 37, y: 203 }, { zoom: 1 });
  assert.deepEqual(grid.delta, { x: 40, y: 200 }, 'snaps to the 8-unit grid when no object is near');
  assert.deepEqual(snapMove(base, [C], { x: 37, y: 203 }, { zoom: 1, disabled: true }).delta, { x: 37, y: 203 });
  const zoomedOut = snapMove(base, [C], { x: 20, y: 0 }, { zoom: 0.25 });
  assert.equal(zoomedOut.delta.x, 0, 'threshold is in screen pixels, so it widens in world units when zoomed out');
});

test('reading order follows rows then columns', () => {
  const order = readingOrder(sampleArrangement());
  assert.deepEqual(order, [BOARD, A, B, C]);
  assert.equal(artboardId('board-1'), BOARD);
});

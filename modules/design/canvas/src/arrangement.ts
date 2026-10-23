import {
  ARRANGEMENT_SCHEMA, type Artboard, type ArtboardId, type CanvasArrangement, type CanvasId, type CanvasItemId,
  type CanvasItemRef, type GridSettings, type NodeId, type Placement, type ProjectId, type Rect, type Size,
} from './contract.ts';
import { containsPoint, rectCenter, translateRect, unionRects } from './geometry.ts';

/**
 * Pure arrangement operations. Each returns a new record, or the same object
 * when nothing changed, so history can skip no-op commits. No operation ever
 * changes a placement's `ref`: arranging never touches versions or sources.
 */

export const DEFAULT_GRID: GridSettings = { size: 8, snap: true };
export const MIN_NODE_SIZE = 1;

export const ARTBOARD_PRESETS: readonly { readonly name: string; readonly size: Size }[] = [
  { name: 'Desktop', size: { width: 1440, height: 900 } },
  { name: 'Laptop', size: { width: 1280, height: 800 } },
  { name: 'Tablet', size: { width: 834, height: 1194 } },
  { name: 'Phone', size: { width: 390, height: 844 } },
];

export function emptyArrangement(canvas: CanvasId, project: ProjectId, grid: GridSettings = DEFAULT_GRID): CanvasArrangement {
  return { schema: ARRANGEMENT_SCHEMA, canvasId: canvas, projectId: project, grid, artboards: [], items: [] };
}

export type ArrangementNode =
  | { readonly kind: 'item'; readonly node: Placement }
  | { readonly kind: 'artboard'; readonly node: Artboard };

export function findNode(arrangement: CanvasArrangement, id: string): ArrangementNode | null {
  const item = arrangement.items.find((candidate) => candidate.id === id);
  if (item) return { kind: 'item', node: item };
  const board = arrangement.artboards.find((candidate) => candidate.id === id);
  return board ? { kind: 'artboard', node: board } : null;
}

export function nodeFrame(arrangement: CanvasArrangement, id: string): Rect | null {
  return findNode(arrangement, id)?.node.frame ?? null;
}

export function selectionBounds(arrangement: CanvasArrangement, ids: readonly string[]): Rect | null {
  return unionRects(ids.map((id) => nodeFrame(arrangement, id)).filter((frame): frame is Rect => frame !== null));
}

export function allBounds(arrangement: CanvasArrangement): Rect | null {
  return unionRects([...arrangement.artboards.map((board) => board.frame),
    ...arrangement.items.filter((item) => !item.hidden).map((item) => item.frame)]);
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function validRect(rect: Rect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width >= MIN_NODE_SIZE && rect.height >= MIN_NODE_SIZE;
}

/** Topmost artboard whose frame contains the frame's center, if any. */
function containingArtboard(arrangement: CanvasArrangement, frame: Rect): ArtboardId | null {
  const center = rectCenter(frame);
  for (let index = arrangement.artboards.length - 1; index >= 0; index -= 1) {
    const board = arrangement.artboards[index]!;
    if (containsPoint(board.frame, center)) return board.id;
  }
  return null;
}

export interface NewPlacement {
  readonly id: CanvasItemId;
  readonly ref: CanvasItemRef;
  readonly frame: Rect;
}

export function addPlacement(arrangement: CanvasArrangement, input: NewPlacement): CanvasArrangement {
  if (findNode(arrangement, input.id) || !validRect(input.frame)) return arrangement;
  const placement: Placement = {
    id: input.id, ref: { providerId: input.ref.providerId, entityId: input.ref.entityId, revision: input.ref.revision },
    frame: input.frame, artboardId: containingArtboard(arrangement, input.frame), locked: false, hidden: false,
  };
  return { ...arrangement, items: [...arrangement.items, placement] };
}

export function addArtboard(arrangement: CanvasArrangement, input: { readonly id: ArtboardId; readonly name: string; readonly frame: Rect }): CanvasArrangement {
  if (findNode(arrangement, input.id) || !validRect(input.frame)) return arrangement;
  const name = input.name.trim() || 'Artboard';
  return { ...arrangement, artboards: [...arrangement.artboards, { id: input.id, name, frame: input.frame, locked: false }] };
}

/**
 * Remove placements and artboards from the canvas only. Children of a removed
 * artboard stay on the canvas, detached. Provider items are never deleted.
 */
export function removeNodes(arrangement: CanvasArrangement, ids: readonly string[]): CanvasArrangement {
  const remove = new Set(ids);
  const items = arrangement.items.filter((item) => !remove.has(item.id));
  const artboards = arrangement.artboards.filter((board) => !remove.has(board.id));
  if (items.length === arrangement.items.length && artboards.length === arrangement.artboards.length) return arrangement;
  return {
    ...arrangement, artboards,
    items: items.map((item) => item.artboardId && remove.has(item.artboardId) ? { ...item, artboardId: null } : item),
  };
}

/** Ids that would actually move: unlocked nodes plus unlocked children of moved artboards. */
export function movableIds(arrangement: CanvasArrangement, ids: readonly string[]): ReadonlySet<string> {
  const requested = new Set(ids);
  const moving = new Set<string>();
  for (const board of arrangement.artboards) if (requested.has(board.id) && !board.locked) moving.add(board.id);
  for (const item of arrangement.items) {
    if (item.locked) continue;
    if (requested.has(item.id) || (item.artboardId !== null && moving.has(item.artboardId))) moving.add(item.id);
  }
  return moving;
}

/**
 * Translate nodes. Moving an artboard carries its children. Moved items join
 * the artboard under their center, or leave artboards when dropped outside.
 */
export function moveNodes(arrangement: CanvasArrangement, ids: readonly string[], dx: number, dy: number): CanvasArrangement {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return arrangement;
  const moving = movableIds(arrangement, ids);
  if (moving.size === 0) return arrangement;
  const artboards = arrangement.artboards.map((board) => moving.has(board.id) ? { ...board, frame: translateRect(board.frame, dx, dy) } : board);
  const moved: CanvasArrangement = {
    ...arrangement, artboards,
    items: arrangement.items.map((item) => moving.has(item.id) ? { ...item, frame: translateRect(item.frame, dx, dy) } : item),
  };
  return {
    ...moved,
    items: moved.items.map((item) => {
      if (!moving.has(item.id) || (item.artboardId !== null && moving.has(item.artboardId))) return item;
      const artboardId = containingArtboard(moved, item.frame);
      return artboardId === item.artboardId ? item : { ...item, artboardId };
    }),
  };
}

/** Set a node's frame (inspector edit). Locked nodes and invalid frames are refused. */
export function setFrame(arrangement: CanvasArrangement, id: string, patch: Partial<Rect>): CanvasArrangement {
  const found = findNode(arrangement, id);
  if (!found || found.node.locked) return arrangement;
  const frame: Rect = { ...found.node.frame, ...patch };
  if (!validRect(frame) || sameRect(frame, found.node.frame)) return arrangement;
  if (found.kind === 'artboard') {
    const dx = frame.x - found.node.frame.x;
    const dy = frame.y - found.node.frame.y;
    const shifted = dx === 0 && dy === 0 ? arrangement : moveNodes(arrangement, [id], dx, dy);
    return {
      ...shifted,
      artboards: shifted.artboards.map((board) => board.id === id ? { ...board, frame } : board),
    };
  }
  const placed = { ...arrangement, items: arrangement.items.map((item) => item.id === id ? { ...item, frame } : item) };
  return { ...placed, items: placed.items.map((item) => item.id === id ? { ...item, artboardId: containingArtboard(placed, frame) } : item) };
}

export function setLocked(arrangement: CanvasArrangement, ids: readonly string[], locked: boolean): CanvasArrangement {
  const target = new Set(ids);
  let changed = false;
  const items = arrangement.items.map((item) => target.has(item.id) && item.locked !== locked ? (changed = true, { ...item, locked }) : item);
  const artboards = arrangement.artboards.map((board) => target.has(board.id) && board.locked !== locked ? (changed = true, { ...board, locked }) : board);
  return changed ? { ...arrangement, items, artboards } : arrangement;
}

export function setHidden(arrangement: CanvasArrangement, ids: readonly string[], hidden: boolean): CanvasArrangement {
  const target = new Set(ids);
  let changed = false;
  const items = arrangement.items.map((item) => target.has(item.id) && item.hidden !== hidden ? (changed = true, { ...item, hidden }) : item);
  return changed ? { ...arrangement, items } : arrangement;
}

export function renameArtboard(arrangement: CanvasArrangement, id: string, name: string): CanvasArrangement {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) return arrangement;
  let changed = false;
  const artboards = arrangement.artboards.map((board) => board.id === id && board.name !== trimmed ? (changed = true, { ...board, name: trimmed }) : board);
  return changed ? { ...arrangement, artboards } : arrangement;
}

export function setGrid(arrangement: CanvasArrangement, patch: Partial<GridSettings>): CanvasArrangement {
  const grid = { ...arrangement.grid, ...patch };
  if (!Number.isInteger(grid.size) || grid.size < 1 || grid.size > 512) return arrangement;
  return grid.size === arrangement.grid.size && grid.snap === arrangement.grid.snap ? arrangement : { ...arrangement, grid };
}

export type ZOrder = 'front' | 'back' | 'forward' | 'backward';

function reorder<T extends { readonly id: string }>(list: readonly T[], ids: ReadonlySet<string>, order: ZOrder): readonly T[] {
  const selected = list.filter((entry) => ids.has(entry.id));
  if (selected.length === 0 || selected.length === list.length) return list;
  if (order === 'front') return [...list.filter((entry) => !ids.has(entry.id)), ...selected];
  if (order === 'back') return [...selected, ...list.filter((entry) => !ids.has(entry.id))];
  const next = [...list];
  if (order === 'forward') {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (ids.has(next[index]!.id) && !ids.has(next[index + 1]!.id)) [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (ids.has(next[index]!.id) && !ids.has(next[index - 1]!.id)) [next[index], next[index - 1]] = [next[index - 1]!, next[index]!];
    }
  }
  return next;
}

function sameOrder(a: readonly { readonly id: string }[], b: readonly { readonly id: string }[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry.id === b[index]!.id);
}

/** Change z-order. Items reorder among items, artboards among artboards. */
export function reorderNodes(arrangement: CanvasArrangement, ids: readonly string[], order: ZOrder): CanvasArrangement {
  const target = new Set(ids);
  const items = reorder(arrangement.items, target, order);
  const artboards = reorder(arrangement.artboards, target, order);
  if (sameOrder(items, arrangement.items) && sameOrder(artboards, arrangement.artboards)) return arrangement;
  return { ...arrangement, items, artboards };
}

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/**
 * Align to the selection bounds. A single item inside an artboard aligns to
 * that artboard instead. Locked nodes stay put.
 */
export function alignNodes(arrangement: CanvasArrangement, ids: readonly string[], alignment: Alignment): CanvasArrangement {
  const nodes = ids.map((id) => findNode(arrangement, id)).filter((node): node is ArrangementNode => node !== null);
  let reference: Rect | null = null;
  if (nodes.length === 1 && nodes[0]!.kind === 'item' && nodes[0]!.node.artboardId) {
    reference = nodeFrame(arrangement, nodes[0]!.node.artboardId);
  } else if (nodes.length >= 2) {
    reference = unionRects(nodes.map((node) => node.node.frame));
  }
  if (!reference) return arrangement;
  let next = arrangement;
  for (const { node } of nodes) {
    const frame = nodeFrame(next, node.id) ?? node.frame;
    const dx = alignment === 'left' ? reference.x - frame.x
      : alignment === 'center' ? reference.x + (reference.width - frame.width) / 2 - frame.x
        : alignment === 'right' ? reference.x + reference.width - frame.width - frame.x : 0;
    const dy = alignment === 'top' ? reference.y - frame.y
      : alignment === 'middle' ? reference.y + (reference.height - frame.height) / 2 - frame.y
        : alignment === 'bottom' ? reference.y + reference.height - frame.height - frame.y : 0;
    next = moveNodes(next, [node.id], dx, dy);
  }
  return next;
}

/** Equalize gaps between three or more nodes along an axis, keeping the outer two fixed. */
export function distributeNodes(arrangement: CanvasArrangement, ids: readonly string[], axis: 'horizontal' | 'vertical'): CanvasArrangement {
  const nodes = ids.map((id) => findNode(arrangement, id)).filter((node): node is ArrangementNode => node !== null);
  if (nodes.length < 3) return arrangement;
  const start = (rect: Rect) => axis === 'horizontal' ? rect.x : rect.y;
  const size = (rect: Rect) => axis === 'horizontal' ? rect.width : rect.height;
  const sorted = [...nodes].sort((a, b) => start(a.node.frame) - start(b.node.frame) || a.node.id.localeCompare(b.node.id));
  const first = sorted[0]!.node.frame;
  const last = sorted[sorted.length - 1]!.node.frame;
  const span = start(last) + size(last) - start(first);
  const occupied = sorted.reduce((total, node) => total + size(node.node.frame), 0);
  const gap = (span - occupied) / (sorted.length - 1);
  let next = arrangement;
  let cursor = start(first) + size(first) + gap;
  for (const node of sorted.slice(1, -1)) {
    const delta = cursor - start(nodeFrame(next, node.node.id) ?? node.node.frame);
    next = axis === 'horizontal' ? moveNodes(next, [node.node.id], delta, 0) : moveNodes(next, [node.node.id], 0, delta);
    cursor += size(node.node.frame) + gap;
  }
  return next;
}

/** Ids of nodes in reading order (top-to-bottom rows, then left-to-right) for keyboard focus. */
export function readingOrder(arrangement: CanvasArrangement): readonly NodeId[] {
  const nodes: { id: NodeId; frame: Rect }[] = [
    ...arrangement.artboards.map((board) => ({ id: board.id, frame: board.frame })),
    ...arrangement.items.filter((item) => !item.hidden).map((item) => ({ id: item.id, frame: item.frame })),
  ];
  const rowHeight = 48;
  return nodes.sort((a, b) => Math.floor(a.frame.y / rowHeight) - Math.floor(b.frame.y / rowHeight)
    || a.frame.x - b.frame.x || a.frame.y - b.frame.y || a.id.localeCompare(b.id)).map((node) => node.id);
}

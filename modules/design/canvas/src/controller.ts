import type { ArtboardId, Camera, CanvasArrangement, CanvasItemId, CanvasItemRef, GridSettings, NodeId, Point, Rect, Size } from './contract.ts';
import {
  addArtboard, addPlacement, alignNodes, allBounds, distributeNodes, findNode, moveNodes, readingOrder, removeNodes,
  renameArtboard, reorderNodes, selectionBounds, setFrame, setGrid, setHidden, setLocked,
  type Alignment, type ZOrder,
} from './arrangement.ts';
import { DEFAULT_CAMERA, clampZoom, ensureVisible, fitRect, intersects, panBy, rectFromPoints, screenToWorld, zoomAt, zoomTo } from './geometry.ts';
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from './history.ts';
import { ZOOM_STEP, keyCommand, normalizeWheel, type KeyInput, type Platform, type WheelInput } from './input.ts';
import { snapMove, type SnapGuide } from './snap.ts';

/** Edits that change the persisted arrangement. Each committed edit is one undo step. */
export type ArrangementEdit =
  | { readonly kind: 'add-placement'; readonly id: CanvasItemId; readonly ref: CanvasItemRef; readonly frame: Rect }
  | { readonly kind: 'add-artboard'; readonly id: ArtboardId; readonly name: string; readonly frame: Rect }
  | { readonly kind: 'remove'; readonly ids: readonly string[] }
  | { readonly kind: 'move'; readonly ids: readonly string[]; readonly dx: number; readonly dy: number }
  | { readonly kind: 'set-frame'; readonly id: string; readonly frame: Partial<Rect> }
  | { readonly kind: 'align'; readonly ids: readonly string[]; readonly alignment: Alignment }
  | { readonly kind: 'distribute'; readonly ids: readonly string[]; readonly axis: 'horizontal' | 'vertical' }
  | { readonly kind: 'reorder'; readonly ids: readonly string[]; readonly order: ZOrder }
  | { readonly kind: 'lock'; readonly ids: readonly string[]; readonly locked: boolean }
  | { readonly kind: 'hide'; readonly ids: readonly string[]; readonly hidden: boolean }
  | { readonly kind: 'rename-artboard'; readonly id: string; readonly name: string }
  | { readonly kind: 'grid'; readonly grid: Partial<GridSettings> };

export function applyEdit(arrangement: CanvasArrangement, edit: ArrangementEdit): CanvasArrangement {
  switch (edit.kind) {
    case 'add-placement': return addPlacement(arrangement, edit);
    case 'add-artboard': return addArtboard(arrangement, edit);
    case 'remove': return removeNodes(arrangement, edit.ids.filter((id) => !findNode(arrangement, id)?.node.locked));
    case 'move': return moveNodes(arrangement, edit.ids, edit.dx, edit.dy);
    case 'set-frame': return setFrame(arrangement, edit.id, edit.frame);
    case 'align': return alignNodes(arrangement, edit.ids, edit.alignment);
    case 'distribute': return distributeNodes(arrangement, edit.ids, edit.axis);
    case 'reorder': return reorderNodes(arrangement, edit.ids, edit.order);
    case 'lock': return setLocked(arrangement, edit.ids, edit.locked);
    case 'hide': return setHidden(arrangement, edit.ids, edit.hidden);
    case 'rename-artboard': return renameArtboard(arrangement, edit.id, edit.name);
    case 'grid': return setGrid(arrangement, edit.grid);
  }
}

export type Gesture =
  | { readonly kind: 'move'; readonly ids: readonly string[]; readonly origin: Point; readonly start: Point }
  | { readonly kind: 'marquee'; readonly origin: Point; readonly current: Point; readonly additive: boolean; readonly base: readonly NodeId[] }
  | { readonly kind: 'pan'; readonly last: Point };

export interface CanvasState {
  readonly history: History<CanvasArrangement>;
  /** Uncommitted arrangement shown during a drag; committed once on pointer up. */
  readonly preview: CanvasArrangement | null;
  readonly camera: Camera;
  /** Viewport size in CSS pixels. */
  readonly viewport: Size;
  readonly selection: readonly NodeId[];
  /** Node holding keyboard focus inside the canvas, or `null` for the canvas surface. */
  readonly focusId: NodeId | null;
  readonly gesture: Gesture | null;
  readonly guides: readonly SnapGuide[];
  /** Loaded from a record that cannot be edited safely (future schema, invalid, mismatch). */
  readonly readOnly: boolean;
}

export type CanvasAction =
  | { readonly type: 'load'; readonly arrangement: CanvasArrangement; readonly readOnly?: boolean }
  | { readonly type: 'edit'; readonly edit: ArrangementEdit }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'viewport'; readonly size: Size }
  | { readonly type: 'camera'; readonly camera: Camera }
  | { readonly type: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly type: 'zoom-at'; readonly anchor: Point; readonly factor: number }
  | { readonly type: 'zoom-to'; readonly zoom: number; readonly anchor?: Point }
  | { readonly type: 'fit'; readonly target: 'all' | 'selection' }
  | { readonly type: 'wheel'; readonly input: WheelInput; readonly anchor: Point }
  | { readonly type: 'key'; readonly input: KeyInput; readonly platform: Platform }
  | { readonly type: 'pointer-down'; readonly point: Point; readonly target: NodeId | null; readonly toggle: boolean; readonly pan: boolean }
  | { readonly type: 'pointer-move'; readonly point: Point; readonly noSnap?: boolean }
  | { readonly type: 'pointer-up' }
  | { readonly type: 'pointer-cancel' }
  | { readonly type: 'select'; readonly ids: readonly NodeId[]; readonly mode?: 'replace' | 'toggle' | 'add' }
  | { readonly type: 'focus'; readonly id: NodeId | null }
  | { readonly type: 'restore-session'; readonly session: CanvasSession };

/** Screen distance a pointer must travel before a press on an item becomes a move. */
export const DRAG_THRESHOLD_PX = 3;
export const DEFAULT_VIEWPORT: Size = { width: 1024, height: 768 };

export function createCanvasState(arrangement: CanvasArrangement, options: { readonly readOnly?: boolean; readonly viewport?: Size; readonly camera?: Camera } = {}): CanvasState {
  return {
    history: createHistory(arrangement), preview: null, camera: options.camera ?? DEFAULT_CAMERA,
    viewport: options.viewport ?? DEFAULT_VIEWPORT, selection: [], focusId: null, gesture: null, guides: [],
    readOnly: options.readOnly ?? false,
  };
}

/** The arrangement to render: the drag preview when one is active, else the committed record. */
export const visibleArrangement = (state: CanvasState): CanvasArrangement => state.preview ?? state.history.present;
export const committedArrangement = (state: CanvasState): CanvasArrangement => state.history.present;
export const undoAvailable = (state: CanvasState): boolean => !state.readOnly && state.gesture === null && canUndo(state.history);
export const redoAvailable = (state: CanvasState): boolean => !state.readOnly && state.gesture === null && canRedo(state.history);

function present(arrangement: CanvasArrangement, ids: readonly NodeId[]): readonly NodeId[] {
  return ids.filter((id) => findNode(arrangement, id) !== null);
}

function withArrangement(state: CanvasState, history: History<CanvasArrangement>): CanvasState {
  if (history === state.history) return state;
  const arrangement = history.present;
  const focusId = state.focusId && findNode(arrangement, state.focusId) ? state.focusId : null;
  return { ...state, history, selection: present(arrangement, state.selection), focusId };
}

function edit(state: CanvasState, change: ArrangementEdit): CanvasState {
  if (state.readOnly || state.gesture) return state;
  return withArrangement(state, commit(state.history, applyEdit(state.history.present, change)));
}

function center(state: CanvasState): Point {
  return { x: state.viewport.width / 2, y: state.viewport.height / 2 };
}

function setCamera(state: CanvasState, camera: Camera): CanvasState {
  return camera.x === state.camera.x && camera.y === state.camera.y && camera.zoom === state.camera.zoom ? state : { ...state, camera };
}

function fit(state: CanvasState, target: 'all' | 'selection'): CanvasState {
  const arrangement = visibleArrangement(state);
  const bounds = target === 'selection' && state.selection.length > 0 ? selectionBounds(arrangement, state.selection) : allBounds(arrangement);
  return bounds ? setCamera(state, fitRect(bounds, state.viewport)) : state;
}

function focus(state: CanvasState, id: NodeId | null): CanvasState {
  if (id === null) return state.focusId === null ? state : { ...state, focusId: null };
  const found = findNode(visibleArrangement(state), id);
  if (!found) return state;
  return { ...setCamera(state, ensureVisible(state.camera, state.viewport, found.node.frame)), focusId: id };
}

function select(state: CanvasState, ids: readonly NodeId[], mode: 'replace' | 'toggle' | 'add'): CanvasState {
  const valid = present(visibleArrangement(state), ids);
  let selection: readonly NodeId[];
  if (mode === 'replace') selection = [...new Set(valid)];
  else if (mode === 'add') selection = [...new Set([...state.selection, ...valid])];
  else {
    const toggled = new Set(state.selection);
    for (const id of valid) if (toggled.has(id)) toggled.delete(id); else toggled.add(id);
    selection = [...toggled];
  }
  return { ...state, selection };
}

/** Next focus target in reading order, or `null` when focus should leave the canvas. */
export function nextFocus(state: CanvasState, direction: 1 | -1): NodeId | null {
  const order = readingOrder(visibleArrangement(state));
  if (order.length === 0) return null;
  if (state.focusId === null) return direction === 1 ? order[0]! : null;
  const index = order.indexOf(state.focusId);
  const next = index + direction;
  return index === -1 ? order[0]! : next >= 0 && next < order.length ? order[next]! : null;
}

function key(state: CanvasState, input: KeyInput, platform: Platform): CanvasState {
  const command = keyCommand(input, platform, state.selection.length > 0);
  if (!command) return state;
  switch (command.kind) {
    case 'pan': return setCamera(state, panBy(state.camera, command.dx, command.dy));
    case 'nudge': return edit(state, { kind: 'move', ids: state.selection, dx: command.dx, dy: command.dy });
    case 'zoom-step': return setCamera(state, zoomAt(state.camera, center(state), command.direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP));
    case 'zoom-reset': return setCamera(state, zoomTo(state.camera, center(state), 1));
    case 'fit': return fit(state, command.target);
    case 'focus-step': {
      const next = nextFocus(state, command.direction);
      return next === null ? state : focus(state, next);
    }
    case 'activate': return state.focusId ? select(state, [state.focusId], command.toggle ? 'toggle' : 'replace') : state;
    case 'escape':
      if (state.gesture) return cancelGesture(state);
      return state.selection.length > 0 ? { ...state, selection: [] } : state;
    case 'select-all': return select(state, readingOrder(visibleArrangement(state)), 'replace');
    case 'remove': return edit(state, { kind: 'remove', ids: state.selection });
    case 'undo': return reduceCanvas(state, { type: 'undo' });
    case 'redo': return reduceCanvas(state, { type: 'redo' });
    case 'reorder': return edit(state, { kind: 'reorder', ids: state.selection, order: command.order });
  }
}

/** Whether `keyCommand` would handle this key, so the view can prevent the browser default. */
export function handlesKey(state: CanvasState, input: KeyInput, platform: Platform): boolean {
  const command = keyCommand(input, platform, state.selection.length > 0);
  if (!command) return false;
  if (command.kind === 'focus-step') return nextFocus(state, command.direction) !== null;
  return true;
}

function cancelGesture(state: CanvasState): CanvasState {
  if (!state.gesture) return state;
  if (state.gesture.kind === 'marquee') return { ...state, gesture: null, guides: [], selection: state.gesture.base };
  return { ...state, gesture: null, preview: null, guides: [] };
}

function pointerDown(state: CanvasState, action: Extract<CanvasAction, { type: 'pointer-down' }>): CanvasState {
  const base = cancelGesture(state);
  if (action.pan) return { ...base, gesture: { kind: 'pan', last: action.point } };
  const origin = screenToWorld(base.camera, action.point);
  if (action.target === null) {
    return {
      ...base, focusId: null,
      selection: action.toggle ? base.selection : [],
      gesture: { kind: 'marquee', origin, current: origin, additive: action.toggle, base: action.toggle ? base.selection : [] },
    };
  }
  const selected = action.toggle ? select(base, [action.target], 'toggle')
    : base.selection.includes(action.target) ? base : select(base, [action.target], 'replace');
  const next = { ...selected, focusId: action.target };
  if (base.readOnly || !next.selection.includes(action.target)) return next;
  return { ...next, gesture: { kind: 'move', ids: next.selection, origin, start: action.point } };
}

function pointerMove(state: CanvasState, point: Point, noSnap: boolean): CanvasState {
  const gesture = state.gesture;
  if (!gesture) return state;
  if (gesture.kind === 'pan') {
    return { ...setCamera(state, panBy(state.camera, gesture.last.x - point.x, gesture.last.y - point.y)), gesture: { kind: 'pan', last: point } };
  }
  const world = screenToWorld(state.camera, point);
  if (gesture.kind === 'marquee') {
    const area = rectFromPoints(gesture.origin, world);
    const arrangement = visibleArrangement(state);
    const hits: NodeId[] = [
      ...arrangement.artboards.filter((board) => intersects(area, board.frame)
        && board.frame.x >= area.x && board.frame.y >= area.y
        && board.frame.x + board.frame.width <= area.x + area.width && board.frame.y + board.frame.height <= area.y + area.height).map((board) => board.id),
      ...arrangement.items.filter((item) => !item.hidden && intersects(area, item.frame)).map((item) => item.id),
    ];
    return { ...state, gesture: { ...gesture, current: world }, selection: [...new Set([...gesture.base, ...hits])] };
  }
  if (!state.preview && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < DRAG_THRESHOLD_PX) return state;
  const base = state.history.present;
  const proposed = { x: world.x - gesture.origin.x, y: world.y - gesture.origin.y };
  const snapped = snapMove(base, gesture.ids, proposed, { zoom: state.camera.zoom, disabled: noSnap });
  return { ...state, preview: moveNodes(base, gesture.ids, snapped.delta.x, snapped.delta.y), guides: snapped.guides };
}

function pointerUp(state: CanvasState): CanvasState {
  const gesture = state.gesture;
  if (!gesture) return state;
  if (gesture.kind !== 'move' || !state.preview) return { ...state, gesture: null, guides: [], preview: null };
  const committed = withArrangement(state, commit(state.history, state.preview));
  return { ...committed, gesture: null, guides: [], preview: null };
}

/** Pure canvas reducer. Only `edit`, nudges, removals, drags, undo and redo change the arrangement. */
export function reduceCanvas(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'load': return createCanvasState(action.arrangement, { readOnly: action.readOnly ?? false, viewport: state.viewport, camera: state.camera });
    case 'edit': return edit(state, action.edit);
    case 'undo': return state.readOnly || state.gesture ? state : withArrangement(state, undo(state.history));
    case 'redo': return state.readOnly || state.gesture ? state : withArrangement(state, redo(state.history));
    case 'viewport': {
      const size = { width: Math.max(1, action.size.width), height: Math.max(1, action.size.height) };
      return size.width === state.viewport.width && size.height === state.viewport.height ? state : { ...state, viewport: size };
    }
    case 'camera': return setCamera(state, { ...action.camera, zoom: clampZoom(action.camera.zoom) });
    case 'pan': return setCamera(state, panBy(state.camera, action.dx, action.dy));
    case 'zoom-at': return setCamera(state, zoomAt(state.camera, action.anchor, action.factor));
    case 'zoom-to': return setCamera(state, zoomTo(state.camera, action.anchor ?? center(state), action.zoom));
    case 'fit': return fit(state, action.target);
    case 'wheel': {
      const intent = normalizeWheel(action.input, state.viewport.height);
      return intent.kind === 'zoom'
        ? setCamera(state, zoomAt(state.camera, action.anchor, intent.factor))
        : setCamera(state, panBy(state.camera, intent.dx, intent.dy));
    }
    case 'key': return key(state, action.input, action.platform);
    case 'pointer-down': return pointerDown(state, action);
    case 'pointer-move': return pointerMove(state, action.point, action.noSnap ?? false);
    case 'pointer-up': return pointerUp(state);
    case 'pointer-cancel': return cancelGesture(state);
    case 'select': return select(state, action.ids, action.mode ?? 'replace');
    case 'focus': return focus(state, action.id);
    case 'restore-session': return restoreSession(state, action.session);
  }
}

/**
 * Per-device view state for keep-alive across domain switches. It is not part
 * of the arrangement record and never enters history.
 */
export interface CanvasSession {
  readonly camera: Camera;
  readonly selection: readonly string[];
  readonly focusId: string | null;
}

export function serializeSession(state: CanvasState): CanvasSession {
  return { camera: state.camera, selection: [...state.selection], focusId: state.focusId };
}

export function restoreSession(state: CanvasState, session: CanvasSession): CanvasState {
  const camera = session.camera;
  const validCamera = [camera.x, camera.y, camera.zoom].every(Number.isFinite) && camera.zoom > 0;
  const arrangement = visibleArrangement(state);
  const selection = present(arrangement, session.selection as readonly NodeId[]);
  const focusId = session.focusId && findNode(arrangement, session.focusId) ? session.focusId as NodeId : null;
  return {
    ...state, camera: validCamera ? { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) } : state.camera,
    selection, focusId,
  };
}

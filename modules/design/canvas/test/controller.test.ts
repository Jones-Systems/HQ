import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  committedArrangement, createCanvasState, handlesKey, reduceCanvas, redoAvailable, restoreSession, serializeSession,
  undoAvailable, visibleArrangement, type CanvasAction, type CanvasState,
} from '../src/controller.ts';
import { findNode } from '../src/arrangement.ts';
import { screenToWorld } from '../src/geometry.ts';
import { encodeArrangement } from '../src/codec.ts';
import type { KeyInput } from '../src/input.ts';
import { A, B, BOARD, C, close, rect, sampleArrangement } from './fixtures.ts';

const run = (state: CanvasState, ...actions: CanvasAction[]) => actions.reduce(reduceCanvas, state);
const key = (key: string, extra: Partial<KeyInput> = {}): CanvasAction => ({
  type: 'key', platform: 'other',
  input: { key, code: extra.code ?? '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra },
});
const fresh = () => createCanvasState(sampleArrangement(), { viewport: { width: 1000, height: 700 } });

test('a drag previews without history and commits exactly one undo step on pointer up', () => {
  const start = fresh();
  const pressed = run(start, { type: 'pointer-down', point: { x: 1250, y: 100 }, target: B, toggle: false, pan: false });
  assert.deepEqual(pressed.selection, [B]);
  const dragging = run(pressed,
    { type: 'pointer-move', point: { x: 1260, y: 110 }, noSnap: true },
    { type: 'pointer-move', point: { x: 1290, y: 130 }, noSnap: true });
  assert.equal(dragging.history, start.history, 'no commit while dragging');
  assert.deepEqual(findNode(visibleArrangement(dragging), B)?.node.frame, rect(1240, 70, 320, 200));
  const dropped = run(dragging, { type: 'pointer-up' });
  assert.equal(dropped.history.past.length, 1);
  assert.equal(dropped.preview, null);
  assert.deepEqual(findNode(committedArrangement(dropped), B)?.node.frame, rect(1240, 70, 320, 200));
});

test('a click without travel does not commit; Escape cancels a drag', () => {
  const start = fresh();
  const clicked = run(start,
    { type: 'pointer-down', point: { x: 1250, y: 100 }, target: B, toggle: false, pan: false },
    { type: 'pointer-move', point: { x: 1251, y: 101 } }, { type: 'pointer-up' });
  assert.equal(clicked.history, start.history);
  const cancelled = run(start,
    { type: 'pointer-down', point: { x: 1250, y: 100 }, target: B, toggle: false, pan: false },
    { type: 'pointer-move', point: { x: 1400, y: 300 } }, key('Escape'), { type: 'pointer-up' });
  assert.equal(cancelled.history, start.history);
  assert.equal(visibleArrangement(cancelled), committedArrangement(start));
});

test('undo/redo restores the exact arrangement record and is symmetric', () => {
  const start = fresh();
  const original = encodeArrangement(committedArrangement(start));
  const edited = run(start,
    { type: 'edit', edit: { kind: 'move', ids: [B], dx: 16, dy: 0 } },
    { type: 'edit', edit: { kind: 'align', ids: [B, C], alignment: 'top' } },
    { type: 'edit', edit: { kind: 'reorder', ids: [A], order: 'front' } },
    { type: 'edit', edit: { kind: 'remove', ids: [C] } });
  const final = encodeArrangement(committedArrangement(edited));
  const undone = run(edited, { type: 'undo' }, { type: 'undo' }, { type: 'undo' }, { type: 'undo' });
  assert.equal(encodeArrangement(committedArrangement(undone)), original);
  assert.equal(undoAvailable(undone), false);
  const redone = run(undone, { type: 'redo' }, { type: 'redo' }, { type: 'redo' }, { type: 'redo' });
  assert.equal(encodeArrangement(committedArrangement(redone)), final);
  assert.equal(redoAvailable(redone), false);
  const keyboard = run(edited, key('z', { ctrlKey: true }), key('z', { ctrlKey: true, shiftKey: true }), key('y', { ctrlKey: true }));
  assert.equal(keyboard.history.past.length, edited.history.past.length);
  const mac = run(edited, { ...key('z'), platform: 'mac', input: { ...(key('z') as Extract<CanvasAction, { type: 'key' }>).input, metaKey: true } });
  assert.equal(mac.history.past.length, edited.history.past.length - 1);
});

test('undo drops selection of nodes that no longer exist; camera is not history', () => {
  const added = run(fresh(), { type: 'select', ids: [C] }, key('Delete'));
  assert.equal(findNode(committedArrangement(added), C), null);
  assert.deepEqual(added.selection, []);
  const panned = run(added, { type: 'pan', dx: 100, dy: 0 }, { type: 'undo' });
  assert.ok(findNode(committedArrangement(panned), C));
  assert.equal(panned.camera.x, 100, 'undo does not move the camera');
});

test('keyboard pans with arrows when nothing is selected and nudges a selection', () => {
  const start = fresh();
  const panned = run(start, key('ArrowRight'), key('ArrowDown', { shiftKey: true }));
  assert.deepEqual(panned.camera, { x: 48, y: 240, zoom: 1 });
  assert.equal(panned.history, start.history, 'panning never edits the arrangement');
  const selected = run(start, { type: 'select', ids: [B] }, key('ArrowLeft'), key('ArrowUp', { shiftKey: true }));
  assert.deepEqual(findNode(committedArrangement(selected), B)?.node.frame, rect(1199, 30, 320, 200));
  assert.equal(selected.history.past.length, 2);
  const altPan = run(selected, key('ArrowLeft', { altKey: true }));
  assert.equal(altPan.camera.x, -48);
  assert.equal(altPan.history, selected.history);
});

test('keyboard zoom steps keep the viewport center fixed; Shift+0 resets; Shift+1 fits all', () => {
  const start = run(fresh(), { type: 'pan', dx: 123, dy: -45 });
  const middle = { x: 500, y: 350 };
  const pinned = screenToWorld(start.camera, middle);
  const zoomed = run(start, key('='), key('='), key('-', { ctrlKey: true }));
  assert.ok(close(zoomed.camera.zoom, 1.25));
  const after = screenToWorld(zoomed.camera, middle);
  assert.ok(close(after.x, pinned.x) && close(after.y, pinned.y));
  assert.equal(run(zoomed, key(')', { shiftKey: true, code: 'Digit0' })).camera.zoom, 1);
  const fitted = run(start, key('!', { shiftKey: true, code: 'Digit1' }));
  assert.ok(fitted.camera.zoom < 1);
});

test('Tab walks focus through nodes in reading order, keeps it visible, and releases at the end', () => {
  let state = fresh();
  const seen: (string | null)[] = [];
  for (let index = 0; index < 4; index += 1) {
    assert.equal(handlesKey(state, (key('Tab') as Extract<CanvasAction, { type: 'key' }>).input, 'other'), true);
    state = run(state, key('Tab'));
    seen.push(state.focusId);
  }
  assert.deepEqual(seen, [BOARD, A, B, C]);
  assert.ok(state.camera.x > 0, 'focusing an off-screen node pans it into view');
  const frame = findNode(visibleArrangement(state), C)!.node.frame;
  assert.ok(frame.x + frame.width <= state.camera.x + state.viewport.width / state.camera.zoom);
  assert.equal(handlesKey(state, (key('Tab') as Extract<CanvasAction, { type: 'key' }>).input, 'other'), false, 'Tab leaves the canvas after the last node');
  const back = run(state, key('Tab', { shiftKey: true }));
  assert.equal(back.focusId, B);
  const activated = run(back, key('Enter'), { type: 'focus', id: C }, key(' ', { shiftKey: true }));
  assert.deepEqual(activated.selection, [B, C]);
  assert.deepEqual(run(activated, key('Escape')).selection, []);
});

test('wheel pans, Ctrl+wheel and trackpad pinch zoom around the cursor', () => {
  const start = fresh();
  const wheel = (input: Partial<Extract<CanvasAction, { type: 'wheel' }>['input']>, anchor = { x: 640, y: 222 }): CanvasAction =>
    ({ type: 'wheel', anchor, input: { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...input } });
  const panned = run(start, wheel({ deltaX: 15, deltaY: 30 }));
  assert.deepEqual(panned.camera, { x: 15, y: 30, zoom: 1 });
  const lines = run(start, wheel({ deltaY: 3, deltaMode: 1 }));
  assert.equal(lines.camera.y, 48);
  const anchor = { x: 640, y: 222 };
  const pinned = screenToWorld(start.camera, anchor);
  const pinch = run(start, wheel({ deltaY: -8, ctrlKey: true }), wheel({ deltaY: -120, ctrlKey: true }), wheel({ deltaY: 4, metaKey: true }));
  assert.ok(pinch.camera.zoom > 1);
  const after = screenToWorld(pinch.camera, anchor);
  assert.ok(close(after.x, pinned.x) && close(after.y, pinned.y));
});

test('marquee selects intersecting items and fully enclosed artboards; Shift adds', () => {
  const start = fresh();
  const marquee = run(start,
    { type: 'pointer-down', point: { x: 1100, y: 0 }, target: null, toggle: false, pan: false },
    { type: 'pointer-move', point: { x: 1300, y: 450 } }, { type: 'pointer-up' });
  assert.deepEqual(marquee.selection, [B, C]);
  const additive = run(start, { type: 'select', ids: [A] },
    { type: 'pointer-down', point: { x: 1100, y: 380 }, target: null, toggle: true, pan: false },
    { type: 'pointer-move', point: { x: 1300, y: 450 } }, { type: 'pointer-up' });
  assert.deepEqual(additive.selection, [A, C]);
  const enclosing = run(start,
    { type: 'pointer-down', point: { x: -10, y: -10 }, target: null, toggle: false, pan: false },
    { type: 'pointer-move', point: { x: 1010, y: 810 } }, { type: 'pointer-up' });
  assert.deepEqual(enclosing.selection, [BOARD, A]);
  assert.equal(marquee.history, start.history);
});

test('shift-click toggles multi-select and dragging moves the whole selection once', () => {
  const state = run(fresh(), { type: 'select', ids: [B] },
    { type: 'pointer-down', point: { x: 1250, y: 450 }, target: C, toggle: true, pan: false },
    { type: 'pointer-move', point: { x: 1270, y: 470 }, noSnap: true }, { type: 'pointer-up' });
  assert.deepEqual(state.selection, [B, C]);
  assert.deepEqual(findNode(committedArrangement(state), B)?.node.frame, rect(1220, 60, 320, 200));
  assert.deepEqual(findNode(committedArrangement(state), C)?.node.frame, rect(1220, 420, 160, 120));
  assert.equal(state.history.past.length, 1);
});

test('space or middle-button drag pans without selecting or editing', () => {
  const start = fresh();
  const panned = run(start,
    { type: 'pointer-down', point: { x: 500, y: 300 }, target: B, toggle: false, pan: true },
    { type: 'pointer-move', point: { x: 450, y: 320 } }, { type: 'pointer-up' });
  assert.deepEqual(panned.camera, { x: 50, y: -20, zoom: 1 });
  assert.deepEqual(panned.selection, []);
  assert.equal(panned.history, start.history);
});

test('read-only canvases navigate and select but never edit', () => {
  const start = createCanvasState(sampleArrangement(), { readOnly: true });
  const state = run(start, { type: 'select', ids: [B] }, key('ArrowLeft'),
    { type: 'edit', edit: { kind: 'move', ids: [B], dx: 1, dy: 1 } },
    { type: 'pointer-down', point: { x: 1250, y: 100 }, target: B, toggle: false, pan: false },
    { type: 'pointer-move', point: { x: 1400, y: 300 } }, { type: 'pointer-up' }, key('Delete'), key('ArrowLeft', { altKey: true }));
  assert.equal(state.history, start.history);
  assert.deepEqual(state.selection, [B]);
  assert.equal(state.camera.x, -48);
});

test('session keep-alive restores camera, selection and focus, dropping unknown ids', () => {
  const live = run(fresh(), { type: 'zoom-to', zoom: 2 }, { type: 'select', ids: [A, B] }, { type: 'focus', id: B });
  const session = serializeSession(live);
  const restored = restoreSession(fresh(), JSON.parse(JSON.stringify({ ...session, selection: [...session.selection, 'gone'] })));
  assert.deepEqual(restored.camera, live.camera);
  assert.deepEqual(restored.selection, [A, B]);
  assert.equal(restored.focusId, B);
  const invalid = restoreSession(fresh(), { camera: { x: Number.NaN, y: 0, zoom: 1 }, selection: [], focusId: 'gone' });
  assert.deepEqual(invalid.camera, fresh().camera);
  assert.equal(invalid.focusId, null);
});

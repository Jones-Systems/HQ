import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyCommand, normalizeWheel, type KeyInput, type WheelInput } from '../src/input.ts';

const wheel = (input: Partial<WheelInput>): WheelInput => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...input });
const key = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({ key, code: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra });

test('wheel normalization handles pixel, line and page modes and shift-scroll', () => {
  assert.deepEqual(normalizeWheel(wheel({ deltaX: 4, deltaY: 9 }), 700), { kind: 'pan', dx: 4, dy: 9 });
  assert.deepEqual(normalizeWheel(wheel({ deltaY: 2, deltaMode: 1 }), 700), { kind: 'pan', dx: 0, dy: 32 });
  assert.deepEqual(normalizeWheel(wheel({ deltaY: 1, deltaMode: 2 }), 700), { kind: 'pan', dx: 0, dy: 700 });
  assert.deepEqual(normalizeWheel(wheel({ deltaY: 30, shiftKey: true }), 700), { kind: 'pan', dx: 30, dy: 0 });
  assert.deepEqual(normalizeWheel(wheel({ deltaY: Number.NaN }), 700), { kind: 'pan', dx: 0, dy: 0 });
});

test('ctrl/meta wheel (and trackpad pinch) zoom with a bounded per-event factor', () => {
  const pinchIn = normalizeWheel(wheel({ deltaY: -6, ctrlKey: true }), 700);
  assert.equal(pinchIn.kind, 'zoom');
  assert.ok(pinchIn.kind === 'zoom' && pinchIn.factor > 1 && pinchIn.factor < 1.1);
  const notch = normalizeWheel(wheel({ deltaY: 100, metaKey: true }), 700);
  assert.ok(notch.kind === 'zoom' && Math.abs(notch.factor - Math.exp(-0.5)) < 1e-12);
  const lines = normalizeWheel(wheel({ deltaY: -3, deltaMode: 1, ctrlKey: true }), 700);
  assert.ok(lines.kind === 'zoom' && Math.abs(lines.factor - Math.exp(0.48)) < 1e-12);
});

test('key commands respect platform modifiers and leave unowned keys to the browser', () => {
  assert.deepEqual(keyCommand(key('z', { metaKey: true }), 'mac', false), { kind: 'undo' });
  assert.equal(keyCommand(key('z', { ctrlKey: true }), 'mac', false), null);
  assert.deepEqual(keyCommand(key('Z', { ctrlKey: true, shiftKey: true }), 'other', false), { kind: 'redo' });
  assert.deepEqual(keyCommand(key('ArrowUp'), 'other', false), { kind: 'pan', dx: 0, dy: -48 });
  assert.deepEqual(keyCommand(key('ArrowUp'), 'other', true), { kind: 'nudge', dx: 0, dy: -1 });
  assert.deepEqual(keyCommand(key('ArrowUp', { altKey: true }), 'other', true), { kind: 'pan', dx: 0, dy: -48 });
  assert.deepEqual(keyCommand(key(']', { ctrlKey: true, code: 'BracketRight' }), 'other', true), { kind: 'reorder', order: 'forward' });
  assert.deepEqual(keyCommand(key('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' }), 'other', true), { kind: 'reorder', order: 'front' });
  assert.deepEqual(keyCommand(key('@', { shiftKey: true, code: 'Digit2' }), 'other', true), { kind: 'fit', target: 'selection' });
  for (const unowned of ['a', 'F5', 'c']) assert.equal(keyCommand(key(unowned), 'other', true), null);
  assert.equal(keyCommand(key('c', { ctrlKey: true }), 'other', true), null, 'copy is left to the platform');
});

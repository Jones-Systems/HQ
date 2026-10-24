import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { reduce } from '../src/editor.ts';
import type { EditorAction, EditorState, Tool } from '../src/editor.ts';
import { citeEvent, frame, freshEditor, nextId, pickEvent, run, withTool } from './fixtures.ts';

function content(state: EditorState) {
  return { annotations: state.document.annotations, revisit: state.document.revisit };
}

/** A state with one mark of each kind, so erase/delete/notes have targets. */
function populated(): EditorState {
  let state = freshEditor();
  const add = (tool: Tool, action: EditorAction) => {
    state = withTool(state, tool);
    const result = reduce(state, action);
    assert.equal(result.outcome.status, 'applied', `${tool} setup`);
    state = result.state;
  };
  add('pick', { type: 'agent-event', id: nextId(), event: pickEvent, frame: frame() });
  add('cite', { type: 'agent-event', id: nextId(), event: citeEvent, frame: frame() });
  add('box', { type: 'draw', id: nextId(), kind: 'box', points: [{ x: 600, y: 600 }, { x: 700, y: 650 }], frame: frame() });
  return { ...state, past: [], future: [] };
}

const cases: ReadonlyArray<{ name: string; tool: Tool | null; action: (s: EditorState) => EditorAction }> = [
  { name: 'pick', tool: 'pick', action: () => ({ type: 'agent-event', id: nextId(), event: pickEvent, frame: frame() }) },
  { name: 'cite', tool: 'cite', action: () => ({ type: 'agent-event', id: nextId(), event: citeEvent, frame: frame() }) },
  { name: 'ink', tool: 'ink', action: () => ({ type: 'draw', id: nextId(), kind: 'ink', points: [{ x: 1, y: 1 }, { x: 5, y: 9 }, { x: 12, y: 3 }], frame: frame() }) },
  { name: 'box', tool: 'box', action: () => ({ type: 'draw', id: nextId(), kind: 'box', points: [{ x: 10, y: 10 }, { x: 90, y: 40 }], frame: frame() }) },
  { name: 'arrow', tool: 'arrow', action: () => ({ type: 'draw', id: nextId(), kind: 'arrow', points: [{ x: 10, y: 10 }, { x: 30, y: 30 }, { x: 90, y: 40 }], frame: frame() }) },
  { name: 'label', tool: 'label', action: () => ({ type: 'draw', id: nextId(), kind: 'label', points: [{ x: 300, y: 300 }], frame: frame(), note: 'Tighten spacing' }) },
  { name: 'eraser', tool: 'eraser', action: () => ({ type: 'erase', point: { x: 650, y: 600 }, radius: 4, frame: frame() }) },
  { name: 'note', tool: null, action: (s) => ({ type: 'set-note', id: s.document.annotations[0]!.id, note: 'Make primary' }) },
  { name: 'delete', tool: null, action: (s) => ({ type: 'delete', id: s.document.annotations[1]!.id }) },
  { name: 'revisit', tool: null, action: (s) => ({ type: 'toggle-revisit', id: s.document.annotations[0]!.id }) },
];

describe('undo/redo is symmetric for every tool', () => {
  for (const c of cases) {
    test(c.name, () => {
      const before = withTool(populated(), c.tool);
      const done = reduce(before, c.action(before));
      assert.equal(done.outcome.status, 'applied');
      assert.notDeepEqual(content(done.state), content(before));
      const undone = reduce(done.state, { type: 'undo' });
      assert.equal(undone.outcome.status, 'applied');
      assert.deepEqual(content(undone.state), content(before), 'undo restores the exact prior content');
      const redone = reduce(undone.state, { type: 'redo' });
      assert.deepEqual(content(redone.state), content(done.state), 'redo restores the exact edited content');
      assert.equal(redone.state.past.length, done.state.past.length);
      assert.equal(redone.state.future.length, 0);
    });
  }

  test('a full sequence unwinds to the start and replays to the end', () => {
    let state = populated();
    const start = content(state);
    for (const c of cases) {
      state = withTool(state, c.tool);
      const result = reduce(state, c.action(state));
      assert.equal(result.outcome.status, 'applied', c.name);
      state = result.state;
    }
    const end = content(state);
    const n = state.past.length;
    const undone = run(state, Array.from({ length: n }, () => ({ type: 'undo' }) as const));
    assert.deepEqual(content(undone.state), start);
    assert.deepEqual(reduce(undone.state, { type: 'undo' }).outcome, { status: 'rejected', reason: 'nothing-to-undo' });
    const redone = run(undone.state, Array.from({ length: n }, () => ({ type: 'redo' }) as const));
    assert.deepEqual(content(redone.state), end);
    assert.deepEqual(reduce(redone.state, { type: 'redo' }).outcome, { status: 'rejected', reason: 'nothing-to-redo' });
  });

  test('a new edit after undo clears the redo branch', () => {
    let state = withTool(populated(), 'box');
    state = reduce(state, { type: 'draw', id: nextId(), kind: 'box', points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], frame: frame() }).state;
    state = reduce(state, { type: 'undo' }).state;
    assert.equal(state.future.length, 1);
    state = reduce(state, { type: 'draw', id: nextId(), kind: 'box', points: [{ x: 0, y: 0 }, { x: 19, y: 9 }], frame: frame() }).state;
    assert.equal(state.future.length, 0);
  });

  test('rejected and no-op actions do not enter history', () => {
    const state = withTool(populated(), 'eraser');
    const miss = reduce(state, { type: 'erase', point: { x: 5000, y: 5000 }, radius: 4, frame: frame() });
    assert.deepEqual(miss.outcome, { status: 'noop' });
    assert.equal(miss.state.past.length, 0);
    const wrong = reduce(state, { type: 'draw', id: nextId(), kind: 'box', points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], frame: frame() });
    assert.equal(wrong.outcome.status, 'rejected');
    assert.equal(wrong.state.past.length, 0);
  });

  test('eraser leaves picks and citations alone', () => {
    const state = withTool(populated(), 'eraser');
    const pick = state.document.annotations[0]!;
    if (pick.anchor.target.kind !== 'element') throw new Error('fixture');
    const { rect } = pick.anchor.target;
    const result = reduce(state, { type: 'erase', point: { x: rect.x + 1, y: rect.y + 1 }, radius: 4, frame: frame() });
    assert.deepEqual(result.outcome, { status: 'noop' });
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { indexForLetter, letterForIndex } from '../src/letters.ts';
import { reduce } from '../src/editor.ts';
import type { EditorState } from '../src/editor.ts';
import { parseAnnotationDocument } from '../src/validate.ts';
import { frame, freshEditor, nextId, run, withTool } from './fixtures.ts';

function box(state: EditorState, x: number): EditorState {
  return reduce(state, { type: 'draw', id: nextId(), kind: 'box', points: [{ x, y: 10 }, { x: x + 40, y: 50 }], frame: frame() }).state;
}

function letters(state: EditorState): string[] {
  return state.document.annotations.map((a) => a.letter);
}

describe('stable reference letters', () => {
  test('bijective base-26 sequence', () => {
    assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(letterForIndex), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
    for (let i = 0; i < 2000; i += 1) assert.equal(indexForLetter(letterForIndex(i)), i);
  });

  test('deleting B keeps A and C; the next new one is D', () => {
    let state = withTool(freshEditor(), 'box');
    state = box(box(box(state, 0), 100), 200);
    assert.deepEqual(letters(state), ['A', 'B', 'C']);
    const b = state.document.annotations[1]!;
    state = reduce(state, { type: 'delete', id: b.id }).state;
    assert.deepEqual(letters(state), ['A', 'C']);
    state = box(state, 300);
    assert.deepEqual(letters(state), ['A', 'C', 'D']);
  });

  test('letters are never reused, even after undo', () => {
    let state = withTool(freshEditor(), 'box');
    state = box(box(state, 0), 100);
    state = reduce(state, { type: 'undo' }).state;
    assert.deepEqual(letters(state), ['A']);
    state = box(state, 200);
    assert.deepEqual(letters(state), ['A', 'C'], 'B was handed out once and stays retired');
  });

  test('redo restores the original letter', () => {
    let state = withTool(freshEditor(), 'box');
    state = box(box(state, 0), 100);
    const { state: after } = run(state, [{ type: 'undo' }, { type: 'redo' }]);
    assert.deepEqual(letters(after), ['A', 'B']);
  });

  test('letters and the cursor survive a persistence round trip', () => {
    let state = withTool(freshEditor(), 'box');
    state = box(box(box(state, 0), 100), 200);
    state = reduce(state, { type: 'delete', id: state.document.annotations[1]!.id }).state;
    const parsed = parseAnnotationDocument(JSON.parse(JSON.stringify(state.document)));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.document, state.document);
    const reopened = withTool({ ...state, document: parsed.document, past: [], future: [] }, 'box');
    assert.deepEqual(letters(box(reopened, 400)), ['A', 'C', 'D']);
  });

  test('a document whose letters reach the cursor is rejected', () => {
    let state = withTool(freshEditor(), 'box');
    state = box(state, 0);
    const tampered = { ...JSON.parse(JSON.stringify(state.document)), nextLetterIndex: 0 };
    assert.deepEqual(parseAnnotationDocument(tampered), { ok: false, reason: 'invalid' });
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { reduce } from '../src/editor.ts';
import type { EditorState } from '../src/editor.ts';
import { LOCAL_PATH_PLACEHOLDER, containsLocalPath, formatCopyExport, redactLocalPaths } from '../src/export.ts';
import { AnnotationController, loadAnnotations } from '../src/controller.ts';
import { FakeClipboard, MemoryAnnotationStore, SequentialIds } from '../src/fakes.ts';
import { V1, citeEvent, frame, freshEditor, nextId, pickEvent, withTool } from './fixtures.ts';

const LOCAL_ROUTE = '/Users/synthetic-owner/project/index.html';

function sample(): EditorState {
  const localFrame = frame({ route: LOCAL_ROUTE, captureDigest: 'sha256:secret-capture-digest' });
  let state = withTool(freshEditor(), 'pick');
  state = reduce(state, { type: 'agent-event', id: nextId(), event: pickEvent, frame: localFrame, note: 'Make this the primary action' }).state;
  state = withTool(state, 'cite');
  state = reduce(state, { type: 'agent-event', id: nextId(), event: citeEvent, frame: localFrame, note: 'See /home/synthetic/notes.md and file:///tmp/shot.png' }).state;
  state = withTool(state, 'box');
  state = reduce(state, { type: 'draw', id: nextId(), kind: 'box', points: [{ x: 10, y: 20 }, { x: 110, y: 70 }], frame: localFrame, note: 'Spacing from C:\\Users\\synthetic\\a.png and ~/Desktop/x\nsecond line on /settings' }).state;
  state = withTool(state, 'arrow');
  state = reduce(state, { type: 'draw', id: nextId(), kind: 'arrow', points: [{ x: 1, y: 1 }, { x: 40, y: 41 }], frame: localFrame }).state;
  // Delete B so the export shows non-contiguous stable letters.
  const b = state.document.annotations[1]!;
  state = reduce(state, { type: 'delete', id: b.id }).state;
  state = withTool(state, 'cite');
  state = reduce(state, { type: 'agent-event', id: nextId(), event: citeEvent, frame: localFrame, note: 'Quote again' }).state;
  state = reduce(state, { type: 'toggle-revisit', id: state.document.annotations[0]!.id }).state;
  return state;
}

describe('Copy export', () => {
  test('contains letters, quotes and notes', () => {
    const text = formatCopyExport(sample().document, { title: 'Settings screen' });
    assert.match(text, /^Design annotations — Settings screen \(ver-synthetic-1\)/u);
    assert.match(text, /^A\. Pick element `.*button:nth-of-type\(1\)` \[Revisit\]$/mu);
    assert.match(text, /^ {3}Make this the primary action$/mu);
    assert.match(text, /^C\. Box 100×50 at 10,20$/mu);
    assert.match(text, /^D\. Arrow from 1,1 to 40,41$/mu);
    assert.match(text, /^E\. Cite “Review the plan”$/mu);
    assert.match(text, /^ {3}Quote again$/mu);
    assert.match(text, /^Revisit: A$/mu);
    assert.doesNotMatch(text, /^B\./mu, 'deleted B is not exported or relettered');
  });

  test('contains no local paths, routes or capture digests', () => {
    const text = formatCopyExport(sample().document);
    assert.equal(containsLocalPath(text), false, text);
    for (const leaked of ['/Users/', '/home/', 'file://', 'C:\\', '~/', 'secret-capture-digest', LOCAL_ROUTE]) {
      assert.ok(!text.includes(leaked), `leaked ${leaked}`);
    }
    assert.ok(text.includes(LOCAL_PATH_PLACEHOLDER));
    assert.ok(text.includes('second line on /settings'), 'app routes inside notes are not paths');
  });

  test('redaction covers common local path shapes', () => {
    const cases = [
      'file:///Users/a/b.png',
      '/home/a/b',
      '/Users/a b',
      '/tmp/x.png',
      '/private/var/folders/x',
      '/Volumes/Disk/x',
      '~/Desktop/x',
      'C:\\Users\\a\\b.png',
      'D:/work/b.png',
      '\\\\server\\share\\x',
    ];
    for (const value of cases) {
      const out = redactLocalPaths(`see ${value} now`);
      assert.equal(containsLocalPath(out), false, `${value} -> ${out}`);
      assert.ok(out.startsWith('see [local path removed]'), `${value} -> ${out}`);
    }
    for (const safe of ['/settings', '/api/v1/items', 'https://example.com/home/x', 'ratio 16:9', 'a/b/c']) {
      assert.equal(redactLocalPaths(safe), safe);
    }
  });

  test('controller Copy writes the same export to the clipboard port', async () => {
    const store = new MemoryAnnotationStore();
    await store.save(sample().document);
    const clipboard = new FakeClipboard();
    const controller = new AnnotationController(await loadAnnotations(store, V1), { ids: new SequentialIds(), clipboard, store });
    const text = await controller.copy();
    assert.deepEqual(clipboard.writes, [text]);
    assert.equal(clipboard.adapter, 'fake');
    assert.equal(containsLocalPath(text), false);
  });
});

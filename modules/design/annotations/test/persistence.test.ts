import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AnnotationController, loadAnnotations } from '../src/controller.ts';
import { FakeAgentChannel, FakeClipboard, MemoryAnnotationStore, SequentialIds } from '../src/fakes.ts';
import { parseAnnotationDocument } from '../src/validate.ts';
import { V1, V2, citeEvent, frame, pickEvent } from './fixtures.ts';

function ports(store: MemoryAnnotationStore, agent?: FakeAgentChannel) {
  return { ids: new SequentialIds(), clipboard: new FakeClipboard(), store, ...(agent === undefined ? {} : { agent }) };
}

describe('persistence and read-only safety', () => {
  test('save and reopen round-trips the document exactly', async () => {
    const store = new MemoryAnnotationStore();
    const agent = new FakeAgentChannel();
    const controller = new AnnotationController(await loadAnnotations(store, V1), ports(store, agent));
    controller.setFrame(frame());
    controller.selectTool('pick');
    agent.emit(pickEvent);
    controller.selectTool('cite');
    controller.setPendingNote('Tone is off');
    agent.emit(citeEvent);
    controller.selectTool('label');
    controller.draw('label', [{ x: 5, y: 6 }], 'Label text');
    controller.toggleRevisit(controller.snapshot.editor.document.annotations[1]!.id);
    assert.equal(await controller.save(), 'saved');

    const reopened = await loadAnnotations(store, V1);
    assert.equal(reopened.status, 'loaded');
    assert.deepEqual(reopened.document, controller.snapshot.editor.document);
    assert.equal(reopened.document.annotations[1]!.note, 'Tone is off');
  });

  test('a future schema opens read-only and is never overwritten', async () => {
    const store = new MemoryAnnotationStore();
    const future = JSON.stringify({ schema: 'hq.design.annotations/v9', versionId: V1, extra: true });
    store.records.set(V1, future);
    const load = await loadAnnotations(store, V1);
    assert.equal(load.status, 'unsupported');
    const controller = new AnnotationController(load, ports(store));
    controller.setFrame(frame());
    controller.selectTool('box');
    assert.deepEqual(controller.draw('box', [{ x: 0, y: 0 }, { x: 9, y: 9 }]), { status: 'rejected', reason: 'read-only' });
    assert.equal(await controller.save(), 'read-only');
    assert.equal(store.saves, 0);
    assert.equal(store.records.get(V1), future);
  });

  test('invalid or mismatched records are reported, not repaired', async () => {
    const store = new MemoryAnnotationStore();
    store.records.set(V1, JSON.stringify({ schema: 'hq.design.annotations/v1', versionId: V1, nextLetterIndex: -1, annotations: [], revisit: [] }));
    assert.equal((await loadAnnotations(store, V1)).status, 'invalid');
    store.records.set(V1, JSON.stringify({ schema: 'hq.design.annotations/v1', versionId: V2, nextLetterIndex: 0, annotations: [], revisit: [] }));
    assert.equal((await loadAnnotations(store, V1)).status, 'invalid');
    assert.equal((await loadAnnotations(store, V2)).status, 'empty');
  });

  test('parser rejects unknown fields, non-finite numbers and dangling revisit ids', () => {
    const base = { schema: 'hq.design.annotations/v1', versionId: V1, nextLetterIndex: 0, annotations: [], revisit: [] };
    assert.equal(parseAnnotationDocument(base).ok, true);
    assert.equal(parseAnnotationDocument({ ...base, surprise: 1 }).ok, false);
    assert.equal(parseAnnotationDocument({ ...base, revisit: ['nope'] }).ok, false);
    const anchor = { ...frame(), target: { kind: 'region', rect: { x: Number.NaN, y: 0, width: 1, height: 1 } } };
    const bad = { ...base, nextLetterIndex: 1, annotations: [{ id: 'a', letter: 'A', note: '', kind: 'box', anchor }] };
    assert.equal(parseAnnotationDocument(bad).ok, false);
  });

  test('agent events before the host supplies a frame are rejected', async () => {
    const store = new MemoryAnnotationStore();
    const agent = new FakeAgentChannel();
    const controller = new AnnotationController(await loadAnnotations(store, V1), ports(store, agent));
    controller.selectTool('pick');
    agent.emit(pickEvent);
    assert.deepEqual(controller.snapshot.lastOutcome, { status: 'rejected', reason: 'no-frame' });
    assert.equal(controller.snapshot.editor.document.annotations.length, 0);
  });

  test('refreshResolution asks the agent only for live anchors', async () => {
    const store = new MemoryAnnotationStore();
    const agent = new FakeAgentChannel();
    agent.frame = { viewport: { w: 1280, h: 800, dpr: 2 }, scroll: { x: 0, y: 90 } };
    agent.results = (request) => (request.kind === 'element' ? { found: true, rects: [{ x: 20, y: 500, width: 80, height: 32 }], textHash: 'fnv1a32:00000001' } : { found: false });
    const controller = new AnnotationController(await loadAnnotations(store, V1), ports(store, agent));
    controller.setFrame(frame());
    controller.selectTool('pick');
    agent.emit(pickEvent);
    controller.selectTool('box');
    controller.draw('box', [{ x: 0, y: 0 }, { x: 9, y: 9 }]);
    const resolved = await controller.refreshResolution();
    assert.equal(agent.resolveCalls.length, 1);
    assert.equal(agent.resolveCalls[0]!.length, 1);
    assert.deepEqual(resolved.map((r) => r.status), ['exact', 'exact']);
    assert.equal(controller.snapshot.resolved.length, 2);

    // A late result for a document that changed meanwhile is not applied.
    const pending = controller.refreshResolution();
    controller.draw('box', [{ x: 20, y: 20 }, { x: 29, y: 29 }]);
    await pending;
    assert.equal(controller.snapshot.resolved.length, 2, 'stale resolution discarded');
    assert.equal(controller.snapshot.editor.document.annotations.length, 3);
  });
});

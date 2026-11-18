import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { kindMatchesTarget, parseAnnotationRef } from '../src/validate.ts';
import { reduce } from '../src/editor.ts';
import { AnnotationController, loadAnnotations } from '../src/controller.ts';
import { FakeAgentChannel, FakeClipboard, MemoryAnnotationStore, SequentialIds } from '../src/fakes.ts';
import { V1, V2, citeEvent, frame, freshEditor, nextId, pickEvent, withTool } from './fixtures.ts';

describe('Pick and Cite are separate', () => {
  test('Pick never produces a text citation', () => {
    const picking = withTool(freshEditor(), 'pick');
    const cited = reduce(picking, { type: 'agent-event', id: nextId(), event: citeEvent, frame: frame() });
    assert.deepEqual(cited.outcome, { status: 'rejected', reason: 'tool-mismatch' });
    assert.equal(cited.state.document.annotations.length, 0);

    const picked = reduce(picking, { type: 'agent-event', id: nextId(), event: pickEvent, frame: frame() });
    assert.equal(picked.outcome.status, 'applied');
    const [annotation] = picked.state.document.annotations;
    assert.equal(annotation?.kind, 'pick');
    assert.equal(annotation?.anchor.target.kind, 'element');
  });

  test('Cite never produces an element pick', () => {
    const citing = withTool(freshEditor(), 'cite');
    const picked = reduce(citing, { type: 'agent-event', id: nextId(), event: pickEvent, frame: frame() });
    assert.deepEqual(picked.outcome, { status: 'rejected', reason: 'tool-mismatch' });
    assert.equal(picked.state.document.annotations.length, 0);

    const cited = reduce(citing, { type: 'agent-event', id: nextId(), event: citeEvent, frame: frame() });
    const [annotation] = cited.state.document.annotations;
    assert.equal(annotation?.kind, 'cite');
    assert.equal(annotation?.anchor.target.kind, 'text');
  });

  test('no other tool accepts agent events', () => {
    for (const tool of [null, 'ink', 'box', 'arrow', 'label', 'eraser'] as const) {
      const state = withTool(freshEditor(), tool);
      for (const event of [pickEvent, citeEvent]) {
        const result = reduce(state, { type: 'agent-event', id: nextId(), event, frame: frame() });
        assert.equal(result.outcome.status, 'rejected', `${tool} accepted ${event.type}`);
      }
    }
  });

  test('persisted records cannot cross kinds', () => {
    assert.equal(kindMatchesTarget('pick', citeEvent.target), false);
    assert.equal(kindMatchesTarget('cite', pickEvent.target), false);
    const base = { id: 'x', letter: 'A', note: '' };
    const { viewport, scroll, route, state, captureDigest, versionId } = frame();
    const anchor = { versionId, route, state, viewport, scroll, captureDigest };
    assert.equal(parseAnnotationRef({ ...base, kind: 'pick', anchor: { ...anchor, target: citeEvent.target } }), null);
    assert.equal(parseAnnotationRef({ ...base, kind: 'cite', anchor: { ...anchor, target: pickEvent.target } }), null);
    assert.notEqual(parseAnnotationRef({ ...base, kind: 'cite', anchor: { ...anchor, target: citeEvent.target } }), null);
  });

  test('controller drives separate agent modes and rejects crossed events', async () => {
    const agent = new FakeAgentChannel();
    const controller = new AnnotationController(await loadAnnotations(new MemoryAnnotationStore(), V1), {
      ids: new SequentialIds(), clipboard: new FakeClipboard(), store: new MemoryAnnotationStore(), agent,
    });
    controller.setFrame(frame());
    controller.selectTool('pick');
    assert.equal(agent.mode, 'pick');
    agent.emit(citeEvent);
    assert.equal(controller.snapshot.editor.document.annotations.length, 0);
    controller.selectTool('cite');
    assert.equal(agent.mode, 'cite');
    agent.emit(pickEvent);
    assert.equal(controller.snapshot.editor.document.annotations.length, 0);
    agent.emit(citeEvent);
    assert.deepEqual(controller.snapshot.editor.document.annotations.map((a) => a.kind), ['cite']);
    controller.selectTool('box');
    assert.equal(agent.mode, 'off');
    assert.deepEqual(agent.modeHistory, ['pick', 'cite', 'off']);
    controller.dispose();
    assert.equal(agent.listenerCount, 0);
  });

  test('static captures disable Pick and Cite instead of guessing', async () => {
    const controller = new AnnotationController(await loadAnnotations(new MemoryAnnotationStore(), V1), {
      ids: new SequentialIds(), clipboard: new FakeClipboard(), store: new MemoryAnnotationStore(),
    });
    assert.equal(controller.canPickOrCite, false);
    assert.deepEqual(controller.selectTool('pick'), { status: 'rejected', reason: 'unavailable' });
    assert.deepEqual(controller.selectTool('cite'), { status: 'rejected', reason: 'unavailable' });
    assert.equal(controller.selectTool('box').status, 'applied');
  });

  test('agent events for another version are rejected, never rebound', () => {
    const picking = withTool(freshEditor(), 'pick');
    const result = reduce(picking, { type: 'agent-event', id: nextId(), event: pickEvent, frame: frame({ versionId: V2 }) });
    assert.deepEqual(result.outcome, { status: 'rejected', reason: 'version-mismatch' });
  });
});

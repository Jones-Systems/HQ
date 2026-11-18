import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandoffQueue } from '../sources/handoff.ts';

test('handoff queue keeps one entry per item and kind, in arrival order, up to its limit', () => {
  const queue = createHandoffQueue(2);
  assert.equal(queue.add({ id: 'r1', kind: 'reference', label: 'Pricing', from: 'references' }), 'added');
  assert.equal(queue.add({ id: 'r1', kind: 'reference', label: 'Pricing again', from: 'discovery' }), 'already-queued');
  assert.equal(queue.add({ id: 'r1', kind: 'component', label: 'Button', from: 'components' }), 'added');
  assert.equal(queue.add({ id: 'f1', kind: 'flow', label: 'Checkout', from: 'flows' }), 'full');
  assert.deepEqual(queue.snapshot().map((item) => `${item.kind}:${item.label}`), ['reference:Pricing', 'component:Button']);
  assert.equal(queue.has('r1', 'component'), true);
  queue.remove('r1', 'reference');
  assert.deepEqual(queue.snapshot().map((item) => item.kind), ['component']);
});

test('handoff listeners hear additions and removals only when the queue changes', () => {
  const queue = createHandoffQueue();
  let calls = 0;
  const stop = queue.subscribe(() => { calls += 1; });
  queue.add({ id: 'd1', kind: 'other', label: 'Studio project', from: 'discovery' });
  queue.add({ id: 'd1', kind: 'other', label: 'Studio project', from: 'discovery' });
  queue.remove('missing', 'other');
  queue.remove('d1', 'other');
  queue.clear();
  assert.equal(calls, 2);
  stop();
  queue.add({ id: 'd2', kind: 'other', label: 'Laptop project', from: 'discovery' });
  assert.equal(calls, 2);
});

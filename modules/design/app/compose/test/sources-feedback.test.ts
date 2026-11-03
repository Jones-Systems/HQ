import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFeedbackStore, FEEDBACK_AUTO_DISMISS_MS } from '../sources/feedback-store.ts';
import { createHandoffQueue } from '../sources/handoff.ts';

test('feedback tones choose expiry: info and success expire, warning and danger persist', () => {
  const store = createFeedbackStore();
  store.push({ message: 'Saved', tone: 'success' });
  store.push({ message: 'Heads up', tone: 'warning' });
  store.push({ message: 'Failed', tone: 'danger' });
  store.push({ message: 'Pinned', tone: 'success', autoDismissMs: null });
  assert.deepEqual(store.snapshot().map((toast) => toast.autoDismissMs), [FEEDBACK_AUTO_DISMISS_MS, undefined, undefined, undefined]);
});

test('reusing an id replaces the toast in place instead of stacking', () => {
  const store = createFeedbackStore();
  store.push({ message: 'First' });
  store.push({ id: 'import', message: 'Importing 1 of 3' });
  store.push({ message: 'Last' });
  store.push({ id: 'import', message: 'Importing 2 of 3' });
  assert.deepEqual(store.snapshot().map((toast) => toast.message), ['First', 'Importing 2 of 3', 'Last']);
});

test('the oldest toast leaves first when the stack is full, and listeners hear every change', () => {
  const store = createFeedbackStore({ max: 2 });
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; });
  const first = store.push({ message: 'one' });
  store.push({ message: 'two' });
  store.push({ message: 'three' });
  assert.deepEqual(store.snapshot().map((toast) => toast.message), ['two', 'three']);
  store.dismiss(first);
  assert.equal(calls, 3, 'dismissing an id that already left emits nothing');
  store.clear();
  assert.equal(store.snapshot().length, 0);
  stop();
  store.push({ message: 'after' });
  assert.equal(calls, 4);
});

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

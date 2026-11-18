import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReferenceId } from '../../../references/src/contract.ts';
import type { SelectedImageFile } from '../references/images.ts';
import {
  EMPTY_QUEUE, GRAPH_NOTE, KEPT_EXISTING_MESSAGE, KEPT_REMOVED_MESSAGE, QUEUE_STATUS_LABELS, QUEUE_STATUSES,
  currentItem, defaultTitle, firstWaiting, isAcceptedImage, localDateTimeValue, nameList, newQueueItem, outcomeOf,
  queueCounts, queueReducer, queueSettledCleanly, splitDropped, type QueueItem, type QueueState,
} from '../references/queue.ts';

const file = (name: string, type = 'image/png'): SelectedImageFile =>
  ({ name, type, size: 3, lastModified: Date.parse('2026-01-01T00:00:00Z'), arrayBuffer: async () => new ArrayBuffer(3) });
const items = (...names: string[]): QueueItem[] => names.map((name) => newQueueItem(file(name)));
const withItems = (...names: string[]): QueueState => queueReducer(EMPTY_QUEUE, { type: 'add', items: items(...names) });
const id = (value: string) => value as ReferenceId;

test('every status has a label and a new item waits, with no thumbnail tried yet', () => {
  for (const status of QUEUE_STATUSES) assert.ok(QUEUE_STATUS_LABELS[status].length > 0);
  const [item] = items('a.png');
  assert.equal(item!.status, 'waiting');
  assert.equal(item!.thumbnail, undefined);
  assert.equal(item!.message, null);
});

test('adding images makes the first current, and a later batch does not steal the form', () => {
  const first = withItems('a.png', 'b.png');
  assert.equal(currentItem(first)!.name, 'a.png');
  const more = queueReducer(first, { type: 'add', items: items('c.png') });
  assert.equal(currentItem(more)!.name, 'a.png');
  assert.deepEqual(more.items.map((item) => item.name), ['a.png', 'b.png', 'c.png']);
  assert.equal(queueReducer(first, { type: 'add', items: [] }), first, 'adding nothing is a no-op');
});

test('after an item settles the form moves to the next waiting one, and to none when nothing is left', () => {
  let state = withItems('a.png', 'b.png');
  const [a, b] = state.items as [QueueItem, QueueItem];
  state = queueReducer(state, { type: 'status', id: a.id, status: 'saved', referenceId: id('ref_a'), title: 'A' });
  state = queueReducer(state, { type: 'advance' });
  assert.equal(state.currentId, b.id);
  state = queueReducer(state, { type: 'status', id: b.id, status: 'kept-existing', message: KEPT_EXISTING_MESSAGE });
  state = queueReducer(state, { type: 'advance' });
  assert.equal(state.currentId, null);
  assert.equal(firstWaiting(state), undefined);
});

test('a failed current item stays on the form so it can be corrected; unknown does not', () => {
  let state = withItems('a.png', 'b.png');
  const [a, b] = state.items as [QueueItem, QueueItem];
  state = queueReducer(state, { type: 'status', id: a.id, status: 'failed', message: 'Choose a valid PNG, JPEG or WebP image.' });
  assert.equal(queueReducer(state, { type: 'advance' }).currentId, a.id, 'rejected input is fixed in place');
  state = queueReducer(state, { type: 'status', id: a.id, status: 'unknown' });
  assert.equal(queueReducer(state, { type: 'advance' }).currentId, b.id, 'an unconfirmed save is not re-submitted by the form');
});

test('retry returns a failed or unknown item to waiting and makes it current; other statuses ignore it', () => {
  let state = withItems('a.png', 'b.png');
  const [a, b] = state.items as [QueueItem, QueueItem];
  state = queueReducer(state, { type: 'status', id: b.id, status: 'failed', message: 'nope' });
  state = queueReducer(state, { type: 'retry', id: b.id });
  assert.deepEqual([state.items[1]!.status, state.items[1]!.message, state.currentId], ['waiting', null, b.id]);
  state = queueReducer(state, { type: 'status', id: a.id, status: 'saved' });
  assert.equal(queueReducer(state, { type: 'retry', id: a.id }).items[0]!.status, 'saved');
});

test('only an item the form can still import can be made current', () => {
  let state = withItems('a.png', 'b.png');
  const [a, b] = state.items as [QueueItem, QueueItem];
  state = queueReducer(state, { type: 'status', id: a.id, status: 'saved' });
  assert.equal(queueReducer(state, { type: 'current', id: a.id }), state);
  assert.equal(queueReducer(state, { type: 'current', id: b.id }).currentId, b.id);
  const fresh = withItems('x.png', 'y.png');
  assert.equal(queueReducer(fresh, { type: 'current', id: fresh.items[1]!.id }).currentId, fresh.items[1]!.id);
});

test('removing the current item moves the form on; removing an unknown id changes nothing; clear empties', () => {
  const state = withItems('a.png', 'b.png');
  const [a, b] = state.items as [QueueItem, QueueItem];
  const removed = queueReducer(state, { type: 'remove', id: a.id });
  assert.deepEqual(removed.items.map((item) => item.id), [b.id]);
  assert.equal(removed.currentId, b.id);
  assert.equal(queueReducer(state, { type: 'remove', id: 'queued-none' }), state);
  assert.equal(queueReducer(state, { type: 'clear' }), EMPTY_QUEUE);
});

test('thumbnails and status details attach to the right row only', () => {
  let state = withItems('a.png', 'b.png');
  const [a, b] = state.items as [QueueItem, QueueItem];
  state = queueReducer(state, { type: 'thumbnail', id: b.id, url: 'data:image/png;base64,AA==' });
  assert.equal(state.items[0]!.thumbnail, undefined);
  assert.equal(state.items[1]!.thumbnail, 'data:image/png;base64,AA==');
  state = queueReducer(state, { type: 'thumbnail', id: a.id, url: null });
  assert.equal(state.items[0]!.thumbnail, null, 'null records that no preview could be made');
  state = queueReducer(state, { type: 'status', id: a.id, status: 'saved', referenceId: id('ref_a'), title: 'Alpha' });
  state = queueReducer(state, { type: 'status', id: a.id, status: 'saved' });
  assert.deepEqual([state.items[0]!.referenceId, state.items[0]!.title], ['ref_a', 'Alpha'], 'omitted details are kept');
});

test('counts and the tidy-away rule', () => {
  let state = withItems('a.png', 'b.png', 'c.png');
  const [a, b, c] = state.items as [QueueItem, QueueItem, QueueItem];
  assert.equal(queueSettledCleanly([]), false);
  state = queueReducer(state, { type: 'status', id: a.id, status: 'saved' });
  state = queueReducer(state, { type: 'status', id: b.id, status: 'kept-existing' });
  assert.equal(queueSettledCleanly(state.items), false, 'one item is still waiting');
  state = queueReducer(state, { type: 'status', id: c.id, status: 'saved' });
  assert.equal(queueSettledCleanly(state.items), true);
  state = queueReducer(state, { type: 'status', id: c.id, status: 'failed' });
  assert.equal(queueSettledCleanly(state.items), false, 'a failure stays on screen');
  assert.deepEqual(queueCounts(state.items), { waiting: 0, importing: 0, saved: 1, 'kept-existing': 1, failed: 1, unknown: 0, total: 3 });
});

test('import results map to a row state and the existing wording', () => {
  assert.deepEqual(outcomeOf({ status: 'saved', id: id('ref_1'), graphReady: true }), { status: 'saved', message: null, referenceId: 'ref_1' });
  assert.equal(outcomeOf({ status: 'saved', id: id('ref_1'), graphReady: false }).message, GRAPH_NOTE);
  const duplicate = outcomeOf({ status: 'duplicate', id: id('ref_2'), graphReady: true });
  assert.deepEqual([duplicate.status, duplicate.message], ['kept-existing', KEPT_EXISTING_MESSAGE]);
  assert.equal(outcomeOf({ status: 'duplicate', id: id('ref_2'), graphReady: false }).message, `${KEPT_EXISTING_MESSAGE} ${GRAPH_NOTE}`);
  const removed = outcomeOf({ status: 'tombstoned', id: id('ref_3'), graphReady: true });
  assert.deepEqual([removed.status, removed.message, removed.referenceId], ['kept-existing', KEPT_REMOVED_MESSAGE, 'ref_3']);
  assert.deepEqual(outcomeOf({ status: 'rejected', message: 'Too big.' }), { status: 'failed', message: 'Too big.', referenceId: null });
  assert.deepEqual(outcomeOf({ status: 'unknown', message: 'Reload.' }), { status: 'unknown', message: 'Reload.', referenceId: null });
  assert.equal(outcomeOf('threw').status, 'unknown', 'a thrown import is never reported as failed');
});

test('drops accept PNG, JPEG and WebP only; a missing type falls back to the extension', () => {
  assert.equal(isAcceptedImage({ name: 'a.png', type: 'image/png' }), true);
  assert.equal(isAcceptedImage({ name: 'a.jpg', type: 'image/jpeg' }), true);
  assert.equal(isAcceptedImage({ name: 'a.webp', type: 'image/webp' }), true);
  assert.equal(isAcceptedImage({ name: 'a.svg', type: 'image/svg+xml' }), false);
  assert.equal(isAcceptedImage({ name: 'a.png', type: 'text/plain' }), false, 'a reported type wins over the extension');
  assert.equal(isAcceptedImage({ name: 'shot.JPEG', type: '' }), true);
  assert.equal(isAcceptedImage({ name: 'notes.txt', type: '' }), false);
  assert.equal(isAcceptedImage({ name: 'noextension', type: '' }), false);
  const split = splitDropped([file('a.png'), file('notes.txt', 'text/plain'), file('b.webp', 'image/webp'), file('page.html', 'text/html')]);
  assert.deepEqual(split.accepted.map((item) => item.name), ['a.png', 'b.webp']);
  assert.deepEqual(split.rejected.map((item) => item.name), ['notes.txt', 'page.html']);
});

test('names, default titles and local time values', () => {
  assert.equal(nameList(['a', 'b']), 'a, b');
  assert.equal(nameList(['a', 'b', 'c']), 'a, b, c');
  assert.equal(nameList(['a', 'b', 'c', 'd', 'e']), 'a, b, c and 2 more');
  assert.equal(defaultTitle('Lumen pricing.final.png'), 'Lumen pricing.final');
  assert.equal(defaultTitle('noextension'), 'noextension');
  assert.equal(defaultTitle(`${'x'.repeat(400)}.png`).length, 300);
  assert.match(localDateTimeValue(Date.parse('2026-01-01T12:30:00Z')), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);
  assert.equal(localDateTimeValue(Number.NaN), '');
});

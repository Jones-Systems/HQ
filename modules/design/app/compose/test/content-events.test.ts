import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createProjectContentEvents } from '../content-events.ts';

it('notifies only the changed project and counts its revisions', () => {
  const events = createProjectContentEvents();
  const seen: string[] = [];
  events.subscribe('a', () => seen.push('a'));
  events.subscribe('b', () => seen.push('b'));
  assert.equal(events.revision('a'), 0);
  events.notify('a');
  events.notify('a');
  assert.deepEqual(seen, ['a', 'a']);
  assert.equal(events.revision('a'), 2);
  assert.equal(events.revision('b'), 0);
});

it('unsubscribes idempotently and isolates a failing listener', () => {
  const events = createProjectContentEvents();
  let calls = 0;
  events.subscribe('a', () => { throw new Error('reader failed'); });
  const stop = events.subscribe('a', () => { calls += 1; });
  events.notify('a');
  stop();
  stop();
  events.notify('a');
  assert.equal(calls, 1);
  assert.equal(events.revision('a'), 2);
});

it('tells every-project listeners which project changed, isolates their failures, and unsubscribes idempotently', () => {
  const events = createProjectContentEvents();
  const seen: string[] = [];
  events.subscribeAll(() => { throw new Error('reader failed'); });
  const stop = events.subscribeAll((projectId) => seen.push(projectId));
  events.subscribe('a', () => seen.push('only-a'));
  events.notify('a');
  events.notify('b');
  assert.deepEqual(seen, ['only-a', 'a', 'b']);
  stop();
  stop();
  events.notify('b');
  assert.deepEqual(seen, ['only-a', 'a', 'b']);
  assert.equal(events.revision('b'), 2);
});

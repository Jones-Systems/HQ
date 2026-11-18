// Pure modules: destination resolution, history reducer, topic tree and display helpers.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Topic, WikiError } from '../../contract/src/index.ts';
import { describeDestination, HOME, pageDestination, resolveDestination, searchDestination, topicsDestination } from '../src/destinations.ts';
import { describeError, excerpt, NAMESPACE_LABELS, namespaceLabel } from '../src/format.ts';
import { currentEntry, initialNav, MAX_HISTORY, navReducer, shellRequestFor, type NavAction, type NavState } from '../src/history.ts';
import { buildTopicTree, type TopicNode } from '../src/topic-tree.ts';

test('namespace display map is the accepted one', () => {
  assert.deepEqual({ ...NAMESPACE_LABELS }, { bl: 'BusinessLessons', appdev: 'App Development' });
  assert.equal(namespaceLabel('bl'), 'BusinessLessons');
  assert.equal(namespaceLabel('appdev'), 'App Development');
  assert.equal(namespaceLabel('toString'), 'toString', 'prototype names are not labels');
});

test('home and unparseable destinations select home; only unparseable ones carry a notice', () => {
  assert.deepEqual(resolveDestination(HOME), { view: 'home', notice: null });
  for (const bad of ['', 'nothing', 'javascript:alert(1)', 'https://example.com/', '//host/x', '/page/bl/a.md', 'page/zz/a.md', 'page/bl/..%2Fx.md', 'page/bl/a%2Fb.md', 'search?q=', 'topics/nope', 'page/bl', 'page\\bl\\a.md']) {
    const resolved = resolveDestination(bad);
    assert.equal(resolved.view, 'home', bad);
    assert.ok(resolved.view === 'home' && resolved.notice !== null, `notice for ${JSON.stringify(bad)}`);
  }
  const wrongType = resolveDestination(42);
  assert.ok(wrongType.view === 'home' && wrongType.notice?.reason === 'wrong-type');
});

test('contract destinations resolve to views and round-trip through the contract helpers', () => {
  assert.deepEqual(resolveDestination('page/bl/lessons/pricing.md'), { view: 'page', key: { namespace: 'bl', path: 'lessons/pricing.md' } });
  assert.deepEqual(resolveDestination('search?q=cash%20flow'), { view: 'search', query: 'cash flow' });
  assert.deepEqual(resolveDestination('topics/appdev'), { view: 'topics', namespace: 'appdev' });
  assert.equal(pageDestination({ namespace: 'bl', path: 'a b/ü.md' }), 'page/bl/a%20b/%C3%BC.md');
  assert.equal(searchDestination('a&b #1'), 'search?q=a%26b%20%231');
  assert.equal(topicsDestination('bl'), 'topics/bl');
  assert.equal(pageDestination({ namespace: 'bl', path: '../x.md' }), null);
  assert.equal(searchDestination('   '), null);
});

test('notice excerpts are bounded and control-free', () => {
  assert.equal(excerpt('a\u0000b\nc'), 'a�b�c');
  const long = excerpt('x'.repeat(500));
  assert.equal(Array.from(long).length, 81);
  const resolved = resolveDestination(`bad\u0007${'y'.repeat(300)}`);
  assert.ok(resolved.view === 'home' && resolved.notice !== null && !/[\u0000-\u001f]/u.test(resolved.notice.excerpt));
  assert.equal(describeDestination('page/bl/a.md'), 'Page · bl/a.md');
  assert.equal(describeDestination('bogus'), 'Home (unrecognised destination)');
});

test('every error code has its own plain-language heading', () => {
  const error = (code: WikiError['code'], reason: WikiError['reason']): WikiError => ({ code, reason, message: 'm' });
  assert.equal(describeError(error('invalid-input', 'empty')).title, 'Request rejected');
  assert.equal(describeError(error('not-found', 'not-found')).title, 'Not found');
  assert.equal(describeError(error('unavailable', 'source-unavailable')).title, 'Source unavailable');
  assert.equal(describeError(error('unavailable', 'index-unavailable')).title, 'Index unavailable');
  assert.equal(describeError(error('internal', 'internal')).title, 'Something went wrong');
});

function run(state: NavState, ...actions: NavAction[]): NavState {
  return actions.reduce(navReducer, state);
}
const go = (destination: string): NavAction => ({ type: 'go', entry: { destination } });
const dests = (state: NavState): string[] => state.entries.map((entry) => entry.destination);

test('history: go pushes, back/forward move, go after back drops the forward branch', () => {
  let s = initialNav('home');
  s = run(s, go('topics/bl'), go('search?q=a'), { type: 'back' });
  assert.deepEqual([dests(s), s.index], [['home', 'topics/bl', 'search?q=a'], 1]);
  s = run(s, { type: 'forward' });
  assert.equal(s.index, 2);
  s = run(s, { type: 'jump', index: 0 }, go('topics/appdev'));
  assert.deepEqual([dests(s), s.index], [['home', 'topics/appdev'], 1]);
  assert.equal(run(s, { type: 'forward' }).index, 1, 'forward at the end is a no-op');
  assert.equal(run(initialNav('home'), { type: 'back' }).index, 0, 'back at the start is a no-op');
  assert.equal(run(s, { type: 'jump', index: 99 }).index, 1, 'jump clamps');
});

test('history: repeating the current destination does not add an entry; history is capped', () => {
  let s = run(initialNav('home'), go('home'), go('home'));
  assert.equal(s.entries.length, 1);
  for (let i = 0; i < MAX_HISTORY + 30; i++) s = navReducer(s, go(`search?q=${i}`));
  assert.equal(s.entries.length, MAX_HISTORY);
  assert.equal(currentEntry(s).destination, `search?q=${MAX_HISTORY + 29}`);
});

test('history: the shell echo of a request is not a new entry; an unrelated prop change is', () => {
  let s = run(initialNav('home'), go('topics/bl'));
  assert.deepEqual(s.pending, ['topics/bl']);
  s = navReducer(s, { type: 'prop', destination: 'topics/bl' });
  assert.deepEqual([dests(s), s.pending, s.seenProp], [['home', 'topics/bl'], [], 'topics/bl']);

  s = navReducer(s, { type: 'prop', destination: 'search?q=x' });
  assert.deepEqual(dests(s), ['home', 'topics/bl', 'search?q=x']);
  assert.equal(s.index, 2);
  assert.equal(navReducer(s, { type: 'prop', destination: 'search?q=x' }), s, 'same prop is a no-op');
});

test('history: out-of-order echoes settle earlier requests; an external change clears expectations', () => {
  let s = run(initialNav('home'), go('a'), go('b'));
  assert.deepEqual(s.pending, ['a', 'b']);
  s = navReducer(s, { type: 'prop', destination: 'b' });
  assert.deepEqual([s.pending, s.entries.length], [[], 3]);
  s = run(s, go('c'), { type: 'prop', destination: 'elsewhere' });
  assert.deepEqual(s.pending, []);
  assert.equal(currentEntry(s).destination, 'elsewhere');
});

test('history: disambiguation entries are in-session only and never requested from the shell', () => {
  const ambiguity = { label: 'Onboarding', candidates: [{ namespace: 'bl' as const, path: 'a.md' }, { namespace: 'bl' as const, path: 'b.md' }] };
  let s = run(initialNav('page/bl/x.md'), { type: 'go', entry: { destination: 'page/bl/x.md', ambiguity } });
  assert.equal(s.entries.length, 2);
  assert.deepEqual(s.pending, []);
  assert.equal(shellRequestFor(s, currentEntry(s)), null);
  s = run(s, { type: 'back' });
  assert.equal(currentEntry(s).ambiguity, undefined);
  assert.deepEqual(s.pending, [], 'the shell already shows the page');
  // The same ambiguity opened twice is two visits.
  s = run(s, { type: 'go', entry: { destination: 'page/bl/x.md', ambiguity } });
  assert.equal(s.entries.length, 2);
  s = run(s, { type: 'go', entry: { destination: 'page/bl/x.md', ambiguity } });
  assert.equal(s.entries.length, 3);
});

test('history: going back to a destination the shell does not hold requests it', () => {
  let s = run(initialNav('home'), go('topics/bl'), { type: 'prop', destination: 'topics/bl' }, { type: 'back' });
  assert.deepEqual(s.pending, ['home']);
  s = navReducer(s, { type: 'prop', destination: 'home' });
  assert.equal(s.entries.length, 2, 'echo of the back request is not a new entry');
});

const topic = (id: string, parentId: string | null): Topic => ({ id, label: id.toUpperCase(), parentId, pageCount: 0, pages: [] });
const shape = (nodes: readonly TopicNode[]): unknown => nodes.map((node) => [node.topic.id, shape(node.children)]);

test('topic tree nests by parentId and preserves order', () => {
  const tree = buildTopicTree([topic('a', null), topic('b', 'a'), topic('c', 'b'), topic('d', 'a'), topic('e', null)]);
  assert.deepEqual(shape(tree), [['a', [['b', [['c', []]]], ['d', []]]], ['e', []]]);
});

test('topic tree surfaces cycles and orphans as roots instead of dropping or looping', () => {
  // The contract rejects self-parents and unknown parents but not longer cycles.
  const cyclic = buildTopicTree([topic('x', 'y'), topic('y', 'z'), topic('z', 'x'), topic('r', null)]);
  const ids = JSON.stringify(shape(cyclic));
  for (const id of ['x', 'y', 'z', 'r']) assert.equal(ids.split(`"${id}"`).length - 1, 1, `${id} appears once`);
  assert.equal(buildTopicTree([topic('o', 'missing')]).length, 1);
  assert.deepEqual(buildTopicTree([]), []);
});

// Lane F6 base: the session cache, cached resources, session state that survives remounts, host affordances and the
// display helpers the redesigned views share.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import type { WikiResult } from '../../contract/src/index.ts';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { createWikiCache } from '../src/cache.ts';
import { errorRecovery, folderParts, pageName, relativeTime } from '../src/format.ts';
import { currentEntry, initialNav, navReducer } from '../src/history.ts';
import { createWikiView } from '../src/index.ts';
import { useResource, type Resource } from '../src/load.ts';
import { createWikiSession, MAX_RECENT } from '../src/session.ts';
import { mount, settle } from './render.ts';
import { deferred, fail, launch, release } from './support.ts';

const ok = <T,>(value: T): WikiResult<T> => ({ ok: true, value });
const accept = (): null => null;

test('cache: concurrent requests share one load; good values are stored; failures are not', async () => {
  const cache = createWikiCache();
  let calls = 0;
  const load = (): Promise<WikiResult<number>> => {
    calls++;
    return Promise.resolve(ok(7));
  };
  const [a, b] = await Promise.all([cache.request('k', load, accept), cache.request('k', load, accept)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, { ok: true, value: 7 });
  assert.deepEqual(b, a);
  assert.equal(cache.peek<number>('k')?.value, 7);

  const failed = await cache.request('bad', () => Promise.resolve(fail('unavailable', 'source-unavailable')), accept);
  assert.equal(failed.ok, false);
  assert.equal(cache.peek('bad'), undefined);
});

test('cache: throws, rejections, malformed responses and failed checks settle as errors', async () => {
  const cache = createWikiCache();
  const thrown = await cache.request('t', () => {
    throw new Error('boom');
  }, accept);
  const rejected = await cache.request('r', () => Promise.reject(new Error('no')), accept);
  const malformed = await cache.request('m', () => Promise.resolve({ nope: true } as never), accept);
  const checked = await cache.request('c', () => Promise.resolve(ok(1)), () => ({ code: 'internal', reason: 'internal', message: 'mismatch' }));
  for (const result of [thrown, rejected, malformed, checked]) assert.equal(result.ok, false);
  assert.equal(cache.size, 0);
});

test('cache: least recently used entries are dropped beyond the limit; invalidate clears by prefix', async () => {
  let clock = 0;
  const cache = createWikiCache({ limit: 2, now: () => clock });
  await cache.request('page:a', () => Promise.resolve(ok('a')), accept);
  clock = 10;
  await cache.request('page:b', () => Promise.resolve(ok('b')), accept);
  assert.equal(cache.peek('page:a')?.value, 'a', 'reading a marks it recent');
  await cache.request('topics:c', () => Promise.resolve(ok('c')), accept);
  assert.equal(cache.peek('page:b'), undefined, 'b was least recently used');
  assert.equal(cache.age('page:a'), 10);
  assert.equal(cache.age('missing'), Infinity);
  cache.invalidate('page:');
  assert.equal(cache.peek('page:a'), undefined);
  assert.equal(cache.peek<string>('topics:c')?.value, 'c');
  cache.prefetch('topics:c', () => Promise.reject(new Error('never called')), accept);
});

function Probe(props: { readonly spec: Parameters<typeof useResource<number>>[0]; readonly cache: ReturnType<typeof createWikiCache>; readonly out: Resource<number>[] }): ReactElement {
  const resource = useResource(props.spec, props.cache);
  props.out.push(resource);
  return createElement('span', null, String(resource.value ?? ''));
}

test('useResource: cached values show at once; a failed refresh keeps the value and reports the error; retry asks again', async () => {
  const cache = createWikiCache();
  await cache.request('n', () => Promise.resolve(ok(1)), accept);
  const pending = deferred<WikiResult<number>>();
  let calls = 0;
  const spec = { key: 'n', load: () => (calls++, pending.promise), check: accept };
  const out: Resource<number>[] = [];
  const m = await mount(Probe, { spec, cache, out });
  await settle();
  assert.equal(out.at(-1)?.status, 'ready');
  assert.equal(out.at(-1)?.value, 1);
  assert.equal(calls, 0, 'a fresh cached value is not requested again');

  out.at(-1)?.retry();
  await settle();
  assert.equal(calls, 1);
  assert.equal(out.at(-1)?.refreshing, true);
  assert.equal(out.at(-1)?.value, 1, 'the older value stays while refreshing');
  await release(pending, fail('unavailable', 'source-unavailable'));
  const last = out.at(-1)!;
  assert.equal(last.status, 'ready');
  assert.equal(last.value, 1);
  assert.equal(last.error?.reason, 'source-unavailable');
  assert.equal(last.refreshing, false);
  await m.unmount();
});

test('useResource: nothing cached → loading, then error; idle for a null spec', async () => {
  const cache = createWikiCache();
  const out: Resource<number>[] = [];
  const m = await mount(Probe, { spec: { key: 'x', load: () => Promise.resolve(fail('not-found', 'not-found')), check: accept }, cache, out });
  assert.equal(out[0]?.status, 'loading');
  await settle();
  assert.equal(out.at(-1)?.status, 'error');
  assert.equal(out.at(-1)?.error?.code, 'not-found');
  await m.rerender({ spec: null, cache, out });
  assert.equal(out.at(-1)?.status, 'idle');
  await m.unmount();
});

test('session: recent pages are most recent first, unique and capped; titles are remembered', () => {
  let clock = 0;
  const session = createWikiSession(() => ++clock);
  let notified = 0;
  const stop = session.subscribe(() => notified++);
  const key = (path: string) => ({ namespace: 'bl' as const, path });
  session.visit(key('a.md'), 'A');
  session.visit(key('b.md'), 'B');
  session.visit(key('a.md'), 'A');
  assert.deepEqual(session.recent().map((item) => item.title), ['A', 'B']);
  const before = session.recent();
  session.visit(key('a.md'), 'A');
  assert.equal(session.recent(), before, 'revisiting the current first page changes nothing');
  for (let i = 0; i < MAX_RECENT + 3; i++) session.visit(key(`p${i}.md`), `P${i}`);
  assert.equal(session.recent().length, MAX_RECENT);
  assert.equal(session.titleOf(key('b.md')), 'B');
  stop();
  const count = notified;
  session.visit(key('z.md'), 'Z');
  assert.equal(notified, count, 'unsubscribed listeners are not called');
});

test('history: replace swaps the current entry without adding one and keeps the forward branch', () => {
  let state = initialNav('home');
  state = navReducer(state, { type: 'go', entry: { destination: 'search?q=ca' } });
  state = navReducer(state, { type: 'go', entry: { destination: 'topics/bl' } });
  state = navReducer(state, { type: 'back' });
  state = navReducer(state, { type: 'replace', entry: { destination: 'search?q=cash' } });
  assert.deepEqual(state.entries.map((entry) => entry.destination), ['home', 'search?q=cash', 'topics/bl']);
  assert.equal(currentEntry(state).destination, 'search?q=cash');
  assert.equal(state.pending.at(-1), 'search?q=cash', 'the replacement is requested from the shell');
  assert.equal(navReducer(state, { type: 'replace', entry: { destination: 'search?q=cash' } }), state);
});

test('a view keeps its session across remounts: history and recent pages survive a domain switch', async () => {
  const View = createWikiView(createSyntheticService());
  const first = await launch({ View, destination: 'home' });
  await first.external('topics/bl');
  await first.external('page/bl/lessons/pricing.md');
  await first.unmount();
  const again = await launch({ View, destination: 'page/bl/lessons/pricing.md' });
  const history = Array.from(again.container.querySelectorAll('.wiki-nav button')).find((button) => /^History/.test(button.textContent ?? ''));
  assert.equal(history?.textContent, 'History (3)');
  await again.unmount();
});

test('host affordances that throw never break the view', async () => {
  const thrower = () => {
    throw new Error('host refused');
  };
  const app = await launch({ affordances: { toast: { info: thrower, success: thrower, warning: thrower, error: thrower, dismiss: thrower }, openSettings: thrower } });
  assert.ok(app.container.querySelector('.wiki-view'));
  await app.unmount();
});

test('display helpers: page names, folders, relative times and recovery actions', () => {
  assert.equal(pageName('lessons/cash-flow.md'), 'Cash flow');
  assert.equal(pageName('notes/retry_policy.markdown'), 'Retry policy');
  assert.equal(pageName('/'), '/');
  assert.deepEqual(folderParts('lessons/pricing/tiers.md'), ['lessons', 'pricing']);
  const now = Date.parse('2026-11-03T12:00:00.000Z');
  assert.equal(relativeTime('2026-11-01T12:00:00.000Z', now), '2 days ago');
  assert.equal(relativeTime('2026-11-03T11:59:40.000Z', now), 'just now');
  assert.equal(relativeTime(null, now, 'never'), 'never');
  assert.equal(relativeTime('not a time', now), 'unknown');
  assert.deepEqual(errorRecovery({ code: 'unavailable', reason: 'source-unavailable', message: '' }), ['retry', 'settings']);
  assert.deepEqual(errorRecovery({ code: 'not-found', reason: 'not-found', message: '' }), ['search', 'back']);
});

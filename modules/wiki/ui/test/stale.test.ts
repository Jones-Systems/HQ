// Sequence guards: a response is shown only if it answers the latest request of its view.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WikiService } from '../../contract/src/index.ts';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { all, byText, click, one, textOf } from './render.ts';
import { deferred, launch, override, release, type Deferred } from './support.ts';

type SearchResponse = Awaited<ReturnType<WikiService['search']>>;
type PageResponse = Awaited<ReturnType<WikiService['getPage']>>;
type TopicsResponse = Awaited<ReturnType<WikiService['listTopics']>>;

const nav = (container: HTMLElement, label: string): HTMLElement => byText(container, '.wiki-nav button', label);

function controlled<T>(): { next(): Deferred<T>; all: Deferred<T>[] } {
  const all: Deferred<T>[] = [];
  return {
    all,
    next: () => {
      const entry = deferred<T>();
      all.push(entry);
      return entry;
    },
  };
}

test('an older search response arriving after a newer one is discarded', async () => {
  const base = createSyntheticService();
  const searches = controlled<SearchResponse>();
  const app = await launch({ destination: 'search?q=archive', service: override(base, { search: () => searches.next().promise }) });
  await app.external('search?q=cash');
  assert.equal(searches.all.length, 2);

  await release(searches.all[1]!, await base.search({ query: 'cash' }));
  const titles = all(app.container, '.wiki-hit-title').map((node) => node.textContent);
  assert.ok(titles.includes('Cash flow'));
  await release(searches.all[0]!, await base.search({ query: 'archive' }));
  assert.deepEqual(all(app.container, '.wiki-hit-title').map((node) => node.textContent), titles, 'the stale archive results never replace the newer ones');
  assert.equal(textOf(one(app.container, '.wiki-search .wiki-section-title')), 'Search: “cash”');
  await app.unmount();
});

test('an older response arriving before the newer one is also never shown', async () => {
  const base = createSyntheticService();
  const searches = controlled<SearchResponse>();
  const app = await launch({ destination: 'search?q=archive', service: override(base, { search: () => searches.next().promise }) });
  await app.external('search?q=cash');
  await release(searches.all[0]!, await base.search({ query: 'archive' }));
  assert.equal(all(app.container, '.wiki-hit').length, 0, 'still waiting for the newer request');
  assert.equal(all(app.container, '[data-state="loading"]').length, 1);
  await release(searches.all[1]!, await base.search({ query: 'cash' }));
  assert.ok(all(app.container, '.wiki-hit-title').every((node) => !/Archive entry/.test(node.textContent ?? '')));
  assert.ok(all(app.container, '.wiki-hit').length > 0);
  await app.unmount();
});

test('toggling the repository filter supersedes the request in flight', async () => {
  const base = createSyntheticService();
  const searches = controlled<SearchResponse>();
  const app = await launch({ destination: 'search?q=pricing', service: override(base, { search: () => searches.next().promise }) });
  await click(one(app.container, 'input[name="repository"][value="appdev"]'));
  assert.equal(searches.all.length, 2);
  await release(searches.all[1]!, await base.search({ query: 'pricing', namespaces: ['bl'] }));
  await release(searches.all[0]!, await base.search({ query: 'pricing' }));
  assert.equal(all(app.container, '.wiki-hit').length, 3, 'only the bl-filtered response is shown');
  assert.deepEqual([...new Set(all(app.container, '.wiki-hit .wiki-ns').map((node) => node.textContent))], ['BusinessLessons']);
  await app.unmount();
});

test('reader: a slow page response cannot replace the page navigated to since', async () => {
  const base = createSyntheticService();
  const pages = controlled<PageResponse>();
  const app = await launch({ destination: 'page/bl/lessons/pricing.md', service: override(base, { getPage: () => pages.next().promise }) });
  await app.external('page/bl/lessons/cash-flow.md');
  await release(pages.all[1]!, await base.getPage({ key: { namespace: 'bl', path: 'lessons/cash-flow.md' } }));
  assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Cash flow');
  await release(pages.all[0]!, await base.getPage({ key: { namespace: 'bl', path: 'lessons/pricing.md' } }));
  assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Cash flow');
  assert.equal(textOf(one(app.container, '.wiki-crumbs code')), 'lessons/cash-flow.md');
  await app.unmount();
});

test('going back while a request is in flight shows the earlier view, not the late response', async () => {
  const base = createSyntheticService();
  const topics = controlled<TopicsResponse>();
  const app = await launch({ service: override(base, { listTopics: () => topics.next().promise }) });
  await click(nav(app.container, 'Topics · BusinessLessons'));
  assert.equal(all(app.container, '[data-state="loading"]').length, 1);
  await click(nav(app.container, '← Back'));
  assert.equal(all(app.container, '.wiki-card').length, 2);
  await release(topics.all[0]!, await base.listTopics({ namespace: 'bl' }));
  assert.equal(all(app.container, '.wiki-topic').length, 0, 'the late topic list is not mounted into home');
  assert.equal(all(app.container, '.wiki-card').length, 2);
  await app.unmount();
});

test('revisiting a destination loads it fresh and shows the latest answer', async () => {
  const base = createSyntheticService();
  let calls = 0;
  const app = await launch({
    destination: 'topics/bl',
    service: override(base, {
      listTopics: async (request) => {
        calls++;
        const answer = await base.listTopics(request);
        return answer.ok && calls > 1 ? { ok: true, value: { ...answer.value, topics: answer.value.topics.slice(0, 1) } } : answer;
      },
    }),
  });
  assert.ok(all(app.container, '.wiki-topic-root > .wiki-topic').length > 1);
  await click(nav(app.container, 'Topics · App Development'));
  await click(nav(app.container, 'Topics · BusinessLessons'));
  assert.equal(all(app.container, '.wiki-topic-root > .wiki-topic').length, 1, 'the second visit shows the second answer');
  await app.unmount();
});

test('a response that arrives after unmount is dropped quietly', async () => {
  const base = createSyntheticService();
  const pages = controlled<PageResponse>();
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    const app = await launch({ destination: 'page/bl/lessons/pricing.md', service: override(base, { getPage: () => pages.next().promise }) });
    await app.unmount();
    pages.all[0]!.resolve(await base.getPage({ key: { namespace: 'bl', path: 'lessons/pricing.md' } }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(errors, []);
  } finally {
    console.error = original;
  }
});

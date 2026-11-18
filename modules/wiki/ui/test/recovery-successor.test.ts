// Synthetic recovery journeys; authored source, execution belongs to the serial verifier.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import type { BacklinkEntry, Topic } from '../../contract/src/index.ts';
import { createSyntheticService, heading, key, para, text } from '../fixtures/synthetic.ts';
import { createWikiCache } from '../src/cache.ts';
import type { ViewCtx } from '../src/context.ts';
import { documentHeadings } from '../src/reader-model.ts';
import { createWikiSession } from '../src/session.ts';
import { buildTopicTree, showTopics, topicPageLabel } from '../src/topic-tree.ts';
import { BacklinkPreview } from '../src/view-preview.ts';
import { backButton, topicsButton } from './chrome.ts';
import { dom } from './dom.ts';
import { byText, click, mount, one, settle, textOf } from './render.ts';
import { fail, launch, override, spy } from './support.ts';

test('aligned topic titles filter by display title and retain path fallback', () => {
  const page = key('bl', 'lessons/old-name.md');
  const topic: Topic = { id: 'root', label: 'Lessons', parentId: null, pageCount: 1, pages: [page], pageTitles: ['New title'] };
  assert.equal(topicPageLabel(topic, page), 'New title');
  assert.equal(showTopics(buildTopicTree([topic]), 'new title')[0]?.pages.length, 1);
  assert.equal(showTopics(buildTopicTree([topic]), 'old-name')[0]?.pages.length, 1);
  const { pageTitles: _titles, ...legacy } = topic;
  assert.equal(topicPageLabel(legacy, page), 'Old name');
});

test('provider backlink excerpt is inert and does not read the source page', async () => {
  const { service, calls } = spy();
  const noop = () => {};
  const ctx: ViewCtx = { service, cache: createWikiCache(), session: createWikiSession(), toast: null, openSettings: null,
    openHome: noop, openPage: noop, openSearch: noop, openTopics: noop, openAmbiguity: noop };
  const entry: BacklinkEntry = { source: key('bl', 'lessons/source.md'), title: 'Source', via: ['body', 'related'], excerpt: '<script>inert</script> mention' };
  const m = await mount(BacklinkPreview, { ctx, entry, current: key('bl', 'lessons/target.md') });
  try {
    await settle();
    assert.match(textOf(m.container), /<script>inert<\/script> mention/);
    assert.equal(m.container.querySelector('script'), null);
    assert.equal(calls.filter((call) => call.method === 'getPage').length, 0);
  } finally { await m.unmount(); }
});

test('reader headings remove only the duplicate title and keep stable outline ids', () => {
  const title = heading(1, 'Example');
  const section = heading(2, 'Details');
  const nested = heading(3, 'More');
  const result = documentHeadings({ type: 'document', children: [title, para(text('Intro')), section, nested] }, 'Example');
  assert.equal(result.skipped, title);
  assert.deepEqual(result.outline.map(({ id, level, text }) => [id, level, text]), [['wiki-h-1', 2, 'Details'], ['wiki-h-2', 3, 'More']]);
});

test('failed reader read retries in place and backlink failure preserves the article', async () => {
  const base = createSyntheticService();
  let reads = 0;
  const service = override(base, {
    getPage: (request) => ++reads === 1 ? Promise.resolve(fail('unavailable', 'source-unavailable')) : base.getPage(request),
    getBacklinks: () => Promise.resolve(fail('unavailable', 'index-unavailable')),
  });
  const app = await launch({ destination: 'page/bl/lessons/pricing.md', service });
  try {
    await click(byText(app.container, 'button', 'Retry'));
    assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Pricing');
    assert.match(textOf(one(app.container, '.wiki-backlinks')), /Retry/);
    assert.equal(reads, 2);
    assert.equal(app.requested.length, 0);
  } finally { await app.unmount(); }
});

test('Wiki history consumes Alt+Left before shell bubbling only when history can move', async () => {
  const app = await launch();
  let shellBack = 0;
  const shell = (event: KeyboardEvent) => { if (event.altKey && event.key === 'ArrowLeft' && !event.defaultPrevented) shellBack++; };
  window.addEventListener('keydown', shell);
  const press = async () => {
    await act(async () => { one(app.container, 'main').dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }) as unknown as Event); });
    await settle();
  };
  try {
    await click(topicsButton(app.container, 'bl'));
    await press();
    assert.equal(app.shell(), 'home');
    assert.equal(shellBack, 0);
    await press();
    assert.equal(shellBack, 1, 'the edge leaves shell return available');
    assert.equal(backButton(app.container).disabled, true);
  } finally { window.removeEventListener('keydown', shell); await app.unmount(); }
});

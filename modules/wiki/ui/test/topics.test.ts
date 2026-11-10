import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { all, byText, click, one, textOf } from './render.ts';
import { ERROR_CASES, deferred, launch, override, release, validating } from './support.ts';

const topic = (container: HTMLElement, id: string): HTMLElement => one(container, `[data-topic-id="${id}"]`);

test('topics show a parentId tree with counts and previewed pages', async () => {
  const app = await launch({ destination: 'topics/bl' });
  assert.match(textOf(one(app.container, '.wiki-section-title')), /Topics · BusinessLessons/);
  const roots = all(app.container, '.wiki-topic-root > .wiki-topic').map((node) => node.getAttribute('data-topic-id'));
  assert.deepEqual(roots, ['finance', 'customers', 'samples', 'archive']);

  const finance = topic(app.container, 'finance');
  assert.equal(finance.getAttribute('data-expanded'), 'true');
  assert.equal(textOf(one(finance, '.wiki-topic-head .wiki-topic-label')), 'Finance');
  assert.equal(textOf(one(finance, '.wiki-topic-head .wiki-badge')), '2 pages');
  assert.deepEqual(all(finance, ':scope > .wiki-topic-body > .wiki-topic-pages > li').map((item) => textOf(item)), ['lessons/pricing.mdBusinessLessons', 'lessons/cash-flow.mdBusinessLessons']);
  const child = topic(app.container, 'finance-pricing');
  assert.equal(textOf(one(child, '.wiki-badge')), '1 page', 'singular');
  assert.ok(finance.contains(child), 'nested under its parent');
  await app.unmount();
});

test('a topic with more pages than its preview says how many are not shown', async () => {
  const app = await launch({ destination: 'topics/bl' });
  const archive = topic(app.container, 'archive');
  assert.equal(archive.getAttribute('data-expanded'), 'true');
  assert.equal(all(archive, '.wiki-topic-pages > li button').length, 50);
  assert.match(textOf(one(archive, '.wiki-topic-pages')), /and \d+ more$/);
  assert.match(textOf(one(archive, '.wiki-badge')), /^6\d pages$/);
  await app.unmount();
});

test('topics expand and collapse, individually and all at once', async () => {
  const app = await launch({ destination: 'topics/bl' });
  const toggle = one(topic(app.container, 'customers'), '.wiki-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  await click(toggle);
  assert.equal(topic(app.container, 'customers').getAttribute('data-expanded'), 'false');
  assert.equal(one(topic(app.container, 'customers'), '.wiki-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(topic(app.container, 'customers').querySelector('.wiki-topic-pages'), null);
  await click(byText(app.container, 'button', 'Collapse all'));
  assert.equal(all(app.container, '[data-expanded="true"]').length, 0);
  await click(byText(app.container, 'button', 'Expand all'));
  assert.equal(all(app.container, '[data-expanded="false"]').length, 0);
  await app.unmount();
});

test('a previewed page opens in the reader through a logical destination', async () => {
  const app = await launch({ destination: 'topics/bl' });
  await click(byText(topic(app.container, 'customers'), 'button', 'guides/onboarding.mdBusinessLessons'));
  assert.deepEqual(app.requested, ['page/bl/guides/onboarding.md']);
  assert.match(textOf(one(app.container, '.wiki-page-title')), /Onboarding/);
  await app.unmount();
});

test('the repository switcher moves between topic trees without leaking expansion state', async () => {
  const app = await launch({ destination: 'topics/bl' });
  await click(one(topic(app.container, 'finance'), '.wiki-toggle'));
  await click(byText(app.container, '.wiki-topics .wiki-button', 'App Development'));
  assert.deepEqual(app.requested, ['topics/appdev']);
  assert.match(textOf(one(app.container, '.wiki-section-title')), /Topics · App Development/);
  assert.deepEqual(all(app.container, '.wiki-topic-root > .wiki-topic').map((node) => node.getAttribute('data-topic-id')), ['app-shell', 'data']);
  assert.ok(topic(app.container, 'data').contains(topic(app.container, 'data-sync')));
  assert.equal(byText(app.container, '.wiki-topics .wiki-button', 'App Development').getAttribute('aria-pressed'), 'true');
  await click(byText(app.container, '.wiki-topics .wiki-button', 'BusinessLessons'));
  assert.equal(topic(app.container, 'finance').getAttribute('data-expanded'), 'true', 'a fresh tree starts at its default');
  await app.unmount();
});

test('topics: loading, empty, per-code errors and a mismatched namespace', async () => {
  const base = createSyntheticService();
  const pending = deferred<Awaited<ReturnType<typeof base.listTopics>>>();
  const slow = await launch({ destination: 'topics/appdev', service: override(base, { listTopics: () => pending.promise }) });
  assert.equal(one(slow.container, '.wiki-topics [data-state="loading"]').textContent, 'Loading topics…');
  await release(pending, await base.listTopics({ namespace: 'appdev' }));
  assert.ok(slow.container.querySelector('[data-topic-id="data"]'));
  await slow.unmount();

  const empty = await launch({ destination: 'topics/bl', service: override(base, { listTopics: () => Promise.resolve({ ok: true, value: { namespace: 'bl', topics: [] } }) }) });
  assert.match(textOf(one(empty.container, '[data-state="empty"]')), /No topics in BusinessLessons\./);
  await empty.unmount();

  for (const { name, result, title } of ERROR_CASES) {
    const app = await launch({ destination: 'topics/bl', service: override(base, { listTopics: () => Promise.resolve(result) }) });
    const alert = byText(app.container, '[role="alert"]', title);
    assert.equal(alert.getAttribute('data-code'), result.error.code, name);
    await app.unmount();
  }

  const mismatch = await launch({ destination: 'topics/bl', service: override(base, { listTopics: () => base.listTopics({ namespace: 'appdev' }) }) });
  assert.match(textOf(one(mismatch.container, '[role="alert"]')), /different repository/);
  await mismatch.unmount();
});

test('a topic list with a parent cycle still renders every topic once', async () => {
  const base = createSyntheticService();
  const cyclic = {
    namespace: 'bl' as const,
    topics: [
      { id: 'p', label: 'P', parentId: 'q', pageCount: 0, pages: [] },
      { id: 'q', label: 'Q', parentId: 'p', pageCount: 0, pages: [] },
      { id: 'r', label: 'R', parentId: null, pageCount: 0, pages: [] },
    ],
  };
  const app = await launch({ destination: 'topics/bl', service: override(base, { listTopics: () => Promise.resolve({ ok: true, value: cyclic }) }) });
  assert.deepEqual(all(app.container, '[data-topic-id]').map((node) => node.getAttribute('data-topic-id')).sort(), ['p', 'q', 'r']);
  await app.unmount();
});

test('topic requests are valid logical requests', async () => {
  const checked = validating(createSyntheticService());
  const app = await launch({ destination: 'topics/bl', service: checked.service });
  await click(byText(app.container, '.wiki-topics .wiki-button', 'App Development'));
  assert.deepEqual(checked.rejected, []);
  await app.unmount();
});

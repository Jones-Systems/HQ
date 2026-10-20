import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMIT_APPDEV, COMMIT_BL, PAGES, SOURCES, createSyntheticService } from '../fixtures/synthetic.ts';
import { all, byText, click, one, textOf } from './render.ts';
import { ERROR_CASES, deferred, launch, override, release } from './support.ts';

const field = (card: HTMLElement, name: string): string => textOf(one(card, `[data-field="${name}"] dd`));

test('home lists both repositories with display names, provenance and freshness', async () => {
  const app = await launch();
  const cards = all(app.container, '.wiki-card');
  assert.deepEqual(cards.map((card) => one(card, '.wiki-card-title').textContent), ['BusinessLessons', 'App Development']);

  const [bl, appdev] = cards as [HTMLElement, HTMLElement];
  assert.equal(field(bl, 'ref'), 'main');
  assert.equal(field(bl, 'commit'), COMMIT_BL.slice(0, 12));
  assert.equal(one(bl, '[data-field="commit"] code').getAttribute('title'), COMMIT_BL);
  assert.equal(field(bl, 'commitTime'), SOURCES.bl.commitTime);
  assert.equal(field(bl, 'indexedAt'), SOURCES.bl.indexedAt);
  assert.match(field(bl, 'graphFreshness'), /^current \(built from 1f3a5c7e9b2d\)$/);
  assert.match(field(bl, 'contentFreshness'), /Unknown \(not checked against the remote\)/);
  assert.equal(one(bl, '[data-field="contentFreshness"] [data-freshness]').getAttribute('data-freshness'), 'unknown');
  const blPages = PAGES.filter((page) => page.key.namespace === 'bl').length;
  assert.match(textOf(bl), new RegExp(`${blPages} pages indexed`));
  assert.equal(one(bl, '[data-index-state]').getAttribute('data-index-state'), 'ready');

  assert.equal(field(appdev, 'commit'), COMMIT_APPDEV.slice(0, 12));
  assert.match(field(appdev, 'graphFreshness'), /^stale \(built from 0a1b2c3d4e5f\)$/);
  assert.match(field(appdev, 'contentFreshness'), /^behind, checked 2026-10-13T09:00:00Z$/);
  assert.equal(one(appdev, 'time').getAttribute('datetime'), SOURCES.appdev.commitTime);
  assert.equal(app.container.querySelector('.wiki-notice'), null, 'plain home has no notice');
  await app.unmount();
});

test('home buttons request the topic destinations', async () => {
  const app = await launch();
  const button = byText(app.container, '.wiki-card button', 'Browse App Development topics');
  await click(button);
  assert.deepEqual(app.requested, ['topics/appdev']);
  assert.equal(app.shell(), 'topics/appdev');
  await app.unmount();
});

test('home shows a loading state until both requests settle', async () => {
  const sources = deferred<Awaited<ReturnType<ReturnType<typeof createSyntheticService>['listSources']>>>();
  const base = createSyntheticService();
  const app = await launch({ service: override(base, { listSources: () => sources.promise }) });
  assert.equal(one(app.container, '[data-state="loading"]').getAttribute('role'), 'status');
  assert.ok(all(app.container, '.wiki-card').length === 2, 'status alone is enough to show cards');
  await release(sources, await base.listSources());
  assert.equal(app.container.querySelector('[data-state="loading"]'), null);
  assert.match(textOf(app.container), /BusinessLessons/);
  await app.unmount();
});

for (const { name, result, title } of ERROR_CASES) {
  test(`home shows ${name} for each failing request independently`, async () => {
    const base = createSyntheticService();
    const sourcesFail = await launch({ service: override(base, { listSources: () => Promise.resolve(result) }) });
    const alert = one(sourcesFail.container, '[role="alert"]');
    assert.match(alert.textContent ?? '', title);
    assert.equal(alert.getAttribute('data-code'), result.error.code);
    assert.equal(alert.getAttribute('data-reason'), result.error.reason);
    assert.match(textOf(alert), /repository list/);
    assert.equal(all(sourcesFail.container, '.wiki-card').length, 2, 'index status still renders the repositories');
    await sourcesFail.unmount();

    const statusFail = await launch({ service: override(base, { indexStatus: () => Promise.resolve(result) }) });
    assert.match(one(statusFail.container, '[role="alert"]').textContent ?? '', title);
    assert.match(textOf(statusFail.container), /index status/);
    assert.equal(all(statusFail.container, '.wiki-card').length, 2, 'sources still render');
    await statusFail.unmount();
  });
}

test('an unavailable source is reported per repository', async () => {
  const base = createSyntheticService();
  const status = await base.indexStatus();
  assert.ok(status.ok);
  const app = await launch({
    service: override(base, {
      listSources: () => Promise.resolve({ ok: true, value: [SOURCES.bl] }),
      indexStatus: () =>
        Promise.resolve({
          ok: true,
          value: { namespaces: [status.value.namespaces[0]!, { namespace: 'appdev', state: 'unavailable', pageCount: 0, source: null }] },
        }),
    }),
  });
  const [, appdev] = all(app.container, '.wiki-card') as [HTMLElement, HTMLElement];
  assert.equal(one(appdev, '[data-index-state]').textContent, 'source unavailable');
  assert.match(textOf(appdev), /No source information is available/);
  await app.unmount();
});

test('rejections and malformed responses become an internal error, not a crash', async () => {
  const base = createSyntheticService();
  const thrown = await launch({ service: override(base, { listSources: () => Promise.reject(new Error('<b>boom</b>')) }) });
  const alert = one(thrown.container, '[role="alert"]');
  assert.equal(alert.getAttribute('data-code'), 'internal');
  assert.ok(!(alert.textContent ?? '').includes('boom'), 'thrown text is not echoed');
  await thrown.unmount();

  const sync = await launch({ service: override(base, { indexStatus: () => { throw new Error('sync'); } }) });
  assert.equal(one(sync.container, '[role="alert"]').getAttribute('data-code'), 'internal');
  await sync.unmount();

  const malformed = await launch({ service: override(base, { indexStatus: () => Promise.resolve({ ok: true, value: { namespaces: 'nope' } } as never) }) });
  assert.match(textOf(one(malformed.container, '[role="alert"]')), /did not match the Wiki contract/);
  await malformed.unmount();

  const notAResult = await launch({ service: override(base, { listSources: () => Promise.resolve(undefined as never) }) });
  assert.match(textOf(one(notAResult.container, '[role="alert"]')), /malformed response/);
  await notAResult.unmount();
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_QUERY_LENGTH } from '../../contract/src/index.ts';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { createWikiView } from '../src/index.ts';
import { filterChip, searchInput } from './chrome.ts';
import { all, byText, click, one, submit, textOf, typeInto } from './render.ts';
import { ERROR_CASES, deferred, launch, override, release, spy, validating } from './support.ts';

const input = searchInput;
const pressed = (container: HTMLElement, repo: string): string | null => filterChip(container, repo).getAttribute('aria-pressed');

async function search(container: HTMLElement, query: string): Promise<void> {
  await typeInto(input(container), query);
  await submit(one(container, 'form[role="search"]'));
}

test('submitting a query asks the shell for the canonical search destination and shows hits from both repositories', async () => {
  const { service, calls } = spy();
  const app = await launch({ service });
  await search(app.container, 'pricing');
  assert.deepEqual(app.requested, ['search?q=pricing']);
  assert.equal(app.shell(), 'search?q=pricing');
  assert.equal(input(app.container).value, 'pricing', 'the box shows the active query');

  const hits = all(app.container, '.wiki-hit');
  assert.equal(hits.length, 5);
  const samePricing = hits.filter((hit) => textOf(one(hit, '.wiki-hit-title')) === 'Pricing');
  assert.deepEqual(samePricing.map((hit) => textOf(one(hit, '.wiki-ns'))).sort(), ['App Development', 'BusinessLessons'], 'same title, two repositories, never merged');
  for (const hit of hits) {
    assert.match(hit.getAttribute('data-score') ?? '', /^\d+\.\d\d$/, 'the score stays on the hit for tests and tools, but is no longer printed');
    assert.ok(textOf(one(hit, '.wiki-snippet')).length > 0);
  }
  assert.equal(textOf(one(app.container, '.wiki-summary')), '5 results');
  assert.equal(one(app.container, '.wiki-summary').getAttribute('data-total'), '5');
  assert.deepEqual(calls.filter((call) => call.method === 'search').map((call) => call.args), [[{ query: 'pricing' }]], 'all repositories means no namespaces filter');
  await app.unmount();
});

test('the repository filter narrows the request and the results', async () => {
  const { service, calls } = spy();
  const app = await launch({ service, destination: 'search?q=pricing' });
  assert.equal(all(app.container, '.wiki-hit').length, 5);
  await click(filterChip(app.container, 'appdev'));
  assert.equal(pressed(app.container, 'appdev'), 'false');
  assert.equal(pressed(app.container, 'all'), 'false', 'All is no longer pressed once a repository is off');
  assert.deepEqual(calls.filter((call) => call.method === 'search').at(-1)?.args, [{ query: 'pricing', namespaces: ['bl'] }]);
  const hits = all(app.container, '.wiki-hit');
  assert.equal(hits.length, 3);
  assert.deepEqual([...new Set(hits.map((hit) => textOf(one(hit, '.wiki-ns'))))], ['BusinessLessons']);
  // Name lookups follow the filter too. The session cache already holds the earlier lookups, so ask for a new query.
  const lookedUp = (): string[] => calls.filter((call) => call.method === 'resolveAlias').map((call) => (call.args[0] as { namespace: string }).namespace);
  const seen = lookedUp().length;
  await search(app.container, 'onboarding');
  assert.deepEqual(lookedUp().slice(seen), ['bl'], 'only the selected repository is asked about the new name');

  await click(filterChip(app.container, 'appdev'));
  await click(filterChip(app.container, 'bl'));
  assert.deepEqual(calls.filter((call) => call.method === 'search').at(-1)?.args, [{ query: 'onboarding', namespaces: ['appdev'] }]);
  assert.deepEqual([...new Set(all(app.container, '.wiki-hit').map((hit) => textOf(one(hit, '.wiki-ns'))))], ['App Development']);
  assert.equal(all(app.container, '.wiki-hit').length > 0, true);
  assert.deepEqual(app.requested, ['search?q=onboarding'], 'filtering is not a navigation; only the new query was requested');
  await app.unmount();
});

test('with no repository selected nothing is searched and the reason is shown', async () => {
  const { service, calls } = spy();
  const app = await launch({ service, destination: 'search?q=pricing' });
  await click(filterChip(app.container, 'appdev'));
  await click(filterChip(app.container, 'bl'));
  assert.equal(all(app.container, '[data-state="no-repositories"]').length, 1);
  assert.equal(all(app.container, '.wiki-hit').length, 0);
  const before = calls.length;
  await click(filterChip(app.container, 'appdev'));
  assert.ok(calls.length > before, 'selecting a repository again searches it (this combination had not been asked for yet)');
  assert.equal(all(app.container, '.wiki-hit').length, 2);
  await click(filterChip(app.container, 'bl'));
  assert.equal(all(app.container, '.wiki-hit').length, 5);
  await app.unmount();
});

test('long queries are clamped to 256 code points, not by an HTML maxlength', async () => {
  const app = await launch();
  const box = input(app.container);
  assert.equal(box.getAttribute('maxlength'), null);
  assert.equal(box.maxLength === undefined || box.maxLength < 0, true);
  await typeInto(box, 'a'.repeat(400));
  assert.equal(input(app.container).value.length, MAX_QUERY_LENGTH);
  const emoji = '😀';
  await typeInto(input(app.container), emoji.repeat(300));
  assert.equal(Array.from(input(app.container).value).length, MAX_QUERY_LENGTH);
  assert.equal(input(app.container).value.length, MAX_QUERY_LENGTH * 2, 'counted in code points, not UTF-16 units');
  await submit(one(app.container, 'form'));
  assert.equal(app.requested.length, 1);
  assert.equal(app.requested[0]?.startsWith('search?q='), true);
  assert.equal(all(app.container, '[role="alert"][data-code="invalid-input"]').length, 0, 'the clamped query is valid');
  await app.unmount();
});

test('blank or control-character queries are refused before any request', async () => {
  const { service, calls } = spy();
  const app = await launch({ service });
  await search(app.container, '    ');
  assert.match(textOf(one(app.container, '.wiki-field-problem')), /Enter something to search for\./);
  await search(app.container, 'bad\u0007query');
  assert.match(textOf(one(app.container, '.wiki-field-problem')), /not valid \(control-character\)/);
  assert.deepEqual(app.requested, []);
  assert.deepEqual(calls.filter((call) => call.method === 'search'), []);
  await typeInto(input(app.container), 'ok');
  assert.equal(app.container.querySelector('.wiki-field-problem'), null, 'editing clears the message');
  await app.unmount();
});

test('truncated results say so; empty results say so', async () => {
  const app = await launch({ destination: 'search?q=archive' });
  const summary = one(app.container, '.wiki-summary');
  assert.equal(summary.getAttribute('data-truncated'), 'true');
  assert.equal(all(app.container, '.wiki-hit').length, 50);
  assert.match(textOf(summary), /^Showing 50 of 6\d · narrow the search or the repositories$/);
  await search(app.container, 'zzzznothing');
  const empty = one(app.container, '[data-state="empty"]');
  assert.match(textOf(empty), /No pages match “zzzznothing”/);
  await app.unmount();
});

test('exact name matches show resolved pages and keep ambiguity visible', async () => {
  const app = await launch({ destination: 'search?q=onboarding' });
  const section = one(app.container, '[data-section="alias-matches"]');
  const disambiguation = one(section, '.wiki-disambiguation');
  assert.match(textOf(disambiguation), /“onboarding \(BusinessLessons\)” matches 2 pages/);
  const candidates = all(disambiguation, '.wiki-candidates button').map((button) => textOf(button));
  assert.deepEqual(candidates, ['lessons/onboarding.mdBusinessLessons', 'guides/onboarding.mdBusinessLessons']);
  await click(all(disambiguation, '.wiki-candidates button')[1]!);
  assert.equal(app.shell(), 'page/bl/guides/onboarding.md');
  assert.match(textOf(one(app.container, '.wiki-page-title')), /Onboarding/);
  await app.unmount();

  const pricing = await launch({ destination: 'search?q=pricing' });
  const goto = all(pricing.container, '[data-section="alias-matches"] .wiki-goto');
  assert.deepEqual(goto.map((button) => [textOf(one(button, '.wiki-goto-title')), textOf(one(button, '.wiki-ns')), textOf(one(button, '.wiki-hit-folder'))]).sort(), [
    ['Pricing', 'App Development', 'research'],
    ['Pricing', 'BusinessLessons', 'lessons'],
  ]);
  for (const [index, destination] of ['page/bl/lessons/pricing.md', 'page/appdev/research/pricing.md'].entries()) {
    const target = all(pricing.container, '[data-section="alias-matches"] .wiki-goto').find((button) => textOf(one(button, '.wiki-ns')) === (index === 0 ? 'BusinessLessons' : 'App Development'))!;
    await click(target);
    assert.equal(pricing.requested.at(-1), destination, 'each exact match opens its own page');
    await click(one(pricing.container, 'button[aria-label="Back"]'));
  }
  await pricing.unmount();
});

test('every request the search view makes passes the contract request validators', async () => {
  const checked = validating(createSyntheticService());
  const app = await launch({ service: checked.service });
  await search(app.container, 'cash flow');
  await click(filterChip(app.container, 'appdev'));
  await search(app.container, 'ünï 🙂 query');
  assert.deepEqual(checked.rejected, []);
  await app.unmount();
});

test('search shows loading, then each error code with its own text', async () => {
  const pending = deferred<Awaited<ReturnType<ReturnType<typeof createSyntheticService>['search']>>>();
  const base = createSyntheticService();
  const slow = await launch({ service: override(base, { search: () => pending.promise }), destination: 'search?q=pricing' });
  assert.equal(all(slow.container, '[data-state="loading"]').length, 1);
  assert.equal(all(slow.container, '.wiki-hit').length, 0);
  await release(pending, await base.search({ query: 'pricing' }));
  assert.equal(all(slow.container, '.wiki-hit').length, 5);
  await slow.unmount();

  for (const { name, result, title } of ERROR_CASES) {
    const app = await launch({ service: override(base, { search: () => Promise.resolve(result) }), destination: 'search?q=pricing' });
    const alert = byText(app.container, '[role="alert"]', title);
    assert.equal(alert.getAttribute('data-code'), result.error.code, name);
    assert.equal(alert.getAttribute('data-reason'), result.error.reason, name);
    assert.equal(all(app.container, '.wiki-hit').length, 0);
    await app.unmount();
  }
});

test('a failing name lookup is reported without hiding search results', async () => {
  const base = createSyntheticService();
  const unavailable = ERROR_CASES.find((item) => item.name === 'source-unavailable')!.result;
  const app = await launch({ service: override(base, { resolveAlias: () => Promise.resolve(unavailable) }), destination: 'search?q=pricing' });
  assert.match(textOf(one(app.container, '[role="alert"]')), /name lookup/);
  assert.equal(all(app.container, '.wiki-hit').length, 5);
  await app.unmount();

  const quiet = await launch({ service: override(base, { resolveAlias: () => Promise.resolve(ERROR_CASES[1]!.result) }), destination: 'search?q=pricing' });
  assert.equal(all(quiet.container, '[role="alert"]').length, 0, 'not-found for a name is simply no match');
  await quiet.unmount();
});


test('there is no collapsible search bar: the field and filter are always there, nothing is stored, and the filter survives a remount', async () => {
  const View = createWikiView(createSyntheticService());
  const app = await launch({ View, destination: 'search?q=pricing' });
  const store = app.container.ownerDocument.defaultView!.localStorage;
  try {
    assert.equal(all(app.container, '[aria-label*="Hide Wiki search"], [aria-label*="Show Wiki search"], #wiki-secondary-search').length, 0, 'the old toggle is gone (X14)');
    assert.equal(input(app.container).value, 'pricing', 'the field holds the active query');
    await click(filterChip(app.container, 'appdev'));
    assert.equal(pressed(app.container, 'appdev'), 'false');
    assert.equal(store.getItem('hq.wiki.searchbar.v1'), null, 'no collapsed state is persisted');
    await app.unmount();

    const again = await launch({ View, destination: 'search?q=pricing' });
    try {
      assert.equal(pressed(again.container, 'appdev'), 'false', 'the repository filter comes back with the session');
      assert.equal(pressed(again.container, 'bl'), 'true');
      assert.equal(all(again.container, '.wiki-hit').length, 3);
    } finally {
      await again.unmount();
    }
  } finally {
    store.removeItem('hq.wiki.searchbar.v1');
    if (app.container.isConnected) await app.unmount();
  }
});

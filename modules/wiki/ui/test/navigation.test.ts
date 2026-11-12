import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { createWikiView } from '../src/index.ts';
import { dom } from './dom.ts';
import { backButton, forwardButton, historyButton, historyItems, historyLabels, homeButton, shown, topicsButton } from './chrome.ts';
import { all, byText, click, mount, one, settle, textOf } from './render.ts';
import { launch, override } from './support.ts';

const historyCount = async (container: HTMLElement): Promise<number> => (await historyLabels(container)).length;

test('in-session history: back, forward and jumping through the list', async () => {
  const app = await launch();
  await click(topicsButton(app.container, 'bl'));
  await click(byText(app.container, '.wiki-topic-pages button', 'lessons/pricing.mdBusinessLessons'));
  assert.deepEqual(app.requested, ['topics/bl', 'page/bl/lessons/pricing.md']);
  assert.equal(await historyCount(app.container), 3);
  assert.equal(shown(app.container), 'Reader');

  await click(backButton(app.container));
  assert.equal(shown(app.container), 'Topics');
  assert.equal(app.shell(), 'topics/bl', 'back asks the shell to persist the earlier destination');
  assert.equal(await historyCount(app.container), 3, 'back adds no entry');
  await click(backButton(app.container));
  assert.equal(shown(app.container), 'Home');
  assert.equal(backButton(app.container).hasAttribute('disabled'), true);
  await click(forwardButton(app.container));
  assert.equal(shown(app.container), 'Topics');

  // The popover lists the session newest first, in the terms a reader would use, and marks where we are.
  await click(historyButton(app.container));
  const entries = historyItems(app.container);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => textOf(one(entry, '.wiki-history-label'))).slice(1), ['BusinessLessons topics', 'Home']);
  assert.equal(entries[0]!.getAttribute('data-entry'), '2', 'the page, the newest entry, comes first');
  assert.equal(entries[1]!.getAttribute('aria-current'), 'step');
  assert.equal(entries.filter((entry) => entry.hasAttribute('aria-current')).length, 1);
  await click(entries[0]!);
  assert.equal(shown(app.container), 'Reader');
  assert.equal(forwardButton(app.container).hasAttribute('disabled'), true);
  assert.equal(app.container.querySelector('.wiki-history'), null, 'choosing an entry closes the popover');
  await app.unmount();
});

test('navigating after going back drops the forward branch', async () => {
  const app = await launch();
  await click(topicsButton(app.container, 'bl'));
  await click(backButton(app.container));
  await click(topicsButton(app.container, 'appdev'));
  assert.equal(await historyCount(app.container), 2);
  assert.equal(forwardButton(app.container).hasAttribute('disabled'), true);
  await app.unmount();
});

test('the shell echoing a request does not add a history entry', async () => {
  const app = await launch();
  await click(topicsButton(app.container, 'bl'));
  assert.equal(app.shell(), 'topics/bl');
  assert.equal(await historyCount(app.container), 2);
  await app.unmount();
});

test('an external destination change re-syncs the view and becomes history', async () => {
  const app = await launch({ destination: 'topics/bl' });
  await app.external('search?q=cash');
  assert.equal(shown(app.container), 'Search results');
  assert.equal(input(app.container).value, 'cash');
  assert.equal(await historyCount(app.container), 2);
  assert.deepEqual(app.requested, [], 'the view asked for nothing');

  await app.external('page/appdev/notes/navigation.md');
  assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Navigation');
  await click(backButton(app.container));
  assert.equal(shown(app.container), 'Search results');
  assert.equal(app.shell(), 'search?q=cash');
  await app.external('page/appdev/notes/navigation.md');
  assert.equal(await historyCount(app.container), 3, 'a fresh external change after Back replaces the forward branch');
  await app.unmount();
});

function input(container: HTMLElement): HTMLInputElement {
  return one(container, 'input[name="q"]') as HTMLInputElement;
}

test('an external change to the destination already shown is not a new entry', async () => {
  const app = await launch({ destination: 'topics/bl' });
  await app.external('topics/bl');
  await app.external('home');
  assert.equal(await historyCount(app.container), 2);
  await app.external('home');
  assert.equal(await historyCount(app.container), 2);
  await app.unmount();
});

test('a long destination the shell cannot persist still navigates in-session (known persistence gap)', async () => {
  const longPath = `${'deep/'.repeat(120)}note.md`;
  const long = `page/bl/${longPath}`;
  assert.ok(long.length > 512);
  // The view is the source of this navigation: it asks for the long destination through a page link.
  const service = override(createSyntheticService(), {
    getPage: (request) =>
      Promise.resolve({
        ok: true,
        value: {
          key: request.key,
          title: 'Deep note',
          commit: '1f3a5c7e9b2d4f60718293a4b5c6d7e8f9012345',
          byteLength: 10,
          fields: [],
          outLinks: [],
          content: { state: 'parsed', ast: { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'link', target: { kind: 'page', key: { namespace: 'bl', path: longPath } }, children: [{ type: 'text', value: 'go deep' }] }] }] } },
        },
      }),
  });
  const gap = await launch({ service, persistLimit: 512, destination: 'page/bl/start.md' });
  await click(byText(gap.container, '.wiki-parsed button', 'go deep'));
  assert.deepEqual(gap.requested, [long], 'the view still requests persistence');
  assert.equal(gap.shell(), 'page/bl/start.md', 'the shell refused the long destination');
  assert.equal(textOf(one(gap.container, '.wiki-crumbs code')), longPath, 'but the view navigated');
  assert.equal(await historyCount(gap.container), 2);
  await click(backButton(gap.container));
  assert.equal(textOf(one(gap.container, '.wiki-crumbs code')), 'start.md', 'in-session history still works');
  await click(forwardButton(gap.container));
  assert.equal(textOf(one(gap.container, '.wiki-crumbs code')), longPath);
  await gap.unmount();
});

test('home shows home without a notice; an unparseable destination shows home with an inert notice', async () => {
  const home = await launch({ destination: 'home' });
  assert.equal(shown(home.container), 'Home');
  assert.equal(home.container.querySelector('.wiki-notice'), null);
  await home.unmount();

  for (const [bad, reason] of [
    ['', 'wrong-type'],
    ['nonsense', 'invalid-destination'],
    ['javascript:alert(1)', 'scheme'],
    ['https://example.com/', 'scheme'],
    ['/page/bl/a.md', 'absolute-path'],
    ['page/bl/..%2F..%2Fsecret.md', 'traversal'],
    ['page/nope/a.md', 'unknown-namespace'],
    ['<script>window.__wikiPwned=1</script>', 'invalid-destination'],
  ] as const) {
    const app = await launch({ destination: bad });
    assert.equal(shown(app.container), 'Home', bad);
    const notice = one(app.container, '[data-notice="destination"]');
    assert.match(textOf(notice), /not recognised, so Home is shown/);
    assert.match(textOf(notice), new RegExp(`Reason: ${reason === 'wrong-type' ? '[a-z-]+' : reason}`), bad);
    assert.equal(all(app.container, 'script, a, [href]').length, 0);
    assert.equal(all(app.container, '.wiki-card').length, 2, 'home content is still there');
    await app.unmount();
  }
});

test('the notice excerpt is bounded and a later valid destination clears it', async () => {
  const app = await launch({ destination: `bogus-${'x'.repeat(2000)}` });
  assert.ok(textOf(one(app.container, '.wiki-notice-destination')).length < 100);
  await app.external('topics/appdev');
  assert.equal(app.container.querySelector('.wiki-notice'), null);
  await click(backButton(app.container));
  assert.ok(app.container.querySelector('[data-notice="destination"]'), 'back restores what was shown');
  await app.unmount();
});

test('the Home button and unchanged destinations behave', async () => {
  const app = await launch({ destination: 'topics/bl' });
  await click(homeButton(app.container));
  assert.equal(app.shell(), 'home');
  await click(homeButton(app.container));
  assert.equal(await historyCount(app.container), 2, 'clicking Home on Home adds nothing');
  assert.deepEqual(app.requested, ['home']);
  await app.unmount();
});

test('appearance is a data attribute and does not change content', async () => {
  const app = await launch({ destination: 'page/bl/lessons/pricing.md', appearance: 'light' });
  const root = (): HTMLElement => one(app.container, '.wiki-view');
  assert.equal(root().getAttribute('data-appearance'), 'light');
  const before = textOf(one(app.container, 'main'));
  await app.rerenderAppearance('dark');
  assert.equal(root().getAttribute('data-appearance'), 'dark');
  assert.equal(textOf(one(app.container, 'main')), before);
  assert.equal(all(app.container, '[style]').length, 0);
  await app.unmount();
});

test('focus moves to the new view\'s heading after navigation, not on first render', async () => {
  const app = await launch();
  assert.equal(one(app.container, 'main').contains(dom.document.activeElement as unknown as Node), false, 'nothing steals focus on first render');
  await click(topicsButton(app.container, 'bl'));
  const main = one(app.container, 'main');
  const focused = dom.document.activeElement as unknown as HTMLElement;
  assert.ok(main.contains(focused), 'focus is inside the new content');
  assert.match(focused.tagName, /^H[12]$/, 'on its heading, so a screen reader announces where we are');
  assert.equal(main.getAttribute('aria-labelledby'), focused.id, 'and the region is named by it');
  await app.unmount();
});

test('a shell that throws from navigate does not break in-session navigation', async () => {
  const View = createWikiView(createSyntheticService());
  const m = await mount(View, {
    destination: 'home',
    appearance: 'light',
    navigate: () => {
      throw new Error('shell refused');
    },
  });
  await settle();
  await click(topicsButton(m.container, 'bl'));
  assert.equal(shown(m.container), 'Topics');
  await m.unmount();
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { createWikiView } from '../src/index.ts';
import { dom } from './dom.ts';
import { all, byText, click, mount, one, settle, textOf } from './render.ts';
import { launch, override } from './support.ts';

const nav = (container: HTMLElement, label: string): HTMLElement => byText(container, '.wiki-nav button', label);
const historyCount = (container: HTMLElement): string => textOf(byText(container, '.wiki-nav button', /^History/));
const shown = (container: HTMLElement): string => (container.querySelector('main')?.firstElementChild?.getAttribute('aria-label') ?? '');

test('in-session history: back, forward and jumping through the list', async () => {
  const app = await launch();
  await click(nav(app.container, 'Topics · BusinessLessons'));
  await click(byText(app.container, '.wiki-topic-pages button', 'lessons/pricing.mdBusinessLessons'));
  assert.deepEqual(app.requested, ['topics/bl', 'page/bl/lessons/pricing.md']);
  assert.equal(historyCount(app.container), 'History (3)');
  assert.equal(shown(app.container), 'Reader');

  await click(nav(app.container, '← Back'));
  assert.equal(shown(app.container), 'Topics');
  assert.equal(app.shell(), 'topics/bl', 'back asks the shell to persist the earlier destination');
  assert.equal(historyCount(app.container), 'History (3)', 'back adds no entry');
  await click(nav(app.container, '← Back'));
  assert.equal(shown(app.container), 'Home');
  assert.equal(nav(app.container, '← Back').hasAttribute('disabled'), true);
  await click(nav(app.container, 'Forward →'));
  assert.equal(shown(app.container), 'Topics');

  await click(nav(app.container, 'History (3)'));
  const entries = all(app.container, '.wiki-history li button');
  assert.deepEqual(entries.map((entry) => entry.textContent), ['Home', 'Topics · bl', 'Page · bl/lessons/pricing.md']);
  assert.equal(entries[1]!.getAttribute('aria-current'), 'step');
  await click(entries[2]!);
  assert.equal(shown(app.container), 'Reader');
  assert.equal(nav(app.container, 'Forward →').hasAttribute('disabled'), true);
  await app.unmount();
});

test('navigating after going back drops the forward branch', async () => {
  const app = await launch();
  await click(nav(app.container, 'Topics · BusinessLessons'));
  await click(nav(app.container, '← Back'));
  await click(nav(app.container, 'Topics · App Development'));
  assert.equal(historyCount(app.container), 'History (2)');
  assert.equal(nav(app.container, 'Forward →').hasAttribute('disabled'), true);
  await app.unmount();
});

test('the shell echoing a request does not add a history entry', async () => {
  const app = await launch();
  await click(nav(app.container, 'Topics · BusinessLessons'));
  assert.equal(app.shell(), 'topics/bl');
  assert.equal(historyCount(app.container), 'History (2)');
  await app.unmount();
});

test('an external destination change re-syncs the view and becomes history', async () => {
  const app = await launch({ destination: 'topics/bl' });
  await app.external('search?q=cash');
  assert.equal(shown(app.container), 'Search results');
  assert.equal(input(app.container).value, 'cash');
  assert.equal(historyCount(app.container), 'History (2)');
  assert.deepEqual(app.requested, [], 'the view asked for nothing');

  await app.external('page/appdev/notes/navigation.md');
  assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Navigation');
  await click(nav(app.container, '← Back'));
  assert.equal(shown(app.container), 'Search results');
  assert.equal(app.shell(), 'search?q=cash');
  await app.external('page/appdev/notes/navigation.md');
  assert.equal(historyCount(app.container), 'History (3)', 'a fresh external change after Back replaces the forward branch');
  await app.unmount();
});

function input(container: HTMLElement): HTMLInputElement {
  return one(container, 'input[name="q"]') as HTMLInputElement;
}

test('an external change to the destination already shown is not a new entry', async () => {
  const app = await launch({ destination: 'topics/bl' });
  await app.external('topics/bl');
  await app.external('home');
  assert.equal(historyCount(app.container), 'History (2)');
  await app.external('home');
  assert.equal(historyCount(app.container), 'History (2)');
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
  assert.equal(historyCount(gap.container), 'History (2)');
  await click(nav(gap.container, '← Back'));
  assert.equal(textOf(one(gap.container, '.wiki-crumbs code')), 'start.md', 'in-session history still works');
  await click(nav(gap.container, 'Forward →'));
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
  await click(nav(app.container, '← Back'));
  assert.ok(app.container.querySelector('[data-notice="destination"]'), 'back restores what was shown');
  await app.unmount();
});

test('the Home button and unchanged destinations behave', async () => {
  const app = await launch({ destination: 'topics/bl' });
  await click(nav(app.container, 'Home'));
  assert.equal(app.shell(), 'home');
  await click(nav(app.container, 'Home'));
  assert.equal(historyCount(app.container), 'History (2)', 'clicking Home on Home adds nothing');
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

test('focus moves to the new content after navigation, not on first render', async () => {
  const app = await launch();
  assert.notEqual(dom.document.activeElement, one(app.container, 'main'));
  await click(nav(app.container, 'Topics · BusinessLessons'));
  assert.equal(dom.document.activeElement, one(app.container, 'main'));
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
  await click(nav(m.container, 'Topics · BusinessLessons'));
  assert.equal(shown(m.container), 'Topics');
  await m.unmount();
});

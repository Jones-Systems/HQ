import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMIT_BL, PAGES, createSyntheticService } from '../fixtures/synthetic.ts';
import { dom } from './dom.ts';
import { all, byText, click, one, textOf } from './render.ts';
import { ERROR_CASES, deferred, launch, override, release, spy, trapEgress, validating } from './support.ts';

const PRICING = 'page/bl/lessons/pricing.md';
const field = (container: HTMLElement, name: string): string => textOf(one(container, `.wiki-reader [data-field="${name}"] dd`));

test('the reader shows namespace, path, commit provenance and ordinary fields', async () => {
  const app = await launch({ destination: PRICING });
  assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Pricing');
  assert.equal(field(app.container, 'repository'), 'BusinessLessons');
  assert.equal(field(app.container, 'path'), 'lessons/pricing.md');
  assert.equal(field(app.container, 'commit'), COMMIT_BL.slice(0, 12));
  assert.equal(one(app.container, '[data-field="commit"] code').getAttribute('title'), COMMIT_BL);
  assert.match(field(app.container, 'size'), /^\d+ bytes$/);

  const fields = (name: string): string => textOf(one(app.container, `.wiki-fields [data-field-name="${name}"] dd`));
  assert.equal(fields('title'), 'Pricing');
  assert.equal(fields('type'), 'lesson', 'record type is an ordinary field');
  assert.equal(fields('tags'), 'moneystrategy');
  assert.equal(all(app.container, '[data-field-name="tags"] li').length, 2);
  assert.equal(fields('reviewed'), 'true');
  assert.equal(fields('confidence'), '0.8');
  await app.unmount();
});

test('a parsed page renders every safe node type and nothing executable', async () => {
  const egress = trapEgress();
  const app = await launch({ destination: PRICING });
  const parsed = one(app.container, '[data-content="parsed"]');
  assert.deepEqual(all(parsed, 'h2, h3').map((node) => `${node.tagName}:${node.textContent}`), ['H2:Pricing', 'H3:Models', 'H3:Inert text']);
  assert.equal(all(parsed, 'ul > li').length, 3);
  assert.equal(textOf(one(parsed, 'strong')), 'Usage-based');
  assert.equal(textOf(one(parsed, 'em')), 'seat');
  assert.equal(textOf(one(parsed, 'code.wiki-inline-code')), 'floor');
  assert.equal(textOf(one(parsed, 'blockquote')), 'Price is what you pay; value is what you get.');
  assert.equal(one(parsed, 'pre.wiki-fence').getAttribute('data-lang'), 'ts');
  assert.equal(one(parsed, 'pre.wiki-fence code').textContent, 'const price = base * seats;\n');
  assert.deepEqual(all(parsed, 'thead th').map((cell) => cell.textContent), ['Plan', 'Seats']);
  assert.deepEqual(all(parsed, 'tbody tr').map((row) => all(row, 'td').map((cell) => cell.textContent)), [['Starter', '3'], ['Team', '10']]);
  assert.equal(one(parsed, 'tbody td:last-child').getAttribute('data-align'), 'right');

  // Script-looking text stays text.
  const inert = textOf(parsed);
  assert.ok(inert.includes('<script>window.__wikiPwned = true</script>'));
  assert.ok(inert.includes('[click me](javascript:window.__wikiPwned=true)'));
  assert.ok(inert.includes('<a href="https://evil.example/steal">visit</a>'));
  assert.equal(all(app.container, 'script, style, iframe, object, embed, img, svg, form[action], a, base, link, meta').filter((node) => node.tagName !== 'FORM').length, 0);
  assert.equal(all(app.container, '[href], [src], [srcdoc], [onerror], [onclick], [style]').length, 0, 'no destination attributes, handlers or inline styles');
  assert.equal((globalThis as Record<string, unknown>)['__wikiPwned'], undefined);
  assert.equal((dom as unknown as Record<string, unknown>)['__wikiPwned'], undefined);
  assert.deepEqual(egress.calls, []);
  egress.restore();
  await app.unmount();
});

test('page links are buttons that request a logical destination', async () => {
  const app = await launch({ destination: PRICING });
  const link = byText(app.container, '.wiki-parsed button[data-target="page"]', 'cash flow');
  assert.equal(link.tagName, 'BUTTON');
  assert.equal(link.getAttribute('type'), 'button');
  await click(link);
  assert.deepEqual(app.requested, ['page/bl/lessons/cash-flow.md']);
  assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Cash flow');
  await app.unmount();
});

test('missing targets are inert and visibly missing; external URLs are shown but never opened', async () => {
  const egress = trapEgress();
  const app = await launch({ destination: PRICING });
  const missing = byText(app.container, '.wiki-parsed [data-target="missing"]', 'Churn playbook');
  assert.equal(missing.tagName, 'SPAN');
  assert.equal(missing.getAttribute('title'), 'Missing target: Churn playbook');
  const external = one(app.container, '.wiki-parsed [data-target="external"]');
  assert.equal(external.tagName, 'SPAN');
  assert.equal(textOf(external), 'a pricing study (https://example.com/pricing-study?utm=wiki#results)');

  const before = app.shell();
  for (const target of [missing, external, one(external, '.wiki-external-url'), ...all(app.container, '.wiki-outlinks [data-target="missing"], .wiki-outlinks [data-target="external"]')]) await click(target);
  assert.equal(app.shell(), before);
  assert.deepEqual(app.requested, []);
  assert.deepEqual(egress.calls, [], 'no window.open, fetch or XHR');
  assert.equal(all(app.container, 'button').filter((button) => /Churn|pricing study/.test(button.textContent ?? '') && button.closest('.wiki-parsed')).length, 0);
  egress.restore();
  await app.unmount();
});

test('an ambiguous link opens disambiguation without a shell request, and back returns to the page', async () => {
  const app = await launch({ destination: PRICING });
  await click(byText(app.container, '.wiki-parsed button[data-target="ambiguous"]', 'Onboarding'));
  const panel = one(app.container, '.wiki-disambiguation');
  assert.match(textOf(panel), /“Onboarding” matches 2 pages/);
  assert.deepEqual(all(panel, 'button').map((button) => button.textContent), ['lessons/onboarding.mdBusinessLessons', 'guides/onboarding.mdBusinessLessons']);
  assert.deepEqual(app.requested, [], 'disambiguation has no destination form');

  await click(all(panel, 'button')[0]!);
  assert.deepEqual(app.requested, ['page/bl/lessons/onboarding.md']);
  assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Onboarding');

  await click(byText(app.container, '.wiki-nav button', '← Back'));
  assert.ok(app.container.querySelector('.wiki-disambiguation'), 'back lands on the disambiguation');
  await click(byText(app.container, '.wiki-nav button', '← Back'));
  assert.equal(textOf(one(app.container, '.wiki-page-title')), 'Pricing');
  await app.unmount();
});

test('out-links list every target kind', async () => {
  const app = await launch({ destination: PRICING });
  const links = one(app.container, '.wiki-outlinks');
  assert.match(textOf(one(links, 'h3')), /Links from this page \(4\)/);
  assert.deepEqual(all(links, 'li').map((item) => one(item, '[data-target]').getAttribute('data-target')), ['page', 'ambiguous', 'missing', 'external']);
  assert.match(textOf(links), /\(missing: Churn playbook\)/);
  assert.match(textOf(links), /2 candidates/);
  await click(one(links, 'button[data-target="ambiguous"]'));
  assert.ok(app.container.querySelector('.wiki-disambiguation'));
  await app.unmount();

  const none = await launch({ destination: 'page/bl/lessons/onboarding.md' });
  assert.match(textOf(one(none.container, '.wiki-outlinks')), /no outgoing links/);
  await none.unmount();
});

test('backlinks list who links here, by repository', async () => {
  const app = await launch({ destination: PRICING });
  const backlinks = one(app.container, '.wiki-backlinks');
  assert.deepEqual(all(backlinks, 'li').map((item) => textOf(one(item, 'button'))).sort(), ['Cash flowBusinessLessons', 'OnboardingBusinessLessons']);
  assert.match(textOf(backlinks), /2 pages link here\./);
  await click(byText(backlinks, 'button', 'Cash flowBusinessLessons'));
  assert.equal(app.shell(), 'page/bl/lessons/cash-flow.md');
  await app.unmount();

  const other = await launch({ destination: 'page/appdev/research/pricing.md' });
  const titles = all(other.container, '.wiki-backlinks li button').map((button) => textOf(button));
  assert.deepEqual(titles, ['NavigationApp Development'], 'a same-title page elsewhere has its own backlinks');
  await other.unmount();

  const none = await launch({ destination: 'page/bl/lessons/raw-frontmatter.md' });
  assert.match(textOf(one(none.container, '.wiki-backlinks')), /No page links here\./);
  await none.unmount();
});

test('truncated backlinks are labelled', async () => {
  const base = createSyntheticService();
  const target = PAGES[0]!.key;
  const app = await launch({
    destination: PRICING,
    service: override(base, {
      getBacklinks: () => Promise.resolve({ ok: true, value: { target, entries: [{ source: PAGES[2]!.key, title: 'Cash flow' }], total: 120, truncated: true } }),
    }),
  });
  assert.match(textOf(one(app.container, '.wiki-backlinks .wiki-summary')), /Showing 1 of 120 pages that link here\./);
  await app.unmount();
});

for (const [path, reason] of [
  ['lessons/raw-frontmatter.md', 'frontmatter-unsupported'],
  ['lessons/markdown-limits.md', 'markdown-unsupported'],
  ['lessons/binary-notes.md', 'not-text'],
] as const) {
  test(`raw page (${reason}) is shown verbatim in a pre block with its reason`, async () => {
    const egress = trapEgress();
    const app = await launch({ destination: `page/bl/${path}` });
    const raw = one(app.container, '[data-content="raw"]');
    assert.equal(raw.getAttribute('data-raw-reason'), reason);
    assert.match(textOf(one(raw, '.wiki-raw-note')), new RegExp(`Shown as raw text \\(${reason}\\)`));
    const expected = PAGES.find((page) => page.key.path === path)!.content;
    assert.ok(expected.state === 'raw');
    assert.equal(one(raw, 'pre.wiki-raw-text').textContent, expected.text, 'byte-for-byte verbatim');
    assert.equal(all(app.container, 'script, b, img').length, 0);
    assert.equal(all(raw, 'a, [href]').length, 0);
    assert.equal(all(app.container, '.wiki-parsed').length, 0);
    assert.deepEqual(egress.calls, []);
    egress.restore();
    await app.unmount();
  });
}

test('reader requests are logical keys the contract accepts, and only getPage and getBacklinks are used', async () => {
  const checked = validating(createSyntheticService());
  const { service, calls } = spy(checked.service);
  const app = await launch({ destination: PRICING, service });
  assert.deepEqual(calls.map((call) => call.method).sort(), ['getBacklinks', 'getPage']);
  assert.deepEqual(calls.find((call) => call.method === 'getPage')?.args, [{ key: { namespace: 'bl', path: 'lessons/pricing.md' } }]);
  assert.deepEqual(checked.rejected, []);
  await app.unmount();
});

test('reader loading and per-code errors; backlinks fail independently of the page', async () => {
  const base = createSyntheticService();
  const pending = deferred<Awaited<ReturnType<typeof base.getPage>>>();
  const slow = await launch({ destination: PRICING, service: override(base, { getPage: () => pending.promise }) });
  assert.equal(one(slow.container, '.wiki-reader [data-state="loading"]').textContent, 'Loading page…');
  assert.ok(slow.container.querySelector('.wiki-backlinks li'), 'backlinks do not wait for the page');
  await release(pending, await base.getPage({ key: PAGES[0]!.key }));
  assert.equal(textOf(one(slow.container, '.wiki-page-title')), 'Pricing');
  await slow.unmount();

  for (const { name, result, title } of ERROR_CASES) {
    const page = await launch({ destination: PRICING, service: override(base, { getPage: () => Promise.resolve(result) }) });
    const alert = byText(page.container, '.wiki-reader [role="alert"]', title);
    assert.equal(alert.getAttribute('data-reason'), result.error.reason, name);
    assert.equal(page.container.querySelector('.wiki-page-title'), null);
    assert.ok(page.container.querySelector('.wiki-backlinks li'), `${name}: backlinks still shown`);
    await page.unmount();

    const links = await launch({ destination: PRICING, service: override(base, { getBacklinks: () => Promise.resolve(result) }) });
    assert.match(textOf(one(links.container, '.wiki-backlinks [role="alert"]')), title);
    assert.equal(textOf(one(links.container, '.wiki-page-title')), 'Pricing', `${name}: page still shown`);
    await links.unmount();
  }
});

test('a response for a different page is rejected rather than shown', async () => {
  const base = createSyntheticService();
  const wrong = await base.getPage({ key: { namespace: 'bl', path: 'lessons/cash-flow.md' } });
  const app = await launch({ destination: PRICING, service: override(base, { getPage: () => Promise.resolve(wrong) }) });
  assert.match(textOf(one(app.container, '.wiki-reader [role="alert"]')), /different page than requested/);
  assert.equal(app.container.querySelector('.wiki-page-title'), null);
  await app.unmount();
});

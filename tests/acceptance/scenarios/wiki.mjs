import assert from 'node:assert/strict';
import { uiDriver } from './ui.mjs';

export async function wikiScenario(context) {
  context.begin('wiki-committed-corpus');
  const ui = uiDriver(context), wiki = context.fixtures.wiki;
  const key = { namespace: 'bl', path: 'guides/onboarding.md' };
  const read = (method, value) => ui.evaluate(`window.hqServices.wiki.${method}(${value === undefined ? '' : JSON.stringify(value)})`);
  const indexed = async () => context.until(async () => {
    const status = await read('indexStatus');
    return status.ok && ['bl', 'appdev'].every(namespace => status.value.namespaces.some(entry =>
      entry.namespace === namespace && entry.state === 'ready' && entry.source.commit === wiki.commits[namespace])) && status.value;
  }, 'committed synthetic Wiki indexes ready');
  await context.domain('Wiki');
  const status = await indexed();
  if (!await ui.evaluate(`!!document.querySelector('input[aria-label="Search the Wiki"]:not([hidden])') && !document.querySelector('#wiki-secondary-search')?.hidden`)) {
    await ui.click('Show Wiki search and filters');
  }
  assert.equal(await ui.evaluate(`(() => { const i = document.querySelector('input[aria-label="Search the Wiki"]'); if (!i) return false; i.focus(); return true; })()`), true);
  await context.cdp().send('Input.insertText', { text: 'Onboarding Guide' });
  await ui.click('Search', 'form.wiki-searchbar');
  await context.until(() => ui.evaluate(`!!document.querySelector('.wiki-search') && document.querySelector('.wiki-search').textContent.includes('Onboarding Guide')`), 'Wiki UI search result');
  await ui.click('Onboarding Guide', '.wiki-search .wiki-results');
  await context.until(() => ui.evaluate(`document.querySelector('.wiki-page-title')?.textContent === 'Onboarding Guide' && document.querySelector('[aria-label="Backlinks"]')?.textContent.includes('Synthetic Home')`), 'reader and committed backlinks');
  const page = await read('getPage', { key }), backlinks = await read('getBacklinks', { key });
  assert.equal(page.ok, true); assert.equal(backlinks.ok, true);
  assert.ok(backlinks.value.entries.some(entry => entry.source.namespace === 'bl' && entry.source.path === 'index.md'));
  await context.capture('wiki-committed-reader');
  try {
    await context.stopApp();
    await wiki.setAvailable('bl', false);
    await context.launchApp(); await context.domain('Wiki');
    await ui.click('Home', 'nav[aria-label="Wiki navigation"]');
    await context.until(async () => {
      const current = await read('indexStatus');
      return current.ok && current.value.namespaces.some(entry => entry.namespace === 'bl' && entry.state === 'unavailable') &&
        await ui.evaluate(`document.querySelector('[data-namespace="bl"] [data-index-state="unavailable"]')?.textContent === 'source unavailable'`);
    }, 'missing synthetic repository is unavailable');
    await context.capture('wiki-unavailable');
  } finally {
    // Restoration precedes runtime cleanup even if a native assertion fails.
    await wiki.setAvailable('bl', true);
  }
  await context.restartApp(); await context.domain('Wiki');
  await indexed();
  const recovered = await read('getPage', { key });
  assert.deepEqual(recovered, page);
  await ui.click('Home', 'nav[aria-label="Wiki navigation"]');
  await context.until(() => ui.evaluate(`document.querySelector('[data-namespace="bl"] [data-index-state="ready"]')?.textContent === 'index ready'`), 'recovered Wiki shown ready');
  await context.capture('wiki-recovered');
  context.passed({ commits: wiki.commits, pages: status.namespaces.map(entry => ({ namespace: entry.namespace, count: entry.pageCount })),
    backlinks: backlinks.value.total, recovery: 'same committed page after repository restoration and process restart',
    limitation: 'Committed synthetic corpus only; no private-source or remote freshness claim.' });
}

// The top-bar search field (an ARIA 1.2 combobox) and the live results page. The debounces run on a fake clock so the
// 150 ms, 200 ms and 600 ms behaviour is asserted exactly.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSyntheticService } from '../fixtures/synthetic.ts';
import { dom } from './dom.ts';
import { fakeClock, flush, historyLabels, options, press, resultsInput, searchInput, tap } from './chrome.ts';
import { one, textOf, typeInto } from './render.ts';
import { launch, spy, validating, type Launched } from './support.ts';

const searchCalls = (calls: ReturnType<typeof spy>['calls']): unknown[] => calls.filter((call) => call.method === 'search').map((call) => call.args[0]);
const kinds = (container: HTMLElement): (string | null)[] => options(container).map((item) => item.getAttribute('data-kind'));

/** Types into the top-bar field and lets the 150 ms pause pass. */
async function suggest(app: Launched, clock: ReturnType<typeof fakeClock>, text: string): Promise<void> {
  await typeInto(searchInput(app.container), text);
  await clock.advance(150);
}

test('suggestions wait for a pause, ask once for the final text, and never for blank or invalid input', async () => {
  const checked = validating(createSyntheticService());
  const { service, calls } = spy(checked.service);
  const app = await launch({ service });
  const clock = fakeClock();
  try {
    await typeInto(searchInput(app.container), 'pr');
    await clock.advance(100);
    await typeInto(searchInput(app.container), 'pri');
    await clock.advance(149);
    assert.deepEqual(searchCalls(calls), [], 'less than 150 ms since the last key: nothing is asked');
    await clock.advance(1);
    assert.deepEqual(searchCalls(calls), [{ query: 'pri' }], 'one request, for the final text only');
    assert.deepEqual(app.requested, [], 'suggesting is not navigating');

    const before = calls.length;
    for (const refused of ['     ', '\t \n', 'bad\u0007query', '\u0000']) {
      await typeInto(searchInput(app.container), refused);
      await clock.advance(1000);
      assert.equal(options(app.container).length, 0, `no suggestions for ${JSON.stringify(refused)}`);
      assert.equal(searchInput(app.container).getAttribute('aria-expanded'), 'false');
    }
    assert.equal(calls.length, before, 'blank and control-character text reach the service never');
    assert.deepEqual(checked.rejected, [], 'every request that was made passes the contract validators');
  } finally {
    clock.restore();
    await app.unmount();
  }
});

test('the suggestion list is Go to matches, then hits, then Search all, with the combobox attributes', async () => {
  const app = await launch();
  const clock = fakeClock();
  try {
    const field = searchInput(app.container);
    assert.equal(field.getAttribute('role'), 'combobox');
    assert.equal(field.getAttribute('aria-autocomplete'), 'list');
    assert.equal(field.getAttribute('aria-expanded'), 'false');

    await suggest(app, clock, 'pricing');
    assert.equal(field.getAttribute('aria-expanded'), 'true');
    const list = one(app.container, '[role="listbox"]');
    assert.equal(field.getAttribute('aria-controls'), list.id);
    assert.equal(field.hasAttribute('aria-activedescendant'), false, 'nothing is active until an arrow key');

    const rows = options(app.container);
    const order = kinds(app.container);
    assert.deepEqual(order.slice(0, 2), ['goto', 'goto'], 'the exact name matches come first, one per repository');
    assert.equal(order.at(-1), 'all', 'Search all pages is always last');
    assert.ok(order.slice(2, -1).length > 0 && order.slice(2, -1).every((kind) => kind === 'hit'));
    assert.deepEqual(rows.slice(0, 2).map((row) => textOf(one(row, '.wiki-ns'))), ['BusinessLessons', 'App Development']);
    assert.ok(rows.every((row) => row.id !== '' && row.getAttribute('aria-selected') === 'false'));
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'option ids are unique');
    assert.equal(textOf(one(rows.at(-1)!, '.wiki-suggest-title')), 'Search all pages for “pricing”');
    const hitTitles = rows.filter((row) => row.getAttribute('data-kind') === 'hit').map((row) => `${textOf(one(row, '.wiki-suggest-title'))}|${textOf(one(row, '.wiki-ns'))}`);
    const gotoTitles = rows.filter((row) => row.getAttribute('data-kind') === 'goto').map((row) => `${textOf(one(row, '.wiki-suggest-title'))}|${textOf(one(row, '.wiki-ns'))}`);
    assert.deepEqual(hitTitles.filter((title) => gotoTitles.includes(title)), [], 'a page already offered as Go to is not repeated as a hit');
  } finally {
    clock.restore();
    await app.unmount();
  }
});

test('combobox keys: arrows move and wrap, Enter opens the active option, Enter alone and Ctrl+Enter search, Escape closes then clears', async () => {
  const app = await launch();
  const clock = fakeClock();
  try {
    const field = searchInput(app.container);
    field.focus();
    await suggest(app, clock, 'pricing');
    const count = options(app.container).length;
    const selected = (): number => options(app.container).findIndex((row) => row.getAttribute('aria-selected') === 'true');

    assert.equal(dom.document.activeElement === (field as unknown), true, 'keyboard navigation starts in this search field');
    await press(field, 'ArrowDown');
    assert.equal(selected(), 0);
    assert.equal(field.getAttribute('aria-activedescendant'), options(app.container)[0]!.id, 'focus stays in the field; the active option is announced by id');
    assert.equal(dom.document.activeElement === (field as unknown), true, 'ArrowDown preserves focus in the same search field');
    await press(field, 'ArrowUp');
    assert.equal(selected(), count - 1, 'Up from the first option wraps to the last');
    await press(field, 'ArrowDown');
    assert.equal(selected(), 0, 'Down from the last wraps to the first');
    await press(field, 'ArrowDown');
    assert.equal(selected(), 1);

    // Ctrl+Enter always runs the full search, even with an option active.
    const allowed = await press(field, 'Enter', { ctrlKey: true });
    assert.equal(allowed, false, 'Enter is handled, not left to submit a form twice');
    assert.deepEqual(app.requested, ['search?q=pricing']);
    assert.equal(options(app.container).length, 0, 'running a search closes the list');
  } finally {
    clock.restore();
    await app.unmount();
  }

  const second = await launch();
  const timers = fakeClock();
  try {
    const field = searchInput(second.container);
    await suggest(second, timers, 'pricing');
    await press(field, 'ArrowDown');
    await press(field, 'Enter');
    assert.deepEqual(second.requested, ['page/bl/lessons/pricing.md'], 'Enter on an active Go to option opens that page');
    assert.equal(options(second.container).length, 0);
  } finally {
    timers.restore();
    await second.unmount();
  }

  const third = await launch();
  const more = fakeClock();
  try {
    const field = searchInput(third.container);
    await suggest(third, more, 'pricing');
    await press(field, 'Enter');
    assert.deepEqual(third.requested, ['search?q=pricing'], 'Enter with nothing active runs the full search');
  } finally {
    more.restore();
    await third.unmount();
  }

  const fourth = await launch();
  const last = fakeClock();
  try {
    const field = searchInput(fourth.container);
    await suggest(fourth, last, 'pricing');
    assert.equal(options(fourth.container).length > 0, true);
    await press(field, 'Escape');
    assert.equal(options(fourth.container).length, 0, 'the first Escape closes the list');
    assert.equal(field.value, 'pricing', 'and keeps what was typed');
    assert.equal(field.getAttribute('aria-expanded'), 'false');
    await press(field, 'Escape');
    assert.equal(searchInput(fourth.container).value, '', 'the second Escape clears the field');
    assert.deepEqual(fourth.requested, []);
  } finally {
    last.restore();
    await fourth.unmount();
  }
});

test('choosing a suggestion with the pointer works and does not blur the field first', async () => {
  const app = await launch();
  const clock = fakeClock();
  try {
    await suggest(app, clock, 'pricing');
    const row = options(app.container)[1]!;
    const down = new dom.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    row.dispatchEvent(down as unknown as Event);
    assert.equal(down.defaultPrevented, true, 'mousedown on an option is cancelled so the field keeps focus until the click');
    await tap(row);
    assert.deepEqual(app.requested, ['page/appdev/research/pricing.md']);
    assert.equal(options(app.container).length, 0);
  } finally {
    clock.restore();
    await app.unmount();
  }
});

test('submitting a blank or invalid query shows the problem and requests nothing', async () => {
  const { service, calls } = spy();
  const app = await launch({ service });
  const clock = fakeClock();
  try {
    await typeInto(searchInput(app.container), '   ');
    await press(searchInput(app.container), 'Enter');
    assert.match(textOf(one(app.container, '.wiki-field-problem')), /Enter something to search for\./);
    assert.equal(one(app.container, '.wiki-field-problem').getAttribute('role'), 'alert');
    await typeInto(searchInput(app.container), 'bad\u0007');
    await press(searchInput(app.container), 'Enter');
    assert.match(textOf(one(app.container, '.wiki-field-problem')), /not valid \(control-character\)/);
    await clock.advance(2000);
    assert.deepEqual(app.requested, []);
    assert.deepEqual(searchCalls(calls), []);
  } finally {
    clock.restore();
    await app.unmount();
  }
});

test('on the results page typing updates the results after 200 ms and replaces the entry after 600 ms idle, never adding history', async () => {
  const { service, calls } = spy();
  const app = await launch({ service, destination: 'search?q=pricing' });
  const clock = fakeClock();
  try {
    assert.deepEqual(await historyLabels(app.container), ['Search “pricing”']);
    for (const text of ['c', 'ca', 'cas']) {
      await typeInto(resultsInput(app.container), text);
      await clock.advance(100);
    }
    await typeInto(resultsInput(app.container), 'cash');
    assert.equal(searchInput(app.container).value, 'cash', 'the top-bar field shows the same text');
    assert.deepEqual(app.requested, [], 'still typing: the shell has been asked for nothing');
    assert.equal(textOf(one(app.container, 'h1')), 'Results for “pricing”', 'and the results have not moved yet');

    await clock.advance(199);
    assert.equal(textOf(one(app.container, 'h1')), 'Results for “pricing”');
    await clock.advance(1);
    assert.equal(textOf(one(app.container, 'h1')), 'Results for “cash”', 'the results follow 200 ms after the last key');
    assert.deepEqual(searchCalls(calls), [{ query: 'pricing' }, { query: 'cash' }], 'half-typed words were never searched');
    assert.deepEqual(app.requested, []);

    await clock.advance(399);
    assert.deepEqual(app.requested, [], 'not yet 600 ms idle');
    await clock.advance(1);
    assert.deepEqual(app.requested, ['search?q=cash'], 'one request that replaces the entry');
    assert.equal(app.shell(), 'search?q=cash');
    assert.deepEqual(await historyLabels(app.container), ['Search “cash”'], 'still one entry: typing never fills history');
    assert.equal(one(app.container, 'button[aria-label="Back"]').hasAttribute('disabled'), true);
    assert.deepEqual(searchCalls(calls), [{ query: 'pricing' }, { query: 'cash' }], 'recording the destination asks the service for nothing more');
  } finally {
    clock.restore();
    await app.unmount();
  }
});

test('Enter on the results page commits at once; Back after typing goes to what came before the search', async () => {
  const app = await launch();
  const clock = fakeClock();
  try {
    await typeInto(searchInput(app.container), 'pricing');
    await press(searchInput(app.container), 'Enter');
    assert.deepEqual(app.requested, ['search?q=pricing']);
    await flush();
    assert.deepEqual(await historyLabels(app.container), ['Search “pricing”', 'Home']);

    await typeInto(resultsInput(app.container), 'cash flow');
    await press(resultsInput(app.container), 'Enter');
    assert.deepEqual(app.requested, ['search?q=pricing', 'search?q=cash flow'], 'Enter does not wait for the idle timer');
    assert.deepEqual(await historyLabels(app.container), ['Search “cash flow”', 'Home'], 'and replaces rather than adds');

    await tap(one(app.container, 'button[aria-label="Back"]'));
    assert.equal(one(app.container, 'main').firstElementChild?.getAttribute('aria-label'), 'Home', 'Back skips every keystroke and the replaced search');
    assert.equal(searchInput(app.container).value, '', 'and the field empties with it');
  } finally {
    clock.restore();
    await app.unmount();
  }
});

test('the results page ArrowDown moves from the field to the first hit and ArrowUp returns', async () => {
  const app = await launch({ destination: 'search?q=pricing' });
  await press(resultsInput(app.container), 'ArrowDown');
  const first = one(app.container, '.wiki-hit-title');
  assert.equal(dom.document.activeElement, first as unknown);
  await press(first, 'ArrowDown');
  assert.notEqual(dom.document.activeElement, first as unknown);
  await press(dom.document.activeElement as unknown as Element, 'Home');
  assert.equal(dom.document.activeElement, first as unknown);
  await press(first, 'ArrowUp');
  assert.equal(dom.document.activeElement, resultsInput(app.container) as unknown);
  await app.unmount();
});

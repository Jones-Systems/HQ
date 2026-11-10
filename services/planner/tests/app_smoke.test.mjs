// Boot the real app shell against the fake DOM with a stubbed fetch, then
// walk every route. Checks wiring (imports, shell, render loop, request
// headers) rather than visuals; no server, socket or browser is involved.

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from './fake_dom.mjs';

const doc = installFakeDom();
for (const id of ['sidebar', 'topbar', 'banner', 'filter-chips', 'main', 'detail', 'tabbar', 'fab', 'toasts', 'live-region']) {
  const el = doc.createElement(id === 'main' ? 'main' : 'div');
  el.id = id;
  doc.body.append(el);
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
// The app's background sync/midnight timers would keep this process alive.
globalThis.setInterval = () => 0;
globalThis.history = { pushState: (_, __, h) => { location.hash = h; }, replaceState: (_, __, h) => { location.hash = h; } };
const windowListeners = {};
globalThis.window.addEventListener = (type, fn) => { (windowListeners[type] ||= []).push(fn); };
const documentListeners = {};
doc.addEventListener = (type, fn) => { (documentListeners[type] ||= []).push(fn); };

const requests = [];
const snapshot = {
  items: [{
    id: 'item000001', revision: 1, title: 'Plan garden', kind: 'project', status: 'next', motivation: 'want', horizon: 'soon',
    priority: null, area: 'Home', notes: '', next_steps: [], references: [], position: 1024, is_example: false,
    dates: [{ id: 'date000001', kind: 'target', precision: 'month', value: '2027-03', time: null, end_time: null, tz: null, note: '' }],
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', archived_at: null, reviewed_at: null,
  }],
  settings: { default_tz: 'America/New_York', week_start: 'sun', stale_days: 21 },
  state_version: 3,
  server_time: '2026-10-10T00:00:00.000Z',
};
globalThis.fetch = async (path, init) => {
  requests.push({ path, init });
  const body = path === '/api/version' ? { state_version: 3 } : snapshot;
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
};

const settle = () => new Promise((r) => setTimeout(r, 20));
const textOf = (el) => (el.childNodes || []).map((c) => (c.data !== undefined ? c.data : textOf(c))).join(' ');

await import('../public/js/app.js');
await settle();

test('shell loads state and renders the glance', () => {
  assert.equal(requests[0].path, '/api/state');
  assert.equal(requests[0].init.method, 'GET');
  const main = doc.getElementById('main');
  assert.ok(textOf(main).includes('Plan garden'));
  assert.ok(textOf(doc.getElementById('sidebar')).includes('Board'));
});

test('shell clock and glance date use the Eastern display zone', async () => {
  const { formatLongDay, todayISO } = await import('../public/js/dates.js');
  const sync = textOf(doc.getElementById('sync-status'));
  assert.match(sync, /Synced · \d{1,2}:\d{2} [AP]M E[DS]T/);
  const glanceDate = textOf(doc.querySelector('.glance-date'));
  const possible = [todayISO(new Date(Date.now() - 60000)), todayISO()].map(formatLongDay);
  assert.ok(possible.includes(glanceDate.trim()), glanceDate);
});

test('every route renders, including an open item', async () => {
  const main = doc.getElementById('main');
  for (const view of ['board', 'list', 'calendar', 'timeline', 'review', 'archive', 'glance']) {
    location.hash = `#/${view}`;
    windowListeners.hashchange.forEach((fn) => fn());
    await settle();
    assert.equal(main.getAttribute('data-view'), view);
    assert.ok(main.childNodes.length, `${view} rendered`);
  }
  location.hash = '#/board?item=item000001';
  windowListeners.hashchange.forEach((fn) => fn());
  await settle();
  const detail = doc.getElementById('detail');
  assert.equal(detail.hidden, false);
  assert.ok(textOf(detail).includes('March'));
});

// ------------------------------------------------- HQR-A6 regressions

const go = async (hash) => {
  location.hash = hash;
  windowListeners.hashchange.forEach((fn) => fn());
  await settle();
};
const key = (k, extra = {}) => documentListeners.keydown.forEach((fn) => fn({
  key: k, target: doc.body, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra,
}));

test('the phone More tab uses the more icon, not the help fallback', async () => {
  const { icon } = await import('../public/js/dom.js');
  const more = doc.getElementById('tabbar').children.at(-1);
  const d = more.querySelector('path').getAttribute('d');
  assert.equal(d, icon('more').querySelector('path').getAttribute('d'));
  assert.notEqual(d, icon('help').querySelector('path').getAttribute('d'));
});

test('Escape already handled by a menu does not also close the item', async () => {
  await go('#/board?item=item000001');
  const detail = doc.getElementById('detail');
  assert.equal(detail.hidden, false);
  key('Escape', { defaultPrevented: true });
  await settle();
  assert.equal(detail.hidden, false, 'still open');
  key('Escape');
  await settle();
  assert.equal(detail.hidden, true, 'a plain Escape closes it');
});

test('closing the item returns focus to the control that opened it', async () => {
  await go('#/glance');
  const main = doc.getElementById('main');
  const row = main.querySelectorAll('.row')[0];
  const rowKey = row.dataset.focusKey;
  row.focus();
  row.listeners.click.forEach((fn) => fn({ currentTarget: row, target: row }));
  await settle();
  assert.equal(doc.getElementById('detail').hidden, false);
  doc.activeElement = doc.getElementById('detail');
  key('Escape', { target: doc.getElementById('detail') });
  await settle();
  assert.equal(doc.activeElement.dataset.focusKey, rowKey);
  assert.ok(main.contains(doc.activeElement), 'the re-rendered row, not the old one');
});

test('a re-render that removes the focused control keeps focus in main', async () => {
  await go('#/glance');
  const main = doc.getElementById('main');
  const orphan = doc.createElement('button');
  main.firstChild.append(orphan);
  orphan.focus();
  await go('#/board');
  assert.equal(doc.activeElement, main);
});

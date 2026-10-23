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

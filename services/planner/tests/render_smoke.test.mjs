// Render every view and the detail panel against a fake DOM with a varied
// store, catching runtime errors and checking a few load-bearing outputs
// (owner text stays text, example badges, unscheduled tray, no invented
// days). This is not a substitute for real browser checks.

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from './fake_dom.mjs';

installFakeDom();

const { state } = await import('../public/js/state.js');
const { addDays, todayISO } = await import('../public/js/dates.js');
const views = {
  glance: (await import('../public/js/views/glance.js')).renderGlance,
  board: (await import('../public/js/views/board.js')).renderBoard,
  list: (await import('../public/js/views/list.js')).renderList,
  calendar: (await import('../public/js/views/calendar.js')).renderCalendar,
  timeline: (await import('../public/js/views/timeline.js')).renderTimeline,
  review: (await import('../public/js/views/review.js')).renderReview,
  archive: (await import('../public/js/views/archive.js')).renderArchive,
};
const { mountDetail, renderDetail } = await import('../public/js/detail.js');

const today = todayISO();
const stamp = '2026-01-01T00:00:00.000Z';
let n = 0;
function item(fields) {
  n += 1;
  return {
    id: `item${String(n).padStart(4, '0')}`, revision: 1, title: `Item ${n}`, kind: 'idea', status: 'inbox',
    motivation: null, horizon: null, priority: null, area: null, notes: '', next_steps: [], references: [], dates: [],
    position: n * 1024, is_example: false, created_at: stamp, updated_at: stamp, archived_at: null, reviewed_at: null,
    ...fields,
  };
}

const XSS = '<img src=x onerror=alert(1)>';
state.items = [
  item({ title: XSS, status: 'inbox', area: 'Home', motivation: 'want' }),
  item({ title: 'Passport', status: 'active', kind: 'chore', motivation: 'need', horizon: 'now', priority: 'high',
    next_steps: [{ id: 'step01', text: 'Photos', done: true }, { id: 'step02', text: 'Form', done: false }],
    dates: [{ id: 'date01', kind: 'deadline', precision: 'day', value: addDays(today, -2), time: null, end_time: null, tz: null, note: '' }] }),
  item({ title: 'Dentist', status: 'next', horizon: 'soon', dates: [{ id: 'date02', kind: 'event', precision: 'day', value: addDays(today, 3),
    time: '09:30', end_time: '10:00', tz: 'America/New_York', note: 'cleaning', instant: '2026-11-14T14:30:00Z', tz_abbr: 'EST' }] }),
  item({ title: 'Sail', status: 'considering', kind: 'goal', horizon: 'later', motivation: 'exploring',
    dates: [{ id: 'date03', kind: 'target', precision: 'quarter', value: `${Number(today.slice(0, 4)) + 1}-Q2`, time: null, end_time: null, tz: null, note: '' },
      { id: 'date04', kind: 'start', precision: 'month', value: today.slice(0, 7), time: null, end_time: null, tz: null, note: '' }] }),
  item({ title: 'Week thing', status: 'on_hold', dates: [{ id: 'date05', kind: 'target', precision: 'week', value: '2026-W46', time: null, end_time: null, tz: null, note: '' }] }),
  item({ title: 'Book', status: 'done', is_example: true, references: [{ id: 'ref001', kind: 'url', label: 'Site', url: 'https://example.com/x' }] }),
  item({ title: 'Old', status: 'dropped', archived_at: stamp }),
];
state.byId = new Map(state.items.map((it) => [it.id, it]));
state.phase = 'ready';

const filters = { q: '', area: '', motivation: '', horizon: '', kind: '', priority: '' };
const ctx = {
  today, filters, view: () => 'board', go() {}, openItem() {}, closeItem() {}, rerender() {}, keepFocus() {},
  openCapture() {}, openMoveMenu() {}, loadExamples() {}, draftsPanel: () => document.createElement('div'),
};

function texts(el, out = []) {
  for (const c of el.childNodes) {
    if (c.data !== undefined) out.push(c.data); else texts(c, out);
  }
  return out;
}

for (const [name, render] of Object.entries(views)) {
  test(`${name} view renders`, () => {
    const root = document.createElement('div');
    render(root, ctx);
    assert.ok(root.childNodes.length > 0, `${name} produced output`);
    // Owner text is present only as a text node, never parsed into elements.
    assert.equal(root.querySelectorAll('img').length, 0);
  });
}

test('board shows statuses, the example badge and owner text as text', () => {
  const root = document.createElement('div');
  views.board(root, ctx);
  assert.equal(root.querySelectorAll('.column').length, 7);
  const all = texts(root);
  assert.ok(all.includes(XSS));
  assert.ok(all.includes('Example'));
});

test('calendar keeps coarse dates out of day cells and lists unscheduled items', () => {
  const root = document.createElement('div');
  views.calendar(root, ctx);
  const dayChips = root.querySelectorAll('.day-chips').flatMap((d) => d.querySelectorAll('.cal-chip'));
  assert.ok(dayChips.every((c) => !texts(c).includes('Sail')), 'quarter/month dates are not pinned to a day');
  const tray = root.querySelector('.tray');
  assert.ok(texts(tray).includes(XSS));
});

test('detail panel renders a timed event with its zone', () => {
  const panel = document.createElement('aside');
  document.body.append(panel);
  mountDetail(panel, ctx);
  renderDetail(state.items[2].id, ctx);
  assert.equal(panel.hidden, false);
  assert.ok(texts(panel).some((t) => t.includes('America/New_York')));
});

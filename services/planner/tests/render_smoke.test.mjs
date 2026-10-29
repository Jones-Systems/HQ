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

// ------------------------------------------------- HQR-A6 regressions

const { describeHistory } = await import('../public/js/detail.js');
const { calendarGoTo } = await import('../public/js/views/calendar.js');

function withItems(extra, fn) {
  const saved = state.items;
  state.items = [...saved, ...extra];
  state.byId = new Map(state.items.map((it) => [it.id, it]));
  try { return fn(); } finally {
    state.items = saved;
    state.byId = new Map(saved.map((it) => [it.id, it]));
  }
}

const fire = (el, type, event) => (el.listeners[type] || []).forEach((fn) => fn({ target: el, currentTarget: el, ...event }));

test('detail panel opens for a stored URL that the browser cannot parse', () => {
  const odd = item({ title: 'Odd port', references: [{ id: 'ref002', kind: 'url', label: 'Port', url: 'http://example.com:abc/' }] });
  withItems([odd], () => {
    const panel = document.createElement('aside');
    document.body.append(panel);
    mountDetail(panel, ctx);
    renderDetail(odd.id, ctx);
    assert.equal(panel.hidden, false);
    assert.ok(texts(panel).includes('Port'));
    assert.equal(panel.querySelectorAll('.ref-url').length, 0);
  });
});

test('history descriptions tolerate imported detail of any shape', () => {
  assert.equal(describeHistory({ action: 'updated', detail: { changes: { title: 'x', horizon: ['now', 'soon'] }, fields: 'title' } }), 'horizon → soon');
  assert.equal(describeHistory({ action: 'updated', detail: { changes: null, fields: [3], dates: ['Added target'] } }), 'edited 3; Added target');
  assert.equal(describeHistory({ action: 'updated', detail: 'free text' }), 'Updated');
});

test('focused controls carry focus keys so a re-render can restore them', () => {
  const list = document.createElement('div');
  views.list(list, ctx);
  assert.ok(list.querySelectorAll('select').every((s) => s.dataset.focusKey), 'list selects');
  assert.ok(list.querySelectorAll('.th-sort').every((b) => b.dataset.focusKey), 'sort headers');
  const cal = document.createElement('div');
  views.calendar(cal, ctx);
  for (const key of ['cal-prev', 'cal-today', 'cal-next', 'cal-mode:month', 'cal-finished']) {
    assert.ok(cal.querySelector(`[data-focus-key="${key}"]`), key);
  }
  const glance = document.createElement('div');
  views.glance(glance, ctx);
  const keys = glance.querySelectorAll('.row').map((r) => r.dataset.focusKey);
  assert.equal(new Set(keys).size, keys.length, 'glance rows have unique focus keys');
});

test('Enter on an unscheduled item title opens it instead of scheduling', () => {
  const root = document.createElement('div');
  views.calendar(root, ctx);
  const row = root.querySelector('.tray-item');
  assert.equal(row.getAttribute('role'), 'group');
  const title = row.querySelector('.tray-title');
  let prevented = false;
  fire(row, 'keydown', { key: 'Enter', target: title, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('agenda keeps a day date and a week date that start the same day apart', () => {
  const day = item({ title: 'Monday thing', status: 'next', dates: [{ id: 'date09', kind: 'target', precision: 'day', value: '2026-11-09', time: null, end_time: null, tz: null, note: '' }] });
  withItems([day], () => {
    const pick = (mode) => {
      const probe = document.createElement('div');
      views.calendar(probe, ctx);
      fire(probe.querySelector(`[data-focus-key="cal-mode:${mode}"]`), 'click', {});
    };
    pick('agenda');
    calendarGoTo('2026-11-01');
    try {
      const root = document.createElement('div');
      views.calendar(root, ctx);
      const nov9 = root.querySelectorAll('.agenda-day-group').filter((g) => g.dataset.day === '2026-11-09');
      assert.equal(nov9.length, 2);
      assert.equal(nov9[0].dataset.drop, 'cal-day', 'the day group stays a drop target');
      assert.ok(texts(nov9[0]).includes('Monday thing'));
      assert.ok(texts(nov9[1]).includes('Week thing'));
    } finally {
      pick('month');
      calendarGoTo(today);
    }
  });
});

test('board keeps collapsed columns renderable and uses pressed buttons for phone columns', () => {
  const root = document.createElement('div');
  views.board(root, ctx);
  const dropped = root.querySelector('.column.st-dropped');
  assert.ok(dropped.classList.contains('is-collapsed'));
  assert.ok(dropped.querySelector('.col-list'), 'list exists for the one-column phone layout');
  const tabs = root.querySelectorAll('.status-tab');
  assert.ok(tabs.every((t) => t.getAttribute('role') === null && t.getAttribute('aria-pressed') !== null));
});

test('timeline draws a bar from a start only to a later target or deadline', () => {
  const y = Number(today.slice(0, 4));
  const evented = item({ title: 'Start then event', status: 'next', horizon: 'soon', dates: [
    { id: 'date10', kind: 'start', precision: 'day', value: today, time: null, end_time: null, tz: null, note: '' },
    { id: 'date11', kind: 'event', precision: 'day', value: `${y + 1}-01-15`, time: null, end_time: null, tz: null, note: '' }] });
  withItems([evented], () => {
    const root = document.createElement('div');
    views.timeline(root, ctx);
    const labels = root.querySelectorAll('.tl-label');
    const row = labels.find((l) => l.dataset.id === evented.id).parentElement;
    assert.equal(row.querySelectorAll('.tl-span').length, 0);
    const sail = labels.find((l) => texts(l).includes('Sail')).parentElement;
    assert.equal(sail.querySelectorAll('.tl-span').length, 1);
  });
});

test('glance says so when filters leave nothing recently changed', () => {
  const root = document.createElement('div');
  views.glance(root, { ...ctx, filters: { ...filters, q: 'no-such-item-anywhere' } });
  assert.ok(texts(root.querySelector('.panel-recent')).includes('Nothing matches the filters.'));
});

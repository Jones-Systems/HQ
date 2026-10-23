// Application shell: routing, render loop, filters, capture, Move-to menu,
// data & settings, shortcuts and connection status.

import { canUndo, createItem, moveItem, reportError, saveSettings, setArchived, undoLast } from './actions.js';
import { api } from './api.js';
import { DATE_KINDS, KIND_LABEL, formatClock, formatStamp } from './dates.js';
import { closeDetailPanel, detailOpenId, mountDetail, renderDetail } from './detail.js';
import { button, clear, h, icon, isTypingTarget, uid } from './dom.js';
import { initDrag, isDragging } from './drag.js';
import {
  EMPTY_FILTERS, HORIZONS, KINDS, MOTIVATIONS, PRIORITIES, STATUSES, STATUS_LABEL, activeFilterCount, areasOf,
  isLive, isOpen, reviewBuckets,
} from './model.js';
import { sortByPosition, stepAnchors } from './ordering.js';
import {
  addDraft, checkServer, discardDraft, displayToday, displayZone, load, mutate, sendDraft, setReconnectHandler, startSync,
  state, subscribe,
} from './state.js';
import { confirmDialog, field, openDialog, openMenu, segmented, selectControl, toast } from './ui.js';
import { renderArchive } from './views/archive.js';
import { renderBoard, setBoardFilters, showColumn, visibleColumn } from './views/board.js';
import { calendarKey, renderCalendar } from './views/calendar.js';
import { renderGlance } from './views/glance.js';
import { renderList } from './views/list.js';
import { renderReview } from './views/review.js';
import { renderTimeline } from './views/timeline.js';

const VIEWS = [
  { id: 'glance', label: 'Glance', icon: 'glance', render: renderGlance, key: '1' },
  { id: 'board', label: 'Board', icon: 'board', render: renderBoard, key: '2' },
  { id: 'list', label: 'List', icon: 'list', render: renderList, key: '3' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', render: renderCalendar, key: '4' },
  { id: 'timeline', label: 'Timeline', icon: 'timeline', render: renderTimeline, key: '5' },
  { id: 'review', label: 'Review', icon: 'review', render: renderReview, key: '6' },
  { id: 'archive', label: 'Archive', icon: 'archive', render: renderArchive, key: '7' },
];
const VIEW_BY_ID = Object.fromEntries(VIEWS.map((v) => [v.id, v]));
const FILTER_KEYS = ['q', 'area', 'motivation', 'horizon', 'kind', 'priority'];
const THEME_KEY = 'planning.theme';

const route = { view: 'glance', item: null, filters: { ...EMPTY_FILTERS } };
let pendingFocusKey = null;
let renderQueued = false;
let renderDeferred = false;

// ---------------------------------------------------------------- routing

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  route.view = VIEW_BY_ID[path] ? path : 'glance';
  route.item = params.get('item');
  route.filters = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) route.filters[key] = params.get(key) || '';
}

function hashFor(view, { item = route.item, filters = route.filters } = {}) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) if (filters[key]) params.set(key, filters[key]);
  if (item) params.set('item', item);
  const q = params.toString();
  return `#/${view}${q ? `?${q}` : ''}`;
}

function navigate(hash, { replace = false } = {}) {
  if (location.hash === hash) return;
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  parseHash();
  scheduleRender();
}

const ctx = {
  get today() { return displayToday(); },
  get filters() { return route.filters; },
  view: () => route.view,
  go(view, extra = {}) {
    if (extra.column) showColumn(extra.column);
    navigate(hashFor(view, { item: null }));
    document.getElementById('main')?.focus({ preventScroll: true });
  },
  openItem(id) { navigate(hashFor(route.view, { item: id })); },
  closeItem() {
    const id = route.item;
    navigate(hashFor(route.view, { item: null }));
    if (id) pendingFocusKey = `card:${id}`;
  },
  rerender: () => scheduleRender(),
  keepFocus(key) { pendingFocusKey = key; },
  openCapture: (defaults) => openCapture(defaults),
  openMoveMenu: (item, anchor) => openMoveMenu(item, anchor),
  loadExamples: () => loadExamples(),
  draftsPanel: () => draftsPanel(),
};

function setFilters(next, { replace = true } = {}) {
  navigate(hashFor(route.view, { filters: { ...route.filters, ...next } }), { replace });
}

// ------------------------------------------------------------------ shell

function buildShell() {
  const sidebar = document.getElementById('sidebar');
  sidebar.append(
    h('div', { class: 'brand' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      h('div', { class: 'brand-text' }, h('strong', { text: 'Planning' }), h('span', { text: 'Projects · ideas · goals' }))),
    button('New item', { icon: 'plus', kind: 'primary', onClick: () => openCapture({}), attrs: { class: 'btn btn-primary btn-new', title: 'New item (N)' } }),
    h('nav', { class: 'nav', 'aria-label': 'Views', id: 'nav' }),
    h('div', { class: 'sidebar-foot' },
      h('div', { class: 'sync', id: 'sync-status', role: 'status' }),
      h('div', { class: 'sidebar-tools' },
        button('Data & settings', { icon: 'data', kind: 'ghost', onClick: openDataDialog }),
        button('Theme', { icon: 'moon', iconOnly: true, kind: 'ghost', onClick: cycleTheme, attrs: { id: 'theme-toggle' } }),
        button('Keyboard shortcuts', { icon: 'keyboard', iconOnly: true, kind: 'ghost', onClick: openShortcuts }))),
  );

  const topbar = document.getElementById('topbar');
  const search = h('input', {
    type: 'search', class: 'search-input', id: 'search', placeholder: 'Search titles, notes, steps…',
    'aria-label': 'Search', autocomplete: 'off', enterkeyhint: 'search',
  });
  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setFilters({ q: search.value.trim() }), 180);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; setFilters({ q: '' }); search.blur(); }
  });
  topbar.append(
    h('div', { class: 'topbar-title' },
      h('h1', { id: 'view-title', class: 'view-title' }),
      h('span', { id: 'mobile-sync', class: 'mobile-sync', role: 'status' })),
    h('div', { class: 'topbar-tools' },
      h('label', { class: 'search' }, icon('search', { size: 16 }), search),
      button('Filters', { icon: 'filter', kind: 'subtle', onClick: () => openFilterMenu(), attrs: { id: 'filter-btn', 'aria-haspopup': 'true' } }),
      button('New', { icon: 'plus', kind: 'primary', onClick: () => openCapture({}), attrs: { class: 'btn btn-primary topbar-new', title: 'New item (N)' } })),
  );

  const tabbar = document.getElementById('tabbar');
  for (const id of ['glance', 'board', 'calendar', 'review']) {
    const v = VIEW_BY_ID[id];
    tabbar.append(h('a', { href: `#/${id}`, class: 'tab', dataset: { view: id } }, icon(v.icon, { size: 20 }), h('span', { text: v.label })));
  }
  tabbar.append(h('button', { type: 'button', class: 'tab', on: { click: (e) => openMoreMenu(e.currentTarget) }, 'aria-haspopup': 'menu' },
    icon('menu', { size: 20 }), h('span', { text: 'More' })));

  document.getElementById('fab').addEventListener('click', () => openCapture({}));
  mountDetail(document.getElementById('detail'), ctx);
}

function renderNav() {
  const nav = document.getElementById('nav');
  clear(nav);
  const live = state.items.filter(isLive);
  const b = reviewBuckets(live, ctx.today, state.settings);
  const counts = {
    board: live.filter(isOpen).length,
    review: b.inbox.length + b.overdue.length + b.passedTargets.length + b.stale.length,
    archive: state.items.length - live.length,
  };
  for (const v of VIEWS) {
    const current = route.view === v.id;
    nav.append(h('a', {
      href: hashFor(v.id, { item: null }), class: ['nav-item', current && 'is-current'], 'aria-current': current ? 'page' : null,
      title: `${v.label} (${v.key})`,
    }, icon(v.icon, { size: 18 }), h('span', { class: 'nav-label', text: v.label }),
    counts[v.id] ? h('span', { class: ['nav-count', v.id === 'review' && b.overdue.length && 'is-alert'], text: String(counts[v.id]) }) : ''));
  }
  for (const tab of document.querySelectorAll('#tabbar .tab[data-view]')) {
    const on = tab.dataset.view === route.view;
    tab.classList.toggle('is-current', on);
    if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    tab.href = hashFor(tab.dataset.view, { item: null });
  }
}

function syncStatusText() {
  if (state.connection === 'offline') {
    return { text: state.unconfirmed.length ? `Offline · ${state.unconfirmed.length} unconfirmed` : 'Offline · not saving', kind: 'is-offline' };
  }
  if (state.inFlight) return { text: 'Saving…', kind: 'is-saving' };
  if (state.unconfirmed.length) return { text: `${state.unconfirmed.length} unconfirmed`, kind: 'is-offline' };
  if (state.phase === 'loading') return { text: 'Loading…', kind: 'is-saving' };
  if (state.phase === 'error') return { text: 'Not connected', kind: 'is-offline' };
  const at = state.lastSavedAt || state.loadedAt;
  const time = at ? formatClock(at, displayZone()) : '';
  return { text: state.lastSavedAt ? `Saved · ${time}` : `Synced · ${time}`, kind: 'is-saved' };
}

function renderStatus() {
  const { text, kind } = syncStatusText();
  for (const id of ['sync-status', 'mobile-sync']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.className = `${id === 'sync-status' ? 'sync' : 'mobile-sync'} ${kind}`;
    el.replaceChildren(h('span', { class: 'sync-dot', 'aria-hidden': 'true' }), h('span', { text }));
  }
  const banner = document.getElementById('banner');
  banner.replaceChildren();
  if (state.connection === 'offline' && state.phase === 'ready') {
    banner.append(h('div', { class: 'banner banner-offline', role: 'alert' }, icon('offline', { size: 18 }),
      h('div', { class: 'banner-text' },
        h('strong', { text: 'Can’t reach the planning server.' }),
        h('span', { text: ` Showing what was loaded${state.loadedAt ? ` at ${formatClock(state.loadedAt, displayZone())}` : ''}. Changes are paused${state.unconfirmed.length ? `; ${state.unconfirmed.length} change(s) are unconfirmed and will be re-sent safely` : ''}. New captures can be kept as device drafts.` })),
      button('Retry', { kind: 'subtle', onClick: () => checkServer() })));
  } else if (state.drafts.length && route.view !== 'glance') {
    banner.append(h('div', { class: 'banner banner-draft' }, icon('upload', { size: 18 }),
      h('span', { class: 'banner-text', text: `${state.drafts.length} device draft(s) are not in the planning store yet.` }),
      button('Review drafts', { kind: 'subtle', onClick: () => ctx.go('glance') })));
  }
}

function renderFilterChips() {
  const host = document.getElementById('filter-chips');
  host.replaceChildren();
  const labels = {
    motivation: Object.fromEntries(MOTIVATIONS.map((x) => [x.id, x.label])),
    horizon: Object.fromEntries(HORIZONS.map((x) => [x.id, x.label])),
    kind: Object.fromEntries(KINDS.map((x) => [x.id, x.label])),
    priority: Object.fromEntries(PRIORITIES.map((x) => [x.id, x.label])),
  };
  const names = { area: 'Area', motivation: 'Why', horizon: 'Horizon', kind: 'Kind', priority: 'Priority', q: 'Search' };
  for (const key of FILTER_KEYS) {
    const value = route.filters[key];
    if (!value) continue;
    const shown = value === '__none' ? 'none' : (labels[key]?.[value] || value);
    host.append(h('button', {
      type: 'button', class: 'filter-chip', 'aria-label': `Remove filter ${names[key]}: ${shown}`,
      on: { click: () => setFilters({ [key]: '' }) },
    }, h('span', { class: 'muted', text: `${names[key]}:` }), ` ${shown}`, icon('x', { size: 12 })));
  }
  if (host.childNodes.length > 1) {
    host.append(h('button', { type: 'button', class: 'filter-clear', text: 'Clear all', on: { click: () => setFilters({ ...EMPTY_FILTERS }) } }));
  }
  host.hidden = !host.childNodes.length;
  const btn = document.getElementById('filter-btn');
  const n = activeFilterCount(route.filters) - (route.filters.q ? 1 : 0);
  btn.querySelector('span').textContent = n ? `Filters · ${n}` : 'Filters';
  btn.classList.toggle('is-active', n > 0);
  const search = document.getElementById('search');
  if (document.activeElement !== search && search.value !== route.filters.q) search.value = route.filters.q;
}

// ------------------------------------------------------------------ render

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (isDragging()) {
      renderDeferred = true;
      return;
    }
    render();
  });
}

function render() {
  const main = document.getElementById('main');
  const view = VIEW_BY_ID[route.view];
  document.getElementById('view-title').textContent = view.label;
  document.title = `${view.label} · Planning`;
  document.body.dataset.view = route.view;
  setBoardFilters(route.filters);
  renderNav();
  renderStatus();
  renderFilterChips();

  const scrolls = {};
  main.querySelectorAll('[data-scroll-key]').forEach((el) => {
    scrolls[el.dataset.scrollKey] = [el.scrollLeft, el.scrollTop];
  });
  const active = document.activeElement;
  const requested = pendingFocusKey;
  const focusKey = requested || (active && main.contains(active) ? active.dataset.focusKey : null);
  pendingFocusKey = null;
  const sameView = main.dataset.view === route.view;

  const container = h('div', { class: ['view', `view-${route.view}`] });
  if (state.phase === 'loading') {
    container.append(skeleton());
  } else if (state.phase === 'error') {
    container.append(h('div', { class: 'error-state', role: 'alert' },
      icon('offline', { size: 32 }),
      h('h2', { text: 'Can’t reach the planning server' }),
      h('p', { text: state.loadError || 'The server did not respond.' }),
      h('p', { class: 'muted', text: 'Your data is stored on the server, not in this browser. Start the server and retry.' }),
      button('Retry', { kind: 'primary', icon: 'restore', onClick: () => load() })));
  } else {
    view.render(container, ctx);
  }
  main.replaceChildren(container);
  main.dataset.view = route.view;

  if (sameView) {
    main.querySelectorAll('[data-scroll-key]').forEach((el) => {
      const s = scrolls[el.dataset.scrollKey];
      if (s) [el.scrollLeft, el.scrollTop] = s;
    });
  }
  if (focusKey) {
    const target = main.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    if (target) target.focus({ preventScroll: !requested });
  }
  if (state.phase === 'ready') renderDetail(route.item, ctx);
  else if (detailOpenId() && !route.item) closeDetailPanel();
}

function skeleton() {
  const wrap = h('div', { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Loading your planning store' });
  for (let i = 0; i < 4; i += 1) {
    const col = h('div', { class: 'sk-col' }, h('div', { class: 'sk-line sk-head' }));
    for (let j = 0; j < 3 - (i % 2); j += 1) col.append(h('div', { class: 'sk-card' }));
    wrap.append(col);
  }
  return h('div', null, h('p', { class: 'muted loading-note', text: 'Loading your planning store…' }), wrap);
}

// ------------------------------------------------------------------ menus

function openFilterMenu() {
  const areas = areasOf(state.items);
  const groups = [
    { key: 'motivation', label: 'Why', options: MOTIVATIONS },
    { key: 'horizon', label: 'Horizon', options: HORIZONS },
    { key: 'kind', label: 'Kind', options: KINDS },
    { key: 'priority', label: 'Priority', options: PRIORITIES },
    { key: 'area', label: 'Area', options: areas.map((a) => ({ id: a, label: a })) },
  ];
  const content = h('div', { class: 'filter-panel' });
  for (const g of groups) {
    if (!g.options.length) continue;
    const row = h('div', { class: 'filter-group', role: 'group', 'aria-label': g.label }, h('span', { class: 'filter-label', text: g.label }));
    const opts = [{ id: '', label: 'Any' }, ...g.options, { id: '__none', label: 'Not set' }];
    for (const o of opts) {
      const on = (route.filters[g.key] || '') === o.id;
      row.append(h('button', {
        type: 'button', class: ['filter-opt', on && 'is-selected'], 'aria-pressed': String(on),
        on: { click: () => { setFilters({ [g.key]: o.id }); dlg.close(); } },
      }, o.label));
    }
    content.append(row);
  }
  const dlg = openDialog({
    title: 'Filter items', content, size: 'sm', className: 'dialog-filters',
    actions: [
      { label: 'Clear filters', onClick: ({ close }) => { setFilters({ ...EMPTY_FILTERS, q: route.filters.q }); close(); } },
      { label: 'Done', kind: 'primary', onClick: ({ close }) => close() },
    ],
  });
}

function openMoveMenu(item, anchor) {
  if (!item) return;
  const live = state.items.filter((it) => it.status === item.status);
  const visible = visibleColumn(state.items, item.status, route.filters).map((it) => it.id);
  const all = sortByPosition(live).map((it) => it.id);
  const entries = [{ heading: 'Move to' }];
  for (const s of STATUSES) {
    entries.push({
      label: s.label, icon: s.id === item.status ? 'check' : null, checked: s.id === item.status,
      hint: s.id === item.status ? 'current' : null,
      onSelect: () => { if (s.id !== item.status) moveItem(item, s.id, { place: 'top' }).catch(() => {}); },
    });
  }
  entries.push({ separator: true }, { heading: 'Position' });
  const up = stepAnchors(visible, item.id, -1);
  const down = stepAnchors(visible, item.id, 1);
  entries.push(
    { label: 'Move up', icon: 'arrowUp', hint: 'Alt+↑', disabled: !up, onSelect: () => { pendingFocusKey = `card:${item.id}`; moveItem(item, item.status, up).catch(() => {}); } },
    { label: 'Move down', icon: 'arrowDown', hint: 'Alt+↓', disabled: !down, onSelect: () => { pendingFocusKey = `card:${item.id}`; moveItem(item, item.status, down).catch(() => {}); } },
    { label: 'Top of column', icon: 'arrowUp', disabled: all[0] === item.id, onSelect: () => moveItem(item, item.status, { place: 'top' }).catch(() => {}) },
    { label: 'Bottom of column', icon: 'arrowDown', disabled: all[all.length - 1] === item.id, onSelect: () => moveItem(item, item.status, { place: 'bottom' }).catch(() => {}) },
    { separator: true },
    { label: 'Open details', icon: 'note', onSelect: () => ctx.openItem(item.id) },
    { label: 'Archive', icon: 'archive', onSelect: () => setArchived(item, true).catch(() => {}) },
  );
  openMenu({ anchor, entries, label: `Actions for ${item.title}` });
}

function openMoreMenu(anchor) {
  openMenu({
    anchor,
    label: 'More',
    entries: [
      ...['list', 'timeline', 'archive'].map((id) => ({ label: VIEW_BY_ID[id].label, icon: VIEW_BY_ID[id].icon, onSelect: () => ctx.go(id) })),
      { separator: true },
      { label: 'Data & settings', icon: 'data', onSelect: openDataDialog },
      { label: 'Theme', icon: 'moon', onSelect: cycleTheme },
      { label: 'Keyboard shortcuts', icon: 'keyboard', onSelect: openShortcuts },
    ],
  });
}

// ---------------------------------------------------------------- capture

function openCapture(defaults = {}) {
  const offline = state.connection === 'offline' || state.phase !== 'ready';
  const draft = {
    title: '', kind: 'idea', motivation: null, horizon: null, priority: null,
    status: defaults.status || 'inbox', area: '', notes: '', date: defaults.date || null,
  };
  const title = h('input', { type: 'text', class: 'input input-lg', maxLength: 200, required: true, placeholder: 'What’s on your mind?', enterkeyhint: 'done', autocomplete: 'off' });
  const status = selectControl(STATUSES.map((s) => ({ id: s.id, label: s.label })), draft.status);
  status.addEventListener('change', () => { draft.status = status.value; });
  const area = h('input', { type: 'text', class: 'input', maxLength: 40, list: 'capture-areas', placeholder: 'Optional', autocomplete: 'off' });
  const areaList = h('datalist', { id: 'capture-areas' }, areasOf(state.items).map((a) => h('option', { value: a })));
  const notes = h('textarea', { class: 'input', rows: 3, maxLength: 20000, placeholder: 'Optional notes' });
  const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });

  const dateHost = h('div', { class: 'capture-date' });
  function renderDate() {
    dateHost.replaceChildren();
    if (!draft.date) {
      dateHost.append(button('Add a date', { icon: 'calendar', kind: 'ghost', onClick: () => { draft.date = { kind: 'target', precision: 'day', value: ctx.today }; renderDate(); } }));
      return;
    }
    const kind = selectControl(DATE_KINDS.map((k) => ({ id: k, label: KIND_LABEL[k] })), draft.date.kind);
    kind.setAttribute('aria-label', 'Date kind');
    kind.addEventListener('change', () => { draft.date.kind = kind.value; });
    const day = h('input', { type: 'date', class: 'input', value: draft.date.value, 'aria-label': 'Day' });
    day.addEventListener('change', () => { draft.date.value = day.value; });
    dateHost.append(h('div', { class: 'field-row capture-date-row' }, kind, day,
      button('Remove date', { icon: 'x', iconOnly: true, kind: 'ghost', onClick: () => { draft.date = null; renderDate(); } })),
    h('p', { class: 'field-hint', text: 'Month, quarter or year dates and times can be set from the item afterwards.' }));
  }
  renderDate();

  const content = h('form', { class: 'capture', on: { submit: (e) => { e.preventDefault(); save(false); } } },
    field('Title', title),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Kind' }),
      segmented({ name: 'kind', label: 'Kind', compact: true, value: draft.kind, options: KINDS.map((k) => ({ id: k.id, label: k.label, icon: k.icon })), onChange: (v) => { draft.kind = v; } })),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Why' }),
      segmented({ name: 'motivation', label: 'Why', compact: true, allowNone: true, value: null, options: MOTIVATIONS, onChange: (v) => { draft.motivation = v; } })),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Horizon' }),
      segmented({ name: 'horizon', label: 'Horizon', compact: true, allowNone: true, value: null, options: HORIZONS, onChange: (v) => { draft.horizon = v; } })),
    h('div', { class: 'field-row' }, field('Status', status), field('Area', area)),
    areaList,
    dateHost,
    h('details', { class: 'capture-more' }, h('summary', { text: 'Notes' }), notes),
    offline ? h('p', { class: 'banner banner-draft small', text: 'The server is unreachable. Saving keeps a draft on this device only — not in the planning store — until you send it.' }) : '',
    errorBox);

  let saving = false;
  async function save(another) {
    if (saving) return;
    const value = title.value.trim();
    if (!value) {
      errorBox.textContent = 'Give it a title — that’s all you need.';
      errorBox.hidden = false;
      title.focus();
      return;
    }
    const fields = {
      title: value, kind: draft.kind, status: draft.status, motivation: draft.motivation, horizon: draft.horizon,
      area: area.value.trim() || null, notes: notes.value,
    };
    if (draft.date && draft.date.value) fields.dates = [{ kind: draft.date.kind, precision: 'day', value: draft.date.value }];
    if (offline) {
      const ok = addDraft(fields);
      toast(ok ? 'Saved on this device — not in the planning store yet.' : 'Could not keep a device draft (browser storage unavailable).', { kind: ok ? 'info' : 'error' });
      finish(another);
      return;
    }
    saving = true;
    try {
      await createItem(fields);
      finish(another);
    } catch (err) {
      errorBox.textContent = err.payload?.errors?.map((e) => e.message).join(' ') || err.message;
      errorBox.hidden = false;
    } finally {
      saving = false;
    }
  }
  function finish(another) {
    if (another) {
      title.value = '';
      notes.value = '';
      errorBox.hidden = true;
      title.focus();
    } else {
      dlg.close();
    }
  }
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(e.shiftKey); }
  });
  const dlg = openDialog({
    title: defaults.status && defaults.status !== 'inbox' ? `New item in ${STATUS_LABEL[defaults.status]}` : 'New item',
    content, size: 'md', className: 'dialog-capture',
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      { label: 'Save & add another', onClick: () => save(true), attrs: { title: 'Shift+Enter' } },
      { label: offline ? 'Keep as device draft' : 'Save', kind: 'primary', icon: 'check', onClick: () => save(false) },
    ],
  });
  title.focus();
}

function draftsPanel() {
  const panel = h('section', { class: 'panel panel-drafts' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, icon('upload', { size: 16 }), h('span', { text: 'Device drafts' }), h('span', { class: 'count', text: String(state.drafts.length) }))),
    h('p', { class: 'section-hint', text: 'Saved on this device only — not accepted by the planning store until sent.' }));
  const list = h('div', { class: 'rows' });
  for (const d of state.drafts) {
    list.append(h('div', { class: 'draft-row' },
      h('span', { class: 'row-title', text: d.fields.title }),
      h('span', { class: 'muted small', text: formatStamp(d.savedAt, displayZone()) }),
      button('Send', { kind: 'subtle', disabled: state.connection === 'offline', onClick: () => sendOne(d) }),
      button('Discard draft', {
        icon: 'x', iconOnly: true, kind: 'ghost',
        onClick: async () => {
          if (await confirmDialog({ title: 'Discard draft?', message: `“${d.fields.title}” exists only on this device.`, confirmLabel: 'Discard', danger: true })) discardDraft(d.localId);
        },
      })));
  }
  panel.append(list);
  return panel;
}

async function sendOne(draft) {
  try {
    await sendDraft(draft);
    toast(`“${draft.fields.title}” is now in the planning store.`, { kind: 'success' });
  } catch (err) {
    reportError(err, 'Send draft');
  }
}

// ------------------------------------------------------- data & settings

async function loadExamples() {
  try {
    const result = await mutate({ method: 'POST', path: '/api/examples', body: {}, label: 'Load examples' });
    await load({ quiet: true });
    toast(`Loaded ${result.created} example items. Each is marked “Example”.`, { kind: 'success' });
  } catch (err) {
    reportError(err, 'Load examples');
  }
}

function openDataDialog() {
  const content = h('div', { class: 'data-dialog' });
  const exampleCount = state.items.filter((i) => i.is_example).length;

  content.append(h('section', { class: 'data-section' },
    h('h3', { text: 'Export' }),
    h('p', { class: 'muted small', text: 'A full backup includes every item, archived items, history and preferences.' }),
    h('div', { class: 'data-actions' },
      h('a', { class: 'btn btn-subtle', href: '/api/export', download: 'planning-export.json' }, icon('download'), h('span', { text: 'Full backup (JSON)' })),
      h('a', { class: 'btn btn-subtle', href: '/api/export.md', download: 'planning-export.md' }, icon('download'), h('span', { text: 'Readable (Markdown)' })))));

  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'file-input', 'aria-label': 'Choose an export file' });
  const importHost = h('div', { class: 'import-host' });
  file.addEventListener('change', () => previewImport(file.files[0], importHost, dlg));
  content.append(h('section', { class: 'data-section' },
    h('h3', { text: 'Import or restore' }),
    h('p', { class: 'muted small', text: 'Choose a full backup. It is checked completely before anything changes.' }),
    file, importHost));

  const backupsHost = h('div', { class: 'backups' }, h('p', { class: 'muted small', text: 'Loading…' }));
  content.append(h('section', { class: 'data-section' },
    h('h3', { text: 'Safety backups' }),
    h('p', { class: 'muted small', text: 'Written automatically on the server before every replace or restore.' }),
    backupsHost));
  loadBackups(backupsHost, () => dlg);

  content.append(h('section', { class: 'data-section' },
    h('h3', { text: 'Example items' }),
    exampleCount
      ? h('div', { class: 'data-actions' }, h('span', { class: 'muted small', text: `${exampleCount} example item(s) loaded.` }),
        button('Remove example items', {
          kind: 'danger-ghost', icon: 'trash',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Remove example items?', message: `This removes the ${exampleCount} items marked “Example”. Your own items are not touched.`, confirmLabel: 'Remove examples', danger: true }))) return;
            try {
              const r = await mutate({ method: 'POST', path: '/api/examples/remove', body: {}, label: 'Remove examples' });
              await load({ quiet: true });
              toast(`Removed ${r.removed} example items.`, { kind: 'success' });
              dlg.close();
            } catch (err) { reportError(err, 'Remove examples'); }
          },
        }))
      : h('div', { class: 'data-actions' }, h('span', { class: 'muted small', text: 'Load a few clearly marked sample items to try things out.' }),
        button('Load examples', { kind: 'subtle', icon: 'sparkle', onClick: async () => { await loadExamples(); dlg.close(); } }))));

  const tz = h('input', { type: 'text', class: 'input', value: state.settings.default_tz, list: 'tz-all', autocomplete: 'off', spellcheck: false });
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = ['America/New_York']; }
  const tzList = h('datalist', { id: 'tz-all' }, zones.map((z) => h('option', { value: z })));
  const week = selectControl([{ id: 'sun', label: 'Sunday' }, { id: 'mon', label: 'Monday' }], state.settings.week_start);
  const stale = h('input', { type: 'number', class: 'input input-xs', min: '1', max: '365', value: String(state.settings.stale_days) });
  content.append(h('section', { class: 'data-section' },
    h('h3', { text: 'Preferences' }),
    h('div', { class: 'field-row' }, field('Time zone (display and new timed dates)', tz), field('Week starts on', week)),
    tzList,
    field('Active items count as quiet after (days)', stale),
    h('div', { class: 'data-actions' }, button('Save preferences', {
      kind: 'primary', icon: 'check',
      onClick: async () => {
        try {
          await saveSettings({ default_tz: tz.value.trim(), week_start: week.value, stale_days: Number(stale.value) });
          scheduleRender();
        } catch { /* reported */ }
      },
    }))));

  content.append(h('section', { class: 'data-section' },
    h('h3', { text: 'Where your data lives' }),
    h('p', { class: 'muted small', text: 'In one SQLite file on the planning server, at the path it was started with. This page keeps no copy except device drafts you create while offline. Nothing is sent to any other service.' })));

  const dlg = openDialog({ title: 'Data & settings', content, size: 'lg', actions: [{ label: 'Close', onClick: ({ close }) => close() }] });
}

async function loadBackups(host, getDialog) {
  try {
    const { backups } = await api.backups();
    host.replaceChildren();
    if (!backups.length) {
      host.append(h('p', { class: 'muted small', text: 'No safety backups yet.' }));
      return;
    }
    const list = h('ul', { class: 'backup-list' });
    for (const b of backups.slice(0, 10)) {
      const m = /backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(b.name);
      const when = m ? formatStamp(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), displayZone(), { year: true }) : b.name;
      list.append(h('li', null, h('span', { text: when }), h('span', { class: 'muted small', text: `${Math.ceil(b.bytes / 1024)} KB` }),
        button('Restore', {
          kind: 'subtle',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Restore this backup?',
              message: `All current items will be replaced by the backup from ${when}. A new safety backup of the current state is written first, so this can be reversed.`,
              confirmLabel: 'Replace with backup', danger: true,
            });
            if (!ok) return;
            try {
              const r = await mutate({ method: 'POST', path: '/api/backups/restore', body: { name: b.name, confirm: 'replace' }, label: 'Restore backup' });
              await load({ quiet: true });
              toast(`Restored ${r.imported} items. Previous state saved as ${r.backup}.`, { kind: 'success', timeout: 10000 });
              getDialog()?.close();
            } catch (err) { reportError(err, 'Restore'); }
          },
        })));
    }
    host.append(list);
  } catch (err) {
    host.replaceChildren(h('p', { class: 'form-error', text: `Backups unavailable: ${err.message}` }));
  }
}

async function previewImport(fileObj, host, dlg) {
  host.replaceChildren();
  if (!fileObj) return;
  if (fileObj.size > 8 * 1024 * 1024) {
    host.append(h('p', { class: 'form-error', text: 'That file is larger than 8 MB.' }));
    return;
  }
  let data;
  try {
    data = JSON.parse(await fileObj.text());
  } catch {
    host.append(h('p', { class: 'form-error', text: 'That file is not valid JSON.' }));
    return;
  }
  host.append(h('p', { class: 'muted small', text: 'Checking…' }));
  let preview;
  try {
    preview = await api.send('POST', '/api/import/preview', { data }, uid());
  } catch (err) {
    host.replaceChildren(h('div', { class: 'form-error' }, h('p', { text: err.message }),
      ...(err.payload?.problems || []).map((p) => h('p', { class: 'small', text: p }))));
    return;
  }
  host.replaceChildren();
  host.append(h('p', { class: 'import-summary', text: `Valid export: ${preview.incoming} items (${preview.incoming_archived} archived). ${preview.new_ids} are new here; ${preview.existing_ids} already exist. You currently have ${preview.current} items.` }));
  const understand = h('input', { type: 'checkbox' });
  const replaceBtn = button('Replace everything', {
    kind: 'danger', disabled: true,
    onClick: () => runImport('replace'),
  });
  understand.addEventListener('change', () => { replaceBtn.disabled = !understand.checked; });
  host.append(
    h('div', { class: 'import-choice' },
      h('div', null, h('strong', { text: 'Add new items only' }), h('p', { class: 'muted small', text: `Adds ${preview.new_ids} item(s); existing items are left exactly as they are.` })),
      button('Add new items', { kind: 'subtle', disabled: !preview.new_ids, onClick: () => runImport('merge') })),
    h('div', { class: 'import-choice is-danger' },
      h('div', null, h('strong', { text: 'Replace everything' }),
        h('p', { class: 'muted small', text: `Your ${preview.current} current item(s) are replaced by the file. A safety backup is written on the server first.` }),
        h('label', { class: 'check' }, understand, h('span', { text: 'I understand current items will be replaced.' }))),
      replaceBtn));

  async function runImport(mode) {
    try {
      const body = mode === 'replace' ? { mode, data, confirm: 'replace' } : { mode, data };
      const r = await mutate({ method: 'POST', path: '/api/import', body, label: mode === 'replace' ? 'Replace' : 'Import' });
      await load({ quiet: true });
      toast(mode === 'replace'
        ? `Replaced with ${r.imported} items. Previous state saved as ${r.backup}.`
        : `Added ${r.imported} items; skipped ${r.skipped} that already existed.`, { kind: 'success', timeout: 10000 });
      dlg.close();
    } catch (err) {
      reportError(err, 'Import');
    }
  }
}

// ------------------------------------------------------------- shortcuts

function openShortcuts() {
  const rows = [
    ['N', 'New item'], ['/', 'Search'], ['1 – 7', 'Switch view'], ['?', 'This help'],
    ['Ctrl/⌘ + Z', 'Undo last change'], ['Esc', 'Close details or menus'],
    ['Enter', 'Open the focused card'], ['M', 'Move-to menu for the focused card'],
    ['↑ ↓ ← →', 'Move focus between cards'], ['Alt + ↑ / ↓', 'Reorder card in its column'],
    ['Alt + ← / →', 'Move card to the previous / next status'],
    ['Alt + arrows on a calendar date', 'Shift the date by a day or a week'],
    ['Page Up / Down', 'Previous / next month in the calendar'],
    ['Alt + ↑ / ↓ on a timeline row', 'Change horizon'],
  ];
  const table = h('dl', { class: 'shortcuts' });
  for (const [k, v] of rows) table.append(h('dt', null, h('kbd', { text: k })), h('dd', { text: v }));
  const touch = h('p', { class: 'muted small', text: 'On touch screens, press and hold a card to drag it, or use its ⋯ menu.' });
  openDialog({ title: 'Keyboard shortcuts', content: h('div', null, table, touch), size: 'md' });
}

// ----------------------------------------------------------------- theme

function applyTheme() {
  let pref = 'auto';
  try { pref = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* preference only */ }
  if (pref === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = pref;
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const label = `Theme: ${pref === 'auto' ? 'match system' : pref}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

function cycleTheme() {
  let pref = 'auto';
  try { pref = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* preference only */ }
  const next = pref === 'auto' ? 'light' : pref === 'light' ? 'dark' : 'auto';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* preference only */ }
  applyTheme();
  toast(`Theme: ${next === 'auto' ? 'match system' : next}`, { timeout: 1800 });
}

// ------------------------------------------------------------- keyboard

function onGlobalKey(e) {
  if (document.querySelector('dialog[open]')) return;
  const typing = isTypingTarget(e.target);
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (canUndo()) undoLast(); else toast('Nothing to undo.', { timeout: 2000 });
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) {
    if (e.key === 'Escape' && route.item && !typing) ctx.closeItem();
    return;
  }
  if (route.view === 'calendar' && calendarKey(e, ctx)) return;
  if (e.key === 'Escape' && route.item) {
    e.preventDefault();
    ctx.closeItem();
  } else if (e.key === 'n' || e.key === 'N') {
    if (e.target.closest?.('.card, .tl-label')) return;
    e.preventDefault();
    openCapture({});
  } else if (e.key === '/') {
    e.preventDefault();
    document.getElementById('search').focus();
  } else if (e.key === '?') {
    e.preventDefault();
    openShortcuts();
  } else {
    const v = VIEWS.find((x) => x.key === e.key);
    if (v) {
      e.preventDefault();
      ctx.go(v.id);
    }
  }
}

// ------------------------------------------------------------------ start

function start() {
  applyTheme();
  buildShell();
  parseHash();
  if (!location.hash) history.replaceState(null, '', hashFor('glance'));
  window.addEventListener('hashchange', () => { parseHash(); scheduleRender(); });
  window.addEventListener('popstate', () => { parseHash(); scheduleRender(); });
  document.addEventListener('keydown', onGlobalKey);
  document.addEventListener('planning:dragend', () => {
    if (renderDeferred) {
      renderDeferred = false;
      scheduleRender();
    }
  });
  initDrag(() => {
    if (state.connection === 'offline') return 'Offline — changes can’t be saved right now.';
    if (state.phase !== 'ready') return 'Still loading.';
    return null;
  });
  subscribe(scheduleRender);
  setReconnectHandler((failures) => {
    toast('Reconnected to the planning server.', { kind: 'success', timeout: 3000 });
    for (const f of failures) toast(`${f.label}: not applied`, { kind: 'error', detail: f.message });
  });
  // Rescheduling across midnight changes "today".
  let lastToday = displayToday();
  setInterval(() => {
    if (displayToday() !== lastToday) {
      lastToday = displayToday();
      scheduleRender();
    }
  }, 60000);
  scheduleRender();
  load();
  startSync();
}

start();

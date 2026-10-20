// List: a dense, sortable table with inline status and horizon controls.
// Also the most screen-reader-friendly way to scan everything.

import { moveItem, patchItem } from '../actions.js';
import { dayNum, periodBounds } from '../dates.js';
import { h, icon } from '../dom.js';
import {
  HORIZONS, MOTIVATION_LABEL, PRIORITY_LABEL, STATUSES, cardDate, isLive, matchesFilters, stepProgress,
} from '../model.js';
import { sortByPosition } from '../ordering.js';
import { isPending, state } from '../state.js';
import { emptyState, selectControl } from '../ui.js';
import { ago } from './glance.js';
import { areaTag, dateChip, kindIcon } from './common.js';

const STATUS_ORDER = Object.fromEntries(STATUSES.map((s, i) => [s.id, i]));
const HORIZON_ORDER = { now: 0, soon: 1, later: 2, someday: 3 };
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };
const MOTIVATION_ORDER = { need: 0, want: 1, exploring: 2 };

const sort = { key: 'status', dir: 1 };

const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'motivation', label: 'Why' },
  { key: 'horizon', label: 'Horizon' },
  { key: 'priority', label: 'Priority' },
  { key: 'area', label: 'Area' },
  { key: 'date', label: 'Next date' },
  { key: 'steps', label: 'Steps' },
  { key: 'updated', label: 'Updated' },
];

function compare(a, b, key, today) {
  const rank = (map, v) => (v in map ? map[v] : 99);
  switch (key) {
    case 'title': return a.title.localeCompare(b.title);
    case 'status': return rank(STATUS_ORDER, a.status) - rank(STATUS_ORDER, b.status) || a.position - b.position;
    case 'motivation': return rank(MOTIVATION_ORDER, a.motivation) - rank(MOTIVATION_ORDER, b.motivation);
    case 'horizon': return rank(HORIZON_ORDER, a.horizon) - rank(HORIZON_ORDER, b.horizon);
    case 'priority': return rank(PRIORITY_ORDER, a.priority) - rank(PRIORITY_ORDER, b.priority);
    case 'area': return (a.area || '￿').localeCompare(b.area || '￿');
    case 'date': {
      const da = cardDate(a, today);
      const db = cardDate(b, today);
      const va = da ? dayNum(periodBounds(da.entry.precision, da.entry.value)[0]) : Infinity;
      const vb = db ? dayNum(periodBounds(db.entry.precision, db.entry.value)[0]) : Infinity;
      return va === vb ? 0 : va < vb ? -1 : 1;
    }
    case 'steps': return stepProgress(b).total - stepProgress(a).total;
    case 'updated': return a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0;
    default: return 0;
  }
}

export function renderList(root, ctx) {
  const { today } = ctx;
  const items = sortByPosition(state.items.filter((it) => isLive(it) && matchesFilters(it, ctx.filters)));
  if (!items.length) {
    root.append(emptyState({ iconName: 'list', title: 'Nothing to list', message: state.items.some(isLive) ? 'No items match the current filters.' : 'Add your first item to see it here.' }));
    return;
  }
  items.sort((a, b) => compare(a, b, sort.key, today) * sort.dir || a.position - b.position);

  const table = h('table', { class: 'table' });
  const headRow = h('tr');
  for (const col of COLUMNS) {
    const active = sort.key === col.key;
    headRow.append(h('th', {
      scope: 'col', class: `col-${col.key}`, 'aria-sort': active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none',
    }, h('button', {
      type: 'button', class: 'th-sort', on: {
        click: () => {
          if (sort.key === col.key) sort.dir *= -1;
          else { sort.key = col.key; sort.dir = 1; }
          ctx.rerender();
        },
      },
    }, col.label, active ? icon(sort.dir === 1 ? 'arrowUp' : 'arrowDown', { size: 12 }) : '')));
  }
  table.append(h('thead', null, headRow));
  const body = h('tbody');
  for (const item of items) {
    const tr = h('tr', { class: [isPending(item.id) && 'is-pending', item.is_example && 'is-example'] });
    tr.append(h('td', { class: 'col-title' }, h('button', {
      type: 'button', class: 'cell-title', dataset: { focusKey: `list:${item.id}` }, on: { click: () => ctx.openItem(item.id) },
    }, kindIcon(item.kind, 15), h('span', { text: item.title }), item.is_example ? h('span', { class: 'badge-example', text: 'Example' }) : '')));

    const status = selectControl(STATUSES.map((s) => ({ id: s.id, label: s.label })), item.status);
    status.setAttribute('aria-label', `Status of ${item.title}`);
    status.classList.add('select-inline', `st-${item.status}`);
    status.addEventListener('change', async () => {
      try { await moveItem(item, status.value, { place: 'top' }); } catch { status.value = item.status; }
    });
    tr.append(h('td', { class: 'col-status' }, status));
    tr.append(h('td', { class: 'col-motivation' }, item.motivation ? h('span', { class: ['pill', `pill-${item.motivation}`], text: MOTIVATION_LABEL[item.motivation] }) : dash()));

    const horizon = selectControl(HORIZONS.map((x) => ({ id: x.id, label: x.label })), item.horizon, { allowNone: true, noneLabel: '—' });
    horizon.setAttribute('aria-label', `Horizon of ${item.title}`);
    horizon.classList.add('select-inline');
    horizon.addEventListener('change', async () => {
      try { await patchItem(item, { horizon: horizon.value || null }, { label: 'Horizon' }); } catch { horizon.value = item.horizon || ''; }
    });
    tr.append(h('td', { class: 'col-horizon' }, horizon));
    tr.append(h('td', { class: 'col-priority' }, item.priority ? h('span', { class: `prio-text prio-${item.priority}`, text: PRIORITY_LABEL[item.priority] }) : dash()));
    tr.append(h('td', { class: 'col-area' }, areaTag(item.area) || dash()));
    const date = cardDate(item, today);
    tr.append(h('td', { class: 'col-date' }, date ? dateChip(date.entry, date.state, today) : dash()));
    const steps = stepProgress(item);
    tr.append(h('td', { class: 'col-steps' }, steps.total ? `${steps.done}/${steps.total}` : dash()));
    tr.append(h('td', { class: 'col-updated muted' }, ago(item.updated_at)));
    body.append(tr);
  }
  table.append(body);
  root.append(h('div', { class: 'table-wrap', dataset: { scrollKey: 'list' } }, table));
}

function dash() {
  return h('span', { class: 'muted', 'aria-label': 'none', text: '—' });
}

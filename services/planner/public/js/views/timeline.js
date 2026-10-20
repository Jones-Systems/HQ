// Timeline: horizon lanes across the next two years. Coarse dates draw as the
// period they name; a bar connects a start date to a later target/deadline
// only when the owner supplied both ends. Nothing gets an invented duration.
// Drag a row (or use Alt+↑/↓ or its menu) to change its horizon.

import { patchItem } from '../actions.js';
import { KIND_LABEL, dayNum, formatShort, formatValue, periodBounds } from '../dates.js';
import { announce, h, icon } from '../dom.js';
import { registerDragType } from '../drag.js';
import { HORIZONS, HORIZON_LABEL, isLive, isOpen, matchesFilters } from '../model.js';
import { sortByPosition } from '../ordering.js';
import { getItem, isPending, state } from '../state.js';
import { openMenu } from '../ui.js';
import { kindIcon, motivationPill } from './common.js';

const QUARTERS = 8;
const LANES = [...HORIZONS.map((hz) => ({ id: hz.id, label: hz.label, hint: hz.hint })),
  { id: '', label: 'No horizon', hint: 'Not placed yet' }];

function quarterStart(iso) {
  const y = Number(iso.slice(0, 4));
  const q = Math.floor((Number(iso.slice(5, 7)) - 1) / 3);
  return { y, q };
}

export function renderTimeline(root, ctx) {
  const { today } = ctx;
  const { y, q } = quarterStart(today);
  const quarters = [];
  for (let i = 0; i < QUARTERS; i += 1) {
    const idx = y * 4 + q + i;
    const value = `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`;
    quarters.push({ value, bounds: periodBounds('quarter', value) });
  }
  const rangeStart = dayNum(quarters[0].bounds[0]);
  const rangeEnd = dayNum(quarters[QUARTERS - 1].bounds[1]) + 1;
  const pct = (iso, end = false) => {
    const n = dayNum(iso) + (end ? 1 : 0);
    return ((n - rangeStart) / (rangeEnd - rangeStart)) * 100;
  };

  const items = state.items.filter((it) => isLive(it) && isOpen(it) && matchesFilters(it, ctx.filters));

  const wrap = h('div', { class: 'tl', dataset: { scrollKey: 'timeline' } });
  const header = h('div', { class: 'tl-row tl-header' },
    h('div', { class: 'tl-label tl-corner' }, h('span', { text: 'Horizon' }), h('span', { class: 'muted small', text: 'open items' })));
  const scale = h('div', { class: 'tl-track tl-scale' });
  for (const qt of quarters) {
    const tick = h('div', { class: 'tl-tick' }, h('span', { text: qt.value.replace('-', ' ') }));
    tick.style.left = `${pct(qt.bounds[0])}%`;
    tick.style.width = `${pct(qt.bounds[1], true) - pct(qt.bounds[0])}%`;
    if (qt.value.endsWith('Q1')) tick.classList.add('is-year');
    scale.append(tick);
  }
  const todayLine = h('div', { class: 'tl-today', title: 'Today' });
  todayLine.style.left = `${pct(today)}%`;
  scale.append(todayLine);
  header.append(scale);
  wrap.append(header);

  for (const lane of LANES) {
    const laneItems = sortByPosition(items.filter((it) => (it.horizon || '') === lane.id));
    const section = h('section', {
      class: ['tl-lane', `hz-${lane.id || 'none'}`], dataset: { drop: 'tl-lane', horizon: lane.id },
      'aria-label': `${lane.label} lane, ${laneItems.length} items`,
    });
    section.append(h('div', { class: 'tl-lane-head' },
      h('span', { class: 'hz-bars', 'aria-hidden': 'true' }),
      h('strong', { text: lane.label }), h('span', { class: 'muted small', text: lane.hint }),
      h('span', { class: 'count', text: String(laneItems.length) })));
    if (!laneItems.length) {
      section.append(h('div', { class: 'tl-empty', text: 'Drop items here' }));
    }
    for (const item of laneItems) section.append(itemRow(item, ctx, pct, rangeStart, rangeEnd, today));
    wrap.append(section);
  }
  root.append(h('p', { class: 'view-hint' }, icon('move', { size: 14 }),
    'Drag a row to another lane to change its horizon. Bars appear only between a start date and a later target or deadline you set.'));
  root.append(wrap);
  root.addEventListener('keydown', (e) => onRowKey(e, ctx));
}

function itemRow(item, ctx, pct, rangeStart, rangeEnd, today) {
  const row = h('div', { class: ['tl-row', isPending(item.id) && 'is-pending', item.is_example && 'is-example'] });
  const label = h('div', {
    class: 'tl-label', tabindex: '0', dataset: { dragType: 'tl-item', id: item.id, focusKey: `tl:${item.id}` },
    'aria-label': `${item.title}, horizon ${HORIZON_LABEL[item.horizon] || 'none'}. Alt+Up or Alt+Down changes horizon. Enter opens.`,
  }, h('span', { class: 'grip', 'aria-hidden': 'true' }, icon('grip', { size: 14 })), kindIcon(item.kind, 15),
  h('button', { type: 'button', class: 'tl-title', text: item.title, 'data-drag-handle': '', on: { click: () => ctx.openItem(item.id) } }),
  motivationPill(item.motivation) || '',
  h('button', {
    type: 'button', class: 'btn btn-icon btn-ghost tl-menu', 'aria-label': `Change horizon for ${item.title}`,
    'aria-haspopup': 'menu', on: { click: (e) => horizonMenu(item, e.currentTarget) },
  }, icon('more', { size: 16 })));
  row.append(label);

  const track = h('div', { class: 'tl-track' });
  const dateText = h('div', { class: 'tl-date-text' });
  const entries = item.dates.map((entry) => ({ entry, bounds: periodBounds(entry.precision, entry.value) }))
    .filter((x) => x.bounds);
  if (!entries.length) {
    track.append(h('span', { class: 'tl-unscheduled', text: 'Unscheduled' }));
    dateText.textContent = 'Unscheduled';
  }
  const inRange = (b) => dayNum(b[1]) >= rangeStart && dayNum(b[0]) < rangeEnd;
  const clampPct = (v) => Math.max(0, Math.min(100, v));

  // Explicit spans: a start date followed by the next later target/deadline/event.
  const starts = entries.filter((x) => x.entry.kind === 'start');
  for (const s of starts) {
    const end = entries.filter((x) => x.entry.kind !== 'start' && dayNum(x.bounds[1]) > dayNum(s.bounds[0]))
      .sort((a, b) => dayNum(a.bounds[1]) - dayNum(b.bounds[1]))[0];
    if (!end) continue;
    const left = clampPct(pct(s.bounds[0]));
    const right = clampPct(pct(end.bounds[1], true));
    if (right <= 0 || left >= 100) continue;
    const span = h('div', { class: 'tl-span', title: `${formatValue(s.entry, today)} → ${formatValue(end.entry, today)}` });
    span.style.left = `${left}%`;
    span.style.width = `${Math.max(0.4, right - left)}%`;
    track.append(span);
  }

  for (const { entry, bounds } of entries) {
    const title = `${KIND_LABEL[entry.kind]} · ${formatValue(entry, today)}${entry.note ? ` — ${entry.note}` : ''}`;
    if (!inRange(bounds)) {
      const before = dayNum(bounds[1]) < rangeStart;
      const edge = h('span', { class: ['tl-edge', before ? 'is-before' : 'is-after', `dk-${entry.kind}`], title },
        before ? icon('chevronLeft', { size: 12 }) : '', formatShort(entry, today), before ? '' : icon('chevronRight', { size: 12 }));
      track.append(edge);
    } else if (entry.precision === 'day') {
      const marker = h('span', { class: ['tl-marker', `dk-${entry.kind}`], title }, icon(entry.kind, { size: 12 }));
      marker.style.left = `${clampPct(pct(bounds[0]) + (pct(bounds[0], true) - pct(bounds[0])) / 2)}%`;
      track.append(marker);
    } else {
      const left = clampPct(pct(bounds[0]));
      const right = clampPct(pct(bounds[1], true));
      const band = h('span', { class: ['tl-band', `dk-${entry.kind}`, `pr-${entry.precision}`], title },
        h('span', { class: 'tl-band-label', text: formatShort(entry, today) }));
      band.style.left = `${left}%`;
      band.style.width = `${Math.max(0.6, right - left)}%`;
      track.append(band);
    }
  }
  if (entries.length) {
    dateText.textContent = entries.map(({ entry }) => `${KIND_LABEL[entry.kind]} ${formatShort(entry, today)}`).join(' · ');
  }
  row.append(track, dateText);
  return row;
}

function horizonMenu(item, anchor) {
  openMenu({
    anchor,
    label: 'Horizon',
    entries: [{ heading: 'Horizon' }, ...LANES.map((lane) => ({
      label: lane.label, hint: lane.hint, checked: (item.horizon || '') === lane.id,
      onSelect: () => setHorizon(item, lane.id || null),
    }))],
  });
}

async function setHorizon(item, horizon) {
  const latest = getItem(item.id);
  if (!latest || (latest.horizon || null) === horizon) return;
  try {
    await patchItem(latest, { horizon }, {
      label: 'Horizon',
      message: `“${latest.title}” is now ${horizon ? HORIZON_LABEL[horizon] : 'without a horizon'}.`,
      project: true,
    });
  } catch { /* reported */ }
}

function onRowKey(e, ctx) {
  const label = e.target.closest('.tl-label[data-drag-type]');
  if (!label || e.target !== label) return;
  const item = getItem(label.dataset.id);
  if (!item) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    ctx.openItem(item.id);
    return;
  }
  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    horizonMenu(item, label.querySelector('.tl-menu'));
    return;
  }
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  const ids = LANES.map((l) => l.id);
  const index = ids.indexOf(item.horizon || '') + (e.key === 'ArrowUp' ? -1 : 1);
  if (index < 0 || index >= ids.length) return;
  ctx.keepFocus(`tl:${item.id}`);
  setHorizon(item, ids[index] || null);
}

let activeLane = null;
registerDragType('tl-item', {
  findTarget(el) {
    const lane = el.closest('[data-drop="tl-lane"]');
    return lane ? { horizon: lane.dataset.horizon, el: lane } : null;
  },
  indicate(target, prev, payload) {
    if (activeLane && (!target || activeLane !== target.el)) activeLane.classList.remove('drop-active');
    activeLane = target ? target.el : null;
    if (!target) return null;
    activeLane.classList.add('drop-active');
    const item = getItem(payload.id);
    if (item && (item.horizon || '') === target.horizon) return 'Same horizon';
    return `Horizon: ${target.horizon ? HORIZON_LABEL[target.horizon] : 'none'}`;
  },
  onEnd() {
    activeLane?.classList.remove('drop-active');
    activeLane = null;
  },
  onRefused: (msg) => announce(msg),
  drop(target, payload) {
    const item = getItem(payload.id);
    if (item) setHorizon(item, target.horizon || null);
  },
});

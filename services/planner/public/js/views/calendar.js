// Calendar: month grid or agenda, a period band for coarse dates, the
// Unscheduled tray and an Outside-this-month list. Drag an undated item onto
// a day to give it a date; drag a day date between days to reschedule it
// (kind, time, zone and note are preserved); drag a date to the tray to
// remove it. Every gesture has a menu, keyboard or editor alternative.

import { changeDate, stripDerived } from '../actions.js';
import { openDateEditor } from '../date-editor.js';
import {
  DATE_KINDS, KIND_LABEL, WEEKDAY_SHORT, addDays, dateState, dayNum, formatDay, formatValue, monthGrid,
  monthName, overlaps, pad, periodBounds, relativeDays, shiftMonth, viewerLocalTime,
} from '../dates.js';
import { announce, button, h, icon } from '../dom.js';
import { registerDragType } from '../drag.js';
import { datedEntries, isLive, isOpen, matchesFilters } from '../model.js';
import { sortByPosition } from '../ordering.js';
import { displayToday, displayZone, getItem, isPending, state } from '../state.js';
import { openMenu } from '../ui.js';
import { dateChip, kindIcon, motivationPill } from './common.js';

const MODE_KEY = 'planning.calendar.mode';
const MAX_CHIPS = 3;

const cal = {
  year: null,
  month: null,
  mode: (() => {
    try { return localStorage.getItem(MODE_KEY) || null; } catch { return null; }
  })(),
  kinds: new Set(DATE_KINDS),
  showFinished: false,
};

export function calendarGoTo(iso) {
  cal.year = Number(iso.slice(0, 4));
  cal.month = Number(iso.slice(5, 7));
}

export function renderCalendar(root, ctx) {
  const { today } = ctx;
  if (!cal.year) calendarGoTo(today);
  const mode = cal.mode || (window.matchMedia('(max-width: 760px)').matches ? 'agenda' : 'month');
  const items = state.items.filter((it) => isLive(it) && matchesFilters(it, ctx.filters)
    && (cal.showFinished || isOpen(it)));
  const monthStart = `${cal.year}-${pad(cal.month)}-01`;
  const monthEnd = periodBounds('month', `${cal.year}-${pad(cal.month)}`)[1];
  const entries = datedEntries(items).filter(({ entry }) => cal.kinds.has(entry.kind));

  // Toolbar
  const toolbar = h('div', { class: 'cal-toolbar' });
  const nav = h('div', { class: 'cal-nav' },
    button('Previous month', { icon: 'chevronLeft', iconOnly: true, kind: 'ghost', onClick: () => step(-1, ctx) }),
    button('Today', { kind: 'subtle', onClick: () => { calendarGoTo(today); ctx.rerender(); } }),
    button('Next month', { icon: 'chevronRight', iconOnly: true, kind: 'ghost', onClick: () => step(1, ctx) }),
    h('h2', { class: 'cal-title', 'aria-live': 'polite' }, `${monthName(cal.month)} `, h('span', { class: 'muted', text: String(cal.year) })));
  const modeSwitch = h('div', { class: 'segmented segmented-compact', role: 'group', 'aria-label': 'Calendar layout' });
  for (const [id, label] of [['month', 'Month'], ['agenda', 'Agenda']]) {
    modeSwitch.append(h('button', {
      type: 'button', class: ['seg', mode === id && 'is-selected'], 'aria-pressed': String(mode === id),
      on: { click: () => { cal.mode = id; try { localStorage.setItem(MODE_KEY, id); } catch { /* pref */ } ctx.rerender(); } },
    }, label));
  }
  const kindToggles = h('div', { class: 'kind-toggles', role: 'group', 'aria-label': 'Show date kinds' });
  for (const k of DATE_KINDS) {
    const on = cal.kinds.has(k);
    kindToggles.append(h('button', {
      type: 'button', class: ['kind-toggle', `dk-${k}`, on && 'is-on'], 'aria-pressed': String(on),
      on: { click: () => { if (on) cal.kinds.delete(k); else cal.kinds.add(k); ctx.rerender(); } },
    }, icon(k, { size: 14 }), `${KIND_LABEL[k]}s`));
  }
  const finished = h('label', { class: 'check check-inline' },
    h('input', { type: 'checkbox', checked: cal.showFinished, on: { change: (e) => { cal.showFinished = e.target.checked; ctx.rerender(); } } }),
    h('span', { text: 'Show done & dropped' }));
  toolbar.append(nav, h('div', { class: 'cal-controls' }, modeSwitch, kindToggles, finished));
  root.append(toolbar);

  const layout = h('div', { class: 'cal-layout' });
  const main = h('div', { class: 'cal-main' });

  // Period band: coarse dates overlapping this month, never pinned to a day.
  const monthRange = [monthStart, monthEnd];
  const coarse = entries.filter(({ entry, bounds }) => ['month', 'quarter', 'year'].includes(entry.precision)
    && overlaps(bounds, monthRange));
  const band = h('div', { class: 'period-band', 'aria-label': 'Dates without a set day' },
    h('div', { class: 'band-label' }, icon('calendar', { size: 14 }), h('span', { text: 'This month, no set day' })));
  const bandList = h('div', { class: 'band-list' });
  for (const { item, entry } of coarse) bandList.append(dateEntryChip(item, entry, ctx, { draggable: false, showPeriod: true }));
  if (!coarse.length) bandList.append(h('span', { class: 'muted small', text: 'Month, quarter and year dates appear here.' }));
  band.append(bandList);
  main.append(band);

  if (mode === 'month') main.append(monthView(entries, ctx));
  else main.append(agendaView(entries, ctx, monthRange));
  layout.append(main);

  // Side: Unscheduled tray and Outside this month.
  const side = h('aside', { class: 'cal-side' });
  const undated = sortByPosition(items.filter((it) => !it.dates.length));
  const tray = h('section', { class: 'tray', dataset: { drop: 'cal-tray' }, 'aria-label': 'Unscheduled items' });
  tray.append(h('header', { class: 'tray-head' },
    h('h3', { class: 'section-title' }, icon('inbox', { size: 16 }), h('span', { text: 'Unscheduled' }), h('span', { class: 'count', text: String(undated.length) })),
    h('p', { class: 'tray-hint', text: 'Drag onto a day to add a date, or use Schedule.' })));
  const trayList = h('div', { class: 'tray-list', dataset: { scrollKey: 'tray' } });
  for (const item of undated) {
    const row = h('div', {
      class: ['tray-item', isPending(item.id) && 'is-pending', item.is_example && 'is-example'],
      dataset: { dragType: 'tray-item', id: item.id, focusKey: `tray:${item.id}` },
      tabindex: '0', 'aria-label': `${item.title}, unscheduled. Press Enter to schedule.`,
      on: { keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); schedule(item, today); } } },
    }, h('span', { class: 'grip', 'aria-hidden': 'true' }, icon('grip', { size: 14 })), kindIcon(item.kind, 15),
    h('button', { type: 'button', class: 'tray-title', text: item.title, 'data-drag-handle': '', on: { click: () => ctx.openItem(item.id) } }),
    motivationPill(item.motivation) || '',
    h('button', { type: 'button', class: 'btn btn-subtle btn-xs', text: 'Schedule', on: { click: () => schedule(item, today) } }));
    trayList.append(row);
  }
  if (!undated.length) trayList.append(h('p', { class: 'muted small tray-empty', text: 'Every visible item has a date. Unscheduled is a normal state, too.' }));
  tray.append(trayList, h('div', { class: 'tray-drop-hint', text: 'Drop a date here to remove it' }));
  side.append(tray);

  const outside = outsideEntries(entries, monthRange, today);
  const out = h('section', { class: 'outside' });
  out.append(h('h3', { class: 'section-title' }, icon('clock', { size: 16 }), h('span', { text: 'Outside this month' }), h('span', { class: 'count', text: String(outside.earlier.length + outside.later.length) })));
  if (outside.earlier.length) {
    out.append(h('div', { class: 'outside-group-label', text: 'Earlier, still open' }));
    for (const x of outside.earlier.slice(0, 6)) out.append(outsideRow(x, ctx));
  }
  if (outside.later.length) {
    out.append(h('div', { class: 'outside-group-label', text: 'Later' }));
    for (const x of outside.later.slice(0, 8)) out.append(outsideRow(x, ctx));
  }
  if (!outside.earlier.length && !outside.later.length) out.append(h('p', { class: 'muted small', text: 'No other dates.' }));
  side.append(out);
  layout.append(side);
  root.append(layout);

  root.addEventListener('keydown', (e) => onChipKey(e, ctx));
}

function step(delta, ctx) {
  [cal.year, cal.month] = shiftMonth(cal.year, cal.month, delta);
  ctx.rerender();
}

export function calendarKey(e, ctx) {
  if (e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault();
    step(e.key === 'PageUp' ? -1 : 1, ctx);
    return true;
  }
  return false;
}

function monthView(entries, ctx) {
  const { today } = ctx;
  const weekStart = state.settings.week_start || 'sun';
  const weeks = monthGrid(cal.year, cal.month, weekStart);
  const grid = h('div', { class: 'month', role: 'group', 'aria-label': `${monthName(cal.month)} ${cal.year}` });
  const head = h('div', { class: 'month-head', 'aria-hidden': 'true' });
  const order = weekStart === 'mon' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  for (const d of order) head.append(h('div', { class: 'month-wd', text: WEEKDAY_SHORT[d] }));
  grid.append(head);
  const dayEntries = new Map();
  for (const x of entries) {
    if (x.entry.precision !== 'day') continue;
    const list = dayEntries.get(x.entry.value) || [];
    list.push(x);
    dayEntries.set(x.entry.value, list);
  }
  for (const list of dayEntries.values()) {
    list.sort((a, b) => (a.entry.time || '99').localeCompare(b.entry.time || '99'));
  }
  for (const week of weeks) {
    const row = h('div', { class: 'month-row' });
    const weekEntries = entries.filter(({ entry, bounds }) => entry.precision === 'week'
      && week.includes(bounds[0]));
    if (weekEntries.length) {
      const wb = h('div', { class: 'week-band' });
      for (const { item, entry } of weekEntries) wb.append(dateEntryChip(item, entry, ctx, { draggable: false, showPeriod: true }));
      row.append(wb);
    }
    const cells = h('div', { class: 'month-cells' });
    for (const iso of week) {
      const inMonth = Number(iso.slice(5, 7)) === cal.month;
      const list = dayEntries.get(iso) || [];
      const cell = h('div', {
        class: ['day', !inMonth && 'is-outside', iso === today && 'is-today', dayNum(iso) < dayNum(today) && 'is-past'],
        role: 'group', dataset: { drop: 'cal-day', day: iso },
        'aria-label': `${formatDay(iso, { year: true })}, ${list.length} date${list.length === 1 ? '' : 's'}`,
      });
      const num = h('div', { class: 'day-head' },
        h('span', { class: 'day-num', text: String(Number(iso.slice(8))) }),
        h('button', {
          type: 'button', class: 'day-add btn btn-icon btn-ghost', 'aria-label': `New item on ${formatDay(iso, { year: true })}`,
          title: 'New item on this day', on: { click: () => ctx.openCapture({ date: { kind: 'target', precision: 'day', value: iso } }) },
        }, icon('plus', { size: 14 })));
      cell.append(num);
      const chips = h('div', { class: 'day-chips' });
      list.slice(0, MAX_CHIPS).forEach(({ item, entry }) => chips.append(dateEntryChip(item, entry, ctx, { draggable: true })));
      if (list.length > MAX_CHIPS) {
        chips.append(h('button', {
          type: 'button', class: 'day-more', text: `+${list.length - MAX_CHIPS} more`,
          on: { click: (e) => dayMenu(iso, list, e.currentTarget, ctx) },
        }));
      }
      cell.append(chips);
      cells.append(cell);
    }
    row.append(cells);
    grid.append(row);
  }
  return grid;
}

function agendaView(entries, ctx, monthRange) {
  const { today } = ctx;
  const wrap = h('div', { class: 'agenda' });
  const inMonth = entries.filter(({ entry, bounds }) => (entry.precision === 'day' || entry.precision === 'week')
    && overlaps(bounds, monthRange));
  inMonth.sort((a, b) => dayNum(a.bounds[0]) - dayNum(b.bounds[0]) || (a.entry.time || '99').localeCompare(b.entry.time || '99'));
  if (!inMonth.length) {
    wrap.append(h('p', { class: 'quiet-title agenda-empty', text: `No day or week dates in ${monthName(cal.month)}.` }));
    return wrap;
  }
  let last = null;
  let group = null;
  for (const { item, entry, bounds } of inMonth) {
    const key = bounds[0];
    if (key !== last) {
      last = key;
      const isToday = key === today;
      const label = entry.precision === 'week' ? `Week of ${formatDay(key, { weekday: false, today })}` : formatDay(key, { today });
      group = h('section', { class: ['agenda-day-group', isToday && 'is-today', dayNum(key) < dayNum(today) && 'is-past'], dataset: entry.precision === 'day' ? { drop: 'cal-day', day: key } : { day: key } },
        h('h3', { class: 'agenda-day-label' }, label, h('span', { class: 'muted small', text: isToday ? ' · today' : ` · ${relativeDays(today, key)}` })));
      wrap.append(group);
    }
    const row = h('div', { class: ['agenda-entry', isPending(item.id) && 'is-pending', item.is_example && 'is-example'] },
      dateChip(entry, dateState(entry, today, isOpen(item)), today, { long: true }),
      h('button', { type: 'button', class: 'agenda-title', text: item.title, on: { click: () => ctx.openItem(item.id) } }),
      local(entry),
      h('button', {
        type: 'button', class: 'btn btn-subtle btn-xs', text: 'Reschedule',
        on: { click: () => openDateEditor({ item: getItem(item.id), entry, title: 'Reschedule' }) },
      }));
    group.append(row);
  }
  return wrap;
}

function local(entry) {
  const text = viewerLocalTime(entry, displayZone());
  return text ? h('span', { class: 'muted small', text: `(${text} your time)` }) : '';
}

/** Chip for one date entry; day dates are draggable and keyboard-movable. */
function dateEntryChip(item, entry, ctx, { draggable, showPeriod = false }) {
  const st = dateState(entry, ctx.today, isOpen(item));
  const chip = h('button', {
    type: 'button',
    class: ['cal-chip', `dk-${entry.kind}`, `ds-${st}`, isPending(item.id) && 'is-pending', item.is_example && 'is-example',
      !isOpen(item) && 'is-closed'],
    dataset: { id: item.id, dateId: entry.id, focusKey: `chip:${item.id}:${entry.id}` },
    title: `${item.title} — ${KIND_LABEL[entry.kind]} ${formatValue(entry, ctx.today)}${entry.note ? ` (${entry.note})` : ''}`,
    'aria-label': `${item.title}, ${KIND_LABEL[entry.kind]} ${formatValue(entry, ctx.today)}${st === 'overdue' ? ', overdue' : ''}. ${draggable ? 'Alt+arrow keys move the day. ' : ''}Enter for options.`,
    on: { click: (e) => chipMenu(item, entry, e.currentTarget, ctx) },
  }, icon(entry.kind, { size: 12 }));
  if (entry.time) chip.append(h('span', { class: 'chip-time', text: entry.time }));
  chip.append(h('span', { class: 'chip-title', text: item.title }));
  if (showPeriod) chip.append(h('span', { class: 'chip-period', text: formatValue(entry, ctx.today) }));
  if (draggable) {
    chip.dataset.dragType = 'cal-date';
    chip.dataset.dragHandle = '';
  }
  return chip;
}

function chipMenu(item, entry, anchor, ctx) {
  const latest = getItem(item.id);
  if (!latest) return;
  const isDay = entry.precision === 'day';
  const shift = (n) => moveDateBy(latest, entry, n);
  openMenu({
    anchor,
    label: 'Date options',
    entries: [
      { heading: `${KIND_LABEL[entry.kind]} · ${formatValue(entry, ctx.today)}` },
      { label: 'Open item', icon: 'note', onSelect: () => ctx.openItem(item.id) },
      { label: entry.time ? 'Edit date & time…' : 'Edit date…', icon: 'edit', onSelect: () => openDateEditor({ item: latest, entry }) },
      ...(isDay ? [
        { separator: true },
        { label: 'One day earlier', icon: 'chevronLeft', hint: 'Alt+←', onSelect: () => shift(-1) },
        { label: 'One day later', icon: 'chevronRight', hint: 'Alt+→', onSelect: () => shift(1) },
        { label: 'One week later', icon: 'chevronRight', hint: 'Alt+↓', onSelect: () => shift(7) },
      ] : []),
      { separator: true },
      { label: 'Remove this date', icon: 'trash', danger: true, onSelect: () => removeDate(latest, entry) },
    ],
  });
}

function dayMenu(iso, list, anchor, ctx) {
  openMenu({
    anchor,
    label: `Dates on ${formatDay(iso)}`,
    entries: [{ heading: formatDay(iso, { year: true }) },
      ...list.map(({ item, entry }) => ({
        label: `${entry.time ? `${entry.time} ` : ''}${item.title}`, icon: entry.kind,
        hint: KIND_LABEL[entry.kind], onSelect: () => ctx.openItem(item.id),
      }))],
  });
}

async function moveDateBy(item, entry, days) {
  const value = addDays(entry.value, days);
  await reschedule(item, entry, value);
}

async function reschedule(item, entry, value) {
  if (value === entry.value) return;
  const next = { ...stripDerived(entry), value };
  try {
    await changeDate(item, entry.id, next, {
      label: 'Reschedule',
      message: `Moved “${item.title}” to ${formatDay(value, { year: 'auto', today: displayToday() })}.`,
      project: true,
    });
    announce(`Rescheduled to ${formatDay(value, { year: true })}.`);
  } catch { /* reported */ }
}

async function removeDate(item, entry) {
  try {
    await changeDate(item, entry.id, null, { label: 'Remove date', message: `Removed date from “${item.title}”.`, project: true });
  } catch { /* reported */ }
}

function schedule(item, today) {
  const iso = dayNum(`${cal.year}-${pad(cal.month)}-01`) <= dayNum(today)
    && dayNum(today) <= dayNum(periodBounds('month', `${cal.year}-${pad(cal.month)}`)[1])
    ? today : `${cal.year}-${pad(cal.month)}-01`;
  openDateEditor({ item: getItem(item.id), defaults: { kind: 'target', precision: 'day', value: iso }, title: 'Schedule' });
}

function onChipKey(e, ctx) {
  const chip = e.target.closest('.cal-chip[data-drag-type="cal-date"]');
  if (!chip || !e.altKey) return;
  const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  const delta = deltas[e.key];
  if (!delta) return;
  e.preventDefault();
  const item = getItem(chip.dataset.id);
  const entry = item?.dates.find((d) => d.id === chip.dataset.dateId);
  if (!entry) return;
  ctx.keepFocus(`chip:${item.id}:${entry.id}`);
  const value = addDays(entry.value, delta);
  if (Number(value.slice(5, 7)) !== cal.month || Number(value.slice(0, 4)) !== cal.year) calendarGoTo(value);
  moveDateBy(item, entry, delta);
}

function outsideEntries(entries, monthRange, today) {
  const t = dayNum(today);
  const earlier = [];
  const later = [];
  const seen = new Set();
  const sorted = [...entries].sort((a, b) => dayNum(a.bounds[0]) - dayNum(b.bounds[0]));
  for (const x of sorted) {
    if (overlaps(x.bounds, monthRange)) continue;
    const key = `${x.item.id}:${x.entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (dayNum(x.bounds[1]) < dayNum(monthRange[0])) {
      if (dayNum(x.bounds[1]) < t && isOpen(x.item) && x.entry.kind !== 'event') earlier.push(x);
    } else {
      later.push(x);
    }
  }
  return { earlier: earlier.reverse(), later };
}

function outsideRow({ item, entry, bounds }, ctx) {
  const st = dateState(entry, ctx.today, isOpen(item));
  return h('div', { class: 'outside-row' },
    dateChip(entry, st, ctx.today),
    h('button', { type: 'button', class: 'outside-title', text: item.title, on: { click: () => ctx.openItem(item.id) } }),
    button('Go to month', {
      icon: 'chevronRight', iconOnly: true, kind: 'ghost',
      onClick: () => { calendarGoTo(bounds[0]); ctx.rerender(); },
    }));
}

// ------------------------------------------------------------- drag & drop

let activeCell = null;
let activeTray = null;
function clearDrop() {
  activeCell?.classList.remove('drop-active');
  activeTray?.classList.remove('drop-active');
  activeCell = null;
  activeTray = null;
}

function dayTarget(el) {
  const cell = el.closest('[data-drop="cal-day"]');
  return cell ? { kind: 'day', day: cell.dataset.day, el: cell } : null;
}

function highlight(target) {
  if (!target) {
    clearDrop();
    return;
  }
  if (target.kind === 'tray') {
    if (activeTray !== target.el) { clearDrop(); activeTray = target.el; activeTray.classList.add('drop-active'); }
  } else if (activeCell !== target.el) {
    clearDrop();
    activeCell = target.el;
    activeCell.classList.add('drop-active');
  }
}

registerDragType('tray-item', {
  findTarget: (el) => dayTarget(el),
  indicate(target) {
    highlight(target);
    return target ? `Add a date on ${formatDay(target.day, { year: 'auto', today: displayToday() })}` : null;
  },
  onEnd: clearDrop,
  onRefused: (msg) => announce(msg),
  drop(target, payload, source, point) {
    const item = getItem(payload.id);
    if (!item) return;
    openMenu({
      point,
      label: 'Choose a date kind',
      returnFocus: false,
      entries: [
        { heading: `Add to ${formatDay(target.day, { year: 'auto', today: displayToday() })} as…` },
        ...DATE_KINDS.map((k) => ({
          label: KIND_LABEL[k], icon: k, hint: k === 'target' ? 'default' : null,
          onSelect: async () => {
            try {
              await changeDate(item, null, { kind: k, precision: 'day', value: target.day, note: '' }, {
                label: 'Add date',
                message: `${KIND_LABEL[k]} set for “${item.title}” on ${formatDay(target.day, { year: 'auto', today: displayToday() })}.`,
                project: true,
              });
            } catch { /* reported */ }
          },
        })),
      ],
    });
  },
});

registerDragType('cal-date', {
  findTarget(el) {
    const tray = el.closest('[data-drop="cal-tray"]');
    if (tray) return { kind: 'tray', el: tray };
    return dayTarget(el);
  },
  onStart() {
    document.body.classList.add('dragging-date');
  },
  indicate(target, prev, payload) {
    highlight(target);
    if (!target) return null;
    if (target.kind === 'tray') return 'Remove this date';
    const item = getItem(payload.id);
    const entry = item?.dates.find((d) => d.id === payload.dateId);
    if (entry && entry.value === target.day) return 'Same day';
    return `Move to ${formatDay(target.day, { year: 'auto', today: displayToday() })}${entry?.time ? ` · ${entry.time}` : ''}`;
  },
  onEnd() {
    clearDrop();
    document.body.classList.remove('dragging-date');
  },
  onRefused: (msg) => announce(msg),
  drop(target, payload) {
    const item = getItem(payload.id);
    const entry = item?.dates.find((d) => d.id === payload.dateId);
    if (!entry) return;
    if (target.kind === 'tray') removeDate(item, entry);
    else reschedule(item, entry, target.day);
  },
});

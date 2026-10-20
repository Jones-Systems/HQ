// Building blocks shared by views: cards, chips and pills.

import { KIND_LABEL, formatShort, formatValue, relativeDays, periodBounds } from '../dates.js';
import { h, icon } from '../dom.js';
import {
  HORIZON_LABEL, KIND_META, MOTIVATION_LABEL, PRIORITY_LABEL, STATUS_LABEL, areaHue, cardDate, stepProgress,
} from '../model.js';
import { isPending } from '../state.js';

export function motivationPill(motivation) {
  if (!motivation) return null;
  return h('span', { class: ['pill', `pill-${motivation}`], text: MOTIVATION_LABEL[motivation] });
}

export function horizonChip(horizon) {
  if (!horizon) return null;
  return h('span', { class: ['chip', 'chip-horizon', `hz-${horizon}`], title: 'Horizon' },
    h('span', { class: 'hz-bars', 'aria-hidden': 'true' }), HORIZON_LABEL[horizon]);
}

export function areaTag(area) {
  if (!area) return null;
  const tag = h('span', { class: 'chip chip-area', title: 'Area' },
    h('span', { class: 'area-dot', 'aria-hidden': 'true' }), area);
  tag.style.setProperty('--area-h', String(areaHue(area)));
  return tag;
}

export function priorityMark(priority) {
  if (!priority || priority === 'normal') return null;
  return h('span', { class: ['chip', 'chip-priority', `prio-${priority}`], title: `${PRIORITY_LABEL[priority]} priority` },
    icon(priority === 'high' ? 'arrowUp' : 'arrowDown', { size: 13 }), PRIORITY_LABEL[priority]);
}

export function kindIcon(kind, size = 16) {
  const meta = KIND_META[kind] || KIND_META.idea;
  return icon(meta.icon, { size, label: meta.label, className: `kind-icon kind-${kind}` });
}

const STATE_TEXT = { overdue: 'Overdue', passed: 'Passed', today: 'Today', current: 'This period' };

/** A compact date chip: kind icon, short label, and a textual state where it matters. */
export function dateChip(entry, state, today, { long = false } = {}) {
  const label = long ? formatValue(entry, today) : formatShort(entry, today);
  const chip = h('span', {
    class: ['chip', 'chip-date', `dk-${entry.kind}`, `ds-${state}`, entry.precision !== 'day' && 'is-coarse'],
    title: `${KIND_LABEL[entry.kind]} · ${formatValue(entry, today)}${entry.note ? ` — ${entry.note}` : ''}`,
  }, icon(entry.kind, { size: 13 }));
  if (state === 'overdue') chip.append(h('strong', { text: 'Overdue · ' }));
  else if (state === 'passed' && entry.kind === 'target') chip.append(h('span', { text: 'Target passed · ' }));
  chip.append(label);
  return chip;
}

export function relativeFor(entry, today) {
  const bounds = periodBounds(entry.precision, entry.value);
  if (!bounds) return '';
  if (entry.precision === 'day') return relativeDays(today, bounds[0]);
  return STATE_TEXT.current;
}

/** Board/glance card. Focusable; Enter opens details. */
export function itemCard(item, ctx, { draggable = true, compact = false, showStatus = false } = {}) {
  const pending = isPending(item.id);
  const card = h('article', {
    class: ['card', compact && 'card-compact', pending && 'is-pending', item.is_example && 'is-example',
      item.motivation && `mot-${item.motivation}`, item.archived_at && 'is-archived'],
    tabindex: '0',
    dataset: { id: item.id, focusKey: `card:${item.id}` },
    'aria-label': cardLabel(item, ctx.today),
    'aria-busy': pending ? 'true' : null,
  });
  if (draggable) {
    card.dataset.dragType = 'card';
    card.setAttribute('aria-roledescription', 'draggable card');
  }
  const head = h('div', { class: 'card-head' }, kindIcon(item.kind),
    h('h4', { class: 'card-title', text: item.title }));
  const menuBtn = h('button', {
    type: 'button', class: 'card-menu btn btn-icon btn-ghost', 'aria-label': `Actions for ${item.title}`,
    'aria-haspopup': 'menu', title: 'Move to… (M)', dataset: { cardMenu: item.id },
  }, icon('more', { size: 18 }));
  head.append(menuBtn);
  card.append(head);

  const meta = h('div', { class: 'card-meta' });
  if (showStatus) meta.append(h('span', { class: ['chip', 'chip-status', `st-${item.status}`], text: STATUS_LABEL[item.status] }));
  meta.append(motivationPill(item.motivation) || '', horizonChip(item.horizon) || '', priorityMark(item.priority) || '');
  if (!compact) meta.append(areaTag(item.area) || '');
  if (meta.childNodes.length) card.append(meta);

  const foot = h('div', { class: 'card-foot' });
  const date = cardDate(item, ctx.today);
  if (date) foot.append(dateChip(date.entry, date.state, ctx.today));
  const steps = stepProgress(item);
  if (steps.total) {
    const pct = Math.round((steps.done / steps.total) * 100);
    const meter = h('span', { class: 'steps', title: `${steps.done} of ${steps.total} next steps done` },
      icon('steps', { size: 13 }), `${steps.done}/${steps.total}`);
    const bar = h('span', { class: 'steps-bar', 'aria-hidden': 'true' }, h('span', { class: 'steps-fill' }));
    bar.firstChild.style.width = `${pct}%`;
    meter.append(bar);
    foot.append(meter);
  }
  if (item.notes && item.notes.trim()) foot.append(h('span', { class: 'foot-icon', title: 'Has notes' }, icon('note', { size: 13, label: 'Has notes' })));
  if (item.references.length) {
    foot.append(h('span', { class: 'foot-icon', title: `${item.references.length} reference(s)` },
      icon('link', { size: 13, label: 'References' }), String(item.references.length)));
  }
  if (item.is_example) foot.append(h('span', { class: 'badge-example', text: 'Example' }));
  if (pending) foot.append(h('span', { class: 'pending-note', text: 'Saving…' }));
  if (foot.childNodes.length) card.append(foot);
  return card;
}

function cardLabel(item, today) {
  const parts = [item.title, KIND_META[item.kind]?.label, STATUS_LABEL[item.status]];
  if (item.motivation) parts.push(MOTIVATION_LABEL[item.motivation]);
  if (item.horizon) parts.push(`horizon ${HORIZON_LABEL[item.horizon]}`);
  const date = cardDate(item, today);
  if (date) parts.push(`${KIND_LABEL[date.entry.kind]} ${formatValue(date.entry, today)}${date.state === 'overdue' ? ', overdue' : ''}`);
  if (item.is_example) parts.push('example item');
  return parts.filter(Boolean).join(', ');
}

/** A one-line row used in glance and review lists. */
export function itemRow(item, ctx, { trailing = null, sub = null } = {}) {
  const row = h('button', {
    type: 'button', class: ['row', item.is_example && 'is-example'], dataset: { focusKey: `row:${item.id}` },
    on: { click: () => ctx.openItem(item.id) },
  }, kindIcon(item.kind, 15), h('span', { class: 'row-title', text: item.title }));
  if (sub) row.append(h('span', { class: 'row-sub', text: sub }));
  if (trailing) row.append(h('span', { class: 'row-trailing' }, trailing));
  return row;
}

export function sectionHeader(title, { count = null, iconName = null, action = null } = {}) {
  const head = h('div', { class: 'section-head' });
  const t = h('h3', { class: 'section-title' });
  if (iconName) t.append(icon(iconName, { size: 16 }));
  t.append(h('span', { text: title }));
  if (count !== null) t.append(h('span', { class: 'count', text: String(count) }));
  head.append(t);
  if (action) head.append(action);
  return head;
}

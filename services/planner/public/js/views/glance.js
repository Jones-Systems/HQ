// Glance: the at-a-glance home. Answers "what matters now, what's coming,
// what needs sorting" without opening anything.

import {
  addDays, dateState, dayNum, formatDay, formatLongDay, monthName, relativeDays, zonedParts,
} from '../dates.js';
import { button, h, icon } from '../dom.js';
import {
  CLOSED, STATUSES, datedEntries, isLive, isOpen, matchesFilters, reviewBuckets,
} from '../model.js';
import { sortByPosition } from '../ordering.js';
import { displayZone, state } from '../state.js';
import { emptyState } from '../ui.js';
import { dateChip, itemRow, motivationPill, sectionHeader } from './common.js';

const UPCOMING_DAYS = 21;
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

export function renderGlance(root, ctx) {
  const { today } = ctx;
  const all = state.items.filter(isLive);
  if (!all.length) {
    root.append(welcome(ctx));
    return;
  }
  const items = all.filter((it) => matchesFilters(it, ctx.filters));
  const open = items.filter(isOpen);

  const month = Number(today.slice(5, 7));
  const hero = h('section', { class: 'glance-hero' });
  hero.append(h('p', { class: 'glance-date', text: formatLongDay(today) }));
  hero.append(h('h2', { class: 'glance-heading', text: greeting() }));
  const buckets = reviewBuckets(items, today, state.settings);
  const upcoming = upcomingEntries(open, today);
  const summary = [];
  const activeCount = open.filter((i) => i.status === 'active').length;
  summary.push(`${activeCount} active`);
  if (buckets.overdue.length) summary.push(`${buckets.overdue.length} overdue`);
  summary.push(`${upcoming.length} date${upcoming.length === 1 ? '' : 's'} in the next ${UPCOMING_DAYS} days`);
  if (buckets.inbox.length) summary.push(`${buckets.inbox.length} in Inbox`);
  hero.append(h('p', { class: 'glance-summary', text: summary.join(' · ') }));

  const strip = h('nav', { class: 'status-strip', 'aria-label': 'Items by status' });
  for (const s of STATUSES) {
    if (CLOSED.has(s.id)) continue;
    const count = items.filter((i) => i.status === s.id).length;
    strip.append(h('a', {
      class: ['strip-pill', `st-${s.id}`], href: '#/board',
      on: { click: (e) => { e.preventDefault(); ctx.go('board', { column: s.id }); } },
    }, h('span', { class: 'st-dot', 'aria-hidden': 'true' }), h('span', { class: 'strip-label', text: s.label }),
    h('strong', { text: String(count) })));
  }
  const doneCount = items.filter((i) => i.status === 'done').length;
  strip.append(h('span', { class: 'strip-done', text: `${doneCount} done` }));
  hero.append(strip);
  root.append(hero);

  if (state.drafts.length) root.append(ctx.draftsPanel());

  const grid = h('div', { class: 'glance-grid' });

  // Now
  const now = sortByPosition(open.filter((i) => i.status === 'active' || i.horizon === 'now'))
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
      || (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1));
  const nowPanel = panel('Now', { iconName: 'sparkle', count: now.length, cls: 'panel-now' });
  if (now.length) {
    const list = h('div', { class: 'rows' });
    for (const item of now.slice(0, 8)) {
      const trailing = h('span', { class: 'row-chips' });
      if (item.status === 'active') trailing.append(h('span', { class: 'chip chip-status st-active', text: 'Active' }));
      trailing.append(motivationPill(item.motivation) || '');
      const step = item.next_steps.find((s) => !s.done);
      list.append(itemRow(item, ctx, { trailing, sub: step ? `Next: ${step.text}` : null, scope: 'now' }));
    }
    nowPanel.append(list);
    if (now.length > 8) nowPanel.append(moreLink(`${now.length - 8} more on the board`, () => ctx.go('board')));
  } else {
    nowPanel.append(quiet('Nothing marked Active or Now.', 'Set a horizon of Now or move a card to Active.'));
  }
  grid.append(nowPanel);

  // Coming up
  const comingPanel = panel(`Next ${UPCOMING_DAYS} days`, { iconName: 'calendar', count: upcoming.length + buckets.overdue.length, cls: 'panel-upcoming' });
  const agenda = h('div', { class: 'mini-agenda' });
  if (buckets.overdue.length) {
    const group = h('div', { class: 'agenda-group is-overdue' }, h('div', { class: 'agenda-day', text: 'Overdue' }));
    for (const { item, entry } of buckets.overdue) {
      group.append(itemRow(item, ctx, { trailing: dateChip(entry, 'overdue', today), scope: `overdue:${entry.id}` }));
    }
    agenda.append(group);
  }
  let lastDay = null;
  let group = null;
  for (const { item, entry, start } of upcoming) {
    if (start !== lastDay) {
      lastDay = start;
      const label = start === today ? 'Today' : start === addDays(today, 1) ? 'Tomorrow' : formatDay(start, { today });
      group = h('div', { class: ['agenda-group', start === today && 'is-today'] },
        h('div', { class: 'agenda-day' }, label, h('span', { class: 'agenda-rel', text: start === today || start === addDays(today, 1) ? '' : relativeDays(today, start) })));
      agenda.append(group);
    }
    group.append(itemRow(item, ctx, { trailing: dateChip(entry, dateState(entry, today, true), today), scope: `day:${entry.id}` }));
  }
  const periods = currentPeriodEntries(open, today);
  if (periods.length) {
    const g = h('div', { class: 'agenda-group is-period' }, h('div', { class: 'agenda-day', text: `${monthName(month)} & this quarter — no set day` }));
    for (const { item, entry } of periods) g.append(itemRow(item, ctx, { trailing: dateChip(entry, 'current', today), scope: `period:${entry.id}` }));
    agenda.append(g);
  }
  if (!agenda.childNodes.length) {
    agenda.append(quiet('No dates coming up.', 'Dates are optional. Add one from an item or drag onto the calendar.'));
  }
  comingPanel.append(agenda);
  comingPanel.append(moreLink('Open calendar', () => ctx.go('calendar')));
  grid.append(comingPanel);

  // Inbox
  const inboxPanel = panel('Inbox', { iconName: 'inbox', count: buckets.inbox.length, cls: 'panel-inbox' });
  if (buckets.inbox.length) {
    const list = h('div', { class: 'rows' });
    for (const item of buckets.inbox.slice(0, 6)) list.append(itemRow(item, ctx, { trailing: motivationPill(item.motivation), scope: 'inbox' }));
    inboxPanel.append(list);
    inboxPanel.append(moreLink('Sort in Review', () => ctx.go('review')));
  } else {
    inboxPanel.append(quiet('Inbox is clear.', 'Quick captures land here until you sort them.'));
  }
  grid.append(inboxPanel);

  // Attention
  const attention = buckets.passedTargets.length + buckets.stale.length + buckets.mismatched.length;
  const attnPanel = panel('Worth a look', { iconName: 'review', count: attention, cls: 'panel-attention' });
  if (attention) {
    const list = h('ul', { class: 'attn-list' });
    if (buckets.passedTargets.length) list.append(attnLine(`${buckets.passedTargets.length} target date${buckets.passedTargets.length === 1 ? ' has' : 's have'} passed`, ctx));
    if (buckets.stale.length) list.append(attnLine(`${buckets.stale.length} active item${buckets.stale.length === 1 ? '' : 's'} untouched for ${state.settings.stale_days}+ days`, ctx));
    if (buckets.mismatched.length) list.append(attnLine(`${buckets.mismatched.length} horizon/date mismatch${buckets.mismatched.length === 1 ? '' : 'es'}`, ctx));
    attnPanel.append(list);
  } else {
    attnPanel.append(quiet('Nothing needs a look.', 'Passed targets, quiet active items and horizon mismatches show up here.'));
  }
  grid.append(attnPanel);

  // Recently changed
  const recent = [...items].sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 5);
  const recentPanel = panel('Recently changed', { iconName: 'history', cls: 'panel-recent' });
  const rl = h('div', { class: 'rows' });
  for (const item of recent) rl.append(itemRow(item, ctx, { trailing: h('span', { class: 'muted', text: ago(item.updated_at) }), scope: 'recent' }));
  recentPanel.append(recent.length ? rl : quiet('Nothing matches the filters.', 'Clear a filter to see recent changes.'));
  grid.append(recentPanel);

  root.append(grid);
}

function upcomingEntries(open, today) {
  const end = dayNum(addDays(today, UPCOMING_DAYS));
  const t = dayNum(today);
  return datedEntries(open)
    .filter(({ entry, bounds }) => (entry.precision === 'day' || entry.precision === 'week')
      && dayNum(bounds[0]) <= end && dayNum(bounds[1]) >= t
      && dateState(entry, today, true) !== 'overdue')
    .map((x) => ({ ...x, start: dayNum(x.bounds[0]) < t ? today : x.bounds[0] }))
    .sort((a, b) => dayNum(a.start) - dayNum(b.start) || (a.entry.time || '').localeCompare(b.entry.time || ''));
}

function currentPeriodEntries(open, today) {
  return datedEntries(open).filter(({ entry }) => (entry.precision === 'month' || entry.precision === 'quarter')
    && dateState(entry, today, true) === 'current');
}

function panel(title, { iconName, count = null, cls }) {
  return h('section', { class: ['panel', cls] }, sectionHeader(title, { iconName, count }));
}

function quiet(title, hint) {
  return h('div', { class: 'quiet' }, h('p', { class: 'quiet-title', text: title }), h('p', { class: 'quiet-hint', text: hint }));
}

function moreLink(label, onClick) {
  return h('button', { type: 'button', class: 'more-link', on: { click: onClick } }, label, icon('chevronRight', { size: 14 }));
}

function attnLine(text, ctx) {
  return h('li', null, h('button', { type: 'button', class: 'attn-line', on: { click: () => ctx.go('review') } },
    h('span', { text }), icon('chevronRight', { size: 14 })));
}

function greeting() {
  const hour = zonedParts(new Date(), displayZone()).hour;
  if (hour < 5) return 'Late night planning';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function ago(stamp) {
  const diff = (Date.now() - new Date(stamp).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  const day = zonedParts(stamp, displayZone());
  return day ? formatDay(day.iso, { weekday: false, year: true }) : '';
}

function welcome(ctx) {
  const wrap = h('section', { class: 'welcome' });
  wrap.append(emptyState({
    iconName: 'sparkle',
    title: 'Your planning hub is empty',
    message: 'Capture projects, ideas and goals with just a title. Sort them later on the board, give them a horizon, and add dates only when they help.',
    actions: [
      button('New item', { icon: 'plus', kind: 'primary', onClick: () => ctx.openCapture({}) }),
      button('Load example items', { icon: 'sparkle', onClick: () => ctx.loadExamples() }),
    ],
  }));
  wrap.append(h('p', { class: 'welcome-note', text: 'Example items are clearly marked “Example” and can be removed in one step from Data & settings.' }));
  return wrap;
}

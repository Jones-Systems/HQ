// Vocabulary and pure item helpers shared by every view.

import { dateState, dayNum, periodBounds, primaryDate, todayISO } from './dates.js';
import { sortByPosition } from './ordering.js';

export const STATUSES = [
  { id: 'inbox', label: 'Inbox', hint: 'Captured, not yet sorted' },
  { id: 'considering', label: 'Considering', hint: 'Thinking it over' },
  { id: 'next', label: 'Next', hint: 'Up soon' },
  { id: 'active', label: 'Active', hint: 'In motion now' },
  { id: 'on_hold', label: 'On hold', hint: 'Paused on purpose' },
  { id: 'done', label: 'Done', hint: 'Fulfilled' },
  { id: 'dropped', label: 'Dropped', hint: 'Decided against' },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
export const CLOSED = new Set(['done', 'dropped']);

export const KINDS = [
  { id: 'project', label: 'Project', icon: 'project' },
  { id: 'idea', label: 'Idea', icon: 'idea' },
  { id: 'goal', label: 'Goal', icon: 'goal' },
  { id: 'chore', label: 'Chore', icon: 'chore' },
];
export const KIND_META = Object.fromEntries(KINDS.map((k) => [k.id, k]));

export const MOTIVATIONS = [
  { id: 'need', label: 'Need', hint: 'Has to happen' },
  { id: 'want', label: 'Want', hint: 'Would like to' },
  { id: 'exploring', label: 'Exploring', hint: 'Curious, on the horizon' },
];
export const MOTIVATION_LABEL = Object.fromEntries(MOTIVATIONS.map((m) => [m.id, m.label]));

export const HORIZONS = [
  { id: 'now', label: 'Now', hint: 'This week or two' },
  { id: 'soon', label: 'Soon', hint: 'Coming weeks' },
  { id: 'later', label: 'Later', hint: 'Coming months' },
  { id: 'someday', label: 'Someday', hint: 'No timeframe' },
];
export const HORIZON_LABEL = Object.fromEntries(HORIZONS.map((h) => [h.id, h.label]));

export const PRIORITIES = [
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
];
export const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.label]));

export const REFERENCE_KINDS = [
  { id: 'url', label: 'Link' },
  { id: 'doc', label: 'Document' },
  { id: 'repo', label: 'Repository' },
  { id: 'pr', label: 'Pull request' },
  { id: 'project', label: 'Project' },
  { id: 'workstream', label: 'Workstream' },
  { id: 'other', label: 'Other' },
];
export const REFERENCE_LABEL = Object.fromEntries(REFERENCE_KINDS.map((r) => [r.id, r.label]));

export const isOpen = (item) => !CLOSED.has(item.status);
export const isLive = (item) => !item.archived_at;

export function stepProgress(item) {
  const total = item.next_steps.length;
  return { total, done: item.next_steps.filter((s) => s.done).length };
}

/** Stable hue for an owner-defined area name. */
export function areaHue(area) {
  let h = 0;
  for (const ch of area.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) % 3600;
  return Math.round((h / 10 + 25) % 360);
}

export const EMPTY_FILTERS = Object.freeze({ q: '', area: '', motivation: '', horizon: '', kind: '', priority: '' });

export function activeFilterCount(filters) {
  return ['area', 'motivation', 'horizon', 'kind', 'priority'].filter((k) => filters[k]).length + (filters.q ? 1 : 0);
}

export function matchesFilters(item, filters) {
  if (filters.area && (filters.area === '__none' ? item.area : item.area !== filters.area)) return false;
  for (const key of ['motivation', 'horizon', 'kind', 'priority']) {
    const want = filters[key];
    if (!want) continue;
    if (want === '__none' ? item[key] : item[key] !== want) return false;
  }
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    const hay = [item.title, item.notes, item.area || '',
      ...item.next_steps.map((s) => s.text), ...item.references.map((r) => r.label)].join('\n').toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function areasOf(items) {
  return [...new Set(items.map((i) => i.area).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function columnItems(items, status) {
  return sortByPosition(items.filter((i) => i.status === status));
}

/** Every dated entry with its item, for calendar/agenda/timeline use. */
export function datedEntries(items) {
  const out = [];
  for (const item of items) {
    for (const entry of item.dates) {
      const bounds = periodBounds(entry.precision, entry.value);
      if (bounds) out.push({ item, entry, bounds });
    }
  }
  return out;
}

export function cardDate(item, today) {
  const entry = primaryDate(item.dates, today);
  if (!entry) return null;
  return { entry, state: dateState(entry, today, isOpen(item)) };
}

/** Days since the owner last touched an item (edit or explicit review). */
export function untouchedDays(item, today, zone) {
  const stamp = [item.updated_at, item.reviewed_at].filter(Boolean).sort().pop();
  if (!stamp) return 0;
  return dayNum(today) - dayNum(todayISO(new Date(stamp), zone));
}

/** Review buckets. Gentle prompts only; nothing here changes an item. */
export function reviewBuckets(items, today, settings) {
  const live = items.filter((i) => isLive(i));
  const open = live.filter(isOpen);
  const t = dayNum(today);
  const overdue = [];
  const passedTargets = [];
  for (const item of open) {
    for (const entry of item.dates) {
      const state = dateState(entry, today, true);
      if (state === 'overdue') overdue.push({ item, entry });
      else if (state === 'passed' && entry.kind === 'target') passedTargets.push({ item, entry });
    }
  }
  const staleDays = settings.stale_days || 21;
  const stale = open.filter((i) => i.status === 'active' && untouchedDays(i, today, settings.default_tz) >= staleDays);
  const mismatched = [];
  for (const item of open) {
    const entry = primaryDate(item.dates, today);
    if (!entry || !item.horizon) continue;
    const bounds = periodBounds(entry.precision, entry.value);
    const ahead = dayNum(bounds[0]) - t;
    if (item.horizon === 'now' && ahead > 120) {
      mismatched.push({ item, reason: `Horizon is Now, but its next date is ${Math.round(ahead / 30)} months out.` });
    } else if (item.horizon === 'someday' && entry.kind === 'deadline' && ahead >= 0 && ahead <= 45) {
      mismatched.push({ item, reason: 'Horizon is Someday, but it has a deadline within six weeks.' });
    }
  }
  return {
    inbox: sortByPosition(live.filter((i) => i.status === 'inbox')),
    overdue,
    passedTargets,
    stale,
    mismatched,
    unsorted: open.filter((i) => i.status !== 'inbox' && !i.motivation),
  };
}

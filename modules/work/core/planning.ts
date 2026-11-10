import { addDays, dayNum, monthGrid, periodBounds, resolveZone, todayISO, weekday } from './upstream/manual-planner/dates.js';
import { CLOSED, isLive, isOpen, reviewBuckets, type ReviewBuckets } from './upstream/manual-planner/model.js';
import { anchorsToRestore, sortByPosition } from './upstream/manual-planner/ordering.js';
import type { Anchor } from './port';
import { STATUS_IDS, type Item, type PlanningDate, type Settings, type Status, type WeekStart } from './types';

// Adaptations of the verbatim upstream logic. The display zone and week start
// always come from the Planner settings; nothing here assumes a default.

export {
  addDays, dateState, dayNum, formatClock, formatDay, formatShort, formatStamp, formatValue, isoWeekOf, isoWeekStart,
  periodBounds, primaryDate, relativeDays, valueContaining, viewerLocalTime,
} from './upstream/manual-planner/dates.js';
export {
  activeFilterCount, areasOf, cardDate, columnItems, datedEntries, EMPTY_FILTERS, isLive, isOpen, matchesFilters,
  STATUS_LABEL, type Filters, type ReviewBuckets,
} from './upstream/manual-planner/model.js';
export { anchorsForDrop, projectMove, sortByPosition, stepAnchors } from './upstream/manual-planner/ordering.js';

/** Today's ISO day in the Planner's display zone (`settings.default_tz`). */
export function plannerToday(settings: Pick<Settings, 'default_tz'>, now: Date = new Date()): string {
  return todayISO(now, resolveZone(settings.default_tz));
}

/** Inclusive [first, last] days of the week containing `iso`, honoring `week_start`. */
export function weekBounds(iso: string, weekStart: WeekStart): [string, string] {
  const offset = (weekday(iso) - (weekStart === 'mon' ? 1 : 0) + 7) % 7;
  const first = addDays(iso, -offset);
  return [first, addDays(first, 6)];
}

/** Calendar month grid honoring `week_start`. */
export function plannerMonthGrid(year: number, month: number, settings: Pick<Settings, 'week_start'>): string[][] {
  return monthGrid(year, month, settings.week_start);
}

export function reviewBucketsFor(items: readonly Item[], settings: Settings, now: Date = new Date()): ReviewBuckets {
  return reviewBuckets(items, plannerToday(settings, now), settings);
}

/** Every id in `status`, in stored order (archived items included, as the service orders them). */
export function statusOrder(items: readonly Item[], status: Status): string[] {
  return sortByPosition(items.filter((item) => item.status === status)).map((item) => item.id);
}

/** The anchor that returns `id` to its current place in its status; undo of a move uses it. */
export function restoreAnchor(items: readonly Item[], id: string): Anchor | null {
  const item = items.find((candidate) => candidate.id === id);
  return item ? anchorsToRestore(statusOrder(items, item.status), id) : null;
}

// ------------------------------------------------------------ By date (RV-5)

export const BY_DATE_GROUPS = [
  { id: 'today', label: 'Today', rule: 'A dated day that is today, or an overdue deadline' },
  { id: 'week', label: 'This week', rule: 'A day or week date later in this week' },
  { id: 'later', label: 'Later', rule: 'A later date, or a month, quarter or year period' },
  { id: 'undated', label: 'Undated', rule: 'No current or upcoming date' },
] as const;
export type ByDateGroup = (typeof BY_DATE_GROUPS)[number]['id'];

function ends(entry: PlanningDate): [string, string] | null {
  return periodBounds(entry.precision, entry.value);
}

/**
 * Groups an item from its own dates only. Today: a day date today, or an
 * overdue deadline of an open item. This week: a day or week date whose period
 * ends after today and by the end of the `week_start` week. Later: any other
 * date whose period has not ended. Undated: everything else.
 */
export function byDateGroup(item: Item, today: string, weekStart: WeekStart): ByDateGroup {
  const t = dayNum(today);
  const open = isOpen(item);
  const periods = item.dates.map((entry) => ({ entry, bounds: ends(entry) })).filter((x) => x.bounds !== null) as { entry: PlanningDate; bounds: [string, string] }[];
  if (periods.some(({ entry, bounds }) => (entry.precision === 'day' && entry.value === today)
    || (entry.kind === 'deadline' && open && dayNum(bounds[1]) < t))) return 'today';
  const weekEnd = dayNum(weekBounds(today, weekStart)[1]);
  const ahead = periods.filter(({ bounds }) => dayNum(bounds[1]) >= t);
  if (ahead.some(({ entry, bounds }) => (entry.precision === 'day' || entry.precision === 'week') && dayNum(bounds[1]) <= weekEnd)) return 'week';
  return ahead.length ? 'later' : 'undated';
}

/** Read-only By date board: open, live items grouped by date; Done and Dropped hidden. */
export function groupByDate(items: readonly Item[], settings: Settings, now: Date = new Date()): Record<ByDateGroup, Item[]> {
  const today = plannerToday(settings, now);
  const out: Record<ByDateGroup, Item[]> = { today: [], week: [], later: [], undated: [] };
  const visible = items.filter((item) => isLive(item) && !CLOSED.has(item.status));
  for (const status of STATUS_IDS) {
    for (const item of sortByPosition(visible.filter((candidate) => candidate.status === status))) {
      out[byDateGroup(item, today, settings.week_start)].push(item);
    }
  }
  return out;
}

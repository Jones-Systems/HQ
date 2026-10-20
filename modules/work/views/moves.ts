import {
  addDays, dateState, datedEntries, dayNum, HORIZONS, isOpen, periodBounds, plannerToday, stripDerived, normalizeFields,
  type DateInput, type DateKind, type Horizon, type Item, type ItemPatch, type PlanningDate, type Settings,
} from '../core';

// Pure Planner behaviour for the views: the exact patches the calendar and
// timeline send, and the selections Glance and Calendar show. Nothing here
// writes; the views pass these patches to the store, which offers Undo.

type Entry = { item: Item; entry: PlanningDate; bounds: [string, string] };

/** Planner `changeDate`: the full `dates` list in write form, with one entry replaced, added or removed. */
function datesPatch(item: Item, dateId: string | null, next: DateInput | null): ItemPatch {
  let dates: DateInput[];
  if (next === null) dates = item.dates.filter((d) => d.id !== dateId);
  else if (dateId && item.dates.some((d) => d.id === dateId)) dates = item.dates.map((d) => (d.id === dateId ? { ...next, id: dateId } : d));
  else dates = [...item.dates, next];
  return { dates: dates.map((d) => stripDerived(d as PlanningDate)) };
}

/**
 * Moves one day-precision date by `days` (Planner `moveDateBy`). Kind, time, end time, zone and note are kept;
 * only `value` changes. Returns null for a coarse date, an unknown entry, or no change.
 */
export function shiftDatePatch(item: Item, dateId: string, days: number): ItemPatch | null {
  const entry = item.dates.find((d) => d.id === dateId);
  if (!entry || entry.precision !== 'day' || days === 0) return null;
  return rescheduleDatePatch(item, dateId, addDays(entry.value, days));
}

/** Moves a day-precision date to `day` (a drag onto a calendar day). Null when nothing would change. */
export function rescheduleDatePatch(item: Item, dateId: string, day: string): ItemPatch | null {
  const entry = item.dates.find((d) => d.id === dateId);
  if (!entry || entry.precision !== 'day' || entry.value === day) return null;
  return datesPatch(item, dateId, { ...stripDerived(entry), value: day });
}

/** "Remove this date", or a drop on the Unscheduled tray. */
export function removeDatePatch(item: Item, dateId: string): ItemPatch | null {
  return item.dates.some((d) => d.id === dateId) ? datesPatch(item, dateId, null) : null;
}

/** Scheduling an unscheduled item: a new day-precision date of the chosen kind. The service assigns its id. */
export function addDatePatch(item: Item, kind: DateKind, day: string): ItemPatch {
  return datesPatch(item, null, { kind, precision: 'day', value: day, note: '' });
}

export const DEFAULT_TIMEBOX_MINUTES = 30;
export const GRID_SNAP_MINUTES = 15;

export const clockMinutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const minuteClock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function validDatePatch(item: Item, dateId: string | null, next: DateInput): ItemPatch | null {
  const patch = datesPatch(item, dateId, next);
  return normalizeFields(patch, { creating: false }).ok ? patch : null;
}

/** Wall-clock moves retain the stored zone and optional end; validation rejects DST gaps and crossing midnight. */
export function retimeDatePatch(item: Item, dateId: string, day: string, start: number): ItemPatch | null {
  const entry = item.dates.find((date) => date.id === dateId);
  if (!entry || entry.precision !== 'day' || !entry.time || !entry.tz || !Number.isInteger(start)) return null;
  const duration = entry.end_time ? clockMinutes(entry.end_time) - clockMinutes(entry.time) : DEFAULT_TIMEBOX_MINUTES;
  if (start < 0 || start + duration >= 1440 || (entry.value === day && clockMinutes(entry.time) === start)) return null;
  return validDatePatch(item, dateId, {
    ...stripDerived(entry), value: day, time: minuteClock(start), end_time: entry.end_time ? minuteClock(start + duration) : null,
  });
}

/** New timeboxes default to 30 minutes; resize supplies a duration. Existing dates retain kind, note and zone. */
export function timeboxPatch(item: Item, dateId: string | null, day: string, start: number, zone: string, kind: DateKind = 'target', duration = DEFAULT_TIMEBOX_MINUTES): ItemPatch | null {
  const entry = dateId ? item.dates.find((date) => date.id === dateId) : undefined;
  if ((dateId && !entry) || (entry && entry.precision !== 'day') || !Number.isInteger(start) || !Number.isInteger(duration)
    || start < 0 || duration < GRID_SNAP_MINUTES || start + duration >= 1440) return null;
  const next = { ...(entry ? stripDerived(entry) : { kind, precision: 'day' as const, note: '' }), value: day,
    time: minuteClock(start), end_time: minuteClock(start + duration), tz: entry?.tz || zone };
  if (entry && entry.value === day && entry.time === next.time && entry.end_time === next.end_time) return null;
  return validDatePatch(item, dateId, next);
}

/** Moving into the all-day lane clears all time fields together, without deleting the date. */
export function clearTimePatch(item: Item, dateId: string, day: string): ItemPatch | null {
  const entry = item.dates.find((date) => date.id === dateId);
  if (!entry || entry.precision !== 'day' || (entry.value === day && !entry.time && !entry.end_time && !entry.tz)) return null;
  return validDatePatch(item, dateId, { ...stripDerived(entry), value: day, time: null, end_time: null, tz: null });
}

/** The day the tray's Schedule uses: today when the shown month contains it, else the 1st of that month. */
export function scheduleDay(year: number, month: number, today: string): string {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = periodBounds('month', first.slice(0, 7))![1];
  return dayNum(first) <= dayNum(today) && dayNum(today) <= dayNum(last) ? today : first;
}

/** Keyboard deltas for a focused day chip (Planner `onChipKey`). */
export const CHIP_KEY_DAYS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

// ---------------------------------------------------------------- timeline

/** Timeline lanes in order; the last has no horizon. */
export const TIMELINE_LANES: readonly { id: Horizon | null; label: string; hint: string }[] = [
  ...HORIZONS.map((h) => ({ id: h.id, label: h.label, hint: h.hint })),
  { id: null, label: 'No horizon', hint: 'Not placed yet' },
];

/** Alt+↑ / Alt+↓ on a timeline row: the adjacent lane's horizon, or undefined at either end. */
export function stepHorizon(current: Horizon | null, delta: -1 | 1): Horizon | null | undefined {
  const index = TIMELINE_LANES.findIndex((lane) => lane.id === current) + delta;
  return index < 0 || index >= TIMELINE_LANES.length ? undefined : TIMELINE_LANES[index]!.id;
}

export const TIMELINE_QUARTERS = 8;

/** Eight quarters starting with today's, with their inclusive day bounds. */
export function timelineQuarters(today: string): { value: string; bounds: [string, string] }[] {
  const start = Number(today.slice(0, 4)) * 4 + Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  return Array.from({ length: TIMELINE_QUARTERS }, (_, i) => {
    const value = `${Math.floor((start + i) / 4)}-Q${((start + i) % 4) + 1}`;
    return { value, bounds: periodBounds('quarter', value)! };
  });
}

export interface TimelineMark {
  entry: PlanningDate;
  bounds: [string, string];
  /** `edge`: outside the eight quarters; `marker`: a day; `band`: a coarse period. */
  shape: 'edge-before' | 'edge-after' | 'marker' | 'band';
  left: number;
  width: number;
}

function timelineRange(today: string) {
  const quarters = timelineQuarters(today);
  const rangeStart = dayNum(quarters[0]!.bounds[0]);
  const rangeEnd = dayNum(quarters[quarters.length - 1]!.bounds[1]) + 1;
  const pct = (iso: string, end = false) => ((dayNum(iso) + (end ? 1 : 0) - rangeStart) / (rangeEnd - rangeStart)) * 100;
  return { quarters, rangeStart, rangeEnd, pct };
}

/** The scale row: each quarter's left and width, and today's line, in percent of the eight quarters. */
export function timelineScale(today: string) {
  const { quarters, pct } = timelineRange(today);
  return {
    quarters: quarters.map((q) => ({ ...q, left: pct(q.bounds[0]), width: pct(q.bounds[1], true) - pct(q.bounds[0]) })),
    today: pct(today),
  };
}

/**
 * A row's geometry, in percent of the eight-quarter range. A bar joins a start date to the next later
 * non-start date only when the owner set both ends; nothing gets an invented duration.
 */
export function timelineGeometry(item: Pick<Item, 'dates'>, today: string) {
  const { rangeStart, rangeEnd, pct } = timelineRange(today);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const entries = item.dates.map((entry) => ({ entry, bounds: periodBounds(entry.precision, entry.value) }))
    .filter((x): x is { entry: PlanningDate; bounds: [string, string] } => x.bounds !== null);

  const spans: { left: number; width: number; from: PlanningDate; to: PlanningDate }[] = [];
  for (const s of entries.filter((x) => x.entry.kind === 'start')) {
    const end = entries.filter((x) => x.entry.kind !== 'start' && dayNum(x.bounds[1]) > dayNum(s.bounds[0]))
      .sort((a, b) => dayNum(a.bounds[1]) - dayNum(b.bounds[1]))[0];
    if (!end) continue;
    const left = clamp(pct(s.bounds[0]));
    const right = clamp(pct(end.bounds[1], true));
    if (right <= 0 || left >= 100) continue;
    spans.push({ left, width: Math.max(0.4, right - left), from: s.entry, to: end.entry });
  }

  const marks: TimelineMark[] = entries.map(({ entry, bounds }) => {
    if (dayNum(bounds[1]) < rangeStart) return { entry, bounds, shape: 'edge-before', left: 0, width: 0 };
    if (dayNum(bounds[0]) >= rangeEnd) return { entry, bounds, shape: 'edge-after', left: 100, width: 0 };
    if (entry.precision === 'day') {
      return { entry, bounds, shape: 'marker', left: clamp(pct(bounds[0]) + (pct(bounds[0], true) - pct(bounds[0])) / 2), width: 0 };
    }
    const left = clamp(pct(bounds[0]));
    return { entry, bounds, shape: 'band', left, width: Math.max(0.6, clamp(pct(bounds[1], true)) - left) };
  });

  return { spans, marks };
}

// ------------------------------------------------------------- selections

/** Days ahead in Glance's "Next 21 days" panel. */
export const UPCOMING_DAYS = 21;

/** Day and week dates of open items within the next 21 days, overdue excluded, earliest first. */
export function upcomingEntries(open: readonly Item[], today: string) {
  const end = dayNum(addDays(today, UPCOMING_DAYS));
  const t = dayNum(today);
  return datedEntries(open)
    .filter(({ entry, bounds }) => (entry.precision === 'day' || entry.precision === 'week')
      && dayNum(bounds[0]) <= end && dayNum(bounds[1]) >= t && dateState(entry, today, true) !== 'overdue')
    .map((x) => ({ ...x, start: dayNum(x.bounds[0]) < t ? today : x.bounds[0] }))
    .sort((a, b) => dayNum(a.start) - dayNum(b.start) || (a.entry.time || '').localeCompare(b.entry.time || ''));
}

/** Month and quarter dates of open items whose period contains today. */
export function currentPeriodEntries(open: readonly Item[], today: string) {
  return datedEntries(open).filter(({ entry }) => (entry.precision === 'month' || entry.precision === 'quarter')
    && dateState(entry, today, true) === 'current');
}

/** Planner `outsideEntries`: earlier open non-event dates that ended before today, and later dates. */
export function outsideEntries(entries: readonly Entry[], monthRange: [string, string], today: string) {
  const t = dayNum(today);
  const earlier: Entry[] = [];
  const later: Entry[] = [];
  const seen = new Set<string>();
  const overlaps = (a: [string, string]) => dayNum(a[0]) <= dayNum(monthRange[1]) && dayNum(monthRange[0]) <= dayNum(a[1]);
  for (const x of [...entries].sort((a, b) => dayNum(a.bounds[0]) - dayNum(b.bounds[0]))) {
    if (overlaps(x.bounds)) continue;
    const key = `${x.item.id}:${x.entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (dayNum(x.bounds[1]) < dayNum(monthRange[0])) {
      if (dayNum(x.bounds[1]) < t && isOpen(x.item) && x.entry.kind !== 'event') earlier.push(x);
    } else later.push(x);
  }
  return { earlier: earlier.reverse(), later };
}

/** Planner `untouchedDays`: whole days since the later of `updated_at` and `reviewed_at`, in the display zone. */
export function untouchedDays(item: Item, today: string, settings: Settings): number {
  const stamp = [item.updated_at, item.reviewed_at].filter((s): s is string => Boolean(s)).sort().pop();
  return stamp ? dayNum(today) - dayNum(plannerToday(settings, new Date(stamp))) : 0;
}

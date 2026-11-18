import { calendarGridSnap, calendarZonedParts, CALENDAR_HOUR_HEIGHT, layoutCalendarEvents } from '@hq/ui';
import { addDays, wallTimeToInstant, weekBounds, type Item, type ItemPatch, type PlanningDate, type WeekStart } from '../core';
import { clockMinutes, DEFAULT_TIMEBOX_MINUTES, minuteClock, retimeDatePatch, timeboxPatch } from './moves';

export const HOUR_HEIGHT = CALENDAR_HOUR_HEIGHT;
export type GridEntry = { item: Item; entry: PlanningDate };
export type GridPosition = GridEntry & { start: number; end: number; column: number; columns: number };
export const snapMinute = calendarGridSnap;
export const eventDuration = (entry: PlanningDate): number => entry.time && entry.end_time
  ? clockMinutes(entry.end_time) - clockMinutes(entry.time) : DEFAULT_TIMEBOX_MINUTES;
export function calendarDays(day: string, mode: 'week' | 'day', weekStart: WeekStart): string[] {
  const start = mode === 'week' ? weekBounds(day, weekStart)[0] : day;
  return Array.from({ length: mode === 'week' ? 7 : 1 }, (_, i) => addDays(start, i));
}

const TITLE_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TITLE_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const part = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });

/**
 * The calendar page title for the shown period (X-8): "November 2026", "Nov 1 – 7, 2026" (or "Oct 28 – Nov 3, 2026",
 * and across a year "Dec 28, 2026 – Jan 3, 2027"), and "Wednesday, Oct 21, 2026".
 */
export function periodTitle(mode: 'month' | 'week' | 'day', year: number, month: number, days: readonly string[]): string {
  if (mode === 'month') return `${TITLE_MONTHS[month - 1]} ${year}`;
  const first = part(days[0]!);
  const short = (p: ReturnType<typeof part>) => `${TITLE_MONTHS[p.m - 1]!.slice(0, 3)} ${p.d}`;
  if (mode === 'day') {
    const weekday = TITLE_WEEKDAYS[new Date(Date.UTC(first.y, first.m - 1, first.d)).getUTCDay()]!;
    return `${weekday}, ${short(first)}, ${first.y}`;
  }
  const last = part(days[days.length - 1]!);
  if (first.y !== last.y) return `${short(first)}, ${first.y} – ${short(last)}, ${last.y}`;
  return `${short(first)} – ${first.m === last.m ? last.d : short(last)}, ${last.y}`;
}

export function layoutTimedEntries(entries: readonly GridEntry[], day?: string, zone?: string): GridPosition[] {
  const events = entries.filter(({ entry }) => entry.precision === 'day' && entry.time).map((x) => {
    const interval = zone ? displayedInterval(x.entry, zone) : null;
    const start = interval?.start ?? clockMinutes(x.entry.time!);
    return { id: `${x.item.id}:${x.entry.id}`, title: x.item.title, revision: x.item.revision,
      day: interval?.day ?? x.entry.value, start, endDay: interval?.endDay ?? x.entry.value, end: interval?.end ?? start + eventDuration(x.entry) };
  });
  const days = day ? [day] : [...new Set(events.map((event) => event.day))];
  return days.flatMap((shown) => layoutCalendarEvents(events, shown).map(({ event, ...position }) => ({
    ...entries.find((x) => `${x.item.id}:${x.entry.id}` === event.id)!, ...position,
  })));
}

export const zonedParts = calendarZonedParts;

export function displayedInterval(entry: PlanningDate, zone: string) {
  if (!entry.time || !entry.tz) return null;
  const start = wallTimeToInstant(entry.value, entry.time, entry.tz);
  if (start === null) return null;
  const end = entry.end_time ? wallTimeToInstant(entry.value, entry.end_time, entry.tz) : start + DEFAULT_TIMEBOX_MINUTES * 60000;
  if (end === null) return null;
  const a = zonedParts(start, zone);
  const b = zonedParts(end, zone);
  return { day: a.day, start: a.minute, endDay: b.day, end: b.minute, elapsed: (end - start) / 60000 };
}

/** Resolve the displayed wall time before converting back to the stored zone; gaps and source-midnight crossings are refused. */
export function gridDatePatch(item: Item, entry: PlanningDate, day: string, minute: number, displayZone: string, resize = false): ItemPatch | null {
  if (minute < 0 || minute >= 1440) return null;
  const target = wallTimeToInstant(day, minuteClock(minute), displayZone);
  if (target === null) return null;
  const zone = entry.tz || displayZone;
  const local = zonedParts(target, zone);
  if (!entry.time) return timeboxPatch(item, entry.id, local.day, local.minute, zone);
  const interval = displayedInterval(entry, displayZone);
  if (!interval) return null;
  if (resize) {
    if (local.day !== entry.value) return null;
    return timeboxPatch(item, entry.id, entry.value, clockMinutes(entry.time), zone, entry.kind, local.minute - clockMinutes(entry.time));
  }
  if (!entry.end_time) return retimeDatePatch(item, entry.id, local.day, local.minute);
  const end = zonedParts(target + interval.elapsed * 60000, zone);
  if (local.day !== end.day) return null;
  return timeboxPatch(item, entry.id, local.day, local.minute, zone, entry.kind, end.minute - local.minute);
}

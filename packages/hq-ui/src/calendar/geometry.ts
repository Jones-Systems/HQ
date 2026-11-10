export const CALENDAR_HOUR_HEIGHT = 48;
export const CALENDAR_SNAP_MINUTES = 15;
export const calendarGridSnap = (minute: number): number => Math.round(minute / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES;
export const calendarClock = (minutes: number): string => {
  const minute = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${hour < 12 ? 'a.m.' : 'p.m.'}`;
};
export const calendarDayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 86400000;
export const calendarAddDays = (day: string, delta: number): string => new Date((calendarDayNumber(day) + delta) * 86400000).toISOString().slice(0, 10);

/** Times are wall-clock minutes in the grid's single display zone; the domain owns conversion and saving. */
export interface CalendarGridEvent {
  id: string;
  title: string;
  subtitle?: string;
  day: string;
  start: number;
  endDay: string;
  end: number;
  revision: string | number;
  disabled?: boolean;
  estimated?: boolean;
}
export interface CalendarGridPosition {
  event: CalendarGridEvent;
  start: number;
  end: number;
  column: number;
  columns: number;
  lastSegment: boolean;
}

/** Connected overlap groups share their peak column count; a display-midnight crossing is clipped per day. */
export function layoutCalendarEvents(events: readonly CalendarGridEvent[], day: string): CalendarGridPosition[] {
  const sorted = events.flatMap((event) => {
    const start = (calendarDayNumber(event.day) - calendarDayNumber(day)) * 1440 + event.start;
    const end = (calendarDayNumber(event.endDay) - calendarDayNumber(day)) * 1440 + event.end;
    if (end <= 0 || start >= 1440) return [];
    return [{ event, start: Math.max(0, start), end: Math.min(1440, end), column: 0, columns: 1, lastSegment: end <= 1440 }];
  }).sort((a, b) => a.start - b.start || b.end - a.end || a.event.id.localeCompare(b.event.id));
  let group: CalendarGridPosition[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const finish = () => { for (const event of group) event.columns = ends.length; };
  for (const event of sorted) {
    if (event.start >= groupEnd) { finish(); group = []; ends = []; groupEnd = -1; }
    let column = ends.findIndex((end) => end <= event.start);
    if (column < 0) column = ends.length;
    ends[column] = event.end;
    event.column = column;
    group.push(event);
    groupEnd = Math.max(groupEnd, event.end);
  }
  finish();
  return sorted;
}

export function calendarZonedParts(instant: number | Date, zone: string): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

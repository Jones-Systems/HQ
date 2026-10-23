import { calendar, periodBounds } from './dates.ts';
import { usage } from './transport.ts';
import { conforms } from './schema.ts';
import { dateInput } from './write-schema.ts';
export function requireTimezone(tz: string): string {
  try { if (!tz || tz.length > 64 || /^[+-]/.test(tz)) throw Error(); new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(); return tz; }
  catch { throw usage('Use a supported IANA timezone.', 'tz'); }
}
export function dateToken(token: string, kind?: string): any {
  const match = /^(?:(target|deadline|start|event):)?([^@~]+)(?:@([0-9:]+)(?:-([0-9:]+))?)?(?:~(.+))?$/.exec(token);
  if (!match || (!kind && !match[1])) throw usage('Use --date kind:value[@HH:MM[-HH:MM]][~TZ].', 'date');
  if (kind && match[1]) throw usage('Use a value without a kind for --planned or --due.', 'date');
  return { kind: kind ?? match[1], value: match[2], ...(match[3] ? { time: match[3] } : {}), ...(match[4] ? { end_time: match[4] } : {}), ...(match[5] ? { tz: match[5] } : {}) };
}
function wallExists(value: string, time: string, tz: string): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = (ms: number) => Object.fromEntries(fmt.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  const localMS = (p: Record<string, string>) => Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const desired = Date.parse(value + 'T' + time + ':00Z');
  const offsets = [-86400000, 0, 86400000].map(delta => localMS(parts(desired + delta)) - (desired + delta));
  return offsets.some(offset => localMS(parts(desired - offset)) === desired);
}
export function resolveDates(raw: any[], tz: string, now: Date): { dates: any[]; resolutions: any[] } {
  requireTimezone(tz);
  const { today } = calendar(now, tz, 1);
  const resolutions: any[] = [];
  const ids = new Set<string>();
  const dates = raw.map(entry => {
    if (!conforms(dateInput, entry)) throw usage('Date entry does not match its input schema.', 'dates');
    if (entry.id) { if (ids.has(entry.id)) throw usage('Duplicate date ID.', 'dates'); ids.add(entry.id); }
    const input = entry.value;
    let value = input;
    if (input === 'today' || input === 'tomorrow' || /^\+\d+d$/.test(input)) {
      const days = input === 'today' ? 0 : input === 'tomorrow' ? 1 : Number(input.slice(1, -1));
      if (!Number.isSafeInteger(days) || days > 100000) throw usage('Relative date is outside the supported calendar range.');
      value = new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    }
    const precision = entry.precision ?? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? 'day' : /^\d{4}-W\d{2}$/.test(value) ? 'week' : /^\d{4}-\d{2}$/.test(value) ? 'month' : /^\d{4}-Q[1-4]$/.test(value) ? 'quarter' : /^\d{4}$/.test(value) ? 'year' : undefined);
    if (!precision) throw usage('Use a calendar date, today, tomorrow or +Nd. Resolve weekday names with hq planner now.', 'dates');
    try { periodBounds(precision, value); } catch { throw usage('Invalid calendar date or precision.', 'dates'); }
    const time = entry.time ?? null;
    const end = entry.end_time ?? null;
    const zone = time ? requireTimezone(entry.tz ?? tz) : null;
    if (time !== null) {
      if (precision !== 'day' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !wallExists(value, time, zone!)) throw usage('Timed dates require a real day and a wall time that exists in the timezone.', 'dates');
      if (end !== null && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= time || !wallExists(value, end, zone!))) throw usage('End time must exist and follow the start on the same day.', 'dates');
    } else if (end !== null) throw usage('End time requires a start time.', 'dates');
    resolutions.push({ input, resolved: value, tz: zone ?? tz, today });
    return { ...(entry.id ? { id: entry.id } : {}), kind: entry.kind, precision, value, time, end_time: end, tz: zone, note: entry.note ?? '' };
  });
  return { dates, resolutions };
}

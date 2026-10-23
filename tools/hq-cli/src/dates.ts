import { CliError, usage } from './transport.ts';
export function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2200 && !Number.isNaN(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export const addDays = (value: string, count: number) => new Date(Date.parse(value + 'T00:00:00Z') + count * 86400000).toISOString().slice(0, 10);
export function requireDay(value: string, field: string): string {
  if (!validDay(value)) throw usage('Use a valid YYYY-MM-DD from 1900 through 2200. Resolve weekday names with hq planner now.', field);
  return value;
}
export function todayInZone(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (key: string) => parts.find(p => p.type === key)!.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch { throw new CliError('bad_response', 'Planner default_tz is not a supported timezone.', 6); }
}
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export function calendar(now: Date, tz: string, days = 14) {
  const today = todayInZone(now, tz);
  const entries = Array.from({ length: days }, (_, index) => { const date = addDays(today, index); return { date, weekday: WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()] }; });
  return { tz, today, tomorrow: addDays(today, 1), observed_at: now.toISOString(), days: entries, weekdays: Object.fromEntries(WEEKDAYS.map(weekday => [weekday, entries.filter(e => e.weekday === weekday).map(e => e.date)])) };
}
export function periodBounds(precision: string, value: string): [string, string] {
  const invalid = () => new CliError('bad_response', 'Planner returned an invalid date value or precision.', 6);
  const year = Number(value.slice(0, 4));
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw invalid();
  if (precision === 'day' && validDay(value)) return [value, value];
  if (precision === 'year' && /^\d{4}$/.test(value)) return [`${value}-01-01`, `${value}-12-31`];
  if (precision === 'week' && /^\d{4}-W\d{2}$/.test(value)) {
    const week = Number(value.slice(6));
    const jan4 = `${year}-01-04`;
    const monday = addDays(jan4, -((new Date(jan4 + 'T00:00:00Z').getUTCDay() + 6) % 7));
    const start = addDays(monday, (week - 1) * 7);
    if (week >= 1 && week <= 53 && Number(addDays(start, 3).slice(0, 4)) === year) return [start, addDays(start, 6)];
  }
  let month: number | undefined;
  let span = 1;
  if (precision === 'month' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) month = Number(value.slice(5));
  if (precision === 'quarter' && /^\d{4}-Q[1-4]$/.test(value)) { month = (Number(value.slice(6)) - 1) * 3 + 1; span = 3; }
  if (month !== undefined) return [new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10), new Date(Date.UTC(year, month - 1 + span, 0)).toISOString().slice(0, 10)];
  throw invalid();
}
export function checkDates(items: any[]): void {
  for (const item of items) for (const date of item.dates) {
    periodBounds(date.precision, date.value);
    if (date.time !== null) {
      if (date.precision !== 'day' || !date.tz || !date.instant || !date.tz_abbr || (date.end_time !== null && (date.end_time <= date.time || !date.end_instant))) throw new CliError('bad_response', 'Planner returned inconsistent timed date fields.', 6);
      todayInZone(new Date(date.instant), date.tz);
    } else if (date.end_time !== null || date.tz !== null || date.instant || date.end_instant || date.tz_abbr) throw new CliError('bad_response', 'Planner returned time fields on an untimed date.', 6);
  }
}

import { FEATURE_HQ_EDITORIAL_TIMEBOX, type PlanningSlot } from './port';
import { isJsonObject, isPlanningDate, type Checked } from './validate';

export const SLOT_MESSAGES = {
  unsupported: 'Timed planning needs a newer Social service',
  date: 'Planning time needs a planning date',
  shape: 'Planning time must have start, duration_minutes and timezone',
  start: 'Use an HH:MM start on a 15-minute boundary',
  duration: 'Duration must be 15-minute steps ending by midnight',
  zone: 'Unknown time zone',
  dst: 'That time is skipped, repeated or crosses a daylight-saving change',
} as const;
const invalid = (message: string): Checked<never> => ({ ok: false, error: { kind: 'invalid', message } });
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let value = formatters.get(zone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    // Bound the cache even when an untrusted service varies valid zone aliases.
    if (formatters.size >= 128) formatters.clear();
    formatters.set(zone, value);
  }
  return value;
}

export function slotZoneValid(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/u.test(value)) return false;
  try { formatter(value); return true; } catch { return false; }
}

export function zonedSlotParts(instant: number, zone: string): { date: string; minute: number; second: number } {
  const parts = formatter(zone).formatToParts(instant);
  const get = (key: string) => parts.find((part) => part.type === key)!.value;
  return { date: `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')), second: Number(get('second')) };
}

export function slotWallEpoch(date: string, minute: number): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, minute, 0, 0);
  return value.getTime();
}

/** Return only a unique wall-clock instant. Both sides of a zone transition must round-trip. */
export function slotInstant(date: string, minute: number, zone: string): number | null {
  if (!isPlanningDate(date) || !Number.isInteger(minute) || minute < 0 || minute >= 1440 || !slotZoneValid(zone)) return null;
  const wall = slotWallEpoch(date, minute);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = wall + hours * 3_600_000;
    const parts = zonedSlotParts(sample, zone);
    offsets.add(slotWallEpoch(parts.date, parts.minute) + parts.second * 1000 - sample);
  }
  const matches = [...offsets].map((offset) => wall - offset).filter((instant) => {
    const parts = zonedSlotParts(instant, zone);
    return parts.date === date && parts.minute === minute && parts.second === 0;
  });
  return matches.length === 1 ? matches[0]! : null;
}

export const slotStartMinute = (slot: PlanningSlot): number => Number(slot.start.slice(0, 2)) * 60 + Number(slot.start.slice(3));
export const slotClock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Capability-aware canonical request value. New clients send null explicitly when no time is set. */
export function checkSlot(value: unknown, date: string, features: readonly string[]): Checked<PlanningSlot | null | undefined> {
  if (!features.includes(FEATURE_HQ_EDITORIAL_TIMEBOX)) return value == null ? { ok: true, value: undefined } : invalid(SLOT_MESSAGES.unsupported);
  if (value == null) return { ok: true, value: null };
  if (!date) return invalid(SLOT_MESSAGES.date);
  if (!isJsonObject(value) || Object.keys(value).length !== 3 || !['start', 'duration_minutes', 'timezone'].every((key) => Object.hasOwn(value, key))) return invalid(SLOT_MESSAGES.shape);
  if (typeof value.start !== 'string' || !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/u.test(value.start)) return invalid(SLOT_MESSAGES.start);
  const start = Number(value.start.slice(0, 2)) * 60 + Number(value.start.slice(3));
  const duration = value.duration_minutes;
  if (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration < 15 || duration % 15 !== 0 || start + duration > 1440) return invalid(SLOT_MESSAGES.duration);
  if (!slotZoneValid(value.timezone)) return invalid(SLOT_MESSAGES.zone);
  const first = slotInstant(date, start, value.timezone);
  const last = slotInstant(date, start + duration - 1, value.timezone);
  if (first === null || last === null || last - first !== (duration - 1) * 60_000) return invalid(SLOT_MESSAGES.dst);
  return { ok: true, value: { start: value.start, duration_minutes: duration, timezone: value.timezone } };
}

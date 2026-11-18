import type { CalendarGridEvent } from '@hq/ui';
import { checkSlot, FEATURE_HQ_EDITORIAL_TIMEBOX, SLOT_MESSAGES, slotClock, slotInstant, slotStartMinute, slotWallEpoch, zonedSlotParts,
  type Checked, type Draft, type PlanningSlot } from '../core';

export interface CalendarPlanning { planned_date: string; planning_slot: PlanningSlot | null }
export function shiftCalendarDay(day: string, delta: number): string {
  return new Date(slotWallEpoch(day, 0) + delta * 86_400_000).toISOString().slice(0, 10);
}
export function calendarRange(day: string, view: 'week' | 'day'): string[] {
  const start = view === 'week' ? shiftCalendarDay(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7)) : day;
  return Array.from({ length: view === 'week' ? 7 : 1 }, (_, index) => shiftCalendarDay(start, index));
}
export function draftGridEvent(draft: Draft, zone: string, disabled = false): CalendarGridEvent | null {
  const slot = draft.planning_slot;
  if (!slot || draft.archived) return null;
  const instant = slotInstant(draft.planned_date, slotStartMinute(slot), slot.timezone);
  if (instant === null) return null;
  const first = zonedSlotParts(instant, zone);
  const end = zonedSlotParts(instant + slot.duration_minutes * 60_000, zone);
  return { id: draft.id, title: draft.title, subtitle: draft.channel, day: first.date, start: first.minute,
    endDay: end.date, end: end.minute, revision: draft.version, disabled };
}

/** Grid coordinates are display-zone wall time; saves preserve an existing slot's owning zone. */
export function gridPlanning(draft: Draft, day: string, minute: number, resize: boolean, displayZone: string): Checked<CalendarPlanning> {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440 || (!resize && minute === 1440)) {
    return { ok: false, error: { kind: 'invalid', message: SLOT_MESSAGES.duration } };
  }
  const targetDay = minute === 1440 ? shiftCalendarDay(day, 1) : day;
  const instant = slotInstant(targetDay, minute === 1440 ? 0 : minute, displayZone);
  if (instant === null) return { ok: false, error: { kind: 'invalid', message: SLOT_MESSAGES.dst } };
  const zone = draft.planning_slot?.timezone ?? displayZone;
  const target = zonedSlotParts(instant, zone);
  const date = resize ? draft.planned_date : target.date;
  const start = resize && draft.planning_slot ? slotStartMinute(draft.planning_slot) : target.minute;
  const duration = resize ? (slotWallEpoch(target.date, target.minute) - slotWallEpoch(date, start)) / 60_000
    : draft.planning_slot?.duration_minutes ?? Math.min(30, 1440 - start);
  const slot = checkSlot({ start: slotClock(start), duration_minutes: duration, timezone: zone }, date, [FEATURE_HQ_EDITORIAL_TIMEBOX]);
  return slot.ok ? { ok: true, value: { planned_date: date, planning_slot: slot.value ?? null } } : slot;
}

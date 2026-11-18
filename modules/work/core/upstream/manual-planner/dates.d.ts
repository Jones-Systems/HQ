// Hand-written declarations for the verbatim upstream dates.js (see PROVENANCE.md).

export type DateKindId = 'target' | 'deadline' | 'start' | 'event';
export type PrecisionId = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type DateState = 'overdue' | 'passed' | 'current' | 'today' | 'upcoming';
export type Period = [first: string, last: string];

/** The shape these helpers read; the HQ `PlanningDate` satisfies it. */
export interface DateEntryLike {
  kind: string;
  precision: string;
  value: string;
  time?: string | null;
  end_time?: string | null;
  tz?: string | null;
  instant?: string;
  tz_abbr?: string;
}

export const DATE_KINDS: DateKindId[];
export const KIND_LABEL: Record<DateKindId, string>;
export const KIND_HINT: Record<DateKindId, string>;
export const PRECISIONS: PrecisionId[];
export const PRECISION_LABEL: Record<PrecisionId, string>;
export const DEFAULT_DISPLAY_ZONE: string;
export const WEEKDAY_SHORT: string[];

export function pad(n: number, w?: number): string;
export function dayNum(iso: string): number;
export function isoFromNum(n: number): string;
export function addDays(iso: string, n: number): string;
export function weekday(iso: string): number;
export function resolveZone(zone: unknown): string;
export function zonedParts(instant: Date | string | number, zone?: string): { iso: string; hour: number; minute: number; abbr: string } | null;
export function todayISO(now?: Date, zone?: string): string;
export function formatClock(instant: Date | string | number, zone?: string): string;
export function formatStamp(instant: Date | string | number, zone?: string, options?: { year?: boolean }): string;
export function formatLongDay(iso: string): string;
export function isoWeekStart(year: number, week: number): string;
export function isoWeekOf(iso: string): string;
export function monthValueOf(iso: string): string;
export function quarterValueOf(iso: string): string;
export function periodBounds(precision: string, value: unknown): Period | null;
export function valueContaining(precision: string, iso: string): string;
export function formatTime(hhmm: string | null | undefined): string;
export function formatDay(iso: string, options?: { year?: boolean | 'auto'; weekday?: boolean; today?: string | null }): string;
export function monthName(month: number): string;
export function formatValue(entry: DateEntryLike, today?: string | null): string;
export function formatShort(entry: DateEntryLike, today?: string | null): string;
export function viewerLocalTime(entry: DateEntryLike, viewerZone: string): string;
export function relativeDays(fromIso: string, toIso: string): string;
export function dateState(entry: DateEntryLike, today: string, itemOpen?: boolean): DateState;
export function primaryDate<T extends DateEntryLike>(dates: readonly T[] | null | undefined, today: string): T | null;
export function monthGrid(year: number, month: number, weekStart?: 'sun' | 'mon'): string[][];
export function shiftMonth(year: number, month: number, delta: number): [year: number, month: number];
export function overlaps(a: readonly [string, string], b: readonly [string, string]): boolean;
export function defaultValueFor(precision: string, iso: string): string;

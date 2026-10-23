import { CHANNELS, type Channel, type Draft } from '../core';

/** Module-local content destinations (spec.hq-social-work#ctx.social-design-reconciliation.001). */
export type ContentLocation =
  | { readonly page: 'library'; readonly draftId?: string }
  | { readonly page: 'calendar'; readonly month?: string };

/** `library/new` opens an unsaved new draft. Stored draft IDs are 32 hex characters, so they never collide. */
export const NEW_DRAFT_KEY = 'new';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/u;

export function isMonth(value: string): boolean {
  return MONTH.test(value) && value >= '0001-01';
}

export function parseContentDestination(destination: string): ContentLocation | null {
  const [page, rest, ...extra] = destination.split('/');
  if (extra.length) return null;
  if (page === 'library') {
    if (rest === undefined) return { page };
    return SEGMENT.test(rest) ? { page, draftId: rest } : null;
  }
  if (page === 'calendar') {
    if (rest === undefined) return { page };
    return isMonth(rest) ? { page, month: rest } : null;
  }
  return null;
}

export function contentDestination(location: ContentLocation): string {
  if (location.page === 'library') return location.draftId ? `library/${location.draftId}` : 'library';
  return location.month ? `calendar/${location.month}` : 'calendar';
}

// ── Library filters ────────────────────────────────────────────────────────────

export interface LibraryFilters {
  readonly brand: string; // 'all' or a brand ID
  readonly channel: 'all' | Channel;
  readonly planned: 'all' | 'planned' | 'unplanned';
  readonly archived: 'active' | 'archived' | 'all';
  readonly query: string;
}

export const DEFAULT_FILTERS: LibraryFilters = { brand: 'all', channel: 'all', planned: 'all', archived: 'active', query: '' };

export function isLibraryFilters(value: unknown): value is LibraryFilters {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.brand === 'string' && (v.channel === 'all' || (CHANNELS as readonly unknown[]).includes(v.channel))
    && ['all', 'planned', 'unplanned'].includes(v.planned as string)
    && ['active', 'archived', 'all'].includes(v.archived as string) && typeof v.query === 'string';
}

export function filterDrafts(drafts: readonly Draft[], filters: LibraryFilters): Draft[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return drafts.filter((draft) => (filters.brand === 'all' || draft.brand_id === filters.brand)
    && (filters.channel === 'all' || draft.channel === filters.channel)
    && (filters.planned === 'all' || (filters.planned === 'planned') === (draft.planned_date !== ''))
    && (filters.archived === 'all' || (filters.archived === 'archived') === (draft.archived === 1))
    && (!query || draft.title.toLocaleLowerCase().includes(query) || draft.body.toLocaleLowerCase().includes(query)));
}

// ── Calendar ───────────────────────────────────────────────────────────────────

export interface CalendarDay {
  readonly date: string;
  readonly inMonth: boolean;
  readonly isToday: boolean;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function isoDate(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The local calendar date, which is what a person means by "today". */
export function localToday(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, m - 1 + delta, 1);
  return isoDate(date).slice(0, 7);
}

/** Weeks of a month, Monday first, padded with the neighbouring months' days. */
export function monthGrid(month: string, today: string): CalendarDay[][] {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(2000, 0, 1));
  first.setUTCFullYear(year, m - 1, 1);
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);
  do {
    const week: CalendarDay[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = isoDate(cursor);
      week.push({ date, inMonth: date.slice(0, 7) === month, isToday: date === today });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (isoDate(cursor).slice(0, 7) === month);
  return weeks;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

/** "24 Oct 2026". A planned date is an editorial label, never a schedule. */
export function dateLabel(date: string): string {
  const [year, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1]!.slice(0, 3)} ${year}`;
}

export interface CalendarPlan {
  readonly byDate: ReadonlyMap<string, readonly Draft[]>;
  readonly undated: readonly Draft[];
}

/** Active (not archived) drafts, optionally for one brand, split by planned date. */
export function calendarPlan(drafts: readonly Draft[], brand: string): CalendarPlan {
  const byDate = new Map<string, Draft[]>();
  const undated: Draft[] = [];
  for (const draft of drafts) {
    if (draft.archived === 1 || (brand !== 'all' && draft.brand_id !== brand)) continue;
    if (!draft.planned_date) undated.push(draft);
    else byDate.set(draft.planned_date, [...(byDate.get(draft.planned_date) ?? []), draft]);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.title.localeCompare(b.title));
  undated.sort((a, b) => a.title.localeCompare(b.title));
  return { byDate, undated };
}

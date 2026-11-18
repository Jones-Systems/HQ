import type { SaveState, StatusTone } from '@hq/ui';
import { saveStateOf } from '../content';
import { isActiveRun, type Draft, type DraftEditor, type RunRecord, type WorkspaceSnapshot } from '../core';

/** Pure selection for the Overview: what is next, what needs attention and how to say when. */

export const LIST_LIMIT = 5;
export const ATTENTION_LIMIT = 6;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Parts of a planned date for the date tile: weekday, day and month. A planned date is an editorial label. */
export function dateParts(date: string): { readonly weekday: string; readonly day: number; readonly month: string } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { weekday: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!, day, month: MONTHS[month - 1]! };
}

/** "Sat 24 Oct", with the year when it isn't this year. */
export function plannedLabel(date: string, today: string): string {
  const { weekday, day, month } = dateParts(date);
  const year = date.slice(0, 4);
  return `${weekday} ${day} ${month}${year === today.slice(0, 4) ? '' : ` ${year}`}`;
}

/** "Today", "Tomorrow", "in 4 days", "Yesterday", "6 days ago". */
export function relativeDay(date: string, today: string): string {
  const diff = dayNumber(date) - dayNumber(today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export interface NextUp {
  readonly drafts: readonly Draft[];
  /** True when nothing is planned from today on, so these are the nearest past dates. */
  readonly past: boolean;
}

/** Active, planned drafts in date order from today on; when none, the nearest past ones (most recent first). */
export function nextUp(drafts: readonly Draft[], brandId: string | null, today: string): NextUp {
  const planned = drafts.filter((draft) => draft.archived === 0 && draft.planned_date !== '' && (!brandId || draft.brand_id === brandId));
  const byDate = (a: Draft, b: Draft) => a.planned_date.localeCompare(b.planned_date) || a.title.localeCompare(b.title);
  const upcoming = planned.filter((draft) => draft.planned_date >= today).sort(byDate);
  if (upcoming.length) return { drafts: upcoming.slice(0, LIST_LIMIT), past: false };
  return { drafts: planned.sort((a, b) => byDate(b, a)).slice(0, LIST_LIMIT), past: true };
}

export type AttentionItem =
  | { readonly kind: 'unsaved'; readonly key: string; readonly editor: DraftEditor; readonly save: SaveState }
  | { readonly kind: 'failed' | 'interrupted' | 'unknown'; readonly run: RunRecord };

/**
 * What needs the user, by consequence: unsaved drafts (text that exists nowhere else), then failed runs, then
 * interrupted ones, then runs whose status can't be confirmed because the workspace wasn't refreshed.
 * Unsaved drafts come from the session's open editors; a calendar move's internal editor is not a draft.
 */
export function attentionItems(
  snapshot: WorkspaceSnapshot, editors: Readonly<Record<string, DraftEditor>>, brandId: string | null, offline: boolean,
): readonly AttentionItem[] {
  const unsaved = Object.entries(editors)
    .filter(([key, editor]) => !key.startsWith('change:') && (!brandId || editor.fields.brand_id === brandId) && saveStateOf(editor) !== 'saved')
    .map(([key, editor]): AttentionItem => ({ kind: 'unsaved', key, editor, save: saveStateOf(editor) }));
  const runs = (kind: 'failed' | 'interrupted') => snapshot.runs.filter((run) => run.status === kind).map((run): AttentionItem => ({ kind, run }));
  // A run last seen queued or running while the service is unreachable has an unknown status (RX-5).
  const unknown = offline ? snapshot.runs.filter(isActiveRun).map((run): AttentionItem => ({ kind: 'unknown', run })) : [];
  return [...unsaved, ...runs('failed'), ...runs('interrupted'), ...unknown];
}

export function unsavedLabel(editor: DraftEditor, save: SaveState): { readonly tone: StatusTone; readonly label: string; readonly meta: string } {
  if (editor.status === 'conflict') return { tone: 'warning', label: 'Changed elsewhere', meta: 'Your text is kept in this session' };
  switch (save) {
    case 'saving': return { tone: 'info', label: 'Saving', meta: 'Kept in this session until it is saved' };
    case 'failed': return { tone: 'danger', label: 'Not saved', meta: 'Your text is kept in this session' };
    case 'unknown': return { tone: 'unknown', label: 'Save result unknown', meta: 'Check before saving again' };
    default: return { tone: 'warning', label: 'Unsaved changes', meta: 'Kept in this session until it is saved' };
  }
}

/** A short "when": the time today, "Yesterday", otherwise "Oct 19". */
export function whenLabel(iso: string, now: Date): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return iso;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(time, now)) return time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(time, yesterday)) return 'Yesterday';
  return time.toLocaleDateString([], { month: 'short', day: 'numeric', ...(time.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

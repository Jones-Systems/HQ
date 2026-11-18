import type { ReferenceId } from '../../../references/src/contract.ts';
import type { ScreenshotImportResult } from './env.ts';
import type { SelectedImageFile } from './images.ts';

/** Where each queued image stands. `kept-existing` covers both a duplicate and a previously removed image. */
export const QUEUE_STATUSES = ['waiting', 'importing', 'saved', 'kept-existing', 'failed', 'unknown'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const QUEUE_STATUS_LABELS: Readonly<Record<QueueStatus, string>> = {
  waiting: 'Waiting', importing: 'Importing', saved: 'Saved', 'kept-existing': 'Kept existing', failed: 'Failed', unknown: 'Unknown',
};

export interface QueueItem {
  readonly id: string;
  readonly file: SelectedImageFile;
  readonly name: string;
  readonly status: QueueStatus;
  /** What happened, for a row that is not simply waiting or saved. */
  readonly message: string | null;
  readonly referenceId: ReferenceId | null;
  /** The title the image was saved under. */
  readonly title: string | null;
  /** A small `data:` preview; null when none could be made, undefined until one has been tried. */
  readonly thumbnail: string | null | undefined;
}

export interface QueueState {
  readonly items: readonly QueueItem[];
  /** The item the form is filling in. */
  readonly currentId: string | null;
}

export const EMPTY_QUEUE: QueueState = { items: [], currentId: null };

export type QueueAction =
  | { readonly type: 'add'; readonly items: readonly QueueItem[] }
  | { readonly type: 'remove'; readonly id: string }
  | { readonly type: 'status'; readonly id: string; readonly status: QueueStatus; readonly message?: string | null; readonly referenceId?: ReferenceId | null; readonly title?: string | null }
  | { readonly type: 'thumbnail'; readonly id: string; readonly url: string | null }
  | { readonly type: 'current'; readonly id: string | null }
  | { readonly type: 'retry'; readonly id: string }
  /** After an item settles: keep the current item if it can still be imported, else move to the next waiting one. */
  | { readonly type: 'advance' }
  | { readonly type: 'clear' };

/** Items that can still be imported by the form: not yet tried, or tried and rejected. */
const editable = (item: QueueItem) => item.status === 'waiting' || item.status === 'failed';

export function firstWaiting(state: QueueState): QueueItem | undefined {
  return state.items.find((item) => item.status === 'waiting');
}

export function currentItem(state: QueueState): QueueItem | undefined {
  return state.items.find((item) => item.id === state.currentId);
}

/** The item the form should fill in after a change: keep a valid current one, else the first waiting, else none. */
function settle(items: readonly QueueItem[], currentId: string | null): QueueState {
  const kept = items.find((item) => item.id === currentId);
  if (kept && editable(kept)) return { items, currentId };
  return { items, currentId: items.find((item) => item.status === 'waiting')?.id ?? null };
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'add': {
      if (action.items.length === 0) return state;
      const items = [...state.items, ...action.items];
      // A new image becomes current only when the form has nothing to fill in.
      return settle(items, state.currentId);
    }
    case 'remove': {
      const items = state.items.filter((item) => item.id !== action.id);
      return items.length === state.items.length ? state : settle(items, state.currentId === action.id ? null : state.currentId);
    }
    case 'status': {
      const items = state.items.map((item) => item.id !== action.id ? item : {
        ...item, status: action.status,
        message: action.message === undefined ? item.message : action.message,
        referenceId: action.referenceId === undefined ? item.referenceId : action.referenceId,
        title: action.title === undefined ? item.title : action.title,
      });
      return { items, currentId: state.currentId };
    }
    case 'thumbnail':
      return { items: state.items.map((item) => item.id === action.id ? { ...item, thumbnail: action.url } : item), currentId: state.currentId };
    case 'current': {
      const target = state.items.find((item) => item.id === action.id);
      return target && editable(target) ? { items: state.items, currentId: target.id } : state;
    }
    case 'retry': {
      const items = state.items.map((item) => item.id === action.id && (item.status === 'failed' || item.status === 'unknown')
        ? { ...item, status: 'waiting' as const, message: null } : item);
      return { items, currentId: items.some((item) => item.id === action.id && item.status === 'waiting') ? action.id : state.currentId };
    }
    case 'advance': return settle(state.items, state.currentId);
    case 'clear': return EMPTY_QUEUE;
  }
}

/** Counts for the queue header and the batch summary. */
export function queueCounts(items: readonly QueueItem[]): Readonly<Record<QueueStatus, number>> & { readonly total: number } {
  const counts = { waiting: 0, importing: 0, saved: 0, 'kept-existing': 0, failed: 0, unknown: 0 };
  for (const item of items) counts[item.status] += 1;
  return { ...counts, total: items.length };
}

/** True when every item has finished without a problem, so the list can tidy itself away. */
export function queueSettledCleanly(items: readonly QueueItem[]): boolean {
  return items.length > 0 && items.every((item) => item.status === 'saved' || item.status === 'kept-existing');
}

export const KEPT_EXISTING_MESSAGE = 'This screenshot is already in your library. Your title, notes and rights have been kept.';
export const KEPT_REMOVED_MESSAGE = 'This screenshot was previously removed. It has been kept removed.';
export const GRAPH_NOTE = 'Its site or app grouping could not be updated; the saved image is safe.';

export interface ItemOutcome {
  readonly status: Exclude<QueueStatus, 'waiting' | 'importing'>;
  readonly message: string | null;
  readonly referenceId: ReferenceId | null;
}

/** Maps one import result onto the row's state and the wording shown to the owner. */
export function outcomeOf(result: ScreenshotImportResult | 'threw'): ItemOutcome {
  if (result === 'threw') {
    return { status: 'unknown', message: 'The import outcome could not be confirmed. Reload the library before importing again.', referenceId: null };
  }
  switch (result.status) {
    case 'saved': return { status: 'saved', message: result.graphReady ? null : GRAPH_NOTE, referenceId: result.id };
    case 'duplicate': return { status: 'kept-existing', message: result.graphReady ? KEPT_EXISTING_MESSAGE : `${KEPT_EXISTING_MESSAGE} ${GRAPH_NOTE}`, referenceId: result.id };
    case 'tombstoned': return { status: 'kept-existing', message: result.graphReady ? KEPT_REMOVED_MESSAGE : `${KEPT_REMOVED_MESSAGE} ${GRAPH_NOTE}`, referenceId: result.id };
    case 'rejected': return { status: 'failed', message: result.message, referenceId: null };
    case 'unknown': return { status: 'unknown', message: result.message, referenceId: null };
  }
}

const ACCEPTED_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ACCEPTED_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'webp']);

/** PNG, JPEG and WebP only. A file with no reported type is judged by its extension; the image bytes are checked again on import. */
export function isAcceptedImage(file: Pick<SelectedImageFile, 'name' | 'type'>): boolean {
  if (file.type !== '') return ACCEPTED_TYPES.has(file.type);
  return ACCEPTED_EXTENSIONS.has(file.name.split('.').pop()?.toLowerCase() ?? '');
}

export function splitDropped<T extends Pick<SelectedImageFile, 'name' | 'type'>>(files: readonly T[]): { readonly accepted: readonly T[]; readonly rejected: readonly T[] } {
  return { accepted: files.filter(isAcceptedImage), rejected: files.filter((file) => !isAcceptedImage(file)) };
}

/** Names for a warning toast: the first few, then a count of the rest. */
export function nameList(names: readonly string[], shown = 3): string {
  if (names.length <= shown) return names.join(', ');
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
}

export function defaultTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, '').slice(0, 300);
}

/** The value for a `datetime-local` input from a file's modification time; empty when the time is unusable. */
export function localDateTimeValue(lastModified: number): string {
  const date = new Date(lastModified);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return Number.isFinite(local.getTime()) ? local.toISOString().slice(0, 16) : '';
}

let sequence = 0;
export function newQueueItem(file: SelectedImageFile): QueueItem {
  sequence += 1;
  return { id: `queued-${sequence}`, file, name: file.name, status: 'waiting', message: null, referenceId: null, title: null, thumbnail: undefined };
}

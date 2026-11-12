import {
  MAX_ID_LENGTH, MAX_LABEL_LENGTH, isIdentifier, subjectId,
  type AppendResult, type RatingValue, type TasteCommand, type TasteScope, type TasteSnapshot, type TasteSubject,
} from '../contract.ts';
import type { TasteQueueItem } from './queue-context.ts';
import { describeResult, ratingCommand, ratingSlots, type NewId } from './view-model.ts';

/** Pure logic for the "Waiting to rate" deck and the segmented rating control; React only renders what this derives. */

// ---------------------------------------------------------------- choices and keys

export type DeckDirection = 'left' | 'right' | 'up' | 'down';
export type DeckChoice = { readonly kind: 'rate'; readonly value: RatingValue } | { readonly kind: 'skip' };

export interface QuickRating {
  readonly value: RatingValue;
  readonly label: string;
  readonly direction: DeckDirection;
  /** Arrow glyph shown on the key legend. */
  readonly arrow: string;
}

/** The three one-press ratings. Anything finer uses the exact 1–5 disclosure or the number keys. */
export const QUICK_RATINGS: readonly QuickRating[] = [
  { value: 2, label: 'Not for me', direction: 'left', arrow: '←' },
  { value: 4, label: 'Like', direction: 'right', arrow: '→' },
  { value: 5, label: 'Love', direction: 'up', arrow: '↑' },
];

/** Words for the stamp and the exact-rating buttons. 2 reads "Not for me" here, as on the quick buttons. */
export const STAMP_WORDS: Readonly<Record<RatingValue, string>> = {
  1: 'Strongly dislike', 2: 'Not for me', 3: 'Neutral', 4: 'Like', 5: 'Love',
};

export function choiceText(choice: DeckChoice): string {
  return choice.kind === 'skip' ? 'Skip' : `${STAMP_WORDS[choice.value]} · ${choice.value}`;
}

/** Which way a card leaves for a choice. Ratings follow the quick keys; 1 leaves left and 3 drops. */
export function choiceDirection(choice: DeckChoice): DeckDirection {
  if (choice.kind === 'skip') return 'down';
  switch (choice.value) {
    case 1: case 2: return 'left';
    case 3: return 'down';
    case 4: return 'right';
    case 5: return 'up';
  }
}

interface KeyLike { readonly key: string; readonly ctrlKey?: boolean; readonly metaKey?: boolean; readonly altKey?: boolean }

/** ← 2, → 4, ↑ 5, ↓ or S skip, 1–5 exact. Chorded keys belong to the shell and the browser. */
export function choiceForKey(event: KeyLike): DeckChoice | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowLeft': return { kind: 'rate', value: 2 };
    case 'ArrowRight': return { kind: 'rate', value: 4 };
    case 'ArrowUp': return { kind: 'rate', value: 5 };
    case 'ArrowDown': case 's': case 'S': return { kind: 'skip' };
    case '1': return { kind: 'rate', value: 1 };
    case '2': return { kind: 'rate', value: 2 };
    case '3': return { kind: 'rate', value: 3 };
    case '4': return { kind: 'rate', value: 4 };
    case '5': return { kind: 'rate', value: 5 };
    default: return null;
  }
}

// ---------------------------------------------------------------- drag

/** Pixels past which a release counts as a choice. */
export const DRAG_THRESHOLD = 96;
const DRAG_DEADZONE = 12;

export interface DragIntent {
  readonly choice: DeckChoice | null;
  /** 0 to 1: how far toward the threshold, for the stamp. */
  readonly progress: number;
  readonly armed: boolean;
}

/** Left means 2, right 4 and up 5. A downward drag means nothing: Skip has its own button and key. */
export function dragIntent(dx: number, dy: number, threshold = DRAG_THRESHOLD): DragIntent {
  const none: DragIntent = { choice: null, progress: 0, armed: false };
  const up = -dy > Math.abs(dx);
  const distance = up ? -dy : Math.abs(dx);
  if (distance < DRAG_DEADZONE || (!up && dy > Math.abs(dx))) return none;
  const progress = Math.min(1, distance / threshold);
  const value: RatingValue = up ? 5 : dx < 0 ? 2 : 4;
  return { choice: { kind: 'rate', value }, progress, armed: progress >= 1 };
}

/** Where a card ends up when it leaves: far outside its stack, further along the way it was thrown. */
export function exitOffset(direction: DeckDirection, from: { readonly dx: number; readonly dy: number }, reach = 360): { readonly dx: number; readonly dy: number } {
  switch (direction) {
    case 'left': return { dx: -reach, dy: from.dy * 0.4 };
    case 'right': return { dx: reach, dy: from.dy * 0.4 };
    case 'up': return { dx: from.dx * 0.4, dy: -reach };
    case 'down': return { dx: from.dx * 0.4, dy: reach * 0.6 };
  }
}

/** Gentle tilt while dragging: up to six degrees at the threshold. */
export function dragRotation(dx: number, threshold = DRAG_THRESHOLD): number {
  return Math.max(-1, Math.min(1, dx / threshold)) * 6;
}

// ---------------------------------------------------------------- segmented control

/** Where focus goes when an arrow, Home or End is pressed inside a rating row. Arrows move focus only: a rating is chosen with Space or Enter, never by passing over it. */
export function scaleFocusTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': return (index + 1) % count;
    case 'ArrowLeft': case 'ArrowUp': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

// ---------------------------------------------------------------- subjects

const ENCODE = /[\u0000-\u001f\u007f%~\s]/gu;

function escapeUnit(unit: string): string {
  const code = unit.codePointAt(0) ?? 0;
  return code < 0x100 ? `%${code.toString(16).padStart(2, '0')}` : `%u${code.toString(16).padStart(4, '0')}`;
}

/** 64-bit FNV-1a, as 16 hex digits. Disambiguates ids too long to keep whole; not a security hash. */
function fnv1a64(text: string): string {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash ^ BigInt(text.charCodeAt(index))) * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * A Taste subject id for an item sent from another section. Always valid for `subjectId`, stable for the same
 * kind and id, and different for different pairs: the kind prefix cannot contain a colon, `%` and `~` are always
 * escaped so the encoding reads back one way, and an id that cannot fit keeps a prefix, a `~` and a hash of the
 * whole pair. The `~` appears nowhere else, so a shortened id never equals a whole one.
 */
export function deckSubjectId(kind: string, id: string): string {
  const whole = `${kind}:${id.toWellFormed().replace(ENCODE, escapeUnit)}`;
  if (whole.length <= MAX_ID_LENGTH && isIdentifier(whole)) return whole;
  const digest = fnv1a64(`${kind}\u0000${id}`);
  const room = MAX_ID_LENGTH - digest.length - 1;
  // Never cut inside an escape or a surrogate pair: back up to a whole unit.
  let cut = whole.slice(0, room);
  cut = cut.replace(/%(?:u[0-9a-f]{0,3}|[0-9a-f]?)$/u, '').replace(/[\ud800-\udbff]$/u, '');
  return `${cut}~${digest}`;
}

/** A label Taste will accept: well-formed, no control characters, 1 to 300 characters. */
export function deckLabel(label: string, fallback: string): string {
  const clean = (value: string) => value.toWellFormed().replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim();
  const text = clean(label) || clean(fallback) || 'Untitled';
  if (text.length <= MAX_LABEL_LENGTH) return text;
  return `${text.slice(0, MAX_LABEL_LENGTH - 1).replace(/[\ud800-\udbff]$/u, '').trimEnd()}…`;
}

export function deckItemKey(item: Pick<TasteQueueItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}

export function deckSubject(item: TasteQueueItem): TasteSubject {
  return { id: subjectId(deckSubjectId(item.kind, item.id)), kind: item.kind, label: deckLabel(item.label, item.id) };
}

/** Section title for the "From …" line. A resolver from the composed view wins; otherwise the humanised id. */
export function deckOrigin(from: string, resolve?: (from: string) => string): string {
  const resolved = resolve?.(from).trim();
  if (resolved) return resolved;
  const words = from.replace(/[-_]+/gu, ' ').trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'another view';
}

const KIND_WORDS: Readonly<Record<TasteQueueItem['kind'], string>> = {
  reference: 'Reference', component: 'Component', flow: 'Flow', other: 'Item',
};

export function deckKindWord(kind: TasteQueueItem['kind']): string {
  return KIND_WORDS[kind];
}

/**
 * The image to show on a card, or null. Only an image the sending section already shows is used: a `data:` image,
 * or a same-origin address (a relative path or this document's own origin, including an object URL it minted).
 * Nothing else is ever requested, so a card cannot reach the network.
 */
export function deckImageUrl(url: string | undefined, origin: string): string | null {
  const value = url?.trim();
  if (!value) return null;
  if (/^data:image\//iu.test(value)) return value;
  if (value.startsWith(`blob:${origin}/`)) return value;
  try {
    const parsed = new URL(value, `${origin}/`);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === origin ? value : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- submitting

export type DeckOutcome =
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'unknown' };

/** Journal faults that may have written the entry before failing. Same set the full form treats as unknown. */
const UNCERTAIN_WRITES: readonly string[] = ['write-failed', 'partial-write', 'sync-failed'];

/** Saved only on a confirmed append (or the same entry already there). A fault that may have written is unknown, not failed. */
export function classifyAppend(result: AppendResult): DeckOutcome {
  if (result.status === 'appended' || result.status === 'duplicate') return { kind: 'saved' };
  if (result.status === 'fail-closed' && UNCERTAIN_WRITES.includes(result.reason)) return { kind: 'unknown' };
  return { kind: 'failed', message: describeResult(result).message };
}

export type PreparedRating =
  | { readonly kind: 'command'; readonly command: TasteCommand }
  | { readonly kind: 'already-saved' };

/** An overall liking assessment for the item. The same value already in the snapshot needs no new entry. */
export function prepareRating(
  snapshot: TasteSnapshot, scope: TasteScope, subject: TasteSubject, value: RatingValue, newId: NewId,
): PreparedRating {
  const overall = ratingSlots(snapshot, scope, subject, []).liking[0];
  const command = overall ? ratingCommand(scope, subject, overall, value, newId) : null;
  return command ? { kind: 'command', command } : { kind: 'already-saved' };
}

/** Whether the snapshot already holds the assessment a command recorded: the read-only half of "Check". */
export function snapshotHasCommand(snapshot: TasteSnapshot, command: TasteCommand): boolean {
  const event = command.event;
  return event.type === 'assessment.recorded' && snapshot.assessments.some((item) => item.assessmentId === event.assessmentId);
}

// ---------------------------------------------------------------- just rated

export interface RecentRating {
  readonly key: string;
  readonly label: string;
  readonly value: RatingValue;
}

export const RECENT_LIMIT = 6;

/** Newest first; rating the same item again replaces its chip instead of adding a second. */
export function pushRecent(list: readonly RecentRating[], entry: RecentRating, limit = RECENT_LIMIT): readonly RecentRating[] {
  return [entry, ...list.filter((item) => item.key !== entry.key)].slice(0, limit);
}

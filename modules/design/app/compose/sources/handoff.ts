/**
 * Cross-section handoff for the Sources journey: a reference, component, flow screen or discovered project
 * is sent to Taste for rating. The queue lives for the composition's lifetime and records nothing
 * durable; Taste persists only the ratings the owner then makes.
 */

export const HANDOFF_KINDS = ['reference', 'component', 'flow', 'other'] as const;
/** Matches Taste's subject kinds other than `version`, which Taste binds itself. */
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

export interface HandoffSubject {
  /** Stable identity of the item at its source section, for example a reference id. */
  readonly id: string;
  readonly kind: HandoffKind;
  readonly label: string;
  /** Short secondary text, for example a site or component revision. */
  readonly detail?: string;
  /** A `data:` or same-document object URL already shown by the sending section. */
  readonly imageUrl?: string;
  /** Section id that sent the item, used for "Back to …" links. */
  readonly from: string;
}

export interface HandoffQueue {
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => readonly HandoffSubject[];
  /** Adds to the end; an item already queued keeps its place. */
  readonly add: (subject: HandoffSubject) => 'added' | 'already-queued' | 'full';
  readonly remove: (id: string, kind: HandoffKind) => void;
  readonly has: (id: string, kind: HandoffKind) => boolean;
  readonly clear: () => void;
}

export const HANDOFF_LIMIT = 50;

export function createHandoffQueue(limit = HANDOFF_LIMIT): HandoffQueue {
  let items: readonly HandoffSubject[] = [];
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const same = (item: HandoffSubject, id: string, kind: HandoffKind) => item.id === id && item.kind === kind;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    snapshot: () => items,
    add(subject) {
      if (items.some((item) => same(item, subject.id, subject.kind))) return 'already-queued';
      if (items.length >= limit) return 'full';
      items = [...items, subject];
      emit();
      return 'added';
    },
    remove(id, kind) {
      if (!items.some((item) => same(item, id, kind))) return;
      items = items.filter((item) => !same(item, id, kind));
      emit();
    },
    has: (id, kind) => items.some((item) => same(item, id, kind)),
    clear() {
      if (items.length === 0) return;
      items = [];
      emit();
    },
  };
}

/** Items waiting for a Taste rating. */
export const tasteQueue: HandoffQueue = createHandoffQueue();

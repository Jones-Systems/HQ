import { useSyncExternalStore } from 'react';
import type { NewItemFields, WorkStore } from '../core';

// HQ capture drafts (RW-10, T4 P-5). A capture made while the Planner is
// unreachable becomes an HQ draft only by the user's explicit choice. Drafts are
// HQ's own: they are labelled as not in the Planner, never read from or written
// to the Planner's per-origin drafts, and sent only by an explicit Send drafts.
// They live in memory for this session; persistence across a restart waits for
// a shell storage member (G-3).

export const DRAFT_LABEL = 'HQ draft · not in the Planner';
export const DRAFT_SCOPE_NOTE = 'Kept in HQ on this device for this session only, and sent only when you choose Send drafts.';

export interface HqDraft {
  id: string;
  fields: NewItemFields;
  createdAt: string;
  /** Why the last explicit send did not take it. */
  error?: string;
}

export interface SendSummary {
  /** Created in the Planner, or handed to the core unconfirmed queue with its request ID. */
  sent: number;
  unconfirmed: number;
  /** Still drafts, with their reason. */
  kept: number;
  /** True when the Planner became unavailable, so the remaining drafts were not tried. */
  stopped: boolean;
}

export type DraftStore = ReturnType<typeof createDraftStore>;

export function createDraftStore(options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date());
  let drafts: readonly HqDraft[] = [];
  let sending = false;
  let counter = 0;
  const listeners = new Set<() => void>();
  let snapshot = { drafts, sending };
  const emit = () => {
    snapshot = { drafts, sending };
    for (const listener of listeners) listener();
  };

  async function sendOne(store: WorkStore, draft: HqDraft): Promise<'sent' | 'unconfirmed' | 'kept' | 'stopped'> {
    const outcome = await store.create(draft.fields);
    if (outcome.status === 'saved' || outcome.status === 'unconfirmed') {
      // An unconfirmed create now belongs to the core queue, which re-sends only its same request ID and body.
      drafts = drafts.filter((d) => d.id !== draft.id);
      return outcome.status === 'saved' ? 'sent' : 'unconfirmed';
    }
    const { error } = outcome;
    const reason = error.kind === 'invalid' ? error.errors.map((e) => e.message).join(' ')
      : error.kind === 'unavailable' ? 'The Planner is unavailable; nothing was sent.'
        : `The Planner refused it (${error.kind}).`;
    drafts = drafts.map((d) => d.id === draft.id ? { ...d, error: reason } : d);
    return error.kind === 'unavailable' ? 'stopped' : 'kept';
  }

  return {
    getState: () => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** The user's explicit choice to keep a capture as an HQ draft. Nothing is sent. */
    add(fields: NewItemFields): HqDraft {
      const draft: HqDraft = { id: `hq-draft-${(counter += 1)}`, fields: structuredClone(fields), createdAt: now().toISOString() };
      drafts = [...drafts, draft];
      emit();
      return draft;
    },
    discard(id: string): void {
      drafts = drafts.filter((d) => d.id !== id);
      emit();
    },
    /** Send drafts: oldest first, one create each, stopping if the Planner is unavailable. Never automatic. */
    async sendAll(store: WorkStore): Promise<SendSummary> {
      const summary: SendSummary = { sent: 0, unconfirmed: 0, kept: 0, stopped: false };
      if (sending) return summary;
      sending = true;
      emit();
      try {
        for (const draft of [...drafts]) {
          const result = await sendOne(store, draft);
          emit();
          if (result === 'stopped') {
            summary.stopped = true;
            summary.kept = drafts.length;
            break;
          }
          if (result === 'sent') summary.sent += 1;
          else if (result === 'unconfirmed') summary.unconfirmed += 1;
          else summary.kept += 1;
        }
      } finally {
        sending = false;
        emit();
      }
      return summary;
    },
  };
}

const shared = new Map<string, DraftStore>();

/** One draft list per key for the session; remounted surfaces get the same drafts back. */
export function sharedDraftStore(key: string): DraftStore {
  let store = shared.get(key);
  if (!store) shared.set(key, store = createDraftStore());
  return store;
}

export function useDrafts(store: DraftStore): { drafts: readonly HqDraft[]; sending: boolean } {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

import { useSyncExternalStore } from 'react';
import type { NewItemFields, WorkStore } from '../core';
import type { DurableDrafts } from '../core/durability';
import { normalizeFields } from '../core/validation';
import { HQ_REFERENCES_FEATURE } from '../core/types';

// HQ capture drafts (RW-10, T4 P-5). A capture made while the Planner is
// unreachable becomes an HQ draft only by the user's explicit choice. Drafts are
// HQ's own: they are labelled as not in the Planner, never read from or written
// to the Planner's per-origin drafts, and sent only by an explicit Send drafts.
// A registered device slot restores before mutations; without one they remain session-only.

export const DRAFT_LABEL = 'HQ draft · not in the Planner';
export const DRAFT_SCOPE_NOTE = 'Kept in HQ on this device for this session only, and sent only when you choose Send drafts.';

export interface HqDraft {
  id: string;
  fields: NewItemFields;
  createdAt: string;
  /** Why the last explicit send did not take it. */
  error?: string;
  /** Persisted before dispatch; after interruption only core recovery may resolve the possible create. */
  handoff?: true;
}

export interface SendSummary {
  /** Created in the Planner, or handed to the core unconfirmed queue with its request ID. */
  sent: number;
  unconfirmed: number;
  /** Still drafts, with their reason. */
  kept: number;
  /** True when Planner or device storage prevented the remaining sends. */
  stopped: boolean;
  reason?: string;
}

let durableCounter = 0;

export type DraftStore = ReturnType<typeof createDraftStore>;

export type DraftDurability = 'off' | 'loading' | 'saved' | 'saving' | 'failed' | 'blocked';
export const HANDOFF_NOTE = 'A send may have started. Check unconfirmed changes in Work before discarding this copy; it will not be sent again.';

export function draftScopeNote(state: { durability: DraftDurability }): string {
  switch (state.durability) {
    case 'off': return DRAFT_SCOPE_NOTE;
    case 'loading': return 'Reading HQ drafts from this device. Wait before keeping or sending drafts.';
    case 'saved': return 'HQ drafts are kept on this device, not in the Planner. Only Send drafts sends them.';
    case 'saving': return 'Keeping HQ drafts in this session; device save is pending. Keep HQ open.';
    case 'failed': return 'Device save is not confirmed. Keep HQ open; draft text remains in this session.';
    case 'blocked': return 'Stored HQ drafts could not be read safely. Nothing will overwrite them; keep your capture text open.';
  }
}

function readDraft(raw: unknown): HqDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== 'string' || !/^hq-draft-[1-9][0-9]*$/u.test(d.id)
    || !Number.isSafeInteger(Number(d.id.slice(9))) || typeof d.createdAt !== 'string'
    || !Number.isFinite(Date.parse(d.createdAt)) || (d.error !== undefined && typeof d.error !== 'string')
    || (d.handoff !== undefined && d.handoff !== true)) return null;
  try {
    // Validate without normalizing the user's text or allocating Planner identities.
    let entry = 0;
    const valid = normalizeFields(d.fields, { creating: true, features: [HQ_REFERENCES_FEATURE], newId: () => `draft-validation-${++entry}` });
    return valid.ok ? structuredClone(raw) as HqDraft : null;
  } catch { return null; }
}

export function createDraftStore(options: { now?: () => Date; durableDrafts?: DurableDrafts | null } = {}) {
  const now = options.now ?? (() => new Date());
  let drafts: readonly HqDraft[] = [];
  let sending = false;
  let counter = 0;
  const slot = options.durableDrafts;
  let durability: DraftDurability = slot ? 'loading' : 'off';
  let revision = 0;
  const listeners = new Set<() => void>();
  let snapshot: { drafts: readonly HqDraft[]; sending: boolean; durability: DraftDurability } = { drafts, sending, durability };
  const emit = () => {
    snapshot = { drafts, sending, durability };
    for (const listener of listeners) listener();
  };

  const ready = slot ? (async () => {
    try {
      const raw = await slot.claim();
      const restored = raw.map(readDraft);
      const valid = restored.filter((d): d is HqDraft => d !== null);
      drafts = valid.filter((d, i) => valid.findIndex((other) => other.id === d.id) === i).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      for (const draft of drafts) counter = Math.max(counter, Number(draft.id.slice(9)));
      durableCounter = Math.max(durableCounter, counter);
      durability = slot.status() === 'failed' || valid.length !== raw.length || drafts.length !== valid.length ? 'blocked' : 'saved';
    } catch { durability = 'blocked'; }
    emit();
  })() : Promise.resolve();
  slot?.onStatus(() => {
    if (slot.status() === 'failed' && durability !== 'loading' && durability !== 'blocked') {
      durability = 'failed'; emit();
    }
  });

  const deviceSaved = () => durability === 'saved';

  function guard() {
    if (durability === 'loading' || durability === 'blocked') throw new Error(draftScopeNote({ durability }));
  }

  async function persist(): Promise<void> {
    if (!slot) return;
    const ownRevision = ++revision;
    durability = 'saving'; emit();
    try {
      slot.save(structuredClone([...drafts]));
      await slot.settle();
      if (ownRevision === revision) durability = slot.status() === 'ok' ? 'saved' : 'failed';
    } catch { if (ownRevision === revision) durability = 'failed'; }
    emit();
  }

  async function sendOne(store: WorkStore, draft: HqDraft): Promise<'sent' | 'unconfirmed' | 'kept' | 'stopped' | 'storage-failed'> {
    if (draft.handoff) return 'kept';
    if (slot) {
      // A stale disk copy must never become a fresh create after a crash or failed removal save.
      drafts = drafts.map((d) => d.id === draft.id ? { ...d, handoff: true } : d);
      await persist();
      if (!deviceSaved()) return 'storage-failed';
    }
    const outcome = await store.create(structuredClone(draft.fields));
    if (outcome.status === 'saved' || outcome.status === 'unconfirmed') {
      // An unconfirmed create belongs to core with its immutable intent; capture never replays it.
      drafts = drafts.filter((d) => d.id !== draft.id);
      return outcome.status === 'saved' ? 'sent' : 'unconfirmed';
    }
    const { error } = outcome;
    const reason = error.kind === 'invalid' ? error.errors.map((e) => e.message).join(' ')
      : error.kind === 'unavailable' ? 'The Planner is unavailable; nothing was sent.'
        : `The Planner refused it (${error.kind}).`;
    drafts = drafts.map((d) => d.id === draft.id ? { ...d, handoff: undefined, error: reason } : d);
    return error.kind === 'unavailable' ? 'stopped' : 'kept';
  }

  return {
    getState: () => snapshot,
    ready: () => ready,
    settle: async () => { await ready; guard(); await persist(); },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Explicit keep; refuses until restore completes. Device save confirmation is reported separately. Nothing is sent. */
    add(fields: NewItemFields): HqDraft {
      guard();
      if (slot && !readDraft({ id: 'hq-draft-1', fields, createdAt: now().toISOString() })) throw new Error('This capture is not a valid HQ draft. Keep your text open and correct it.');
      if (slot) counter = Math.max(counter, durableCounter);
      while (drafts.some((d) => d.id === `hq-draft-${counter + 1}`)) counter += 1;
      if (!Number.isSafeInteger(counter + 1)) throw new Error('HQ draft IDs are exhausted; keep your capture text open.');
      const draft: HqDraft = { id: `hq-draft-${(counter += 1)}`, fields: structuredClone(fields), createdAt: now().toISOString() };
      if (slot) durableCounter = counter;
      drafts = [...drafts, draft];
      void persist();
      emit();
      return draft;
    },
    discard(id: string): void {
      guard();
      if (sending) return;
      drafts = drafts.filter((d) => d.id !== id);
      void persist();
      emit();
    },
    /** Explicit send, oldest first. Interrupted handoffs stay held; storage or Planner refusal stops the batch. */
    async sendAll(store: WorkStore): Promise<SendSummary> {
      const summary: SendSummary = { sent: 0, unconfirmed: 0, kept: 0, stopped: false };
      if (sending) return summary;
      sending = true;
      emit();
      try {
        await ready;
        guard();
        if (slot) {
          await persist();
          if (!deviceSaved()) return { ...summary, kept: drafts.length, stopped: true, reason: draftScopeNote({ durability }) };
        }
        for (const draft of [...drafts]) {
          const result = await sendOne(store, draft);
          if (result === 'storage-failed') {
            summary.stopped = true;
            summary.reason = draftScopeNote({ durability });
            summary.kept = drafts.length;
            break;
          }
          if (result === 'sent') summary.sent += 1;
          else if (result === 'unconfirmed') summary.unconfirmed += 1;
          else if (result === 'kept') summary.kept += 1;
          await persist();
          emit();
          if (slot && !deviceSaved()) {
            summary.stopped = true;
            summary.reason = draftScopeNote({ durability });
            summary.kept = drafts.length;
            break;
          }
          if (result === 'stopped') {
            summary.stopped = true;
            summary.kept = drafts.length;
            break;
          }
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

export function useDrafts(store: DraftStore) {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

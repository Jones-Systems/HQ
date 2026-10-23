import { useSyncExternalStore } from 'react';
import type { ItemPatch, PatchField } from '../core';

// Unsaved detail text and open conflicts live at module level, outside React,
// so a domain switch (which remounts the module) keeps both (RW-5, RV-6).

export type TextField = 'title' | 'area' | 'notes';

export interface TextBuffer {
  /** What the user has typed. */
  text: string;
  /** The Planner's value when this edit began; a different value now means it changed elsewhere. */
  base: string;
}

export interface FieldConflict {
  fields: PatchField[];
  /** The user's change, re-sent unchanged by Keep mine. */
  mine: ItemPatch;
  /** The Planner's current values for the same fields. */
  theirs: Partial<Record<PatchField, unknown>>;
}

export interface DetailSnapshot {
  buffers: Readonly<Record<string, Partial<Record<TextField, TextBuffer>>>>;
  conflicts: Readonly<Record<string, FieldConflict>>;
}

export type DetailState = ReturnType<typeof createDetailState>;

export function createDetailState() {
  let snapshot: DetailSnapshot = { buffers: {}, conflicts: {} };
  const listeners = new Set<() => void>();
  const update = (next: DetailSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    getState: (): DetailSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    buffer: (itemId: string, field: TextField): TextBuffer | undefined => snapshot.buffers[itemId]?.[field],
    setBuffer(itemId: string, field: TextField, buffer: TextBuffer): void {
      update({ ...snapshot, buffers: { ...snapshot.buffers, [itemId]: { ...snapshot.buffers[itemId], [field]: buffer } } });
    },
    clearBuffer(itemId: string, field: TextField): void {
      const { [field]: _dropped, ...rest } = snapshot.buffers[itemId] ?? {};
      update({ ...snapshot, buffers: { ...snapshot.buffers, [itemId]: rest } });
    },
    conflict: (itemId: string): FieldConflict | undefined => snapshot.conflicts[itemId],
    setConflict(itemId: string, conflict: FieldConflict): void {
      update({ ...snapshot, conflicts: { ...snapshot.conflicts, [itemId]: conflict } });
    },
    clearConflict(itemId: string): void {
      const { [itemId]: _dropped, ...rest } = snapshot.conflicts;
      update({ ...snapshot, conflicts: rest });
    },
  };
}

const shared = new Map<string, DetailState>();

/** One detail state per key for the session. */
export function sharedDetailState(key: string): DetailState {
  let state = shared.get(key);
  if (!state) shared.set(key, state = createDetailState());
  return state;
}

export function useDetailState(state: DetailState): DetailSnapshot {
  return useSyncExternalStore(state.subscribe, state.getState, state.getState);
}

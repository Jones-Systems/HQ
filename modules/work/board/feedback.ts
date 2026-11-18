import { useSyncExternalStore } from 'react';

// Module-level toast list for the Work surfaces, so a pending Undo survives the shell's remount on a domain switch
// exactly as the core undo stack does. The list is what Work code pushes to; `WorkToasts` mirrors it onto the shared
// `@hq/ui` toast store (the one viewport the shell mounts), so every Work toast looks and behaves like every other HQ
// toast. The API here is unchanged for the board, the detail panel and the planning views.

export const TOAST_LIMIT = 4;
/** Shown under every planning toast: moving or editing a card never starts work. */
export const PLANNING_ONLY_META = 'Planning change only · no run started';

export interface WorkToast {
  id: string;
  message: string;
  meta?: string;
  /**
   * `info`: a change that happened (with `undoId`, it offers Undo). `warning` and `danger`: a write that was refused
   * or failed; both stay until dismissed. `unknown`: the outcome was not confirmed; it offers Check, never a retry.
   */
  tone: 'info' | 'warning' | 'danger' | 'unknown';
  /** The core undo entry this toast can consume. Its Undo shows only while the entry is still on the stack. */
  undoId?: string;
}

export type Feedback = ReturnType<typeof createFeedback>;

let instances = 0;

export function createFeedback() {
  let toasts: readonly WorkToast[] = [];
  let counter = 0;
  const key = `work-feedback-${(instances += 1)}`;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    /** Distinguishes this list's toasts in the shared toast store. */
    key,
    getState: (): readonly WorkToast[] => toasts,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    push(toast: Omit<WorkToast, 'id'>): string {
      const id = `toast-${(counter += 1)}`;
      toasts = [...toasts, { ...toast, id }].slice(-TOAST_LIMIT);
      emit();
      return id;
    },
    dismiss(id: string): void {
      if (!toasts.some((toast) => toast.id === id)) return;
      toasts = toasts.filter((toast) => toast.id !== id);
      emit();
    },
    /** Removes the toast offering this undo entry, so a stale Undo button cannot run it again. */
    dismissUndo(undoId: string): void {
      if (!toasts.some((toast) => toast.undoId === undoId)) return;
      toasts = toasts.filter((toast) => toast.undoId !== undoId);
      emit();
    },
  };
}

const shared = new Map<string, Feedback>();

/** One feedback list per key for the session; remounted surfaces get the same list back. */
export function sharedFeedback(key: string): Feedback {
  let feedback = shared.get(key);
  if (!feedback) shared.set(key, feedback = createFeedback());
  return feedback;
}

export function useFeedback(feedback: Feedback): readonly WorkToast[] {
  return useSyncExternalStore(feedback.subscribe, feedback.getState, feedback.getState);
}

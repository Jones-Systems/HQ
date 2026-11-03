/**
 * Transient feedback for the Design Sources views (References, Components, Flows, Taste, Imports, Discovery).
 * Outcomes are announced as toasts over the current screen instead of replacing it. Framework-free so
 * `node --test` can exercise it; `SourcesSurface.tsx` renders it with the shared `@hq/ui` toast.
 */

export type FeedbackTone = 'info' | 'success' | 'warning' | 'danger';

export interface FeedbackAction {
  readonly label: string;
  readonly run: () => void;
}

export interface FeedbackToast {
  readonly id: string;
  readonly tone: FeedbackTone;
  readonly message: string;
  /** Secondary line, for example "2 of 5 imported" or "Planning change only". */
  readonly meta?: string;
  readonly action?: FeedbackAction;
  /** Absent means the toast stays until dismissed. */
  readonly autoDismissMs?: number;
}

export interface FeedbackInput {
  /** Reusing an id replaces that toast in place, so progress updates do not stack. */
  readonly id?: string;
  readonly tone?: FeedbackTone;
  readonly message: string;
  readonly meta?: string;
  readonly action?: FeedbackAction;
  /** Overrides the tone default: info and success expire, warning and danger persist. */
  readonly autoDismissMs?: number | null;
}

export interface FeedbackStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => readonly FeedbackToast[];
  readonly push: (input: FeedbackInput) => string;
  readonly dismiss: (id: string) => void;
  readonly clear: () => void;
}

export const FEEDBACK_AUTO_DISMISS_MS = 5000;
const DEFAULT_MAX = 4;

export function createFeedbackStore(options: { readonly max?: number; readonly nextId?: () => string } = {}): FeedbackStore {
  const max = options.max ?? DEFAULT_MAX;
  let counter = 0;
  const nextId = options.nextId ?? (() => `feedback-${++counter}`);
  let toasts: readonly FeedbackToast[] = [];
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of [...listeners]) listener(); };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    snapshot: () => toasts,
    push(input) {
      const id = input.id ?? nextId();
      const tone = input.tone ?? 'info';
      const persistent = tone === 'warning' || tone === 'danger';
      const autoDismissMs = input.autoDismissMs === null ? undefined
        : input.autoDismissMs ?? (persistent ? undefined : FEEDBACK_AUTO_DISMISS_MS);
      const toast: FeedbackToast = {
        id, tone, message: input.message,
        ...(input.meta === undefined ? {} : { meta: input.meta }),
        ...(input.action === undefined ? {} : { action: input.action }),
        ...(autoDismissMs === undefined ? {} : { autoDismissMs }),
      };
      const index = toasts.findIndex((item) => item.id === id);
      // A replacement keeps its position; new toasts join the end and the oldest leave first.
      toasts = index >= 0 ? toasts.map((item, at) => (at === index ? toast : item)) : [...toasts, toast].slice(-max);
      emit();
      return id;
    },
    dismiss(id) {
      if (!toasts.some((item) => item.id === id)) return;
      toasts = toasts.filter((item) => item.id !== id);
      emit();
    },
    clear() {
      if (toasts.length === 0) return;
      toasts = [];
      emit();
    },
  };
}

/** One store for every Sources view, so an outcome stays visible while the user moves between sections. */
export const sourcesFeedback: FeedbackStore = createFeedbackStore();

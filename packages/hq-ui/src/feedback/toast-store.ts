/**
 * Framework-free toast store. The shell renders one `<ToastViewport>`; anything can raise a toast through the
 * `toast` API, including services and adapters outside React. Timers only run while a viewport is subscribed,
 * pause together on hover, focus and hidden documents, and never dismiss failures or unknown results on their own.
 */

export const TOAST_TONES = ['neutral', 'info', 'success', 'warning', 'danger', 'unknown', 'loading'] as const;
export type ToastTone = (typeof TOAST_TONES)[number];

/** Default lifetime per tone in ms. `Infinity` stays until dismissed or updated. */
export const TOAST_DURATIONS: Readonly<Record<ToastTone, number>> = {
  neutral: 5000, info: 5000, success: 4000, warning: 8000, danger: Infinity, unknown: Infinity, loading: Infinity,
};
/** A toast with an action (usually Undo) stays at least this long, so the action is reachable. */
export const TOAST_ACTION_MIN_MS = 8000;
/** Records kept in the store; the oldest dismissible non-failure toast is dropped beyond this. */
export const TOAST_STORE_LIMIT = 12;

export type ToastDismissReason = 'timeout' | 'user' | 'action' | 'programmatic' | 'overflow';

export interface ToastActionSpec {
  /** Short verb: "Undo", "Retry", "Check", "Open". */
  readonly label: string;
  readonly onAction: () => void;
  readonly keyshortcuts?: string;
  /** Dismiss the toast after the action runs. Default true. */
  readonly dismiss?: boolean;
}

export interface ToastInput {
  /** Stable id: showing the same id again updates that toast in place (and restarts its timer). */
  readonly id?: string;
  readonly tone?: ToastTone;
  /** One short sentence. Required; it is what screen readers announce. */
  readonly title: string;
  readonly description?: string;
  /** Mono provenance line, for example "Planning change only · no run started". */
  readonly meta?: string;
  readonly action?: ToastActionSpec;
  /** Lifetime in ms; `Infinity` keeps it until dismissed. Defaults per tone (`TOAST_DURATIONS`). */
  readonly duration?: number;
  /** Shows a Dismiss button and allows Escape. Default true. */
  readonly dismissible?: boolean;
  readonly onDismiss?: (reason: ToastDismissReason) => void;
}

export interface ToastRecord {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description?: string;
  readonly meta?: string;
  readonly action?: ToastActionSpec;
  readonly duration: number;
  readonly dismissible: boolean;
  readonly createdAt: number;
  /** Increments on every update, so a viewport can re-announce and restart its entrance highlight. */
  readonly revision: number;
  /** How many identical toasts were folded into this one. */
  readonly repeat: number;
  readonly onDismiss?: (reason: ToastDismissReason) => void;
}

export interface ToastStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ToastRecord[];
  show(input: ToastInput): string;
  update(id: string, patch: Partial<ToastInput>): void;
  /** Dismiss one toast, or all when `id` is omitted. */
  dismiss(id?: string, reason?: ToastDismissReason): void;
  /** Pause every timer (hover, focus within the viewport, hidden document). Calls nest. */
  pause(): void;
  resume(): void;
}

interface Timer { remaining: number; started: number; handle: ReturnType<typeof setTimeout> | undefined }

function lifetime(input: Pick<ToastInput, 'duration' | 'tone' | 'action'>): number {
  const tone = input.tone ?? 'neutral';
  const base = input.duration ?? TOAST_DURATIONS[tone];
  if (!Number.isFinite(base) || base < 0) return Infinity;
  return input.action ? Math.max(base, TOAST_ACTION_MIN_MS) : base;
}

export function createToastStore(now: () => number = Date.now): ToastStore {
  let records: readonly ToastRecord[] = [];
  const listeners = new Set<() => void>();
  const timers = new Map<string, Timer>();
  let pauses = 0;
  let sequence = 0;

  const emit = () => { for (const listener of [...listeners]) listener(); };
  const running = () => listeners.size > 0 && pauses === 0;

  const stopTimer = (id: string) => {
    const timer = timers.get(id);
    if (!timer || timer.handle === undefined) return;
    clearTimeout(timer.handle);
    timer.handle = undefined;
    timer.remaining = Math.max(0, timer.remaining - (now() - timer.started));
  };
  const startTimer = (id: string) => {
    const timer = timers.get(id);
    if (!timer || timer.handle !== undefined || !Number.isFinite(timer.remaining) || !running()) return;
    timer.started = now();
    timer.handle = setTimeout(() => { timer.handle = undefined; remove(id, 'timeout'); }, timer.remaining);
  };
  const resetTimer = (record: ToastRecord) => {
    const previous = timers.get(record.id);
    if (previous?.handle !== undefined) clearTimeout(previous.handle);
    timers.set(record.id, { remaining: record.duration, started: now(), handle: undefined });
    startTimer(record.id);
  };

  const remove = (id: string, reason: ToastDismissReason) => {
    const record = records.find((candidate) => candidate.id === id);
    if (!record) return;
    stopTimer(id);
    timers.delete(id);
    records = records.filter((candidate) => candidate.id !== id);
    emit();
    record.onDismiss?.(reason);
  };

  const build = (id: string, input: ToastInput, createdAt: number, revision: number, repeat: number): ToastRecord => {
    if (input.title.trim() === '') throw new Error('A toast needs a title; it is what screen readers announce');
    const tone = input.tone ?? 'neutral';
    return {
      id, tone, title: input.title, createdAt, revision, repeat,
      duration: lifetime(input), dismissible: input.dismissible ?? true,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.onDismiss !== undefined ? { onDismiss: input.onDismiss } : {}),
    };
  };

  const replace = (next: ToastRecord) => {
    records = records.map((record) => (record.id === next.id ? next : record));
    resetTimer(next);
    emit();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      for (const record of records) startTimer(record.id);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) for (const record of records) stopTimer(record.id);
      };
    },
    getSnapshot: () => records,
    show(input) {
      const existing = input.id !== undefined ? records.find((record) => record.id === input.id) : undefined;
      if (existing) {
        replace(build(existing.id, input, existing.createdAt, existing.revision + 1, 1));
        return existing.id;
      }
      const twin = input.id === undefined ? records.find((record) => record.tone === (input.tone ?? 'neutral')
        && record.title === input.title && record.description === input.description && record.action === undefined && input.action === undefined) : undefined;
      if (twin) {
        replace(build(twin.id, input, twin.createdAt, twin.revision + 1, twin.repeat + 1));
        return twin.id;
      }
      const id = input.id ?? `hq-toast-${++sequence}`;
      const record = build(id, input, now(), 0, 1);
      records = [...records, record];
      while (records.length > TOAST_STORE_LIMIT) {
        const drop = records.find((candidate) => Number.isFinite(candidate.duration) && candidate.tone !== 'loading');
        if (!drop) break;
        stopTimer(drop.id);
        timers.delete(drop.id);
        records = records.filter((candidate) => candidate !== drop);
        drop.onDismiss?.('overflow');
      }
      resetTimer(record);
      emit();
      return id;
    },
    update(id, patch) {
      const record = records.find((candidate) => candidate.id === id);
      if (!record) return;
      const merged: ToastInput = {
        tone: record.tone, title: record.title, description: record.description, meta: record.meta, action: record.action,
        dismissible: record.dismissible, onDismiss: record.onDismiss, ...patch,
        // A new tone without an explicit duration takes that tone's default (loading → success auto-dismisses).
        duration: patch.duration ?? (patch.tone !== undefined || patch.action !== undefined ? undefined : record.duration),
      };
      replace(build(id, merged, record.createdAt, record.revision + 1, record.repeat));
    },
    dismiss(id, reason = 'programmatic') {
      if (id !== undefined) { remove(id, reason); return; }
      for (const record of [...records]) remove(record.id, reason);
    },
    pause() {
      pauses += 1;
      for (const record of records) stopTimer(record.id);
    },
    resume() {
      pauses = Math.max(0, pauses - 1);
      if (running()) for (const record of records) startTimer(record.id);
    },
  };
}

export type ToastOptions = Omit<ToastInput, 'title' | 'tone'>;
type ToastMessage<T> = string | ToastInput | ((value: T) => string | ToastInput);

export interface ToastPromiseMessages<T> {
  readonly loading: string | ToastInput;
  readonly success: ToastMessage<T>;
  readonly error: ToastMessage<unknown>;
}

export interface ToastApi {
  (input: ToastInput | string): string;
  show(input: ToastInput): string;
  info(title: string, options?: ToastOptions): string;
  success(title: string, options?: ToastOptions): string;
  warning(title: string, options?: ToastOptions): string;
  /** Failures stay until dismissed. Offer "Retry" only when repeating is safe; use `unknown` otherwise. */
  error(title: string, options?: ToastOptions): string;
  /** The outcome is not confirmed. Offer "Check", never a blind retry. Stays until dismissed. */
  unknown(title: string, options?: ToastOptions): string;
  /** Spinner; stays until you `update` or `dismiss` it. */
  loading(title: string, options?: ToastOptions): string;
  /** Shows `loading`, then turns the same toast into success or error. Resolves or rejects like the promise. */
  promise<T>(work: Promise<T> | (() => Promise<T>), messages: ToastPromiseMessages<T>, options?: ToastOptions): Promise<T>;
  update(id: string, patch: Partial<ToastInput>): void;
  dismiss(id?: string): void;
}

function resolveMessage<T>(message: ToastMessage<T>, value: T): ToastInput {
  const resolved = typeof message === 'function' ? message(value) : message;
  return typeof resolved === 'string' ? { title: resolved } : resolved;
}

export function createToastApi(store: ToastStore): ToastApi {
  const toned = (tone: ToastTone) => (title: string, options: ToastOptions = {}) => store.show({ ...options, tone, title });
  const api = ((input: ToastInput | string) => store.show(typeof input === 'string' ? { title: input } : input)) as ToastApi;
  api.show = (input) => store.show(input);
  api.info = toned('info');
  api.success = toned('success');
  api.warning = toned('warning');
  api.error = toned('danger');
  api.unknown = toned('unknown');
  api.loading = toned('loading');
  api.update = (id, patch) => store.update(id, patch);
  api.dismiss = (id) => store.dismiss(id, 'programmatic');
  api.promise = async <T,>(work: Promise<T> | (() => Promise<T>), messages: ToastPromiseMessages<T>, options: ToastOptions = {}) => {
    const loading = typeof messages.loading === 'string' ? { title: messages.loading } : messages.loading;
    const id = store.show({ ...options, ...loading, tone: 'loading' });
    try {
      const value = await (typeof work === 'function' ? work() : work);
      // Showing the same id replaces the loading toast entirely, so its description never lingers.
      store.show({ ...options, tone: 'success', ...resolveMessage(messages.success, value), id });
      return value;
    } catch (error) {
      store.show({ ...options, tone: 'danger', ...resolveMessage(messages.error, error), id });
      throw error;
    }
  };
  return api;
}

/** The app-wide store the shell's `<ToastViewport>` renders by default. */
export const toastStore: ToastStore = createToastStore();
/** Raise toasts from anywhere: `toast.success('Saved')`, `toast.error('Couldn't save', { action })`. */
export const toast: ToastApi = createToastApi(toastStore);

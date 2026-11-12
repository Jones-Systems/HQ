import { createContext, useContext, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { DateInput, Filters, Settings, SettingsResult, WorkState, WorkStore, WriteOutcome } from '../core';
import type { Feedback } from '../board/feedback';
import type { WorkDestination } from './meta';

/** Optional hand-offs to the sibling Work lanes. Each is navigation or UI only; none writes or executes. */
export interface ViewLinks {
  /** Opens the card detail panel (detail lane). */
  readonly openItem?: (id: string) => void;
  /** Opens the typed date editor for one date (detail lane). */
  readonly editDate?: (itemId: string, dateId: string) => void;
  /** Opens quick capture, optionally seeded with a date (capture lane). */
  readonly capture?: (seed: { date?: DateInput }) => void;
  /** Moves within Work, for example a Glance status pill to that Board column. */
  readonly navigate?: (to: WorkDestination) => void;
}

export interface ViewEnv extends ViewLinks {
  readonly store: WorkStore;
  readonly state: WorkState;
  readonly settings: Settings;
  /** Today's ISO day in the Planner display zone. */
  readonly today: string;
  readonly now: () => Date;
  readonly filters: Filters;
  /** Sends a write through the store, then shows its outcome with Undo when the store recorded one. */
  readonly run: (write: Promise<WriteOutcome> | Promise<WriteOutcome<SettingsResult>>, success: string) => Promise<boolean>;
  /** Polite announcement for results that are not a toast, such as an inert By date gesture. */
  readonly announce: (text: string) => void;
  /**
   * The Work feedback list, for a view that raises its own toast (for example a Done control's Undo). A write that goes
   * through `run` is reported for you.
   */
  readonly feedback: Feedback;
}

const Env = createContext<ViewEnv | null>(null);
export const ViewEnvProvider = Env.Provider;

export function useEnv(): ViewEnv {
  const env = useContext(Env);
  if (!env) throw new Error('Work views render inside PlanningViews');
  return env;
}

const touches = (id: string) => (write: { op: string } & Partial<{ id: string }>) => write.id === id;

/** Optional queue projection consumed when the parent composes the reviewed core. */
type QueueViewState = WorkState & { queued?: readonly { write: { op: string; id?: string }; state: 'queued' | 'sending' | 'conflict' | 'rejected' }[] };

/** Blocks repeat edits while saving, queued, unconfirmed, or held. */
export function isPending(state: WorkState, id: string): boolean {
  return !!state.held || !!(state as QueueViewState).queued?.some((q) => touches(id)(q.write)) || state.pending.some((p) => touches(id)(p.write)) || state.unconfirmed.some((u) => touches(id)(u.write));
}

/** Labels projected writes without claiming that queued or unknown writes were saved. */
export function pendingWord(state: WorkState, id: string): string | null {
  if (state.held) return 'Saving paused · held';
  if (state.unconfirmed.some((u) => touches(id)(u.write))) return 'Unconfirmed';
  const queued = (state as QueueViewState).queued?.find((q) => touches(id)(q.write));
  if (queued) return ({ queued: 'Queued on this device', sending: 'Sending…', conflict: 'Changed in the Planner while offline', rejected: 'Queued change rejected' })[queued.state];
  return state.pending.some((p) => touches(id)(p.write)) ? 'Saving…' : null;
}

// View preferences (calendar month and layout, list sort, ...) survive T0's remount on a domain switch. They
// stay in memory: there is no shell storage member for per-device preferences yet.
const memory = new Map<string, unknown>();

export function useRemembered<T>(key: string, initial: T | (() => T)): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => (memory.has(key) ? memory.get(key) as T
    : typeof initial === 'function' ? (initial as () => T)() : initial));
  useEffect(() => { memory.set(key, value); }, [key, value]);
  return [value, setValue];
}

/** Test hook: forget remembered view preferences. */
export function resetViewMemory(): void {
  memory.clear();
}

/**
 * Sets custom properties through CSSOM. The app CSP (`style-src 'self'`) blocks inline style attributes, so
 * positions such as timeline bars are passed as `--wv-*` properties that the stylesheet reads.
 */
export function useCssVars(ref: RefObject<HTMLElement | null>, vars: Readonly<Record<string, string>>): void {
  const signature = JSON.stringify(vars);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
  }, [ref, signature]);
}

/** Ignore view shortcuts while the owner is typing. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

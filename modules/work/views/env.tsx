import { createContext, useContext, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { DateInput, Filters, Settings, SettingsResult, WorkState, WorkStore, WriteOutcome } from '../core';
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
}

const Env = createContext<ViewEnv | null>(null);
export const ViewEnvProvider = Env.Provider;

export function useEnv(): ViewEnv {
  const env = useContext(Env);
  if (!env) throw new Error('Work views render inside PlanningViews');
  return env;
}

const touches = (id: string) => (write: { op: string } & Partial<{ id: string }>) => write.id === id;

/** True while a write for `id` is in flight or unconfirmed. */
export function isPending(state: WorkState, id: string): boolean {
  return state.pending.some((p) => touches(id)(p.write)) || state.unconfirmed.some((u) => touches(id)(u.write));
}

/** The honest word for an item's write: in flight is Saving…, a lost response is Unconfirmed, never Saving. */
export function pendingWord(state: WorkState, id: string): 'Saving…' | 'Unconfirmed' | null {
  if (state.unconfirmed.some((u) => touches(id)(u.write))) return 'Unconfirmed';
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

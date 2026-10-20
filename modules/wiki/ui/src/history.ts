// In-session navigation history and shell re-sync. A pure reducer: no timers, no I/O.
//
// The shell may or may not persist what we ask it to (`navigate` is a request). History therefore
// lives here; the `destination` prop is treated as an external navigation unless it is the echo of
// something this view asked for.

import type { PageKey } from '../../contract/src/index.ts';

export interface Ambiguity {
  readonly label: string;
  readonly candidates: readonly PageKey[];
}

/** `ambiguity` entries are in-session only: the contract has no destination form for disambiguation. */
export interface HistoryEntry {
  readonly destination: string;
  readonly ambiguity?: Ambiguity;
}

export interface NavState {
  readonly entries: readonly HistoryEntry[];
  readonly index: number;
  /** Last `destination` prop value this view has absorbed. */
  readonly seenProp: string;
  /** Destinations requested through `navigate` whose echo has not been seen yet. */
  readonly pending: readonly string[];
}

export type NavAction =
  | { readonly type: 'go'; readonly entry: HistoryEntry }
  | { readonly type: 'back' }
  | { readonly type: 'forward' }
  | { readonly type: 'jump'; readonly index: number }
  | { readonly type: 'prop'; readonly destination: string };

export const MAX_HISTORY = 100;
const MAX_PENDING = 8;

export function initialNav(destination: string): NavState {
  return { entries: [{ destination }], index: 0, seenProp: destination, pending: [] };
}

export function currentEntry(state: NavState): HistoryEntry {
  return state.entries[state.index] ?? { destination: state.seenProp };
}

/** The destination to hand to `navigate` for this entry, or null when the shell already shows it or the entry is in-session only. */
export function shellRequestFor(state: NavState, entry: HistoryEntry): string | null {
  if (entry.ambiguity !== undefined) return null;
  return entry.destination === state.seenProp ? null : entry.destination;
}

function sameEntry(a: HistoryEntry, b: HistoryEntry): boolean {
  return a.ambiguity === undefined && b.ambiguity === undefined && a.destination === b.destination;
}

function push(state: NavState, entry: HistoryEntry, pending: readonly string[]): NavState {
  const entries = [...state.entries.slice(0, state.index + 1), entry].slice(-MAX_HISTORY);
  return { ...state, entries, index: entries.length - 1, pending };
}

function withRequest(state: NavState, entry: HistoryEntry): readonly string[] {
  const request = shellRequestFor(state, entry);
  return request === null ? state.pending : [...state.pending, request].slice(-MAX_PENDING);
}

function moveTo(state: NavState, index: number): NavState {
  const target = Math.min(state.entries.length - 1, Math.max(0, index));
  if (target === state.index) return state;
  const entry = state.entries[target];
  if (entry === undefined) return state;
  return { ...state, index: target, pending: withRequest(state, entry) };
}

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'go':
      return sameEntry(currentEntry(state), action.entry) ? state : push(state, action.entry, withRequest(state, action.entry));
    case 'back':
      return moveTo(state, state.index - 1);
    case 'forward':
      return moveTo(state, state.index + 1);
    case 'jump':
      return moveTo(state, action.index);
    case 'prop': {
      if (action.destination === state.seenProp) return state;
      const echo = state.pending.indexOf(action.destination);
      if (echo >= 0) return { ...state, seenProp: action.destination, pending: state.pending.slice(echo + 1) };
      const next = { ...state, seenProp: action.destination, pending: [] as readonly string[] };
      return sameEntry(currentEntry(state), { destination: action.destination }) ? next : push(next, { destination: action.destination }, []);
    }
    default:
      return state;
  }
}

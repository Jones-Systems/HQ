import { useSyncExternalStore } from 'react';
import { createFeedback, DEFAULT_COLLAPSED, type Feedback } from '../board';
import { createDraftStore, type DraftStore } from '../capture';
import {
  createFixturePlanner, createWorkStore, EMPTY_FILTERS, EXAMPLE_SETTINGS, plannerToday,
  type DateInput, type Filters, type PlannerPort, type Status, type WorkStore,
} from '../core';
import { createDetailState, type DetailState } from '../detail';
import { viewItems } from '../views/fixtures';

// The Work session (RW-5, RV-6, iface.domain-module.001). T0 remounts the module on every domain switch, so
// everything Work keeps lives here, at module level and keyed by `context.id`: one Planner store shared by the
// board, the planning views, the card detail and capture, plus the toasts, HQ drafts, unsaved detail text and the
// page state (last page, filters, collapsed columns, scroll and unsaved capture text). It is in memory for this
// session only; persistence across a restart waits for a shell storage member (G-3).

export interface ScrollPosition { readonly top: number; readonly left: number; readonly columns: number }

export interface CaptureDraft {
  /** What the user has typed into the toolbar capture, kept until it is captured or cleared. */
  readonly text: string;
  /** A date the user explicitly added (from a suggestion or a calendar day); never invented. */
  readonly date: DateInput | null;
  /** The Planner was unreachable at the last explicit capture, so keeping an HQ draft is offered. */
  readonly unavailable: boolean;
  readonly error: string | null;
}

export interface WorkUiState {
  /** The last page destination, so `item/<id>` opens the detail over it. */
  readonly lastPage: string;
  readonly filters: Filters;
  readonly collapsed: readonly Status[];
  readonly scroll: Readonly<Record<string, ScrollPosition>>;
  readonly capture: CaptureDraft;
}

export const EMPTY_CAPTURE: CaptureDraft = { text: '', date: null, unavailable: false, error: null };

function createUiState() {
  let state: WorkUiState = { lastPage: 'board', filters: EMPTY_FILTERS, collapsed: DEFAULT_COLLAPSED, scroll: {}, capture: EMPTY_CAPTURE };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<WorkUiState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    getState: (): WorkUiState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    update,
    /** Scroll is recorded on every scroll event; it re-renders nothing. */
    rememberScroll(page: string, position: ScrollPosition): void {
      state = { ...state, scroll: { ...state.scroll, [page]: position } };
    },
    setCapture(patch: Partial<CaptureDraft>): void {
      update({ capture: { ...state.capture, ...patch } });
    },
  };
}

export type WorkUi = ReturnType<typeof createUiState>;

export interface WorkSession {
  readonly store: WorkStore;
  readonly feedback: Feedback;
  readonly drafts: DraftStore;
  readonly detail: DetailState;
  readonly ui: WorkUi;
  /** True while the session runs on the fictional example Planner, which the domain labels as such. */
  readonly example: boolean;
}

/** The fictional example Planner: synthetic items in memory, with the Planner's example settings. */
export function examplePlanner(now: Date = new Date()): PlannerPort {
  return createFixturePlanner({ items: viewItems(plannerToday(EXAMPLE_SETTINGS, now)), settings: { ...EXAMPLE_SETTINGS } }).port;
}

let override: { port: PlannerPort; example: boolean } | null = null;
const sessions = new Map<string, WorkSession>();

/** One session per HQ project for the life of the renderer; a remount gets the same session back. */
export function workSession(contextId: string): WorkSession {
  let session = sessions.get(contextId);
  if (!session) {
    const port = override?.port ?? examplePlanner();
    sessions.set(contextId, session = {
      store: createWorkStore(port), feedback: createFeedback(), drafts: createDraftStore(), detail: createDetailState(),
      ui: createUiState(), example: override?.example ?? true,
    });
  }
  return session;
}

/** Test seam: the Planner port new sessions use (`null` restores the example Planner). Live access stays held. */
export function setWorkSessionPort(port: PlannerPort | null, options: { example?: boolean } = {}): void {
  override = port ? { port, example: options.example ?? true } : null;
}

/** Test seam: forget every session. */
export function resetWorkSessions(): void {
  sessions.clear();
}

export function useWorkUi(ui: WorkUi): WorkUiState {
  return useSyncExternalStore(ui.subscribe, ui.getState, ui.getState);
}

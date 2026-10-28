import { useSyncExternalStore } from 'react';
import { createFeedback, DEFAULT_COLLAPSED, type Feedback } from '../board';
import { createDraftStore, type DraftStore } from '../capture';
import {
  createFixturePlanner, createWorkStore, EMPTY_FILTERS, EXAMPLE_SETTINGS, plannerToday,
  type DateInput, type Filters, type PlannerPort, type PlannerRecovery, type Status, type WorkStore,
} from '../core';
import { createDetailState, type DetailState } from '../detail';
import { bridgeTransport, createPlannerLive, isWorkBridge, type PlannerLive } from '../live';
import { viewItems } from '../views/fixtures';

// The Work session (RW-5, RV-6, iface.domain-module.001). T0 remounts the module on every domain switch, so
// everything Work keeps lives here, at module level and keyed by `context.id`: one Planner store shared by the
// board, the planning views, the card detail and capture, plus the toasts, HQ drafts, unsaved detail text and the
// page state (last page, filters, collapsed columns, scroll and unsaved capture text).
//
// The Planner is chosen once per renderer: the live Planner when the desktop bridge (`window.hqServices.work`) is
// present, otherwise the labelled fictional example. A live Planner that is unconfigured or unreachable never falls
// back to the example; the domain says it is not connected. Live Planner records persist in the Planner service.
// Everything else here, including unsaved text and unconfirmed writes, is in memory for this session only and labelled
// so; persistence across a restart waits for a shell storage member (G-3).

export interface ScrollPosition { readonly top: number; readonly left: number; readonly columns: number }

export interface CaptureDraft {
  /** What the user has typed into the toolbar capture, kept until it is captured or cleared. */
  readonly text: string;
  /** A date the user explicitly added (from a suggestion or a calendar day); never invented. */
  readonly date: DateInput | null;
  /** The Planner was unreachable at the last explicit capture, so keeping an HQ draft is offered. */
  readonly unavailable: boolean;
  readonly error: string | null;
  /** A toolbar capture is being sent. Kept with the text, so a remounted toolbar cannot send the same text again. */
  readonly sending: boolean;
}

export interface WorkUiState {
  /** The last page destination, so `item/<id>` opens the detail over it. */
  readonly lastPage: string;
  readonly filters: Filters;
  readonly collapsed: readonly Status[];
  readonly scroll: Readonly<Record<string, ScrollPosition>>;
  readonly capture: CaptureDraft;
}

export const EMPTY_CAPTURE: CaptureDraft = { text: '', date: null, unavailable: false, error: null, sending: false };

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

interface PlannerChoice { port: PlannerPort; recovery: PlannerRecovery | null; example: boolean }

let override: PlannerChoice | null = null;
/** The live Planner, chosen at most once; `null` means no bridge, `undefined` not chosen yet. */
let live: PlannerLive | null | undefined;
const sessions = new Map<string, WorkSession>();

/** The live Planner over the desktop bridge, created once; `null` when the renderer has no Work bridge. */
function livePlanner(): PlannerLive | null {
  if (live === undefined) {
    const work = (globalThis as { hqServices?: { work?: unknown } }).hqServices?.work;
    live = isWorkBridge(work) ? createPlannerLive(bridgeTransport(work)) : null;
  }
  return live;
}

function choosePlanner(): PlannerChoice | null {
  if (override) return override;
  const planner = livePlanner();
  return planner ? { port: planner.port, recovery: planner.recovery, example: false } : null;
}

/** One session per HQ project for the life of the renderer; a remount gets the same session back. */
export function workSession(contextId: string): WorkSession {
  let session = sessions.get(contextId);
  if (!session) {
    const chosen = choosePlanner();
    const port = chosen?.port ?? examplePlanner();
    sessions.set(contextId, session = {
      store: createWorkStore(port, chosen?.recovery ? { recovery: chosen.recovery } : {}), feedback: createFeedback(),
      drafts: createDraftStore(), detail: createDetailState(), ui: createUiState(), example: chosen?.example ?? true,
    });
  }
  return session;
}

/**
 * Production shell injection: call once before the first Work session with the configured live Planner and its
 * `recovery`, using `example: false`. Only explicitly unconfigured settings select `examplePlanner()` with
 * `example: true`; live errors must never trigger a fixture fallback. Keep this source fixed for the renderer:
 * settings changes use the shell's labelled reload, never a reset of productive sessions.
 * New sessions use this port ahead of the bridge (`null` restores legacy selection); existing sessions are unchanged.
 * A `recovery` resolves unknown writes for that port; without one, Check sends nothing.
 */
export function setWorkSessionPort(port: PlannerPort | null, options: { example?: boolean; recovery?: PlannerRecovery } = {}): void {
  override = port ? { port, recovery: options.recovery ?? null, example: options.example ?? true } : null;
}

/** Test seam: forget every session and the Planner choice. */
export function resetWorkSessions(): void {
  sessions.clear();
  live = undefined;
}

export function useWorkUi(ui: WorkUi): WorkUiState {
  return useSyncExternalStore(ui.subscribe, ui.getState, ui.getState);
}

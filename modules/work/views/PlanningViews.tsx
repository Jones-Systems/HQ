import { Component, useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, SaveIndicator, StateView, StatusChip, Toast, ToastRegion } from '@hq/ui';
import {
  DEFAULT_SETTINGS, EMPTY_FILTERS, formatClock, plannerToday, UNCONFIRMED_SCOPE_NOTE, useWorkState,
  type Filters, type PlannerError, type SettingsResult, type UndoOutcome, type WorkState, type WorkStore, type WriteOutcome,
} from '../core';
import { ArchiveView } from './Archive';
import { ByDateView } from './ByDate';
import { CalendarView } from './Calendar';
import { isTyping, ViewEnvProvider, type ViewEnv, type ViewLinks } from './env';
import { GlanceView } from './Glance';
import { ListView } from './ListView';
import { NO_RUN_NOTE, PROJECT_NOTE, type PlanningViewId } from './meta';
import { ReviewView } from './Review';
import { TimelineView } from './Timeline';

// The host for the Work planning views. It owns what every view shares: the
// not-project-scoped note, the save state, offline, conflict and unconfirmed
// banners, the Undo toast and Ctrl/⌘+Z, and the loading, unavailable and
// error states. Every write goes through the Work store; navigation, layout
// switches and opening an item never write and never execute anything.

export interface PlanningViewsProps extends ViewLinks {
  readonly store: WorkStore;
  readonly view: PlanningViewId;
  /** Board-level filters from the Work toolbar. `area` filters by the Planner's label, never as a project. */
  readonly filters?: Filters;
  /** Clock for "today" in the Planner display zone; tests pass a fixed one. */
  readonly now?: () => Date;
  readonly pollMs?: number;
}

const VIEWS: Record<PlanningViewId, () => ReactNode> = {
  glance: () => <GlanceView />,
  list: () => <ListView />,
  calendar: () => <CalendarView />,
  timeline: () => <TimelineView />,
  review: () => <ReviewView />,
  archive: () => <ArchiveView />,
  'by-date': () => <ByDateView />,
};

interface ToastState { key: number; message: string; undoId?: string }

/** Words for a failed write. Unavailable and order conflicts are reported by the store's own notices. */
export function failureText(error: PlannerError): string | null {
  switch (error.kind) {
    case 'invalid': return `Not saved: ${error.errors.map((e) => e.message).join(' ')}`;
    case 'revision_conflict': return 'Not saved: this item changed elsewhere. Its current version is shown.';
    case 'not_found': return 'Not saved: the item is no longer available.';
    case 'request_id_reused': return 'Saving is paused: the Planner reported a reused request ID. Nothing will be re-sent.';
    case 'unknown': return UNKNOWN_TEXT;
    case 'unavailable':
    case 'order_conflict':
      return null;
  }
}

const UNKNOWN_TEXT = 'Save result unknown. It will be checked by re-sending the same request; nothing is retried blindly.';

function undoText(outcome: UndoOutcome): string | null {
  switch (outcome.status) {
    case 'undone': return 'Undone.';
    case 'refused': return outcome.message;
    case 'empty': return 'Nothing to undo.';
    case 'unconfirmed': return UNKNOWN_TEXT;
    case 'failed': return failureText(outcome.error);
  }
}

export function PlanningViews({ store, view, filters = EMPTY_FILTERS, now = defaultNow, pollMs, openItem, editDate, capture, navigate }: PlanningViewsProps) {
  const state = useWorkState(store, { pollMs });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [announcement, setAnnouncement] = useState({ text: '', n: 0 });
  const toastKey = useRef(0);
  const settings = state.confirmed?.settings ?? DEFAULT_SETTINGS;
  const today = plannerToday(settings, now());

  const show = useCallback((message: string | null, undoId?: string) => {
    if (message) setToast({ key: (toastKey.current += 1), message, undoId });
  }, []);

  const run = useCallback(async (write: Promise<WriteOutcome> | Promise<WriteOutcome<SettingsResult>>, success: string) => {
    const outcome = await write;
    if (outcome.status === 'saved') { show(success, outcome.undoId); return true; }
    show(outcome.status === 'unconfirmed' ? UNKNOWN_TEXT : failureText(outcome.error));
    return false;
  }, [show]);

  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 })), []);

  const env: ViewEnv = useMemo(() => ({
    store, state, settings, today, now, filters, run, announce, openItem, editDate, capture, navigate,
  }), [store, state, settings, today, now, filters, run, announce, openItem, editDate, capture, navigate]);

  const undo = async (entryId?: string) => {
    const outcome = entryId ? await store.undoEntry(entryId) : await store.undo();
    show(undoText(outcome));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && !isTyping(event.target)) {
      // Marked handled so an outer Work-level shortcut does not undo twice.
      event.preventDefault();
      void undo();
    }
  };

  const body = state.confirmed === null
    ? state.load === 'unavailable'
      ? (
        <StateView
          state="unavailable"
          title="Planner service unreachable"
          description="Nothing can be shown until the Planner answers. No changes were made."
          action={{ label: 'Try again', onAction: () => void store.load() }}
        />
      )
      : <StateView state="loading" title="Loading planning…" />
    : <ViewBoundary key={view}><ViewEnvProvider value={env}>{VIEWS[view]()}</ViewEnvProvider></ViewBoundary>;

  const canUndo = toast?.undoId !== undefined && state.undo.some((e) => e.id === toast.undoId);

  return (
    <div className="wv" data-view={view} onKeyDown={onKeyDown}>
      <div className="wv-topline">
        <p className="wv-project-note" role="note">{PROJECT_NOTE}</p>
        <SaveStatus state={state} store={store} zone={settings.default_tz} />
      </div>
      {state.confirmed !== null && <Banners state={state} store={store} />}
      <div className="wv-body">{body}</div>
      <ToastRegion label="Work notifications">
        {toast && (
          <Toast
            key={toast.key}
            message={toast.message}
            meta={NO_RUN_NOTE}
            action={canUndo ? { label: 'Undo', onAction: () => { const id = toast.undoId!; setToast(null); void undo(id); } } : undefined}
            onDismiss={() => setToast(null)}
          />
        )}
      </ToastRegion>
      <p className="hq-sr-only" role="status">{announcement.text}{announcement.n % 2 ? '​' : ''}</p>
    </div>
  );
}

function defaultNow(): Date {
  return new Date();
}

function SaveStatus({ state, store, zone }: { state: WorkState; store: WorkStore; zone: string }) {
  const save = state.save;
  switch (save.kind) {
    case 'saving': return <SaveIndicator state="saving" />;
    case 'saved': return <SaveIndicator state="saved" savedAt={formatClock(save.at, zone)} />;
    case 'unconfirmed': return <SaveIndicator state="unknown" onCheck={() => void store.reconcile()} />;
    // The kit's offline wording promises a device copy; Work keeps none, so it says what is true.
    case 'offline': return <StatusChip tone="unavailable" label="Offline" detail="Planner service unreachable · changes paused" />;
    default: return null;
  }
}

function Banners({ state, store }: { state: WorkState; store: WorkStore }) {
  const title = (id: string) => state.items.find((it) => it.id === id)?.title ?? 'An item';
  return (
    <div className="wv-banners">
      {state.save.kind === 'offline' && (
        <div className="wv-banner wv-banner--warning" role="status">
          <StatusChip tone="unavailable" label="Offline" />
          <span>Planner service unreachable · changes paused. What you see is the last confirmed planning.</span>
        </div>
      )}
      {state.held && (
        <div className="wv-banner wv-banner--danger" role="alert">
          <StatusChip tone="danger" label="Paused" />
          <span>{state.held.reason} Nothing more is sent until this is resolved.</span>
        </div>
      )}
      {state.unconfirmed.map((u) => (
        <div key={u.requestId} className="wv-banner wv-banner--unknown" role="status">
          <StatusChip tone="unknown" label="Unconfirmed" detail={u.state === 'awaiting_decision' ? 'needs your decision' : 'checking'} />
          <span>
            A change to {'id' in u.write ? `“${title(u.write.id)}”` : u.write.op === 'create' ? `new item “${u.write.fields.title}”` : 'preferences'} was sent but not confirmed. It may or may not have been saved.
            {u.possiblySavedIds.length > 0 && ' A matching item may already exist.'} {UNCONFIRMED_SCOPE_NOTE}
          </span>
          {u.state === 'unconfirmed' && <Button size="sm" onClick={() => void store.reconcile()}>Check</Button>}
          {u.state === 'awaiting_decision' && <Button size="sm" onClick={() => void store.retryUnconfirmed(u.requestId)}>Re-send same request</Button>}
          {u.state !== 'held' && <Button size="sm" variant="ghost" onClick={() => store.dismissUnconfirmed(u.requestId)}>Stop tracking</Button>}
        </div>
      ))}
      {state.conflicts.map((c) => (
        <div key={c.itemId} className="wv-banner wv-banner--warning" role="status">
          <StatusChip tone="warning" label="Changed elsewhere" />
          <span>“{c.current.title}” changed on another device, so your change was not applied. Its current version is shown.</span>
          <Button size="sm" variant="ghost" onClick={() => store.dismissConflict(c.itemId)}>Dismiss</Button>
        </div>
      ))}
      {state.notices.map((n) => (
        <div key={n.id} className={`wv-banner wv-banner--${n.tone}`} role="status">
          <span>{n.text}</span>
          <Button size="sm" variant="ghost" onClick={() => store.dismissNotice(n.id)}>Dismiss</Button>
        </div>
      ))}
    </div>
  );
}

/** A view that throws shows the kit's error state instead of blanking Work. */
class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <StateView
          state="error"
          title="This view could not be shown"
          description="Nothing was changed. Other Work views still work."
          action={{ label: 'Try again', onAction: () => this.setState({ failed: false }) }}
        />
      );
    }
    return this.props.children;
  }
}

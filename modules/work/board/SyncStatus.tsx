import { createContext, useContext, type ReactNode } from 'react';
import { Button, InlineNotice, StatusChip, StatusIndicator, type StatusTone } from '@hq/ui';
import {
  formatClock, STATUS_LABEL, UNCONFIRMED_SCOPE_NOTE,
  type UnconfirmedWrite, type WorkState, type WorkStore, type WriteOp,
} from '../core';
import './feedback.css';

// Save and freshness state for the Work surfaces (RW-5, RW-9, RX-5). An
// unconfirmed write is never shown as saved and is never re-sent on its own.
// Check asks the Planner whether it was saved and applies nothing. Only when that
// proves it never landed may the user Apply it, which the Planner applies at most
// once. A look-alike item is a flag, never proof.
//
// Where each state shows (flow assessment, "Feedback and states"): the save and connection state is one
// StatusIndicator in the Work top bar; held and unconfirmed writes are InlineNotices on the page they affect.

export const OFFLINE_BANNER = 'Planner service unreachable · changes paused';
export const POSSIBLY_SAVED_NOTE = 'A similar item appeared since. It may be this change, but that is not proof either way.';
export const APPLY_LABEL = 'Apply: save it now';

const READ_BACK = 'Read the board back to see whether it was saved; nothing will be sent for it.';

/** Why an unconfirmed write's row reads as it does; Apply appears only after a Check proved it never landed. */
export function recoveryText(entry: UnconfirmedWrite): string {
  if (entry.state === 'held') return 'Held · the Planner reported this request ID was reused';
  if (entry.state === 'unconfirmed') return 'Unconfirmed · Check asks the Planner whether it was saved; nothing is re-sent';
  const recovery = entry.recovery;
  if (recovery?.kind === 'not_applied') return 'Checked · not saved. Apply saves it now; the Planner applies it at most once';
  switch (recovery?.reason) {
    case 'evicted': return `Cannot be checked · the Planner no longer keeps its record. ${READ_BACK}`;
    case 'unsupported': return `Cannot be checked · this Planner offers no replay check. ${READ_BACK}`;
    case 'no_baseline': return `Cannot be checked · no earlier Planner version was recorded for it. ${READ_BACK}`;
    case 'no_intent': return `Cannot be checked · HQ no longer holds the original request. ${READ_BACK}`;
    default: return `Cannot be checked. ${READ_BACK}`;
  }
}

function zoneOf(state: WorkState): string | undefined {
  return state.confirmed?.settings.default_tz;
}

export function describeWrite(write: WriteOp, state: WorkState): string {
  const title = (id: string) => {
    const item = state.items.find((candidate) => candidate.id === id);
    return item ? `“${item.title}”` : 'an item';
  };
  switch (write.op) {
    case 'create': return `New item “${write.fields.title}”`;
    case 'patch': return `Edit to ${title(write.id)}`;
    case 'move': return `Move of ${title(write.id)} to ${STATUS_LABEL[write.status]}`;
    case 'setArchived': return `${write.archived ? 'Archive' : 'Restore'} of ${title(write.id)}`;
    case 'markReviewed': return `Review mark on ${title(write.id)}`;
    case 'updateSettings': return 'Planner settings';
  }
}

// ------------------------------------------------------------ the one save and connection indicator

export interface SyncIndicatorModel {
  readonly tone: StatusTone;
  readonly label: string;
  readonly detail?: string;
  /** In progress: the indicator shows a spinner in place of its shape. */
  readonly busy?: boolean;
  /** The one text action: Check asks the Planner (and sends nothing); Try again reads the Planner once more. */
  readonly action?: { readonly kind: 'check' | 'retry'; readonly label: string };
}

/**
 * The top-bar indicator as a pure mapping from Work state: Saving…, Saved · 10:42, N unconfirmed · Check, or
 * Offline · last synced 10:42 · changes paused. `null` while idle, so a calm board shows nothing. Offline is
 * judged from the store's own save state, and with no snapshot yet the page's full-page state speaks instead.
 */
export function syncIndicator(state: WorkState, zone: string | undefined = zoneOf(state)): SyncIndicatorModel | null {
  const synced = state.lastSyncedAt ? formatClock(state.lastSyncedAt, zone) : null;
  const { save } = state;
  if (save.kind === 'offline' || (state.load === 'unavailable' && state.confirmed !== null)) {
    return {
      tone: 'danger', label: 'Offline',
      detail: `${synced ? `last synced ${synced}` : 'not synced yet'} · changes paused`,
      action: { kind: 'retry', label: 'Try again' },
    };
  }
  switch (save.kind) {
    case 'unconfirmed': return { tone: 'unknown', label: `${save.count} unconfirmed`, action: { kind: 'check', label: 'Check' } };
    case 'saving': return { tone: 'neutral', label: 'Saving…', busy: true };
    case 'saved': return { tone: 'success', label: 'Saved', detail: formatClock(save.at, zone) };
    default: return null;
  }
}

/**
 * Set by the Work top bar, which already carries the indicator and the offline state. Surfaces that would repeat
 * them (the board header's save state, the offline bar) stay quiet inside it and speak when mounted alone.
 */
export const TopBarStatusContext = createContext(false);

export function TopBarStatus({ children }: { children: ReactNode }) {
  return <TopBarStatusContext.Provider value={true}>{children}</TopBarStatusContext.Provider>;
}

/** The save and connection state as a StatusIndicator. */
export function SyncIndicator({ store, state }: { store: WorkStore; state: WorkState }) {
  const model = syncIndicator(state);
  if (!model) return null;
  const { action } = model;
  return (
    <StatusIndicator
      tone={model.tone} label={model.label} detail={model.detail} busy={model.busy}
      action={action ? { label: action.label, onAction: () => void (action.kind === 'check' ? store.reconcile() : store.poll()) } : undefined}
    />
  );
}

/** The compact save state for a page header. Inside the Work top bar it stays quiet: the bar shows it once. */
export function SaveState({ store, state }: { store: WorkStore; state: WorkState }) {
  const inBar = useContext(TopBarStatusContext);
  return inBar ? null : <SyncIndicator store={store} state={state} />;
}

// ------------------------------------------------------------ notices on the page

function UnconfirmedRow({ entry, store, state }: { entry: UnconfirmedWrite; store: WorkStore; state: WorkState }) {
  const flagged = entry.possiblySavedIds
    .map((id) => state.confirmed?.items.find((item) => item.id === id))
    .filter((item) => item !== undefined);
  return (
    <li className="work-unconfirmed-row" data-state={entry.state}>
      <div className="work-unconfirmed-text">
        <strong>{describeWrite(entry.write, state)}</strong>
        <span className="hq-meta">
          {recoveryText(entry)}
        </span>
        {flagged.length > 0 && (
          <span className="work-possibly-saved" role="note">
            <StatusChip tone="unknown" label="Possibly already saved" />
            <span>{POSSIBLY_SAVED_NOTE} Look-alike: {flagged.map((item) => `“${item.title}”`).join(', ')}.</span>
          </span>
        )}
      </div>
      <div className="work-unconfirmed-actions">
        {store.canApply(entry.requestId) && (
          <Button size="sm" onClick={() => void store.retryUnconfirmed(entry.requestId)}>{APPLY_LABEL}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => store.dismissUnconfirmed(entry.requestId)}>Stop tracking</Button>
      </div>
    </li>
  );
}

/**
 * Problems with writes, in context: the held queue and the unconfirmed list, each a compact InlineNotice that keeps
 * the board readable below it. The offline notice shows here only when no Work top bar already says so.
 */
export function SyncBanners({ store, state }: { store: WorkStore; state: WorkState }) {
  const inBar = useContext(TopBarStatusContext);
  // Before any snapshot the page's own unavailable view says this; the notice is for a stale, shown board.
  const offline = state.confirmed !== null && (state.save.kind === 'offline' || state.load === 'unavailable');
  const synced = state.lastSyncedAt ? formatClock(state.lastSyncedAt, zoneOf(state)) : null;
  if (!(offline && !inBar) && !state.held && state.unconfirmed.length === 0) return null;
  return (
    <div className="work-sync">
      {offline && !inBar && (
        <InlineNotice
          tone="warning" variant="bar" live="polite"
          title={`Offline · ${synced ? `last synced ${synced}` : 'not synced yet'}`}
          actions={[{ label: 'Try again', onAction: () => void store.poll() }]}
        >
          {`${OFFLINE_BANNER}. What you see may be out of date.`}
        </InlineNotice>
      )}
      {state.held && (
        <InlineNotice
          tone="danger" variant="bar" title="Queue held"
          actions={[{ label: 'Stop tracking', onAction: () => store.dismissUnconfirmed(state.held!.requestId) }]}
        >
          {`${state.held.reason} Nothing more is checked or sent until you stop tracking it.`}
        </InlineNotice>
      )}
      {state.unconfirmed.length > 0 && (
        <section className="work-unconfirmed" aria-label="Unconfirmed changes">
          <InlineNotice
            tone="unknown" variant="bar" live="off" title={`${state.unconfirmed.length} unconfirmed`}
            actions={state.held ? [] : [{ label: 'Check now', onAction: () => void store.reconcile() }]}
          >
            {UNCONFIRMED_SCOPE_NOTE}
          </InlineNotice>
          <ul className="work-unconfirmed-list">
            {state.unconfirmed.map((entry) => <UnconfirmedRow key={entry.requestId} entry={entry} store={store} state={state} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Last-synced freshness, so a stale view never reads as current (RX-5). */
export function Freshness({ state }: { state: WorkState }) {
  if (state.load === 'unavailable' && !state.confirmed) return <StatusChip tone="unavailable" label="Not connected" />;
  if (!state.lastSyncedAt) return <StatusChip tone="unknown" label="Not synced yet" />;
  const offline = state.save.kind === 'offline';
  return <StatusChip tone={offline ? 'warning' : 'success'} label={offline ? 'Stale' : 'Synced'} detail={formatClock(state.lastSyncedAt, zoneOf(state))} />;
}

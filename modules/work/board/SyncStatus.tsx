import { Button, SaveIndicator, StatusChip } from '@hq/ui';
import {
  formatClock, STATUS_LABEL, UNCONFIRMED_SCOPE_NOTE,
  type UnconfirmedWrite, type WorkState, type WorkStore, type WriteOp,
} from '../core';

// Save and freshness state for the Work surfaces (RW-5, RW-9, RX-5). An
// unconfirmed write is never shown as saved: it is reconciled only by re-sending
// the same request, and a look-alike item is a flag, never proof.

export const OFFLINE_BANNER = 'Planner service unreachable · changes paused';
export const POSSIBLY_SAVED_NOTE = 'A similar item appeared since. It may be this change, but that is not proof either way.';

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

/** The compact save state for a header: Saving…, Saved · time, N unconfirmed, or Offline · not saving. */
export function SaveState({ store, state }: { store: WorkStore; state: WorkState }) {
  const { save } = state;
  switch (save.kind) {
    case 'saving': return <SaveIndicator state="saving" />;
    case 'saved': return <SaveIndicator state="saved" savedAt={`· ${formatClock(save.at, zoneOf(state))}`} />;
    case 'unconfirmed': return (
      <span className="work-save-unconfirmed">
        <SaveIndicator state="unknown" onCheck={() => void store.reconcile()} />
        <span className="hq-meta">{save.count} unconfirmed</span>
      </span>
    );
    case 'offline': return <StatusChip tone="unavailable" label="Offline" detail="not saving" />;
    default: return null;
  }
}

function UnconfirmedRow({ entry, store, state }: { entry: UnconfirmedWrite; store: WorkStore; state: WorkState }) {
  const flagged = entry.possiblySavedIds
    .map((id) => state.confirmed?.items.find((item) => item.id === id))
    .filter((item) => item !== undefined);
  return (
    <li className="work-unconfirmed-row" data-state={entry.state}>
      <div className="work-unconfirmed-text">
        <strong>{describeWrite(entry.write, state)}</strong>
        <span className="hq-meta">
          {entry.state === 'unconfirmed' && 'Unconfirmed · will be checked by re-sending the same request'}
          {entry.state === 'awaiting_decision' && 'Unconfirmed · its replay record may have expired, so it is never re-sent automatically'}
          {entry.state === 'held' && 'Held · the Planner reported this request ID was reused'}
        </span>
        {flagged.length > 0 && (
          <span className="work-possibly-saved" role="note">
            <StatusChip tone="unknown" label="Possibly already saved" />
            <span>{POSSIBLY_SAVED_NOTE} Look-alike: {flagged.map((item) => `“${item.title}”`).join(', ')}.</span>
          </span>
        )}
      </div>
      <div className="work-unconfirmed-actions">
        {entry.state === 'awaiting_decision' && (
          <Button size="sm" onClick={() => void store.retryUnconfirmed(entry.requestId)}>Re-send same request</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => store.dismissUnconfirmed(entry.requestId)}>Stop tracking</Button>
      </div>
    </li>
  );
}

/** Offline, held and unconfirmed banners, plus the last-synced freshness line. */
export function SyncBanners({ store, state }: { store: WorkStore; state: WorkState }) {
  // Before any snapshot the board's own unavailable view says this; the banner is for a stale, shown board.
  const offline = state.confirmed !== null && (state.save.kind === 'offline' || state.load === 'unavailable');
  const synced = state.lastSyncedAt ? formatClock(state.lastSyncedAt, zoneOf(state)) : null;
  return (
    <div className="work-sync">
      {offline && (
        <div className="work-banner work-banner--offline" role="status">
          <StatusChip tone="unavailable" label="Offline" detail={synced ? `last synced ${synced}` : 'not synced yet'} />
          <span>{OFFLINE_BANNER}. What you see may be out of date.</span>
          <Button size="sm" onClick={() => void store.poll()}>Try again</Button>
        </div>
      )}
      {state.held && (
        <div className="work-banner work-banner--held" role="alert">
          <StatusChip tone="danger" label="Queue held" />
          <span>{state.held.reason} Nothing more is re-sent until you stop tracking it.</span>
          <Button size="sm" variant="ghost" onClick={() => store.dismissUnconfirmed(state.held!.requestId)}>Stop tracking</Button>
        </div>
      )}
      {state.unconfirmed.length > 0 && (
        <section className="work-unconfirmed" aria-label="Unconfirmed changes">
          <header className="work-unconfirmed-head">
            <StatusChip tone="unknown" label={`${state.unconfirmed.length} unconfirmed`} />
            <span className="hq-meta">{UNCONFIRMED_SCOPE_NOTE}</span>
            <Button size="sm" onClick={() => void store.reconcile()} disabled={Boolean(state.held)}>Check now</Button>
          </header>
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

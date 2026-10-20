import { useSyncExternalStore } from 'react';
import type { HandoffStatusPort, NavigationPort } from '../src/contract.ts';
import { navigate } from '../src/intents.ts';
import type { FieldVariance } from '../src/handoff.ts';
import type { RequestSession } from '../src/session.ts';
import { shortDigest } from './model.ts';
import './requests.css';

export interface RunsViewProps {
  readonly session: RequestSession;
  /** Read-only status readback. It cannot send; absent means readback is not connected. */
  readonly statusPort?: HandoffStatusPort | null;
  readonly navigation?: NavigationPort | null;
  /** Supplied by the shell so rendering is deterministic. */
  readonly now: string;
}

const VARIANCE_TEXT: Readonly<Record<FieldVariance, string>> = {
  match: 'matches the pin',
  differs: 'differs from the pin',
  unpinned: 'no pin recorded',
  unreported: 'not reported by the receiver',
};

const text = (value: string | undefined) => value ?? 'not reported';
const time = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** Per-packet handoff status. Opening or refreshing it reads only; it never sends. */
export function RunsView({ session, statusPort = null, navigation = null, now }: RunsViewProps) {
  const state = useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
  return <section className="hqr-panel" aria-labelledby="hqr-runs-title">
    <header className="hqr-panel-header">
      <h2 id="hqr-runs-title">Runs</h2>
      <p className="hqr-hint">Status as last reported by the connector. Reading it never sends anything.</p>
    </header>
    {state.packets.length === 0 ? <p className="hqr-empty">No frozen packets yet.</p> : <ol className="hqr-list" reversed>
      {[...state.packets].reverse().map((packet) => {
        const view = session.handoffView(packet.packetId, now)!;
        const status = view.status;
        const destination = status?.destination?.label ?? view.send?.destination.label ?? (packet.destination.kind === 'existing-thread' ? packet.destination.label : null);
        return <li key={packet.packetId} data-state={view.state}>
          <div className="hqr-packet-line">
            <strong>#{packet.lineage.sequence}</strong> {packet.title}
            <span className="hqr-badge" data-handoff={view.state}>{view.label}</span>
            {view.freshness === 'stale' && <span className="hqr-badge hqr-badge-quiet">Stale</span>}
          </div>
          <dl className="hqr-facts">
            <dt>Destination</dt><dd>{destination ?? 'none chosen'}</dd>
            <dt>Last reported</dt><dd>{status ? time(status.observedAt) : 'never reported'}</dd>
            <dt>Pinned host</dt><dd>{text(status?.pinned?.host)}</dd>
            <dt>Reported host</dt><dd>{text(status?.actual?.host)} <span className="hqr-muted">({VARIANCE_TEXT[view.variance.host]})</span></dd>
            <dt>Pinned model</dt><dd>{text(status?.pinned?.model)}</dd>
            <dt>Reported model</dt><dd>{text(status?.actual?.model)} <span className="hqr-muted">({VARIANCE_TEXT[view.variance.model]})</span></dd>
            <dt>Digest</dt><dd><code title={packet.authoringDigest}>{shortDigest(packet.authoringDigest)}</code></dd>
          </dl>
          {view.variance.varies && <p className="hqr-alert" role="alert">The receiver reports a different host or model than was pinned. Nothing was substituted by HQ.</p>}
          {status?.detail && <p className="hqr-muted">{status.detail}</p>}
          {view.state === 'unknown' && <p className="hqr-hint">Delivery is unknown. This packet cannot be sent again.</p>}
        </li>;
      })}
    </ol>}
    {state.readbackNotes.length > 0 && <ul className="hqr-blockers" aria-label="Readback notes">{state.readbackNotes.map((note) => <li key={note}>{note}</li>)}</ul>}
    <div className="hqr-inline">
      {statusPort
        ? <button type="button" onClick={() => { void session.refreshHandoff(statusPort); }}>Refresh status</button>
        : <p className="hqr-hint" role="note">Status readback is not connected. Showing the last stored status.</p>}
      {navigation && <button type="button" onClick={() => { navigate(navigation, { type: 'open-request', requestId: state.requestId }); }}>Back to request</button>}
    </div>
  </section>;
}

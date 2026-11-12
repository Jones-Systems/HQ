import { Button, InlineNotice, StatusChip, StatusIndicator, useAsyncAction, useListMotion } from '@hq/ui';
import { useSyncExternalStore, type ReactNode } from 'react';
import type { DecisionPacket, HandoffStatusPort, NavigationPort, PacketId } from '../src/contract.ts';
import { navigate } from '../src/intents.ts';
import type { FieldVariance, HandoffView } from '../src/handoff.ts';
import type { RequestSession } from '../src/session.ts';
import { cx } from './GuardedButton.tsx';
import { useChangeFlash } from './hooks.ts';
import { handoffBusy, handoffTimeline, handoffTone, shortDigest, utc, type Timeline } from './model.ts';
import './requests.css';

export interface RunsViewProps {
  readonly session: RequestSession;
  /** Read-only status readback. It cannot send; absent means readback is not connected. */
  readonly statusPort?: HandoffStatusPort | null;
  readonly navigation?: NavigationPort | null;
  /** Supplied by the shell so rendering is deterministic. */
  readonly now: string;
  /** Extra controls for one packet's card, such as opening it in the connector. They are the host's to guard. */
  readonly packetActions?: (packet: DecisionPacket, view: HandoffView) => ReactNode;
  /** The packet currently open in the connector; its card is marked. */
  readonly openedPacketId?: PacketId | null;
  /** A destination with exactly this label is the labelled simulation, and its card says so. */
  readonly simulationLabel?: string | null;
}

const VARIANCE_TEXT: Readonly<Record<FieldVariance, string>> = {
  match: 'matches the pin',
  differs: 'differs from the pin',
  unpinned: 'no pin recorded',
  unreported: 'not reported by the receiver',
};

const text = (value: string | undefined) => value ?? 'not reported';

/** Per-packet handoff status as cards. Opening or refreshing it reads only; it never sends. */
export function RunsView({ session, statusPort = null, navigation = null, now, packetActions, openedPacketId = null, simulationLabel = null }: RunsViewProps) {
  const state = useSessionState(session);
  const packets = [...state.packets].reverse();
  const listRef = useListMotion<HTMLOListElement>(packets.map((packet) => packet.packetId as string));
  const refresh = useAsyncAction(async () => { if (statusPort) await session.refreshHandoff(statusPort); }, { error: "Couldn't read the status" });
  return <section className="hqr-panel" aria-labelledby="hqr-runs-title">
    <header className="hqr-panel-header">
      <h2 id="hqr-runs-title">Runs</h2>
      <p className="hqr-hint">Status as last reported by the connector. Reading it never sends anything.</p>
    </header>
    {packets.length === 0 ? <p className="hqr-empty">No frozen packets yet.</p> : <ol ref={listRef} className="hqr-cards" aria-label="Frozen packets">
      {packets.map((packet) => {
        const view = session.handoffView(packet.packetId, now)!;
        return <PacketCard key={packet.packetId} packet={packet} view={view} opened={openedPacketId === packet.packetId}
          simulationLabel={simulationLabel}>{packetActions?.(packet, view)}</PacketCard>;
      })}
    </ol>}
    {state.readbackNotes.length > 0 && <InlineNotice tone="warning" title="Some status couldn't be read">
      {state.readbackNotes.join(' ')} The last stored status stays on screen.
    </InlineNotice>}
    <div className="hqr-inline">
      {statusPort
        ? <Button type="button" busy={refresh.pending} busyLabel="Refreshing" onClick={() => { void refresh.run(); }}>Refresh status</Button>
        : <p className="hqr-hint" role="note">Status readback is not connected. Showing the last stored status.</p>}
      {navigation && <Button type="button" variant="ghost" onClick={() => { navigate(navigation, { type: 'open-request', requestId: state.requestId }); }}>Back to request</Button>}
    </div>
  </section>;
}

function PacketCard({ packet, view, opened, simulationLabel, children }: {
  readonly packet: DecisionPacket; readonly view: HandoffView; readonly opened: boolean;
  readonly simulationLabel: string | null; readonly children?: ReactNode;
}) {
  const flash = useChangeFlash(view.state);
  const status = view.status;
  const destination = status?.destination?.label ?? view.send?.destination.label ?? (packet.destination.kind === 'existing-thread' ? packet.destination.label : null);
  const simulated = simulationLabel !== null && destination === simulationLabel;
  const timeline = handoffTimeline(view, simulated);
  return <li {...flash} className={cx('hqr-card', flash.className)} data-state={view.state} data-handoff={view.state}
    data-opened={opened} data-hq-motion-key={packet.packetId}>
    <div className="hqr-card-head">
      <strong className="hqr-card-seq">#{packet.lineage.sequence}</strong>
      <span className="hqr-card-title">{packet.title}</span>
      <span className="hqr-card-status">
        {simulated && <StatusChip tone="info" label="Simulation" />}
        {view.variance.varies && <StatusChip tone="warning" label="Differs from pin" />}
        {view.freshness === 'stale' && <span className="hqr-badge hqr-badge-quiet">Stale</span>}
        <StatusIndicator tone={handoffTone(view.state)} busy={handoffBusy(view.state)} label={view.label} />
      </span>
    </div>
    <PacketTimeline timeline={timeline} sequence={packet.lineage.sequence} />
    <dl className="hqr-facts hqr-facts-brief">
      <dt>Destination</dt><dd>{destination ?? 'none chosen'}</dd>
      <dt>Last reported</dt><dd>{status ? utc(status.observedAt) : 'never reported'}</dd>
    </dl>
    <details className="hqr-more">
      <summary>Host, model and digest</summary>
      <dl className="hqr-facts">
        <dt>Pinned host</dt><dd>{text(status?.pinned?.host)}</dd>
        <dt>Reported host</dt><dd>{text(status?.actual?.host)} <span className="hqr-muted">({VARIANCE_TEXT[view.variance.host]})</span></dd>
        <dt>Pinned model</dt><dd>{text(status?.pinned?.model)}</dd>
        <dt>Reported model</dt><dd>{text(status?.actual?.model)} <span className="hqr-muted">({VARIANCE_TEXT[view.variance.model]})</span></dd>
        <dt>Digest</dt><dd><code title={packet.authoringDigest}>{shortDigest(packet.authoringDigest)}</code></dd>
      </dl>
    </details>
    {view.variance.varies && <InlineNotice tone="warning" variant="bar" live="off" title="Different host or model">
      The receiver reports a different host or model than was pinned. Nothing was substituted by HQ.</InlineNotice>}
    {status?.detail && <p className="hqr-muted">{status.detail}</p>}
    {view.state === 'unknown' && <InlineNotice tone="unknown" variant="bar" live="off" title="Delivery is unknown">This packet cannot be sent again.</InlineNotice>}
    {children && <div className="hqr-card-actions">{children}</div>}
  </li>;
}

function PacketTimeline({ timeline, sequence }: { readonly timeline: Timeline; readonly sequence: number }) {
  return <ol className="hqr-timeline" aria-label={`Progress of packet #${sequence}`} data-position={timeline.position}>
    {timeline.stages.map((stage) => <li key={stage.id} data-status={stage.status} aria-current={stage.status === 'current' ? 'step' : undefined}>
      <span className="hqr-timeline-dot" aria-hidden="true">
        {stage.status === 'done' && <svg viewBox="0 0 16 16"><path d="m4 8.5 2.6 2.6L12 5.6" /></svg>}
        {stage.status === 'problem' && <svg viewBox="0 0 16 16"><path d="M8 4.5v4.2M8 11.2h.01" /></svg>}
      </span>
      <span className="hqr-timeline-label">{stage.label}</span>
      {stage.status === 'done' && <span className="hq-sr-only">, done</span>}
      {stage.status === 'problem' && <span className="hq-sr-only">, needs attention</span>}
    </li>)}
  </ol>;
}

function useSessionState(session: RequestSession) {
  return useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
}

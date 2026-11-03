import { Button, InlineNotice } from '@hq/ui';
import { useId, useState } from 'react';
import type { DispatchSlot, NavigationPort } from '../src/contract.ts';
import type { RequestSession, SessionState } from '../src/session.ts';
import { navigate } from '../src/intents.ts';
import { GuardedButton } from './GuardedButton.tsx';
import { plural, shortDigest, utc } from './model.ts';

export interface PacketHistoryProps {
  readonly session: RequestSession;
  readonly state: SessionState;
  /** Connector hand-off. Absent: sending is visibly unavailable. */
  readonly dispatch: DispatchSlot | null;
  /** Supplied by the shell so rendering is deterministic. */
  readonly now: string;
  readonly navigation?: NavigationPort | null;
}

export function PacketHistory({ session, state, dispatch, now, navigation = null }: PacketHistoryProps) {
  const [confirming, setConfirming] = useState(false);
  const blockersId = useId();
  const packets = state.packets;
  if (packets.length === 0) return null;
  const head = packets.at(-1)!;
  const view = session.handoffView(head.packetId, now);
  const destination = head.destination.kind === 'existing-thread' ? head.destination : null;
  const blockers = view?.blockers ?? [];
  const sendReason = state.busy !== null ? 'Wait for the current change to finish.'
    : confirming ? 'Confirm or cancel the send below.'
      : blockers.length > 0 ? blockers.join(' ') : null;
  return <section className="hqr-panel" aria-labelledby="hqr-packets-title">
    <h2 id="hqr-packets-title">Frozen packets</h2>
    <ol className="hqr-packets" reversed>{[...packets].reverse().map((packet) => {
      const packetView = session.handoffView(packet.packetId, now);
      return <li key={packet.packetId} data-head={packet === head}>
        <div className="hqr-packet-line">
          <strong>#{packet.lineage.sequence}</strong> {packet.title}
          {packet === head ? <span className="hqr-badge">Current</span> : <span className="hqr-badge hqr-badge-quiet">Superseded</span>}
          {packetView && <span className="hqr-badge hqr-badge-quiet" data-handoff={packetView.state}>{packetView.label}</span>}
        </div>
        <div className="hqr-muted">
          Frozen {utc(packet.frozenAt)} · <code title={packet.authoringDigest}>{shortDigest(packet.authoringDigest)}</code>
          {packet.supersedes && <> · supersedes #{packet.lineage.sequence - 1}</>}
          {packet.lineage.origin === 'revision' && <> · revision after review</>}
          {' '}· {plural(packet.attachments.length, 'selected attachment')}
        </div>
        {navigation && <div className="hqr-inline">
          <Button type="button" size="sm" onClick={() => { navigate(navigation, { type: 'open-packet', requestId: state.requestId, packetId: packet.packetId }); }}>Open packet</Button>
        </div>}
      </li>;
    })}</ol>
    <div className="hqr-send">
      {dispatch
        ? <>
          <GuardedButton unavailable={sendReason} reasonId={blockers.length > 0 ? blockersId : undefined} onClick={() => setConfirming(true)}>Send packet #{head.lineage.sequence}…</GuardedButton>
          {blockers.length > 0 && <ul id={blockersId} className="hqr-blockers" aria-label="Why sending is unavailable">{blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          {confirming && destination && <div className="hqr-confirm" role="group" aria-label="Confirm send">
            <p>Send packet #{head.lineage.sequence} to <strong>{destination.label}</strong>? This hands the frozen packet over once. It cannot be sent again.</p>
            <div className="hqr-inline">
              <Button type="button" variant="primary" onClick={() => { setConfirming(false); void session.send(dispatch, head.packetId, destination.destinationId); }}>Confirm send</Button>
              <Button type="button" onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          </div>}
        </>
        : navigation
          ? <div className="hqr-inline">
            <p className="hqr-hint" role="note">Sending happens in Runs, with its own explicit confirmation. Nothing is sent from here.</p>
            <Button type="button" size="sm" onClick={() => { navigate(navigation, { type: 'open-runs', requestId: state.requestId }); }}>Open Runs</Button>
          </div>
          : <p className="hqr-hint" role="note">Sending is unavailable here: no qualified destination is connected.</p>}
      {view?.state === 'submitting' && <InlineNotice tone="info" variant="bar" title="Handed to the connector">Its receipt and status appear in Runs.</InlineNotice>}
      {view?.state === 'unknown' && <InlineNotice tone="unknown" variant="bar" title="Delivery is unknown" live="off">Check Runs; this packet will not be sent again.</InlineNotice>}
    </div>
  </section>;
}

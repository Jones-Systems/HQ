import { Button } from '@hq/ui';
import { useState } from 'react';
import type { DispatchSlot, NavigationPort } from '../src/contract.ts';
import type { RequestSession, SessionState } from '../src/session.ts';
import { navigate } from '../src/intents.ts';
import { shortDigest } from './model.ts';

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
  const packets = state.packets;
  if (packets.length === 0) return null;
  const head = packets.at(-1)!;
  const view = session.handoffView(head.packetId, now);
  const destination = head.destination.kind === 'existing-thread' ? head.destination : null;
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
          Frozen {packet.frozenAt.slice(0, 16).replace('T', ' ')} UTC · <code title={packet.authoringDigest}>{shortDigest(packet.authoringDigest)}</code>
          {packet.supersedes && <> · supersedes #{packet.lineage.sequence - 1}</>}
          {packet.lineage.origin === 'revision' && <> · revision after review</>}
          {' '}· {packet.attachments.length} selected attachment{packet.attachments.length === 1 ? '' : 's'}
        </div>
        {navigation && <div className="hqr-inline">
          <Button type="button" onClick={() => { navigate(navigation, { type: 'open-packet', requestId: state.requestId, packetId: packet.packetId }); }}>Open packet</Button>
        </div>}
      </li>;
    })}</ol>
    <div className="hqr-send">
      {dispatch
        ? <>
          <Button type="button" disabled={!view?.canSend || state.busy !== null || confirming} onClick={() => setConfirming(true)}>
            Send packet #{head.lineage.sequence}…
          </Button>
          {view && view.blockers.length > 0 && <ul className="hqr-blockers" aria-label="Why sending is unavailable">{view.blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          {confirming && destination && <div className="hqr-alert" role="group" aria-label="Confirm send">
            <p>Send packet #{head.lineage.sequence} to <strong>{destination.label}</strong>? This hands the frozen packet over once. It cannot be sent again.</p>
            <div className="hqr-inline">
              <Button type="button" variant="primary" onClick={() => { setConfirming(false); void session.send(dispatch, head.packetId, destination.destinationId); }}>Confirm send</Button>
              <Button type="button" onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          </div>}
        </>
        : <p className="hqr-hint" role="note">Sending is unavailable here: no qualified destination is connected.</p>}
      {view?.state === 'submitting' && <p className="hqr-hint" role="status">Handed to the connector. Its receipt and status appear in Runs.</p>}
      {view?.state === 'unknown' && <p className="hqr-hint" role="status">Delivery is unknown. Check Runs; this packet will not be sent again.</p>}
    </div>
  </section>;
}

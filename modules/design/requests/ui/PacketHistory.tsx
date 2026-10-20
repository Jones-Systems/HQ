import { useState } from 'react';
import type { DecisionPacket, DispatchSlot } from '../src/contract.ts';
import { linkOf } from '../src/draft.ts';
import { shortDigest } from './model.ts';

export interface PacketHistoryProps {
  readonly packets: readonly DecisionPacket[];
  /** Connector hand-off. Absent: sending is visibly unavailable. */
  readonly dispatch: DispatchSlot | null;
}

export function PacketHistory({ packets, dispatch }: PacketHistoryProps) {
  const [handed, setHanded] = useState<string | null>(null);
  if (packets.length === 0) return null;
  const head = packets.at(-1)!;
  return <section className="hqr-panel" aria-labelledby="hqr-packets-title">
    <h2 id="hqr-packets-title">Frozen packets</h2>
    <ol className="hqr-packets" reversed>{[...packets].reverse().map((packet) => <li key={packet.packetId} data-head={packet === head}>
      <div className="hqr-packet-line">
        <strong>#{packet.lineage.sequence}</strong> {packet.title}
        {packet === head ? <span className="hqr-badge">Current</span> : <span className="hqr-badge hqr-badge-quiet">Superseded</span>}
      </div>
      <div className="hqr-muted">
        Frozen {packet.frozenAt.slice(0, 16).replace('T', ' ')} UTC · <code title={packet.authoringDigest}>{shortDigest(packet.authoringDigest)}</code>
        {packet.supersedes && <> · supersedes #{packet.lineage.sequence - 1}</>}
        {packet.lineage.origin === 'revision' && <> · revision after review</>}
        {' '}· {packet.attachments.length} selected attachment{packet.attachments.length === 1 ? '' : 's'}
      </div>
    </li>)}</ol>
    <div className="hqr-send">
      {dispatch
        ? <button type="button" disabled={handed === head.packetId} onClick={() => { dispatch.requestSend(linkOf(head)); setHanded(head.packetId); }}>
          Send packet #{head.lineage.sequence}…
        </button>
        : <p className="hqr-hint" role="note">Sending is unavailable here: no qualified destination is connected.</p>}
      {handed === head.packetId && <p className="hqr-hint" role="status">Handed to the connector. Its receipt and status appear there.</p>}
    </div>
  </section>;
}

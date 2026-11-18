import { Button } from '@hq/ui';
import { useState } from 'react';
import type { CandidateId, NavigationPort, ReturnsPort } from '../src/contract.ts';
import { navigate } from '../src/intents.ts';
import type { RequestSession, SessionState } from '../src/session.ts';
import { unreviewedCount } from '../src/inbox.ts';

export interface ReturnsInboxProps {
  readonly session: RequestSession;
  readonly state: SessionState;
  /** Read-only readback of returned work. It cannot send. */
  readonly returnsPort?: ReturnsPort | null;
  readonly navigation?: NavigationPort | null;
  readonly selectedCandidateId?: CandidateId | null;
  readonly onSelect: (candidateId: CandidateId) => void;
}

const DECISION_LABELS = { accept: 'Accepted', revise: 'Revised', defer: 'Deferred', reject: 'Rejected' } as const;

export function ReturnsInbox({ session, state, returnsPort = null, navigation = null, selectedCandidateId = null, onSelect }: ReturnsInboxProps) {
  const items = session.inbox;
  const head = state.packets.at(-1) ?? null;
  const [claims, setClaims] = useState('');
  const [artifact, setArtifact] = useState('');
  const disabled = state.busy !== null || state.readOnly !== null || state.unknown;
  return <section className="hqr-panel" aria-labelledby="hqr-inbox-title">
    <header className="hqr-panel-header">
      <h2 id="hqr-inbox-title">Returned work <span className="hqr-muted">{unreviewedCount(items)} awaiting review</span></h2>
      <p className="hqr-hint">Returned work stays here until you decide. Opening it never sends or runs anything.</p>
    </header>
    {items.length === 0 ? <p className="hqr-empty">Nothing has come back yet.</p> : <ul className="hqr-list">{items.map((item) => {
      const sequence = state.packets.find((packet) => packet.packetId === item.candidate.packet.packetId)?.lineage.sequence;
      return <li key={item.candidate.candidateId} data-origin={item.origin} aria-current={selectedCandidateId === item.candidate.candidateId ? 'true' : undefined}>
        <div className="hqr-packet-line">
          <strong>{sequence ? `Packet #${sequence}` : 'Unmatched packet'}</strong>
          <span className="hqr-badge">{item.decision ? DECISION_LABELS[item.decision] : 'Awaiting review'}</span>
          {item.origin === 'owner-reported' && <span className="hqr-badge hqr-badge-quiet">Owner-reported</span>}
          {item.versionless && <span className="hqr-badge hqr-badge-quiet">No comparable version</span>}
        </div>
        <div className="hqr-muted">{item.candidate.claims.length} claim{item.candidate.claims.length === 1 ? '' : 's'} · {item.candidate.evidence.length} artifact{item.candidate.evidence.length === 1 ? '' : 's'} · reported {item.candidate.observedAt.slice(0, 16).replace('T', ' ')} UTC</div>
        <div className="hqr-inline">
          <Button type="button" onClick={() => {
            onSelect(item.candidate.candidateId);
            if (navigation) navigate(navigation, { type: 'open-returned', requestId: state.requestId, candidateId: item.candidate.candidateId });
          }}>Open for review</Button>
        </div>
      </li>;
    })}</ul>}
    {returnsPort && <div className="hqr-inline">
      <Button type="button" onClick={() => { void session.refreshReturns(returnsPort); }}>Check for returned work</Button>
    </div>}
    {head && <form className="hqr-manual" onSubmit={(event) => {
      event.preventDefault();
      const lines = claims.split('\n').map((entry) => entry.trim()).filter(Boolean);
      if (lines.length === 0) return;
      void session.reportReturn({ packetId: head.packetId, claims: lines, ...(artifact.trim() ? { artifacts: [{ kind: 'note' as const, label: artifact.trim() }] } : {}) })
        .then((done) => { if (done) { setClaims(''); setArtifact(''); } });
    }}>
      <h3>Record a manual return</h3>
      <p className="hqr-hint">For work that came back outside HQ. It is saved once, labelled owner-reported, and never counts as observed or verified.</p>
      <label className="hqr-field">What came back (one statement per line)
        <textarea rows={3} value={claims} disabled={disabled} onChange={(event) => setClaims(event.target.value)} />
      </label>
      <label className="hqr-field">Artifact note (optional)
        <input value={artifact} disabled={disabled} maxLength={300} onChange={(event) => setArtifact(event.target.value)} />
      </label>
      <Button type="submit" disabled={disabled || claims.trim() === ''}>Record manual return for packet #{head.lineage.sequence}</Button>
    </form>}
  </section>;
}

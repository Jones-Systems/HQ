import { Button, useToast } from '@hq/ui';
import type { CandidateId, NavigationPort, ReturnsPort } from '../src/contract.ts';
import { navigate } from '../src/intents.ts';
import type { RequestSession, SessionState } from '../src/session.ts';
import { unreviewedCount } from '../src/inbox.ts';
import { ManualReturn } from './ManualReturn.tsx';
import { ReturnedRow } from './ReturnedRow.tsx';

export interface ReturnsInboxProps {
  readonly session: RequestSession;
  readonly state: SessionState;
  /** Read-only readback of returned work. It cannot send. */
  readonly returnsPort?: ReturnsPort | null;
  readonly navigation?: NavigationPort | null;
  readonly selectedCandidateId?: CandidateId | null;
  readonly onSelect: (candidateId: CandidateId) => void;
}

/** Returned work for one request. The app shows the same items across a project in its Returned tab. */
export function ReturnsInbox({ session, state, returnsPort = null, navigation = null, selectedCandidateId = null, onSelect }: ReturnsInboxProps) {
  const toast = useToast();
  const items = session.inbox;
  const checkForReturns = async () => {
    if (!returnsPort) return;
    const before = session.state.candidates.length;
    await session.refreshReturns(returnsPort);
    const after = session.state;
    const added = after.candidates.length - before;
    if (added > 0) toast.success(`${added} new returned ${added === 1 ? 'item' : 'items'}`, { description: 'Reading returned work sends nothing.' });
    else if (after.readbackNotes.length > 0) toast.warning("Couldn't read all returned work", { description: `${after.readbackNotes.join(' ')} What was stored is unchanged.` });
    else toast.info('No new returned work', { description: 'Reading returned work sends nothing.' });
  };
  return <section className="hqr-panel" aria-labelledby="hqr-inbox-title">
    <header className="hqr-panel-header">
      <h2 id="hqr-inbox-title">Returned work <span className="hqr-muted">{unreviewedCount(items)} awaiting review</span></h2>
      <p className="hqr-hint">Returned work stays here until you decide. Opening it never sends or runs anything.</p>
    </header>
    {items.length === 0 ? <p className="hqr-empty">Nothing has come back yet.</p> : <ul className="hqr-list hqr-returned-list">{items.map((item) => {
      const sequence = state.packets.find((packet) => packet.packetId === item.candidate.packet.packetId)?.lineage.sequence ?? null;
      return <ReturnedRow key={item.candidate.candidateId} item={item} sequence={sequence}
        selected={selectedCandidateId === item.candidate.candidateId}
        onOpen={() => {
          onSelect(item.candidate.candidateId);
          if (navigation) navigate(navigation, { type: 'open-returned', requestId: state.requestId, candidateId: item.candidate.candidateId });
        }} />;
    })}</ul>}
    {returnsPort && <div className="hqr-inline">
      <Button type="button" onClick={() => { void checkForReturns(); }}>Check for returned work</Button>
    </div>}
    {state.packets.length > 0 && <ManualReturn targets={[{ id: state.requestId, session }]} />}
  </section>;
}

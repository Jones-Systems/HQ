import { Button, useListMotion } from '@hq/ui';
import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import type { CompareSlotProps } from '../../../requests/src/contract.ts';
import { inboxOf, type InboxItem } from '../../../requests/src/inbox.ts';
import type { RequestSession, SessionState } from '../../../requests/src/session.ts';
import { SimulationLabelContext } from '../../../requests/ui/context.ts';
import { useSessionStates } from '../../../requests/ui/hooks.ts';
import { ManualReturn } from '../../../requests/ui/ManualReturn.tsx';
import { requestTitle } from '../../../requests/ui/model.ts';
import { ReturnedRow } from '../../../requests/ui/ReturnedRow.tsx';
import { ReviewScreen } from '../../../requests/ui/ReviewScreen.tsx';
import { ReturnChips } from './ReturnChips.tsx';

export interface ReturnedTabProps {
  readonly sessions: readonly RequestSession[];
  readonly compareSlot: ComponentType<CompareSlotProps>;
  /** The status text of a simulated return, so it stays distinct from an agent-reported one. */
  readonly simulationLabel: string | null;
  /** When the tab opens, select the first return still awaiting review for this request. */
  readonly preferRequestId?: string | null;
  /** After a Revise, take the owner to the new linked draft. */
  readonly onOpenDraft: (session: RequestSession) => void;
  readonly onOpenRuns: () => void;
  readonly onBack: () => void;
}

interface Entry {
  readonly session: RequestSession;
  readonly state: SessionState;
  readonly item: InboxItem;
  readonly key: string;
}

/** Returns this view has already shown, so a return that arrives later slides in and the rest do not. */
const shown = new WeakMap<RequestSession, Set<string>>();
const alreadyShown = (session: RequestSession, candidateId: string) => shown.get(session)?.has(candidateId) === true;
function markShown(session: RequestSession, ids: readonly string[]) {
  const known = shown.get(session) ?? new Set<string>();
  for (const id of ids) known.add(id);
  shown.set(session, known);
}

/**
 * Returned work across every request of the project: what awaits review, what was decided, and how each return got
 * here. Opening an item only selects it for review; nothing is sent or run. A decision moves the item from
 * "To review" to "Reviewed".
 */
export function ReturnedTab({ sessions, compareSlot: CompareSlot, simulationLabel, preferRequestId = null, onOpenDraft, onOpenRuns, onBack }: ReturnedTabProps) {
  const states = useSessionStates(sessions);
  const paneRef = useRef<HTMLDivElement>(null);
  const groupId = useId();
  const entries: Entry[] = sessions.flatMap((session, index) => {
    const state = states[index] ?? session.state;
    return inboxOf(state.candidates, state.reviews).map((item) => ({ session, state, item, key: `${state.requestId}:${item.candidate.candidateId}` }));
  }).sort((a, b) => Date.parse(b.item.candidate.observedAt) - Date.parse(a.item.candidate.observedAt));
  const toReview = entries.filter((entry) => entry.item.decision === null);
  const reviewed = entries.filter((entry) => entry.item.decision !== null);

  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    if (preferRequestId === null) return null;
    return entries.find((entry) => entry.state.requestId === preferRequestId && entry.item.decision === null)?.key ?? null;
  });
  const selected = entries.find((entry) => entry.key === selectedKey) ?? null;
  const userSelected = useRef(false);
  const arrived = new Set(entries.filter((entry) => !alreadyShown(entry.session, entry.item.candidate.candidateId)).map((entry) => entry.key));
  useEffect(() => {
    for (const session of sessions) markShown(session, session.state.candidates.map((candidate) => candidate.candidateId));
  });
  useEffect(() => {
    if (!userSelected.current || !selectedKey) return;
    userSelected.current = false;
    paneRef.current?.scrollIntoView({ block: 'nearest' });
    paneRef.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [selectedKey]);

  const listRef = useListMotion<HTMLDivElement>(entries.map((entry) => entry.key), { animateEntering: false });
  const open = (entry: Entry) => { userSelected.current = true; setSelectedKey(entry.key); };
  const targets = sessions.filter((session, index) => (states[index] ?? session.state).packets.length > 0)
    .map((session) => ({ id: session.state.requestId as string, session }));

  const group = (slug: string, title: string, items: readonly Entry[], empty: string) => <section className="hqd-returned-group" aria-labelledby={`${groupId}-${slug}`}>
    <h3 id={`${groupId}-${slug}`}>{title} <span className="hqr-muted">{items.length}</span></h3>
    {items.length === 0 ? <p className="hqd-returned-empty">{empty}</p> : <ul className="hqr-list hqr-returned-list">
      {items.map((entry) => <ReturnedRow key={entry.key} item={entry.item} requestTitle={requestTitle(entry.state)}
        sequence={entry.state.packets.find((packet) => packet.packetId === entry.item.candidate.packet.packetId)?.lineage.sequence ?? null}
        selected={entry.key === selectedKey} arrived={arrived.has(entry.key)}
        openLabel={entry.item.decision === null ? 'Open for review' : 'Open'} onOpen={() => open(entry)} />)}
    </ul>}
  </section>;

  return <SimulationLabelContext.Provider value={simulationLabel}>
    <div className="hqd-returned hq-enter-fade">
      <div className="hqd-returned-main" ref={listRef}>
        <ReturnChips candidates={states.flatMap((state) => state.candidates)} />
        {entries.length === 0
          ? <div className="hqd-empty-state hqd-empty-compact">
            <h4>Nothing has come back yet</h4>
            <p>Frozen requests are sent or simulated from Runs. What returns lands here and waits for your decision.</p>
            <div className="hqr-inline">
              <Button variant="primary" size="sm" onClick={onOpenRuns}>Open Runs</Button>
              <Button variant="ghost" size="sm" onClick={onBack}>Back to requests</Button>
            </div>
            <p className="hqd-safety-note">Navigation sends nothing.</p>
          </div>
          : <>
            {group('to-review', 'To review', toReview, 'Nothing is waiting for review.')}
            {group('reviewed', 'Reviewed', reviewed, 'No decisions recorded yet.')}
          </>}
        <ManualReturn targets={targets} preferredId={selected?.state.requestId ?? preferRequestId} />
      </div>
      <div className="hqd-returned-pane" ref={paneRef}>
        {selected
          ? <ReviewScreen key={selected.key} session={selected.session} state={selected.state} candidate={selected.item.candidate}
            CompareSlot={CompareSlot} onOpenDraft={() => onOpenDraft(selected.session)} />
          : <p className="hqr-empty">Choose a returned item to review it here. Reviewing records your decision; nothing is sent or run.</p>}
      </div>
    </div>
  </SimulationLabelContext.Provider>;
}

import { Button, InlineNotice, useAsyncAction } from '@hq/ui';
import { useState, useSyncExternalStore, type ComponentType } from 'react';
import type {
  CandidateId, CompareSlotProps, DispatchSlot, HandoffStatusPort, NavigationPort, ReturnedCandidate, ReturnsPort,
} from '../src/contract.ts';
import { unreviewedCount } from '../src/inbox.ts';
import type { RequestSession } from '../src/session.ts';
import { SimulationLabelContext } from './context.ts';
import { DraftEditor, type DestinationOffer } from './DraftEditor.tsx';
import { stepProgress } from './model.ts';
import { PacketHistory } from './PacketHistory.tsx';
import { RequestStepper } from './RequestStepper.tsx';
import { ReturnsInbox } from './ReturnsInbox.tsx';
import { ReviewScreen } from './ReviewScreen.tsx';
import { RunsView } from './RunsView.tsx';
import './requests.css';

export interface RequestsViewProps {
  readonly session: RequestSession;
  /** Before/after rendering from the compare section, injected by root. */
  readonly CompareSlot: ComponentType<CompareSlotProps>;
  /** Connector hand-off. Null or absent: sending is visibly unavailable. */
  readonly dispatch?: DispatchSlot | null;
  /** A returned candidate to review. When absent, the candidate chosen in the inbox is reviewed. */
  readonly candidate?: ReturnedCandidate | null;
  /** Read-only status readback. It cannot send. */
  readonly statusPort?: HandoffStatusPort | null;
  /** Read-only returned-work readback. It cannot send. */
  readonly returnsPort?: ReturnsPort | null;
  /** Shell navigation. Intents it receives are navigation only. */
  readonly navigation?: NavigationPort | null;
  /** Supplied by the shell so rendering is deterministic. Defaults to the current time. */
  readonly now?: string;
  readonly newId: (kind: 'clarification' | 'attachment') => string;
  /** List this request's returned work and its manual return form. Default true; the app lists returns in its Returned tab instead. */
  readonly showReturns?: boolean;
  /** Show this request's per-packet status. Default true; the app shows it in Runs instead. */
  readonly showRuns?: boolean;
  /** With `showReturns` off, a compact line that takes the owner to the Returned tab. */
  readonly onOpenReturned?: () => void;
  /** A destination the owner can choose, such as the labelled simulation in the example workspace. */
  readonly destinationOffer?: DestinationOffer | null;
  /** The status text of a simulated return, so simulated returns stay distinct from agent-reported ones. */
  readonly simulationLabel?: string | null;
  readonly sourceLabel?: (versionId: string) => string | null;
  readonly focusTitle?: boolean;
}

/** The request lifecycle surface: draft, clarify, freeze, review. */
export function RequestsView({
  session, CompareSlot, dispatch = null, candidate: supplied = null, statusPort = null, returnsPort = null, navigation = null, now, newId,
  showReturns = true, showRuns = true, onOpenReturned, destinationOffer = null, simulationLabel = null, sourceLabel, focusTitle = false,
}: RequestsViewProps) {
  const state = useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
  const [selected, setSelected] = useState<CandidateId | null>(null);
  const reconcile = useAsyncAction(() => session.reconcile(), { error: "Couldn't read the saved state" });
  const retrySave = useAsyncAction(() => session.flush(), { error: "Couldn't save the draft" });
  const clock = now ?? new Date().toISOString();
  const candidate = supplied ?? state.candidates.find((item) => item.candidateId === selected) ?? null;
  const progress = stepProgress(state, candidate);
  const waiting = unreviewedCount(session.inbox);
  const openRuns = navigation ? () => { navigation.navigate({ type: 'open-runs', requestId: state.requestId }); } : undefined;
  return <SimulationLabelContext.Provider value={simulationLabel}>
    <div className="hqr-root">
      <RequestStepper progress={progress} />
      {state.readOnly && <InlineNotice tone="info" live="off" title="Opened read-only">{state.readOnly} Nothing will be changed.</InlineNotice>}
      {state.unknown && <InlineNotice tone="unknown" title="Outcome unknown"
        actions={[{ label: 'Reconcile', onAction: () => { void reconcile.run(); }, busy: reconcile.pending, busyLabel: 'Reconciling' }]}>
        {state.error ?? 'The last change was not confirmed.'} Edits are held until you reconcile. Nothing is repeated.
      </InlineNotice>}
      {!state.unknown && state.save === 'error' && state.error && <InlineNotice tone="danger" title="Draft not saved" live="off"
        actions={[{ label: 'Retry save', onAction: () => { void retrySave.run(); }, busy: retrySave.pending, busyLabel: 'Saving' }]}>
        {state.error} Your changes are still on screen.
      </InlineNotice>}
      {state.recovered.length > 0 && <InlineNotice tone="info" live="off" title="Recovered after a restart">{state.recovered.join(' ')}</InlineNotice>}
      {candidate && <ReviewScreen session={session} state={state} candidate={candidate} CompareSlot={CompareSlot} />}
      {showReturns && (state.packets.length > 0 || state.candidates.length > 0) && <ReturnsInbox session={session} state={state} returnsPort={returnsPort}
        navigation={navigation} selectedCandidateId={candidate?.candidateId ?? null} onSelect={setSelected} />}
      {!showReturns && onOpenReturned && state.candidates.length > 0 && <div className="hqr-returned-summary">
        <p><strong>Returned work</strong> <span className="hqr-muted">{state.candidates.length} in total · {waiting} awaiting review</span></p>
        <Button type="button" onClick={onOpenReturned}>Review returned work</Button>
      </div>}
      {state.draft
        ? <DraftEditor session={session} state={state} draft={state.draft} newId={newId} destinationOffer={destinationOffer}
          sourceLabel={sourceLabel} onOpenRuns={openRuns} focusTitle={focusTitle} />
        : <p className="hqr-empty">No editable draft.</p>}
      <PacketHistory session={session} state={state} dispatch={dispatch} now={clock} navigation={navigation} />
      {showRuns && state.packets.length > 0 && <RunsView session={session} statusPort={statusPort} navigation={navigation} now={clock}
        simulationLabel={simulationLabel} />}
    </div>
  </SimulationLabelContext.Provider>;
}

/** Labelled placeholder until root wires the compare section's slot. */
export function CompareSlotFake({ baselineVersionId, candidateVersionId, label }: CompareSlotProps) {
  return <figure className="hqr-compare-fake" data-fake="labelled-fake" aria-label={label}>
    <div><span className="hqr-badge hqr-badge-quiet">Before</span> <code>{baselineVersionId}</code></div>
    <div><span className="hqr-badge hqr-badge-quiet">After</span> <code>{candidateVersionId}</code></div>
    <figcaption>Compare slot placeholder (labelled fake) — the compare section renders the real before/after.</figcaption>
  </figure>;
}

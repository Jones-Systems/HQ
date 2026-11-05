import { Button } from '@hq/ui';
import { useState, useSyncExternalStore, type ComponentType } from 'react';
import type {
  CandidateId, CompareSlotProps, DispatchSlot, HandoffStatusPort, NavigationPort, ReturnedCandidate, ReturnsPort,
} from '../src/contract.ts';
import type { RequestSession } from '../src/session.ts';
import { DraftEditor } from './DraftEditor.tsx';
import { STEPS, currentStep } from './model.ts';
import { PacketHistory } from './PacketHistory.tsx';
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
}

/** The request lifecycle surface: draft, clarify, freeze, review. */
export function RequestsView({
  session, CompareSlot, dispatch = null, candidate: supplied = null, statusPort = null, returnsPort = null, navigation = null, now, newId,
}: RequestsViewProps) {
  const state = useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
  const [selected, setSelected] = useState<CandidateId | null>(null);
  const clock = now ?? new Date().toISOString();
  const candidate = supplied ?? state.candidates.find((item) => item.candidateId === selected) ?? null;
  const step = currentStep(state, candidate);
  return <div className="hqr-root">
    <ol className="hqr-steps" aria-label="Request progress">{STEPS.map((item) =>
      <li key={item} aria-current={item === step ? 'step' : undefined}>{item}</li>)}</ol>
    {state.readOnly && <p className="hqr-alert" role="alert">Opened read-only. {state.readOnly} Nothing will be changed.</p>}
    {state.unknown && <div className="hqr-alert" role="alert">
      <p>{state.error}</p>
      <Button type="button" onClick={() => { void session.reconcile(); }}>Reconcile</Button>
    </div>}
    {!state.unknown && state.error && <p className="hqr-alert" role="alert">{state.error}</p>}
    {state.recovered.length > 0 && <p className="hqr-hint" role="status">{state.recovered.join(' ')}</p>}
    {candidate && <ReviewScreen session={session} state={state} candidate={candidate} CompareSlot={CompareSlot} />}
    {(state.packets.length > 0 || state.candidates.length > 0) && <ReturnsInbox session={session} state={state} returnsPort={returnsPort}
      navigation={navigation} selectedCandidateId={candidate?.candidateId ?? null} onSelect={setSelected} />}
    {state.draft
      ? <DraftEditor session={session} state={state} draft={state.draft} newId={newId} />
      : <p className="hqr-empty">No editable draft.</p>}
    <PacketHistory session={session} state={state} dispatch={dispatch} now={clock} navigation={navigation} />
    {state.packets.length > 0 && <RunsView session={session} statusPort={statusPort} navigation={navigation} now={clock} />}
  </div>;
}

/** Labelled placeholder until root wires the compare section's slot. */
export function CompareSlotFake({ baselineVersionId, candidateVersionId, label }: CompareSlotProps) {
  return <figure className="hqr-compare-fake" data-fake="labelled-fake" aria-label={label}>
    <div><span className="hqr-badge hqr-badge-quiet">Before</span> <code>{baselineVersionId}</code></div>
    <div><span className="hqr-badge hqr-badge-quiet">After</span> <code>{candidateVersionId}</code></div>
    <figcaption>Compare slot placeholder (labelled fake) — the compare section renders the real before/after.</figcaption>
  </figure>;
}

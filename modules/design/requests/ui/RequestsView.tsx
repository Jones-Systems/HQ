import { useSyncExternalStore, type ComponentType } from 'react';
import type { CompareSlotProps, DispatchSlot, ReturnedCandidate } from '../src/contract.ts';
import type { RequestSession } from '../src/session.ts';
import { DraftEditor } from './DraftEditor.tsx';
import { STEPS, currentStep } from './model.ts';
import { PacketHistory } from './PacketHistory.tsx';
import { ReviewScreen } from './ReviewScreen.tsx';
import './requests.css';

export interface RequestsViewProps {
  readonly session: RequestSession;
  /** Before/after rendering from the compare section, injected by root. */
  readonly CompareSlot: ComponentType<CompareSlotProps>;
  /** Connector hand-off. Null or absent: sending is visibly unavailable. */
  readonly dispatch?: DispatchSlot | null;
  /** A returned candidate supplied by the connector/results section. */
  readonly candidate?: ReturnedCandidate | null;
  readonly newId: (kind: 'clarification' | 'attachment') => string;
}

/** The request lifecycle surface: draft, clarify, freeze, review. */
export function RequestsView({ session, CompareSlot, dispatch = null, candidate = null, newId }: RequestsViewProps) {
  const state = useSyncExternalStore((listener) => session.subscribe(listener), () => session.state, () => session.state);
  const step = currentStep(state, candidate);
  return <div className="hqr-root">
    <ol className="hqr-steps" aria-label="Request progress">{STEPS.map((item) =>
      <li key={item} aria-current={item === step ? 'step' : undefined}>{item}</li>)}</ol>
    {state.readOnly && <p className="hqr-alert" role="alert">Opened read-only. {state.readOnly} Nothing will be changed.</p>}
    {state.unknown && <div className="hqr-alert" role="alert">
      <p>{state.error}</p>
      <button type="button" onClick={() => { void session.reconcile(); }}>Reconcile</button>
    </div>}
    {!state.unknown && state.error && <p className="hqr-alert" role="alert">{state.error}</p>}
    {state.recovered.length > 0 && <p className="hqr-hint" role="status">{state.recovered.join(' ')}</p>}
    {candidate && <ReviewScreen session={session} state={state} candidate={candidate} CompareSlot={CompareSlot} />}
    {state.draft
      ? <DraftEditor session={session} state={state} draft={state.draft} newId={newId} />
      : <p className="hqr-empty">No editable draft.</p>}
    <PacketHistory packets={state.packets} dispatch={dispatch} />
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

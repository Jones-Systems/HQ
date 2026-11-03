import { InlineNotice, useToast } from '@hq/ui';
import { useState, type ComponentType } from 'react';
import { CLAIM_LEVELS, type ClaimJudgment, type CompareSlotProps, type ReturnedCandidate, type ReviewDecision } from '../src/contract.ts';
import { CLAIM_LEVEL_LABELS, reviewCandidate } from '../src/review.ts';
import type { RequestSession, SessionState } from '../src/session.ts';
import { useSimulationLabel } from './context.ts';
import { GuardedButton } from './GuardedButton.tsx';
import { DECISION_LABELS, PROVENANCE_LABELS, holdReason, requestTitle, returnProvenance, utc } from './model.ts';

export interface ReviewScreenProps {
  readonly session: RequestSession;
  readonly state: SessionState;
  readonly candidate: ReturnedCandidate;
  readonly CompareSlot: ComponentType<CompareSlotProps>;
  /** Offered after a Revise so the owner can go straight to the new linked draft. */
  readonly onOpenDraft?: () => void;
}

const DECISIONS: readonly { readonly decision: ReviewDecision; readonly label: string }[] = [
  { decision: 'accept', label: 'Accept' },
  { decision: 'revise', label: 'Revise' },
  { decision: 'defer', label: 'Defer' },
  { decision: 'reject', label: 'Reject' },
];

const OUTCOMES: Readonly<Record<ReviewDecision, string>> = {
  accept: 'Recorded in this request’s history. Nothing was sent or run.',
  revise: 'A linked revision draft was started and all evidence was kept. Nothing was sent or run.',
  defer: 'Recorded in this request’s history. You can decide later.',
  reject: 'Recorded that you declined the result. No draft and no work was started.',
};

export function ReviewScreen({ session, state, candidate, CompareSlot, onOpenDraft }: ReviewScreenProps) {
  const toast = useToast();
  const simulationLabel = useSimulationLabel();
  const [note, setNote] = useState('');
  const [judgments, setJudgments] = useState<Record<string, ClaimJudgment['judgment']>>({});
  const packet = state.packets.find((item) => item.packetId === candidate.packet.packetId);
  const review = reviewCandidate(candidate, state.reviews);
  const hold = holdReason(state);
  const disabled = hold !== null;
  const provenance = returnProvenance(candidate, simulationLabel);

  if (!packet || packet.authoringDigest !== candidate.packet.authoringDigest) {
    return <section className="hqr-panel" aria-labelledby="hqr-review-title"><h2 id="hqr-review-title">Returned candidate</h2>
      <InlineNotice tone="danger" title="This return can't be reviewed here">
        This candidate does not match a frozen packet of this request. It cannot be reviewed here.
      </InlineNotice></section>;
  }

  const decide = async (decision: ReviewDecision) => {
    if (hold) return;
    const list = Object.entries(judgments).map(([claimId, judgment]) => ({ claimId, judgment }) as ClaimJudgment);
    const event = await session.review(candidate, decision, note, list);
    if (event) {
      setNote(''); setJudgments({});
      toast.success(`${DECISION_LABELS[decision]} packet #${packet.lineage.sequence}`, {
        description: OUTCOMES[decision],
        ...(decision === 'revise' && onOpenDraft ? { action: { label: 'Open draft', onAction: onOpenDraft } } : {}),
      });
      return;
    }
    const after = session.state;
    if (after.unknown) {
      toast.unknown('Decision result unknown', {
        description: `${after.error ?? 'The result was not confirmed.'} Reconcile to read what was saved.`,
        action: { label: 'Reconcile', onAction: () => { void session.reconcile(); } },
      });
    } else if (after.error) {
      toast.error("Couldn't record the decision", { description: `${after.error} Your note and judgments are kept.` });
    }
  };

  return <section className="hqr-panel" aria-labelledby="hqr-review-title">
    <header className="hqr-panel-header">
      <h2 id="hqr-review-title" tabIndex={-1}>Review returned candidate</h2>
      <p className="hqr-muted">{requestTitle(state)} · For packet #{packet.lineage.sequence} · reported status <strong>{candidate.observedStatus}</strong> as of {utc(candidate.observedAt)}
        {review.decision && <> · latest decision <strong>{review.decision}</strong></>}</p>
    </header>

    {candidate.provenance?.origin === 'owner-reported' && <InlineNotice tone="warning" title="Owner-reported" live="off">
      Reported by you, outside HQ. It is not verified, and none of it counts as observed.</InlineNotice>}
    {provenance === 'simulated' && <InlineNotice tone="info" title="Simulation" live="off">
      This return was produced by the simulated receiver. Nothing was sent or run, and it is not native verification.</InlineNotice>}
    <dl className="hqr-facts" aria-label="Provenance">
      <dt>Source</dt><dd>{candidate.provenance?.origin === 'owner-reported' ? 'Owner-reported' : 'Connector'}{provenance === 'simulated' && ` · ${PROVENANCE_LABELS.simulated}`}</dd>
      <dt>Host</dt><dd>{candidate.provenance?.host ?? 'not reported'}</dd>
      <dt>Model</dt><dd>{candidate.provenance?.model ?? 'not reported'}</dd>
    </dl>

    {candidate.candidateVersionId === null
      ? <div className="hqr-compare" data-versionless="true">
        <p>No comparable version was returned, so there is no before/after. The artifacts below are shown as returned.</p>
        {candidate.evidence.length === 0 ? <p className="hqr-empty">No artifacts were returned.</p>
          : <ul className="hqr-list" aria-label="Returned artifacts">{candidate.evidence.map((item) => <li key={item.evidenceId}>
            <span className="hqr-badge hqr-badge-quiet">{item.kind}</span> {item.label}
          </li>)}</ul>}
      </div>
      : <div className="hqr-compare">
        <CompareSlot baselineVersionId={candidate.baselineVersionId} candidateVersionId={candidate.candidateVersionId}
          label={`Before (${candidate.baselineVersionId}) and after (${candidate.candidateVersionId})`} />
      </div>}

    {CLAIM_LEVELS.map((level) => <div key={level} className="hqr-claims" data-level={level}>
      <h3>{CLAIM_LEVEL_LABELS[level].title} <span className="hqr-muted">{review.claims[level].length}</span></h3>
      <p className="hqr-hint">{CLAIM_LEVEL_LABELS[level].meaning}</p>
      {review.claims[level].length === 0 ? <p className="hqr-empty">None.</p> : <ul className="hqr-list">{review.claims[level].map((claim) => <li key={claim.claimId}>
        <p>{claim.text}</p>
        {claim.judgment && <p className="hqr-muted">You {claim.judgment} this · originally {CLAIM_LEVEL_LABELS[claim.reportedLevel].title.toLowerCase()}</p>}
        <div className="hqr-inline" role="group" aria-label={`Judge claim: ${claim.text}`}>
          {(['confirmed', 'disputed'] as const).map((judgment) => <label key={judgment} className="hqr-check">
            <input type="checkbox" disabled={disabled} checked={judgments[claim.claimId] === judgment}
              onChange={(event) => setJudgments((previous) => {
                const next = { ...previous };
                if (event.target.checked) next[claim.claimId] = judgment; else delete next[claim.claimId];
                return next;
              })} />
            {judgment === 'confirmed' ? 'Confirm' : 'Dispute'}
          </label>)}
        </div>
      </li>)}</ul>}
    </div>)}

    <label className="hqr-field">Decision note
      <textarea rows={3} value={note} disabled={disabled} onChange={(event) => setNote(event.target.value)} />
    </label>
    <div className="hqr-inline">
      {DECISIONS.map((item) => <GuardedButton key={item.decision} unavailable={hold} variant={item.decision === 'accept' ? 'primary' : 'secondary'}
        onClick={() => { void decide(item.decision); }}>{item.label}</GuardedButton>)}
    </div>
    <p className="hqr-hint">Decisions are appended to this request's history. Revise starts a new linked draft and keeps all evidence. Reject records that you declined the result; it starts no draft and no work.</p>

    {review.history.length > 0 && <>
      <h3>Decision history</h3>
      <ol className="hqr-list">{review.history.map((event) => <li key={event.eventId}>
        <strong>{event.decision}</strong> <span className="hqr-muted">{utc(event.at)}</span>{event.note && <> — {event.note}</>}
      </li>)}</ol>
    </>}
  </section>;
}

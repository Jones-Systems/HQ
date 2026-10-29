import { Button } from '@hq/ui';
import { useState, type ComponentType } from 'react';
import { CLAIM_LEVELS, type ClaimJudgment, type CompareSlotProps, type ReturnedCandidate, type ReviewDecision } from '../src/contract.ts';
import { CLAIM_LEVEL_LABELS, reviewCandidate } from '../src/review.ts';
import type { RequestSession, SessionState } from '../src/session.ts';

export interface ReviewScreenProps {
  readonly session: RequestSession;
  readonly state: SessionState;
  readonly candidate: ReturnedCandidate;
  readonly CompareSlot: ComponentType<CompareSlotProps>;
}

const DECISIONS: readonly { readonly decision: ReviewDecision; readonly label: string }[] = [
  { decision: 'accept', label: 'Accept' },
  { decision: 'revise', label: 'Revise' },
  { decision: 'defer', label: 'Defer' },
  { decision: 'reject', label: 'Reject' },
];

export function ReviewScreen({ session, state, candidate, CompareSlot }: ReviewScreenProps) {
  const [note, setNote] = useState('');
  const [judgments, setJudgments] = useState<Record<string, ClaimJudgment['judgment']>>({});
  const packet = state.packets.find((item) => item.packetId === candidate.packet.packetId);
  const review = reviewCandidate(candidate, state.reviews);
  const disabled = state.busy !== null || state.readOnly !== null || state.unknown;

  if (!packet || packet.authoringDigest !== candidate.packet.authoringDigest) {
    return <section className="hqr-panel" role="alert"><h2>Returned candidate</h2>
      <p>This candidate does not match a frozen packet of this request. It cannot be reviewed here.</p></section>;
  }

  const decide = async (decision: ReviewDecision) => {
    const list = Object.entries(judgments).map(([claimId, judgment]) => ({ claimId, judgment }) as ClaimJudgment);
    if (await session.review(candidate, decision, note, list)) { setNote(''); setJudgments({}); }
  };

  return <section className="hqr-panel" aria-labelledby="hqr-review-title">
    <header className="hqr-panel-header">
      <h2 id="hqr-review-title">Review returned candidate</h2>
      <p className="hqr-muted">For packet #{packet.lineage.sequence} · reported status <strong>{candidate.observedStatus}</strong> as of {candidate.observedAt.slice(0, 16).replace('T', ' ')} UTC
        {review.decision && <> · latest decision <strong>{review.decision}</strong></>}</p>
    </header>

    {candidate.provenance?.origin === 'owner-reported' && <p className="hqr-alert" role="note">
      Reported by you, outside HQ. It is not verified, and none of it counts as observed.</p>}
    <dl className="hqr-facts" aria-label="Provenance">
      <dt>Source</dt><dd>{candidate.provenance?.origin === 'owner-reported' ? 'Owner-reported' : 'Connector'}</dd>
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
      {DECISIONS.map((item) => <Button key={item.decision} type="button" disabled={disabled} variant={item.decision === 'accept' ? 'primary' : 'secondary'}
        onClick={() => { void decide(item.decision); }}>{item.label}</Button>)}
    </div>
    <p className="hqr-hint">Decisions are appended to this request's history. Revise starts a new linked draft and keeps all evidence. Reject records that you declined the result; it starts no draft and no work.</p>

    {review.history.length > 0 && <>
      <h3>Decision history</h3>
      <ol className="hqr-list">{review.history.map((event) => <li key={event.eventId}>
        <strong>{event.decision}</strong> <span className="hqr-muted">{event.at.slice(0, 16).replace('T', ' ')} UTC</span>{event.note && <> — {event.note}</>}
      </li>)}</ol>
    </>}
  </section>;
}

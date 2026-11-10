import type {
  CandidateClaim, ClaimLevel, ReturnedCandidate, ReviewDecision, ReviewEvent,
} from './contract.ts';

export interface ReviewedClaim extends CandidateClaim {
  /** The level as reported by the producer, kept even after an owner judgment. */
  readonly reportedLevel: ClaimLevel;
  readonly judgment: 'confirmed' | 'disputed' | null;
}

export interface CandidateReview {
  readonly candidate: ReturnedCandidate;
  /** Latest appended decision; earlier ones stay in `history`. */
  readonly decision: ReviewDecision | null;
  readonly history: readonly ReviewEvent[];
  readonly claims: Readonly<Record<ClaimLevel, readonly ReviewedClaim[]>>;
}

/**
 * Folds the append-only review stream for one candidate. An owner judgment
 * makes a claim `owner-judged`; the latest judgment for a claim wins and the
 * reported level is preserved alongside it.
 */
export function reviewCandidate(candidate: ReturnedCandidate, events: readonly ReviewEvent[]): CandidateReview {
  const history = events.filter((event) => event.candidateId === candidate.candidateId
    && event.packet.packetId === candidate.packet.packetId && event.packet.authoringDigest === candidate.packet.authoringDigest);
  const judgments = new Map<string, 'confirmed' | 'disputed'>();
  for (const event of history) for (const item of event.judgments) judgments.set(item.claimId, item.judgment);
  const grouped: Record<ClaimLevel, ReviewedClaim[]> = { 'agent-reported': [], observed: [], 'owner-judged': [] };
  for (const claim of candidate.claims) {
    const judgment = judgments.get(claim.claimId) ?? null;
    const level: ClaimLevel = judgment ? 'owner-judged' : claim.level;
    grouped[level].push({ ...claim, level, reportedLevel: claim.level, judgment });
  }
  return { candidate, decision: history.at(-1)?.decision ?? null, history, claims: grouped };
}

export const CLAIM_LEVEL_LABELS: Readonly<Record<ClaimLevel, { readonly title: string; readonly meaning: string }>> = {
  'agent-reported': { title: 'Agent-reported', meaning: 'Stated by the producer. Not verified by HQ.' },
  observed: { title: 'Observed', meaning: 'Backed by captured evidence.' },
  'owner-judged': { title: 'Owner-judged', meaning: 'Confirmed or disputed by you.' },
};

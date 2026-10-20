import type { ReturnedCandidate, ReviewDecision, ReviewEvent, ReturnOrigin } from './contract.ts';

export interface InboxItem {
  readonly candidate: ReturnedCandidate;
  /** Latest appended decision for this candidate, or null while it is waiting for review. */
  readonly decision: ReviewDecision | null;
  readonly origin: ReturnOrigin;
  /** True when the producer returned artifacts without a comparable version. */
  readonly versionless: boolean;
}

/**
 * The returned-work inbox: every stored candidate, newest first, with its
 * latest review decision. Pure; reading it never contacts anything.
 */
export function inboxOf(candidates: readonly ReturnedCandidate[], reviews: readonly ReviewEvent[]): InboxItem[] {
  return candidates.map((candidate) => {
    const events = reviews.filter((event) => event.candidateId === candidate.candidateId && event.packet.packetId === candidate.packet.packetId);
    return {
      candidate, decision: events.at(-1)?.decision ?? null,
      origin: candidate.provenance?.origin ?? 'connector', versionless: candidate.candidateVersionId === null,
    };
  }).sort((a, b) => (a.candidate.observedAt === b.candidate.observedAt
    ? (a.candidate.candidateId < b.candidate.candidateId ? -1 : 1)
    : (a.candidate.observedAt < b.candidate.observedAt ? 1 : -1)));
}

export function unreviewedCount(items: readonly InboxItem[]): number {
  return items.filter((item) => item.decision === null).length;
}

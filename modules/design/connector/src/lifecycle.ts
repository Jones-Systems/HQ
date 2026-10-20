/**
 * `dispatchLifecycle(record, evidence)`: a pure projection of one dispatch and
 * its returned evidence into the stage the request lifecycle shows.
 *
 * It reads; it never sends, never writes and never consults a clock. Stages:
 *
 *   not-sent   no attempt, or the latest attempt is a no-effect result
 *   submitting the attempt is recorded and the send has not returned
 *   unknown    the effect cannot be told; fenced, never resent
 *   held       the receiver holds the handoff
 *   queued     accepted by the receiver; no execution report yet
 *   running / returned / failed / cancelled   from matching result evidence
 *
 * Only evidence that answers the latest attempt's exact receipt, packet digest,
 * host, receiver, pinned model and provenance counts; anything else is listed
 * as ignored, never promoted. A held attempt stays held whatever evidence says.
 * Receiver reports are claims; "returned" is not approval or native verification.
 */

import type { Digest } from './canonical.ts';
import type { Attempt, AttemptState, DispatchRecord, StateBasis } from './dispatch.ts';
import type { EvidenceEntry, ExecutionStatus, ReceiverClaimLevel } from './evidence.ts';
import type { Destination } from './host-catalog.ts';
import type { CandidateId, DispatchId, EvidenceId } from './ids.ts';
import type { ManualHandoffRecord, PinnedRoute, RouteSource } from './route-fence.ts';
import { hasEffect, isUnresolved, latestAttempt } from './dispatch.ts';
import { collectRouteSources, pinnedRouteOf, selectedRouteOf } from './route-fence.ts';

export const LIFECYCLE_STAGES = ['not-sent', 'submitting', 'unknown', 'held', 'queued', 'running', 'returned', 'failed', 'cancelled'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Why a not-sent dispatch is not sent. `none` means no attempt exists. */
export type NotSentResolution = 'none' | 'rejected' | 'blocked' | 'no-effect';

export type SendFenceStatus = 'open' | 'needs-fresh-confirmation' | 'fenced';

export interface SendFenceView {
  readonly status: SendFenceStatus;
  readonly code: 'unresolved-attempt' | 'already-handed-off' | null;
  /** A new attempt needs a confirmation made after this instant. */
  readonly confirmationAfter: string | null;
}

export type IgnoredEvidenceReason =
  | 'other-dispatch'
  | 'packet-mismatch'
  | 'other-attempt'
  | 'attempt-without-effect'
  | 'receipt-mismatch'
  | 'host-mismatch'
  | 'model-mismatch'
  | 'provenance-mismatch';

export interface IgnoredEvidence {
  readonly evidenceId: EvidenceId;
  readonly reason: IgnoredEvidenceReason;
}

export type LifecycleAnomaly =
  | 'evidence-while-held'
  | 'conflicting-terminal-evidence'
  | 'route-variance'
  | 'route-drift';

export interface EvidenceSummary {
  readonly evidenceId: EvidenceId;
  readonly execution: ExecutionStatus;
  readonly claimLevel: ReceiverClaimLevel;
  readonly observedAt: string;
  readonly candidateId: CandidateId;
  readonly summary: string;
  readonly artifactCount: number;
  readonly digest: Digest;
  /** True for evidence from a labelled fake receiver. */
  readonly fake: boolean;
}

export interface DispatchLifecycle {
  readonly dispatchId: DispatchId | null;
  readonly stage: LifecycleStage;
  readonly resolution: NotSentResolution;
  readonly attemptOrdinal: number | null;
  readonly basis: StateBasis | null;
  readonly updatedAt: string | null;
  readonly fake: boolean;
  readonly route: PinnedRoute | null;
  readonly send: SendFenceView;
  /** Manual or other-route history that needs an explicit acknowledgement before a send here. */
  readonly routeHistory: { readonly acknowledgementRequired: boolean; readonly sources: readonly RouteSource[] };
  readonly evidence: {
    readonly counted: number;
    readonly latest: EvidenceSummary | null;
    readonly ignored: readonly IgnoredEvidence[];
  };
  readonly anomalies: readonly LifecycleAnomaly[];
}

export interface LifecycleOptions {
  /**
   * The destination now in the catalog: shows freshness and drift from the
   * pin. `undefined`: no catalog consulted; `null`: no longer listed.
   */
  readonly catalogDestination?: Destination | null;
  /** Owner-recorded manual handoffs for this packet (requests owns the history). */
  readonly manualHandoffs?: readonly ManualHandoffRecord[];
}

const TERMINAL: ReadonlySet<ExecutionStatus> = new Set(['completed', 'failed', 'cancelled']);

const STAGE_OF_STATE: Readonly<Record<AttemptState, LifecycleStage>> = {
  submitting: 'submitting',
  unknown: 'unknown',
  held: 'held',
  accepted: 'queued',
  rejected: 'not-sent',
  blocked: 'not-sent',
  'no-effect': 'not-sent',
};

const STAGE_OF_EXECUTION: Readonly<Record<ExecutionStatus, LifecycleStage>> = {
  running: 'running',
  completed: 'returned',
  failed: 'failed',
  cancelled: 'cancelled',
  unknown: 'queued',
};

function sendFence(attempt: Attempt | null): SendFenceView {
  if (!attempt) return { status: 'open', code: null, confirmationAfter: null };
  if (isUnresolved(attempt.state)) return { status: 'fenced', code: 'unresolved-attempt', confirmationAfter: null };
  if (hasEffect(attempt.state)) return { status: 'fenced', code: 'already-handed-off', confirmationAfter: null };
  return { status: 'needs-fresh-confirmation', code: null, confirmationAfter: attempt.resolvedAt };
}

/** Why an entry does not answer the latest accepted attempt of this dispatch; null when it does. */
function mismatch(record: DispatchRecord, attempt: Attempt | null, entry: EvidenceEntry): IgnoredEvidenceReason | null {
  const evidence = entry.evidence;
  const receipt = attempt?.receipt ?? null;
  if (evidence.dispatchId !== record.dispatchId) return 'other-dispatch';
  if (evidence.packet.packetId !== record.packet.packetId || evidence.packet.packetDigest !== record.packet.packetDigest) return 'packet-mismatch';
  if (!attempt || evidence.attemptId !== attempt.attemptId) return 'other-attempt';
  if (!hasEffect(attempt.state) || !receipt) return 'attempt-without-effect';
  if (evidence.receiptId !== receipt.receiptId) return 'receipt-mismatch';
  const binding = record.destination;
  if (evidence.execution.hostId !== binding.hostId || evidence.execution.receiverId !== binding.receiverId) return 'host-mismatch';
  if (binding.model && (evidence.execution.model?.provider !== binding.model.provider
    || evidence.execution.model?.model !== binding.model.model)) return 'model-mismatch';
  if (evidence.provenance !== receipt.provenance) return 'provenance-mismatch';
  return null;
}

/** Order by when the receiver observed it, then when HQ received it, then ID, so the order never depends on array order. */
function byProgress(a: EvidenceEntry, b: EvidenceEntry): number {
  return Date.parse(a.evidence.execution.observedAt) - Date.parse(b.evidence.execution.observedAt)
    || Date.parse(a.receivedAt) - Date.parse(b.receivedAt)
    || a.evidence.evidenceId.localeCompare(b.evidence.evidenceId);
}

function summarize(entry: EvidenceEntry): EvidenceSummary {
  const { evidence } = entry;
  return {
    evidenceId: evidence.evidenceId,
    execution: evidence.execution.status,
    claimLevel: evidence.claimLevel,
    observedAt: evidence.execution.observedAt,
    candidateId: evidence.candidate.candidateId,
    summary: evidence.candidate.summary,
    artifactCount: evidence.candidate.artifacts.length,
    digest: entry.digest,
    fake: entry.fake || evidence.provenance === 'fake',
  };
}

export function dispatchLifecycle(
  record: DispatchRecord | null,
  evidence: readonly EvidenceEntry[],
  options: LifecycleOptions = {},
): DispatchLifecycle {
  const manual = options.manualHandoffs ?? [];
  if (!record) {
    return {
      dispatchId: null, stage: 'not-sent', resolution: 'none', attemptOrdinal: null, basis: null, updatedAt: null, fake: false,
      route: options.catalogDestination ? selectedRouteOf(options.catalogDestination) : null,
      send: sendFence(null),
      // No record means no packet ID here; the caller scopes `manualHandoffs` to the packet, so all of it counts.
      routeHistory: {
        acknowledgementRequired: manual.length > 0,
        sources: manual.map((item): RouteSource => ({ kind: 'manual', recordId: item.recordId, recordedAt: item.recordedAt })),
      },
      evidence: { counted: 0, latest: null, ignored: [] },
      anomalies: [],
    };
  }

  const attempt = latestAttempt(record);
  const counted: EvidenceEntry[] = [];
  const ignored: IgnoredEvidence[] = [];
  for (const entry of evidence) {
    const reason = mismatch(record, attempt, entry);
    if (reason) ignored.push({ evidenceId: entry.evidence.evidenceId, reason });
    else counted.push(entry);
  }
  counted.sort(byProgress);
  const terminal = counted.filter((entry) => TERMINAL.has(entry.evidence.execution.status));
  // A terminal report cannot be walked back by a later "running"; among terminals the latest wins.
  const deciding = terminal.at(-1) ?? counted.at(-1) ?? null;

  const anomalies: LifecycleAnomaly[] = [];
  let stage: LifecycleStage = attempt ? STAGE_OF_STATE[attempt.state] : 'not-sent';
  if (attempt?.state === 'accepted' && deciding) stage = STAGE_OF_EXECUTION[deciding.evidence.execution.status];
  if (attempt?.state === 'held' && counted.length > 0) anomalies.push('evidence-while-held');
  if (new Set(terminal.map((entry) => entry.evidence.execution.status)).size > 1) anomalies.push('conflicting-terminal-evidence');

  const route = pinnedRouteOf(record, options.catalogDestination);
  if (route.variances.length > 0) anomalies.push('route-variance');
  if (route.drift.length > 0) anomalies.push('route-drift');

  const sources = collectRouteSources({
    packetId: record.packet.packetId, destinationId: record.destination.destinationId,
    dispatches: [], manualHandoffs: manual,
  });
  return {
    dispatchId: record.dispatchId,
    stage,
    resolution: attempt && (attempt.state === 'rejected' || attempt.state === 'blocked' || attempt.state === 'no-effect') ? attempt.state : 'none',
    attemptOrdinal: attempt?.ordinal ?? null,
    basis: attempt?.basis ?? null,
    updatedAt: attempt?.updatedAt ?? record.updatedAt,
    fake: record.destination.transport === 'fake-receiver' || attempt?.receipt?.provenance === 'fake',
    route,
    send: sendFence(attempt),
    routeHistory: { acknowledgementRequired: sources.length > 0, sources },
    evidence: { counted: counted.length, latest: deciding ? summarize(deciding) : null, ignored },
    anomalies,
  };
}

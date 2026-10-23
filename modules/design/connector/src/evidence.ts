/**
 * `hq.design.result-evidence/v1`: returned work linked to the exact dispatch,
 * attempt, receipt and frozen packet it answers.
 *
 * Intake is strict and append-only. Evidence is rejected unless it matches the
 * packet digest, the accepted attempt's receipt, the bound host/receiver/model
 * and the transport's provenance. Receivers may report or observe; only the
 * owner judges, so `owner-judged` claims are refused here. Fake evidence stays
 * labelled fake.
 */

import type { Digest } from './canonical.ts';
import type { EvidenceStorePort, OutboxStorePort } from './contract.ts';
import type { Provenance } from './dispatch.ts';
import type { ModelPin } from './host-catalog.ts';
import type { AttemptId, CandidateId, DispatchId, EvidenceId, HostId, PacketId, ReceiptId, ReceiverId, VersionId } from './ids.ts';
import { digestOf, isDigest } from './canonical.ts';
import { hasEffect } from './dispatch.ts';
import { isIdText } from './ids.ts';
import { hasExactKeys, isCount, isRecord, isText, isTimestamp, oneOf, schemaVariance } from './validate.ts';

export const RESULT_EVIDENCE_SCHEMA = 'hq.design.result-evidence/v1';

export const RECEIVER_CLAIM_LEVELS = ['agent-reported', 'observed'] as const;
export type ReceiverClaimLevel = (typeof RECEIVER_CLAIM_LEVELS)[number];

export const EXECUTION_STATUSES = ['running', 'completed', 'failed', 'cancelled', 'unknown'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export interface EvidenceArtifact {
  readonly digest: Digest;
  readonly mediaType: string;
  readonly bytes: number;
  readonly label: string;
}

export interface ResultEvidence {
  readonly schema: typeof RESULT_EVIDENCE_SCHEMA;
  readonly evidenceId: EvidenceId;
  readonly dispatchId: DispatchId;
  readonly attemptId: AttemptId;
  readonly receiptId: ReceiptId;
  readonly packet: { readonly packetId: PacketId; readonly packetDigest: Digest };
  readonly candidate: {
    readonly candidateId: CandidateId;
    readonly summary: string;
    /** The source version the candidate was produced against, when reported. */
    readonly sourceVersionId?: VersionId;
    readonly artifacts: readonly EvidenceArtifact[];
  };
  readonly claimLevel: ReceiverClaimLevel;
  readonly execution: {
    readonly status: ExecutionStatus;
    readonly observedAt: string;
    readonly hostId: HostId;
    readonly receiverId: ReceiverId;
    readonly model: ModelPin | null;
  };
  readonly provenance: Provenance;
}

export interface EvidenceEntry {
  readonly evidence: ResultEvidence;
  readonly digest: Digest;
  readonly receivedAt: string;
  /** True when produced through a labelled fake receiver. Never displayed as real. */
  readonly fake: boolean;
}

export type EvidenceRejection =
  | 'malformed'
  | 'unsupported-schema'
  | 'claim-level-forbidden'
  | 'unknown-dispatch'
  | 'packet-digest-mismatch'
  | 'unknown-attempt'
  | 'attempt-not-accepted'
  | 'receipt-mismatch'
  | 'host-mismatch'
  | 'model-mismatch'
  | 'provenance-mismatch'
  | 'evidence-conflict';

export type IntakeResult =
  | { readonly ok: true; readonly entry: EvidenceEntry; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: EvidenceRejection; readonly detail: string };

function parseArtifact(value: unknown): EvidenceArtifact | null {
  if (!isRecord(value) || !hasExactKeys(value, ['digest', 'mediaType', 'bytes', 'label'])) return null;
  if (!isDigest(value.digest) || !isText(value.mediaType, 120) || !isCount(value.bytes) || !isText(value.label, 200)) return null;
  return { digest: value.digest, mediaType: value.mediaType, bytes: value.bytes, label: value.label };
}

function parseModel(value: unknown): ModelPin | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ['provider', 'model']) || !isText(value.provider, 120) || !isText(value.model, 120)) return undefined;
  return { provider: value.provider, model: value.model };
}

export type EvidenceParse =
  | { readonly ok: true; readonly evidence: ResultEvidence }
  | { readonly ok: false; readonly code: 'malformed' | 'unsupported-schema' | 'claim-level-forbidden'; readonly detail: string };

export function parseResultEvidence(value: unknown): EvidenceParse {
  const bad = (detail: string): EvidenceParse => ({ ok: false, code: 'malformed', detail });
  if (!isRecord(value)) return bad('not an object');
  const variance = schemaVariance(value.schema, RESULT_EVIDENCE_SCHEMA);
  if (variance === 'other-version') return { ok: false, code: 'unsupported-schema', detail: String(value.schema) };
  if (variance === 'invalid') return bad('schema');
  if (!hasExactKeys(value, ['schema', 'evidenceId', 'dispatchId', 'attemptId', 'receiptId', 'packet', 'candidate', 'claimLevel', 'execution', 'provenance'])) {
    return bad('unexpected or missing fields');
  }
  if (!isIdText(value.evidenceId) || !isIdText(value.dispatchId) || !isIdText(value.attemptId) || !isIdText(value.receiptId)) return bad('ids');
  const packet = value.packet;
  if (!isRecord(packet) || !hasExactKeys(packet, ['packetId', 'packetDigest']) || !isIdText(packet.packetId) || !isDigest(packet.packetDigest)) {
    return bad('packet');
  }
  const candidate = value.candidate;
  if (!isRecord(candidate) || !hasExactKeys(candidate, ['candidateId', 'summary', 'artifacts'], ['sourceVersionId'])
    || !isIdText(candidate.candidateId) || !isText(candidate.summary, 2000) || !Array.isArray(candidate.artifacts)
    || ('sourceVersionId' in candidate && !isIdText(candidate.sourceVersionId))) {
    return bad('candidate');
  }
  const artifacts = candidate.artifacts.map(parseArtifact);
  if (artifacts.some((artifact) => artifact === null)) return bad('candidate.artifacts');
  if (value.claimLevel === 'owner-judged') {
    return { ok: false, code: 'claim-level-forbidden', detail: 'only the owner can record an owner-judged claim' };
  }
  if (!oneOf(RECEIVER_CLAIM_LEVELS, value.claimLevel)) return bad('claimLevel');
  const execution = value.execution;
  if (!isRecord(execution) || !hasExactKeys(execution, ['status', 'observedAt', 'hostId', 'receiverId', 'model'])
    || !oneOf(EXECUTION_STATUSES, execution.status) || !isTimestamp(execution.observedAt)
    || !isIdText(execution.hostId) || !isIdText(execution.receiverId)) {
    return bad('execution');
  }
  const model = parseModel(execution.model);
  if (model === undefined) return bad('execution.model');
  if (value.provenance !== 'fake' && value.provenance !== 'jones') return bad('provenance');
  return {
    ok: true,
    evidence: {
      schema: RESULT_EVIDENCE_SCHEMA,
      evidenceId: value.evidenceId as EvidenceId,
      dispatchId: value.dispatchId as DispatchId,
      attemptId: value.attemptId as AttemptId,
      receiptId: value.receiptId as ReceiptId,
      packet: { packetId: packet.packetId as PacketId, packetDigest: packet.packetDigest },
      candidate: {
        candidateId: candidate.candidateId as CandidateId,
        summary: candidate.summary,
        ...(typeof candidate.sourceVersionId === 'string' ? { sourceVersionId: candidate.sourceVersionId as VersionId } : {}),
        artifacts: artifacts as EvidenceArtifact[],
      },
      claimLevel: value.claimLevel,
      execution: {
        status: execution.status, observedAt: execution.observedAt,
        hostId: execution.hostId as HostId, receiverId: execution.receiverId as ReceiverId, model,
      },
      provenance: value.provenance,
    },
  };
}

export interface EvidenceIntakeOptions {
  readonly outbox: Pick<OutboxStorePort, 'get'>;
  readonly evidence: EvidenceStorePort;
  readonly clock: { now(): number };
}

/** Validate and append one returned-evidence document. Never mutates the dispatch record. */
export async function intakeEvidence(options: EvidenceIntakeOptions, value: unknown): Promise<IntakeResult> {
  const parsed = parseResultEvidence(value);
  if (!parsed.ok) return parsed;
  const evidence = parsed.evidence;
  const reject = (code: EvidenceRejection, detail: string): IntakeResult => ({ ok: false, code, detail });

  const stored = await options.outbox.get(evidence.dispatchId);
  if (!stored) return reject('unknown-dispatch', 'no dispatch with this ID');
  const record = stored.record;
  if (evidence.packet.packetId !== record.packet.packetId || evidence.packet.packetDigest !== record.packet.packetDigest) {
    return reject('packet-digest-mismatch', 'evidence does not answer the frozen packet that was sent');
  }
  const attempt = record.attempts.find((item) => item.attemptId === evidence.attemptId);
  if (!attempt) return reject('unknown-attempt', 'no attempt with this ID');
  if (!hasEffect(attempt.state) || !attempt.receipt) {
    return reject('attempt-not-accepted', `attempt is ${attempt.state}; reconcile it before accepting evidence`);
  }
  if (attempt.receipt.receiptId !== evidence.receiptId) return reject('receipt-mismatch', 'receipt ID differs from the recorded receipt');
  const binding = record.destination;
  if (evidence.execution.hostId !== binding.hostId || evidence.execution.receiverId !== binding.receiverId) {
    return reject('host-mismatch', 'evidence reports a different host or receiver than the bound destination');
  }
  if (binding.model && (evidence.execution.model?.provider !== binding.model.provider
    || evidence.execution.model?.model !== binding.model.model)) {
    return reject('model-mismatch', 'evidence reports a different model than the pinned one');
  }
  if (evidence.provenance !== attempt.receipt.provenance) {
    return reject('provenance-mismatch', 'evidence provenance differs from the receipt');
  }

  const digest = await digestOf(evidence);
  const existing = await options.evidence.get(evidence.evidenceId);
  if (existing) {
    return existing.digest === digest
      ? { ok: true, entry: existing, duplicate: true }
      : reject('evidence-conflict', 'an evidence record with this ID and different content already exists');
  }
  const entry: EvidenceEntry = {
    evidence, digest, receivedAt: new Date(options.clock.now()).toISOString(), fake: evidence.provenance === 'fake',
  };
  const appended = await options.evidence.append(entry);
  if (appended === 'exists') {
    const raced = await options.evidence.get(evidence.evidenceId);
    return raced && raced.digest === digest
      ? { ok: true, entry: raced, duplicate: true }
      : reject('evidence-conflict', 'an evidence record with this ID and different content already exists');
  }
  return { ok: true, entry, duplicate: false };
}

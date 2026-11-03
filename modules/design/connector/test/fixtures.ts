/** Shared synthetic fixtures for the lifecycle, evidence-feed and route-fence tests. Not a test file. */

import assert from 'node:assert/strict';
import type { Digest } from '../src/canonical.ts';
import type { AttemptState, DispatchRecord, Receipt } from '../src/dispatch.ts';
import type { EvidenceEntry, ExecutionStatus, ResultEvidence } from '../src/evidence.ts';
import type { DestinationId, DispatchId } from '../src/ids.ts';
import type { SubmitResult } from '../src/outbox.ts';
import type { Harness } from './harness.ts';
import { digestOf } from '../src/canonical.ts';
import { latestAttempt } from '../src/dispatch.ts';
import { syntheticDestination, syntheticEvidence, syntheticIdentity } from '../src/fakes.ts';

export function attempted(result: SubmitResult) {
  assert.equal(result.outcome, 'attempted', `expected an attempt, got ${JSON.stringify(result)}`);
  return result as Extract<SubmitResult, { outcome: 'attempted' }>;
}

export function refusedWith(result: SubmitResult, code: string) {
  assert.equal(result.outcome, 'refused', `expected refusal ${code}, got ${JSON.stringify(result)}`);
  assert.equal((result as Extract<SubmitResult, { outcome: 'refused' }>).code, code);
}

export const otherDestination = (id = 'dest.fake-other') => syntheticDestination({
  destinationId: id as DestinationId, label: 'Other fake', endpoint: { transport: 'fake-receiver', locator: 'fake:receiver-9' },
});

/** Drive the real outbox against the labelled fake until the latest attempt is in `state`. */
export async function recordIn(h: Harness, state: AttemptState): Promise<DispatchRecord> {
  let dispatchId: DispatchId;
  switch (state) {
    case 'accepted':
      dispatchId = attempted(await h.outbox.submit(h.request())).dispatchId;
      break;
    case 'held':
      h.receiver.failNextSend('hold');
      dispatchId = attempted(await h.outbox.submit(h.request())).dispatchId;
      break;
    case 'rejected':
      h.receiver.failNextSend('reject');
      dispatchId = attempted(await h.outbox.submit(h.request())).dispatchId;
      break;
    case 'blocked':
      h.receiver.setIdentity({ ...syntheticIdentity(), fingerprint: 'fp.other' });
      dispatchId = attempted(await h.outbox.submit(h.request())).dispatchId;
      break;
    case 'unknown':
      h.receiver.failNextSend('throw-after-effect');
      dispatchId = attempted(await h.outbox.submit(h.request())).dispatchId;
      break;
    case 'no-effect':
      h.receiver.failNextSend('throw-before-effect');
      dispatchId = attempted(await h.outbox.submit(h.request())).dispatchId;
      await h.outbox.reconcile(dispatchId);
      break;
    case 'submitting':
      h.store.failNextPut('throw-before-write', 'accepted');
      dispatchId = attempted(await h.outbox.submit(h.request())).dispatchId;
      break;
  }
  const record = await h.outbox.get(dispatchId);
  assert.ok(record);
  assert.equal(latestAttempt(record)?.state, state);
  return record;
}

export function evidenceFor(h: Harness, record: DispatchRecord, overrides: {
  readonly evidenceId?: string;
  readonly status?: ExecutionStatus;
  readonly observedAt?: string;
} = {}): ResultEvidence {
  const attempt = latestAttempt(record);
  assert.ok(attempt);
  // An attempt that never held a receipt gets a fabricated one so negative cases can still craft evidence.
  const receipt: Receipt = attempt.receipt ?? h.receiver.receiptFor(attempt.idempotencyKey) ?? {
    receiptId: 'rcpt_fabricated' as Receipt['receiptId'], idempotencyKey: attempt.idempotencyKey, status: 'accepted',
    observedHostId: record.destination.hostId, observedReceiverId: record.destination.receiverId,
    observedModel: record.destination.model, at: '2026-01-01T00:00:00.000Z', provenance: 'fake',
  };
  const base = syntheticEvidence({
    dispatchId: record.dispatchId, attemptId: attempt.attemptId, receipt, packet: h.packet,
    model: h.destination.model ?? null, ...(overrides.evidenceId ? { evidenceId: overrides.evidenceId } : {}),
  });
  return {
    ...base,
    execution: { ...base.execution, status: overrides.status ?? 'completed', observedAt: overrides.observedAt ?? base.execution.observedAt },
  };
}

export async function entryOf(evidence: ResultEvidence, receivedAt = '2026-01-01T00:10:00.000Z'): Promise<EvidenceEntry> {
  const digest: Digest = await digestOf(evidence);
  return { evidence, digest, receivedAt, fake: evidence.provenance === 'fake' };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

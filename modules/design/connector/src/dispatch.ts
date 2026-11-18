/**
 * `hq.design.dispatch/v1`: one frozen packet handed to one bound destination.
 *
 * A dispatch owns an ordered list of attempts. Only the latest attempt is live.
 * Its state decides what may happen next:
 *
 *   submitting ──send──► accepted | held | rejected
 *        │       └─fault/timeout/restart──► unknown
 *        └─identity mismatch before send──► blocked
 *   unknown ──authoritative readback──► accepted | held | rejected | no-effect
 *   held    ──readback──► accepted | rejected
 *
 * `submitting` and `unknown` are unresolved: nothing may be sent and no new
 * attempt may start. `accepted`/`held` mean the receiver has the handoff; no
 * new attempt ever. `rejected`/`blocked`/`no-effect` are authoritative
 * no-effect results; only those, plus a fresh confirmation, permit a new attempt.
 */

import type { Digest } from './canonical.ts';
import type { AttemptId, ConfirmationId, DestinationId, DispatchId, HostId, PacketId, ReceiptId, ReceiverId, ThreadRef } from './ids.ts';
import type { Destination, DestinationMode, ModelPin, TransportKind } from './host-catalog.ts';

export const DISPATCH_SCHEMA = 'hq.design.dispatch/v1';

export const ATTEMPT_STATES = ['submitting', 'accepted', 'held', 'rejected', 'unknown', 'blocked', 'no-effect'] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export type Provenance = 'fake' | 'jones';

/** Receiver statement that it durably holds the handoff. Accepted is not completion or approval. */
export interface Receipt {
  readonly receiptId: ReceiptId;
  readonly idempotencyKey: string;
  readonly status: 'accepted' | 'held';
  readonly observedHostId: HostId;
  readonly observedReceiverId: ReceiverId;
  readonly observedModel: ModelPin | null;
  readonly at: string;
  readonly provenance: Provenance;
  readonly reason?: string;
}

/** How the current attempt state became known. */
export type StateBasis = 'send-response' | 'readback' | 'local-preflight' | 'interrupted';

/** Observed deviations from the bound destination. A variance never triggers a retry. */
export type Variance = 'host-mismatch' | 'receiver-mismatch' | 'model-mismatch' | 'provenance-mismatch';

export interface Attempt {
  readonly attemptId: AttemptId;
  readonly ordinal: number;
  readonly idempotencyKey: string;
  readonly confirmationId: ConfirmationId;
  readonly confirmedAt: string;
  readonly sessionId: string;
  readonly wireDigest: Digest;
  readonly state: AttemptState;
  readonly basis: StateBasis;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set when the attempt reaches an authoritative no-effect state. */
  readonly resolvedAt: string | null;
  readonly receipt: Receipt | null;
  readonly reason: string | null;
  readonly variances: readonly Variance[];
  readonly readbacks: number;
  readonly lastReadbackAt: string | null;
}

/** Immutable destination binding captured at dispatch creation. Sends never leave it. */
export interface DestinationBinding {
  readonly destinationId: DestinationId;
  readonly hostId: HostId;
  readonly receiverId: ReceiverId;
  readonly fingerprint: string;
  readonly transport: TransportKind;
  readonly locator: string;
  readonly mode: DestinationMode;
  readonly threadRef: ThreadRef | null;
  readonly model: ModelPin | null;
}

export interface PacketBinding {
  readonly packetId: PacketId;
  /** Authoring digest of the frozen decision packet (owned by requests). */
  readonly packetDigest: Digest;
}

export interface DispatchRecord {
  readonly schema: typeof DISPATCH_SCHEMA;
  readonly dispatchId: DispatchId;
  readonly packet: PacketBinding;
  readonly destination: DestinationBinding;
  readonly attempts: readonly Attempt[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

const TRANSITIONS: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  submitting: ['accepted', 'held', 'rejected', 'unknown', 'blocked'],
  unknown: ['accepted', 'held', 'rejected', 'no-effect', 'unknown'],
  held: ['accepted', 'rejected', 'held'],
  accepted: ['accepted'],
  rejected: [],
  blocked: [],
  'no-effect': [],
};

export function canTransition(from: AttemptState, to: AttemptState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class DispatchTransitionError extends Error {
  override readonly name = 'DispatchTransitionError';
}

export const NO_EFFECT_STATES: readonly AttemptState[] = ['rejected', 'blocked', 'no-effect'];

export function isUnresolved(state: AttemptState): boolean {
  return state === 'submitting' || state === 'unknown';
}

export function hasEffect(state: AttemptState): boolean {
  return state === 'accepted' || state === 'held';
}

export function isNoEffect(state: AttemptState): boolean {
  return NO_EFFECT_STATES.includes(state);
}

export interface AttemptUpdate {
  readonly state: AttemptState;
  readonly basis: StateBasis;
  readonly at: string;
  readonly receipt?: Receipt | null;
  readonly reason?: string | null;
  readonly variances?: readonly Variance[];
  readonly readback?: boolean;
}

/** Apply one legal transition; throws on any transition outside the table. */
export function transitionAttempt(attempt: Attempt, update: AttemptUpdate): Attempt {
  if (!canTransition(attempt.state, update.state)) {
    throw new DispatchTransitionError(`Illegal attempt transition ${attempt.state} → ${update.state}`);
  }
  return {
    ...attempt,
    state: update.state,
    basis: update.basis,
    updatedAt: update.at,
    resolvedAt: isNoEffect(update.state) ? update.at : attempt.resolvedAt,
    receipt: update.receipt === undefined ? attempt.receipt : update.receipt,
    reason: update.reason === undefined ? attempt.reason : update.reason,
    variances: update.variances ?? attempt.variances,
    readbacks: attempt.readbacks + (update.readback ? 1 : 0),
    lastReadbackAt: update.readback ? update.at : attempt.lastReadbackAt,
  };
}

export function latestAttempt(record: DispatchRecord): Attempt | null {
  return record.attempts.at(-1) ?? null;
}

/** Replace the latest attempt, keeping earlier attempts untouched. */
export function withLatest(record: DispatchRecord, attempt: Attempt): DispatchRecord {
  const attempts = record.attempts.slice(0, -1).concat(attempt);
  return { ...record, attempts, updatedAt: attempt.updatedAt };
}

export function bindDestination(destination: Destination): DestinationBinding {
  return {
    destinationId: destination.destinationId,
    hostId: destination.identity.hostId,
    receiverId: destination.identity.receiverId,
    fingerprint: destination.identity.fingerprint,
    transport: destination.endpoint.transport,
    locator: destination.endpoint.locator,
    mode: destination.mode,
    threadRef: destination.threadRef ?? null,
    model: destination.model ?? null,
  };
}

export function sameBinding(a: DestinationBinding, b: DestinationBinding): boolean {
  return a.destinationId === b.destinationId && a.hostId === b.hostId && a.receiverId === b.receiverId
    && a.fingerprint === b.fingerprint && a.transport === b.transport && a.locator === b.locator
    && a.mode === b.mode && a.threadRef === b.threadRef
    && (a.model?.provider ?? null) === (b.model?.provider ?? null)
    && (a.model?.model ?? null) === (b.model?.model ?? null);
}

/** Compare a receipt against the binding. The result is recorded, never acted on by retrying. */
export function receiptVariances(binding: DestinationBinding, receipt: Receipt, expected: Provenance): Variance[] {
  const variances: Variance[] = [];
  if (receipt.observedHostId !== binding.hostId) variances.push('host-mismatch');
  if (receipt.observedReceiverId !== binding.receiverId) variances.push('receiver-mismatch');
  if (binding.model && (receipt.observedModel?.provider !== binding.model.provider
    || receipt.observedModel?.model !== binding.model.model)) variances.push('model-mismatch');
  if (receipt.provenance !== expected) variances.push('provenance-mismatch');
  return variances;
}

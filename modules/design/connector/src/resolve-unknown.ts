/** Ephemeral owner confirmation; readbacks is the durable one-use generation. */
import type { Clock, TransportRegistry } from './contract.ts';
import type { DispatchRecord } from './dispatch.ts';
import type { AttemptId, DispatchId } from './ids.ts';
import { latestAttempt } from './dispatch.ts';

export interface ResolveUnknownConfirmation {
  readonly dispatchId: DispatchId;
  readonly attemptId: AttemptId;
  readonly idempotencyKey: string;
  readonly readbacks: number;
  readonly confirmedAt: string;
}

export type ResolveUnknownResult =
  | { readonly outcome: 'refused'; readonly reason: string }
  | { readonly outcome: 'persist-failed'; readonly reason: string }
  | { readonly outcome: 'resolved'; readonly state: 'accepted' | 'held' | 'no-effect' | 'unknown'; readonly detail: string; readonly persisted: boolean };

export function resolveUnknownReason(record: DispatchRecord | null, transports: TransportRegistry, busy = false): string | null {
  if (busy) return 'An operation for this packet is in flight.';
  if (!record || latestAttempt(record)?.state !== 'unknown') return 'Only an unknown attempt can be resolved.';
  if (record.destination.mode !== 'new-thread') return 'Resolve unknown is available only for new-thread attempts.';
  if (!transports[record.destination.transport]?.fence) return 'This transport has no fence capability.';
  return null;
}

/** Call only at the owner's Confirm action, using the attempt shown on the card. */
export function createResolveUnknownConfirmation(record: DispatchRecord, clock: Clock): ResolveUnknownConfirmation {
  const attempt = latestAttempt(record);
  if (!attempt || attempt.state !== 'unknown') throw new Error('An unknown attempt is required.');
  return {
    dispatchId: record.dispatchId, attemptId: attempt.attemptId,
    idempotencyKey: attempt.idempotencyKey, readbacks: attempt.readbacks,
    confirmedAt: new Date(clock.now()).toISOString(),
  };
}

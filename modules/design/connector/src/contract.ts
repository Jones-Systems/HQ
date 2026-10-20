/**
 * Section-local ports for the Design connector. Root wires real adapters only
 * after qualification; this cone ships labelled fakes (fakes.ts) and no real
 * Jones transport. Shapes are proposals for promotion through the coordination issue.
 */

import type { Digest } from './canonical.ts';
import type { AttemptId, DestinationId, DispatchId, EvidenceId, HostId, PacketId, ReceiverId, ThreadRef } from './ids.ts';
import type { DestinationEndpoint, ModelPin, TransportKind } from './host-catalog.ts';
import type { DispatchRecord, Provenance, Receipt } from './dispatch.ts';
import type { EvidenceEntry } from './evidence.ts';

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

// ── Transport ────────────────────────────────────────────────────────────────

export const HANDOFF_SCHEMA = 'hq.design.handoff/v1';

/** The wire envelope for one attempt. Its digest (wireDigest) is distinct from the packet's authoring digest. */
export interface Handoff {
  readonly schema: typeof HANDOFF_SCHEMA;
  readonly dispatchId: DispatchId;
  readonly attemptId: AttemptId;
  readonly idempotencyKey: string;
  readonly packet: { readonly packetId: PacketId; readonly packetDigest: Digest };
  readonly packetBody: unknown;
  readonly destination: {
    readonly destinationId: DestinationId;
    readonly hostId: HostId;
    readonly receiverId: ReceiverId;
    readonly fingerprint: string;
    readonly threadRef: ThreadRef | null;
    readonly model: ModelPin | null;
  };
  /** The receiver must execute exactly here or refuse; it may not pick another host or model. */
  readonly fallback: 'forbidden';
  readonly confirmedAt: string;
}

export type TransportQualification =
  | { readonly level: 'labelled-fake'; readonly label: string }
  | { readonly level: 'qualified'; readonly evidenceRef: string }
  | { readonly level: 'unqualified'; readonly reason: string };

export interface TransportDescriptor {
  readonly kind: TransportKind;
  readonly label: string;
  readonly provenance: Provenance;
  readonly qualification: TransportQualification;
}

export interface ObservedIdentity {
  readonly hostId: HostId;
  readonly receiverId: ReceiverId;
  readonly fingerprint: string;
}

/**
 * Definite send results. Any thrown error, timeout or malformed result is an
 * unknown effect and is never retried.
 */
export type SendOutcome =
  | { readonly kind: 'accepted'; readonly receipt: Receipt }
  | { readonly kind: 'held'; readonly receipt: Receipt }
  | { readonly kind: 'rejected'; readonly reason: string };

/**
 * Read-only readback by idempotency key.
 *
 * `no-effect` is authoritative only when the receiver guarantees the key was
 * never accepted and can no longer be accepted (it is fenced). `not-found` is
 * plain absence and proves nothing.
 */
export type LookupOutcome =
  | { readonly kind: 'found'; readonly receipt: Receipt }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'no-effect'; readonly basis: string }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface ReadbackPort {
  readonly descriptor: TransportDescriptor;
  lookup(query: { readonly endpoint: DestinationEndpoint; readonly idempotencyKey: string }, signal: AbortSignal): Promise<LookupOutcome>;
}

export interface TransportPort extends ReadbackPort {
  /** Read-only identity probe of the receiver behind an endpoint. */
  identify(endpoint: DestinationEndpoint, signal: AbortSignal): Promise<ObservedIdentity>;
  /** The execution effect. Called at most once per attempt, only after `submitting` is durable. */
  send(handoff: Handoff, endpoint: DestinationEndpoint, signal: AbortSignal): Promise<SendOutcome>;
}

export type TransportRegistry = Readonly<Partial<Record<TransportKind, TransportPort>>>;

// ── Persistence ──────────────────────────────────────────────────────────────

export interface StoredDispatch {
  readonly revision: number;
  readonly record: DispatchRecord;
}

export type PutResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly reason: 'conflict'; readonly current: StoredDispatch | null };

/**
 * Durable outbox, one document per dispatch in the authoritative `workspace`
 * namespace (never `cache`). `put` is an atomic compare-and-swap on revision;
 * `expectedRevision: null` means "create only if absent". A resolved `put` is durable.
 */
export interface OutboxStorePort {
  get(dispatchId: DispatchId): Promise<StoredDispatch | null>;
  put(record: DispatchRecord, expectedRevision: number | null): Promise<PutResult>;
  list(): Promise<readonly StoredDispatch[]>;
}

/** Append-only returned-evidence store. Entries are immutable once appended. */
export interface EvidenceStorePort {
  get(evidenceId: EvidenceId): Promise<EvidenceEntry | null>;
  /** Returns 'exists' without writing when the ID is already present. */
  append(entry: EvidenceEntry): Promise<'appended' | 'exists'>;
  listByDispatch(dispatchId: DispatchId): Promise<readonly EvidenceEntry[]>;
}

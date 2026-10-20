/**
 * Durable dispatch outbox: the only code path that calls TransportPort.send.
 *
 * Invariants (see test/outbox.test.ts):
 * - `submitting` is durably persisted before any transport call.
 * - One packet has at most one live send in this process; a persisted
 *   unresolved attempt fences every further send of that packet.
 * - An unknown effect is never resent, and no new attempt starts until an
 *   authoritative no-effect result is recorded and the owner confirms afresh.
 * - Reconciliation only reads back (lookup) and never sends.
 * - The bound host, receiver and model are never substituted.
 * - Another route that already took the packet (a dispatch to a different
 *   destination, or an owner-recorded manual handoff) fences a send until the
 *   owner acknowledges it. History only adds fences; it never clears one.
 */

import type { Digest } from './canonical.ts';
import type { Clock, Handoff, LookupOutcome, OutboxStorePort, ReadbackPort, SendOutcome, StoredDispatch, TransportPort, TransportRegistry } from './contract.ts';
import type { SendConfirmation } from './confirmation.ts';
import type { Attempt, AttemptState, DispatchRecord, Receipt } from './dispatch.ts';
import type { Destination } from './host-catalog.ts';
import type { DispatchId, PacketId } from './ids.ts';
import type { ManualHandoffHistoryPort, ManualHandoffRecord, RouteSwitchAcknowledgement } from './route-fence.ts';
import type { IneligibleCode } from './eligibility.ts';
import { CanonicalJsonError, digestOf, isDigest } from './canonical.ts';
import { DEFAULT_CONFIRMATION_TTL_MS } from './confirmation.ts';
import { HANDOFF_SCHEMA } from './contract.ts';
import {
  DISPATCH_SCHEMA, bindDestination, hasEffect, isNoEffect, isUnresolved, latestAttempt,
  receiptVariances, sameBinding, transitionAttempt, withLatest,
} from './dispatch.ts';
import { evaluateDestination } from './eligibility.ts';
import { brandId } from './ids.ts';
import { collectRouteSources, evaluateRouteFence } from './route-fence.ts';
import { errorText, withTimeout } from './timeout.ts';
import { isRecord } from './validate.ts';

export interface PacketInput {
  readonly packetId: PacketId;
  /** Authoring digest from the frozen packet record. */
  readonly packetDigest: Digest;
  readonly body: unknown;
}

export interface SubmitRequest {
  readonly packet: PacketInput;
  /** The destination as currently shown from the host catalog. */
  readonly destination: Destination;
  readonly confirmation: SendConfirmation;
  /** Needed only when the packet already went another way; see route-fence.ts. Absent in v1 requests. */
  readonly routeSwitch?: RouteSwitchAcknowledgement;
}

export type RefusalCode =
  | IneligibleCode
  | 'in-flight'
  | 'unresolved-attempt'
  | 'already-handed-off'
  | 'packet-fenced'
  | 'route-switch-unacknowledged'
  | 'route-acknowledgement-mismatch'
  | 'route-history-unavailable'
  | 'binding-changed'
  | 'identity-mismatch'
  | 'confirmation-mismatch'
  | 'confirmation-expired'
  | 'confirmation-consumed'
  | 'confirmation-not-fresh'
  | 'packet-invalid'
  | 'packet-digest-mismatch';

export type SubmitResult =
  | { readonly outcome: 'refused'; readonly code: RefusalCode; readonly reason: string; readonly dispatchId: DispatchId | null }
  /** Nothing was sent; the durable state of the attempt may need reconciliation. */
  | { readonly outcome: 'persist-failed'; readonly dispatchId: DispatchId; readonly reason: string }
  /** An attempt ran. `persisted: false` means its final state is only in memory and will reconcile as unknown. */
  | { readonly outcome: 'attempted'; readonly dispatchId: DispatchId; readonly attempt: Attempt; readonly persisted: boolean };

export interface ReconcileReport {
  readonly dispatchId: DispatchId;
  readonly before: AttemptState | null;
  readonly after: AttemptState | null;
  readonly detail: string;
}

export interface OutboxOptions {
  readonly store: OutboxStorePort;
  readonly transports: TransportRegistry;
  readonly clock: Clock;
  /** Identifies this process run; recorded on attempts for diagnosis. */
  readonly sessionId: string;
  readonly sendTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  readonly confirmationTtlMs?: number;
  /** Verifies the packet body against its authoring digest. Defaults to JCS SHA-256 of `body`. */
  readonly verifyPacket?: (packet: PacketInput) => Promise<boolean>;
  /**
   * Owner-recorded manual handoffs (requests owns the history). When given, a
   * packet with manual history needs a route-switch acknowledgement, and an
   * unreadable history refuses the send. Omitted in v1 composition.
   */
  readonly manualHandoffs?: ManualHandoffHistoryPort;
}

export interface Outbox {
  submit(request: SubmitRequest): Promise<SubmitResult>;
  /** Startup recovery: attempts left `submitting` by an earlier run become `unknown`. Never sends. */
  recover(): Promise<readonly ReconcileReport[]>;
  /** Read-only readback of unresolved or held attempts. Never sends. */
  reconcile(dispatchId?: DispatchId): Promise<readonly ReconcileReport[]>;
  get(dispatchId: DispatchId): Promise<DispatchRecord | null>;
  list(): Promise<readonly DispatchRecord[]>;
  dispatchIdFor(packet: { readonly packetId: PacketId; readonly packetDigest: Digest }, destination: Destination): Promise<DispatchId>;
}

function isReceipt(value: unknown, idempotencyKey: string, status: Receipt['status']): value is Receipt {
  return isRecord(value) && value.idempotencyKey === idempotencyKey && value.status === status
    && typeof value.receiptId === 'string' && value.receiptId.length > 0
    && typeof value.observedHostId === 'string' && typeof value.observedReceiverId === 'string'
    && (value.provenance === 'fake' || value.provenance === 'jones') && typeof value.at === 'string';
}

/** Validate a send result; anything not definite is treated as unknown by the caller. */
function definiteSend(outcome: unknown, idempotencyKey: string): SendOutcome | null {
  if (!isRecord(outcome)) return null;
  if (outcome.kind === 'rejected') return typeof outcome.reason === 'string' ? { kind: 'rejected', reason: outcome.reason } : null;
  if ((outcome.kind === 'accepted' || outcome.kind === 'held') && isReceipt(outcome.receipt, idempotencyKey, outcome.kind)) {
    return { kind: outcome.kind, receipt: outcome.receipt };
  }
  return null;
}

export function createOutbox(options: OutboxOptions): Outbox {
  const { store, transports, clock, sessionId } = options;
  const sendTimeoutMs = options.sendTimeoutMs ?? 30_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
  const confirmationTtlMs = options.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
  const verifyPacket = options.verifyPacket
    ?? (async (packet: PacketInput) => (await digestOf(packet.body)) === packet.packetDigest);
  /** Packets with a live submit in this process. Checked synchronously so a double click cannot interleave. */
  const inflight = new Set<string>();
  const nowIso = () => new Date(clock.now()).toISOString();

  async function dispatchIdFor(packet: { readonly packetId: PacketId; readonly packetDigest: Digest }, destination: Destination): Promise<DispatchId> {
    const digest = await digestOf({ packetId: packet.packetId, packetDigest: packet.packetDigest, destinationId: destination.destinationId });
    return brandId('DispatchId', `dsp_${digest.slice('sha256:'.length, 'sha256:'.length + 32)}`);
  }

  function refused(code: RefusalCode, reason: string, dispatchId: DispatchId | null = null): SubmitResult {
    return { outcome: 'refused', code, reason, dispatchId };
  }

  function checkConfirmation(request: SubmitRequest): SubmitResult | null {
    const { confirmation: c, packet, destination } = request;
    if (c.packetId !== packet.packetId || c.packetDigest !== packet.packetDigest
      || c.destinationId !== destination.destinationId) {
      return refused('confirmation-mismatch', 'The confirmation was for a different packet or destination.');
    }
    if (c.hostId !== destination.identity.hostId || c.receiverId !== destination.identity.receiverId
      || c.fingerprint !== destination.identity.fingerprint) {
      return refused('identity-mismatch', 'The destination identity changed after you confirmed. Nothing was sent.');
    }
    const confirmedAt = Date.parse(c.confirmedAt);
    const now = clock.now();
    if (Number.isNaN(confirmedAt) || confirmedAt > now || now - confirmedAt > confirmationTtlMs) {
      return refused('confirmation-expired', 'The confirmation has expired. Confirm again to send.');
    }
    return null;
  }

  async function submitLocked(request: SubmitRequest): Promise<SubmitResult> {
    const { packet, destination, confirmation } = request;
    if (!isDigest(packet.packetDigest)) return refused('packet-invalid', 'The packet digest is malformed.');

    const eligibility = evaluateDestination(destination, transports);
    if (!eligibility.eligible) return refused(eligibility.code, eligibility.reason);
    const transport: TransportPort = eligibility.transport;

    const confirmationProblem = checkConfirmation(request);
    if (confirmationProblem) return confirmationProblem;

    let verified: boolean;
    try {
      verified = await verifyPacket(packet);
    } catch (error) {
      if (error instanceof CanonicalJsonError) return refused('packet-invalid', 'The packet body is not canonical JSON.');
      throw error;
    }
    if (!verified) return refused('packet-digest-mismatch', 'The packet body does not match its frozen digest. Nothing was sent.');

    const dispatchId = await dispatchIdFor(packet, destination);
    const binding = bindDestination(destination);
    const all = await store.list();
    for (const other of all) {
      const latest = latestAttempt(other.record);
      if (other.record.dispatchId !== dispatchId && other.record.packet.packetId === packet.packetId
        && latest && isUnresolved(latest.state)) {
        return refused('packet-fenced', 'Another send of this packet has an unresolved effect. Check its status first.', other.record.dispatchId);
      }
    }

    const existing = all.find((item) => item.record.dispatchId === dispatchId) ?? null;
    const previous = existing ? latestAttempt(existing.record) : null;
    if (existing) {
      if (!sameBinding(existing.record.destination, binding)) {
        return refused('binding-changed', 'This packet is bound to an earlier identity of this destination. It cannot be redirected.', dispatchId);
      }
      if (existing.record.attempts.some((attempt) => attempt.confirmationId === confirmation.confirmationId)) {
        return refused('confirmation-consumed', 'This confirmation was already used. Confirm again to start a new attempt.', dispatchId);
      }
    }
    if (previous) {
      if (isUnresolved(previous.state)) {
        return refused('unresolved-attempt', 'The previous attempt has an unknown effect. HQ will not resend it; check its status.', dispatchId);
      }
      if (hasEffect(previous.state)) {
        return refused('already-handed-off', 'The receiver already has this handoff.', dispatchId);
      }
      if (!isNoEffect(previous.state) || previous.resolvedAt === null
        || Date.parse(confirmation.confirmedAt) <= Date.parse(previous.resolvedAt)) {
        return refused('confirmation-not-fresh', 'A new attempt needs a confirmation made after the previous attempt was resolved.', dispatchId);
      }
    }

    // Route-switch fence: another destination's effect or a manual handoff needs an explicit acknowledgement.
    // Unresolved attempts were refused above and are never acknowledgeable.
    let manual: readonly ManualHandoffRecord[] = [];
    if (options.manualHandoffs) {
      try {
        manual = await options.manualHandoffs.listForPacket(packet.packetId);
      } catch (error) {
        return refused('route-history-unavailable', `The manual handoff history could not be read, so nothing was sent (${errorText(error)}).`, dispatchId);
      }
    }
    const routeFence = evaluateRouteFence({
      confirmation,
      sources: collectRouteSources({
        packetId: packet.packetId, destinationId: destination.destinationId,
        dispatches: all.map((item) => item.record), manualHandoffs: manual,
      }),
      acknowledgement: request.routeSwitch,
      now: clock.now(),
    });
    if (!routeFence.ok) return refused(routeFence.code, routeFence.reason, dispatchId);

    const at = nowIso();
    const ordinal = (existing?.record.attempts.length ?? 0) + 1;
    const attemptId = brandId('AttemptId', `${dispatchId}.a${ordinal}`);
    const idempotencyKey = attemptId;
    const handoff: Handoff = {
      schema: HANDOFF_SCHEMA,
      dispatchId,
      attemptId,
      idempotencyKey,
      packet: { packetId: packet.packetId, packetDigest: packet.packetDigest },
      packetBody: packet.body,
      destination: {
        destinationId: binding.destinationId, hostId: binding.hostId, receiverId: binding.receiverId,
        fingerprint: binding.fingerprint, threadRef: binding.threadRef, model: binding.model,
      },
      fallback: 'forbidden',
      confirmedAt: confirmation.confirmedAt,
    };
    let wireDigest: Digest;
    try {
      wireDigest = await digestOf(handoff);
    } catch (error) {
      if (error instanceof CanonicalJsonError) return refused('packet-invalid', 'The packet body is not canonical JSON.', dispatchId);
      throw error;
    }
    const endpoint = { transport: binding.transport, locator: binding.locator };
    const submitting: Attempt = {
      attemptId, ordinal, idempotencyKey,
      confirmationId: confirmation.confirmationId,
      confirmedAt: confirmation.confirmedAt,
      sessionId,
      wireDigest,
      state: 'submitting', basis: 'local-preflight',
      createdAt: at, updatedAt: at, resolvedAt: null,
      receipt: null, reason: null, variances: [], readbacks: 0, lastReadbackAt: null,
    };
    let record: DispatchRecord = existing
      ? { ...existing.record, attempts: [...existing.record.attempts, submitting], updatedAt: at }
      : {
        schema: DISPATCH_SCHEMA, dispatchId,
        packet: { packetId: packet.packetId, packetDigest: packet.packetDigest },
        destination: binding, attempts: [submitting], createdAt: at, updatedAt: at,
      };

    // Durability point: no transport call happens unless this put resolves ok.
    let revision: number;
    try {
      const put = await store.put(record, existing?.revision ?? null);
      if (!put.ok) return refused('in-flight', 'Another submit for this packet was recorded first. Nothing more was sent.', dispatchId);
      revision = put.revision;
    } catch (error) {
      return { outcome: 'persist-failed', dispatchId, reason: `Could not record the attempt; nothing was sent (${errorText(error)}).` };
    }

    const persist = async (attempt: Attempt): Promise<SubmitResult> => {
      record = withLatest(record, attempt);
      try {
        const put = await store.put(record, revision);
        return { outcome: 'attempted', dispatchId, attempt, persisted: put.ok };
      } catch {
        return { outcome: 'attempted', dispatchId, attempt, persisted: false };
      }
    };

    // Read-only identity probe; a mismatch or failure blocks before any send.
    try {
      const observed = await withTimeout(probeTimeoutMs, (signal) => transport.identify(endpoint, signal));
      if (observed.hostId !== binding.hostId || observed.receiverId !== binding.receiverId
        || observed.fingerprint !== binding.fingerprint) {
        return persist(transitionAttempt(submitting, {
          state: 'blocked', basis: 'local-preflight', at: nowIso(),
          reason: 'The receiver identity did not match the bound destination. Nothing was sent.',
        }));
      }
    } catch (error) {
      return persist(transitionAttempt(submitting, {
        state: 'blocked', basis: 'local-preflight', at: nowIso(),
        reason: `The identity probe failed, so nothing was sent (${errorText(error)}).`,
      }));
    }

    let outcome: SendOutcome | null;
    try {
      const raw: unknown = await withTimeout(sendTimeoutMs, (signal) => transport.send(handoff, endpoint, signal));
      outcome = definiteSend(raw, idempotencyKey);
    } catch (error) {
      return persist(transitionAttempt(submitting, {
        state: 'unknown', basis: 'send-response', at: nowIso(),
        reason: `The send did not return a definite result (${errorText(error)}). It will not be resent.`,
      }));
    }
    if (!outcome) {
      return persist(transitionAttempt(submitting, {
        state: 'unknown', basis: 'send-response', at: nowIso(),
        reason: 'The receiver returned an unrecognized result. It will not be resent.',
      }));
    }
    if (outcome.kind === 'rejected') {
      return persist(transitionAttempt(submitting, {
        state: 'rejected', basis: 'send-response', at: nowIso(), reason: outcome.reason,
      }));
    }
    return persist(transitionAttempt(submitting, {
      state: outcome.kind, basis: 'send-response', at: nowIso(), receipt: outcome.receipt,
      variances: receiptVariances(binding, outcome.receipt, transport.descriptor.provenance),
    }));
  }

  async function submit(request: SubmitRequest): Promise<SubmitResult> {
    // Synchronous guard: runs before the first await, so concurrent calls cannot both pass.
    const key = request.packet.packetId;
    if (inflight.has(key)) return refused('in-flight', 'A send for this packet is already in progress.');
    inflight.add(key);
    try {
      return await submitLocked(request);
    } finally {
      inflight.delete(key);
    }
  }

  /** Mark a stray `submitting` attempt unknown; returns the updated stored record or null on conflict. */
  async function interrupt(stored: StoredDispatch): Promise<StoredDispatch | null> {
    const latest = latestAttempt(stored.record);
    if (!latest || latest.state !== 'submitting') return stored;
    const record = withLatest(stored.record, transitionAttempt(latest, {
      state: 'unknown', basis: 'interrupted', at: nowIso(),
      reason: 'HQ stopped before the send result was recorded. It will not be resent.',
    }));
    const put = await store.put(record, stored.revision);
    return put.ok ? { revision: put.revision, record } : null;
  }

  async function recover(): Promise<readonly ReconcileReport[]> {
    const reports: ReconcileReport[] = [];
    for (const stored of await store.list()) {
      const latest = latestAttempt(stored.record);
      if (!latest || latest.state !== 'submitting' || inflight.has(stored.record.packet.packetId)) continue;
      const updated = await interrupt(stored);
      reports.push({
        dispatchId: stored.record.dispatchId, before: 'submitting',
        after: updated ? 'unknown' : 'submitting',
        detail: updated ? 'interrupted attempt marked unknown' : 'record changed concurrently; left for the next pass',
      });
    }
    return reports;
  }

  /** Only `lookup` is reachable from reconciliation; it has no access to send or identify. */
  function readbackFor(kind: DispatchRecord['destination']['transport']): ReadbackPort | null {
    const transport = transports[kind];
    if (!transport) return null;
    return { descriptor: transport.descriptor, lookup: (query, signal) => transport.lookup(query, signal) };
  }

  async function reconcileOne(initial: StoredDispatch): Promise<ReconcileReport> {
    const dispatchId = initial.record.dispatchId;
    const first = latestAttempt(initial.record);
    if (!first) return { dispatchId, before: null, after: null, detail: 'no attempts' };
    if (inflight.has(initial.record.packet.packetId)) {
      return { dispatchId, before: first.state, after: first.state, detail: 'send in progress in this session' };
    }
    let stored: StoredDispatch | null = initial;
    if (first.state === 'submitting') stored = await interrupt(initial);
    if (!stored) return { dispatchId, before: first.state, after: first.state, detail: 'record changed concurrently' };
    const latest = latestAttempt(stored.record);
    if (!latest || (latest.state !== 'unknown' && latest.state !== 'held')) {
      return { dispatchId, before: first.state, after: latest?.state ?? null, detail: 'nothing to read back' };
    }
    const readback = readbackFor(stored.record.destination.transport);
    if (!readback) {
      return { dispatchId, before: first.state, after: latest.state, detail: 'no readback port for this destination' };
    }
    const endpoint = { transport: stored.record.destination.transport, locator: stored.record.destination.locator };
    let found: LookupOutcome;
    try {
      found = await withTimeout(probeTimeoutMs, (signal) => readback.lookup({ endpoint, idempotencyKey: latest.idempotencyKey }, signal));
    } catch (error) {
      found = { kind: 'unavailable', detail: errorText(error) };
    }
    const at = nowIso();
    let next: Attempt;
    let detail: string;
    if (found.kind === 'found' && (found.receipt.status === 'accepted' || found.receipt.status === 'held')
      && isReceipt(found.receipt, latest.idempotencyKey, found.receipt.status)) {
      next = transitionAttempt(latest, {
        state: found.receipt.status, basis: 'readback', at, receipt: found.receipt, readback: true, reason: null,
        variances: receiptVariances(stored.record.destination, found.receipt, readback.descriptor.provenance),
      });
      detail = `receiver reports ${found.receipt.status}`;
    } else if (found.kind === 'rejected') {
      next = transitionAttempt(latest, { state: 'rejected', basis: 'readback', at, reason: found.reason, readback: true });
      detail = 'receiver reports rejected';
    } else if (found.kind === 'no-effect' && latest.state === 'unknown') {
      next = transitionAttempt(latest, {
        state: 'no-effect', basis: 'readback', at, readback: true,
        reason: `Receiver confirmed no effect (${found.basis}). A new attempt needs a fresh confirmation.`,
      });
      detail = 'authoritative no-effect';
    } else {
      const why = found.kind === 'not-found' ? 'not found (absence proves nothing)'
        : found.kind === 'unavailable' ? `readback unavailable: ${found.detail}`
          : found.kind === 'no-effect' ? 'no-effect contradicts a held receipt; kept as held'
            : 'unrecognized readback';
      next = transitionAttempt(latest, { state: latest.state, basis: latest.basis, at, readback: true });
      detail = why;
    }
    const record = withLatest(stored.record, next);
    const put = await store.put(record, stored.revision);
    return {
      dispatchId, before: first.state, after: put.ok ? next.state : latest.state,
      detail: put.ok ? detail : `${detail}; record changed concurrently, not saved`,
    };
  }

  async function reconcile(dispatchId?: DispatchId): Promise<readonly ReconcileReport[]> {
    const targets = dispatchId
      ? [await store.get(dispatchId)].filter((item): item is StoredDispatch => item !== null)
      : await store.list();
    const reports: ReconcileReport[] = [];
    for (const stored of targets) reports.push(await reconcileOne(stored));
    return reports;
  }

  return {
    submit,
    recover,
    reconcile,
    dispatchIdFor,
    async get(dispatchId) {
      return (await store.get(dispatchId))?.record ?? null;
    },
    async list() {
      return (await store.list()).map((item) => item.record);
    },
  };
}

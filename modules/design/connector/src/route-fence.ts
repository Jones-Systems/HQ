/**
 * Pinned route and manual-route fence.
 *
 * Pinned route: a dispatch is bound to one host, receiver, thread and model at
 * creation. There is no fallback; drift between that binding and the current
 * catalog is reported, never repaired by substituting another route.
 *
 * Route-switch / manual-route fence: a packet that already reached a receiver
 * through another destination, or that the owner already handed off by hand
 * (history owned by requests, injected as a read-only port), may be sent here
 * only with an explicit acknowledgement. The acknowledgement names every source
 * the owner was shown and is bound to one single-use confirmation, so a new
 * source invalidates it. History can only add a fence; it never clears one. An
 * unresolved attempt is not acknowledgeable and a manual record never resolves it.
 */

import type { Digest } from './canonical.ts';
import type { Clock } from './contract.ts';
import type { SendConfirmation } from './confirmation.ts';
import type { DestinationBinding, DispatchRecord, Receipt, Variance } from './dispatch.ts';
import type { Destination, FreshnessStatus, ModelPin, TransportKind } from './host-catalog.ts';
import type { AttemptId, ConfirmationId, DestinationId, DispatchId, HostId, PacketId, ReceiverId, ThreadRef } from './ids.ts';
import { isDigest } from './canonical.ts';
import { latestAttempt, receiptVariances } from './dispatch.ts';
import { isIdText } from './ids.ts';
import { hasExactKeys, isRecord, isTimestamp } from './validate.ts';

// ── Pinned route ─────────────────────────────────────────────────────────────

export type RouteDrift = 'destination-missing' | 'destination' | 'mode' | 'host' | 'receiver' | 'fingerprint' | 'endpoint' | 'thread' | 'model';

export interface PinnedRoute {
  /** `dispatch-binding` is immutable and pinned; `catalog-selection` is only the destination chosen so far. */
  readonly source: 'dispatch-binding' | 'catalog-selection';
  readonly destinationId: DestinationId;
  readonly hostId: HostId;
  readonly receiverId: ReceiverId;
  readonly fingerprint: string;
  readonly transport: TransportKind;
  readonly mode: DestinationBinding['mode'];
  readonly threadRef: ThreadRef | null;
  /** Null means no model is pinned; HQ then makes no model claim. */
  readonly model: ModelPin | null;
  /** Always forbidden: neither host nor model is ever substituted. */
  readonly fallback: 'forbidden';
  readonly freshness: { readonly status: FreshnessStatus | 'unobserved'; readonly lastSuccessAt: string | null };
  /** What the receiver reported in its receipt, when there is one. */
  readonly observed: {
    readonly hostId: HostId;
    readonly receiverId: ReceiverId;
    readonly model: ModelPin | null;
  } | null;
  readonly variances: readonly Variance[];
  /** Differences between the pinned binding and the destination currently in the catalog. */
  readonly drift: readonly RouteDrift[];
}

function sameModel(a: ModelPin | null | undefined, b: ModelPin | null | undefined): boolean {
  return (a?.provider ?? null) === (b?.provider ?? null) && (a?.model ?? null) === (b?.model ?? null);
}

/** Compare a pinned binding with the destination now in the catalog (null: gone). */
export function routeDrift(binding: DestinationBinding, current: Destination | null): readonly RouteDrift[] {
  if (current === null) return ['destination-missing'];
  const drift: RouteDrift[] = [];
  if (current.destinationId !== binding.destinationId) drift.push('destination');
  if (current.mode !== binding.mode) drift.push('mode');
  if (current.identity.hostId !== binding.hostId) drift.push('host');
  if (current.identity.receiverId !== binding.receiverId) drift.push('receiver');
  if (current.identity.fingerprint !== binding.fingerprint) drift.push('fingerprint');
  if (current.endpoint.transport !== binding.transport || current.endpoint.locator !== binding.locator) drift.push('endpoint');
  if ((current.threadRef ?? null) !== binding.threadRef) drift.push('thread');
  if (!sameModel(current.model, binding.model)) drift.push('model');
  return drift;
}

/** Variances of a receipt against a binding, using the provenance the transport kind implies. */
export function bindingVariances(binding: DestinationBinding, receipt: Receipt): readonly Variance[] {
  return receiptVariances(binding, receipt, binding.transport === 'fake-receiver' ? 'fake' : 'jones');
}

/**
 * The route a dispatch is pinned to. `current` is the destination in the
 * catalog now: `undefined` when no catalog was consulted, `null` when it is gone.
 */
export function pinnedRouteOf(record: DispatchRecord, current?: Destination | null): PinnedRoute {
  const binding = record.destination;
  const receipt = latestAttempt(record)?.receipt ?? null;
  const stored = latestAttempt(record)?.variances ?? [];
  const recomputed = receipt ? bindingVariances(binding, receipt) : [];
  const variances = (['host-mismatch', 'receiver-mismatch', 'model-mismatch', 'provenance-mismatch'] as const)
    .filter((variance) => stored.includes(variance) || recomputed.includes(variance));
  return {
    source: 'dispatch-binding',
    destinationId: binding.destinationId,
    hostId: binding.hostId,
    receiverId: binding.receiverId,
    fingerprint: binding.fingerprint,
    transport: binding.transport,
    mode: binding.mode,
    threadRef: binding.threadRef,
    model: binding.model,
    fallback: 'forbidden',
    freshness: current ? { status: current.freshness.status, lastSuccessAt: current.freshness.lastSuccessAt } : { status: 'unobserved', lastSuccessAt: null },
    observed: receipt ? { hostId: receipt.observedHostId, receiverId: receipt.observedReceiverId, model: receipt.observedModel } : null,
    variances,
    drift: current === undefined ? [] : routeDrift(binding, current),
  };
}

/** The route as chosen in the catalog before any dispatch pins it. */
export function selectedRouteOf(destination: Destination): PinnedRoute {
  return {
    source: 'catalog-selection',
    destinationId: destination.destinationId,
    hostId: destination.identity.hostId,
    receiverId: destination.identity.receiverId,
    fingerprint: destination.identity.fingerprint,
    transport: destination.endpoint.transport,
    mode: destination.mode,
    threadRef: destination.threadRef ?? null,
    model: destination.model ?? null,
    fallback: 'forbidden',
    freshness: { status: destination.freshness.status, lastSuccessAt: destination.freshness.lastSuccessAt },
    observed: null,
    variances: [],
    drift: [],
  };
}

// ── Manual handoff history (owned by requests, read-only here) ──────────────

/** One owner-recorded manual handoff of a packet. Connector reads it; it never writes or resolves anything. */
export interface ManualHandoffRecord {
  readonly recordId: string;
  readonly packetId: PacketId;
  readonly packetDigest: Digest;
  readonly recordedAt: string;
}

export interface ManualHandoffHistoryPort {
  listForPacket(packetId: PacketId): Promise<readonly ManualHandoffRecord[]>;
}

export function parseManualHandoffRecord(value: unknown): ManualHandoffRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, ['recordId', 'packetId', 'packetDigest', 'recordedAt'])) return null;
  if (!isIdText(value.recordId) || !isIdText(value.packetId) || !isDigest(value.packetDigest) || !isTimestamp(value.recordedAt)) return null;
  return { recordId: value.recordId, packetId: value.packetId as PacketId, packetDigest: value.packetDigest, recordedAt: value.recordedAt };
}

// ── Route-switch fence ──────────────────────────────────────────────────────

export type RouteSource =
  | { readonly kind: 'dispatch'; readonly dispatchId: DispatchId; readonly destinationId: DestinationId; readonly attemptId: AttemptId; readonly state: 'accepted' | 'held' }
  | { readonly kind: 'manual'; readonly recordId: string; readonly recordedAt: string };

export function routeSourceKey(source: RouteSource): string {
  return source.kind === 'dispatch' ? `dispatch:${source.dispatchId}:${source.attemptId}` : `manual:${source.recordId}`;
}

/**
 * Other routes that already took this packet: dispatches to a different
 * destination whose latest attempt has an effect, and every manual handoff
 * recorded for the packet ID. The same destination's own history is the
 * outbox's `already-handed-off` / `unresolved-attempt` business, not a source.
 */
export function collectRouteSources(input: {
  readonly packetId: PacketId;
  readonly destinationId: DestinationId;
  readonly dispatches: readonly DispatchRecord[];
  readonly manualHandoffs: readonly ManualHandoffRecord[];
}): readonly RouteSource[] {
  const sources: RouteSource[] = [];
  for (const record of input.dispatches) {
    const latest = latestAttempt(record);
    if (record.packet.packetId !== input.packetId || record.destination.destinationId === input.destinationId) continue;
    if (latest && (latest.state === 'accepted' || latest.state === 'held')) {
      sources.push({ kind: 'dispatch', dispatchId: record.dispatchId, destinationId: record.destination.destinationId, attemptId: latest.attemptId, state: latest.state });
    }
  }
  for (const manual of input.manualHandoffs) {
    if (manual.packetId === input.packetId) sources.push({ kind: 'manual', recordId: manual.recordId, recordedAt: manual.recordedAt });
  }
  return sources.sort((a, b) => routeSourceKey(a).localeCompare(routeSourceKey(b)));
}

/** The owner's explicit acknowledgement that this packet already went another way. Bound to one confirmation. */
export interface RouteSwitchAcknowledgement {
  readonly acknowledgementId: string;
  readonly confirmationId: ConfirmationId;
  readonly packetId: PacketId;
  readonly packetDigest: Digest;
  readonly destinationId: DestinationId;
  /** `routeSourceKey` of every source the owner was shown. */
  readonly sources: readonly string[];
  readonly acknowledgedAt: string;
}

export function createRouteSwitchAcknowledgement(input: {
  readonly confirmation: SendConfirmation;
  readonly sources: readonly RouteSource[];
  readonly clock: Clock;
  readonly newId?: () => string;
}): RouteSwitchAcknowledgement {
  const newId = input.newId ?? (() => globalThis.crypto.randomUUID());
  return {
    acknowledgementId: `ack_${newId()}`,
    confirmationId: input.confirmation.confirmationId,
    packetId: input.confirmation.packetId,
    packetDigest: input.confirmation.packetDigest,
    destinationId: input.confirmation.destinationId,
    sources: input.sources.map(routeSourceKey),
    acknowledgedAt: new Date(input.clock.now()).toISOString(),
  };
}

export type RouteFenceCode = 'route-switch-unacknowledged' | 'route-acknowledgement-mismatch';

export type RouteFenceResult =
  | { readonly ok: true; readonly sources: readonly RouteSource[]; readonly acknowledged: boolean }
  | { readonly ok: false; readonly code: RouteFenceCode; readonly sources: readonly RouteSource[]; readonly reason: string };

export const ROUTE_SWITCH_REASON =
  'This request already went another way (another destination or a manual handoff). Review that history and acknowledge it before sending here.';

/** Pure fence decision. No sources: open. Sources: only an acknowledgement covering every source and bound to this confirmation opens it. */
export function evaluateRouteFence(input: {
  readonly confirmation: SendConfirmation;
  readonly sources: readonly RouteSource[];
  readonly acknowledgement: RouteSwitchAcknowledgement | undefined;
  readonly now: number;
}): RouteFenceResult {
  const { sources, acknowledgement: ack, confirmation } = input;
  if (sources.length === 0) return { ok: true, sources, acknowledged: false };
  if (!ack) return { ok: false, code: 'route-switch-unacknowledged', sources, reason: ROUTE_SWITCH_REASON };
  const acknowledgedAt = Date.parse(ack.acknowledgedAt);
  const covered = new Set(ack.sources);
  const bound = ack.confirmationId === confirmation.confirmationId && ack.packetId === confirmation.packetId
    && ack.packetDigest === confirmation.packetDigest && ack.destinationId === confirmation.destinationId;
  if (!bound || Number.isNaN(acknowledgedAt) || acknowledgedAt > input.now || !sources.every((source) => covered.has(routeSourceKey(source)))) {
    return {
      ok: false, code: 'route-acknowledgement-mismatch', sources,
      reason: 'The acknowledgement does not cover the current route history for this request and confirmation. Review it and confirm again.',
    };
  }
  return { ok: true, sources, acknowledged: true };
}

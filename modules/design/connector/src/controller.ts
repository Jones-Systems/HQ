/**
 * Framework-free connector controller: the composition entry the React panel
 * (and root) drive. Selecting a destination or opening the confirmation never
 * sends; only `confirm()` submits. Only `confirmResolveUnknown()` fences an
 * unknown attempt. Both explicit effects run only once at a time.
 */

import type { ResolveUnknownResult } from './resolve-unknown.ts';
import { createResolveUnknownConfirmation, resolveUnknownReason } from './resolve-unknown.ts';
import type { Clock, EvidenceFeedPort, EvidenceStorePort, TransportRegistry } from './contract.ts';
import type { DispatchRecord } from './dispatch.ts';
import type { EvidenceEntry } from './evidence.ts';
import type { EvidenceReadbackReport } from './evidence-feed.ts';
import type { Destination, HostCatalog } from './host-catalog.ts';
import type { DestinationId, DispatchId } from './ids.ts';
import type { DispatchLifecycle } from './lifecycle.ts';
import type { Outbox, PacketInput, SubmitResult } from './outbox.ts';
import type { ManualHandoffHistoryPort, ManualHandoffRecord, RouteSource } from './route-fence.ts';
import type { ConfirmationView, DestinationRow, DispatchStatusView, EvidenceRow, LifecycleView, NewThreadControl, RouteView } from './view-model.ts';
import { createConfirmation } from './confirmation.ts';
import { hasEffect, isUnresolved, latestAttempt } from './dispatch.ts';
import { FAKE_RECEIVER_LABEL } from './eligibility.ts';
import { findDestination } from './host-catalog.ts';
import { dispatchLifecycle } from './lifecycle.ts';
import { collectRouteSources, createRouteSwitchAcknowledgement, routeSourceKey, selectedRouteOf } from './route-fence.ts';
import { confirmationView, destinationRows, dispatchStatus, evidenceRow, lifecycleView, newThreadControl, routeView, shortDigest } from './view-model.ts';

/** Other routes that already took this packet. Sending here needs the owner's explicit acknowledgement. */
export interface RouteHistoryView {
  readonly required: boolean;
  readonly labels: readonly string[];
  readonly acknowledged: boolean;
}

export interface ConnectorView {
  readonly resolveUnknown: { readonly available: boolean; readonly reason: string | null; readonly confirming: boolean };
  readonly packetLabel: string | null;
  readonly rows: readonly DestinationRow[];
  readonly selectedId: DestinationId | null;
  readonly newThread: NewThreadControl;
  readonly confirmation: ConfirmationView | null;
  readonly sendEnabled: boolean;
  readonly sendDisabledReason: string | null;
  readonly busy: boolean;
  readonly status: DispatchStatusView | null;
  readonly message: string | null;
  readonly evidence: readonly EvidenceRow[];
  /** Lifecycle stage of the current dispatch; null until a packet and destination are chosen. */
  readonly lifecycle: LifecycleView | null;
  /** The chosen or pinned route, with freshness and the no-fallback statement. */
  readonly route: RouteView | null;
  readonly routeHistory: RouteHistoryView;
  /** Shown whenever the selected destination or current dispatch uses the labelled fake. */
  readonly fakeBanner: string | null;
}

export interface ConnectorController {
  requestResolveUnknown(): void;
  confirmResolveUnknown(): Promise<ResolveUnknownResult | null>;
  /** Stable snapshot; a new object only after a change is emitted. */
  view(): ConnectorView;
  /** Re-read the catalog and dispatch state after an external change (for example a catalog refresh). */
  refresh(): Promise<void>;
  subscribe(listener: () => void): () => void;
  setPacket(packet: PacketInput | null): Promise<void>;
  select(destinationId: DestinationId): Promise<void>;
  /** Opens the confirmation card with the destination identity as shown now. Never sends. */
  requestSend(): void;
  cancel(): void;
  confirm(): Promise<SubmitResult | null>;
  /** Owner's explicit acknowledgement of the route history shown; cleared by any selection change. */
  acknowledgeRouteHistory(acknowledged: boolean): void;
  /** Read-only status check of the current dispatch: outbox readback, then evidence readback. Never sends. */
  checkStatus(): Promise<void>;
}

export interface ConnectorControllerOptions {
  readonly outbox: Outbox;
  readonly transports: TransportRegistry;
  readonly clock: Clock;
  readonly getCatalog: () => HostCatalog;
  readonly evidence?: EvidenceStorePort;
  /** When given, new returned evidence for the current dispatch refreshes the view. */
  readonly evidenceFeed?: EvidenceFeedPort;
  /** Pre-bound read-only evidence readback (see `readbackEvidence`). It has no access to send. */
  readonly readEvidence?: (dispatchId: DispatchId) => Promise<EvidenceReadbackReport>;
  /** Owner-recorded manual handoffs; a packet with history needs an acknowledgement to send here. */
  readonly manualHandoffs?: ManualHandoffHistoryPort;
  readonly newConfirmationId?: () => string;
}

export function createConnectorController(options: ConnectorControllerOptions): ConnectorController {
  let packet: PacketInput | null = null;
  let selectedId: DestinationId | null = null;
  let pending: Destination | null = null;
  let busy = false;
  let pendingResolution: DispatchRecord | null = null;
  let record: DispatchRecord | null = null;
  let evidence: readonly EvidenceEntry[] = [];
  let message: string | null = null;
  let manual: readonly ManualHandoffRecord[] = [];
  let routeSources: readonly RouteSource[] = [];
  let historyError: string | null = null;
  /** Route-source keys the owner acknowledged; a source that appears later is not covered. */
  let acknowledgedKeys: ReadonlySet<string> | null = null;
  let stopFeed: (() => void) | null = null;
  let cached: ConnectorView | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    cached = null;
    for (const listener of listeners) listener();
  };

  const selected = (): Destination | null =>
    selectedId ? findDestination(options.getCatalog(), selectedId) : null;

  async function load(): Promise<void> {
    const destination = selected();
    acknowledgedKeys = null;
    if (!packet || !destination) {
      record = null;
      evidence = [];
      manual = [];
      routeSources = [];
      historyError = null;
      return;
    }
    const dispatchId = await options.outbox.dispatchIdFor(packet, destination);
    record = await options.outbox.get(dispatchId);
    evidence = options.evidence && record ? await options.evidence.listByDispatch(dispatchId) : [];
    historyError = null;
    try {
      manual = options.manualHandoffs ? await options.manualHandoffs.listForPacket(packet.packetId) : [];
    } catch {
      manual = [];
      historyError = 'The manual handoff history could not be read, so sending is paused.';
    }
    routeSources = collectRouteSources({
      packetId: packet.packetId, destinationId: destination.destinationId,
      dispatches: await options.outbox.list(), manualHandoffs: manual,
    });
  }

  /** True only when every current route source was among those the owner acknowledged. */
  function routeCovered(): boolean {
    const keys = acknowledgedKeys;
    return keys !== null && routeSources.length > 0 && routeSources.every((source) => keys.has(routeSourceKey(source)));
  }

  /** Reload without discarding the owner's acknowledgement; used for background evidence changes. */
  async function reloadKeepingAcknowledgement(): Promise<void> {
    const kept = acknowledgedKeys;
    await load();
    acknowledgedKeys = kept;
  }

  function sendGate(rows: readonly DestinationRow[]): string | null {
    if (!packet) return 'Freeze a request first.';
    const row = rows.find((item) => item.destinationId === selectedId);
    if (!row) return 'Choose a destination.';
    if (!row.selectable) return row.disabledReason;
    if (busy) return 'Sending…';
    if (historyError) return historyError;
    const latest = record ? latestAttempt(record) : null;
    if (latest && isUnresolved(latest.state)) return 'The last attempt has an unknown effect. Check status first.';
    if (latest && hasEffect(latest.state)) return 'The receiver already has this request.';
    return null;
  }

  function computeView(): ConnectorView {
    const catalog = options.getCatalog();
    const rows = destinationRows(catalog, options.transports);
    const gate = sendGate(rows);
    const status = record ? dispatchStatus(record) : null;
    const current = selected();
    const fake = current?.endpoint.transport === 'fake-receiver' || status?.fake === true;
    const lifecycle: DispatchLifecycle | null = packet && current
      ? dispatchLifecycle(record, evidence, { catalogDestination: current, manualHandoffs: manual })
      : null;
    return {
      packetLabel: packet ? `${packet.packetId} · ${shortDigest(packet.packetDigest)}` : null,
      rows,
      selectedId,
      newThread: newThreadControl(rows),
      resolveUnknown: { available: resolveUnknownReason(record, options.transports, busy) === null, reason: resolveUnknownReason(record, options.transports, busy), confirming: pendingResolution !== null },
      confirmation: pending && packet
        ? confirmationView(createConfirmation({ packet, destination: pending, clock: options.clock, newId: () => 'preview' }), pending)
        : null,
      sendEnabled: gate === null,
      sendDisabledReason: gate,
      busy,
      status,
      message,
      evidence: evidence.map(evidenceRow),
      lifecycle: lifecycle ? lifecycleView(lifecycle) : null,
      route: lifecycle?.route ? routeView(lifecycle.route) : current ? routeView(selectedRouteOf(current)) : null,
      routeHistory: {
        required: routeSources.length > 0,
        labels: routeSources.map((source) => source.kind === 'manual'
          ? `Handed off manually (${source.recordedAt})`
          : `Already ${source.state} through another destination (${source.destinationId})`),
        acknowledged: routeCovered(),
      },
      fakeBanner: fake ? `${FAKE_RECEIVER_LABEL}. Nothing is sent to a real Jones receiver.` : null,
    };
  }

  return {
    requestResolveUnknown() {
      if (resolveUnknownReason(record, options.transports, busy) !== null) return;
      pending = null;
      pendingResolution = record;
      message = null;
      emit();
    },
    async confirmResolveUnknown() {
      if (busy || !pendingResolution) return null;
      const shown = pendingResolution;
      pendingResolution = null;
      busy = true;
      emit();
      try {
        const result = await options.outbox.resolveUnknown({
          dispatchId: shown.dispatchId,
          confirmation: createResolveUnknownConfirmation(shown, options.clock),
        });
        message = result.outcome === 'resolved' ? result.detail : result.reason;
        return result;
      } finally {
        busy = false;
        await load();
        emit();
      }
    },
    view() {
      cached ??= computeView();
      return cached;
    },
    async refresh() {
      await load();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (options.evidenceFeed && !stopFeed) {
        stopFeed = options.evidenceFeed.subscribe((change) => {
          if (record?.dispatchId !== change.dispatchId) return;
          void reloadKeepingAcknowledgement().then(emit, () => {});
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && stopFeed) {
          stopFeed();
          stopFeed = null;
        }
      };
    },
    acknowledgeRouteHistory(acknowledged) {
      if (busy || routeSources.length === 0) return;
      acknowledgedKeys = acknowledged ? new Set(routeSources.map(routeSourceKey)) : null;
      emit();
    },
    async setPacket(next) {
      packet = next;
      pending = null;
      pendingResolution = null;
      message = null;
      await load();
      emit();
    },
    async select(destinationId) {
      if (busy) return;
      selectedId = destinationId;
      pending = null;
      pendingResolution = null;
      message = null;
      await load();
      emit();
    },
    requestSend() {
      const rows = destinationRows(options.getCatalog(), options.transports);
      if (sendGate(rows) !== null) return;
      pendingResolution = null;
      pending = selected();
      emit();
    },
    cancel() {
      pending = null;
      pendingResolution = null;
      acknowledgedKeys = null;
      emit();
    },
    async confirm() {
      if (busy || !pending || !packet) return null;
      busy = true;
      const shown = pending;
      pending = null;
      pendingResolution = null;
      emit();
      try {
        // The confirmation binds the identity the owner saw; the outbox compares it with the catalog now.
        const confirmation = createConfirmation({
          packet, destination: shown, clock: options.clock,
          ...(options.newConfirmationId ? { newId: options.newConfirmationId } : {}),
        });
        const current = findDestination(options.getCatalog(), shown.destinationId) ?? shown;
        const routeSwitch = routeCovered()
          ? createRouteSwitchAcknowledgement({ confirmation, sources: routeSources, clock: options.clock })
          : undefined;
        const result = await options.outbox.submit({ packet, destination: current, confirmation, ...(routeSwitch ? { routeSwitch } : {}) });
        message = result.outcome === 'refused' || result.outcome === 'persist-failed' ? result.reason : null;
        return result;
      } finally {
        busy = false;
        await load();
        emit();
      }
    },
    async checkStatus() {
      if (!record || busy) return;
      busy = true;
      emit();
      try {
        const dispatchId = record.dispatchId;
        const [report] = await options.outbox.reconcile(dispatchId);
        message = report ? `Status check: ${report.detail}.` : null;
        if (options.readEvidence) {
          const evidenceReport = await options.readEvidence(dispatchId);
          message = `${message ?? 'Status check:'} Evidence: ${evidenceReport.detail}.`;
        }
      } finally {
        busy = false;
        await load();
        emit();
      }
    },
  };
}

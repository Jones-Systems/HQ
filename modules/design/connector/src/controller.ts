/**
 * Framework-free connector controller: the composition entry the React panel
 * (and root) drive. Selecting a destination or opening the confirmation never
 * sends; only `confirm()` calls the outbox, and only once at a time.
 */

import type { Clock, EvidenceStorePort, TransportRegistry } from './contract.ts';
import type { DispatchRecord } from './dispatch.ts';
import type { EvidenceEntry } from './evidence.ts';
import type { Destination, HostCatalog } from './host-catalog.ts';
import type { DestinationId } from './ids.ts';
import type { Outbox, PacketInput, SubmitResult } from './outbox.ts';
import type { ConfirmationView, DestinationRow, DispatchStatusView, EvidenceRow, NewThreadControl } from './view-model.ts';
import { createConfirmation } from './confirmation.ts';
import { hasEffect, isUnresolved, latestAttempt } from './dispatch.ts';
import { FAKE_RECEIVER_LABEL } from './eligibility.ts';
import { findDestination } from './host-catalog.ts';
import { confirmationView, destinationRows, dispatchStatus, evidenceRow, newThreadControl, shortDigest } from './view-model.ts';

export interface ConnectorView {
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
  /** Shown whenever the selected destination or current dispatch uses the labelled fake. */
  readonly fakeBanner: string | null;
}

export interface ConnectorController {
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
  /** Read-only status check of the current dispatch. */
  checkStatus(): Promise<void>;
}

export interface ConnectorControllerOptions {
  readonly outbox: Outbox;
  readonly transports: TransportRegistry;
  readonly clock: Clock;
  readonly getCatalog: () => HostCatalog;
  readonly evidence?: EvidenceStorePort;
  readonly newConfirmationId?: () => string;
}

export function createConnectorController(options: ConnectorControllerOptions): ConnectorController {
  let packet: PacketInput | null = null;
  let selectedId: DestinationId | null = null;
  let pending: Destination | null = null;
  let busy = false;
  let record: DispatchRecord | null = null;
  let evidence: readonly EvidenceEntry[] = [];
  let message: string | null = null;
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
    if (!packet || !destination) {
      record = null;
      evidence = [];
      return;
    }
    const dispatchId = await options.outbox.dispatchIdFor(packet, destination);
    record = await options.outbox.get(dispatchId);
    evidence = options.evidence && record ? await options.evidence.listByDispatch(dispatchId) : [];
  }

  function sendGate(rows: readonly DestinationRow[]): string | null {
    if (!packet) return 'Freeze a request first.';
    const row = rows.find((item) => item.destinationId === selectedId);
    if (!row) return 'Choose a destination.';
    if (!row.selectable) return row.disabledReason;
    if (busy) return 'Sending…';
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
    return {
      packetLabel: packet ? `${packet.packetId} · ${shortDigest(packet.packetDigest)}` : null,
      rows,
      selectedId,
      newThread: newThreadControl(),
      confirmation: pending && packet
        ? confirmationView(createConfirmation({ packet, destination: pending, clock: options.clock, newId: () => 'preview' }), pending)
        : null,
      sendEnabled: gate === null,
      sendDisabledReason: gate,
      busy,
      status,
      message,
      evidence: evidence.map(evidenceRow),
      fakeBanner: fake ? `${FAKE_RECEIVER_LABEL}. Nothing is sent to a real Jones receiver.` : null,
    };
  }

  return {
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
      return () => { listeners.delete(listener); };
    },
    async setPacket(next) {
      packet = next;
      pending = null;
      message = null;
      await load();
      emit();
    },
    async select(destinationId) {
      if (busy) return;
      selectedId = destinationId;
      pending = null;
      message = null;
      await load();
      emit();
    },
    requestSend() {
      const rows = destinationRows(options.getCatalog(), options.transports);
      if (sendGate(rows) !== null) return;
      pending = selected();
      emit();
    },
    cancel() {
      pending = null;
      emit();
    },
    async confirm() {
      if (busy || !pending || !packet) return null;
      busy = true;
      const shown = pending;
      pending = null;
      emit();
      try {
        // The confirmation binds the identity the owner saw; the outbox compares it with the catalog now.
        const confirmation = createConfirmation({
          packet, destination: shown, clock: options.clock,
          ...(options.newConfirmationId ? { newId: options.newConfirmationId } : {}),
        });
        const current = findDestination(options.getCatalog(), shown.destinationId) ?? shown;
        const result = await options.outbox.submit({ packet, destination: current, confirmation });
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
        const [report] = await options.outbox.reconcile(record.dispatchId);
        message = report ? `Status check: ${report.detail}.` : null;
      } finally {
        busy = false;
        await load();
        emit();
      }
    },
  };
}

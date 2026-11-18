/**
 * Read-only evidence readback and lifecycle reading.
 *
 * `readbackEvidence` can call only `EvidenceReadbackPort.readEvidence`. Each
 * port is re-wrapped so even a transport object with a `send` method passed in
 * by mistake exposes no `send` or `identify` here. Whatever the receiver
 * returns is untrusted and goes through the same strict intake as any other
 * evidence; nothing is ever sent, and the dispatch record is never written.
 */

import type { Clock, EvidenceChange, EvidenceFeedPort, EvidenceReadbackOutcome, EvidenceReadbackPort, EvidenceReadbackRegistry, EvidenceStorePort, OutboxStorePort } from './contract.ts';
import type { DispatchRecord } from './dispatch.ts';
import type { DispatchLifecycle } from './lifecycle.ts';
import type { HostCatalog } from './host-catalog.ts';
import type { EvidenceRejection } from './evidence.ts';
import type { DispatchId } from './ids.ts';
import type { ManualHandoffHistoryPort } from './route-fence.ts';
import { hasEffect, latestAttempt } from './dispatch.ts';
import { intakeEvidence } from './evidence.ts';
import { findDestination } from './host-catalog.ts';
import { dispatchLifecycle } from './lifecycle.ts';
import { errorText, withTimeout } from './timeout.ts';

export type EvidenceReadbackResult =
  | 'ingested'
  | 'nothing-new'
  | 'not-applicable'
  | 'no-readback-port'
  | 'unknown-dispatch'
  | 'unavailable';

export interface EvidenceReadbackReport {
  readonly dispatchId: DispatchId;
  readonly result: EvidenceReadbackResult;
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: readonly { readonly code: EvidenceRejection; readonly detail: string }[];
  readonly detail: string;
}

export interface EvidenceReadbackOptions {
  readonly outbox: Pick<OutboxStorePort, 'get'>;
  readonly evidence: EvidenceStorePort;
  readonly readback: EvidenceReadbackRegistry;
  readonly clock: Clock;
  readonly timeoutMs?: number;
}

/** Only `descriptor` and `readEvidence` survive; there is nothing here to send with. */
function readOnly(port: EvidenceReadbackPort): EvidenceReadbackPort {
  return { descriptor: port.descriptor, readEvidence: (query, signal) => port.readEvidence(query, signal) };
}

/**
 * Ask the receiver for returned evidence of the dispatch's latest attempt and
 * ingest what validates. Applicable only when the receiver holds the handoff
 * (accepted or held); an unknown or submitting attempt is reconciled by the
 * outbox first, never by evidence.
 */
export async function readbackEvidence(options: EvidenceReadbackOptions, dispatchId: DispatchId): Promise<EvidenceReadbackReport> {
  const report = (result: EvidenceReadbackResult, detail: string, extra: Partial<Pick<EvidenceReadbackReport, 'accepted' | 'duplicates' | 'rejected'>> = {}): EvidenceReadbackReport =>
    ({ dispatchId, result, accepted: 0, duplicates: 0, rejected: [], detail, ...extra });

  const stored = await options.outbox.get(dispatchId);
  if (!stored) return report('unknown-dispatch', 'no dispatch with this ID');
  const attempt = latestAttempt(stored.record);
  if (!attempt || !hasEffect(attempt.state) || !attempt.receipt) {
    return report('not-applicable', `evidence is read back only once the receiver holds the handoff (attempt is ${attempt?.state ?? 'absent'})`);
  }
  const port = options.readback[stored.record.destination.transport];
  if (!port) return report('no-readback-port', 'no evidence readback port for this destination');

  const readonlyPort = readOnly(port);
  const query = {
    endpoint: { transport: stored.record.destination.transport, locator: stored.record.destination.locator },
    dispatchId, attemptId: attempt.attemptId, idempotencyKey: attempt.idempotencyKey, receiptId: attempt.receipt.receiptId,
  };
  let outcome: EvidenceReadbackOutcome;
  try {
    outcome = await withTimeout(options.timeoutMs ?? 10_000, (signal) => readonlyPort.readEvidence(query, signal));
  } catch (error) {
    return report('unavailable', `evidence readback failed (${errorText(error)})`);
  }
  if (outcome.kind === 'unavailable') return report('unavailable', `evidence readback unavailable: ${outcome.detail}`);
  if (outcome.kind !== 'found' || !Array.isArray(outcome.documents)) return report('nothing-new', 'receiver reported no evidence yet');

  let accepted = 0;
  let duplicates = 0;
  const rejected: { code: EvidenceRejection; detail: string }[] = [];
  for (const document of outcome.documents) {
    const result = await intakeEvidence({ outbox: options.outbox, evidence: options.evidence, clock: options.clock }, document);
    if (!result.ok) rejected.push({ code: result.code, detail: result.detail });
    else if (result.duplicate) duplicates += 1;
    else accepted += 1;
  }
  const detail = `${accepted} new, ${duplicates} already held, ${rejected.length} rejected`;
  return report(accepted > 0 ? 'ingested' : 'nothing-new', detail, { accepted, duplicates, rejected });
}

// ── Lifecycle reader ─────────────────────────────────────────────────────────

export interface LifecycleChange {
  readonly dispatchId: DispatchId;
  readonly lifecycle: DispatchLifecycle;
}

export interface LifecycleReaderOptions {
  readonly store: Pick<OutboxStorePort, 'get' | 'list'>;
  readonly feed: EvidenceFeedPort;
  /** When given, freshness and drift of each pinned route are shown against the catalog now. */
  readonly getCatalog?: () => HostCatalog;
  readonly manualHandoffs?: ManualHandoffHistoryPort;
}

export interface LifecycleReader {
  get(dispatchId: DispatchId): Promise<DispatchLifecycle | null>;
  list(): Promise<readonly DispatchLifecycle[]>;
  /** Notified after each new evidence entry, with the recomputed lifecycle of its dispatch. */
  subscribe(listener: (change: LifecycleChange) => void): () => void;
}

export function createLifecycleReader(options: LifecycleReaderOptions): LifecycleReader {
  async function project(record: DispatchRecord): Promise<DispatchLifecycle> {
    const evidence = await options.feed.list({ dispatchId: record.dispatchId });
    const manualHandoffs = options.manualHandoffs ? await options.manualHandoffs.listForPacket(record.packet.packetId) : [];
    const catalog = options.getCatalog?.();
    return dispatchLifecycle(record, evidence, {
      manualHandoffs,
      ...(catalog ? { catalogDestination: findDestination(catalog, record.destination.destinationId) } : {}),
    });
  }
  return {
    async get(dispatchId) {
      const stored = await options.store.get(dispatchId);
      return stored ? project(stored.record) : null;
    },
    async list() {
      const all = await options.store.list();
      return Promise.all(all.map((item) => project(item.record)));
    },
    subscribe(listener) {
      let active = true;
      const stop = options.feed.subscribe((change: EvidenceChange) => {
        void (async () => {
          const stored = await options.store.get(change.dispatchId);
          if (!stored || !active) return;
          const lifecycle = await project(stored.record);
          if (active) listener({ dispatchId: change.dispatchId, lifecycle });
        })().catch(() => {});
      });
      return () => {
        active = false;
        stop();
      };
    },
  };
}

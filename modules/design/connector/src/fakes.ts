/**
 * LABELLED FAKES. Nothing here reaches Jones or any external system.
 *
 * The fake receiver models an idempotent receiver with an authoritative
 * ledger so the local loop can be exercised end to end. Its descriptor,
 * receipts and evidence all carry fake provenance, and eligibility refuses to
 * treat it as a real Jones transport.
 */

import type { Clock, EvidenceChange, EvidenceFeedPort, EvidenceReadbackOutcome, EvidenceReadbackPort, EvidenceReadbackQuery, EvidenceStorePort, FenceOutcome, Handoff, LookupOutcome, ObservedIdentity, OutboxStorePort, PutResult, SendOutcome, StoredDispatch, TransportDescriptor, TransportPort } from './contract.ts';
import type { DispatchRecord, Receipt } from './dispatch.ts';
import type { EvidenceEntry, ResultEvidence } from './evidence.ts';
import type { Destination, DestinationEndpoint, DestinationMode, HostCatalog, ModelPin } from './host-catalog.ts';
import type { DestinationId, DispatchId, EvidenceId, HostId, PacketId, ReceiptId, ReceiverId, ThreadRef } from './ids.ts';
import type { ManualHandoffHistoryPort, ManualHandoffRecord } from './route-fence.ts';
import type { Digest } from './canonical.ts';
import { digestOf } from './canonical.ts';
import { FAKE_RECEIVER_LABEL } from './eligibility.ts';
import { HOST_CATALOG_SCHEMA } from './host-catalog.ts';
import { RESULT_EVIDENCE_SCHEMA } from './evidence.ts';

export { FAKE_RECEIVER_LABEL };

// ── Shared trace for ordering assertions ─────────────────────────────────────

export interface TraceEvent {
  readonly seq: number;
  readonly actor: 'store' | 'transport';
  readonly op: string;
}

export interface Trace {
  readonly events: readonly TraceEvent[];
  push(actor: TraceEvent['actor'], op: string): void;
}

export function createTrace(): Trace {
  const events: TraceEvent[] = [];
  return { events, push: (actor, op) => { events.push({ seq: events.length, actor, op }); } };
}

// ── Clock ────────────────────────────────────────────────────────────────────

export interface FakeClock extends Clock {
  advance(ms: number): void;
}

export function createFakeClock(start = Date.parse('2026-01-01T00:00:00.000Z')): FakeClock {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

// ── Fake receiver ────────────────────────────────────────────────────────────

export type FakeSendFault =
  | 'throw-before-effect'
  | 'throw-after-effect'
  | 'hang-before-effect'
  | 'hang-after-effect'
  | 'reject'
  | 'hold'
  | 'malformed'
  | 'substitute-model'
  | 'substitute-host';

/** authoritative: absent keys are fenced and reported no-effect; absence-only: plain not-found; unavailable: readback fails. */
export type FakeLookupMode = 'authoritative' | 'absence-only' | 'unavailable';

export type FakeFenceMode = 'authoritative' | 'unavailable' | 'throw' | 'timeout' | 'malformed';

export interface FakeReceiver extends TransportPort, EvidenceReadbackPort {
  /** Effects: handoffs the receiver durably took (accepted or held). */
  readonly handoffs: readonly Handoff[];
  readonly calls: { readonly identify: number; readonly send: number; readonly lookup: number };
  /** Evidence readbacks served; kept out of `calls` so that v1 shape is unchanged. */
  evidenceReads(): number;
  fenceCalls(): number;
  setFenceMode(mode: FakeFenceMode): void;
  failNextSend(fault: FakeSendFault): void;
  setLookupMode(mode: FakeLookupMode): void;
  setIdentity(identity: ObservedIdentity): void;
  /** Mark a held receipt accepted, as a later receiver-side decision would. */
  promoteHeld(idempotencyKey: string): void;
  receiptFor(idempotencyKey: string): Receipt | null;
  /** Make raw evidence documents available to `readEvidence` for one idempotency key (replaces earlier ones). */
  returnEvidence(idempotencyKey: string, documents: readonly unknown[]): void;
}

export function createFakeReceiver(options: {
  readonly identity: ObservedIdentity;
  readonly clock: Clock;
  readonly trace?: Trace;
  readonly modes?: readonly DestinationMode[];
}): FakeReceiver {
  const descriptor: TransportDescriptor = {
    ...(options.modes ? { modes: options.modes } : {}),
    kind: 'fake-receiver',
    label: FAKE_RECEIVER_LABEL,
    provenance: 'fake',
    qualification: { level: 'labelled-fake', label: FAKE_RECEIVER_LABEL },
  };
  let identity = options.identity;
  let lookupMode: FakeLookupMode = 'authoritative';
  let nextFault: FakeSendFault | null = null;
  const handoffs: Handoff[] = [];
  const ledger = new Map<string, Receipt>();
  const fenced = new Set<string>();
  const evidenceLedger = new Map<string, readonly unknown[]>();
  const calls = { identify: 0, send: 0, lookup: 0 };
  let evidenceReads = 0;
  let fenceCalls = 0;
  let fenceMode: FakeFenceMode = 'authoritative';
  const at = () => new Date(options.clock.now()).toISOString();

  function record(handoff: Handoff, status: Receipt['status'], overrides: { model?: ModelPin | null; hostId?: HostId } = {}): Receipt {
    const receipt: Receipt = {
      receiptId: `rcpt_fake_${ledger.size + 1}` as ReceiptId,
      idempotencyKey: handoff.idempotencyKey,
      status,
      observedHostId: overrides.hostId ?? identity.hostId,
      observedReceiverId: identity.receiverId,
      observedModel: overrides.model === undefined ? handoff.destination.model : overrides.model,
      at: at(),
      provenance: 'fake',
      ...(status === 'held' ? { reason: 'fake receiver hold' } : {}),
    };
    ledger.set(handoff.idempotencyKey, receipt);
    handoffs.push(handoff);
    return receipt;
  }

  const never = new Promise<never>(() => {});

  return {
    descriptor,
    handoffs,
    calls,
    evidenceReads: () => evidenceReads,
    fenceCalls: () => fenceCalls,
    setFenceMode(mode) { fenceMode = mode; },
    async fence(query): Promise<FenceOutcome> {
      fenceCalls += 1;
      options.trace?.push('transport', 'fence');
      if (fenceMode === 'throw') throw new Error('fake fence failure');
      if (fenceMode === 'timeout') return never;
      if (fenceMode === 'malformed') return { kind: 'rejected' } as unknown as FenceOutcome;
      if (fenceMode === 'unavailable') return { kind: 'unavailable', detail: 'fake fence unavailable' };
      const receipt = ledger.get(query.idempotencyKey);
      if (receipt) return { kind: 'found', receipt };
      fenced.add(query.idempotencyKey);
      return { kind: 'no-effect', basis: 'labelled fake fence; key permanently disabled' };
    },
    failNextSend(fault) { nextFault = fault; },
    setLookupMode(mode) { lookupMode = mode; },
    setIdentity(value) { identity = value; },
    promoteHeld(key) {
      const receipt = ledger.get(key);
      if (receipt && receipt.status === 'held') ledger.set(key, { ...receipt, status: 'accepted' });
    },
    receiptFor(key) { return ledger.get(key) ?? null; },
    returnEvidence(key, documents) { evidenceLedger.set(key, structuredClone(documents)); },

    async identify(_endpoint: DestinationEndpoint): Promise<ObservedIdentity> {
      calls.identify += 1;
      options.trace?.push('transport', 'identify');
      return identity;
    },

    async send(handoff: Handoff): Promise<SendOutcome> {
      calls.send += 1;
      options.trace?.push('transport', 'send');
      const fault = nextFault;
      nextFault = null;
      if (fenced.has(handoff.idempotencyKey)) return { kind: 'rejected', reason: 'idempotency key fenced after no-effect readback' };
      const prior = ledger.get(handoff.idempotencyKey);
      if (prior) return { kind: prior.status, receipt: prior };
      switch (fault) {
        case 'throw-before-effect': throw new Error('fake transport fault before effect');
        case 'throw-after-effect': record(handoff, 'accepted'); throw new Error('fake transport fault after effect');
        case 'hang-before-effect': return never;
        case 'hang-after-effect': record(handoff, 'accepted'); return never;
        case 'reject': return { kind: 'rejected', reason: 'fake receiver rejected the handoff' };
        case 'hold': return { kind: 'held', receipt: record(handoff, 'held') };
        case 'malformed': return { kind: 'ok' } as unknown as SendOutcome;
        case 'substitute-model': return { kind: 'accepted', receipt: record(handoff, 'accepted', { model: { provider: 'fake', model: 'substituted-model' } }) };
        case 'substitute-host': return { kind: 'accepted', receipt: record(handoff, 'accepted', { hostId: 'host.fake-substitute' as HostId }) };
        case null: return { kind: 'accepted', receipt: record(handoff, 'accepted') };
      }
    },

    async lookup(query: { readonly idempotencyKey: string }): Promise<LookupOutcome> {
      calls.lookup += 1;
      options.trace?.push('transport', 'lookup');
      if (lookupMode === 'unavailable') return { kind: 'unavailable', detail: 'fake readback unavailable' };
      const receipt = ledger.get(query.idempotencyKey);
      if (receipt) return { kind: 'found', receipt };
      if (lookupMode === 'absence-only') return { kind: 'not-found' };
      // Authoritative: fence the key so a delayed delivery can never take effect later.
      fenced.add(query.idempotencyKey);
      return { kind: 'no-effect', basis: 'fake ledger has no entry; key fenced' };
    },

    async readEvidence(query: EvidenceReadbackQuery): Promise<EvidenceReadbackOutcome> {
      evidenceReads += 1;
      options.trace?.push('transport', 'readEvidence');
      if (lookupMode === 'unavailable') return { kind: 'unavailable', detail: 'fake readback unavailable' };
      const documents = evidenceLedger.get(query.idempotencyKey);
      return documents && documents.length > 0 ? { kind: 'found', documents: structuredClone(documents) } : { kind: 'none-yet' };
    },
  };
}

// ── Stores ───────────────────────────────────────────────────────────────────

export type PutFault = 'throw-before-write' | 'throw-after-write';

export interface MemoryOutboxStore extends OutboxStorePort {
  /** Shared backing map; pass it to a new store to simulate a process restart. */
  readonly backing: Map<string, StoredDispatch>;
  /** Fail the next put whose record's latest attempt is in `state` (any state when omitted). */
  failNextPut(fault: PutFault, state?: string): void;
}

export function createMemoryOutboxStore(options: { readonly backing?: Map<string, StoredDispatch>; readonly trace?: Trace } = {}): MemoryOutboxStore {
  const backing = options.backing ?? new Map<string, StoredDispatch>();
  let fault: { kind: PutFault; state: string | undefined } | null = null;
  const copy = <T>(value: T): T => structuredClone(value);
  return {
    backing,
    failNextPut(kind, state) { fault = { kind, state }; },
    async get(dispatchId: DispatchId) {
      const stored = backing.get(dispatchId);
      return stored ? copy(stored) : null;
    },
    async list() {
      return [...backing.values()].map(copy);
    },
    async put(record: DispatchRecord, expectedRevision: number | null): Promise<PutResult> {
      const state = record.attempts.at(-1)?.state ?? 'none';
      const armed = fault && (fault.state === undefined || fault.state === state) ? fault : null;
      if (armed) fault = null;
      if (armed?.kind === 'throw-before-write') throw new Error('fake store fault before write');
      const current = backing.get(record.dispatchId) ?? null;
      if ((current?.revision ?? null) !== expectedRevision) return { ok: false, reason: 'conflict', current: current ? copy(current) : null };
      const revision = (current?.revision ?? 0) + 1;
      backing.set(record.dispatchId, { revision, record: copy(record) });
      options.trace?.push('store', `put:${state}`);
      if (armed?.kind === 'throw-after-write') throw new Error('fake store fault after write (acknowledgement lost)');
      return { ok: true, revision };
    },
  };
}

export interface MemoryEvidenceStore extends EvidenceStorePort, EvidenceFeedPort {
  readonly entries: readonly EvidenceEntry[];
}

/** Append-only fake evidence store that also serves the read-only feed (list and subscribe). */
export function createMemoryEvidenceStore(): MemoryEvidenceStore {
  const entries: EvidenceEntry[] = [];
  const listeners = new Set<(change: EvidenceChange) => void>();
  return {
    entries,
    async get(evidenceId: EvidenceId) {
      const found = entries.find((entry) => entry.evidence.evidenceId === evidenceId);
      return found ? structuredClone(found) : null;
    },
    async append(entry: EvidenceEntry) {
      if (entries.some((item) => item.evidence.evidenceId === entry.evidence.evidenceId)) return 'exists';
      entries.push(structuredClone(entry));
      const change: EvidenceChange = { kind: 'appended', evidenceId: entry.evidence.evidenceId, dispatchId: entry.evidence.dispatchId };
      for (const listener of [...listeners]) {
        try {
          listener(change);
        } catch {
          // A faulty listener must not affect the append or other listeners.
        }
      }
      return 'appended';
    },
    async listByDispatch(dispatchId: DispatchId) {
      return entries.filter((entry) => entry.evidence.dispatchId === dispatchId).map((entry) => structuredClone(entry));
    },
    async list(query) {
      return entries
        .filter((entry) => query?.dispatchId === undefined || entry.evidence.dispatchId === query.dispatchId)
        .map((entry) => structuredClone(entry));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** Fake read-only manual handoff history, standing in for the requests-owned record. */
export function createMemoryManualHandoffHistory(initial: readonly ManualHandoffRecord[] = []): ManualHandoffHistoryPort & {
  readonly records: ManualHandoffRecord[];
  failNextRead(): void;
  readonly reads: () => number;
} {
  const records = [...initial];
  let failing = false;
  let reads = 0;
  return {
    records,
    reads: () => reads,
    failNextRead() { failing = true; },
    async listForPacket(packetId: PacketId) {
      reads += 1;
      if (failing) {
        failing = false;
        throw new Error('fake manual history read fault');
      }
      return records.filter((record) => record.packetId === packetId).map((record) => structuredClone(record));
    },
  };
}

export function syntheticManualHandoff(packet: { readonly packetId: PacketId; readonly packetDigest: Digest }, recordId = 'manual.synthetic-1', recordedAt = '2026-01-01T00:00:00.000Z'): ManualHandoffRecord {
  return { recordId, packetId: packet.packetId, packetDigest: packet.packetDigest, recordedAt };
}

// ── Synthetic fixtures ───────────────────────────────────────────────────────

export const SYNTHETIC_HOST = 'host.synthetic-laptop' as HostId;
export const SYNTHETIC_RECEIVER = 'receiver.synthetic-fake' as ReceiverId;
export const SYNTHETIC_FINGERPRINT = 'fp.synthetic-0001';

export function syntheticIdentity(): ObservedIdentity {
  return { hostId: SYNTHETIC_HOST, receiverId: SYNTHETIC_RECEIVER, fingerprint: SYNTHETIC_FINGERPRINT };
}

export function syntheticDestination(overrides: Partial<Destination> = {}): Destination {
  return {
    destinationId: 'dest.fake-existing' as DestinationId,
    label: 'Fake receiver · existing thread',
    endpoint: { transport: 'fake-receiver', locator: 'fake:receiver-1' },
    mode: 'existing-thread',
    identity: { hostId: SYNTHETIC_HOST, receiverId: SYNTHETIC_RECEIVER, fingerprint: SYNTHETIC_FINGERPRINT },
    threadRef: 'thread.synthetic-1' as ThreadRef,
    model: { provider: 'synthetic', model: 'synthetic-model-1' },
    freshness: { status: 'fresh', lastSuccessAt: '2026-01-01T00:00:00.000Z', generation: 1 },
    status: 'reachable',
    ...overrides,
  };
}

/** A synthetic catalog: one eligible fake, one real-Jones entry, one new-thread entry, one stale fake. */
export function syntheticCatalog(): HostCatalog {
  return {
    schema: HOST_CATALOG_SCHEMA,
    generation: 1,
    complete: true,
    observedAt: '2026-01-01T00:00:00.000Z',
    destinations: [
      syntheticDestination(),
      syntheticDestination({
        destinationId: 'dest.jones-existing' as DestinationId,
        label: 'Jones Code · existing thread',
        endpoint: { transport: 'jones-code', locator: 'jones:receiver-synthetic' },
        identity: { hostId: SYNTHETIC_HOST, receiverId: 'receiver.synthetic-jones' as ReceiverId, fingerprint: 'fp.synthetic-jones' },
      }),
      (() => {
        const { threadRef: _unused, ...rest } = syntheticDestination({
          destinationId: 'dest.jones-new' as DestinationId,
          label: 'Jones Code · new thread',
          endpoint: { transport: 'jones-code', locator: 'jones:receiver-synthetic' },
          mode: 'new-thread',
          identity: { hostId: SYNTHETIC_HOST, receiverId: 'receiver.synthetic-jones' as ReceiverId, fingerprint: 'fp.synthetic-jones' },
        });
        return rest;
      })(),
      syntheticDestination({
        destinationId: 'dest.fake-stale' as DestinationId,
        label: 'Fake receiver · stale',
        endpoint: { transport: 'fake-receiver', locator: 'fake:receiver-2' },
        freshness: { status: 'stale', lastSuccessAt: '2025-12-31T00:00:00.000Z', generation: 1 },
      }),
    ],
  };
}

export interface SyntheticPacket {
  readonly packetId: PacketId;
  readonly packetDigest: Digest;
  readonly body: unknown;
}

export async function syntheticPacket(seed = 'p1'): Promise<SyntheticPacket> {
  const body = { schema: 'hq.design.decision-packet/v1', packetId: `pkt.${seed}`, decisions: [`synthetic decision ${seed}`] };
  return { packetId: `pkt.${seed}` as PacketId, packetDigest: await digestOf(body), body };
}

/** Build returned evidence for an accepted fake receipt; override fields to craft negative cases. */
export function syntheticEvidence(input: {
  readonly dispatchId: DispatchId;
  readonly attemptId: string;
  readonly receipt: Receipt;
  readonly packet: { readonly packetId: PacketId; readonly packetDigest: Digest };
  readonly model: ModelPin | null;
  readonly evidenceId?: string;
}): ResultEvidence {
  return {
    schema: RESULT_EVIDENCE_SCHEMA,
    evidenceId: (input.evidenceId ?? 'ev.synthetic-1') as EvidenceId,
    dispatchId: input.dispatchId,
    attemptId: input.attemptId as ResultEvidence['attemptId'],
    receiptId: input.receipt.receiptId,
    packet: { packetId: input.packet.packetId, packetDigest: input.packet.packetDigest },
    candidate: {
      candidateId: 'cand.synthetic-1' as ResultEvidence['candidate']['candidateId'],
      summary: 'Synthetic candidate from the labelled fake receiver',
      artifacts: [{ digest: `sha256:${'0'.repeat(64)}`, mediaType: 'image/png', bytes: 1024, label: 'synthetic capture' }],
    },
    claimLevel: 'agent-reported',
    execution: {
      status: 'completed', observedAt: input.receipt.at,
      hostId: input.receipt.observedHostId, receiverId: input.receipt.observedReceiverId, model: input.model,
    },
    provenance: 'fake',
  };
}

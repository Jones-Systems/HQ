import type {
  ClockPort, CreateResult, Digest, DispatchSlot, IdKind, IdPort, PacketLink, SchedulerPort, StorageNamespace, StoragePort,
} from './contract.ts';
import { bytesEqual, sha256 } from './jcs.ts';

/**
 * Labelled fakes for tests and unqualified composition. None of them is real
 * storage, time, dispatch or scheduling evidence.
 */
export const FAKE_LABEL = 'labelled-fake' as const;

export const WRITE_STAGES = ['temp-write', 'temp-fsync', 'rename', 'dir-fsync', 'ack'] as const;
export type WriteStage = (typeof WRITE_STAGES)[number];
export type WriteOp = 'write' | 'create' | 'blob' | 'event';

export interface CrashPlan {
  readonly op: WriteOp;
  /** Crash just before this stage runs (`ack`: durable, but the caller never hears back). */
  readonly stage: WriteStage;
  readonly key?: (key: string) => boolean;
}

export class SimulatedCrash extends Error {
  readonly op: WriteOp;
  readonly key: string;
  readonly stage: WriteStage;
  constructor(op: WriteOp, key: string, stage: WriteStage) {
    super(`Simulated crash before ${stage} of ${op} ${key}`);
    this.name = 'SimulatedCrash';
    this.op = op;
    this.key = key;
    this.stage = stage;
  }
}

export class StorageDown extends Error {
  constructor() { super('Storage process crashed; restart() first'); this.name = 'StorageDown'; }
}

const slot = (ns: StorageNamespace, key: string) => `${ns}\u0000${key}`;

/**
 * In-memory StoragePort modelling per-document atomic replacement
 * (temp, fsync, rename, directory fsync). A crash discards torn temp files and,
 * conservatively, every rename whose directory entry was not yet synced. After a crash every call
 * fails until `restart()`, which keeps only durable state.
 */
export class CrashingStorageFake implements StoragePort {
  readonly label = `${FAKE_LABEL}: in-memory StoragePort with crash injection (not real storage)`;
  private durable = new Map<string, Uint8Array>();
  /** Renamed into place but not yet durable. */
  private pending = new Map<string, Uint8Array>();
  private events = new Map<string, Uint8Array[]>();
  private blobs = new Map<Digest, Uint8Array>();
  private plans: CrashPlan[] = [];
  private down = false;
  readonly calls: { op: string; key: string }[] = [];

  crashAt(plan: CrashPlan): void { this.plans.push(plan); }

  restart(): void {
    this.pending.clear();
    this.plans = [];
    this.down = false;
  }

  /** Every write fails without effect (no crash), e.g. disk full. */
  failWrites = false;

  private alive(op: string, key: string): void {
    this.calls.push({ op, key });
    if (this.down) throw new StorageDown();
  }

  private stage(op: WriteOp, key: string, stage: WriteStage): void {
    const index = this.plans.findIndex((plan) => plan.op === op && plan.stage === stage && (plan.key?.(key) ?? true));
    if (index < 0) return;
    this.plans.splice(index, 1);
    this.down = true;
    this.pending.clear();
    throw new SimulatedCrash(op, key, stage);
  }

  private visible(id: string): Uint8Array | undefined { return this.pending.get(id) ?? this.durable.get(id); }

  async readDocument(ns: StorageNamespace, key: string): Promise<Uint8Array | null> {
    this.alive('read', key);
    const bytes = this.visible(slot(ns, key));
    return bytes ? bytes.slice() : null;
  }

  private async replace(op: 'write' | 'create', ns: StorageNamespace, key: string, bytes: Uint8Array): Promise<CreateResult> {
    if (this.failWrites) throw new Error('Simulated write failure (no effect)');
    const copy = bytes.slice();
    this.stage(op, key, 'temp-write');
    this.stage(op, key, 'temp-fsync');
    this.stage(op, key, 'rename');
    const id = slot(ns, key);
    const existing = this.visible(id);
    if (op === 'create' && existing) return bytesEqual(existing, copy) ? 'exists-identical' : 'exists-different';
    this.pending.set(id, copy);
    this.stage(op, key, 'dir-fsync');
    this.pending.delete(id);
    this.durable.set(id, copy);
    this.stage(op, key, 'ack');
    return 'created';
  }

  async writeDocument(ns: StorageNamespace, key: string, bytes: Uint8Array): Promise<void> {
    this.alive('write', key);
    await this.replace('write', ns, key, bytes);
  }

  async createDocument(ns: StorageNamespace, key: string, bytes: Uint8Array): Promise<CreateResult> {
    this.alive('create', key);
    return this.replace('create', ns, key, bytes);
  }

  async listDocuments(ns: StorageNamespace, prefix: string): Promise<readonly string[]> {
    this.alive('list', prefix);
    const start = slot(ns, prefix);
    const keys = new Set<string>();
    for (const id of [...this.durable.keys(), ...this.pending.keys()]) if (id.startsWith(start)) keys.add(id.slice(ns.length + 1));
    return [...keys].sort();
  }

  async putBlob(bytes: Uint8Array): Promise<Digest> {
    const digest = await sha256(bytes);
    this.alive('blob', digest);
    if (this.failWrites) throw new Error('Simulated write failure (no effect)');
    this.stage('blob', digest, 'temp-write');
    this.stage('blob', digest, 'dir-fsync');
    if (!this.blobs.has(digest)) this.blobs.set(digest, bytes.slice());
    this.stage('blob', digest, 'ack');
    return digest;
  }

  async getBlob(digest: Digest): Promise<Uint8Array | null> {
    this.alive('get-blob', digest);
    return this.blobs.get(digest)?.slice() ?? null;
  }

  async appendEvent(ns: StorageNamespace, stream: string, bytes: Uint8Array): Promise<void> {
    this.alive('event', stream);
    if (this.failWrites) throw new Error('Simulated write failure (no effect)');
    this.stage('event', stream, 'temp-write');
    this.stage('event', stream, 'temp-fsync');
    const id = slot(ns, stream);
    this.events.set(id, [...(this.events.get(id) ?? []), bytes.slice()]);
    this.stage('event', stream, 'ack');
  }

  async readEvents(ns: StorageNamespace, stream: string): Promise<readonly Uint8Array[]> {
    this.alive('read-events', stream);
    return (this.events.get(slot(ns, stream)) ?? []).map((bytes) => bytes.slice());
  }

  /** Test inspection of durable bytes without recording a call. */
  peek(ns: StorageNamespace, key: string): Uint8Array | null { return this.visible(slot(ns, key))?.slice() ?? null; }
  /** Test-only corruption of durable bytes. */
  corrupt(ns: StorageNamespace, key: string, bytes: Uint8Array): void { this.durable.set(slot(ns, key), bytes.slice()); }
}

/** Advances one second per reading from a fixed synthetic start. */
export class StepClockFake implements ClockPort {
  readonly label = `${FAKE_LABEL}: stepping clock`;
  private time: number;
  private readonly stepMs: number;
  constructor(start = '2026-01-01T00:00:00.000Z', stepMs = 1_000) { this.time = Date.parse(start); this.stepMs = stepMs; }
  now(): string { const value = new Date(this.time).toISOString(); this.time += this.stepMs; return value; }
}

export class SequentialIdsFake implements IdPort {
  readonly label = `${FAKE_LABEL}: sequential ids`;
  private counters = new Map<IdKind, number>();
  private readonly prefix: string;
  constructor(prefix = 'fx') { this.prefix = prefix; }
  next(kind: IdKind): string {
    const value = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, value);
    return `${this.prefix}-${kind}-${String(value).padStart(4, '0')}`;
  }
}

/** Records hand-off requests; it never contacts any destination. */
export class DispatchSpyFake implements DispatchSlot {
  readonly label = `${FAKE_LABEL}: dispatch spy (never sends)`;
  readonly calls: PacketLink[] = [];
  requestSend(packet: PacketLink): void { this.calls.push(packet); }
}

/** Manual scheduler: timers run only when the test advances time. */
export class ManualSchedulerFake implements SchedulerPort {
  readonly label = `${FAKE_LABEL}: manual scheduler`;
  private timers = new Map<number, { at: number; callback: () => void }>();
  private nextHandle = 1;
  private current = 0;
  setTimeout(callback: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.current + ms, callback });
    return handle;
  }
  clearTimeout(handle: unknown): void { this.timers.delete(handle as number); }
  get pending(): number { return this.timers.size; }
  advance(ms: number): void {
    this.current += ms;
    for (const [handle, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > this.current) continue;
      this.timers.delete(handle);
      timer.callback();
    }
  }
}

import {
  GENESIS_HASH, isIdentifier,
  type AppendHandle, type AppendResult, type ClientEventId, type Clock, type FailClosedReason, type JournalHead,
  type JournalRecord, type JournalStatus, type LockHolder, type Sha256Hex, type TasteEvent, type TasteFileSystem,
} from './contract.ts';
import { canonicalBytes, canonicalize } from './jcs.ts';
import { parseTasteEvent } from './events.ts';

/**
 * Append-only, hash-chained JSONL journal (main side).
 *
 * - Each line is the JCS form of a record; `hash` = SHA-256(JCS(record minus hash)).
 * - An append is acknowledged only after the bytes are written and synced.
 * - One writer holds the lock file for the journal's lifetime.
 * - Any verification or write fault puts the journal into fail-closed: reads of
 *   the verified prefix continue, appends are refused, and nothing is truncated
 *   or repaired automatically.
 */

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/u;
const RECORD_KEYS = ['clientEventId', 'hash', 'payload', 'payloadDigest', 'prev', 'recordedAt', 'seq', 'v'];

export interface OpenJournalOptions {
  readonly fs: TasteFileSystem;
  readonly path: string;
  readonly lockPath: string;
  readonly sha256: Sha256Hex;
  readonly clock: Clock;
  readonly lockToken: string;
  readonly pid: number;
  /** Reclaim a lock whose holder is provably gone. Never forces a live holder. */
  readonly reclaimStaleLock?: boolean;
}

export type OpenJournalResult =
  | { readonly status: 'opened'; readonly journal: TasteJournal }
  | { readonly status: 'locked'; readonly holder: LockHolder | null };

/** Domain precondition evaluated inside the serialized append; return a reason to reject. */
export type AppendPrecondition = (records: readonly JournalRecord[]) => string | null;

interface Fault {
  readonly reason: FailClosedReason;
  readonly line: number | null;
}

interface Verified {
  readonly records: JournalRecord[];
  readonly fault: Fault | null;
}

function hashInput(record: Omit<JournalRecord, 'hash'>): Uint8Array {
  return canonicalBytes({
    clientEventId: record.clientEventId, payload: record.payload, payloadDigest: record.payloadDigest,
    prev: record.prev, recordedAt: record.recordedAt, seq: record.seq, v: record.v,
  });
}

/** Verify every line in order and stop at the first fault. Never mutates the bytes. */
export async function verifyJournalBytes(bytes: Uint8Array, sha256: Sha256Hex): Promise<Verified> {
  const records: JournalRecord[] = [];
  if (bytes.length === 0) return { records, fault: null };
  const fault = (reason: FailClosedReason, line: number | null): Verified => ({ records, fault: { reason, line } });
  let content: string;
  try {
    content = decoder.decode(bytes);
  } catch {
    return fault('invalid-encoding', null);
  }
  const lines = content.split('\n');
  const tail = lines.pop();
  const seen = new Set<string>();
  let prev = GENESIS_HASH;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return fault('invalid-json', lineNumber);
    }
    let canonical: string;
    try {
      canonical = canonicalize(parsed);
    } catch {
      return fault('invalid-record', lineNumber);
    }
    if (canonical !== line) return fault('non-canonical-record', lineNumber);
    const value = parsed as Record<string, unknown>;
    const keys = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.keys(value).sort() : [];
    if (keys.join(',') !== RECORD_KEYS.join(',') || value.v !== 1 || typeof value.seq !== 'number'
      || typeof value.prev !== 'string' || typeof value.hash !== 'string' || typeof value.payloadDigest !== 'string'
      || !isIdentifier(value.clientEventId) || !isIdentifier(value.recordedAt)
      || !HEX64.test(value.prev) || !HEX64.test(value.hash) || !HEX64.test(value.payloadDigest)
      || parseTasteEvent(value.payload) === null) {
      return fault('invalid-record', lineNumber);
    }
    const record = parsed as JournalRecord;
    if (record.seq !== records.length + 1) return fault('sequence-gap', lineNumber);
    if (record.prev !== prev) return fault('broken-link', lineNumber);
    if (await sha256(canonicalBytes(record.payload)) !== record.payloadDigest) return fault('payload-digest-mismatch', lineNumber);
    if (await sha256(hashInput(record)) !== record.hash) return fault('hash-mismatch', lineNumber);
    if (seen.has(record.clientEventId)) return fault('duplicate-client-event-id', lineNumber);
    seen.add(record.clientEventId);
    records.push(record);
    prev = record.hash;
  }
  // A final line without its newline is an interrupted append.
  if (tail !== undefined && tail.length > 0) return fault('incomplete-tail', lines.length + 1);
  return { records, fault: null };
}

export class TasteJournal {
  readonly #options: OpenJournalOptions;
  readonly #records: JournalRecord[];
  readonly #byClientEventId = new Map<string, JournalRecord>();
  #handle: AppendHandle | null;
  #needsDirectorySync: boolean;
  #fault: Fault | null;
  #closed = false;
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(options: OpenJournalOptions, verified: Verified, handle: AppendHandle | null, created: boolean) {
    this.#options = options;
    this.#records = verified.records;
    for (const record of verified.records) this.#byClientEventId.set(record.clientEventId, record);
    this.#fault = verified.fault;
    this.#handle = handle;
    this.#needsDirectorySync = created;
  }

  static async open(options: OpenJournalOptions): Promise<OpenJournalResult> {
    const { fs } = options;
    const holder: LockHolder = { token: options.lockToken, pid: options.pid, acquiredAt: options.clock.now() };
    let lock = await fs.acquireLock(options.lockPath, holder);
    if (!lock.acquired && options.reclaimStaleLock && lock.holder
      && !(await fs.isLockHolderAlive(lock.holder))
      && await fs.reclaimStaleLock(options.lockPath, lock.holder.token)) {
      lock = await fs.acquireLock(options.lockPath, holder);
    }
    if (!lock.acquired) return { status: 'locked', holder: lock.holder };
    try {
      const bytes = (await fs.readFile(options.path)) ?? new Uint8Array();
      const verified = await verifyJournalBytes(bytes, options.sha256);
      if (verified.fault) return { status: 'opened', journal: new TasteJournal(options, verified, null, false) };
      const { handle, created } = await fs.openAppend(options.path);
      return { status: 'opened', journal: new TasteJournal(options, verified, handle, created) };
    } catch (error) {
      await fs.releaseLock(options.lockPath, options.lockToken);
      throw error;
    }
  }

  get status(): JournalStatus {
    if (this.#closed) return { state: 'closed' };
    const head = this.head;
    if (this.#fault) {
      return { state: 'fail-closed', reason: this.#fault.reason, verifiedRecords: this.#records.length, line: this.#fault.line, head };
    }
    return { state: 'open', head };
  }

  get head(): JournalHead {
    const last = this.#records.at(-1);
    return last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
  }

  /** Verified records only. */
  records(): readonly JournalRecord[] {
    return this.#records;
  }

  find(clientEventId: string): JournalRecord | null {
    return this.#byClientEventId.get(clientEventId) ?? null;
  }

  /**
   * Appends are serialized. The idempotency check runs before the precondition,
   * so a replay of an acknowledged command stays a no-op even after later
   * events make its precondition false.
   */
  append(clientEventId: ClientEventId, payload: TasteEvent, precondition?: AppendPrecondition): Promise<AppendResult> {
    const run = this.#queue.then(() => this.#append(clientEventId, payload, precondition));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #append(clientEventId: ClientEventId, payload: TasteEvent, precondition?: AppendPrecondition): Promise<AppendResult> {
    if (this.#closed) return { status: 'closed' };
    if (!isIdentifier(clientEventId)) return { status: 'rejected', reason: 'invalid-client-event-id' };
    if (parseTasteEvent(payload) === null) return { status: 'rejected', reason: 'invalid-event' };
    const { sha256, clock } = this.#options;
    const payloadDigest = await sha256(canonicalBytes(payload));
    const existing = this.#byClientEventId.get(clientEventId);
    if (existing) {
      return existing.payloadDigest === payloadDigest
        ? { status: 'duplicate', record: existing }
        : { status: 'conflict', existing };
    }
    if (this.#fault || !this.#handle) return { status: 'fail-closed', reason: this.#fault?.reason ?? 'write-failed' };
    const rejection = precondition?.(this.#records) ?? null;
    if (rejection) return { status: 'rejected', reason: rejection };

    const head = this.head;
    const unsigned = { v: 1 as const, seq: head.seq + 1, prev: head.hash, clientEventId, recordedAt: clock.now(), payloadDigest, payload };
    const record: JournalRecord = { ...unsigned, hash: await sha256(hashInput(unsigned)) };
    const line = encoder.encode(`${canonicalize(record)}\n`);

    let written: number;
    try {
      written = await this.#handle.write(line);
    } catch {
      return this.#failClose('write-failed');
    }
    if (written !== line.length) return this.#failClose('partial-write');
    try {
      await this.#handle.sync();
      if (this.#needsDirectorySync) {
        await this.#options.fs.syncDirectoryOf(this.#options.path);
        this.#needsDirectorySync = false;
      }
    } catch {
      // The bytes may or may not be durable: unknown, so not acknowledged.
      return this.#failClose('sync-failed');
    }
    this.#records.push(record);
    this.#byClientEventId.set(clientEventId, record);
    return { status: 'appended', record };
  }

  #failClose(reason: FailClosedReason): AppendResult {
    this.#fault = { reason, line: this.#records.length + 1 };
    return { status: 'fail-closed', reason };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await this.#queue;
    this.#closed = true;
    const handle = this.#handle;
    this.#handle = null;
    try {
      await handle?.close();
    } finally {
      await this.#options.fs.releaseLock(this.#options.lockPath, this.#options.lockToken);
    }
  }
}

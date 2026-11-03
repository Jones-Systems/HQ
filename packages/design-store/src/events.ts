import type { EventRecord, JsonValue, StreamHead, StreamStatus } from './contract.ts';
import { canonicalize, sha256Hex } from './jcs.ts';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const NEWLINE = 0x0a;

export interface ParsedStream {
  readonly events: EventRecord[];
  readonly head: StreamHead | null;
  readonly status: StreamStatus;
  /** Byte length of the verified prefix. */
  readonly validBytes: number;
}

type UnhashedRecord = Omit<EventRecord, 'hash'>;

export function hashRecord(record: UnhashedRecord): string {
  return sha256Hex(canonicalize(record));
}

/** Serializes one record as a canonical JSON line including its trailing newline. */
export function encodeRecord(record: EventRecord): Uint8Array {
  return encoder.encode(`${canonicalize(record)}\n`);
}

export function buildRecord(previous: StreamHead | null, at: string, type: string, payload: JsonValue, clientEventId?: string): EventRecord {
  const unhashed: UnhashedRecord = {
    seq: (previous?.seq ?? 0) + 1,
    prev: previous?.hash ?? null,
    at,
    type,
    payload,
    ...(clientEventId === undefined ? {} : { clientEventId }),
  };
  return { ...unhashed, hash: hashRecord(unhashed) };
}

/**
 * Verifies a journal. A missing final newline is a torn tail from an interrupted append; any
 * earlier broken line, sequence gap or hash-chain mismatch is corruption. Neither is truncated.
 */
export function parseStream(bytes: Uint8Array): ParsedStream {
  const events: EventRecord[] = [];
  let head: StreamHead | null = null;
  let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(NEWLINE, offset);
    if (end === -1) {
      return { events, head, validBytes: offset, status: { state: 'torn-tail', validBytes: offset, tailBytes: bytes.length - offset } };
    }
    const expectedSeq: number = (head?.seq ?? 0) + 1;
    const failure = (reason: string): ParsedStream => ({ events, head, validBytes: offset, status: { state: 'corrupt', atSeq: expectedSeq, reason } });
    let record: EventRecord;
    try {
      const text = decoder.decode(bytes.subarray(offset, end));
      const parsed: unknown = JSON.parse(text);
      const checked = asRecord(parsed);
      if (!checked) return failure('malformed record');
      if (canonicalize(checked) !== text) return failure('non-canonical record');
      record = checked;
    } catch {
      return failure('unreadable record');
    }
    if (record.seq !== expectedSeq) return failure(`sequence ${record.seq} where ${expectedSeq} expected`);
    if (record.prev !== (head?.hash ?? null)) return failure('broken hash link');
    const { hash, ...unhashed } = record;
    if (hashRecord(unhashed) !== hash) return failure('record hash mismatch');
    events.push(record);
    head = { seq: record.seq, hash };
    offset = end + 1;
  }
  return { events, head, validBytes: offset, status: { state: 'ok' } };
}

function asRecord(value: unknown): EventRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = ['seq', 'prev', 'at', 'type', 'payload', 'clientEventId', 'hash'];
  if (!Object.keys(record).every((key) => allowed.includes(key))) return null;
  if (!Number.isSafeInteger(record.seq) || (record.seq as number) < 1) return null;
  if (!(record.prev === null || typeof record.prev === 'string')) return null;
  if (typeof record.at !== 'string' || typeof record.type !== 'string' || typeof record.hash !== 'string') return null;
  if (!('payload' in record)) return null;
  if ('clientEventId' in record && typeof record.clientEventId !== 'string') return null;
  return record as unknown as EventRecord;
}

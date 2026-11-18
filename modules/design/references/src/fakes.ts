/**
 * Labelled fakes for tests, previews and pre-integration composition. Every
 * label starts with `fake:`; none of these is evidence of a real adapter.
 */
import type {
  BlobDigest, ClockPort, DocumentWriteResult, IdPort, ReferencePorts, ReferenceStoragePort, StoredDocument,
} from './contract.ts';
import { sha256Hex } from './jcs.ts';

export type StorageOperation =
  | { readonly op: 'readDocument' | 'writeDocument'; readonly namespace: string; readonly key: string }
  | { readonly op: 'putBlob' | 'hasBlob'; readonly digest: string };

export class MemoryReferenceStorage implements ReferenceStoragePort {
  readonly label = 'fake:memory-reference-storage';
  readonly operations: StorageOperation[] = [];
  readonly blobs = new Map<BlobDigest, { readonly bytes: Uint8Array; readonly mediaType: string }>();
  #documents = new Map<string, { value: string; revision: number }>();
  /** When set, the next document write throws after (or before) applying. */
  failNextWrite: 'before-apply' | 'after-apply' | null = null;
  readOnly = false;

  async readDocument(namespace: 'workspace', key: string): Promise<StoredDocument | null> {
    this.operations.push({ op: 'readDocument', namespace, key });
    const stored = this.#documents.get(`${namespace}/${key}`);
    return stored === undefined ? null : { value: JSON.parse(stored.value) as unknown, revision: String(stored.revision) };
  }

  async writeDocument(namespace: 'workspace', key: string, value: unknown, expectedRevision: string | null): Promise<DocumentWriteResult> {
    this.operations.push({ op: 'writeDocument', namespace, key });
    if (this.readOnly) return { ok: false, reason: 'read-only' };
    const path = `${namespace}/${key}`;
    const current = this.#documents.get(path);
    if ((current === undefined ? null : String(current.revision)) !== expectedRevision) return { ok: false, reason: 'conflict' };
    const failure = this.failNextWrite;
    this.failNextWrite = null;
    if (failure === 'before-apply') throw new Error('fake: write failed before apply');
    const revision = (current?.revision ?? 0) + 1;
    this.#documents.set(path, { value: JSON.stringify(value), revision });
    if (failure === 'after-apply') throw new Error('fake: response lost after apply');
    return { ok: true, revision: String(revision) };
  }

  /** Test helper: replaces a document out of band (another writer). */
  seedDocument(namespace: 'workspace', key: string, value: unknown): void {
    const path = `${namespace}/${key}`;
    const revision = (this.#documents.get(path)?.revision ?? 0) + 1;
    this.#documents.set(path, { value: JSON.stringify(value), revision });
  }

  async putBlob(bytes: Uint8Array, mediaType: string): Promise<{ digest: BlobDigest; bytes: number }> {
    const digest = `sha256:${await sha256Hex(bytes)}` as BlobDigest;
    this.operations.push({ op: 'putBlob', digest });
    if (!this.blobs.has(digest)) this.blobs.set(digest, { bytes: bytes.slice(), mediaType });
    return { digest, bytes: bytes.byteLength };
  }

  async hasBlob(digest: BlobDigest): Promise<boolean> {
    this.operations.push({ op: 'hasBlob', digest });
    return this.blobs.has(digest);
  }
}

export class FixedClock implements ClockPort {
  readonly label = 'fake:fixed-clock';
  #ms: number;
  constructor(start = '2026-01-01T00:00:00.000Z') { this.#ms = Date.parse(start); }
  now(): string { return new Date(this.#ms).toISOString(); }
  advance(ms: number): void { this.#ms += ms; }
}

export class SequenceIds implements IdPort {
  readonly label = 'fake:sequence-ids';
  #next = 1;
  next(prefix: 'col' | 'use'): string { return `${prefix}_fake-${String(this.#next++).padStart(4, '0')}`; }
}

export function fakePorts(): ReferencePorts & { storage: MemoryReferenceStorage; clock: FixedClock; ids: SequenceIds } {
  return { storage: new MemoryReferenceStorage(), clock: new FixedClock(), ids: new SequenceIds() };
}

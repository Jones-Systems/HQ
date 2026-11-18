import type { BlobDigest, ClockPort, DocumentWriteResult, ReferenceStoragePort, StoredDocument } from '../../src/contract.ts';
import { sha256Hex } from '../../src/jcs.ts';

/** In-memory workspace storage for one producer run; nothing here touches disk or network. */
export class ProducerMemoryStorage implements ReferenceStoragePort {
  readonly label = 'producer:memory-storage';
  readonly blobs = new Map<BlobDigest, { readonly bytes: Uint8Array; readonly mediaType: string }>();
  readonly #documents = new Map<string, { value: string; revision: number }>();

  async readDocument(namespace: 'workspace', key: string): Promise<StoredDocument | null> {
    const stored = this.#documents.get(`${namespace}/${key}`);
    return stored === undefined ? null : { value: JSON.parse(stored.value) as unknown, revision: String(stored.revision) };
  }

  async writeDocument(namespace: 'workspace', key: string, value: unknown, expectedRevision: string | null): Promise<DocumentWriteResult> {
    const path = `${namespace}/${key}`;
    const current = this.#documents.get(path);
    if ((current === undefined ? null : String(current.revision)) !== expectedRevision) return { ok: false, reason: 'conflict' };
    const revision = (current?.revision ?? 0) + 1;
    this.#documents.set(path, { value: JSON.stringify(value), revision });
    return { ok: true, revision: String(revision) };
  }

  async putBlob(bytes: Uint8Array, mediaType: string): Promise<{ digest: BlobDigest; bytes: number }> {
    const digest = `sha256:${await sha256Hex(bytes)}` as BlobDigest;
    if (!this.blobs.has(digest)) this.blobs.set(digest, { bytes: bytes.slice(), mediaType });
    return { digest, bytes: bytes.byteLength };
  }

  async hasBlob(digest: BlobDigest): Promise<boolean> {
    return this.blobs.has(digest);
  }
}

/** Constant stamp so a packet depends only on source content, never on when the producer ran. */
export const PRODUCER_EPOCH = '1970-01-01T00:00:00.000Z';

export const producerClock: ClockPort = { label: 'producer:fixed-clock', now: () => PRODUCER_EPOCH };

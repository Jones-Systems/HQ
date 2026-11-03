import {
  StorageConflictError,
  type BlobInfo, type DigestPort, type JsonValue, type NamespaceInfo, type Sha256Digest,
  type StoragePort, type StoredDocument, type StoredEvent, type WriteOp,
} from './contract.ts';
import { canonicalize, cloneJson, digestBytes, webCryptoDigest } from './jcs.ts';

/**
 * FAKE, in-memory StoragePort for tests and the unqualified browser preview.
 * It is not durable and is not evidence of the real store (T9/HQD-08).
 * Commits are all-or-nothing; `failNextCommit` injects a failure before any
 * op becomes visible. Every committed op is recorded for spying.
 */
export class FakeStoragePort implements StoragePort {
  readonly label = 'FAKE in-memory StoragePort (not durable)';
  readonly committedOps: WriteOp[] = [];
  commitCalls = 0;
  readonly #namespaces: readonly NamespaceInfo[];
  readonly #documents = new Map<string, Map<string, StoredDocument>>();
  readonly #blobs = new Map<string, Map<string, { info: BlobInfo; bytes: Uint8Array }>>();
  readonly #events = new Map<string, Map<string, StoredEvent[]>>();
  readonly #digest: DigestPort;
  #revision = 0;
  #fault: Error | null = null;

  constructor(namespaces: readonly NamespaceInfo[], digest: DigestPort = webCryptoDigest) {
    this.#namespaces = namespaces.map((item) => ({ ...item }));
    for (const { name } of namespaces) {
      this.#documents.set(name, new Map());
      this.#blobs.set(name, new Map());
      this.#events.set(name, new Map());
    }
    this.#digest = digest;
  }

  /** The next commit throws `error` and applies nothing. */
  failNextCommit(error: Error = new Error('FAKE injected commit failure')): void {
    this.#fault = error;
  }

  /** Number of committed write ops, optionally filtered by namespace. */
  writeCount(namespace?: string): number {
    return this.committedOps.filter((op) => namespace === undefined || op.namespace === namespace).length;
  }

  #ns<T>(map: Map<string, T>, namespace: string): T {
    const found = map.get(namespace);
    if (found === undefined) throw new Error(`Unknown namespace ${JSON.stringify(namespace)}`);
    return found;
  }

  async namespaces(): Promise<readonly NamespaceInfo[]> {
    return this.#namespaces.map((item) => ({ ...item }));
  }

  async getDocument(namespace: string, key: string): Promise<StoredDocument | null> {
    const found = this.#ns(this.#documents, namespace).get(key);
    return found === undefined ? null : { ...found, value: cloneJson(found.value) };
  }

  async listDocuments(namespace: string, prefix = ''): Promise<readonly StoredDocument[]> {
    return [...this.#ns(this.#documents, namespace).values()]
      .filter((document) => document.key.startsWith(prefix))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((document) => ({ ...document, value: cloneJson(document.value) }));
  }

  async getBlob(namespace: string, digest: Sha256Digest): Promise<Uint8Array | null> {
    const found = this.#ns(this.#blobs, namespace).get(digest);
    return found === undefined ? null : found.bytes.slice();
  }

  async listBlobs(namespace: string): Promise<readonly BlobInfo[]> {
    return [...this.#ns(this.#blobs, namespace).values()].map((item) => ({ ...item.info }))
      .sort((a, b) => (a.digest < b.digest ? -1 : 1));
  }

  async listStreams(namespace: string): Promise<readonly string[]> {
    return [...this.#ns(this.#events, namespace).keys()].sort();
  }

  async readEvents(namespace: string, stream: string): Promise<readonly StoredEvent[]> {
    return (this.#ns(this.#events, namespace).get(stream) ?? []).map((event) => ({ ...event, payload: cloneJson(event.payload) }));
  }

  async commit(ops: readonly WriteOp[]): Promise<void> {
    this.commitCalls += 1;
    if (this.#fault !== null) {
      const fault = this.#fault;
      this.#fault = null;
      throw fault;
    }
    // Validate every op against current state before any becomes visible.
    const pendingRevisions = new Map<string, string | null>();
    const pendingSeq = new Map<string, number>();
    const pendingBlobs = new Map<string, string>();
    for (const op of ops) {
      if (op.op === 'put-document') {
        const id = `${op.namespace}\u0000${op.key}`;
        const current = pendingRevisions.has(id)
          ? pendingRevisions.get(id)!
          : (this.#ns(this.#documents, op.namespace).get(op.key)?.revision ?? null);
        if (current !== op.expectedRevision) throw new StorageConflictError(`Revision mismatch for ${op.namespace}/${op.key}`);
        canonicalize(op.value);
        pendingRevisions.set(id, `pending:${id}`);
      } else if (op.op === 'put-blob') {
        const actual = await digestBytes(this.#digest, op.bytes);
        if (actual !== op.digest) throw new StorageConflictError(`Blob digest mismatch for ${op.digest}`);
        const existing = this.#ns(this.#blobs, op.namespace).get(op.digest)?.info.mediaType ?? pendingBlobs.get(`${op.namespace}\u0000${op.digest}`);
        if (existing !== undefined && existing !== op.mediaType) throw new StorageConflictError(`Blob media type mismatch for ${op.digest}`);
        pendingBlobs.set(`${op.namespace}\u0000${op.digest}`, op.mediaType);
      } else {
        const id = `${op.namespace}\u0000${op.stream}`;
        const current = pendingSeq.get(id) ?? (this.#ns(this.#events, op.namespace).get(op.stream)?.length ?? 0);
        if (current !== op.expectedSeq) throw new StorageConflictError(`Sequence mismatch for ${op.namespace}/${op.stream}`);
        canonicalize(op.payload);
        pendingSeq.set(id, current + 1);
      }
    }
    for (const op of ops) {
      if (op.op === 'put-document') {
        this.#revision += 1;
        this.#ns(this.#documents, op.namespace).set(op.key, { key: op.key, value: cloneJson(op.value), revision: `r${this.#revision}` });
      } else if (op.op === 'put-blob') {
        const blobs = this.#ns(this.#blobs, op.namespace);
        if (!blobs.has(op.digest)) blobs.set(op.digest, { info: { digest: op.digest, mediaType: op.mediaType, bytes: op.bytes.byteLength }, bytes: op.bytes.slice() });
      } else {
        const streams = this.#ns(this.#events, op.namespace);
        const events = streams.get(op.stream) ?? [];
        events.push({ seq: events.length + 1, payload: cloneJson(op.payload) });
        streams.set(op.stream, events);
      }
      this.committedOps.push(op);
    }
  }

  /** Canonical text of all content (revisions excluded) for exact comparisons. */
  snapshot(): string {
    const state: Record<string, JsonValue> = {};
    for (const { name } of this.#namespaces) {
      const documents = [...this.#ns(this.#documents, name).values()].sort((a, b) => (a.key < b.key ? -1 : 1))
        .map((document) => ({ key: document.key, value: document.value }));
      const blobs = [...this.#ns(this.#blobs, name).values()].sort((a, b) => (a.info.digest < b.info.digest ? -1 : 1))
        .map((blob) => ({ digest: blob.info.digest, mediaType: blob.info.mediaType, data: Array.from(blob.bytes).join(',') }));
      const streams = [...this.#ns(this.#events, name).entries()].sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([stream, events]) => ({ stream, events: events.map((event) => ({ seq: event.seq, payload: event.payload })) }));
      state[name] = { documents, blobs, streams };
    }
    return canonicalize(state);
  }
}

export const DEFAULT_TEST_NAMESPACES: readonly NamespaceInfo[] = [
  { name: 'workspace', class: 'workspace' },
  { name: 'drafts', class: 'draft' },
  { name: 'cache', class: 'cache' },
];

/**
 * LABELLED FAKES. Synthetic sources, clock and in-memory stores for tests, demos and unqualified
 * composition. Nothing here contacts a real host, and every fake source reports `qualification: 'fake'`.
 */
import {
  hostId, isoFromMs, rootId, SourceUnavailableError,
  type CacheStoragePort, type CatalogEntry, type CatalogSnapshot, type ClockPort, type ContentDigest, type HostId,
  type PreviewRef, type RepoIdentity, type SourceAdapter, type WorkspaceEvidencePort,
} from './contract.ts';
import { deriveSourceProjectId, digestBytes } from './identity.ts';
import { utf8 } from './jcs.ts';

export const FAKE_LABEL = 'Synthetic fake source (not a real host)';

/** Deterministic clock: timers fire only on `advance`. */
export class FakeClock implements ClockPort {
  #now: number;
  #seq = 0;
  readonly #timers = new Map<number, { due: number; callback: () => void }>();

  constructor(start = Date.UTC(2026, 9, 20, 12, 0, 0)) { this.#now = start; }

  now(): number { return this.#now; }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = ++this.#seq;
    this.#timers.set(id, { due: this.#now + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: unknown): void { this.#timers.delete(handle as number); }

  get pendingTimers(): number { return this.#timers.size; }

  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      let next: [number, { due: number; callback: () => void }] | null = null;
      for (const item of this.#timers) if (item[1].due <= target && (!next || item[1].due < next[1].due)) next = item;
      if (!next) break;
      this.#timers.delete(next[0]);
      this.#now = next[1].due;
      next[1].callback();
    }
    this.#now = target;
  }
}

export const systemClock: ClockPort = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/** In-memory `cache` namespace with write accounting. */
export class MemoryCachePort implements CacheStoragePort {
  readonly namespace = 'cache' as const;
  readonly documents = new Map<string, string>();
  readonly blobs = new Map<ContentDigest, Uint8Array>();
  writes = 0;
  failWrites = false;

  async readDocument(key: string): Promise<string | null> { return this.documents.get(key) ?? null; }
  async writeDocument(key: string, text: string): Promise<void> {
    if (this.failWrites) throw new Error('fake cache write failure');
    this.writes += 1;
    this.documents.set(key, text);
  }
  async readBlob(digest: ContentDigest): Promise<Uint8Array | null> { return this.blobs.get(digest) ?? null; }
  async writeBlob(digest: ContentDigest, bytes: Uint8Array): Promise<void> {
    if (this.failWrites) throw new Error('fake cache write failure');
    this.writes += 1;
    this.blobs.set(digest, bytes.slice());
  }
  async deleteBlob(digest: ContentDigest): Promise<void> { this.blobs.delete(digest); }
  async listBlobs() { return [...this.blobs].map(([digest, bytes]) => ({ digest, bytes: bytes.byteLength })); }
}

/** In-memory `workspace` evidence port that records every write (spy). */
export class MemoryWorkspacePort implements WorkspaceEvidencePort {
  readonly namespace = 'workspace' as const;
  readonly blobs = new Map<ContentDigest, { bytes: Uint8Array; mediaType: string }>();
  writes = 0;
  async putEvidenceBlob(digest: ContentDigest, bytes: Uint8Array, mediaType: string): Promise<void> {
    this.writes += 1;
    this.blobs.set(digest, { bytes: bytes.slice(), mediaType });
  }
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

export type FakeBehaviour =
  | { readonly kind: 'snapshot'; readonly snapshot: CatalogSnapshot }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error'; readonly message: string }
  /** Never settles unless aborted — models a hung network. */
  | { readonly kind: 'hang'; readonly honourAbort?: boolean }
  | { readonly kind: 'deferred'; readonly deferred: Deferred<CatalogSnapshot> };

/**
 * Labelled fake source. Behaviour is configured per host; calls and aborts are recorded so tests
 * can prove cancellation and lazy loading.
 */
export class FakeSourceAdapter implements SourceAdapter {
  readonly label = FAKE_LABEL;
  readonly qualification = 'fake' as const;
  readonly behaviours = new Map<string, FakeBehaviour[]>();
  readonly previews = new Map<ContentDigest, Uint8Array>();
  readonly listCalls: HostId[] = [];
  readonly previewCalls: ContentDigest[] = [];
  readonly aborted: string[] = [];
  readonly pendingPreviews = new Map<ContentDigest, Deferred<Uint8Array>[]>();
  holdPreviews = false;

  /** Queue behaviours for a host; the last one repeats. */
  on(host: HostId, ...behaviours: FakeBehaviour[]): this {
    this.behaviours.set(host, behaviours);
    return this;
  }

  listSnapshot(host: HostId, signal: AbortSignal): Promise<CatalogSnapshot> {
    this.listCalls.push(host);
    const queue = this.behaviours.get(host) ?? [{ kind: 'offline' }];
    const behaviour = queue.length > 1 ? queue.shift()! : queue[0]!;
    signal.addEventListener('abort', () => this.aborted.push(`list:${host}`), { once: true });
    switch (behaviour.kind) {
      case 'snapshot': return Promise.resolve(structuredClone(behaviour.snapshot));
      case 'offline': return Promise.reject(new SourceUnavailableError('Fake source is offline'));
      case 'error': return Promise.reject(new Error(behaviour.message));
      case 'hang': return new Promise((_, reject) => {
        if (behaviour.honourAbort !== false) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      case 'deferred': return behaviour.deferred.promise;
    }
  }

  readPreview(ref: PreviewRef, signal: AbortSignal): Promise<Uint8Array> {
    this.previewCalls.push(ref.digest);
    signal.addEventListener('abort', () => this.aborted.push(`preview:${ref.digest}`), { once: true });
    const bytes = this.previews.get(ref.digest);
    if (!this.holdPreviews) return bytes ? Promise.resolve(bytes.slice()) : Promise.reject(new Error('Fake preview missing'));
    const pending = deferred<Uint8Array>();
    const list = this.pendingPreviews.get(ref.digest) ?? [];
    list.push(pending);
    this.pendingPreviews.set(ref.digest, list);
    signal.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true });
    return pending.promise;
  }

  /** Releases held preview requests for a digest. */
  releasePreview(digest: ContentDigest): void {
    const bytes = this.previews.get(digest);
    for (const pending of this.pendingPreviews.get(digest) ?? []) {
      if (bytes) pending.resolve(bytes.slice()); else pending.reject(new Error('Fake preview missing'));
    }
    this.pendingPreviews.delete(digest);
  }
}

// ---- synthetic fixtures ------------------------------------------------------------------------

export interface FixtureProject {
  readonly root?: string;
  readonly path: string;
  readonly name: string;
  readonly revision?: string;
  readonly repo?: RepoIdentity;
  readonly previews?: readonly PreviewRef[];
}

export async function fixtureEntry(host: HostId, project: FixtureProject): Promise<CatalogEntry> {
  const root = rootId(project.root ?? 'projects');
  return {
    sourceProjectId: await deriveSourceProjectId(host, root, project.path),
    hostId: host,
    repoIdentity: project.repo ?? { localOnly: true },
    relativePath: project.path,
    rootId: root,
    displayName: project.name,
    ...(project.revision !== undefined ? { revision: project.revision } : {}),
    metadata: { kind: 'synthetic' },
    previews: project.previews ?? [],
  };
}

export async function fixtureSnapshot(host: HostId, generation: number, projects: readonly FixtureProject[], options: { complete?: boolean; observedAtMs?: number; fingerprint?: string } = {}): Promise<CatalogSnapshot> {
  return {
    hostId: host, generation, complete: options.complete ?? true,
    observedAt: isoFromMs(options.observedAtMs ?? Date.UTC(2026, 9, 20, 11, 0, 0)),
    entries: await Promise.all(projects.map((project) => fixtureEntry(host, project))),
    ...(options.fingerprint !== undefined ? { hostFingerprint: options.fingerprint } : {}),
  };
}

/** Builds deterministic synthetic preview bytes and their reference. */
export async function fixturePreview(seed: string, mediaType = 'image/png'): Promise<{ ref: PreviewRef; bytes: Uint8Array }> {
  const bytes = utf8(`synthetic-preview:${seed}`);
  return { ref: { digest: await digestBytes(bytes), mediaType, bytes: bytes.byteLength, w: 320, h: 200 }, bytes };
}

export const FAKE_HOSTS = Object.freeze({
  laptop: hostId('host-laptop-fake'),
  studio: hostId('host-studio-fake'),
  server: hostId('host-server-fake'),
});

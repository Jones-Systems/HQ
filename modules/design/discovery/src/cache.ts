/**
 * Local cache for catalog metadata and preview bytes. Everything here lives in the bounded,
 * evictable `cache` namespace; corrupt cache is rebuilt without touching the workspace, and a cache
 * written by a newer schema is left unmodified.
 */
import {
  hostId as toHostId, isoTime, type CacheStoragePort, type ContentDigest, type Freshness, type IsoTime,
  type WorkspaceEvidencePort, FRESHNESS_STATUSES,
} from './contract.ts';
import { EMPTY_CATALOG, parseSnapshot, type CatalogRecord, type CatalogState, type SourceErrorInfo, type SourceState } from './catalog.ts';
import { digestBytes } from './identity.ts';

export const CATALOG_CACHE_KEY = 'design.discovery.catalog';
export const CATALOG_CACHE_SCHEMA = 'hq.design.discovery-cache/v1';

export type CacheLoadStatus = 'warm' | 'cold' | 'corrupt-rebuilt' | 'future-readonly' | 'unavailable-readonly';

export interface CacheLoad {
  readonly status: CacheLoadStatus;
  readonly catalog: CatalogState;
  /** False when the stored cache is from a newer schema or could not be read; it must not be overwritten. */
  readonly writable: boolean;
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableIso(value: unknown): IsoTime | null | undefined {
  if (value === null) return null;
  try { return isoTime(value); } catch { return undefined; }
}

function nullableInt(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseFreshness(value: unknown): Freshness | null {
  if (!plain(value) || !FRESHNESS_STATUSES.includes(value.status as Freshness['status'])) return null;
  const lastSuccessAt = nullableIso(value.lastSuccessAt);
  const generation = nullableInt(value.generation);
  if (lastSuccessAt === undefined || generation === undefined) return null;
  return { status: value.status as Freshness['status'], lastSuccessAt, generation };
}

const SOURCE_STATUSES = ['never', 'fresh', 'stale', 'partial', 'offline', 'timeout', 'error'];
const ERROR_KINDS = ['offline', 'timeout', 'error', 'invalid-snapshot', 'identity-conflict'];

function parseSource(value: unknown): SourceState | null {
  if (!plain(value) || !SOURCE_STATUSES.includes(value.status as string)) return null;
  let host;
  try { host = toHostId(value.hostId); } catch { return null; }
  const lastSuccessAt = nullableIso(value.lastSuccessAt);
  const lastAttemptAt = nullableIso(value.lastAttemptAt);
  const generation = nullableInt(value.generation);
  const completeGeneration = nullableInt(value.completeGeneration);
  if ([lastSuccessAt, lastAttemptAt, generation, completeGeneration].includes(undefined)) return null;
  let error: SourceErrorInfo | null = null;
  if (value.error !== null) {
    if (!plain(value.error) || !ERROR_KINDS.includes(value.error.kind as string) || typeof value.error.message !== 'string') return null;
    const at = nullableIso(value.error.at);
    if (!at) return null;
    error = { kind: value.error.kind as SourceErrorInfo['kind'], message: value.error.message.slice(0, 240), at };
  }
  let conflict: SourceState['conflict'] = null;
  if (value.conflict !== null) {
    const raw = value.conflict;
    if (!plain(raw) || typeof raw.observedHostId !== 'string') return null;
    const at = nullableIso(raw.at);
    const expected = raw.expectedFingerprint;
    const observed = raw.observedFingerprint;
    if (!at || (expected !== null && typeof expected !== 'string') || (observed !== null && typeof observed !== 'string')) return null;
    conflict = { expectedFingerprint: expected, observedFingerprint: observed, observedHostId: raw.observedHostId, at };
  }
  return {
    hostId: host, status: value.status as SourceState['status'],
    lastSuccessAt: lastSuccessAt!, lastAttemptAt: lastAttemptAt!, generation: generation!, completeGeneration: completeGeneration!,
    error, conflict,
  };
}

/** Validates a cached catalog document with the same strictness as live snapshots. */
export async function parseCatalogCache(text: string): Promise<{ kind: 'ok'; catalog: CatalogState } | { kind: 'corrupt' } | { kind: 'future' }> {
  let document: unknown;
  try { document = JSON.parse(text); } catch { return { kind: 'corrupt' }; }
  if (!plain(document) || typeof document.schema !== 'string') return { kind: 'corrupt' };
  if (document.schema !== CATALOG_CACHE_SCHEMA) {
    return /^hq\.design\.discovery-cache\/v(\d+)$/u.test(document.schema) ? { kind: 'future' } : { kind: 'corrupt' };
  }
  if (!plain(document.sources) || !plain(document.records)) return { kind: 'corrupt' };
  const sources: Record<string, SourceState> = {};
  for (const [key, raw] of Object.entries(document.sources)) {
    const source = parseSource(raw);
    if (!source || source.hostId !== key) return { kind: 'corrupt' };
    sources[key] = source;
  }
  const records: Record<string, CatalogRecord> = {};
  for (const [key, raw] of Object.entries(document.records)) {
    if (!plain(raw) || !plain(raw.entry)) return { kind: 'corrupt' };
    const freshness = parseFreshness(raw.freshness);
    const host = raw.entry.hostId;
    if (!freshness || typeof host !== 'string' || !sources[host]) return { kind: 'corrupt' };
    // Reuse live-snapshot validation for the entry itself.
    const parsed = await parseSnapshot({ hostId: host, generation: 0, complete: false, observedAt: '1970-01-01T00:00:00.000Z', entries: [raw.entry] }, sources[host].hostId);
    if (!parsed.ok || parsed.snapshot.entries[0]!.sourceProjectId !== key) return { kind: 'corrupt' };
    records[key] = { entry: parsed.snapshot.entries[0]!, freshness };
  }
  return { kind: 'ok', catalog: { sources, records } };
}

export function serializeCatalogCache(catalog: CatalogState, savedAt: IsoTime): string {
  return JSON.stringify({ schema: CATALOG_CACHE_SCHEMA, savedAt, sources: catalog.sources, records: catalog.records });
}

/** Reads only the local cache. Never waits on a source and never writes the workspace. */
export async function loadCatalogCache(port: CacheStoragePort, savedAt: IsoTime): Promise<CacheLoad> {
  let text: string | null;
  // A failed read says nothing about the stored bytes, so never rebuild over them.
  try { text = await port.readDocument(CATALOG_CACHE_KEY); } catch { return { status: 'unavailable-readonly', catalog: EMPTY_CATALOG, writable: false }; }
  if (text === null) return { status: 'cold', catalog: EMPTY_CATALOG, writable: true };
  const parsed = await parseCatalogCache(text);
  if (parsed.kind === 'ok') return { status: 'warm', catalog: parsed.catalog, writable: true };
  if (parsed.kind === 'future') return { status: 'future-readonly', catalog: EMPTY_CATALOG, writable: false };
  // Cache is evictable: rebuild it empty. The workspace is never consulted or modified.
  try { await port.writeDocument(CATALOG_CACHE_KEY, serializeCatalogCache(EMPTY_CATALOG, savedAt)); } catch { /* still usable in memory */ }
  return { status: 'corrupt-rebuilt', catalog: EMPTY_CATALOG, writable: true };
}

export interface PreviewCacheLimits {
  /** Total cache budget for preview bytes. */
  readonly budgetBytes: number;
  /** Largest single preview admitted. */
  readonly maxItemBytes: number;
}

/**
 * LRU byte-budgeted preview store over the cache namespace. Digests are verified on read and write;
 * pinned digests (being adopted into the workspace) are never evicted.
 */
export class PreviewCache {
  readonly #port: CacheStoragePort;
  readonly #limits: PreviewCacheLimits;
  readonly #index = new Map<ContentDigest, { bytes: number; used: number }>();
  readonly #pins = new Map<ContentDigest, number>();
  #tick = 0;
  #ready: Promise<void> | null = null;

  constructor(port: CacheStoragePort, limits: PreviewCacheLimits) {
    this.#port = port;
    this.#limits = limits;
  }

  get totalBytes(): number {
    let total = 0;
    for (const item of this.#index.values()) total += item.bytes;
    return total;
  }

  has(digest: ContentDigest): boolean { return this.#index.has(digest); }

  #init(): Promise<void> {
    this.#ready ??= this.#port.listBlobs().then((items) => {
      for (const item of items) this.#index.set(item.digest, { bytes: item.bytes, used: 0 });
    }, () => undefined).then(() => this.#evict());
    return this.#ready;
  }

  async get(digest: ContentDigest): Promise<Uint8Array | null> {
    await this.#init();
    if (!this.#index.has(digest)) return null;
    const bytes = await this.#port.readBlob(digest).catch(() => null);
    if (!bytes || await digestBytes(bytes) !== digest) {
      this.#index.delete(digest);
      await this.#port.deleteBlob(digest).catch(() => undefined);
      return null;
    }
    this.#index.set(digest, { bytes: bytes.byteLength, used: ++this.#tick });
    return bytes;
  }

  /** Returns false when the item is not admitted (too large or digest mismatch). */
  async put(digest: ContentDigest, bytes: Uint8Array): Promise<boolean> {
    await this.#init();
    if (bytes.byteLength > this.#limits.maxItemBytes || bytes.byteLength > this.#limits.budgetBytes) return false;
    if (await digestBytes(bytes) !== digest) return false;
    await this.#port.writeBlob(digest, bytes);
    this.#index.set(digest, { bytes: bytes.byteLength, used: ++this.#tick });
    await this.#evict(digest);
    return true;
  }

  async #evict(keep?: ContentDigest): Promise<void> {
    let total = this.totalBytes;
    if (total <= this.#limits.budgetBytes) return;
    const candidates = [...this.#index.entries()]
      .filter(([digest]) => digest !== keep && !this.#pins.has(digest))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [digest, item] of candidates) {
      if (total <= this.#limits.budgetBytes) break;
      this.#index.delete(digest);
      total -= item.bytes;
      await this.#port.deleteBlob(digest).catch(() => undefined);
    }
  }

  /**
   * Explicit evidence adoption: copies cached bytes into the authoritative workspace before they can
   * be evicted. The cache copy remains evictable afterwards.
   */
  async adopt(digest: ContentDigest, mediaType: string, workspace: WorkspaceEvidencePort): Promise<void> {
    this.#pins.set(digest, (this.#pins.get(digest) ?? 0) + 1);
    try {
      const bytes = await this.get(digest);
      if (!bytes) throw new Error('Preview is not cached; fetch it before adopting');
      await workspace.putEvidenceBlob(digest, bytes, mediaType);
    } finally {
      const count = (this.#pins.get(digest) ?? 1) - 1;
      if (count <= 0) this.#pins.delete(digest); else this.#pins.set(digest, count);
    }
  }
}

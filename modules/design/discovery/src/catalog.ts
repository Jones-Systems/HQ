/**
 * Pure catalog state for enrolled sources. Records are keyed only by SourceProjectId (which embeds
 * HostId); display titles and remotes never merge records. Failed or partial refreshes never remove
 * entries, and only a newer complete snapshot marks omitted entries missing-at-source.
 */
import {
  contentDigest, isBoundedText, isoTime, isRelativePath, rootId as toRootId, sourceProjectIdFromHex,
  type CatalogEntry, type CatalogSnapshot, type Freshness, type FreshnessStatus, type HostId, type IsoTime,
  type MetadataValue, type PreviewRef, type SourceProjectId,
} from './contract.ts';
import { deriveSourceProjectId, parseRepoIdentity } from './identity.ts';

export const LIMITS = Object.freeze({
  entriesPerSnapshot: 10_000,
  metadataKeys: 32,
  metadataText: 512,
  previewsPerEntry: 8,
  previewBytes: 64 * 1024 * 1024,
  errorMessage: 240,
});

export type SourceStatus = 'never' | 'fresh' | 'stale' | 'partial' | 'offline' | 'timeout' | 'error';
export type SourceErrorKind = 'offline' | 'timeout' | 'error' | 'invalid-snapshot' | 'identity-conflict';

export interface SourceErrorInfo {
  readonly kind: SourceErrorKind;
  readonly message: string;
  readonly at: IsoTime;
}

/** A changed host identity is held for explicit resolution; the snapshot is not applied. */
export interface HostConflict {
  readonly expectedFingerprint: string | null;
  readonly observedFingerprint: string | null;
  readonly observedHostId: string;
  readonly at: IsoTime;
}

export interface SourceState {
  readonly hostId: HostId;
  readonly status: SourceStatus;
  readonly lastSuccessAt: IsoTime | null;
  readonly lastAttemptAt: IsoTime | null;
  /** Highest applied snapshot generation (complete or partial). */
  readonly generation: number | null;
  /** Highest applied complete generation; gates missing-at-source. */
  readonly completeGeneration: number | null;
  readonly error: SourceErrorInfo | null;
  readonly conflict: HostConflict | null;
}

export interface CatalogRecord {
  readonly entry: CatalogEntry;
  readonly freshness: Freshness;
}

export interface CatalogState {
  readonly sources: Readonly<Record<string, SourceState>>;
  readonly records: Readonly<Record<string, CatalogRecord>>;
}

export const EMPTY_CATALOG: CatalogState = Object.freeze({ sources: Object.freeze({}), records: Object.freeze({}) });

export function initialSource(host: HostId): SourceState {
  return { hostId: host, status: 'never', lastSuccessAt: null, lastAttemptAt: null, generation: null, completeGeneration: null, error: null, conflict: null };
}

// ---- snapshot validation ----------------------------------------------------------------------

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function positiveInt(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

export function parsePreviewRef(value: unknown): PreviewRef | null {
  if (!plain(value) || !onlyKeys(value, ['digest', 'mediaType', 'bytes', 'w', 'h'])) return null;
  try { contentDigest(value.digest); } catch { return null; }
  if (!isBoundedText(value.mediaType, 120) || !/^[a-z]+\/[a-z0-9.+-]+$/iu.test(value.mediaType)) return null;
  if (!positiveInt(value.bytes, LIMITS.previewBytes)) return null;
  if (value.w !== undefined && !positiveInt(value.w, 100_000)) return null;
  if (value.h !== undefined && !positiveInt(value.h, 100_000)) return null;
  return {
    digest: value.digest as PreviewRef['digest'], mediaType: value.mediaType, bytes: value.bytes,
    ...(value.w !== undefined ? { w: value.w as number } : {}), ...(value.h !== undefined ? { h: value.h as number } : {}),
  };
}

function parseMetadata(value: unknown): Record<string, MetadataValue> | null {
  if (!plain(value) || Object.keys(value).length > LIMITS.metadataKeys) return null;
  const out: Record<string, MetadataValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isBoundedText(key, 64)) return null;
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) out[key] = item;
    else if (typeof item === 'string' && item.length <= LIMITS.metadataText) out[key] = item;
    else return null;
  }
  return out;
}

async function parseEntry(value: unknown, host: HostId): Promise<CatalogEntry | string> {
  if (!plain(value) || !onlyKeys(value, ['sourceProjectId', 'hostId', 'repoIdentity', 'relativePath', 'rootId', 'displayName', 'revision', 'metadata', 'previews'])) {
    return 'entry has unexpected shape';
  }
  let id: SourceProjectId;
  try { id = sourceProjectIdFromHex(value.sourceProjectId); } catch { return 'entry has invalid sourceProjectId'; }
  if (value.hostId !== host) return 'entry hostId differs from snapshot hostId';
  const repoIdentity = parseRepoIdentity(value.repoIdentity);
  if (!repoIdentity) return 'entry has invalid repoIdentity';
  if (!isRelativePath(value.relativePath)) return 'entry has invalid relativePath';
  if (!isBoundedText(value.displayName, 300)) return 'entry has invalid displayName';
  if (value.revision !== undefined && !isBoundedText(value.revision, 300)) return 'entry has invalid revision';
  const metadata = parseMetadata(value.metadata);
  if (!metadata) return 'entry has invalid metadata';
  if (!Array.isArray(value.previews) || value.previews.length > LIMITS.previewsPerEntry) return 'entry has invalid previews';
  const previews: PreviewRef[] = [];
  for (const item of value.previews) {
    const ref = parsePreviewRef(item);
    if (!ref) return 'entry has invalid preview reference';
    previews.push(ref);
  }
  let root: CatalogEntry['rootId'];
  if (value.rootId !== undefined) {
    try { root = toRootId(value.rootId); } catch { return 'entry has invalid rootId'; }
    if (await deriveSourceProjectId(host, root, value.relativePath) !== id) return 'entry sourceProjectId does not match {hostId,rootId,relativePath}';
  }
  return {
    sourceProjectId: id, hostId: host, repoIdentity, relativePath: value.relativePath,
    ...(root !== undefined ? { rootId: root } : {}),
    displayName: value.displayName,
    ...(value.revision !== undefined ? { revision: value.revision as string } : {}),
    metadata, previews,
  };
}

export type SnapshotParse =
  | { readonly ok: true; readonly snapshot: CatalogSnapshot }
  | { readonly ok: false; readonly reason: string };

/** Strictly validates an adapter's snapshot for the host that was asked. */
export async function parseSnapshot(value: unknown, requested: HostId): Promise<SnapshotParse> {
  if (!plain(value) || !onlyKeys(value, ['hostId', 'generation', 'complete', 'observedAt', 'entries', 'hostFingerprint'])) {
    return { ok: false, reason: 'snapshot has unexpected shape' };
  }
  if (value.hostId !== requested) return { ok: false, reason: 'snapshot hostId differs from requested host' };
  if (!positiveInt(value.generation)) return { ok: false, reason: 'snapshot generation is invalid' };
  if (typeof value.complete !== 'boolean') return { ok: false, reason: 'snapshot complete flag is invalid' };
  let observedAt: IsoTime;
  try { observedAt = isoTime(value.observedAt); } catch { return { ok: false, reason: 'snapshot observedAt is invalid' }; }
  if (value.hostFingerprint !== undefined && !isBoundedText(value.hostFingerprint, 200)) return { ok: false, reason: 'snapshot hostFingerprint is invalid' };
  if (!Array.isArray(value.entries) || value.entries.length > LIMITS.entriesPerSnapshot) return { ok: false, reason: 'snapshot entries are invalid or exceed the bound' };
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const raw of value.entries) {
    const entry = await parseEntry(raw, requested);
    if (typeof entry === 'string') return { ok: false, reason: entry };
    if (seen.has(entry.sourceProjectId)) return { ok: false, reason: 'snapshot repeats a sourceProjectId' };
    seen.add(entry.sourceProjectId);
    entries.push(entry);
  }
  return {
    ok: true,
    snapshot: {
      hostId: requested, generation: value.generation, complete: value.complete, observedAt, entries,
      ...(value.hostFingerprint !== undefined ? { hostFingerprint: value.hostFingerprint as string } : {}),
    },
  };
}

// ---- reducer ----------------------------------------------------------------------------------

export type CatalogEvent =
  | { readonly type: 'snapshot'; readonly snapshot: CatalogSnapshot; readonly at: IsoTime; readonly expectedFingerprint?: string }
  | { readonly type: 'failure'; readonly hostId: HostId; readonly kind: SourceErrorKind; readonly message: string; readonly at: IsoTime }
  | { readonly type: 'attempt'; readonly hostId: HostId; readonly at: IsoTime }
  /** Marks cache-loaded data stale until a refresh succeeds this session. */
  | { readonly type: 'loaded-from-cache' }
  /** Explicit user resolution of a held identity conflict after re-verifying the host. */
  | { readonly type: 'conflict-resolved'; readonly hostId: HostId };

export interface ReduceResult {
  readonly state: CatalogState;
  /** `ignored` means the event was stale or held and changed nothing visible except error bookkeeping. */
  readonly outcome: 'applied' | 'ignored-stale-generation' | 'held-conflict' | 'rejected-collision' | 'recorded';
}

const FAILURE_STATUS: Record<SourceErrorKind, FreshnessStatus & SourceStatus> = {
  offline: 'offline', timeout: 'timeout', error: 'error', 'invalid-snapshot': 'error', 'identity-conflict': 'error',
};

function message(text: string): string {
  const clean = text.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim() || 'Unknown failure';
  return clean.length > LIMITS.errorMessage ? `${clean.slice(0, LIMITS.errorMessage - 1)}…` : clean;
}

export function reduceCatalog(state: CatalogState, event: CatalogEvent): ReduceResult {
  switch (event.type) {
    case 'loaded-from-cache': {
      const records: Record<string, CatalogRecord> = {};
      for (const [id, record] of Object.entries(state.records)) {
        records[id] = record.freshness.status === 'fresh' ? { ...record, freshness: { ...record.freshness, status: 'stale' } } : record;
      }
      const sources: Record<string, SourceState> = {};
      for (const [id, source] of Object.entries(state.sources)) {
        sources[id] = source.status === 'fresh' || source.status === 'partial' ? { ...source, status: 'stale' } : source;
      }
      return { state: { sources, records }, outcome: 'recorded' };
    }
    case 'attempt': {
      const source = state.sources[event.hostId] ?? initialSource(event.hostId);
      return { state: { ...state, sources: { ...state.sources, [event.hostId]: { ...source, lastAttemptAt: event.at } } }, outcome: 'recorded' };
    }
    case 'conflict-resolved': {
      const source = state.sources[event.hostId];
      if (!source?.conflict) return { state, outcome: 'ignored-stale-generation' };
      return { state: { ...state, sources: { ...state.sources, [event.hostId]: { ...source, conflict: null, error: null } } }, outcome: 'recorded' };
    }
    case 'failure': {
      const source = state.sources[event.hostId] ?? initialSource(event.hostId);
      const status = FAILURE_STATUS[event.kind];
      const records: Record<string, CatalogRecord> = { ...state.records };
      for (const [id, record] of Object.entries(state.records)) {
        if (record.entry.hostId !== event.hostId || record.freshness.status === 'missing-at-source') continue;
        // Cached data stays visible; only its freshness changes.
        records[id] = { ...record, freshness: { ...record.freshness, status } };
      }
      const next: SourceState = {
        ...source, status, lastAttemptAt: event.at,
        error: { kind: event.kind, message: message(event.message), at: event.at },
        conflict: source.conflict,
      };
      return { state: { records, sources: { ...state.sources, [event.hostId]: next } }, outcome: 'recorded' };
    }
    case 'snapshot':
      return applySnapshot(state, event.snapshot, event.at, event.expectedFingerprint);
  }
}

function applySnapshot(state: CatalogState, snapshot: CatalogSnapshot, at: IsoTime, expectedFingerprint: string | undefined): ReduceResult {
  const host = snapshot.hostId;
  const source = state.sources[host] ?? initialSource(host);
  if (expectedFingerprint !== undefined && snapshot.hostFingerprint !== expectedFingerprint) {
    const conflict: HostConflict = {
      expectedFingerprint, observedFingerprint: snapshot.hostFingerprint ?? null, observedHostId: snapshot.hostId, at,
    };
    const held = reduceCatalog(state, { type: 'failure', hostId: host, kind: 'identity-conflict', message: 'Host identity fingerprint changed; snapshot held until explicitly re-verified', at }).state;
    return { state: { ...held, sources: { ...held.sources, [host]: { ...held.sources[host]!, conflict } } }, outcome: 'held-conflict' };
  }
  if (source.conflict) return { state, outcome: 'held-conflict' };
  if (source.generation !== null && snapshot.generation <= source.generation) return { state, outcome: 'ignored-stale-generation' };
  for (const entry of snapshot.entries) {
    const existing = state.records[entry.sourceProjectId];
    if (existing && existing.entry.hostId !== host) return { state, outcome: 'rejected-collision' };
  }

  const records: Record<string, CatalogRecord> = { ...state.records };
  const seen = new Set<string>();
  for (const entry of snapshot.entries) {
    seen.add(entry.sourceProjectId);
    records[entry.sourceProjectId] = { entry, freshness: { status: 'fresh', lastSuccessAt: at, generation: snapshot.generation } };
  }
  const marksMissing = snapshot.complete && (source.completeGeneration === null || snapshot.generation > source.completeGeneration);
  for (const [id, record] of Object.entries(state.records)) {
    if (record.entry.hostId !== host || seen.has(id)) continue;
    const status: FreshnessStatus = marksMissing ? 'missing-at-source' : record.freshness.status === 'missing-at-source' ? 'missing-at-source' : 'partial';
    records[id] = { ...record, freshness: { ...record.freshness, status } };
  }
  const next: SourceState = {
    ...source,
    status: snapshot.complete ? 'fresh' : 'partial',
    lastSuccessAt: at, lastAttemptAt: at, generation: snapshot.generation,
    completeGeneration: snapshot.complete ? snapshot.generation : source.completeGeneration,
    error: null, conflict: null,
  };
  return { state: { records, sources: { ...state.sources, [host]: next } }, outcome: 'applied' };
}

export function recordsForHosts(state: CatalogState, hosts: ReadonlySet<string>): CatalogRecord[] {
  return Object.values(state.records).filter((record) => hosts.has(record.entry.hostId));
}

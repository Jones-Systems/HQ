/**
 * Section-local contract for `hq.design.source-catalog/v1` (spec.hq-design#iface.source-catalog.001).
 *
 * Discovery reads catalog metadata and previews from enrolled sources. It never executes, clones or
 * writes at a source; execution eligibility is connector-owned and shares only `HostId` with this
 * module. Root promotes these types into @hq/contracts mechanically; until then this file is the
 * section's published port surface.
 */

export const SOURCE_CATALOG_SCHEMA = 'hq.design.source-catalog/v1' as const;

export type Brand<T, K extends string> = T & { readonly __kind: K };

/** Opaque source host identity. Never a network address, path or display title. */
export type HostId = Brand<string, 'HostId'>;
/** Opaque root identity within one host (for example one configured projects root). */
export type RootId = Brand<string, 'RootId'>;
/** Lowercase hex SHA-256 of JCS `{hostId,rootId,relativePath}`. */
export type SourceProjectId = Brand<string, 'SourceProjectId'>;
/** HQ workspace project identity (editable, laptop-owned). */
export type ProjectId = Brand<string, 'ProjectId'>;
/** `sha256:` followed by 64 lowercase hex digits. */
export type ContentDigest = Brand<string, 'ContentDigest'>;
/** ISO 8601 UTC timestamp. */
export type IsoTime = Brand<string, 'IsoTime'>;

/** Ordered identity evidence; earlier fields are stronger. It never merges records by itself. */
export interface RepoIdentity {
  readonly normalizedRemote?: string;
  readonly rootCommit?: string;
  readonly localOnly: boolean;
}

export interface PreviewRef {
  readonly digest: ContentDigest;
  readonly mediaType: string;
  readonly bytes: number;
  readonly w?: number;
  readonly h?: number;
}

export type MetadataValue = string | number | boolean | null;

export interface CatalogEntry {
  readonly sourceProjectId: SourceProjectId;
  readonly hostId: HostId;
  readonly repoIdentity: RepoIdentity;
  readonly relativePath: string;
  /**
   * Proposal (issue #1): optional so receivers can verify the SourceProjectId derivation. When
   * present a mismatched derivation rejects the snapshot.
   */
  readonly rootId?: RootId;
  readonly displayName: string;
  readonly revision?: string;
  readonly metadata: Readonly<Record<string, MetadataValue>>;
  readonly previews: readonly PreviewRef[];
}

export interface CatalogSnapshot {
  readonly hostId: HostId;
  /** Source-assigned, strictly increasing per host. */
  readonly generation: number;
  /** Only a complete snapshot may mark omitted entries missing-at-source. */
  readonly complete: boolean;
  readonly observedAt: IsoTime;
  readonly entries: readonly CatalogEntry[];
  /**
   * Proposal (issue #1): host identity fingerprint reported by the source. A change against the
   * enrolled fingerprint is held as a conflict and the snapshot is not applied.
   */
  readonly hostFingerprint?: string;
}

export const FRESHNESS_STATUSES = ['fresh', 'stale', 'offline', 'timeout', 'error', 'partial', 'missing-at-source'] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export interface Freshness {
  readonly status: FreshnessStatus;
  readonly lastSuccessAt: IsoTime | null;
  readonly generation: number | null;
}

/** Explicit association between an editable workspace project and a read-only source entry. */
export interface WorkspaceSourceLink {
  readonly projectId: ProjectId;
  readonly sourceProjectId: SourceProjectId;
  readonly linkedAt: IsoTime;
  readonly observedRevision: string | null;
}

/** Thrown by adapters to distinguish an unreachable source from other failures. */
export class SourceUnavailableError extends Error {
  readonly kind = 'offline' as const;
  constructor(message = 'Source is unreachable') {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

export type AdapterQualification = 'fake' | 'qualified';

/**
 * The entire discovery surface a source may expose. No execution, cloning or writes.
 * Implementations must honour `signal`; callers still enforce their own timeout.
 */
export interface SourceAdapter {
  /** Human-readable label shown in the UI, e.g. "Synthetic fake source". */
  readonly label: string;
  /** `fake` adapters are labelled as such everywhere; `qualified` requires a qualification reference. */
  readonly qualification: AdapterQualification;
  readonly qualificationRef?: string;
  listSnapshot(hostId: HostId, signal: AbortSignal): Promise<CatalogSnapshot>;
  readPreview(ref: PreviewRef, signal: AbortSignal): Promise<Uint8Array>;
}

/** Explicit, user-confirmed enrollment of a host for discovery only. */
export interface SourceEnrollment {
  readonly hostId: HostId;
  readonly label: string;
  readonly adapterKey: string;
  readonly enrolledAt: IsoTime;
  readonly fingerprint?: string;
}

/** Injected time source so timeouts and staleness are deterministic in tests. */
export interface ClockPort {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * The bounded, evictable `cache` namespace. Excluded from bundles, exports and backups.
 * Root adapts the durable store (T9) to this port; discovery never touches `workspace` through it.
 */
export interface CacheStoragePort {
  readonly namespace: 'cache';
  readDocument(key: string): Promise<string | null>;
  writeDocument(key: string, text: string): Promise<void>;
  readBlob(digest: ContentDigest): Promise<Uint8Array | null>;
  writeBlob(digest: ContentDigest, bytes: Uint8Array): Promise<void>;
  deleteBlob(digest: ContentDigest): Promise<void>;
  listBlobs(): Promise<readonly { readonly digest: ContentDigest; readonly bytes: number }[]>;
}

/**
 * The authoritative `workspace` namespace, used only for explicit user actions (evidence adoption,
 * source links). Root adapts the durable store; discovery never writes here on refresh or cache repair.
 */
export interface WorkspaceEvidencePort {
  readonly namespace: 'workspace';
  putEvidenceBlob(digest: ContentDigest, bytes: Uint8Array, mediaType: string): Promise<void>;
}

export const DISCOVERY_STORAGE_NAMESPACES = Object.freeze({
  workspace: Object.freeze({ authoritative: true, editable: true, backup: true }),
  cache: Object.freeze({ authoritative: false, editable: false, backup: false, evictable: true }),
} as const);

// ---- validation -----------------------------------------------------------------------------

const CONTROL = /[\u0000-\u001f\u007f]/u;

export function isBoundedText(value: unknown, max = 160): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !CONTROL.test(value);
}

function brand<K extends string>(kind: K, value: unknown, max: number): Brand<string, K> {
  if (!isBoundedText(value, max)) throw new TypeError(`Invalid ${kind}`);
  return value as Brand<string, K>;
}

export function hostId(value: unknown): HostId { return brand('HostId', value, 160); }
export function rootId(value: unknown): RootId { return brand('RootId', value, 160); }
export function projectId(value: unknown): ProjectId { return brand('ProjectId', value, 160); }

const HEX64 = /^[0-9a-f]{64}$/u;

export function sourceProjectIdFromHex(value: unknown): SourceProjectId {
  if (typeof value !== 'string' || !HEX64.test(value)) throw new TypeError('Invalid SourceProjectId');
  return value as SourceProjectId;
}

export function contentDigest(value: unknown): ContentDigest {
  if (typeof value !== 'string' || !value.startsWith('sha256:') || !HEX64.test(value.slice(7))) {
    throw new TypeError('Invalid ContentDigest');
  }
  return value as ContentDigest;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/u;

export function isoTime(value: unknown): IsoTime {
  if (typeof value !== 'string' || !ISO.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError('Invalid IsoTime');
  }
  return value as IsoTime;
}

export function isoFromMs(ms: number): IsoTime { return new Date(ms).toISOString() as IsoTime; }

/** POSIX-style relative path inside a root: no absolute, parent, empty or backslash segments. */
export function isRelativePath(value: unknown): value is string {
  if (!isBoundedText(value, 1024) || value.includes('\\')) return false;
  if (value === '.') return true;
  if (value.startsWith('/') || /^[a-z]:/iu.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Section-local ports and persisted shapes for HQD-12 imports.
 *
 * These mirror the minimal interface baseline (spec.hq-design#iface.contracts.001)
 * until the root promotes shared types. Nothing here grants filesystem, network
 * or dispatch capability: the root injects a qualified StoragePort later.
 */

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type Brand<K extends string> = string & { readonly __kind: K };
export type ProjectId = Brand<'ProjectId'>;
export type ViewId = Brand<'ViewId'>;
export type VersionId = Brand<'VersionId'>;
export type ImportId = Brand<'ImportId'>;
export type ImportSourceId = Brand<'ImportSourceId'>;
export type RecordId = Brand<'RecordId'>;
/** `sha256:` followed by 64 lowercase hex digits. */
export type Sha256Digest = Brand<'Sha256Digest'>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export class InvalidIdError extends Error {
  readonly kind: string;
  constructor(kind: string, value: unknown) {
    super(`Invalid ${kind}: ${typeof value === 'string' ? JSON.stringify(value.slice(0, 40)) : typeof value}`);
    this.kind = kind;
  }
}

function brand<K extends string>(kind: K, value: unknown): Brand<K> {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new InvalidIdError(kind, value);
  return value as Brand<K>;
}

export const isId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value);
export const projectId = (value: unknown): ProjectId => brand('ProjectId', value);
export const viewId = (value: unknown): ViewId => brand('ViewId', value);
export const versionId = (value: unknown): VersionId => brand('VersionId', value);
export const importId = (value: unknown): ImportId => brand('ImportId', value);
export const importSourceId = (value: unknown): ImportSourceId => brand('ImportSourceId', value);
export const recordId = (value: unknown): RecordId => brand('RecordId', value);

export const isSha256Digest = (value: unknown): value is Sha256Digest => typeof value === 'string' && DIGEST_PATTERN.test(value);
export function sha256Digest(value: unknown): Sha256Digest {
  if (!isSha256Digest(value)) throw new InvalidIdError('Sha256Digest', value);
  return value;
}

// ---------------------------------------------------------------------------
// Injected ports
// ---------------------------------------------------------------------------

/**
 * `workspace` is authoritative, editable and backed up. `draft` holds private
 * unsent drafts and is only exported through the separately chosen draft
 * backup. `cache` is bounded, evictable and never bundled.
 */
export type NamespaceClass = 'workspace' | 'draft' | 'cache';
export const NAMESPACE_CLASSES: readonly NamespaceClass[] = ['workspace', 'draft', 'cache'];

export interface NamespaceInfo {
  readonly name: string;
  readonly class: NamespaceClass;
}

export interface StoredDocument {
  readonly key: string;
  readonly value: JsonValue;
  /** Opaque store-assigned revision used only for compare-and-swap. */
  readonly revision: string;
}

export interface BlobInfo {
  readonly digest: Sha256Digest;
  readonly mediaType: string;
  readonly bytes: number;
}

export interface StoredEvent {
  /** 1-based, contiguous per stream. */
  readonly seq: number;
  readonly payload: JsonValue;
}

export type WriteOp =
  | { readonly op: 'put-document'; readonly namespace: string; readonly key: string; readonly value: JsonValue; readonly expectedRevision: string | null }
  | { readonly op: 'put-blob'; readonly namespace: string; readonly digest: Sha256Digest; readonly mediaType: string; readonly bytes: Uint8Array }
  | { readonly op: 'append-event'; readonly namespace: string; readonly stream: string; readonly payload: JsonValue; readonly expectedSeq: number };

/**
 * Namespaced documents, immutable content-addressed blobs and append-only
 * events. `commit` is atomic across all ops (the store's durable-manifest
 * transaction); a compare-and-swap mismatch rejects the whole batch.
 * There is deliberately no delete: removal is a tombstone document.
 */
export interface StoragePort {
  namespaces(): Promise<readonly NamespaceInfo[]>;
  getDocument(namespace: string, key: string): Promise<StoredDocument | null>;
  /** Sorted by key (UTF-16 code unit order). */
  listDocuments(namespace: string, prefix?: string): Promise<readonly StoredDocument[]>;
  getBlob(namespace: string, digest: Sha256Digest): Promise<Uint8Array | null>;
  /** Sorted by digest. */
  listBlobs(namespace: string): Promise<readonly BlobInfo[]>;
  /** Sorted by name. */
  listStreams(namespace: string): Promise<readonly string[]>;
  readEvents(namespace: string, stream: string): Promise<readonly StoredEvent[]>;
  commit(ops: readonly WriteOp[]): Promise<void>;
}

export class StorageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConflictError';
  }
}

export interface ClockPort {
  /** ISO-8601 UTC instant. */
  now(): string;
}

export interface DigestPort {
  /** Lowercase hex SHA-256 of the bytes. */
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

// ---------------------------------------------------------------------------
// Rights and provenance
// ---------------------------------------------------------------------------

/** Basis under which the owner may import a design file. There is no `unknown`. */
export type RightsBasis = 'owned' | 'licensed' | 'permission' | 'public-domain';
export const RIGHTS_BASES: readonly RightsBasis[] = ['owned', 'licensed', 'permission', 'public-domain'];

export interface Rights {
  readonly basis: RightsBasis;
  readonly holder: string;
  readonly license?: string;
  readonly attribution?: string;
}

export interface ItemProvenance {
  readonly originalName?: string;
  readonly author?: string;
  readonly capturedAt?: string;
  readonly note?: string;
}

export interface VersionProvenance extends ItemProvenance {
  readonly sourceKind: string;
  readonly sourceVersion: number;
  readonly sourceId: ImportSourceId;
  readonly itemKey: string;
  readonly itemDigest: Sha256Digest;
  readonly mappingId: string;
  readonly mappingVersion: number;
  readonly importId: ImportId;
  readonly importedAt: string;
}

// ---------------------------------------------------------------------------
// Import input
// ---------------------------------------------------------------------------

export interface SourceFile {
  /** Relative POSIX path inside an HTML bundle. */
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export type SourcePayload =
  | { readonly kind: 'png'; readonly bytes: Uint8Array }
  | { readonly kind: 'recording'; readonly mediaType: string; readonly bytes: Uint8Array }
  | { readonly kind: 'html-bundle'; readonly entry: string; readonly files: readonly SourceFile[] }
  | { readonly kind: 'url'; readonly url: string };

export interface SourceItem {
  /** Stable key inside the source (never the display title). */
  readonly key: string;
  readonly title: string;
  readonly rights: Rights;
  readonly provenance?: ItemProvenance;
  /** Import as a new version of an existing view instead of a derived view. */
  readonly viewId?: ViewId;
  readonly payload: SourcePayload;
}

export interface ImportSource {
  /** Source format family, e.g. `hq.files`; legacy adapters register their own. */
  readonly kind: string;
  readonly version: number;
  readonly sourceId: ImportSourceId;
  readonly items: readonly SourceItem[];
}

// ---------------------------------------------------------------------------
// Persisted version content
// ---------------------------------------------------------------------------

export interface BundleFileRef {
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly mediaType: string;
  readonly bytes: number;
}

export type VersionContent =
  | { readonly kind: 'image'; readonly mediaType: 'image/png'; readonly digest: Sha256Digest; readonly bytes: number; readonly w: number; readonly h: number }
  | { readonly kind: 'recording'; readonly mediaType: string; readonly digest: Sha256Digest; readonly bytes: number }
  | { readonly kind: 'html-bundle'; readonly entry: string; readonly files: readonly BundleFileRef[] }
  | { readonly kind: 'url'; readonly url: string };

export const SCHEMAS = {
  import: 'hq.design.import/v1',
  bundle: 'hq.design.bundle/v1',
  record: 'hq.design.imported-record/v1',
  version: 'hq.design.view-version/v1',
  conflict: 'hq.design.import-conflict/v1',
  undo: 'hq.design.import-undo/v1',
} as const;

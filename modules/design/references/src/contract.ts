/**
 * Section-local contract for the Design reference library (T8 / HQD-07).
 *
 * These types and ports satisfy the first-deliverable interface baseline until
 * T1 promotes shared shapes. Nothing here grants filesystem, network or
 * dispatch capability; root wires concrete adapters after qualification.
 */

export type Brand<K extends string> = string & { readonly __kind: K };

export type ReferenceId = Brand<'ReferenceId'>;
export type CollectionId = Brand<'CollectionId'>;
export type ReferenceUseId = Brand<'ReferenceUseId'>;
export type ProjectId = Brand<'ProjectId'>;
export type ViewId = Brand<'ViewId'>;
/** `sha256:<64 lowercase hex>` content address of an immutable blob. */
export type BlobDigest = Brand<'BlobDigest'>;
/** Normalized lowercase tag. */
export type ReferenceTag = Brand<'ReferenceTag'>;

export const LIBRARY_SCHEMA = 'hq.design.references/v1';
export const EXPORT_SCHEMA = 'hq.design.references-export/v1';
export const LIBRARY_DOCUMENT_KEY = 'design/references/library';

/** How the reference was captured. This is provenance, never an execution claim. */
export const REFERENCE_KINDS = ['screenshot', 'recording', 'web-prototype', 'native'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export const CLAIM_LEVELS = ['agent-reported', 'observed', 'owner-judged'] as const;
export type ClaimLevel = (typeof CLAIM_LEVELS)[number];

export const APP_PLATFORMS = ['ios', 'ipados', 'android', 'macos', 'windows', 'linux', 'watchos', 'tvos', 'visionos'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export const NATIVE_RUNTIMES = ['device', 'simulator', 'emulator'] as const;
export type NativeRuntime = (typeof NATIVE_RUNTIMES)[number];

export const RIGHTS_STATUSES = ['permitted', 'restricted', 'unknown'] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

/** Normalized source identity. Display names never participate in identity. */
export type ReferenceSource =
  | { readonly kind: 'url'; readonly url: string }
  | {
    readonly kind: 'app';
    readonly platform: AppPlatform;
    /** Bundle or package identifier, e.g. `com.example.notes`. */
    readonly appId: string;
    readonly appName: string;
    /** Optional stable screen/route key inside the app. */
    readonly screen: string | null;
  };

export interface AssetRef {
  readonly digest: BlobDigest;
  readonly mediaType: string;
  readonly bytes: number;
  readonly w: number | null;
  readonly h: number | null;
  readonly durationMs: number | null;
}

/**
 * Only a `native` reference may carry this. It records who observed the app
 * running natively; a screenshot or recording of a native app never does.
 */
export interface NativeExecutionEvidence {
  readonly platform: AppPlatform;
  readonly runtime: NativeRuntime;
  readonly buildRef: string;
  readonly claim: ClaimLevel;
}

/** Publication requires an explicit `permitted` status with a stated basis. */
export interface ReferenceRights {
  readonly status: RightsStatus;
  readonly basis: string | null;
  readonly attribution: string | null;
  readonly setBy: ClaimLevel;
  readonly setAt: string;
}

export interface ReferenceRecord {
  readonly id: ReferenceId;
  readonly kind: ReferenceKind;
  readonly source: ReferenceSource;
  readonly asset: AssetRef | null;
  readonly capturedAt: string;
  readonly capturedBy: ClaimLevel;
  readonly nativeEvidence: NativeExecutionEvidence | null;
  readonly title: string;
  readonly notes: string;
  readonly tags: readonly ReferenceTag[];
  readonly rights: ReferenceRights;
  readonly importedAt: string;
  readonly lastImportedAt: string;
  readonly importCount: number;
  readonly tombstonedAt: string | null;
}

export interface ReferenceCollection {
  readonly id: CollectionId;
  readonly name: string;
  readonly description: string;
  readonly referenceIds: readonly ReferenceId[];
  readonly createdAt: string;
  readonly tombstonedAt: string | null;
}

/** Explicit "use in project" link. Creating one never launches work. */
export interface ReferenceUse {
  readonly id: ReferenceUseId;
  readonly referenceId: ReferenceId;
  readonly projectId: ProjectId;
  readonly viewId: ViewId | null;
  readonly purpose: string;
  readonly linkedAt: string;
  readonly tombstonedAt: string | null;
}

export interface LibraryState {
  readonly schema: typeof LIBRARY_SCHEMA;
  readonly references: Readonly<Record<string, ReferenceRecord>>;
  readonly collections: Readonly<Record<string, ReferenceCollection>>;
  readonly uses: Readonly<Record<string, ReferenceUse>>;
}

/** Asset supplied by an importer: raw bytes, or an already stored blob. */
export type ImportAsset =
  | { readonly bytes: Uint8Array; readonly mediaType: string; readonly w?: number; readonly h?: number; readonly durationMs?: number }
  | { readonly digest: string; readonly byteLength: number; readonly mediaType: string; readonly w?: number; readonly h?: number; readonly durationMs?: number };

export type ImportSource =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'app'; readonly platform: string; readonly appId: string; readonly appName: string; readonly screen?: string };

/** Entry point for HQD-12 imports and manual capture. */
export interface ReferenceImportCandidate {
  readonly kind: string;
  readonly source: ImportSource;
  readonly capturedAt: string;
  readonly capturedBy: string;
  readonly title: string;
  readonly notes?: string;
  readonly tags?: readonly string[];
  readonly asset?: ImportAsset;
  readonly rights?: { readonly status: string; readonly basis?: string; readonly attribution?: string };
  readonly nativeEvidence?: { readonly platform: string; readonly runtime: string; readonly buildRef: string; readonly claim: string };
  readonly collectionIds?: readonly string[];
}

export interface ValidationIssue {
  readonly field: string;
  readonly code: string;
}

export type ImportOutcome =
  | { readonly status: 'created'; readonly id: ReferenceId }
  /** Same identity seen again; owner-edited fields are never overwritten. */
  | { readonly status: 'unchanged' | 'observed-again'; readonly id: ReferenceId; readonly differences: readonly string[] }
  /** Same identity as a tombstoned reference; it stays tombstoned until explicitly restored. */
  | { readonly status: 'tombstoned'; readonly id: ReferenceId; readonly differences: readonly string[] }
  | { readonly status: 'rejected'; readonly issues: readonly ValidationIssue[] };

/* ----------------------------------------------------------------- ports -- */

export interface StoredDocument {
  readonly value: unknown;
  readonly revision: string;
}

export type DocumentWriteResult =
  | { readonly ok: true; readonly revision: string }
  | { readonly ok: false; readonly reason: 'conflict' | 'read-only' };

/**
 * Subset of the shared StoragePort used by this section. It deliberately has
 * no blob deletion: the library can tombstone records but cannot remove bytes.
 */
export interface ReferenceStoragePort {
  /** Adapter identity, e.g. `fake:memory-storage`; shown in diagnostics. */
  readonly label: string;
  readDocument(namespace: 'workspace', key: string): Promise<StoredDocument | null>;
  writeDocument(namespace: 'workspace', key: string, value: unknown, expectedRevision: string | null): Promise<DocumentWriteResult>;
  putBlob(bytes: Uint8Array, mediaType: string): Promise<{ readonly digest: BlobDigest; readonly bytes: number }>;
  hasBlob(digest: BlobDigest): Promise<boolean>;
}

export interface ClockPort {
  readonly label: string;
  /** ISO-8601 UTC timestamp. */
  now(): string;
}

/** Opaque identifiers for owner-created records (never derived from titles). */
export interface IdPort {
  readonly label: string;
  next(prefix: 'col' | 'use'): string;
}

export interface ReferencePorts {
  readonly storage: ReferenceStoragePort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

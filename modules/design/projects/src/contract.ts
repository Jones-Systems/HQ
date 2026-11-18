/**
 * Section-local ports for the projects section (T2 / HQD-01).
 *
 * These are the injected boundaries root wires at integration. They satisfy
 * the first-deliverable prerequisite until shared types are promoted through
 * the coordination issue; nothing here imports another Design section.
 */
import type { HostId, ProjectId, SourceProjectId } from './ids.ts';

// ---------------------------------------------------------------- storage

/** The only namespace this section writes. Drafts, cache and journals belong to other owners. */
export const WORKSPACE_NAMESPACE = 'workspace';
/** Every document this section writes lives under this key prefix in the workspace namespace. */
export const PROJECTS_KEY_PREFIX = 'design.projects/';

export interface StoredDocument {
  /** Opaque revision for compare-and-swap; changes on every successful write. */
  readonly revision: string;
  readonly value: unknown;
}

export class StorageConflictError extends Error {
  constructor(key: string) {
    super(`Document ${key} changed since it was read`);
    this.name = 'StorageConflictError';
  }
}

/**
 * Namespaced document port. Per-document writes are atomic in the store owner's
 * adapter; this section never assumes atomicity across documents.
 */
export interface ProjectStoragePort {
  readDocument(namespace: string, key: string): Promise<StoredDocument | null>;
  /**
   * Writes one document. `expectedRevision: null` means "must not exist yet".
   * Rejects with StorageConflictError on a revision mismatch.
   */
  writeDocument(namespace: string, key: string, value: unknown,
    options: { readonly expectedRevision: string | null }): Promise<{ readonly revision: string }>;
}

// --------------------------------------------------------------- registry

export interface ProjectRecord {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: string;
}

/** Where project identity comes from. The provisional adapter must say so visibly. */
export type RegistryProvenance =
  | { readonly kind: 'provisional-local'; readonly label: string }
  | { readonly kind: 'hq-shared'; readonly label: string };

/**
 * Project identity (id + name). At integration root supplies an adapter over the
 * HQ foundation's shared registry; this section never creates a second global one.
 */
export interface ProjectRegistryPort {
  readonly provenance: RegistryProvenance;
  list(): Promise<readonly ProjectRecord[]>;
  create(input: { readonly name: string }): Promise<ProjectRecord>;
}

// ------------------------------------------------------------- previews

/** `hq.design.source-catalog/v1` PreviewRef. Digest is `sha256:<64 lowercase hex>`. */
export interface PreviewRef {
  readonly digest: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly w?: number;
  readonly h?: number;
}

export interface PreviewBytes {
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/** Fetches selected preview bytes on demand. Cache ownership stays with the store/discovery owners. */
export interface ThumbnailPort {
  readThumbnail(ref: PreviewRef, signal: AbortSignal): Promise<PreviewBytes>;
}

// --------------------------------------------------------- source catalog

export type FreshnessStatus = 'fresh' | 'stale' | 'offline' | 'timeout' | 'error' | 'partial' | 'missing-at-source';
export const FRESHNESS_STATUSES: readonly FreshnessStatus[] =
  ['fresh', 'stale', 'offline', 'timeout', 'error', 'partial', 'missing-at-source'];

export interface Freshness {
  readonly status: FreshnessStatus;
  readonly lastSuccessAt: string | null;
  readonly generation: number;
}

export interface RepoIdentity {
  readonly normalizedRemote?: string;
  readonly rootCommit?: string;
  readonly localOnly: boolean;
}

/** Read-only catalog entry as projected for display. Never editable from this section. */
export interface CatalogEntryView {
  readonly sourceProjectId: SourceProjectId;
  readonly hostId: HostId;
  readonly hostLabel: string;
  readonly repoIdentity: RepoIdentity;
  readonly relativePath: string;
  readonly displayName: string;
  readonly revision?: string;
  readonly previews: readonly PreviewRef[];
  readonly freshness: Freshness;
}

/**
 * Synchronous read of the already-cached catalog plus change notification.
 * Rendering never waits on a network refresh; discovery owns refresh.
 */
export interface CatalogReadPort {
  current(): readonly CatalogEntryView[];
  subscribe(listener: () => void): () => void;
}

/** Explicit link; matching titles or remotes never create one. */
export interface WorkspaceSourceLink {
  readonly projectId: ProjectId;
  readonly sourceProjectId: SourceProjectId;
  readonly linkedAt: string;
  readonly observedRevision: string | null;
}

// ------------------------------------------------------------------ clock

export interface ClockPort {
  now(): string;
}

export const systemClock: ClockPort = { now: () => new Date().toISOString() };

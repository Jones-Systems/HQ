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

export interface CatalogRoot { readonly rootId: RootId; readonly label: string }
export interface CatalogParams {
  readonly 'catalog.roots': Record<string, never>;
  readonly 'catalog.chooseRoot': Record<string, never>;
  readonly 'catalog.forget': Record<string, never>;
  readonly 'catalog.snapshot': Record<string, never>;
  readonly 'catalog.preview': { readonly ref: PreviewRef };
}
export interface CatalogValues {
  readonly 'catalog.roots': readonly CatalogRoot[];
  readonly 'catalog.chooseRoot': readonly CatalogRoot[];
  readonly 'catalog.forget': readonly CatalogRoot[];
  readonly 'catalog.snapshot': CatalogSnapshot;
  readonly 'catalog.preview': Uint8Array;
}

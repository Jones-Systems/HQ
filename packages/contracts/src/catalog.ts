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

export interface SourceStatus {
  readonly sourceId: string; readonly kind: 'local' | 'gallery' | 'jones'; readonly label: string;
  readonly hostId: string; readonly rootId: string; readonly state: 'ready' | 'partial' | 'stale' | 'unavailable' | 'not-configured';
  readonly generation: number; readonly lastSuccessAt: string | null; readonly detail?: string;
}
export interface SourceCatalogItem { readonly entry: CatalogEntry; readonly hostLabel: string; readonly freshness: string }
export interface SourceParams {
  readonly status: Record<string, never>;
  readonly list: Record<string, never>;
  readonly chooseLocal: Record<string, never>;
  readonly enrollGallery: { readonly baseUrl: string; readonly label: string };
  readonly enrollJones: { readonly label: string };
  readonly refresh: { readonly sourceId: string };
  readonly remove: { readonly sourceId: string };
}
export interface SourceValues {
  readonly status: readonly SourceStatus[]; readonly list: readonly SourceCatalogItem[];
  readonly chooseLocal: readonly SourceStatus[]; readonly enrollGallery: readonly SourceStatus[];
  readonly enrollJones: readonly SourceStatus[]; readonly refresh: readonly SourceStatus[]; readonly remove: readonly SourceStatus[];
}
export type SourceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly kind: 'invalid' | 'unavailable' | 'stale' };
export interface SourceTransport { call<R extends keyof SourceParams>(route: R, params: SourceParams[R]): Promise<SourceResult<SourceValues[R]>> }

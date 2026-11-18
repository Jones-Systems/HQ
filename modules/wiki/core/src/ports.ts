// Ports of the Wiki core: the pure, Git-shaped source port, the snapshot store and the clock.
// Nothing here touches a filesystem, Git or the network; adapters implement these.

import type { WikiNamespace } from '../../contract/src/index.ts';
import type { IndexSnapshot } from './snapshot.ts';

/** Why a source operation could not produce a value. Errors are data, never exceptions. */
export type SourceFailureReason = 'unavailable' | 'not-found' | 'too-large';

export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: SourceFailureReason };

/** The pinned state of a source after its binding checks (remote, bare directory, ref) passed. */
export interface Pin {
  /** Plain ref label, e.g. `main`. */
  readonly ref: string;
  /** Lowercase hex commit id (40 or 64 characters). */
  readonly commit: string;
  /** ISO-8601 UTC commit time (`YYYY-MM-DDTHH:mm:ss[.fff]Z`). */
  readonly commitTime: string;
}

export interface TreeEntry {
  /** Full repository-relative path, slash separated. */
  readonly path: string;
  /** Git file mode as a string, e.g. `100644`. Only regular blobs (`100644`, `100755`) are pages. */
  readonly mode: string;
  /** Lowercase hex object id. */
  readonly oid: string;
  /** Blob size in bytes; null for entries that are not blobs. */
  readonly size: number | null;
}

/** Entries an adapter chose not to list, counted so a mismatch is visible instead of silent. */
export interface SkippedEntries {
  readonly symlinks: number;
  readonly submodules: number;
  readonly other: number;
  readonly invalidPaths: number;
}

export interface TreeListing {
  readonly entries: readonly TreeEntry[];
  readonly skipped: SkippedEntries;
}

/**
 * Read-only access to one pinned, committed source. A page is never a filesystem path: the core
 * only ever asks for a tree of a commit and for blobs by object id.
 */
export interface GitObjectSource {
  /** Verify the binding (remote, bare directory, ref) and resolve the ref to a commit. */
  resolvePin(): Promise<SourceResult<Pin>>;
  /** Every tree entry of `commit` (all depths, full paths). */
  listTree(commit: string): Promise<SourceResult<TreeListing>>;
  /** Blob bytes. A blob larger than `maxBytes` is refused (`too-large`), never truncated. */
  readBlob(oid: string, maxBytes: number): Promise<SourceResult<Uint8Array>>;
}

/** Persistence for index snapshots, keyed by namespace and commit. The core never chooses where. */
export interface IndexStore {
  /** The stored snapshot value for (namespace, commit), or null. The value is untrusted and re-validated. */
  read(namespace: WikiNamespace, commit: string): Promise<unknown>;
  write(namespace: WikiNamespace, commit: string, snapshot: IndexSnapshot): Promise<void>;
}

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

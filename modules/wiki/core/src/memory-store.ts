// In-memory IndexStore for tests and tooling. It stores serialised JSON, so a read always returns a
// fresh, untrusted value exactly as a persistent store would.

import type { WikiNamespace } from '../../contract/src/index.ts';
import type { IndexStore } from './ports.ts';
import type { IndexSnapshot } from './snapshot.ts';

export interface MemoryIndexStore extends IndexStore {
  /** Serialised snapshots by `<namespace>/<commit>`; tests may corrupt entries to exercise rebuilds. */
  readonly entries: Map<string, string>;
}

export function snapshotStoreKey(namespace: WikiNamespace, commit: string): string {
  return `${namespace}/${commit}`;
}

export function createMemoryIndexStore(): MemoryIndexStore {
  const entries = new Map<string, string>();
  return {
    entries,
    read(namespace, commit) {
      const text = entries.get(snapshotStoreKey(namespace, commit));
      if (text === undefined) return Promise.resolve(null);
      try {
        return Promise.resolve(JSON.parse(text) as unknown);
      } catch {
        return Promise.resolve(null);
      }
    },
    write(namespace, commit, snapshot: IndexSnapshot) {
      entries.set(snapshotStoreKey(namespace, commit), JSON.stringify(snapshot));
      return Promise.resolve();
    },
  };
}

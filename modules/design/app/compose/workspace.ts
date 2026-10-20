/** Each workspace owns its section caches. Null preserves the labelled in-memory composition. */
import { FAKE_TAG as fakeStorageTag } from './labels.ts';
import type { WorkspaceRecords } from '../storage/index.ts';
import { createClosureWorkspace } from './closure-workspace.ts';
import * as fake from './fake-workspace.ts';
import { createBridgedWorkspace } from './bridged-workspace.ts';
export * from './fake-workspace.ts';
export function createDesignWorkspace(documents: WorkspaceRecords | null) {
  const closure = createClosureWorkspace(documents);
  return documents === null ? { ...fake, closure, bridged: false as const, storageTag: fakeStorageTag } : { ...createBridgedWorkspace(documents), closure };
}
export type DesignWorkspace = ReturnType<typeof createDesignWorkspace>;

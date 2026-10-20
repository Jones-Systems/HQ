/** Each workspace owns its section caches. Null preserves the labelled in-memory composition. */
import { FAKE_TAG as fakeStorageTag } from './labels.ts';
import type { WorkspaceDocuments } from '../storage/index.ts';
import * as fake from './fake-workspace.ts';
import { createBridgedWorkspace } from './bridged-workspace.ts';
export * from './fake-workspace.ts';
export function createDesignWorkspace(documents: WorkspaceDocuments | null) {
  return documents === null ? { ...fake, bridged: false as const, storageTag: fakeStorageTag } : createBridgedWorkspace(documents);
}
export type DesignWorkspace = ReturnType<typeof createDesignWorkspace>;

/** Each workspace owns its section caches. Null preserves the labelled in-memory composition. */
import { FAKE_TAG as fakeStorageTag } from './labels.ts';
import type { WorkspaceRecords } from '../storage/index.ts';
import { createClosureWorkspace } from './closure-workspace.ts';
import type { DesignRuntimePorts } from './runtime-ports.ts';
import { createInteractiveWorkspace } from './interactive-workspace.ts';
import * as fake from './fake-workspace.ts';
import { createBridgedWorkspace } from './bridged-workspace.ts';
export * from './fake-workspace.ts';
export function createDesignWorkspace(documents: WorkspaceRecords | null, ports: DesignRuntimePorts = {}) {
  const closure = createClosureWorkspace(documents, ports.runsConnection);
  const interactive = createInteractiveWorkspace(documents, closure.requests, ports);
  return documents === null ? { ...fake, closure, interactive, bridged: false as const, storageTag: fakeStorageTag } : { ...createBridgedWorkspace(documents), closure, interactive };
}
export type DesignWorkspace = ReturnType<typeof createDesignWorkspace>;

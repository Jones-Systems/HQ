/** Each workspace owns its section caches. Null preserves the labelled in-memory composition. */
import { FAKE_TAG as fakeStorageTag } from './labels.ts';
import type { WorkspaceRecords } from '../storage/index.ts';
import { createClosureWorkspace } from './closure-workspace.ts';
import type { DesignRuntimePorts } from './runtime-ports.ts';
import { createInteractiveWorkspace } from './interactive-workspace.ts';
import * as fake from './fake-workspace.ts';
import { createBridgedWorkspace } from './bridged-workspace.ts';
import { createProjectContentEvents } from './content-events.ts';
export * from './fake-workspace.ts';
/** The fake's fixtures never change and never fail, so there is nothing to build again. */
const retryNothing = (_projectId: string): void => undefined;
export function createDesignWorkspace(documents: WorkspaceRecords | null, ports: DesignRuntimePorts = {}) {
  // One change feed per composition: every project-content writer notifies it, cached readers subscribe.
  const contentEvents = createProjectContentEvents();
  const closure = createClosureWorkspace(documents, ports.runsConnection);
  const interactive = createInteractiveWorkspace(documents, closure.requests, ports, contentEvents);
  return documents === null ? { ...fake, closure, interactive, contentEvents, retry: retryNothing, bridged: false as const, storageTag: fakeStorageTag }
    : { ...createBridgedWorkspace(documents, { contentEvents }), closure, interactive };
}
export type DesignWorkspace = ReturnType<typeof createDesignWorkspace>;

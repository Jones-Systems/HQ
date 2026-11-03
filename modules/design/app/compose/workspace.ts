/** Each workspace owns its section caches. Null preserves the labelled in-memory composition. */
import type { ProjectContext } from '@hq/contracts';
import { FAKE_TAG as fakeStorageTag } from './labels.ts';
import type { WorkspaceRecords } from '../storage/index.ts';
import type { ProjectContent } from '../../projects/src/content.ts';
import type { ProjectContentRepository } from '../../projects/src/repository.ts';
import { createClosureWorkspace } from './closure-workspace.ts';
import type { DesignRuntimePorts } from './runtime-ports.ts';
import { createInteractiveWorkspace } from './interactive-workspace.ts';
import * as fake from './fake-workspace.ts';
import { createBridgedWorkspace } from './bridged-workspace.ts';
import { createActiveProjectStore } from './active-project.ts';
export * from './fake-workspace.ts';

type ContentFor = (project: ProjectContext) => Promise<{ readonly repository: ProjectContentRepository; readonly content: ProjectContent }>;

/**
 * Project content as stored now. `contentFor` keeps the content it first loaded for the section caches;
 * views that list versions read again on mount so versions added in Projects appear without a reload.
 */
function freshContent(contentFor: ContentFor) {
  return async (project: ProjectContext): Promise<ProjectContent> => {
    const env = await contentFor(project);
    const loaded = await env.repository.load(env.content.projectId);
    return loaded.status === 'ok' ? loaded.content : env.content;
  };
}

export function createDesignWorkspace(documents: WorkspaceRecords | null, ports: DesignRuntimePorts = {}) {
  const closure = createClosureWorkspace(documents, ports.runsConnection);
  const interactive = createInteractiveWorkspace(documents, closure.requests, ports);
  const activeProject = createActiveProjectStore();
  if (documents === null) return { ...fake, closure, interactive, activeProject, readContent: freshContent(fake.contentFor), bridged: false as const, storageTag: fakeStorageTag };
  const bridged = createBridgedWorkspace(documents);
  return { ...bridged, closure, interactive, activeProject, readContent: freshContent(bridged.contentFor) };
}
export type DesignWorkspace = ReturnType<typeof createDesignWorkspace>;

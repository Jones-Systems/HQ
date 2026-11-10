/**
 * The durable Imports environment (B3 backend contract, section 12): real picker, the real local store through
 * the document bridge, and project-content linking in the same atomic commit.
 *
 * It exposes the controller's `deps` and `capabilities` and nothing more. `saveBundle` stays undefined: the bridge
 * has no route to list blobs, so backup and export cannot be built here and the export action fails safely instead.
 */
import type { DesignServiceTransport } from '@hq/contracts/services';
import type { ClockPort } from '../../projects/src/contract.ts';
import { contentKey, type ProjectContentRepository } from '../../projects/src/repository.ts';
import { projectId } from '../../projects/src/ids.ts';
import { PROJECTS_KEY_ROOT, type WorkspaceDocuments } from '../storage/index.ts';
import { DesignBridgeError } from './bridge-documents.ts';
import type { ProjectContentEvents } from './content-events.ts';
import { designFailure, DesignOperationError } from './errors.ts';
import type { ImportsEnv } from './fake-workspace.ts';
import { createImportsContentLink } from './imports-content-link.ts';
import { createImportsPickSource } from './imports-pick.ts';
import { createImportsBridgeStorage, IMPORTS_CONTEXTS, typeImportsStorage } from './imports-storage.ts';

export interface DurableImportsOptions {
  readonly transport: DesignServiceTransport;
  readonly documents: WorkspaceDocuments;
  readonly repository: Pick<ProjectContentRepository, 'load'>;
  readonly clock: ClockPort;
  readonly contentEvents: Pick<ProjectContentEvents, 'notify'>;
}

/**
 * The host key of a project's content document, built the way the Projects storage port builds it: the fixed Projects
 * root plus the content key of a validated project ID. Compose reaches storage only through `storage/index.ts`, so the
 * section key helper is not imported; the host re-checks every key against its own document roots.
 */
function projectContentKey(documents: WorkspaceDocuments, project: string): string {
  if (documents.kind !== 'workspace' || documents.namespace !== 'workspace') throw new DesignBridgeError('invalid');
  const key = PROJECTS_KEY_ROOT + contentKey(projectId(project));
  if (key.length > 256) throw new DesignBridgeError('invalid');
  return key;
}

export function createDurableImportsEnv(options: DurableImportsOptions): ImportsEnv {
  const link = createImportsContentLink({
    repository: options.repository, clock: options.clock, notify: (project) => options.contentEvents.notify(project),
    documentKey: (project) => projectContentKey(options.documents, project),
  });
  return {
    deps: { storage: typeImportsStorage(createImportsBridgeStorage({ transport: options.transport, link })), clock: options.clock },
    // No saveBundle: see the module note.
    capabilities: { pickSource: createImportsPickSource(options.transport) },
  };
}

/** For a workspace whose documents were not built on the bridge: nothing can be chosen or stored, and it says so. */
export function createUnavailableImportsEnv(clock: ClockPort): ImportsEnv {
  const refuse = async (): Promise<never> => {
    throw new DesignOperationError(designFailure('disabled', IMPORTS_CONTEXTS.read, {
      reason: 'disabled', message: 'Imports are not available in this build', description: 'Nothing was changed.',
    }));
  };
  return {
    deps: {
      storage: {
        namespaces: refuse, getDocument: refuse, listDocuments: refuse, getBlob: refuse, listBlobs: refuse, listStreams: refuse,
        readEvents: refuse, commit: refuse,
      },
      clock,
    },
    capabilities: {},
  };
}

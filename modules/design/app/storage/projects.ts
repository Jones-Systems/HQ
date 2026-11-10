import { StorageConflictError } from '../../projects/src/contract.ts';
import { isStoreErrorCode, type JsonValue, type WorkspaceDocuments } from './backing.ts';
import { PROJECTS_KEY_ROOT, sectionKey } from './section-documents.ts';

/** Structurally the projects lane's ProjectStoragePort. */
export interface ProjectDocumentPort {
  readDocument(namespace: string, key: string): Promise<{ readonly revision: string; readonly value: unknown } | null>;
  writeDocument(namespace: string, key: string, value: unknown,
    options: { readonly expectedRevision: string | null }): Promise<{ readonly revision: string }>;
}

export function createProjectsStorage(workspace: WorkspaceDocuments): ProjectDocumentPort {
  const scoped = sectionKey(workspace, PROJECTS_KEY_ROOT);
  const port: ProjectDocumentPort = {
    async readDocument(namespace, key) {
      const stored = await workspace.getDocument(scoped(namespace, key));
      return stored ? { revision: String(stored.revision), value: stored.value } : null;
    },
    async writeDocument(namespace, key, value, { expectedRevision }) {
      const id = scoped(namespace, key);
      let revision: number | null = null;
      if (expectedRevision !== null) {
        if (typeof expectedRevision !== 'string' || !/^[1-9][0-9]*$/u.test(expectedRevision)
          || !Number.isSafeInteger(Number(expectedRevision))) throw new StorageConflictError(key);
        revision = Number(expectedRevision);
      }
      try {
        // T9 validates the original value; do not serialize away unsupported members.
        const stored = await workspace.putDocument(id, value as JsonValue, { expectedRevision: revision });
        return { revision: String(stored.revision) };
      } catch (error) {
        if (isStoreErrorCode(error, 'conflict')) throw new StorageConflictError(key);
        throw error;
      }
    },
  };
  return Object.freeze(port);
}

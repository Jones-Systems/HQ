import type { JsonValue, WorkspaceDocuments } from './backing.ts';
import { COMPONENTS_KEY_ROOT, sectionKey } from './section-documents.ts';

export interface ComponentDocumentPort {
  readDocument(namespace: 'workspace', key: string): Promise<unknown>;
  writeDocument(namespace: 'workspace', key: string, value: unknown): Promise<void>;
  listKeys(namespace: 'workspace', prefix: string): Promise<readonly string[]>;
}

export function createComponentsStorage(workspace: WorkspaceDocuments): ComponentDocumentPort {
  const scoped = sectionKey(workspace, COMPONENTS_KEY_ROOT);
  const port: ComponentDocumentPort = {
    async readDocument(namespace, key) {
      const stored = await workspace.getDocument(scoped(namespace, key));
      return stored ? stored.value : undefined;
    },
    async writeDocument(namespace, key, value) {
      await workspace.putDocument(scoped(namespace, key), value as JsonValue);
    },
    async listKeys(namespace, prefix) {
      return (await workspace.listDocuments(scoped(namespace, prefix, true))).map((key) => key.slice(COMPONENTS_KEY_ROOT.length));
    },
  };
  return Object.freeze(port);
}

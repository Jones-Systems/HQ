import type { JsonValue, WorkspaceDocuments } from './backing.ts';
import { DEVICE_STORAGE_LABEL, FLOWS_KEY_ROOT, sectionKey } from './section-documents.ts';

export interface FlowDocumentPort {
  readonly label: string;
  getDocument(namespace: 'workspace', key: string): Promise<unknown>;
  putDocument(namespace: 'workspace', key: string, value: unknown): Promise<void>;
  listKeys(namespace: 'workspace', prefix: string): Promise<readonly string[]>;
}

export function createFlowsStorage(workspace: WorkspaceDocuments): FlowDocumentPort {
  const scoped = sectionKey(workspace, FLOWS_KEY_ROOT);
  const port: FlowDocumentPort = {
    label: DEVICE_STORAGE_LABEL,
    async getDocument(namespace, key) {
      const stored = await workspace.getDocument(scoped(namespace, key));
      return stored ? stored.value : undefined;
    },
    async putDocument(namespace, key, value) {
      await workspace.putDocument(scoped(namespace, key), value as JsonValue);
    },
    async listKeys(namespace, prefix) {
      return (await workspace.listDocuments(scoped(namespace, prefix, true))).map((key) => key.slice(FLOWS_KEY_ROOT.length));
    },
  };
  return Object.freeze(port);
}

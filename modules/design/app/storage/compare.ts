import type { WorkspaceDocuments } from './backing.ts';
import { COMPARE_KEY_ROOT, sectionKey, SectionStorageScopeError } from './section-documents.ts';
import { TEXT_FORMAT } from './text-envelope.ts';

export interface CompareDocumentPort {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

export function createCompareStorage(workspace: WorkspaceDocuments): CompareDocumentPort {
  const scoped = sectionKey(workspace, COMPARE_KEY_ROOT);
  const port: CompareDocumentPort = {
    async read(key) {
      const stored = await workspace.getDocument(scoped('workspace', key));
      if (!stored) return null;
      const value = stored.value as { readonly format?: unknown; readonly text?: unknown } | null;
      if (typeof value !== 'object' || value === null || Array.isArray(value) || value.format !== TEXT_FORMAT
        || typeof value.text !== 'string' || Object.keys(value).length !== 2) {
        throw new SectionStorageScopeError(`Stored comparison is not a ${TEXT_FORMAT} envelope`);
      }
      return value.text;
    },
    async write(key, value) {
      const id = scoped('workspace', key);
      if (typeof value !== 'string') throw new SectionStorageScopeError('Comparison text must be a string');
      await workspace.putDocument(id, { format: TEXT_FORMAT, text: value });
    },
  };
  return Object.freeze(port);
}

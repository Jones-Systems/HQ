import type { AnnotationDocument, VersionId } from '../../annotations/src/contract.ts';
import type { JsonValue, WorkspaceDocuments } from './backing.ts';
import { ANNOTATIONS_KEY_ROOT, sectionKey } from './section-documents.ts';

export interface AnnotationDocumentPort {
  readonly adapter: 'fake' | 'real';
  load(version: VersionId): Promise<unknown>;
  save(document: AnnotationDocument): Promise<void>;
}

export function createAnnotationsStorage(workspace: WorkspaceDocuments): AnnotationDocumentPort {
  const scoped = sectionKey(workspace, ANNOTATIONS_KEY_ROOT);
  const port: AnnotationDocumentPort = {
    adapter: 'real',
    async load(version) {
      const stored = await workspace.getDocument(scoped('workspace', version));
      return stored ? stored.value : null;
    },
    async save(document) {
      await workspace.putDocument(scoped('workspace', document.versionId), document as unknown as JsonValue);
    },
  };
  return Object.freeze(port);
}

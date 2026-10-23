import type { ReferenceStoragePort, BlobDigest } from '../../references/src/contract.ts';
import { isStoreErrorCode, type JsonValue, type WorkspaceRecords } from './backing.ts';
import { SectionStorageScopeError } from './section-documents.ts';

export const REFERENCES_KEY_ROOT = 'design/references/';

export function createReferencesStorage(workspace: WorkspaceRecords): ReferenceStoragePort {
  if (workspace.kind !== 'workspace' || workspace.namespace !== 'workspace') throw new SectionStorageScopeError('References require workspace');
  const keyOf = (namespace: string, key: string) => {
    if (namespace !== 'workspace' || typeof key !== 'string' || !key.startsWith(REFERENCES_KEY_ROOT)
      || key.length <= REFERENCES_KEY_ROOT.length || key.split('/').includes('..')) throw new SectionStorageScopeError('Invalid reference key');
    return key;
  };
  return Object.freeze({
    label: 'Saved on this device',
    async readDocument(namespace, key) {
      const found = await workspace.getDocument(keyOf(namespace, key));
      return found ? { value: found.value, revision: String(found.revision) } : null;
    },
    async writeDocument(namespace, key, value, expectedRevision) {
      keyOf(namespace, key);
      if (expectedRevision !== null && (!/^[1-9][0-9]*$/u.test(expectedRevision) || !Number.isSafeInteger(Number(expectedRevision)))) return { ok: false, reason: 'conflict' };
      try {
        const found = await workspace.putDocument(key, value as JsonValue, { expectedRevision: expectedRevision === null ? null : Number(expectedRevision) });
        return { ok: true, revision: String(found.revision) };
      } catch (error) {
        if (isStoreErrorCode(error, 'conflict')) return { ok: false, reason: 'conflict' };
        if (isStoreErrorCode(error, 'read-only')) return { ok: false, reason: 'read-only' };
        throw error;
      }
    },
    async putBlob(bytes, mediaType) {
      if (typeof mediaType !== 'string' || !mediaType.trim()) throw new SectionStorageScopeError('Reference media type is required');
      // AssetRef persists mediaType with each reference, not as mutable digest-global metadata.
      const blob = await workspace.putBlob(bytes);
      return { digest: blob.digest as string as BlobDigest, bytes: blob.bytes };
    },
    hasBlob: (digest) => workspace.hasBlob(digest),
  } satisfies ReferenceStoragePort);
}

import type { EvidenceStorePort } from '../../connector/src/contract.ts';
import type { EvidenceEntry } from '../../connector/src/evidence.ts';
import { isStoreErrorCode, type WorkspaceDocuments } from './backing.ts';
import { toJson } from './canonical.ts';
import { SectionStorageScopeError } from './section-documents.ts';

export const EVIDENCE_KEY_ROOT = 'design/connector/evidence/';
const queues = new WeakMap<WorkspaceDocuments, Promise<unknown>>();
const id = (value: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new SectionStorageScopeError('Invalid evidence identity');
  return value;
};

export function createEvidenceStore(workspace: WorkspaceDocuments): EvidenceStorePort {
  if (workspace.kind !== 'workspace' || workspace.namespace !== 'workspace') throw new SectionStorageScopeError('Evidence requires workspace');
  const read = async (key: string): Promise<EvidenceEntry | null> => {
    const doc = await workspace.getDocument(key);
    if (!doc) return null;
    const entry = doc.value as unknown as EvidenceEntry;
    if (!entry || !entry.evidence || key !== `${EVIDENCE_KEY_ROOT}${id(entry.evidence.dispatchId)}/${id(entry.evidence.evidenceId)}`) throw new SectionStorageScopeError('Evidence identity mismatch');
    return entry;
  };
  const get: EvidenceStorePort['get'] = async (evidenceId) => {
    id(evidenceId);
    for (const key of await workspace.listDocuments(EVIDENCE_KEY_ROOT)) {
      if (key.endsWith(`/${evidenceId}`)) return read(key);
    }
    return null;
  };
  return Object.freeze({
    get,
    append(entry) {
      const run = async (): Promise<'appended' | 'exists'> => {
        const key = `${EVIDENCE_KEY_ROOT}${id(entry.evidence.dispatchId)}/${id(entry.evidence.evidenceId)}`;
        if (key.length > 256) throw new SectionStorageScopeError('Evidence key exceeds storage bound');
        if (await get(entry.evidence.evidenceId)) return 'exists';
        try { await workspace.putDocument(key, toJson(entry), { expectedRevision: null }); return 'appended'; }
        catch (error) { if (isStoreErrorCode(error, 'conflict')) return 'exists'; throw error; }
      };
      const next = (queues.get(workspace) ?? Promise.resolve()).then(run, run);
      queues.set(workspace, next.then(() => undefined, () => undefined));
      return next;
    },
    async listByDispatch(dispatchId) {
      const entries: EvidenceEntry[] = [];
      for (const key of await workspace.listDocuments(`${EVIDENCE_KEY_ROOT}${id(dispatchId)}/`)) {
        const entry = await read(key);
        if (entry) entries.push(entry);
      }
      return entries;
    },
  } satisfies EvidenceStorePort);
}

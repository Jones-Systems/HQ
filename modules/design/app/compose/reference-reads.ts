import type { WorkspaceRecords } from '../storage/index.ts';
import { createProjectsStorage, createRequestsStoragePort } from '../storage/index.ts';
import type { DesignReferenceReads, DesignReferenceRecord, DesignReferenceRead } from '../references-provider/index.ts';
import { ProjectContentRepository } from '../../projects/src/repository.ts';
import { projectId } from '../../projects/src/ids.ts';
import type { ProjectContent } from '../../projects/src/content.ts';
import { RequestStore } from '../../requests/src/store.ts';
import type { Digest } from '../../requests/src/contract.ts';
import { brandId } from '../../requests/src/validate.ts';
import { digestOf } from '../../requests/src/jcs.ts';
import { LIBRARY_DOCUMENT_KEY } from '../../references/src/contract.ts';
import type { LibraryState, ReferenceRecord } from '../../references/src/contract.ts';
import { parseLibraryDocument } from '../../references/src/persist.ts';

class ReadOnlyObservation extends Error {}
const deny = async (): Promise<never> => { throw new ReadOnlyObservation('Reference observation cannot write or recover'); };
const clock = { now: () => new Date().toISOString() };

/** Fresh capability view; denied mutations never reach the underlying bridge. */
function observation(records: WorkspaceRecords) {
  const state = { failed: false, partial: false };
  const listed = new Set<string>();
  async function read<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) { state.failed = true; throw error; }
  }
  const view: WorkspaceRecords = {
    kind: records.kind, namespace: records.namespace,
    putDocument: deny, putBlob: deny, appendEvent: deny,
    async getDocument(key) {
      const value = await read(() => records.getDocument(key));
      if (value === null && listed.has(key)) state.partial = true;
      return value;
    },
    async listDocuments(prefix) {
      const keys = await read(() => records.listDocuments(prefix));
      keys.forEach((key) => listed.add(key));
      return keys;
    },
    getBlob: (digest) => read(() => records.getBlob(digest)),
    hasBlob: (digest) => read(() => records.hasBlob(digest)),
    async readEvents(stream) {
      const value = await read(() => records.readEvents(stream));
      if (value.status.state !== 'ok') state.partial = true;
      return value;
    },
  };
  const store = () => new RequestStore({ storage: createRequestsStoragePort<Digest>({ workspace: view }), clock,
    ids: { next() { throw new ReadOnlyObservation('Reference observation cannot allocate IDs'); } } });
  const failure = (error: unknown): DesignReferenceRead => ({
    status: error instanceof ReadOnlyObservation || state.partial || !state.failed ? 'unknown' : 'unavailable',
  });
  return { view, state, store, failure };
}
type Observation = ReturnType<typeof observation>;

async function content(o: Observation, project: string): Promise<ProjectContent | null> {
  const loaded = await new ProjectContentRepository(createProjectsStorage(o.view), clock).load(projectId(project));
  return loaded.status === 'ok' ? loaded.content : null;
}
function versionRecord(value: ProjectContent, id: string): DesignReferenceRead {
  const version = value.versions.find((item) => item.id === id);
  if (!version) return { status: 'missing' };
  const view = value.views.find((item) => item.id === version.viewId);
  if (!view) return { status: 'unknown' };
  return { status: 'found', record: { kind: 'version', entityId: version.id, projectId: value.projectId,
    title: `${view.title} — ${version.label}`, revision: version.id, archived: false, destination: 'projects/projects' } };
}
async function requestRecord(o: Observation, id: string): Promise<DesignReferenceRead> {
  const snapshot = await o.store().open(brandId<'RequestId'>(id));
  if (o.state.partial || snapshot.readOnly !== null || snapshot.recovered.length > 0 || snapshot.draft === null) return { status: 'unknown' };
  const draft = snapshot.draft;
  const projects = new Set(draft.sources.map((source) => source.projectId));
  const project = projects.values().next().value;
  if (projects.size !== 1 || project === undefined) return { status: 'unknown' };
  try {
    const revision = `request-draft:v1:${await digestOf([draft.draftId, draft.revision])}`;
    return { status: 'found', record: { kind: 'request', entityId: id, projectId: project,
      title: draft.title, revision, archived: false, destination: 'requests/requests' } };
  } catch { return { status: 'unknown' }; }
}
async function library(o: Observation): Promise<LibraryState | null> {
  const document = await o.view.getDocument(LIBRARY_DOCUMENT_KEY);
  const parsed = parseLibraryDocument(document?.value);
  return parsed.status === 'ok' ? parsed.state : null;
}
async function referenceRecord(value: LibraryState, record: ReferenceRecord | undefined, project: string): Promise<DesignReferenceRead> {
  if (!record || !Object.values(value.uses).some((use) => use.referenceId === record.id && use.projectId === project && use.tombstonedAt === null)) return { status: 'missing' };
  try {
    const revision = `reference-record:v1:${await digestOf(record)}`;
    return { status: 'found', record: { kind: 'reference', entityId: record.id, projectId: project,
      title: record.title, revision, archived: record.tombstonedAt !== null, destination: 'resources/references' } };
  } catch { return { status: 'unknown' }; }
}

/** Authoritative observations only: no caches, repair, fake fallback, or execution capability. */
export function createDesignReferenceReads(records: WorkspaceRecords | null): DesignReferenceReads {
  return {
    async read(kind, entityId, project) {
      if (records === null) return { status: 'unavailable' };
      // The provisional-local registry is not canonical HQ project identity. Project kind stays unknown.
      if (kind === 'project') return { status: 'unknown' };
      const o = observation(records);
      try {
        if (kind === 'version') {
          const value = await content(o, project);
          return value ? versionRecord(value, entityId) : { status: 'unknown' };
        }
        if (kind === 'request') {
          const members = await o.store().listRequests();
          if (!members.some((id) => id === entityId)) return { status: 'missing' };
          return await requestRecord(o, entityId);
        }
        const value = await library(o);
        return value ? await referenceRecord(value, value.references[entityId], project) : { status: 'unknown' };
      } catch (error) { return o.failure(error); }
    },
    async list(project) {
      if (records === null) throw new Error('Design reference storage unavailable');
      const o = observation(records);
      const found: DesignReferenceRecord[] = [];
      const add = (result: DesignReferenceRead) => {
        if (result.status === 'unknown' || result.status === 'unavailable') throw new Error('Design reference observation incomplete');
        if (result.status === 'found' && result.record.projectId === project && !result.record.archived) found.push(result.record);
      };
      const versions = await content(o, project);
      if (!versions) throw new Error('Design project content unavailable');
      for (const version of versions.versions) add(versionRecord(versions, version.id));
      for (const id of await o.store().listRequests()) add(await requestRecord(o, id));
      const references = await library(o);
      if (!references) throw new Error('Design reference library unavailable');
      for (const record of Object.values(references.references)) add(await referenceRecord(references, record, project));
      if (o.state.partial) throw new Error('Design reference observation incomplete');
      return found;
    },
  };
}

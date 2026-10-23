/**
 * PROVISIONAL local project registry.
 *
 * Stand-in for the HQ foundation's shared project registry until root wires
 * that adapter. It is labelled provisional everywhere it surfaces, stores one
 * workspace document, and never derives identity from a project name.
 */
import {
  PROJECTS_KEY_PREFIX, StorageConflictError, WORKSPACE_NAMESPACE,
  type ClockPort, type ProjectRecord, type ProjectRegistryPort, type ProjectStoragePort, type RegistryProvenance,
} from './contract.ts';
import { deepFreeze } from './content.ts';
import { parseProjectId, projectId, type IdFactory } from './ids.ts';

export const PROVISIONAL_REGISTRY_KEY = `${PROJECTS_KEY_PREFIX}provisional-registry`;
export const PROVISIONAL_REGISTRY_SCHEMA = 'hq.design.projects.provisional-registry/v1';
export const PROVISIONAL_REGISTRY_PROVENANCE: RegistryProvenance = Object.freeze({
  kind: 'provisional-local',
  label: 'Projects saved on this device',
});

function parseRecords(value: unknown): ProjectRecord[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  if (document.schema !== PROVISIONAL_REGISTRY_SCHEMA || !Array.isArray(document.projects)) return null;
  const records: ProjectRecord[] = [];
  for (const item of document.projects) {
    if (typeof item !== 'object' || item === null) return null;
    const entry = item as Record<string, unknown>;
    const id = parseProjectId(entry.id);
    if (!id || typeof entry.name !== 'string' || entry.name.trim() === '' || entry.name.length > 300
      || typeof entry.createdAt !== 'string' || records.some((record) => record.id === id)) return null;
    records.push({ id, name: entry.name, createdAt: entry.createdAt });
  }
  return records;
}

export function createProvisionalLocalRegistry(options: {
  readonly storage: ProjectStoragePort;
  readonly clock: ClockPort;
  readonly ids: IdFactory;
}): ProjectRegistryPort {
  const { storage, clock, ids } = options;

  async function read(): Promise<{ records: ProjectRecord[]; revision: string | null }> {
    const stored = await storage.readDocument(WORKSPACE_NAMESPACE, PROVISIONAL_REGISTRY_KEY);
    if (!stored) return { records: [], revision: null };
    const records = parseRecords(stored.value);
    if (!records) throw new Error('Provisional registry document is invalid; it is left untouched');
    return { records, revision: stored.revision };
  }

  return {
    provenance: PROVISIONAL_REGISTRY_PROVENANCE,
    async list() {
      return deepFreeze((await read()).records);
    },
    async create(input) {
      const name = input.name.trim();
      if (name === '' || name.length > 300) throw new Error('Project name must be 1-300 characters');
      // Duplicate names are allowed and stay distinct projects.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { records, revision } = await read();
        const record: ProjectRecord = { id: projectId(ids.next('project')), name, createdAt: clock.now() };
        if (records.some((other) => other.id === record.id)) throw new Error('ID factory produced a duplicate project id');
        try {
          await storage.writeDocument(WORKSPACE_NAMESPACE, PROVISIONAL_REGISTRY_KEY,
            { schema: PROVISIONAL_REGISTRY_SCHEMA, projects: [...records, record] }, { expectedRevision: revision });
          return deepFreeze(record);
        } catch (error) {
          if (!(error instanceof StorageConflictError)) throw error;
        }
      }
      throw new Error('Provisional registry kept changing; project was not created');
    },
  };
}

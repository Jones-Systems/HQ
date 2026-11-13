import { canonicalJson, ContractError } from './canonical.js';
import { operationKey, PROJECTS_REGISTRY_KEY } from './keys.js';
import {
  documentRevision, normalizeCreateRequest, planCreate, registrySnapshot,
  type CreateOperation, type CreatePlanResult, type CreateRequest, type ProjectsRegistry, type RegistrySnapshot,
} from './projects-registry.js';

export type RegistryJson = null | boolean | number | string | readonly RegistryJson[]
  | { readonly [key: string]: RegistryJson };

export interface RegistryDocument {
  readonly key: string;
  readonly revision: number;
  readonly value: unknown;
}

export interface RegistryPut {
  readonly key: string;
  readonly expectedRevision: number | null;
  readonly value: RegistryJson;
}

/** Inject an authoritative backing whose puts commit atomically, including all revision checks. */
export interface ProjectsRegistryBacking {
  getDocument(key: string): Promise<RegistryDocument | null>;
  commitPuts(puts: readonly RegistryPut[]): Promise<readonly RegistryDocument[]>;
}

export type ListProjectsResult =
  | { readonly status: 'listed'; readonly revision: number | null; readonly registry: ProjectsRegistry }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'unknown'; readonly phase: 'registry-read' };

export type CreateProjectResult = Exclude<CreatePlanResult, { readonly status: 'planned' }>
  | { readonly status: 'saved'; readonly result: CreateOperation['result']; readonly registryRevision: number }
  | { readonly status: 'refused'; readonly reason: 'commit-conflict' }
  | { readonly status: 'unknown'; readonly phase: 'operation-read' | 'registry-read' | 'commit' };

function invalid(error: unknown): { readonly status: 'invalid'; readonly reason: string } {
  return { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid registry record' };
}

function checkDocument(document: RegistryDocument, key: string): RegistryDocument {
  if (document === null || typeof document !== 'object' || document.key !== key) {
    throw new ContractError('Stored document key mismatch');
  }
  documentRevision(document.revision);
  return document;
}

function snapshot(document: RegistryDocument | null): RegistrySnapshot {
  if (document === null) return { revision: null, value: null };
  checkDocument(document, PROJECTS_REGISTRY_KEY);
  return { revision: document.revision, value: document.value };
}

function isCommitConflict(error: unknown): boolean {
  return error !== null && typeof error === 'object'
    && 'name' in error && error.name === 'StoreError' && 'code' in error && error.code === 'conflict';
}

/** Uncomposed service: construction does not read, write, mint or consult the clock. */
export function createProjectsRegistryService(dependencies: {
  readonly backing: ProjectsRegistryBacking;
  readonly mintUuid: () => unknown;
  readonly now: () => unknown;
}): {
  list(): Promise<ListProjectsResult>;
  create(request: unknown): Promise<CreateProjectResult>;
} {
  const { backing, mintUuid, now } = dependencies;
  return {
    async list() {
      let document: RegistryDocument | null;
      try { document = await backing.getDocument(PROJECTS_REGISTRY_KEY); }
      catch { return { status: 'unknown', phase: 'registry-read' }; }
      try {
        const current = snapshot(document);
        return { status: 'listed', revision: current.revision, registry: registrySnapshot(current) };
      } catch (error) { return invalid(error); }
    },
    async create(request) {
      let normalized: CreateRequest;
      try { normalized = normalizeCreateRequest(request); }
      catch (error) { return invalid(error); }

      const key = operationKey(normalized.operationId);
      let operation: RegistryDocument | null;
      try { operation = await backing.getDocument(key); }
      catch { return { status: 'unknown', phase: 'operation-read' }; }
      if (operation !== null) {
        try {
          checkDocument(operation, key);
          const replay = planCreate(normalized, {
            registry: { revision: null, value: null },
            operation: { status: 'present', value: operation.value }, mintUuid, now,
          });
          if (replay.status === 'planned') throw new ContractError('Unexpected replay plan');
          return replay;
        } catch (error) { return invalid(error); }
      }

      let document: RegistryDocument | null;
      try { document = await backing.getDocument(PROJECTS_REGISTRY_KEY); }
      catch { return { status: 'unknown', phase: 'registry-read' }; }
      let current: RegistrySnapshot;
      try { current = snapshot(document); }
      catch (error) { return invalid(error); }
      const plan = planCreate(normalized, { registry: current, operation: { status: 'absent' }, mintUuid, now });
      if (plan.status !== 'planned') return plan;

      const puts: readonly RegistryPut[] = plan.puts.map(put => ({
        key: put.key, expectedRevision: put.expectedRevision,
        value: JSON.parse(canonicalJson(put.value)) as RegistryJson,
      }));
      let committed: readonly RegistryDocument[];
      try { committed = await backing.commitPuts(puts); }
      catch (error) {
        return isCommitConflict(error) ? { status: 'refused', reason: 'commit-conflict' }
          : { status: 'unknown', phase: 'commit' };
      }
      try {
        if (!Array.isArray(committed) || committed.length !== 2) throw new ContractError('Incomplete commit response');
        for (const put of puts) {
          const matches = committed.filter(item => item?.key === put.key);
          if (matches.length !== 1) throw new ContractError('Commit response key mismatch');
          const saved = checkDocument(matches[0], put.key);
          if (saved.revision !== (put.expectedRevision ?? 0) + 1
            || canonicalJson(saved.value) !== canonicalJson(put.value)) throw new ContractError('Commit response mismatch');
        }
      } catch { return { status: 'unknown', phase: 'commit' }; }
      return { status: 'saved', result: plan.result, registryRevision: (current.revision ?? 0) + 1 };
    },
  };
}

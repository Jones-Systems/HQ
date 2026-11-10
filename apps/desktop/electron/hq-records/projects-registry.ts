import { canonicalDigest, canonicalJson, closedArray, closedRecord, ContractError, isDigest, type Digest } from './canonical.js';
import { opaqueSegment, operationKey, PROJECTS_REGISTRY_KEY } from './keys.js';

export const MAX_PROJECTS = 10_000;
export const MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const REGISTRY_SCHEMA = 'hq.projects.registry/v1';
export const OPERATION_SCHEMA = 'hq.projects.operation/v1';
export const ADOPTION_SCHEMA = 'hq.projects.adoption/v1';
export const WORKSPACE_SCOPE = 'hq-local';
export type AdoptedOrigin = 'adopted-workspace-local' | 'adopted-source-derived';
export type IdentityOrigin = 'hq-created' | AdoptedOrigin;

export interface HqProjectRecord {
  readonly id: string;
  readonly identityOrigin: IdentityOrigin;
  readonly name: string | null;
  readonly createdAt: string | null;
  readonly registeredAt: string;
  readonly adoptionId: string | null;
}
export interface ProjectsRegistry {
  readonly schema: typeof REGISTRY_SCHEMA;
  readonly originatingWorkspaceId: typeof WORKSPACE_SCOPE;
  readonly projects: readonly HqProjectRecord[];
}
export interface CreateOperation {
  readonly schema: typeof OPERATION_SCHEMA;
  readonly operationId: string;
  readonly kind: 'create';
  readonly requestDigest: Digest;
  readonly result: { readonly projectId: string };
  readonly committedAt: string;
}
export interface InputPin { readonly key: string; readonly revision: number; readonly digest: Digest }
export type UntouchedReason = 'invalid' | 'unsupported-schema' | 'blocked-pending-import'
  | 'conflicting-id' | 'unproven-source-derivation';
export interface AdoptionRecord {
  readonly schema: typeof ADOPTION_SCHEMA;
  readonly adoptionId: string;
  readonly fromSchema: 1;
  readonly toSchema: 2;
  readonly inputs: readonly InputPin[];
  readonly adopted: readonly { readonly id: string; readonly identityOrigin: AdoptedOrigin; readonly evidenceKeys: readonly string[] }[];
  readonly untouched: readonly { readonly key: string; readonly reason: UntouchedReason }[];
  readonly committedAt: string;
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContractError(message);
}

// The existing projects/ids.ts rule, kept local to the Electron compiler boundary.
export function isIdText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function projectId(value: unknown): string {
  requireValue(isIdText(value) && value !== WORKSPACE_SCOPE, 'Invalid project ID (workspace scope is not a project)');
  return value;
}

export function projectName(value: unknown): string {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 300 && value.trim() === value, 'Invalid project name');
  return value;
}

/** RFC 3339 with explicit offset, real calendar date and no leap-second coercion. */
export function timestamp(value: unknown): string {
  requireValue(typeof value === 'string', 'Invalid timestamp');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  requireValue(match, 'Timestamp needs an explicit RFC 3339 offset');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  requireValue(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59
    && (zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59)), 'Invalid calendar timestamp');
  return value;
}

export function documentRevision(value: unknown): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1, 'Invalid document revision');
  return value;
}

export function expectedRevision(value: unknown): number | null {
  return value === null ? null : documentRevision(value);
}

export function legacyKey(value: unknown): string {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value)
    && !value.startsWith('hq/'), 'Invalid legacy key');
  return value;
}

function boundedArray(value: unknown, label: string): unknown[] {
  requireValue(Array.isArray(value) && value.length <= MAX_PROJECTS, `Invalid or oversized ${label}`);
  return closedArray(value, MAX_PROJECTS);
}

export function decodeProject(value: unknown): HqProjectRecord {
  const r = closedRecord(value, ['id', 'identityOrigin', 'name', 'createdAt', 'registeredAt', 'adoptionId']);
  const id = projectId(r.id);
  const origin = r.identityOrigin;
  requireValue(origin === 'hq-created' || origin === 'adopted-workspace-local' || origin === 'adopted-source-derived', 'Invalid identity origin');
  const adoptionId = r.adoptionId === null ? null : opaqueSegment(r.adoptionId);
  requireValue((origin === 'hq-created') === (adoptionId === null), 'Origin and adoption ID disagree');
  return { id, identityOrigin: origin, name: r.name === null ? null : projectName(r.name),
    createdAt: r.createdAt === null ? null : timestamp(r.createdAt), registeredAt: timestamp(r.registeredAt), adoptionId };
}

export function decodeRegistry(value: unknown): ProjectsRegistry {
  const r = closedRecord(value, ['schema', 'originatingWorkspaceId', 'projects']);
  requireValue(r.schema === REGISTRY_SCHEMA && r.originatingWorkspaceId === WORKSPACE_SCOPE, 'Invalid registry schema/scope');
  const projects = boundedArray(r.projects, 'projects').map(decodeProject);
  requireValue(new Set(projects.map(p => p.id)).size === projects.length, 'Duplicate project ID');
  return { schema: REGISTRY_SCHEMA, originatingWorkspaceId: WORKSPACE_SCOPE, projects };
}

export function emptyRegistry(): ProjectsRegistry {
  return { schema: REGISTRY_SCHEMA, originatingWorkspaceId: WORKSPACE_SCOPE, projects: [] };
}

export function decodeOperation(value: unknown): CreateOperation {
  const r = closedRecord(value, ['schema', 'operationId', 'kind', 'requestDigest', 'result', 'committedAt']);
  requireValue(r.schema === OPERATION_SCHEMA && r.kind === 'create' && isDigest(r.requestDigest), 'Invalid create operation');
  const result = closedRecord(r.result, ['projectId']);
  return { schema: OPERATION_SCHEMA, operationId: opaqueSegment(r.operationId), kind: 'create', requestDigest: r.requestDigest,
    result: { projectId: projectId(result.projectId) }, committedAt: timestamp(r.committedAt) };
}

export function decodeAdoption(value: unknown): AdoptionRecord {
  const r = closedRecord(value, ['schema', 'adoptionId', 'fromSchema', 'toSchema', 'inputs', 'adopted', 'untouched', 'committedAt']);
  requireValue(r.schema === ADOPTION_SCHEMA && r.fromSchema === 1 && r.toSchema === 2, 'Invalid adoption schema');
  const inputs = boundedArray(r.inputs, 'inputs').map(value => {
    const p = closedRecord(value, ['key', 'revision', 'digest']);
    requireValue(isDigest(p.digest), 'Invalid pinned digest');
    return { key: legacyKey(p.key), revision: documentRevision(p.revision), digest: p.digest };
  }).sort((a, b) => compareText(a.key, b.key));
  const pinnedKeys = new Set(inputs.map(p => p.key));
  requireValue(pinnedKeys.size === inputs.length, 'Duplicate input key');
  const adopted = boundedArray(r.adopted, 'adopted').map<AdoptionRecord['adopted'][number]>(value => {
    const a = closedRecord(value, ['id', 'identityOrigin', 'evidenceKeys']);
    const origin = a.identityOrigin;
    requireValue(origin === 'adopted-workspace-local' || origin === 'adopted-source-derived', 'Invalid adopted origin');
    const evidenceKeys = boundedArray(a.evidenceKeys, 'evidence keys').map(legacyKey).sort(compareText);
    requireValue(evidenceKeys.length > 0 && new Set(evidenceKeys).size === evidenceKeys.length
      && evidenceKeys.every(key => pinnedKeys.has(key)), 'Missing, duplicate or unpinned evidence');
    return { id: projectId(a.id), identityOrigin: origin, evidenceKeys };
  }).sort((a, b) => compareText(a.id, b.id));
  requireValue(new Set(adopted.map(a => a.id)).size === adopted.length, 'Duplicate adopted ID');
  const reasons: readonly unknown[] = ['invalid', 'unsupported-schema', 'blocked-pending-import', 'conflicting-id', 'unproven-source-derivation'];
  const untouched = boundedArray(r.untouched, 'untouched').map(value => {
    const u = closedRecord(value, ['key', 'reason']);
    requireValue(reasons.includes(u.reason), 'Invalid untouched reason');
    const key = legacyKey(u.key);
    requireValue(pinnedKeys.has(key), 'Untouched key is not pinned');
    return { key, reason: u.reason as UntouchedReason };
  }).sort((a, b) => compareText(a.key, b.key));
  requireValue(new Set(untouched.map(u => u.key)).size === untouched.length, 'Duplicate untouched key');
  return { schema: ADOPTION_SCHEMA, adoptionId: opaqueSegment(r.adoptionId), fromSchema: 1, toSchema: 2,
    inputs, adopted, untouched, committedAt: timestamp(r.committedAt) };
}

export const encodeRegistry = (value: unknown): string => canonicalJson(decodeRegistry(value));
export const encodeOperation = (value: unknown): string => canonicalJson(decodeOperation(value));
export const encodeAdoption = (value: unknown): string => canonicalJson(decodeAdoption(value));
export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export interface RegistrySnapshot { readonly revision: number | null; readonly value: unknown }
export function registrySnapshot(snapshot: RegistrySnapshot): ProjectsRegistry {
  const s = closedRecord(snapshot, ['revision', 'value']);
  expectedRevision(s.revision);
  if (s.revision === null) {
    requireValue(s.value === null, 'Missing registry cannot have a value');
    return emptyRegistry();
  }
  return decodeRegistry(s.value);
}

export interface PlannedPut<T> { readonly key: string; readonly expectedRevision: number | null; readonly value: T }
export interface CreateRequest { readonly operationId: string; readonly name: string; readonly expectedRegistryRevision: number | null }
export type OperationObservation = { readonly status: 'absent' } | { readonly status: 'unknown' }
  | { readonly status: 'present'; readonly value: unknown };
export type CreatePlanResult =
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'conflict'; readonly reason: 'operation-unknown' | 'operation-id-reused' | 'registry-revision' | 'project-id-collision' }
  | { readonly status: 'replayed'; readonly result: CreateOperation['result']; readonly operation: CreateOperation }
  | { readonly status: 'planned'; readonly result: CreateOperation['result']; readonly requestDigest: Digest;
    readonly puts: readonly [PlannedPut<ProjectsRegistry>, PlannedPut<CreateOperation>] };

export function normalizeCreateRequest(value: unknown): CreateRequest {
  const r = closedRecord(value, ['operationId', 'name', 'expectedRegistryRevision']);
  requireValue(typeof r.name === 'string', 'Invalid project name');
  return { operationId: opaqueSegment(r.operationId), name: projectName(r.name.trim()),
    expectedRegistryRevision: expectedRevision(r.expectedRegistryRevision) };
}

export const createRequestDigest = (request: CreateRequest): Digest =>
  canonicalDigest({ kind: 'create', name: normalizeCreateRequest(request).name });

/** A description of two future atomic puts, never a store call or a retry loop. */
export function planCreate(request: unknown, context: {
  readonly registry: RegistrySnapshot; readonly operation: OperationObservation;
  readonly mintUuid: () => unknown; readonly now: () => unknown;
}): CreatePlanResult {
  try {
    const normalized = normalizeCreateRequest(request);
    const requestDigest = createRequestDigest(normalized);
    const observation = context.operation;
    if (observation.status === 'unknown') {
      closedRecord(observation, ['status']);
      return { status: 'conflict', reason: 'operation-unknown' };
    }
    if (observation.status === 'present') {
      closedRecord(observation, ['status', 'value']);
      const operation = decodeOperation(observation.value);
      if (operation.operationId !== normalized.operationId || operation.requestDigest !== requestDigest) {
        return { status: 'conflict', reason: 'operation-id-reused' };
      }
      return { status: 'replayed', result: operation.result, operation };
    }
    closedRecord(observation, ['status']);
    requireValue(observation.status === 'absent', 'Invalid operation observation');
    const registry = registrySnapshot(context.registry);
    if (context.registry.revision !== normalized.expectedRegistryRevision) return { status: 'conflict', reason: 'registry-revision' };
    requireValue(registry.projects.length < MAX_PROJECTS && context.registry.revision !== Number.MAX_SAFE_INTEGER, 'Registry capacity/revision exhausted');
    const uuid = context.mintUuid();
    requireValue(typeof uuid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(uuid), 'Minter must supply a lowercase UUIDv4');
    const id = projectId(`project-${uuid}`);
    if (registry.projects.some(p => p.id === id)) return { status: 'conflict', reason: 'project-id-collision' };
    const committedAt = timestamp(context.now());
    const project: HqProjectRecord = { id, identityOrigin: 'hq-created', name: normalized.name,
      createdAt: committedAt, registeredAt: committedAt, adoptionId: null };
    const operation: CreateOperation = { schema: OPERATION_SCHEMA, operationId: normalized.operationId, kind: 'create',
      requestDigest, result: { projectId: id }, committedAt };
    return { status: 'planned', result: operation.result, requestDigest, puts: [
      { key: PROJECTS_REGISTRY_KEY, expectedRevision: normalized.expectedRegistryRevision, value: { ...registry, projects: [...registry.projects, project] } },
      { key: operationKey(normalized.operationId), expectedRevision: null, value: operation },
    ] };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid create input' };
  }
}

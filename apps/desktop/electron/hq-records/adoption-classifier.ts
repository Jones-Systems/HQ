import { canonicalBytes, canonicalDigest, canonicalJson, closedArray, closedRecord, ContractError, isDigest, plainRecord, sha256Bytes } from './canonical.js';
import { adoptionKey, PROJECTS_REGISTRY_KEY } from './keys.js';
import {
  ADOPTION_SCHEMA, compareText, decodeAdoption, decodeProject, documentRevision, isIdText, legacyKey,
  MAX_INPUT_BYTES, MAX_PROJECTS, projectId, projectName, registrySnapshot, timestamp,
  type AdoptedOrigin, type AdoptionRecord, type HqProjectRecord, type InputPin, type PlannedPut,
  type ProjectsRegistry, type RegistrySnapshot, type UntouchedReason,
} from './projects-registry.js';

export const PROVISIONAL_KEY = 'design.projects/provisional-registry';
export const PROVISIONAL_SCHEMA = 'hq.design.projects.provisional-registry/v1';
export const CONTENT_SCHEMA = 'hq.design.project-content/v1';
export const contentKey = (id: string): string => `design.projects/content/${encodeURIComponent(projectId(id))}`;

export interface SyntheticSnapshot extends InputPin { readonly bytes: Uint8Array }
/** Explicit caller evidence, not inferred from source-shaped fixture, view or link fields. */
export type IdentityProvenance =
  | { readonly kind: 'workspace-local'; readonly key: string }
  | { readonly kind: 'proven-source-derivation'; readonly key: string; readonly projectId: string;
    readonly sourceProjectId: string; readonly evidenceKeys: readonly string[] };
export interface BlockedScopes { readonly keyPrefixes: readonly string[]; readonly projectIds: readonly string[] }
interface Candidate {
  readonly id: string; readonly name: string | null; readonly createdAt: string | null;
  readonly identityOrigin: AdoptedOrigin; readonly evidenceKeys: readonly string[];
}
export type Classification =
  | { readonly status: 'adoptable-workspace-local' | 'adoptable-source-derived'; readonly pin: InputPin;
    readonly originalBytes: Uint8Array; readonly candidates: readonly Candidate[] }
  | { readonly status: 'untouched'; readonly pin: InputPin; readonly originalBytes: Uint8Array;
    readonly reason: UntouchedReason | 'ambiguous'; readonly detail: string };

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContractError(message);
}
function list(value: unknown): unknown[] {
  return closedArray(value, MAX_PROJECTS);
}
function text(value: unknown, max: number): string {
  ensure(typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value), 'Invalid legacy text');
  return value;
}
function id(value: unknown): string {
  ensure(isIdText(value), 'Invalid legacy ID');
  return value;
}

class AmbiguousJsonError extends ContractError {}

function parseLegacyBytes(bytes: Uint8Array): unknown {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(source);
  // JSON.parse is last-key-wins. Detect duplicate keys before using the parsed identity.
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\],]/gu;
  const stack: { object: boolean; expectingKey: boolean; keys: Set<string> }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source)) !== null) {
    const token = match[0], current = stack[stack.length - 1];
    if (token === '{' || token === '[') {
      ensure(stack.length < 128, 'Legacy nesting exceeds 128');
      stack.push({ object: token === '{', expectingKey: token === '{', keys: new Set() });
    } else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && current?.object) current.expectingKey = true;
    else if (token.startsWith('"') && current?.object && current.expectingKey) {
      const key = JSON.parse(token) as string;
      if (current.keys.has(key)) throw new AmbiguousJsonError('Duplicate JSON key');
      current.keys.add(key); current.expectingKey = false;
    }
  }
  return value;
}

/** Local validation only. No content, source association or capture record is produced. */
export function validateLegacyContent(value: unknown): Record<string, unknown> {
  const r = closedRecord(value, ['schema', 'projectId', 'views', 'versions', 'links', 'updatedAt']);
  ensure(r.schema === CONTENT_SCHEMA, 'Unsupported content schema');
  const project = projectId(r.projectId);
  timestamp(r.updatedAt);
  const views = new Set<string>();
  for (const item of list(r.views)) {
    const v = closedRecord(item, ['id', 'title', 'kind', 'createdAt']);
    const viewId = id(v.id);
    ensure(!views.has(viewId) && ['page', 'screen', 'component', 'prototype', 'flow', 'other'].includes(String(v.kind)), 'Duplicate/invalid view');
    text(v.title, 300); timestamp(v.createdAt); views.add(viewId);
  }
  const versions = new Set<string>(), ordinals = new Map<string, number>();
  for (const item of list(r.versions)) {
    const v = closedRecord(item, ['id', 'viewId', 'ordinal', 'label', 'createdAt', 'capture', 'origin'], ['thumbnail', 'basedOn']);
    const versionId = id(v.id), viewId = id(v.viewId);
    ensure(!versions.has(versionId) && views.has(viewId) && v.ordinal === (ordinals.get(viewId) ?? 0) + 1, 'Duplicate, orphan or noncontiguous version');
    text(v.label, 300); timestamp(v.createdAt);
    ensure(['owner-created', 'imported', 'returned-candidate', 'synthetic-fixture'].includes(String(v.origin)), 'Invalid legacy version origin');
    if (Object.hasOwn(v, 'basedOn')) ensure(versions.has(id(v.basedOn)), 'Unknown lineage');
    const binding = closedRecord(v.capture, ['route', 'viewport'], ['sourceRevision', 'captureDigest']);
    text(binding.route, 2048);
    const viewport = closedRecord(binding.viewport, ['w', 'h', 'dpr']);
    for (const key of ['w', 'h', 'dpr']) {
      const n = viewport[key];
      ensure(typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= (key === 'dpr' ? 16 : 100_000), 'Invalid legacy viewport');
    }
    if (Object.hasOwn(binding, 'sourceRevision')) text(binding.sourceRevision, 300);
    if (Object.hasOwn(binding, 'captureDigest')) ensure(isDigest(binding.captureDigest), 'Invalid legacy digest');
    if (Object.hasOwn(v, 'thumbnail')) {
      const t = closedRecord(v.thumbnail, ['digest', 'mediaType', 'bytes'], ['w', 'h']);
      ensure(isDigest(t.digest) && typeof t.bytes === 'number' && Number.isSafeInteger(t.bytes) && t.bytes >= 0, 'Invalid legacy thumbnail');
      text(t.mediaType, 100);
      for (const key of ['w', 'h']) if (Object.hasOwn(t, key)) {
        const n = t[key];
        ensure(typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 100_000, 'Invalid legacy thumbnail dimension');
      }
    }
    versions.add(versionId); ordinals.set(viewId, v.ordinal as number);
  }
  const sources = new Set<string>();
  for (const item of list(r.links)) {
    const link = closedRecord(item, ['projectId', 'sourceProjectId', 'linkedAt', 'observedRevision']);
    const source = id(link.sourceProjectId);
    ensure(link.projectId === project && !sources.has(source), 'Invalid/duplicate legacy source link');
    timestamp(link.linkedAt);
    if (link.observedRevision !== null) text(link.observedRevision, 300);
    sources.add(source);
  }
  return r;
}

function validatedInputs(snapshots: readonly SyntheticSnapshot[]): SyntheticSnapshot[] {
  closedArray(snapshots, MAX_PROJECTS);
  let bytes = 0;
  const keys = new Set<string>();
  return snapshots.map(snapshot => {
    const s = closedRecord(snapshot, ['key', 'revision', 'digest', 'bytes']);
    const key = legacyKey(s.key);
    ensure(!keys.has(key), 'Duplicate snapshot key'); keys.add(key);
    const revision = documentRevision(s.revision);
    ensure(s.bytes instanceof Uint8Array && isDigest(s.digest), 'Invalid bytes/digest');
    bytes += s.bytes.byteLength;
    ensure(bytes <= MAX_INPUT_BYTES, 'Synthetic inputs exceed 64 MiB');
    ensure(sha256Bytes(s.bytes) === s.digest, 'Snapshot bytes do not match pinned digest');
    return { key, revision, digest: s.digest, bytes: new Uint8Array(s.bytes) };
  }).sort((a, b) => compareText(a.key, b.key));
}

function validatedProvenance(value: readonly IdentityProvenance[], pins: ReadonlySet<string>): IdentityProvenance[] {
  closedArray(value, MAX_PROJECTS);
  let evidenceCount = 0;
  const result = value.map(p => {
    const base = plainRecord(p);
    if (base.kind === 'workspace-local') {
      const r = closedRecord(p, ['kind', 'key']);
      const key = legacyKey(r.key); ensure(pins.has(key), 'Unpinned workspace provenance');
      return { kind: 'workspace-local' as const, key };
    }
    const r = closedRecord(p, ['kind', 'key', 'projectId', 'sourceProjectId', 'evidenceKeys']);
    ensure(r.kind === 'proven-source-derivation', 'Unknown provenance kind');
    const key = legacyKey(r.key);
    const evidenceKeys = list(r.evidenceKeys).map(legacyKey).sort(compareText);
    evidenceCount += evidenceKeys.length;
    ensure(evidenceCount <= MAX_PROJECTS && evidenceKeys.length > 0 && new Set(evidenceKeys).size === evidenceKeys.length
      && pins.has(key) && evidenceKeys.every(k => pins.has(k)), 'Unpinned, empty, duplicate or oversized source evidence');
    return { kind: 'proven-source-derivation' as const, key, projectId: projectId(r.projectId), sourceProjectId: id(r.sourceProjectId), evidenceKeys };
  });
  return result.sort((a, b) => compareText(canonicalJson(a), canonicalJson(b)));
}

function validatedBlocks(value: BlockedScopes): BlockedScopes {
  const r = closedRecord(value, ['keyPrefixes', 'projectIds']);
  return { keyPrefixes: [...new Set(list(r.keyPrefixes).map(legacyKey))].sort(compareText),
    projectIds: [...new Set(list(r.projectIds).map(projectId))].sort(compareText) };
}

function classify(snapshot: SyntheticSnapshot, provenance: readonly IdentityProvenance[], blocked: BlockedScopes): Classification {
  const { key, revision, digest } = snapshot;
  const pin = { key, revision, digest }, originalBytes = snapshot.bytes;
  const untouched = (reason: UntouchedReason | 'ambiguous', detail: string): Classification => ({ status: 'untouched', pin, originalBytes, reason, detail });
  if (blocked.keyPrefixes.some(prefix => key.startsWith(prefix))) return untouched('blocked-pending-import', 'Explicitly blocked key scope');
  try {
    const value = parseLegacyBytes(snapshot.bytes);
    const r = plainRecord(value);
    const matching = provenance.filter(p => p.key === key);
    let candidates: Candidate[];
    if (r.schema === PROVISIONAL_SCHEMA) {
      closedRecord(r, ['schema', 'projects']); canonicalJson(r);
      if (key !== PROVISIONAL_KEY) return untouched('ambiguous', 'Provisional schema at an unrecognized key');
      if (matching.length !== 1 || matching[0].kind !== 'workspace-local') return untouched('ambiguous', 'No unique workspace-local provenance');
      candidates = list(r.projects).map(value => {
        const p = closedRecord(value, ['id', 'name', 'createdAt']);
        return { id: projectId(p.id), name: p.name === null ? null : projectName(p.name),
          createdAt: p.createdAt === null ? null : timestamp(p.createdAt), identityOrigin: 'adopted-workspace-local' as const, evidenceKeys: [key] };
      });
    } else if (r.schema === CONTENT_SCHEMA) {
      validateLegacyContent(r);
      const candidateId = projectId(r.projectId);
      if (key !== contentKey(candidateId)) return untouched('conflicting-id', 'Content key and ID disagree');
      if (blocked.projectIds.includes(candidateId)) return untouched('blocked-pending-import', 'Explicitly blocked project scope');
      const proofs = matching.filter((p): p is Extract<IdentityProvenance, { kind: 'proven-source-derivation' }> =>
        p.kind === 'proven-source-derivation' && p.projectId === candidateId);
      if (proofs.length === 0) return untouched('unproven-source-derivation', 'Source-shaped fields and string equality are candidate evidence only');
      if (proofs.length !== 1 || matching.length !== 1) return untouched('ambiguous', 'Multiple or incompatible provenance assertions');
      const proof = proofs[0];
      candidates = [{ id: candidateId, name: null, createdAt: null, identityOrigin: 'adopted-source-derived',
        evidenceKeys: [...new Set([key, ...proof.evidenceKeys])].sort(compareText) }];
    } else {
      return untouched(typeof r.schema === 'string' ? 'unsupported-schema' : 'invalid', 'Unrecognized legacy identity schema');
    }
    if (new Set(candidates.map(c => c.id)).size !== candidates.length) return untouched('conflicting-id', 'Duplicate legacy project IDs');
    if (candidates.some(c => blocked.projectIds.includes(c.id))) return untouched('blocked-pending-import', 'Explicitly blocked project scope');
    return { status: r.schema === PROVISIONAL_SCHEMA ? 'adoptable-workspace-local' : 'adoptable-source-derived', pin, originalBytes,
      candidates: candidates.sort((a, b) => compareText(a.id, b.id)) };
  } catch (error) {
    return untouched(error instanceof AmbiguousJsonError ? 'ambiguous' : 'invalid', error instanceof Error ? error.message : 'Invalid legacy input');
  }
}

export type ClassificationResult = { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'classified'; readonly classifications: readonly Classification[] };

function prepare(snapshots: readonly SyntheticSnapshot[], provenance: readonly IdentityProvenance[], blockedScopes: BlockedScopes, extraBytes: number) {
  const inputs = validatedInputs(snapshots);
  const pins = new Set(inputs.map(s => s.key));
  const evidence = validatedProvenance(provenance, pins), blocked = validatedBlocks(blockedScopes);
  const totalBytes = extraBytes + inputs.reduce((sum, s) => sum + s.bytes.byteLength, 0)
    + canonicalBytes({ pins: inputs.map(({ key, revision, digest }) => ({ key, revision, digest })), evidence, blocked }).byteLength;
  ensure(totalBytes <= MAX_INPUT_BYTES, 'Synthetic inputs and metadata exceed 64 MiB');
  return { inputs, evidence, blocked };
}

function classifyPrepared(inputs: readonly SyntheticSnapshot[], evidence: readonly IdentityProvenance[], blocked: BlockedScopes,
  existingIds: readonly string[]): readonly Classification[] {
  const counts = new Map<string, number>(existingIds.map(id => [id, 1]));
  const classifications = inputs.map(s => classify(s, evidence, blocked));
  let candidates = 0;
  for (const c of classifications) if (c.status !== 'untouched') for (const p of c.candidates) {
    candidates += 1; ensure(candidates <= MAX_PROJECTS, 'Too many candidate projects');
    counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  }
  return classifications.map<Classification>(c => c.status !== 'untouched'
    && c.candidates.some(p => (counts.get(p.id) ?? 0) > 1)
    ? { status: 'untouched', pin: c.pin, originalBytes: c.originalBytes, reason: 'conflicting-id', detail: 'Project ID already registered or claimed by multiple inputs' }
    : c);
}

export function classifySnapshots(snapshots: readonly SyntheticSnapshot[], provenance: readonly IdentityProvenance[],
  blockedScopes: BlockedScopes, existingIds: readonly string[] = []): ClassificationResult {
  try {
    closedArray(existingIds, MAX_PROJECTS);
    const registeredIds = existingIds.map(projectId);
    const { inputs, evidence, blocked } = prepare(snapshots, provenance, blockedScopes, canonicalBytes(registeredIds).byteLength);
    return { status: 'classified', classifications: classifyPrepared(inputs, evidence, blocked, registeredIds) };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid classification input' };
  }
}

export type AdoptionPlanResult = { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'conflict'; readonly reason: 'registry-revision' }
  | { readonly status: 'planned'; readonly adoptionId: string; readonly classifications: readonly Classification[];
    readonly puts: readonly [PlannedPut<ProjectsRegistry>, PlannedPut<AdoptionRecord>] };

/** Synthetic copy-forward description only. The legacy bytes are returned unchanged, never put. */
export function planAdoption(input: {
  readonly snapshots: readonly SyntheticSnapshot[]; readonly provenance: readonly IdentityProvenance[];
  readonly blockedScopes: BlockedScopes; readonly registry: RegistrySnapshot;
  readonly expectedRegistryRevision: number | null; readonly registeredAt: string;
}): AdoptionPlanResult {
  try {
    closedRecord(input, ['snapshots', 'provenance', 'blockedScopes', 'registry', 'expectedRegistryRevision', 'registeredAt']);
    const registry = registrySnapshot(input.registry);
    const revision = input.expectedRegistryRevision === null ? null : documentRevision(input.expectedRegistryRevision);
    if (revision !== input.registry.revision) return { status: 'conflict', reason: 'registry-revision' };
    ensure(revision !== Number.MAX_SAFE_INTEGER, 'Registry revision exhausted');
    const registeredAt = timestamp(input.registeredAt);
    const { inputs, evidence, blocked } = prepare(input.snapshots, input.provenance, input.blockedScopes,
      canonicalBytes({ registry, revision, registeredAt }).byteLength);
    const classifications = classifyPrepared(inputs, evidence, blocked, registry.projects.map(p => p.id));
    const pins = inputs.map(({ key, revision, digest }) => ({ key, revision, digest }));
    const adoptionId = `adopt-${canonicalDigest({ inputs: pins, registryRevision: revision,
      registryDigest: canonicalDigest(registry), provenance: evidence, blockedScopes: blocked }).slice(7, 39)}`;
    const projects: HqProjectRecord[] = [];
    const adopted: AdoptionRecord['adopted'][number][] = [], untouched: AdoptionRecord['untouched'][number][] = [];
    for (const classification of classifications) {
      if (classification.status === 'untouched') {
        untouched.push({ key: classification.pin.key, reason: classification.reason === 'ambiguous'
          ? 'unproven-source-derivation' : classification.reason });
      } else for (const candidate of classification.candidates) {
        projects.push(decodeProject({ id: candidate.id, name: candidate.name, createdAt: candidate.createdAt,
          registeredAt, identityOrigin: candidate.identityOrigin, adoptionId }));
        adopted.push({ id: candidate.id, identityOrigin: candidate.identityOrigin, evidenceKeys: candidate.evidenceKeys });
      }
    }
    ensure(registry.projects.length + projects.length <= MAX_PROJECTS, 'Registry project capacity exceeded');
    const adoption = decodeAdoption({ schema: ADOPTION_SCHEMA, adoptionId, fromSchema: 1, toSchema: 2,
      inputs: pins, adopted, untouched, committedAt: registeredAt });
    return { status: 'planned', adoptionId, classifications, puts: [
      { key: PROJECTS_REGISTRY_KEY, expectedRevision: revision,
        value: { ...registry, projects: [...registry.projects, ...projects].sort((a, b) => compareText(a.id, b.id)) } },
      { key: adoptionKey(adoptionId), expectedRevision: null, value: adoption },
    ] };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid adoption input' };
  }
}

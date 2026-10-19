import {
  isId, SCHEMAS,
  type ClockPort, type DigestPort, type ImportId, type ImportSource, type ImportSourceId, type ItemProvenance,
  type JsonValue, type ProjectId, type RecordId, type Rights, type Sha256Digest, type StoragePort,
  type StoredDocument, type VersionContent, type VersionId, type VersionProvenance, type ViewId, type WriteOp,
} from './contract.ts';
import { cloneJson, digestJson, jsonEqual, webCryptoDigest } from './jcs.ts';
import { defaultMapperRegistry, type ImportProblem, type MappedItem, type MapperRegistry } from './mappers.ts';

export const IMPORT_STREAM = 'imports';
export const KEYS = {
  record: (id: string) => `imports/records/${id}`,
  version: (id: string) => `imports/versions/${id}`,
  manifest: (id: string) => `imports/manifests/${id}`,
  conflict: (id: string) => `imports/conflicts/${id}`,
  undo: (id: string) => `imports/undo/${id}`,
} as const;

export interface ImportDeps {
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  readonly digest?: DigestPort;
  readonly mappers?: MapperRegistry;
  /** Workspace-class namespace holding import records. Default `workspace`. */
  readonly namespace?: string;
}

// ---------------------------------------------------------------------------
// Persisted shapes
// ---------------------------------------------------------------------------

export interface ImportState {
  readonly importId: ImportId;
  readonly itemDigest: Sha256Digest;
  /** Digest of the record without `importState`, as last written by the importer. */
  readonly writtenDigest: Sha256Digest;
}

/** Mutable view-level binding. Versions it points to are immutable. */
export interface ImportedRecord {
  readonly schema: typeof SCHEMAS.record;
  readonly recordId: RecordId;
  readonly projectId: ProjectId;
  readonly viewId: ViewId;
  readonly sourceId: ImportSourceId;
  readonly itemKey: string;
  readonly title: string;
  readonly notes: string;
  readonly rights: Rights;
  readonly provenance: ItemProvenance;
  readonly versionId: VersionId;
  readonly versionHistory: readonly VersionId[];
  readonly tombstone: { readonly importId: ImportId; readonly at: string } | null;
  readonly importState: ImportState;
}

export interface ViewVersionDocument {
  readonly schema: typeof SCHEMAS.version;
  readonly versionId: VersionId;
  readonly viewId: ViewId;
  readonly projectId: ProjectId;
  readonly content: VersionContent;
  readonly rights: Rights;
  readonly provenance: VersionProvenance;
}

export type ConflictStatus = 'open' | 'kept' | 'taken' | 'withdrawn';

export interface ConflictDocument {
  readonly schema: typeof SCHEMAS.conflict;
  readonly recordId: RecordId;
  readonly itemKey: string;
  readonly importId: ImportId;
  readonly reason: 'owner-edited';
  readonly status: ConflictStatus;
  readonly raisedAt: string;
  readonly resolvedAt: string | null;
  readonly baselineItemDigest: Sha256Digest;
  readonly incomingItemDigest: Sha256Digest;
  readonly incomingVersionId: VersionId;
  readonly incoming: { readonly title: string; readonly rights: Rights; readonly provenance: ItemProvenance };
}

export type RecordAction = 'created' | 'updated' | 'unchanged' | 'conflict';

export interface ManifestRecord {
  readonly itemKey: string;
  readonly recordId: RecordId;
  readonly viewId: ViewId;
  readonly versionId: VersionId;
  readonly action: RecordAction;
  readonly itemDigest: Sha256Digest;
  /** Record digest this import wrote (created/updated only). */
  readonly afterDigest: Sha256Digest | null;
  /** Prior record value restored by undo (created over a tombstone, or updated). */
  readonly before: ImportedRecord | null;
}

export interface ImportCounts {
  readonly items: number;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly conflicts: number;
}

/** `hq.design.import/v1` */
export interface ImportManifest {
  readonly schema: typeof SCHEMAS.import;
  readonly importId: ImportId;
  readonly projectId: ProjectId;
  readonly source: { readonly kind: string; readonly version: number; readonly sourceId: ImportSourceId };
  readonly mapping: { readonly id: string; readonly version: number };
  readonly sourceDigest: Sha256Digest;
  readonly importedAt: string;
  readonly counts: ImportCounts;
  readonly records: readonly ManifestRecord[];
  readonly conflicts: readonly { readonly itemKey: string; readonly recordId: RecordId; readonly reason: 'owner-edited'; readonly incomingVersionId: VersionId }[];
}

export interface UndoDocument {
  readonly schema: typeof SCHEMAS.undo;
  readonly importId: ImportId;
  readonly undoneAt: string;
  readonly tombstoned: readonly RecordId[];
  readonly reverted: readonly RecordId[];
  readonly retained: readonly { readonly recordId: RecordId; readonly reason: 'owner-edited' | 'changed-by-later-import' | 'missing' }[];
  readonly withdrawnConflicts: readonly RecordId[];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type RejectionReason =
  | 'unsupported-source-kind' | 'unsupported-version' | 'invalid-source'
  | 'unsupported-stored-schema' | 'corrupt-stored-record' | 'namespace' | 'unknown-import' | 'integrity';

export interface Rejection {
  readonly ok: false;
  readonly reason: RejectionReason;
  readonly problems: readonly ImportProblem[];
}

export interface ImportPlan {
  readonly ok: true;
  /** True when applying would change nothing; apply then performs zero writes. */
  readonly noop: boolean;
  readonly manifest: ImportManifest;
  readonly ops: readonly WriteOp[];
}

export class StoredSchemaError extends Error {
  readonly reason: 'unsupported-stored-schema' | 'corrupt-stored-record';
  constructor(reason: 'unsupported-stored-schema' | 'corrupt-stored-record', message: string) {
    super(message);
    this.reason = reason;
  }
}

const reject = (reason: RejectionReason, problems: readonly ImportProblem[] = []): Rejection => ({ ok: false, reason, problems });

// ---------------------------------------------------------------------------
// Stored document validation
// ---------------------------------------------------------------------------

function schemaFamily(schema: string): { family: string; version: number } | null {
  const match = /^(hq\.design\.[a-z-]+)\/v([1-9][0-9]{0,5})$/u.exec(schema);
  return match === null ? null : { family: match[1]!, version: Number(match[2]) };
}

/** Accepts exactly `expected`; a newer version of the same family is unsupported, never rewritten. */
export function checkSchema(value: unknown, expected: string, where: string): void {
  const schema = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as { schema?: unknown }).schema : undefined;
  if (schema === expected) return;
  const want = schemaFamily(expected)!;
  const got = typeof schema === 'string' ? schemaFamily(schema) : null;
  if (got !== null && got.family === want.family && got.version > want.version) {
    throw new StoredSchemaError('unsupported-stored-schema', `${where} uses unsupported ${String(schema)}`);
  }
  throw new StoredSchemaError('corrupt-stored-record', `${where} is not ${expected}`);
}

function asRecord(document: StoredDocument | null): ImportedRecord | null {
  if (document === null) return null;
  checkSchema(document.value, SCHEMAS.record, document.key);
  const value = document.value as unknown as ImportedRecord;
  if (typeof value.title !== 'string' || typeof value.notes !== 'string' || typeof value.importState !== 'object'
    || value.importState === null || !Array.isArray(value.versionHistory)) {
    throw new StoredSchemaError('corrupt-stored-record', `${document.key} is malformed`);
  }
  return value;
}

function asConflict(document: StoredDocument | null): ConflictDocument | null {
  if (document === null) return null;
  checkSchema(document.value, SCHEMAS.conflict, document.key);
  return document.value as unknown as ConflictDocument;
}

function asManifest(document: StoredDocument | null): ImportManifest | null {
  if (document === null) return null;
  checkSchema(document.value, SCHEMAS.import, document.key);
  const value = document.value as unknown as ImportManifest;
  if (!Array.isArray(value.records)) throw new StoredSchemaError('corrupt-stored-record', `${document.key} is malformed`);
  return value;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Context {
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  readonly digest: DigestPort;
  readonly mappers: MapperRegistry;
  readonly namespace: string;
}

function context(deps: ImportDeps): Context {
  return {
    storage: deps.storage, clock: deps.clock,
    digest: deps.digest ?? webCryptoDigest,
    mappers: deps.mappers ?? defaultMapperRegistry(),
    namespace: deps.namespace ?? 'workspace',
  };
}

async function checkNamespace(ctx: Context): Promise<Rejection | null> {
  const found = (await ctx.storage.namespaces()).find((item) => item.name === ctx.namespace);
  return found?.class === 'workspace' ? null : reject('namespace', [{ code: 'not-a-workspace-namespace', detail: ctx.namespace }]);
}

async function shortId(ctx: Context, prefix: string, value: JsonValue): Promise<string> {
  return `${prefix}${(await digestJson(ctx.digest, value)).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function withoutImportState(record: ImportedRecord): Omit<ImportedRecord, 'importState'> {
  const { importState: _ignored, ...rest } = record;
  return rest;
}

const recordDigest = (ctx: Context, record: ImportedRecord): Promise<Sha256Digest> => digestJson(ctx.digest, withoutImportState(record));

async function stamp(ctx: Context, record: Omit<ImportedRecord, 'importState'>, importId: ImportId, itemDigest: Sha256Digest): Promise<ImportedRecord> {
  const writtenDigest = await digestJson(ctx.digest, record);
  return { ...record, importState: { importId, itemDigest, writtenDigest } };
}

/** Owner-edited means the record differs from what the importer last wrote. */
export async function isOwnerEdited(deps: ImportDeps, record: ImportedRecord): Promise<boolean> {
  return (await recordDigest(context(deps), record)) !== record.importState.writtenDigest;
}

async function streamSeq(ctx: Context): Promise<number> {
  return (await ctx.storage.readEvents(ctx.namespace, IMPORT_STREAM)).length;
}

const put = (namespace: string, document: StoredDocument | null, key: string, value: unknown): WriteOp =>
  ({ op: 'put-document', namespace, key, value: value as JsonValue, expectedRevision: document?.revision ?? null });

// ---------------------------------------------------------------------------
// Plan and apply
// ---------------------------------------------------------------------------

export interface ImportRequest {
  readonly projectId: ProjectId;
  readonly source: ImportSource;
}

/**
 * Pure with respect to storage: reads only. Every rejection happens here,
 * before any write, so an unsupported version or bad item never mutates state.
 */
export async function planImport(deps: ImportDeps, request: ImportRequest): Promise<ImportPlan | Rejection> {
  const ctx = context(deps);
  const source = request.source;
  const resolved = ctx.mappers.resolve(source?.kind, source?.version);
  if (!resolved.ok) return reject(resolved.problem.code === 'unsupported-version' ? 'unsupported-version' : 'unsupported-source-kind', [resolved.problem]);
  if (!isId(request.projectId)) return reject('invalid-source', [{ code: 'project-id' }]);
  if (!isId(source.sourceId)) return reject('invalid-source', [{ code: 'source-id' }]);
  const namespaceProblem = await checkNamespace(ctx);
  if (namespaceProblem !== null) return namespaceProblem;
  const mapper = resolved.mapper;
  const mapped = await mapper.map(source, ctx.digest);
  if (!mapped.ok) return reject('invalid-source', mapped.problems);

  try {
    return await buildPlan(ctx, request, mapper.mappingId, mapper.mappingVersion, mapped.items);
  } catch (error) {
    if (error instanceof StoredSchemaError) return reject(error.reason, [{ code: error.reason, detail: error.message }]);
    throw error;
  }
}

async function buildPlan(
  ctx: Context, request: ImportRequest, mappingId: string, mappingVersion: number, items: readonly MappedItem[],
): Promise<ImportPlan | Rejection> {
  const { projectId, source } = request;
  const ns = ctx.namespace;
  const sortedItems = [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const sourceDigest = await digestJson(ctx.digest, {
    kind: source.kind, version: source.version, sourceId: source.sourceId,
    mapping: { id: mappingId, version: mappingVersion },
    items: sortedItems.map((item) => ({ key: item.key, itemDigest: item.itemDigest })),
  });
  const baseSeq = await streamSeq(ctx);
  const importId = (await shortId(ctx, 'imp_', { projectId, sourceDigest, baseSeq })) as ImportId;
  const importedAt = ctx.clock.now();
  const knownBlobs = new Set((await ctx.storage.listBlobs(ns)).map((blob) => blob.digest as string));

  const records: ManifestRecord[] = [];
  const conflicts: ImportManifest['conflicts'][number][] = [];
  const blobOps: WriteOp[] = [];
  const versionOps: WriteOp[] = [];
  const recordOps: WriteOp[] = [];
  const conflictOps: WriteOp[] = [];
  const plannedVersions = new Set<string>();

  for (const item of sortedItems) {
    const recordIdValue = (await shortId(ctx, 'rec_', { projectId, sourceId: source.sourceId, itemKey: item.key })) as RecordId;
    const viewIdValue = item.viewId ?? ((await shortId(ctx, 'view_', { projectId, sourceId: source.sourceId, itemKey: item.key, role: 'view' })) as ViewId);
    const versionIdValue = (await shortId(ctx, 'ver_', { viewId: viewIdValue, content: item.content as unknown as JsonValue })) as VersionId;

    const recordDocument = await ctx.storage.getDocument(ns, KEYS.record(recordIdValue));
    const existing = asRecord(recordDocument);
    const conflictDocument = await ctx.storage.getDocument(ns, KEYS.conflict(recordIdValue));
    const conflict = asConflict(conflictDocument);

    let action: RecordAction;
    if (existing === null || existing.tombstone !== null) action = 'created';
    else if (existing.importState.itemDigest === item.itemDigest) action = 'unchanged';
    else if (conflict !== null && conflict.incomingItemDigest === item.itemDigest && (conflict.status === 'open' || conflict.status === 'kept')) action = 'unchanged';
    else if ((await recordDigest(ctx, existing)) !== existing.importState.writtenDigest) action = 'conflict';
    else action = 'updated';

    if (action !== 'unchanged') {
      // Immutable version evidence: written once, never rewritten.
      if (!plannedVersions.has(versionIdValue)) {
        plannedVersions.add(versionIdValue);
        const versionDocument = await ctx.storage.getDocument(ns, KEYS.version(versionIdValue));
        if (versionDocument !== null) {
          checkSchema(versionDocument.value, SCHEMAS.version, versionDocument.key);
          const stored = versionDocument.value as unknown as ViewVersionDocument;
          if (!jsonEqual(stored.content, item.content) || stored.viewId !== viewIdValue) {
            return reject('integrity', [{ code: 'version-id-collision', itemKey: item.key }]);
          }
        } else {
          const version: ViewVersionDocument = {
            schema: SCHEMAS.version, versionId: versionIdValue, viewId: viewIdValue, projectId,
            content: item.content, rights: item.rights,
            provenance: {
              ...item.provenance, sourceKind: source.kind, sourceVersion: source.version, sourceId: source.sourceId,
              itemKey: item.key, itemDigest: item.itemDigest, mappingId, mappingVersion, importId, importedAt,
            },
          };
          versionOps.push(put(ns, null, KEYS.version(versionIdValue), version));
          for (const blob of item.blobs) {
            if (knownBlobs.has(blob.digest)) continue;
            knownBlobs.add(blob.digest);
            blobOps.push({ op: 'put-blob', namespace: ns, digest: blob.digest, mediaType: blob.mediaType, bytes: blob.bytes });
          }
        }
      }
    }

    let afterDigest: Sha256Digest | null = null;
    let before: ImportedRecord | null = null;
    if (action === 'created' || action === 'updated') {
      before = existing === null ? null : cloneJson(existing as unknown as JsonValue) as unknown as ImportedRecord;
      const history = existing === null ? [] : existing.versionHistory.filter((id) => id !== versionIdValue);
      const next = await stamp(ctx, {
        schema: SCHEMAS.record, recordId: recordIdValue, projectId, viewId: viewIdValue, sourceId: source.sourceId,
        itemKey: item.key, title: item.title, notes: action === 'updated' ? existing!.notes : '',
        rights: item.rights, provenance: item.provenance, versionId: versionIdValue,
        versionHistory: [...history, versionIdValue], tombstone: null,
      }, importId, item.itemDigest);
      afterDigest = next.importState.writtenDigest;
      recordOps.push(put(ns, recordDocument, KEYS.record(recordIdValue), next));
    } else if (action === 'conflict') {
      const next: ConflictDocument = {
        schema: SCHEMAS.conflict, recordId: recordIdValue, itemKey: item.key, importId, reason: 'owner-edited',
        status: 'open', raisedAt: importedAt, resolvedAt: null,
        baselineItemDigest: existing!.importState.itemDigest, incomingItemDigest: item.itemDigest, incomingVersionId: versionIdValue,
        incoming: { title: item.title, rights: item.rights, provenance: item.provenance },
      };
      conflictOps.push(put(ns, conflictDocument, KEYS.conflict(recordIdValue), next));
      conflicts.push({ itemKey: item.key, recordId: recordIdValue, reason: 'owner-edited', incomingVersionId: versionIdValue });
    }
    records.push({ itemKey: item.key, recordId: recordIdValue, viewId: viewIdValue, versionId: versionIdValue, action, itemDigest: item.itemDigest, afterDigest, before });
  }

  const count = (action: RecordAction) => records.filter((record) => record.action === action).length;
  const manifest: ImportManifest = {
    schema: SCHEMAS.import, importId, projectId,
    source: { kind: source.kind, version: source.version, sourceId: source.sourceId },
    mapping: { id: mappingId, version: mappingVersion }, sourceDigest, importedAt,
    counts: { items: records.length, created: count('created'), updated: count('updated'), unchanged: count('unchanged'), conflicts: count('conflict') },
    records, conflicts,
  };
  const noop = manifest.counts.unchanged === manifest.counts.items;
  if (noop) return { ok: true, noop, manifest, ops: [] };
  const ops: WriteOp[] = [
    ...blobOps, ...versionOps, ...recordOps, ...conflictOps,
    put(ns, null, KEYS.manifest(importId), manifest),
    { op: 'append-event', namespace: ns, stream: IMPORT_STREAM, expectedSeq: baseSeq,
      payload: { type: 'import.applied', importId, sourceDigest, at: importedAt, counts: manifest.counts as unknown as JsonValue } },
  ];
  return { ok: true, noop, manifest, ops };
}

export interface ApplyResult {
  readonly ok: true;
  readonly applied: boolean;
  readonly manifest: ImportManifest;
}

/** One atomic commit; a stale plan fails compare-and-swap and writes nothing. */
export async function applyImport(deps: ImportDeps, plan: ImportPlan): Promise<ApplyResult> {
  if (plan.noop) return { ok: true, applied: false, manifest: plan.manifest };
  await deps.storage.commit(plan.ops);
  return { ok: true, applied: true, manifest: plan.manifest };
}

export async function runImport(deps: ImportDeps, request: ImportRequest): Promise<ApplyResult | Rejection> {
  const plan = await planImport(deps, request);
  return plan.ok ? applyImport(deps, plan) : plan;
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export type UndoResult = { readonly ok: true; readonly applied: boolean; readonly undo: UndoDocument } | Rejection;

/**
 * Reverts only records still exactly as this import left them: created
 * records are tombstoned (or restored to the tombstone they revived), updated
 * records return to their prior value. Owner-edited or later-changed records
 * are retained and reported. Versions and blobs are immutable evidence.
 */
export async function undoImport(deps: ImportDeps, id: ImportId): Promise<UndoResult> {
  const ctx = context(deps);
  const namespaceProblem = await checkNamespace(ctx);
  if (namespaceProblem !== null) return namespaceProblem;
  const ns = ctx.namespace;
  try {
    const manifest = asManifest(await ctx.storage.getDocument(ns, KEYS.manifest(id)));
    if (manifest === null) return reject('unknown-import', [{ code: 'unknown-import', detail: id }]);
    const existingUndo = await ctx.storage.getDocument(ns, KEYS.undo(id));
    if (existingUndo !== null) {
      checkSchema(existingUndo.value, SCHEMAS.undo, existingUndo.key);
      return { ok: true, applied: false, undo: existingUndo.value as unknown as UndoDocument };
    }
    const at = ctx.clock.now();
    const ops: WriteOp[] = [];
    const tombstoned: RecordId[] = [];
    const reverted: RecordId[] = [];
    const retained: UndoDocument['retained'][number][] = [];
    const withdrawnConflicts: RecordId[] = [];
    for (const entry of manifest.records) {
      if (entry.action === 'conflict') {
        const conflictDocument = await ctx.storage.getDocument(ns, KEYS.conflict(entry.recordId));
        const conflict = asConflict(conflictDocument);
        if (conflict !== null && conflict.importId === id && conflict.status === 'open') {
          ops.push(put(ns, conflictDocument, conflictDocument!.key, { ...conflict, status: 'withdrawn', resolvedAt: at }));
          withdrawnConflicts.push(entry.recordId);
        }
        continue;
      }
      if (entry.action !== 'created' && entry.action !== 'updated') continue;
      const document = await ctx.storage.getDocument(ns, KEYS.record(entry.recordId));
      const current = asRecord(document);
      if (current === null) { retained.push({ recordId: entry.recordId, reason: 'missing' }); continue; }
      if (current.importState.importId !== id || current.importState.writtenDigest !== entry.afterDigest) {
        retained.push({ recordId: entry.recordId, reason: 'changed-by-later-import' });
        continue;
      }
      if ((await recordDigest(ctx, current)) !== entry.afterDigest) {
        retained.push({ recordId: entry.recordId, reason: 'owner-edited' });
        continue;
      }
      if (entry.before !== null) {
        checkSchema(entry.before, SCHEMAS.record, `${KEYS.manifest(id)} before`);
        ops.push(put(ns, document, document!.key, entry.before));
        reverted.push(entry.recordId);
      } else {
        const next = await stamp(ctx, { ...withoutImportState(current), tombstone: { importId: id, at } }, id, current.importState.itemDigest);
        ops.push(put(ns, document, document!.key, next));
        tombstoned.push(entry.recordId);
      }
    }
    const undo: UndoDocument = { schema: SCHEMAS.undo, importId: id, undoneAt: at, tombstoned, reverted, retained, withdrawnConflicts };
    ops.push(put(ns, null, KEYS.undo(id), undo));
    ops.push({ op: 'append-event', namespace: ns, stream: IMPORT_STREAM, expectedSeq: await streamSeq(ctx),
      payload: { type: 'import.undone', importId: id, at, tombstoned: tombstoned.length, reverted: reverted.length, retained: retained.length } });
    await ctx.storage.commit(ops);
    return { ok: true, applied: true, undo };
  } catch (error) {
    if (error instanceof StoredSchemaError) return reject(error.reason, [{ code: error.reason, detail: error.message }]);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Owner edits and conflict resolution
// ---------------------------------------------------------------------------

export interface RecordEdit {
  readonly title?: string;
  readonly notes?: string;
}

/** Owner edit; makes the record owner-edited so later source changes conflict. */
export async function editImportedRecord(deps: ImportDeps, id: RecordId, edit: RecordEdit): Promise<ImportedRecord> {
  const ctx = context(deps);
  const document = await ctx.storage.getDocument(ctx.namespace, KEYS.record(id));
  const current = asRecord(document);
  if (current === null || current.tombstone !== null) throw new Error(`No live imported record ${id}`);
  if (edit.title !== undefined && (edit.title.length === 0 || edit.title.length > 300)) throw new Error('Title must be 1–300 characters');
  if (edit.notes !== undefined && edit.notes.length > 20_000) throw new Error('Notes are too long');
  const next: ImportedRecord = { ...current, ...(edit.title !== undefined ? { title: edit.title } : {}), ...(edit.notes !== undefined ? { notes: edit.notes } : {}) };
  if (jsonEqual(next, current)) return current;
  await ctx.storage.commit([put(ctx.namespace, document, document!.key, next)]);
  return next;
}

export type ConflictChoice = 'keep-current' | 'take-incoming';

/** Explicit owner resolution. `take-incoming` replaces importer-owned fields; notes stay. */
export async function resolveConflict(deps: ImportDeps, id: RecordId, choice: ConflictChoice): Promise<ConflictDocument> {
  const ctx = context(deps);
  const ns = ctx.namespace;
  const conflictDocument = await ctx.storage.getDocument(ns, KEYS.conflict(id));
  const conflict = asConflict(conflictDocument);
  if (conflict === null || conflict.status !== 'open') throw new Error(`No open conflict for ${id}`);
  const at = ctx.clock.now();
  const ops: WriteOp[] = [];
  const next: ConflictDocument = { ...conflict, status: choice === 'keep-current' ? 'kept' : 'taken', resolvedAt: at };
  if (choice === 'take-incoming') {
    const recordDocument = await ctx.storage.getDocument(ns, KEYS.record(id));
    const current = asRecord(recordDocument);
    if (current === null) throw new Error(`Imported record ${id} is missing`);
    const history = current.versionHistory.filter((versionIdValue) => versionIdValue !== conflict.incomingVersionId);
    const record = await stamp(ctx, {
      ...withoutImportState(current), ...conflict.incoming, versionId: conflict.incomingVersionId,
      versionHistory: [...history, conflict.incomingVersionId], tombstone: null,
    }, conflict.importId, conflict.incomingItemDigest);
    ops.push(put(ns, recordDocument, recordDocument!.key, record));
  }
  ops.push(put(ns, conflictDocument, conflictDocument!.key, next));
  ops.push({ op: 'append-event', namespace: ns, stream: IMPORT_STREAM, expectedSeq: await streamSeq(ctx),
    payload: { type: 'conflict.resolved', recordId: id, choice, importId: conflict.importId, at } });
  await ctx.storage.commit(ops);
  return next;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface ImportHistoryEntry {
  readonly manifest: ImportManifest;
  readonly undone: boolean;
}

export async function listImports(deps: ImportDeps): Promise<readonly ImportHistoryEntry[]> {
  const ctx = context(deps);
  const manifests = await ctx.storage.listDocuments(ctx.namespace, 'imports/manifests/');
  const undone = new Set((await ctx.storage.listDocuments(ctx.namespace, 'imports/undo/')).map((document) => document.key.slice('imports/undo/'.length)));
  return manifests.map((document) => asManifest(document)!)
    .sort((a, b) => (a.importedAt < b.importedAt ? 1 : a.importedAt > b.importedAt ? -1 : 0))
    .map((manifest) => ({ manifest, undone: undone.has(manifest.importId) }));
}

export async function listRecords(deps: ImportDeps, project: ProjectId): Promise<readonly ImportedRecord[]> {
  const ctx = context(deps);
  return (await ctx.storage.listDocuments(ctx.namespace, 'imports/records/'))
    .map((document) => asRecord(document)!)
    .filter((record) => record.projectId === project);
}

export async function listOpenConflicts(deps: ImportDeps): Promise<readonly ConflictDocument[]> {
  const ctx = context(deps);
  return (await ctx.storage.listDocuments(ctx.namespace, 'imports/conflicts/'))
    .map((document) => asConflict(document)!)
    .filter((conflict) => conflict.status === 'open');
}

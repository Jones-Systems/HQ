import type {
  AssetRef, BlobDigest, ClaimLevel, CollectionId, LibraryState, ProjectId, ReferenceCollection, ReferenceId,
  ReferenceImportCandidate, ReferenceKind, ReferenceRecord, ReferenceRights, ReferenceTag, ReferenceUse,
  ReferenceUseId, ValidationIssue, ViewId,
} from './contract.ts';
import { CLAIM_LEVELS, LIBRARY_SCHEMA, REFERENCE_KINDS } from './contract.ts';
import { sha256Hex } from './jcs.ts';
import {
  deriveReferenceId, isBlobDigest, isIsoTime, isMediaType, isOneOf, isOpaqueId, isText, mediaTypeFitsKind,
  normalizeSource, validateNativeEvidence, validateRights,
} from './provenance.ts';

export const MAX_TAGS = 32;
export const MAX_NOTES = 4000;

export function emptyLibrary(): LibraryState {
  return { schema: LIBRARY_SCHEMA, references: {}, collections: {}, uses: {} };
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
const fail = (code: string): { ok: false; code: string } => ({ ok: false, code });

/* ------------------------------------------------------------------ tags -- */

export function normalizeTag(raw: string): ReferenceTag | null {
  if (typeof raw !== 'string') return null;
  const tag = raw.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, ' ');
  return /^[\p{L}\p{N}][\p{L}\p{N} ._:/-]{0,47}$/u.test(tag) ? tag as ReferenceTag : null;
}

export function normalizeTags(raw: readonly string[], issues?: ValidationIssue[]): readonly ReferenceTag[] {
  const tags: ReferenceTag[] = [];
  for (const item of raw) {
    const tag = normalizeTag(item);
    if (tag === null) { issues?.push({ field: 'tags', code: 'invalid-tag' }); continue; }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_TAGS) issues?.push({ field: 'tags', code: 'too-many' });
  return tags.slice(0, MAX_TAGS).sort();
}

/* ---------------------------------------------------------------- import -- */

export interface PreparedImport {
  readonly record: ReferenceRecord;
  /** Bytes to store before the record is committed; null for pre-stored or asset-less imports. */
  readonly pendingBytes: Uint8Array | null;
  readonly collectionIds: readonly CollectionId[];
}

/**
 * Validates and normalizes a candidate and derives its stable ID. Pure apart
 * from hashing; nothing is written.
 */
export async function prepareImport(
  candidate: ReferenceImportCandidate, now: string,
): Promise<{ ok: true; prepared: PreparedImport } | { ok: false; issues: readonly ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];
  if (candidate === null || typeof candidate !== 'object') return { ok: false, issues: [{ field: '', code: 'invalid' }] };
  const kindOk = isOneOf(REFERENCE_KINDS, candidate.kind);
  if (!kindOk) issues.push({ field: 'kind', code: 'unsupported-kind' });
  const kind = (kindOk ? candidate.kind : 'screenshot') as ReferenceKind;
  const source = normalizeSource(candidate.source, issues);
  if (!isIsoTime(candidate.capturedAt)) issues.push({ field: 'capturedAt', code: 'invalid-time' });
  if (!isOneOf(CLAIM_LEVELS, candidate.capturedBy)) issues.push({ field: 'capturedBy', code: 'invalid' });
  if (!isText(candidate.title, 300)) issues.push({ field: 'title', code: 'invalid' });
  if (candidate.notes !== undefined && (typeof candidate.notes !== 'string' || candidate.notes.length > MAX_NOTES)) {
    issues.push({ field: 'notes', code: 'invalid' });
  }
  const tags = normalizeTags(candidate.tags ?? [], issues);
  const nativeEvidence = kindOk ? validateNativeEvidence(kind, source, candidate.nativeEvidence, issues) : null;
  const capturedBy = (isOneOf(CLAIM_LEVELS, candidate.capturedBy) ? candidate.capturedBy : 'agent-reported') as ClaimLevel;
  // Rights supplied by an importer are recorded at the importer's claim level.
  const rights = validateRights(candidate.rights, capturedBy === 'owner-judged' ? 'owner-judged' : 'agent-reported', now, issues);

  let asset: AssetRef | null = null;
  let pendingBytes: Uint8Array | null = null;
  const raw = candidate.asset;
  if (raw === undefined) {
    if (kindOk && (kind === 'screenshot' || kind === 'recording')) issues.push({ field: 'asset', code: 'required-for-kind' });
  } else if (!isMediaType(raw.mediaType)) {
    issues.push({ field: 'asset.mediaType', code: 'invalid' });
  } else {
    if (kindOk && !mediaTypeFitsKind(kind, raw.mediaType)) issues.push({ field: 'asset.mediaType', code: `not-a-${kind}-media-type` });
    const dims = {
      w: optionalPositive(raw.w, 'asset.w', issues), h: optionalPositive(raw.h, 'asset.h', issues),
      durationMs: optionalPositive(raw.durationMs, 'asset.durationMs', issues),
    };
    if ('bytes' in raw) {
      if (!(raw.bytes instanceof Uint8Array) || raw.bytes.byteLength === 0) {
        issues.push({ field: 'asset.bytes', code: 'invalid' });
      } else {
        const digest = `sha256:${await sha256Hex(raw.bytes)}` as BlobDigest;
        asset = { digest, mediaType: raw.mediaType, bytes: raw.bytes.byteLength, ...dims };
        pendingBytes = raw.bytes;
      }
    } else if (!isBlobDigest(raw.digest)) {
      issues.push({ field: 'asset.digest', code: 'invalid' });
    } else if (!Number.isSafeInteger(raw.byteLength) || raw.byteLength <= 0) {
      issues.push({ field: 'asset.byteLength', code: 'invalid' });
    } else {
      asset = { digest: raw.digest, mediaType: raw.mediaType, bytes: raw.byteLength, ...dims };
    }
  }

  const collectionIds: CollectionId[] = [];
  for (const id of candidate.collectionIds ?? []) {
    if (!isOpaqueId(id, 'col')) issues.push({ field: 'collectionIds', code: 'invalid' });
    else if (!collectionIds.includes(id as CollectionId)) collectionIds.push(id as CollectionId);
  }

  if (issues.length > 0 || source === null) return { ok: false, issues };
  const id = await deriveReferenceId(source, kind, asset?.digest ?? null);
  return {
    ok: true,
    prepared: {
      pendingBytes, collectionIds,
      record: {
        id, kind, source, asset, capturedAt: candidate.capturedAt, capturedBy, nativeEvidence,
        title: candidate.title, notes: candidate.notes ?? '', tags, rights,
        importedAt: now, lastImportedAt: now, importCount: 1, tombstonedAt: null,
      },
    },
  };
}

export function optionalPositive(value: unknown, field: string, issues: ValidationIssue[]): number | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e9) {
    issues.push({ field, code: 'invalid' });
    return null;
  }
  return value;
}

function sameRights(a: ReferenceRights, b: ReferenceRights): boolean {
  return a.status === b.status && a.basis === b.basis && a.attribution === b.attribution;
}

/** Fields an import supplied that differ from the stored, possibly owner-edited, record. */
function importDifferences(existing: ReferenceRecord, incoming: ReferenceRecord): string[] {
  const differences: string[] = [];
  if (existing.title !== incoming.title) differences.push('title');
  if (existing.notes !== incoming.notes) differences.push('notes');
  if (existing.tags.join('\u0000') !== incoming.tags.join('\u0000')) differences.push('tags');
  if (!sameRights(existing.rights, incoming.rights)) differences.push('rights');
  if (existing.capturedAt !== incoming.capturedAt) differences.push('capturedAt');
  if (existing.capturedBy !== incoming.capturedBy) differences.push('capturedBy');
  if (JSON.stringify(existing.source) !== JSON.stringify(incoming.source)) differences.push('source');
  if (existing.asset?.mediaType !== incoming.asset?.mediaType) differences.push('asset.mediaType');
  if (JSON.stringify(existing.nativeEvidence) !== JSON.stringify(incoming.nativeEvidence)) differences.push('nativeEvidence');
  return differences;
}

export type ImportApplication =
  | { readonly ok: true; readonly state: LibraryState; readonly status: 'created' | 'unchanged' | 'observed-again' | 'tombstoned'; readonly id: ReferenceId; readonly differences: readonly string[] }
  | { readonly ok: false; readonly code: string };

/**
 * Commits a prepared import. Re-importing an existing identity keeps the ID
 * and never overwrites title, notes, tags, rights or capture provenance; an
 * identical repeat leaves the state object unchanged so callers skip writes.
 */
export function applyImport(state: LibraryState, prepared: PreparedImport, now: string): ImportApplication {
  for (const id of prepared.collectionIds) {
    const collection = state.collections[id];
    if (collection === undefined || collection.tombstonedAt !== null) return fail('collection-unavailable');
  }
  const incoming = prepared.record;
  const existing = state.references[incoming.id];
  if (existing === undefined) {
    const next = { ...state, references: { ...state.references, [incoming.id]: { ...incoming, importedAt: now, lastImportedAt: now } } };
    return { ok: true, state: addMemberships(next, incoming.id, prepared.collectionIds), status: 'created', id: incoming.id, differences: [] };
  }
  const differences = importDifferences(existing, incoming);
  if (existing.tombstonedAt !== null) return { ok: true, state, status: 'tombstoned', id: existing.id, differences };
  const withMembership = addMemberships(state, existing.id, prepared.collectionIds);
  if (differences.length === 0) {
    return { ok: true, state: withMembership, status: 'unchanged', id: existing.id, differences };
  }
  const capturedAt = Date.parse(existing.capturedAt) <= Date.parse(incoming.capturedAt) ? existing.capturedAt : incoming.capturedAt;
  const updated: ReferenceRecord = { ...existing, capturedAt, lastImportedAt: now, importCount: existing.importCount + 1 };
  return {
    ok: true, status: 'observed-again', id: existing.id, differences,
    state: { ...withMembership, references: { ...withMembership.references, [existing.id]: updated } },
  };
}

function addMemberships(state: LibraryState, id: ReferenceId, collectionIds: readonly CollectionId[]): LibraryState {
  let collections = state.collections;
  for (const collectionId of collectionIds) {
    const collection = collections[collectionId];
    if (collection === undefined || collection.referenceIds.includes(id)) continue;
    collections = { ...collections, [collectionId]: { ...collection, referenceIds: [...collection.referenceIds, id] } };
  }
  return collections === state.collections ? state : { ...state, collections };
}

/* ------------------------------------------------------- reference edits -- */

function liveReference(state: LibraryState, id: ReferenceId): Result<ReferenceRecord> {
  const record = state.references[id];
  if (record === undefined) return fail('reference-not-found');
  if (record.tombstonedAt !== null) return fail('reference-tombstoned');
  return { ok: true, value: record };
}

function putReference(state: LibraryState, record: ReferenceRecord): LibraryState {
  return { ...state, references: { ...state.references, [record.id]: record } };
}

export function updateDetails(state: LibraryState, id: ReferenceId, patch: { title?: string; notes?: string }): Result<LibraryState> {
  const found = liveReference(state, id);
  if (!found.ok) return found;
  if (patch.title !== undefined && !isText(patch.title, 300)) return fail('invalid-title');
  if (patch.notes !== undefined && (typeof patch.notes !== 'string' || patch.notes.length > MAX_NOTES)) return fail('invalid-notes');
  return { ok: true, value: putReference(state, { ...found.value, title: patch.title ?? found.value.title, notes: patch.notes ?? found.value.notes }) };
}

export function setTags(state: LibraryState, id: ReferenceId, raw: readonly string[]): Result<LibraryState> {
  const found = liveReference(state, id);
  if (!found.ok) return found;
  const issues: ValidationIssue[] = [];
  const tags = normalizeTags(raw, issues);
  if (issues.length > 0) return fail(issues[0]!.code);
  return { ok: true, value: putReference(state, { ...found.value, tags }) };
}

/** Owner decision on rights. Only this path records `owner-judged`. */
export function setRights(
  state: LibraryState, id: ReferenceId, raw: { status: string; basis?: string; attribution?: string }, now: string,
): Result<LibraryState> {
  const found = liveReference(state, id);
  if (!found.ok) return found;
  const issues: ValidationIssue[] = [];
  const rights = validateRights(raw, 'owner-judged', now, issues);
  if (issues.length > 0) return fail(issues[0]!.code);
  return { ok: true, value: putReference(state, { ...found.value, rights }) };
}

/** Tombstones a reference. Its blob, memberships and links are retained. */
export function tombstoneReference(state: LibraryState, id: ReferenceId, now: string): Result<LibraryState> {
  const found = liveReference(state, id);
  if (!found.ok) return found;
  return { ok: true, value: putReference(state, { ...found.value, tombstonedAt: now }) };
}

export function restoreReference(state: LibraryState, id: ReferenceId): Result<LibraryState> {
  const record = state.references[id];
  if (record === undefined) return fail('reference-not-found');
  if (record.tombstonedAt === null) return { ok: true, value: state };
  return { ok: true, value: putReference(state, { ...record, tombstonedAt: null }) };
}

/* ----------------------------------------------------------- collections -- */

function liveCollection(state: LibraryState, id: CollectionId): Result<ReferenceCollection> {
  const collection = state.collections[id];
  if (collection === undefined) return fail('collection-not-found');
  if (collection.tombstonedAt !== null) return fail('collection-tombstoned');
  return { ok: true, value: collection };
}

function putCollection(state: LibraryState, collection: ReferenceCollection): LibraryState {
  return { ...state, collections: { ...state.collections, [collection.id]: collection } };
}

export function createCollection(
  state: LibraryState, id: string, name: string, description: string, now: string,
): Result<LibraryState> {
  if (!isOpaqueId(id, 'col')) return fail('invalid-id');
  if (state.collections[id] !== undefined) return fail('collection-exists');
  if (!isText(name, 200)) return fail('invalid-name');
  if (typeof description !== 'string' || description.length > 2000) return fail('invalid-description');
  return { ok: true, value: putCollection(state, { id: id as CollectionId, name, description, referenceIds: [], createdAt: now, tombstonedAt: null }) };
}

export function renameCollection(state: LibraryState, id: CollectionId, name: string): Result<LibraryState> {
  const found = liveCollection(state, id);
  if (!found.ok) return found;
  if (!isText(name, 200)) return fail('invalid-name');
  return { ok: true, value: putCollection(state, { ...found.value, name }) };
}

export function addToCollection(state: LibraryState, id: CollectionId, referenceId: ReferenceId): Result<LibraryState> {
  const found = liveCollection(state, id);
  if (!found.ok) return found;
  const reference = liveReference(state, referenceId);
  if (!reference.ok) return reference;
  if (found.value.referenceIds.includes(referenceId)) return { ok: true, value: state };
  return { ok: true, value: putCollection(state, { ...found.value, referenceIds: [...found.value.referenceIds, referenceId] }) };
}

export function removeFromCollection(state: LibraryState, id: CollectionId, referenceId: ReferenceId): Result<LibraryState> {
  const found = liveCollection(state, id);
  if (!found.ok) return found;
  if (!found.value.referenceIds.includes(referenceId)) return { ok: true, value: state };
  return { ok: true, value: putCollection(state, { ...found.value, referenceIds: found.value.referenceIds.filter((item) => item !== referenceId) }) };
}

/**
 * Deleting a collection tombstones it and keeps its membership list for
 * restore. Referenced records and their blobs are untouched.
 */
export function tombstoneCollection(state: LibraryState, id: CollectionId, now: string): Result<LibraryState> {
  const found = liveCollection(state, id);
  if (!found.ok) return found;
  return { ok: true, value: putCollection(state, { ...found.value, tombstonedAt: now }) };
}

export function restoreCollection(state: LibraryState, id: CollectionId): Result<LibraryState> {
  const collection = state.collections[id];
  if (collection === undefined) return fail('collection-not-found');
  if (collection.tombstonedAt === null) return { ok: true, value: state };
  return { ok: true, value: putCollection(state, { ...collection, tombstonedAt: null }) };
}

/* ------------------------------------------------------- use in project -- */

/**
 * Records an explicit "use in project" link. Repeating the same link returns
 * the existing one. A link is data only; it never starts work.
 */
export function linkToProject(
  state: LibraryState, useId: string, referenceId: ReferenceId, projectId: string,
  viewId: string | null, purpose: string, now: string,
): Result<{ state: LibraryState; use: ReferenceUse }> {
  const reference = liveReference(state, referenceId);
  if (!reference.ok) return reference;
  if (!isText(projectId, 160)) return fail('invalid-project');
  if (viewId !== null && !isText(viewId, 160)) return fail('invalid-view');
  if (typeof purpose !== 'string' || purpose.length > 500) return fail('invalid-purpose');
  const existing = Object.values(state.uses).find((use) => use.tombstonedAt === null
    && use.referenceId === referenceId && use.projectId === projectId && use.viewId === viewId);
  if (existing !== undefined) return { ok: true, value: { state, use: existing } };
  if (!isOpaqueId(useId, 'use') || state.uses[useId] !== undefined) return fail('invalid-id');
  const use: ReferenceUse = {
    id: useId as ReferenceUseId, referenceId, projectId: projectId as ProjectId, viewId: viewId as ViewId | null,
    purpose, linkedAt: now, tombstonedAt: null,
  };
  return { ok: true, value: { state: { ...state, uses: { ...state.uses, [use.id]: use } }, use } };
}

export function unlinkFromProject(state: LibraryState, useId: ReferenceUseId, now: string): Result<LibraryState> {
  const use = state.uses[useId];
  if (use === undefined) return fail('use-not-found');
  if (use.tombstonedAt !== null) return { ok: true, value: state };
  return { ok: true, value: { ...state, uses: { ...state.uses, [useId]: { ...use, tombstonedAt: now } } } };
}

export function usesForReference(state: LibraryState, id: ReferenceId): readonly ReferenceUse[] {
  return Object.values(state.uses).filter((use) => use.referenceId === id && use.tombstonedAt === null)
    .sort((a, b) => a.linkedAt.localeCompare(b.linkedAt) || a.id.localeCompare(b.id));
}

export function usesForProject(state: LibraryState, projectId: string): readonly ReferenceUse[] {
  return Object.values(state.uses).filter((use) => use.projectId === projectId && use.tombstonedAt === null)
    .sort((a, b) => a.linkedAt.localeCompare(b.linkedAt) || a.id.localeCompare(b.id));
}

/** Every blob digest referenced by any record, live or tombstoned. */
export function referencedBlobDigests(state: LibraryState): readonly BlobDigest[] {
  const digests = new Set<BlobDigest>();
  for (const record of Object.values(state.references)) if (record.asset !== null) digests.add(record.asset.digest);
  return [...digests].sort();
}

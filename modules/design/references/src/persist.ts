import type {
  AssetRef, LibraryState, NativeExecutionEvidence, ReferenceCollection, ReferenceRecord, ReferenceRights,
  ReferenceSource, ReferenceUse,
} from './contract.ts';
import {
  APP_PLATFORMS, CLAIM_LEVELS, LIBRARY_SCHEMA, NATIVE_RUNTIMES, REFERENCE_KINDS, RIGHTS_STATUSES,
} from './contract.ts';
import { normalizeTag } from './library.ts';
import {
  isBlobDigest, isIsoTime, isMediaType, isOneOf, isOpaqueId, isReferenceId, isText, normalizeUrl,
} from './provenance.ts';

export type ParsedLibrary =
  | { readonly status: 'ok'; readonly state: LibraryState }
  /** A newer schema: callers must open read-only and never write. */
  | { readonly status: 'future-schema'; readonly schema: string }
  /** Unreadable or inconsistent: never repaired automatically. */
  | { readonly status: 'invalid'; readonly path: string };

type Json = Record<string, unknown>;

class Invalid extends Error {
  readonly path: string;
  constructor(path: string) { super(path); this.path = path; }
}

function object(value: unknown, path: string, allowed: readonly string[]): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Invalid(path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Invalid(`${path}.${key}`);
  return value as Json;
}

function check(condition: boolean, path: string): void {
  if (!condition) throw new Invalid(path);
}

const nullable = <T>(value: unknown, test: (value: unknown) => value is T): value is T | null => value === null || test(value);
const positiveOrNull = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);

function source(value: unknown, path: string): ReferenceSource {
  const raw = object(value, path, ['kind', 'url', 'platform', 'appId', 'appName', 'screen']);
  if (raw.kind === 'url') {
    check(typeof raw.url === 'string' && normalizeUrl(raw.url) === raw.url, `${path}.url`);
    check(Object.keys(raw).length === 2, path);
    return raw as unknown as ReferenceSource;
  }
  check(raw.kind === 'app', `${path}.kind`);
  check(isOneOf(APP_PLATFORMS, raw.platform), `${path}.platform`);
  check(isText(raw.appId, 200), `${path}.appId`);
  check(isText(raw.appName, 200), `${path}.appName`);
  check(nullable(raw.screen, (item): item is string => isText(item, 300)), `${path}.screen`);
  check(!('url' in raw), path);
  return raw as unknown as ReferenceSource;
}

function asset(value: unknown, path: string): AssetRef | null {
  if (value === null) return null;
  const raw = object(value, path, ['digest', 'mediaType', 'bytes', 'w', 'h', 'durationMs']);
  check(isBlobDigest(raw.digest), `${path}.digest`);
  check(isMediaType(raw.mediaType), `${path}.mediaType`);
  check(Number.isSafeInteger(raw.bytes) && (raw.bytes as number) > 0, `${path}.bytes`);
  check(positiveOrNull(raw.w) && positiveOrNull(raw.h) && positiveOrNull(raw.durationMs), path);
  return raw as unknown as AssetRef;
}

function nativeEvidence(value: unknown, path: string): NativeExecutionEvidence | null {
  if (value === null) return null;
  const raw = object(value, path, ['platform', 'runtime', 'buildRef', 'claim']);
  check(isOneOf(APP_PLATFORMS, raw.platform) && isOneOf(NATIVE_RUNTIMES, raw.runtime)
    && isText(raw.buildRef, 200) && isOneOf(CLAIM_LEVELS, raw.claim), path);
  return raw as unknown as NativeExecutionEvidence;
}

function rights(value: unknown, path: string): ReferenceRights {
  const raw = object(value, path, ['status', 'basis', 'attribution', 'setBy', 'setAt']);
  check(isOneOf(RIGHTS_STATUSES, raw.status), `${path}.status`);
  check(nullable(raw.basis, (item): item is string => isText(item, 500)), `${path}.basis`);
  check(nullable(raw.attribution, (item): item is string => isText(item, 500)), `${path}.attribution`);
  check(raw.status !== 'permitted' || raw.basis !== null, `${path}.basis`);
  check(isOneOf(CLAIM_LEVELS, raw.setBy) && isIsoTime(raw.setAt), path);
  return raw as unknown as ReferenceRights;
}

function reference(key: string, value: unknown, path: string): ReferenceRecord {
  const raw = object(value, path, [
    'id', 'kind', 'source', 'asset', 'capturedAt', 'capturedBy', 'nativeEvidence', 'title', 'notes', 'tags', 'rights',
    'importedAt', 'lastImportedAt', 'importCount', 'tombstonedAt',
  ]);
  check(isReferenceId(raw.id) && raw.id === key, `${path}.id`);
  check(isOneOf(REFERENCE_KINDS, raw.kind), `${path}.kind`);
  const parsedSource = source(raw.source, `${path}.source`);
  asset(raw.asset, `${path}.asset`);
  const evidence = nativeEvidence(raw.nativeEvidence, `${path}.nativeEvidence`);
  // The persisted form must uphold the same invariant as import.
  check(evidence === null || (raw.kind === 'native' && parsedSource.kind === 'app'), `${path}.nativeEvidence`);
  check(isIsoTime(raw.capturedAt) && isOneOf(CLAIM_LEVELS, raw.capturedBy), `${path}.capturedAt`);
  check(isText(raw.title, 300) && typeof raw.notes === 'string', `${path}.title`);
  check(Array.isArray(raw.tags) && raw.tags.every((tag) => typeof tag === 'string' && normalizeTag(tag) === tag), `${path}.tags`);
  rights(raw.rights, `${path}.rights`);
  check(isIsoTime(raw.importedAt) && isIsoTime(raw.lastImportedAt), `${path}.importedAt`);
  check(Number.isSafeInteger(raw.importCount) && (raw.importCount as number) >= 1, `${path}.importCount`);
  check(nullable(raw.tombstonedAt, isIsoTime), `${path}.tombstonedAt`);
  return raw as unknown as ReferenceRecord;
}

function collection(key: string, value: unknown, path: string, references: Json): ReferenceCollection {
  const raw = object(value, path, ['id', 'name', 'description', 'referenceIds', 'createdAt', 'tombstonedAt']);
  check(isOpaqueId(raw.id, 'col') && raw.id === key, `${path}.id`);
  check(isText(raw.name, 200) && typeof raw.description === 'string', `${path}.name`);
  check(Array.isArray(raw.referenceIds) && raw.referenceIds.every((id) => typeof id === 'string' && Object.hasOwn(references, id)), `${path}.referenceIds`);
  check(isIsoTime(raw.createdAt) && nullable(raw.tombstonedAt, isIsoTime), path);
  return raw as unknown as ReferenceCollection;
}

function use(key: string, value: unknown, path: string, references: Json): ReferenceUse {
  const raw = object(value, path, ['id', 'referenceId', 'projectId', 'viewId', 'purpose', 'linkedAt', 'tombstonedAt']);
  check(isOpaqueId(raw.id, 'use') && raw.id === key, `${path}.id`);
  check(typeof raw.referenceId === 'string' && Object.hasOwn(references, raw.referenceId), `${path}.referenceId`);
  check(isText(raw.projectId, 160) && nullable(raw.viewId, (item): item is string => isText(item, 160)), `${path}.projectId`);
  check(typeof raw.purpose === 'string' && isIsoTime(raw.linkedAt) && nullable(raw.tombstonedAt, isIsoTime), path);
  return raw as unknown as ReferenceUse;
}

function map<T>(value: unknown, path: string, parse: (key: string, item: unknown, path: string) => T): Record<string, T> {
  const raw = object(value, path, Object.keys(value ?? {}));
  const out: Record<string, T> = {};
  for (const [key, item] of Object.entries(raw)) out[key] = parse(key, item, `${path}.${key}`);
  return out;
}

const SCHEMA_PATTERN = /^hq\.design\.references\/v([1-9]\d{0,5})$/u;

/** Strictly validates a persisted library. Never repairs or down-converts. */
export function parseLibraryDocument(value: unknown): ParsedLibrary {
  try {
    if (typeof value === 'object' && value !== null && 'schema' in value) {
      const schema = (value as Json).schema;
      const match = typeof schema === 'string' ? SCHEMA_PATTERN.exec(schema) : null;
      if (match !== null && Number(match[1]) > 1) return { status: 'future-schema', schema: schema as string };
    }
    const raw = object(value, '$', ['schema', 'references', 'collections', 'uses']);
    check(raw.schema === LIBRARY_SCHEMA, '$.schema');
    const references = map(raw.references, '$.references', reference);
    const collections = map(raw.collections, '$.collections', (key, item, path) => collection(key, item, path, references));
    const uses = map(raw.uses, '$.uses', (key, item, path) => use(key, item, path, references));
    return { status: 'ok', state: { schema: LIBRARY_SCHEMA, references, collections, uses } };
  } catch (error) {
    if (error instanceof Invalid) return { status: 'invalid', path: error.path };
    throw error;
  }
}

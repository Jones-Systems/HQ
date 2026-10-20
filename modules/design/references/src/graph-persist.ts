import { APP_PLATFORMS, CLAIM_LEVELS, REFERENCE_KINDS } from './contract.ts';
import type {
  AnchorNode, CaptureAvailability, CaptureRecord, GraphRights, GraphState, ReferencePin, SubjectIdentity, SubjectNode,
} from './graph-contract.ts';
import {
  ANCHOR_KINDS, CAPTURE_ORIGINS, CAPTURE_SUBJECT_KINDS, CONTENT_AVAILABILITY, GRAPH_SCHEMA, SOURCE_AVAILABILITY,
  SUBJECT_KINDS,
} from './graph-contract.ts';
import {
  deriveAnchorId, deriveCaptureId, derivePinId, deriveSubjectId, isAnchorId, isCaptureId, isPinId, isSubjectId,
  normalizeOrigin, originOf,
} from './graph-identity.ts';
import { INERT_MEDIA_TYPES, isAnchorRect } from './graph-import.ts';
import type { Json } from './persist.ts';
import { asset, check, Invalid, map, nativeEvidence, nullable, object } from './persist.ts';
import { isBlobDigest, isIsoTime, isOneOf, isReferenceId, isText, normalizeUrl } from './provenance.ts';
import { isRightsToken, rightsAgreeWithRegistry } from './rights.ts';

export type ParsedGraph =
  | { readonly status: 'ok'; readonly state: GraphState }
  /** A newer schema: callers must open read-only and never write. */
  | { readonly status: 'future-schema'; readonly schema: string }
  /** Unreadable or inconsistent: never repaired automatically. */
  | { readonly status: 'invalid'; readonly path: string };

const text = (max: number) => (item: unknown): item is string => isText(item, max);

export function identity(value: unknown, path: string): SubjectIdentity {
  const raw = object(value, path, ['kind', 'origin', 'url', 'platform', 'appId', 'app', 'key']);
  const only = (...keys: string[]) => check(Object.keys(raw).length === keys.length && keys.every((key) => Object.hasOwn(raw, key)), path);
  switch (raw.kind) {
    case 'site':
      only('kind', 'origin');
      check(typeof raw.origin === 'string' && normalizeOrigin(raw.origin) === raw.origin, `${path}.origin`);
      break;
    case 'page':
      only('kind', 'url');
      check(typeof raw.url === 'string' && normalizeUrl(raw.url) === raw.url, `${path}.url`);
      break;
    case 'app':
      only('kind', 'platform', 'appId');
      check(isOneOf(APP_PLATFORMS, raw.platform), `${path}.platform`);
      check(isText(raw.appId, 200), `${path}.appId`);
      break;
    case 'flow':
    case 'screen':
      only('kind', 'app', 'key');
      check(isSubjectId(raw.app), `${path}.app`);
      check(isText(raw.key, 300), `${path}.key`);
      break;
    default: throw new Invalid(`${path}.kind`);
  }
  return raw as unknown as SubjectIdentity;
}

function subject(key: string, value: unknown, path: string): SubjectNode {
  const raw = object(value, path, ['id', 'kind', 'identity', 'parentId', 'steps', 'title', 'rating', 'createdAt', 'tombstonedAt']);
  check(isSubjectId(raw.id) && raw.id === key, `${path}.id`);
  check(isOneOf(SUBJECT_KINDS, raw.kind), `${path}.kind`);
  const parsed = identity(raw.identity, `${path}.identity`);
  check(parsed.kind === raw.kind, `${path}.kind`);
  check(raw.parentId === null || isSubjectId(raw.parentId), `${path}.parentId`);
  check(Array.isArray(raw.steps) && raw.steps.every(isSubjectId) && new Set(raw.steps).size === raw.steps.length, `${path}.steps`);
  check(raw.kind === 'flow' || (raw.steps as unknown[]).length === 0, `${path}.steps`);
  check(isText(raw.title, 300), `${path}.title`);
  check(raw.rating === null || (Number.isInteger(raw.rating) && (raw.rating as number) >= 1 && (raw.rating as number) <= 5), `${path}.rating`);
  check(isIsoTime(raw.createdAt) && nullable(raw.tombstonedAt, isIsoTime), `${path}.createdAt`);
  return raw as unknown as SubjectNode;
}

function checkSubjectLinks(subjects: Record<string, SubjectNode>): void {
  for (const node of Object.values(subjects)) {
    const path = `$.subjects.${node.id}`;
    const parent = node.parentId === null ? undefined : subjects[node.parentId];
    switch (node.identity.kind) {
      case 'site': case 'app':
        check(node.parentId === null, `${path}.parentId`);
        break;
      case 'page':
        check(parent !== undefined && parent.identity.kind === 'site' && parent.identity.origin === originOf(node.identity.url), `${path}.parentId`);
        break;
      case 'flow': case 'screen':
        check(parent !== undefined && parent.identity.kind === 'app' && parent.id === node.identity.app, `${path}.parentId`);
        break;
    }
    for (const step of node.steps) {
      const target = subjects[step];
      check(target !== undefined && target.kind === 'screen' && target.parentId === node.parentId, `${path}.steps`);
    }
  }
}

export function rights(value: unknown, path: string): GraphRights {
  const raw = object(value, path, ['declared', 'effective', 'private', 'basis', 'attribution', 'setBy', 'setAt']);
  const declared = object(raw.declared, `${path}.declared`, ['vocabulary', 'value']);
  check(isRightsToken(declared.vocabulary) && isRightsToken(declared.value), `${path}.declared`);
  check(nullable(raw.basis, text(500)) && nullable(raw.attribution, text(500)), `${path}.basis`);
  check(typeof raw.private === 'boolean', `${path}.private`);
  check(isOneOf(CLAIM_LEVELS, raw.setBy) && isIsoTime(raw.setAt), `${path}.setBy`);
  // The stored effective status must be exactly what the registry derives; a hand-edited grant is invalid.
  check(rightsAgreeWithRegistry(raw as unknown as GraphRights), `${path}.effective`);
  return raw as unknown as GraphRights;
}

export function availability(value: unknown, path: string): CaptureAvailability {
  const raw = object(value, path, ['content', 'contentCheckedAt', 'source', 'sourceObservedAt', 'sourceObservedBy']);
  check(isOneOf(CONTENT_AVAILABILITY, raw.content) && isIsoTime(raw.contentCheckedAt), `${path}.content`);
  check(isOneOf(SOURCE_AVAILABILITY, raw.source), `${path}.source`);
  const unchecked = raw.source === 'unchecked';
  check(unchecked ? raw.sourceObservedAt === null && raw.sourceObservedBy === null
    : isIsoTime(raw.sourceObservedAt) && isOneOf(CLAIM_LEVELS, raw.sourceObservedBy), `${path}.sourceObservedAt`);
  return raw as unknown as CaptureAvailability;
}

function capture(key: string, value: unknown, path: string, subjects: Record<string, SubjectNode>): CaptureRecord {
  const raw = object(value, path, [
    'id', 'subjectId', 'kind', 'captureKey', 'asset', 'capturedAt', 'capturedBy', 'nativeEvidence', 'referenceId',
    'provenance', 'lineage', 'rights', 'availability', 'importedAt', 'lastImportedAt', 'importCount', 'tombstonedAt',
  ]);
  check(isCaptureId(raw.id) && raw.id === key, `${path}.id`);
  check(isSubjectId(raw.subjectId) && Object.hasOwn(subjects, raw.subjectId), `${path}.subjectId`);
  const owner = subjects[raw.subjectId as string]!;
  check((CAPTURE_SUBJECT_KINDS as readonly string[]).includes(owner.kind), `${path}.subjectId`);
  check(isOneOf(REFERENCE_KINDS, raw.kind), `${path}.kind`);
  const parsedAsset = asset(raw.asset, `${path}.asset`);
  check(parsedAsset === null || INERT_MEDIA_TYPES.includes(parsedAsset.mediaType), `${path}.asset.mediaType`);
  check(parsedAsset === null ? isText(raw.captureKey, 200) : raw.captureKey === null, `${path}.captureKey`);
  const evidence = nativeEvidence(raw.nativeEvidence, `${path}.nativeEvidence`);
  const appFamily = owner.kind === 'screen' || owner.kind === 'flow';
  check(raw.kind !== 'native' || (evidence !== null && appFamily), `${path}.nativeEvidence`);
  check(evidence === null || raw.kind === 'native', `${path}.nativeEvidence`);
  check(isIsoTime(raw.capturedAt) && isOneOf(CLAIM_LEVELS, raw.capturedBy), `${path}.capturedAt`);
  check(raw.referenceId === null || isReferenceId(raw.referenceId), `${path}.referenceId`);
  const provenance = object(raw.provenance, `${path}.provenance`, ['producer', 'origin', 'packetDigest']);
  check(provenance.producer === null || (() => {
    const producer = object(provenance.producer, `${path}.provenance.producer`, ['id', 'label']);
    return isText(producer.id, 100) && nullable(producer.label, text(200));
  })(), `${path}.provenance.producer`);
  check(isOneOf(CAPTURE_ORIGINS, provenance.origin), `${path}.provenance.origin`);
  check((provenance.origin === 'packet') === (provenance.packetDigest !== null)
    && (provenance.packetDigest === null || isBlobDigest(provenance.packetDigest)), `${path}.provenance.packetDigest`);
  const lineage = object(raw.lineage, `${path}.lineage`, ['supersedes']);
  check(lineage.supersedes === null || isCaptureId(lineage.supersedes), `${path}.lineage.supersedes`);
  rights(raw.rights, `${path}.rights`);
  const parsedAvailability = availability(raw.availability, `${path}.availability`);
  check(parsedAsset === null ? parsedAvailability.content === 'no-image' : parsedAvailability.content !== 'no-image', `${path}.availability.content`);
  check(isIsoTime(raw.importedAt) && isIsoTime(raw.lastImportedAt), `${path}.importedAt`);
  check(Number.isSafeInteger(raw.importCount) && (raw.importCount as number) >= 1, `${path}.importCount`);
  check(nullable(raw.tombstonedAt, isIsoTime), `${path}.tombstonedAt`);
  return raw as unknown as CaptureRecord;
}

function checkLineage(captures: Record<string, CaptureRecord>): void {
  for (const record of Object.values(captures)) {
    const path = `$.captures.${record.id}.lineage.supersedes`;
    const seen = new Set<string>([record.id]);
    for (let next = record.lineage.supersedes; next !== null;) {
      const target = captures[next];
      check(target !== undefined && target.subjectId === record.subjectId && !seen.has(next), path);
      seen.add(next);
      next = target!.lineage.supersedes;
    }
  }
}

function anchor(key: string, value: unknown, path: string, captures: Record<string, CaptureRecord>): AnchorNode {
  const raw = object(value, path, ['id', 'captureId', 'assetDigest', 'kind', 'key', 'parentId', 'label', 'rect', 'createdAt']);
  check(isAnchorId(raw.id) && raw.id === key, `${path}.id`);
  check(isCaptureId(raw.captureId) && Object.hasOwn(captures, raw.captureId), `${path}.captureId`);
  // An anchor binds one exact digest: the capture's own, never a stale or different one.
  check(isBlobDigest(raw.assetDigest) && captures[raw.captureId as string]!.asset?.digest === raw.assetDigest, `${path}.assetDigest`);
  check(isOneOf(ANCHOR_KINDS, raw.kind) && isText(raw.key, 200) && isText(raw.label, 200), `${path}.kind`);
  check(raw.rect === null || isAnchorRect(raw.rect), `${path}.rect`);
  check(raw.parentId === null || isAnchorId(raw.parentId), `${path}.parentId`);
  check(isIsoTime(raw.createdAt), `${path}.createdAt`);
  return raw as unknown as AnchorNode;
}

function checkAnchorParents(anchors: Record<string, AnchorNode>): void {
  for (const node of Object.values(anchors)) {
    const path = `$.anchors.${node.id}.parentId`;
    const seen = new Set<string>([node.id]);
    for (let next = node.parentId; next !== null;) {
      const parent = anchors[next];
      check(parent !== undefined && parent.captureId === node.captureId && !seen.has(next), path);
      check(node.kind !== 'section' || parent!.kind === 'section', path);
      seen.add(next);
      next = parent!.parentId;
    }
  }
}

function pin(key: string, value: unknown, path: string, captures: Record<string, CaptureRecord>, anchors: Record<string, AnchorNode>): ReferencePin {
  const raw = object(value, path, ['id', 'projectId', 'viewId', 'captureId', 'assetDigest', 'anchorId', 'purpose', 'pinnedAt', 'tombstonedAt']);
  check(isPinId(raw.id) && raw.id === key, `${path}.id`);
  check(isText(raw.projectId, 160) && nullable(raw.viewId, text(160)), `${path}.projectId`);
  check(isCaptureId(raw.captureId) && Object.hasOwn(captures, raw.captureId), `${path}.captureId`);
  check(raw.assetDigest === (captures[raw.captureId as string]!.asset?.digest ?? null), `${path}.assetDigest`);
  check(raw.anchorId === null || (isAnchorId(raw.anchorId) && anchors[raw.anchorId]?.captureId === raw.captureId), `${path}.anchorId`);
  check(typeof raw.purpose === 'string' && raw.purpose.length <= 500, `${path}.purpose`);
  check(isIsoTime(raw.pinnedAt) && nullable(raw.tombstonedAt, isIsoTime), `${path}.pinnedAt`);
  return raw as unknown as ReferencePin;
}

const SCHEMA_PATTERN = /^hq\.design\.reference-graph\/v([1-9]\d{0,5})$/u;

/** Structure only: shapes, enums and cross-references. IDs are re-derived by `verifyGraphIdentities`. */
export function parseGraphStructure(value: unknown): ParsedGraph {
  try {
    if (typeof value === 'object' && value !== null && 'schema' in value) {
      const schema = (value as Json).schema;
      const match = typeof schema === 'string' ? SCHEMA_PATTERN.exec(schema) : null;
      if (match !== null && Number(match[1]) > 1) return { status: 'future-schema', schema: schema as string };
    }
    const raw = object(value, '$', ['schema', 'subjects', 'captures', 'anchors', 'pins']);
    check(raw.schema === GRAPH_SCHEMA, '$.schema');
    const subjects = map(raw.subjects, '$.subjects', subject);
    checkSubjectLinks(subjects);
    const captures = map(raw.captures, '$.captures', (key, item, path) => capture(key, item, path, subjects));
    checkLineage(captures);
    const anchors = map(raw.anchors, '$.anchors', (key, item, path) => anchor(key, item, path, captures));
    checkAnchorParents(anchors);
    const pins = map(raw.pins, '$.pins', (key, item, path) => pin(key, item, path, captures, anchors));
    return { status: 'ok', state: { schema: GRAPH_SCHEMA, subjects, captures, anchors, pins } };
  } catch (error) {
    if (error instanceof Invalid) return { status: 'invalid', path: error.path };
    throw error;
  }
}

/** Re-derives every ID from its canonical identity and returns the first path that disagrees. */
export async function verifyGraphIdentities(state: GraphState): Promise<string | null> {
  for (const node of Object.values(state.subjects)) {
    if (await deriveSubjectId(node.identity) !== node.id) return `$.subjects.${node.id}.id`;
  }
  for (const record of Object.values(state.captures)) {
    if (await deriveCaptureId(record.subjectId, record.kind, record.asset?.digest ?? null, record.captureKey) !== record.id) return `$.captures.${record.id}.id`;
  }
  for (const node of Object.values(state.anchors)) {
    if (await deriveAnchorId(node.captureId, node.assetDigest, node.kind, node.key) !== node.id) return `$.anchors.${node.id}.id`;
  }
  for (const item of Object.values(state.pins)) {
    if (await derivePinId(item.projectId, item.viewId, item.captureId, item.anchorId) !== item.id) return `$.pins.${item.id}.id`;
  }
  return null;
}

export async function parseGraphDocument(value: unknown): Promise<ParsedGraph> {
  const parsed = parseGraphStructure(value);
  if (parsed.status !== 'ok') return parsed;
  const mismatch = await verifyGraphIdentities(parsed.state);
  return mismatch === null ? parsed : { status: 'invalid', path: mismatch };
}

/**
 * `hq.design.reference-packet/v1`: an immutable, content-digested manifest of
 * graph subjects, captures, anchors and the blobs they need. A packet holds
 * no bytes, scripts, URLs to fetch or markup; blobs travel separately by
 * digest. One selection has exactly one valid packet form (sorted, closed
 * shapes, no timestamps), so exporting twice yields the same digest.
 */
import type { AssetRef, BlobDigest, ClaimLevel, NativeExecutionEvidence, ReferenceKind } from './contract.ts';
import { CLAIM_LEVELS, REFERENCE_KINDS } from './contract.ts';
import type {
  AnchorId, AnchorKind, AnchorNode, AnchorRect, CaptureId, CaptureRecord, GraphRights, GraphState, ProducerIdentity,
  SourceAvailability, SubjectId, SubjectIdentity, SubjectNode,
} from './graph-contract.ts';
import { ANCHOR_KINDS, CAPTURE_SUBJECT_KINDS, SOURCE_AVAILABILITY } from './graph-contract.ts';
import {
  deriveAnchorId, deriveCaptureId, deriveSubjectId, isAnchorId, isCaptureId, isSubjectId,
} from './graph-identity.ts';
import type { PreparedCapture, PreparedGraph } from './graph-import.ts';
import { INERT_MEDIA_TYPES, isAnchorRect } from './graph-import.ts';
import { checkSubjectLinks, identity, rights as parseRights } from './graph-persist.ts';
import { canonicalize, jcsDigest } from './jcs.ts';
import type { Json } from './persist.ts';
import { asset, check, Invalid, nativeEvidence, nullable, object } from './persist.ts';
import { isBlobDigest, isIsoTime, isMediaType, isOneOf, isText } from './provenance.ts';
import type { PublishBlock } from './rights.ts';
import { isGraphPublishable, publishBlock } from './rights.ts';

export const PACKET_SCHEMA = 'hq.design.reference-packet/v1' as const;
export const BUNDLE_SCHEMA = 'hq.design.reference-bundle/v1' as const;

export type PacketMode = 'publishable' | 'internal';
export const PACKET_MODES: readonly PacketMode[] = ['publishable', 'internal'];

/** Always listed, so omission is never silent. */
export const PACKET_OMITTED = ['content-availability', 'local-reference-links', 'pins', 'ratings', 'tombstoned-records'] as const;

export const MAX_PACKET_SUBJECTS = 10_000;
export const MAX_PACKET_CAPTURES = 5_000;
export const MAX_PACKET_ANCHORS = 50_000;

export interface PacketSubject {
  readonly id: SubjectId;
  readonly identity: SubjectIdentity;
  readonly parentId: SubjectId | null;
  readonly steps: readonly SubjectId[];
  readonly title: string;
}

export interface PacketSource {
  readonly status: SourceAvailability;
  readonly observedAt: string | null;
  readonly observedBy: ClaimLevel | null;
}

export interface PacketCapture {
  readonly id: CaptureId;
  readonly subjectId: SubjectId;
  readonly kind: ReferenceKind;
  readonly captureKey: string | null;
  readonly asset: AssetRef | null;
  readonly capturedAt: string;
  readonly capturedBy: ClaimLevel;
  readonly nativeEvidence: NativeExecutionEvidence | null;
  readonly producer: ProducerIdentity | null;
  /** Nearest earlier capture of the same subject that is also in this packet. */
  readonly supersedes: CaptureId | null;
  readonly rights: GraphRights;
  readonly source: PacketSource;
}

export interface PacketAnchor {
  readonly id: AnchorId;
  readonly captureId: CaptureId;
  readonly assetDigest: BlobDigest;
  readonly kind: AnchorKind;
  readonly key: string;
  readonly parentId: AnchorId | null;
  readonly label: string;
  readonly rect: AnchorRect | null;
}

export interface PacketBlob {
  readonly digest: BlobDigest;
  readonly mediaType: string;
  readonly bytes: number;
}

export type PacketExclusionReason = PublishBlock | 'tombstoned' | 'blob-missing';
const EXCLUSION_REASONS: readonly PacketExclusionReason[] = ['rights-restricted', 'rights-unknown', 'private', 'tombstoned', 'blob-missing'];

export interface PacketExclusion {
  readonly id: CaptureId;
  readonly reason: PacketExclusionReason;
}

export interface PacketBody {
  readonly schema: typeof PACKET_SCHEMA;
  readonly mode: PacketMode;
  readonly subjects: readonly PacketSubject[];
  readonly captures: readonly PacketCapture[];
  readonly anchors: readonly PacketAnchor[];
  readonly blobs: readonly PacketBlob[];
  readonly excluded: readonly PacketExclusion[];
  readonly omitted: readonly string[];
}

export interface ReferencePacket extends PacketBody {
  /** `sha256:` + SHA-256 of the JCS form of every other field. */
  readonly packetDigest: string;
}

/* ----------------------------------------------------------------- export -- */

export interface PacketSelection {
  readonly mode: PacketMode;
  /** Explicit captures; omitted means every capture in the graph. */
  readonly captureIds?: readonly CaptureId[];
}

export type PacketBuild =
  | { readonly ok: true; readonly packet: ReferencePacket }
  | { readonly ok: false; readonly code: string };

export async function packetDigestOf(body: PacketBody): Promise<string> {
  return `sha256:${await jcsDigest(body)}`;
}

const byId = <T extends { readonly id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Builds the packet for a selection. In `publishable` mode only live captures
 * with an explicit non-private grant and servable bytes are included; every
 * other selected capture is listed under `excluded` with its reason. The result
 * is validated before it is returned, so a corrupt graph cannot emit a bad packet.
 */
export async function buildPacket(state: GraphState, selection: PacketSelection): Promise<PacketBuild> {
  if (!isOneOf(PACKET_MODES, selection.mode)) return { ok: false, code: 'invalid-mode' };
  const publishable = selection.mode === 'publishable';
  let selected: CaptureRecord[];
  if (selection.captureIds === undefined) {
    selected = Object.values(state.captures);
  } else {
    selected = [];
    for (const id of new Set(selection.captureIds)) {
      const found = state.captures[id];
      if (found === undefined) return { ok: false, code: 'capture-not-found' };
      selected.push(found);
    }
  }
  selected.sort(byId);
  const included: CaptureRecord[] = [];
  const excluded: PacketExclusion[] = [];
  for (const capture of selected) {
    const subject = state.subjects[capture.subjectId];
    if (capture.tombstonedAt !== null || subject === undefined || subject.tombstonedAt !== null) {
      excluded.push({ id: capture.id, reason: 'tombstoned' });
      continue;
    }
    if (publishable) {
      const block = publishBlock(capture.rights);
      if (block !== null) { excluded.push({ id: capture.id, reason: block }); continue; }
      if (capture.availability.content === 'blob-missing') { excluded.push({ id: capture.id, reason: 'blob-missing' }); continue; }
    }
    included.push(capture);
  }
  const includedIds = new Set<string>(included.map((capture) => capture.id));

  const subjectIds = new Set<SubjectId>();
  for (const capture of included) {
    for (let id: SubjectId | null = capture.subjectId; id !== null && !subjectIds.has(id); id = state.subjects[id]?.parentId ?? null) subjectIds.add(id);
  }
  const subjects: PacketSubject[] = [...subjectIds].map((id) => state.subjects[id]!).sort(byId).map((node) => ({
    id: node.id, identity: node.identity, parentId: node.parentId, title: node.title,
    steps: node.steps.filter((step) => subjectIds.has(step)),
  }));

  const captures: PacketCapture[] = included.map((capture) => ({
    id: capture.id, subjectId: capture.subjectId, kind: capture.kind, captureKey: capture.captureKey, asset: capture.asset,
    capturedAt: capture.capturedAt, capturedBy: capture.capturedBy, nativeEvidence: capture.nativeEvidence,
    producer: capture.provenance.producer, supersedes: nearestIncluded(state, capture, includedIds), rights: capture.rights,
    source: {
      status: capture.availability.source, observedAt: capture.availability.sourceObservedAt,
      observedBy: capture.availability.sourceObservedBy,
    },
  }));
  const anchors: PacketAnchor[] = Object.values(state.anchors).filter((anchor) => includedIds.has(anchor.captureId)).sort(byId)
    .map((anchor: AnchorNode) => ({
      id: anchor.id, captureId: anchor.captureId, assetDigest: anchor.assetDigest, kind: anchor.kind, key: anchor.key,
      parentId: anchor.parentId, label: anchor.label, rect: anchor.rect,
    }));

  const blobs = new Map<BlobDigest, PacketBlob>();
  for (const capture of captures) {
    if (capture.asset === null) continue;
    const known = blobs.get(capture.asset.digest);
    if (known !== undefined && (known.mediaType !== capture.asset.mediaType || known.bytes !== capture.asset.bytes)) return { ok: false, code: 'blob-conflict' };
    blobs.set(capture.asset.digest, { digest: capture.asset.digest, mediaType: capture.asset.mediaType, bytes: capture.asset.bytes });
  }

  const body: PacketBody = {
    schema: PACKET_SCHEMA, mode: selection.mode, subjects, captures, anchors,
    blobs: [...blobs.values()].sort((a, b) => (a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0)),
    excluded, omitted: [...PACKET_OMITTED],
  };
  const packet: ReferencePacket = { ...body, packetDigest: await packetDigestOf(body) };
  const checked = await parsePacket(packet);
  return checked.status === 'ok' ? { ok: true, packet } : { ok: false, code: 'packet-self-check-failed' };
}

function nearestIncluded(state: GraphState, capture: CaptureRecord, includedIds: ReadonlySet<string>): CaptureId | null {
  const seen = new Set<string>([capture.id]);
  for (let next = capture.lineage.supersedes; next !== null && !seen.has(next); next = state.captures[next]?.lineage.supersedes ?? null) {
    if (includedIds.has(next)) return next;
    seen.add(next);
  }
  return null;
}

/* -------------------------------------------------------------- validation -- */

export type ParsedPacket =
  | { readonly status: 'ok'; readonly packet: ReferencePacket }
  /** A newer packet schema: readable by newer code only; never adopted. */
  | { readonly status: 'future-schema'; readonly schema: string }
  | { readonly status: 'invalid'; readonly path: string };

const SCHEMA_PATTERN = /^hq\.design\.reference-packet\/v([1-9]\d{0,5})$/u;
const text = (max: number) => (item: unknown): item is string => isText(item, max);

function list(value: unknown, path: string, max: number): readonly unknown[] {
  check(Array.isArray(value) && value.length <= max, path);
  return value as readonly unknown[];
}

/** One valid form: ids strictly ascending, so a packet cannot hide duplicates or reorder under one digest. */
function ascending(items: readonly { readonly id: string }[], path: string): void {
  for (let i = 1; i < items.length; i += 1) check(items[i - 1]!.id < items[i]!.id, path);
}

function parseSubject(value: unknown, path: string): PacketSubject {
  const raw = object(value, path, ['id', 'identity', 'parentId', 'steps', 'title']);
  check(isSubjectId(raw.id), `${path}.id`);
  identity(raw.identity, `${path}.identity`);
  check(raw.parentId === null || isSubjectId(raw.parentId), `${path}.parentId`);
  check(Array.isArray(raw.steps) && raw.steps.every(isSubjectId) && new Set(raw.steps).size === raw.steps.length, `${path}.steps`);
  check(isText(raw.title, 300), `${path}.title`);
  return raw as unknown as PacketSubject;
}

function parseCapture(value: unknown, path: string, subjects: ReadonlyMap<string, PacketSubject>): PacketCapture {
  const raw = object(value, path, [
    'id', 'subjectId', 'kind', 'captureKey', 'asset', 'capturedAt', 'capturedBy', 'nativeEvidence', 'producer', 'supersedes', 'rights', 'source',
  ]);
  check(isCaptureId(raw.id), `${path}.id`);
  const owner = isSubjectId(raw.subjectId) ? subjects.get(raw.subjectId) : undefined;
  check(owner !== undefined && (CAPTURE_SUBJECT_KINDS as readonly string[]).includes(owner.identity.kind), `${path}.subjectId`);
  check(isOneOf(REFERENCE_KINDS, raw.kind), `${path}.kind`);
  const parsedAsset = asset(raw.asset, `${path}.asset`);
  check(parsedAsset === null || INERT_MEDIA_TYPES.includes(parsedAsset.mediaType), `${path}.asset.mediaType`);
  check(parsedAsset === null ? isText(raw.captureKey, 200) : raw.captureKey === null, `${path}.captureKey`);
  const evidence = nativeEvidence(raw.nativeEvidence, `${path}.nativeEvidence`);
  const appFamily = owner!.identity.kind === 'screen' || owner!.identity.kind === 'flow';
  check(raw.kind !== 'native' || (evidence !== null && appFamily), `${path}.nativeEvidence`);
  check(evidence === null || raw.kind === 'native', `${path}.nativeEvidence`);
  check(isIsoTime(raw.capturedAt) && isOneOf(CLAIM_LEVELS, raw.capturedBy), `${path}.capturedAt`);
  check(raw.producer === null || (() => {
    const producer = object(raw.producer, `${path}.producer`, ['id', 'label']);
    return isText(producer.id, 100) && nullable(producer.label, text(200));
  })(), `${path}.producer`);
  check(raw.supersedes === null || isCaptureId(raw.supersedes), `${path}.supersedes`);
  parseRights(raw.rights, `${path}.rights`);
  const source = object(raw.source, `${path}.source`, ['status', 'observedAt', 'observedBy']);
  check(isOneOf(SOURCE_AVAILABILITY, source.status), `${path}.source.status`);
  check(source.status === 'unchecked' ? source.observedAt === null && source.observedBy === null
    : isIsoTime(source.observedAt) && isOneOf(CLAIM_LEVELS, source.observedBy), `${path}.source`);
  return raw as unknown as PacketCapture;
}

function parseAnchor(value: unknown, path: string, captures: ReadonlyMap<string, PacketCapture>): PacketAnchor {
  const raw = object(value, path, ['id', 'captureId', 'assetDigest', 'kind', 'key', 'parentId', 'label', 'rect']);
  check(isAnchorId(raw.id), `${path}.id`);
  const owner = isCaptureId(raw.captureId) ? captures.get(raw.captureId) : undefined;
  check(owner !== undefined, `${path}.captureId`);
  check(isBlobDigest(raw.assetDigest) && owner!.asset?.digest === raw.assetDigest, `${path}.assetDigest`);
  check(isOneOf(ANCHOR_KINDS, raw.kind) && isText(raw.key, 200) && isText(raw.label, 200), `${path}.kind`);
  check(raw.parentId === null || isAnchorId(raw.parentId), `${path}.parentId`);
  check(raw.rect === null || isAnchorRect(raw.rect), `${path}.rect`);
  return raw as unknown as PacketAnchor;
}

function parseBlob(value: unknown, path: string): PacketBlob {
  const raw = object(value, path, ['digest', 'mediaType', 'bytes']);
  check(isBlobDigest(raw.digest) && isMediaType(raw.mediaType) && INERT_MEDIA_TYPES.includes(raw.mediaType), path);
  check(Number.isSafeInteger(raw.bytes) && (raw.bytes as number) > 0, `${path}.bytes`);
  return raw as unknown as PacketBlob;
}

function structure(value: unknown): ReferencePacket {
  const raw = object(value, '$', ['schema', 'mode', 'subjects', 'captures', 'anchors', 'blobs', 'excluded', 'omitted', 'packetDigest']);
  check(raw.schema === PACKET_SCHEMA, '$.schema');
  check(isOneOf(PACKET_MODES, raw.mode), '$.mode');
  check(isBlobDigest(raw.packetDigest), '$.packetDigest');
  const subjects = list(raw.subjects, '$.subjects', MAX_PACKET_SUBJECTS).map((item, index) => parseSubject(item, `$.subjects[${index}]`));
  ascending(subjects, '$.subjects');
  const subjectMap = new Map(subjects.map((subject) => [subject.id as string, subject]));
  checkSubjectLinks(Object.fromEntries(subjectMap.entries()));
  const captures = list(raw.captures, '$.captures', MAX_PACKET_CAPTURES).map((item, index) => parseCapture(item, `$.captures[${index}]`, subjectMap));
  ascending(captures, '$.captures');
  const captureMap = new Map(captures.map((capture) => [capture.id as string, capture]));
  for (const capture of captures) {
    const path = `$.captures.${capture.id}.supersedes`;
    check(capture.supersedes === null || (capture.supersedes !== capture.id && captureMap.get(capture.supersedes)?.subjectId === capture.subjectId), path);
  }
  const anchors = list(raw.anchors, '$.anchors', MAX_PACKET_ANCHORS).map((item, index) => parseAnchor(item, `$.anchors[${index}]`, captureMap));
  ascending(anchors, '$.anchors');
  const anchorMap = new Map(anchors.map((anchor) => [anchor.id as string, anchor]));
  for (const anchor of anchors) {
    const path = `$.anchors.${anchor.id}.parentId`;
    const seen = new Set<string>([anchor.id]);
    for (let next = anchor.parentId; next !== null;) {
      const parent = anchorMap.get(next);
      check(parent !== undefined && parent.captureId === anchor.captureId && !seen.has(next), path);
      check(anchor.kind !== 'section' || parent!.kind === 'section', path);
      seen.add(next);
      next = parent!.parentId;
    }
  }
  const blobs = list(raw.blobs, '$.blobs', MAX_PACKET_CAPTURES).map((item, index) => parseBlob(item, `$.blobs[${index}]`));
  for (let i = 1; i < blobs.length; i += 1) check(blobs[i - 1]!.digest < blobs[i]!.digest, '$.blobs');
  const needed = new Map<string, PacketBlob>();
  for (const capture of captures) {
    if (capture.asset !== null) needed.set(capture.asset.digest, { digest: capture.asset.digest, mediaType: capture.asset.mediaType, bytes: capture.asset.bytes });
  }
  check(blobs.length === needed.size && blobs.every((blob) => {
    const expected = needed.get(blob.digest);
    return expected !== undefined && expected.mediaType === blob.mediaType && expected.bytes === blob.bytes;
  }), '$.blobs');
  const excluded = list(raw.excluded, '$.excluded', MAX_PACKET_CAPTURES).map((item, index): PacketExclusion => {
    const entry = object(item, `$.excluded[${index}]`, ['id', 'reason']);
    check(isCaptureId(entry.id) && isOneOf(EXCLUSION_REASONS, entry.reason), `$.excluded[${index}]`);
    check(!captureMap.has(entry.id as string), `$.excluded[${index}].id`);
    check(raw.mode === 'publishable' || entry.reason === 'tombstoned', `$.excluded[${index}].reason`);
    return entry as unknown as PacketExclusion;
  });
  ascending(excluded, '$.excluded');
  check(Array.isArray(raw.omitted) && canonicalize(raw.omitted) === canonicalize(PACKET_OMITTED), '$.omitted');
  // A publishable packet may carry nothing that is not an explicit, non-private grant.
  if (raw.mode === 'publishable') for (const capture of captures) check(isGraphPublishable(capture.rights), `$.captures.${capture.id}.rights`);
  return raw as unknown as ReferencePacket;
}

/** Re-derives every ID and the packet digest; returns the first path that disagrees. */
async function verify(packet: ReferencePacket): Promise<string | null> {
  for (const subject of packet.subjects) {
    if (await deriveSubjectId(subject.identity) !== subject.id) return `$.subjects.${subject.id}.id`;
  }
  for (const capture of packet.captures) {
    if (await deriveCaptureId(capture.subjectId, capture.kind, capture.asset?.digest ?? null, capture.captureKey) !== capture.id) return `$.captures.${capture.id}.id`;
  }
  for (const anchor of packet.anchors) {
    if (await deriveAnchorId(anchor.captureId, anchor.assetDigest, anchor.kind, anchor.key) !== anchor.id) return `$.anchors.${anchor.id}.id`;
  }
  const { packetDigest, ...body } = packet;
  return await packetDigestOf(body) === packetDigest ? null : '$.packetDigest';
}

/** Strict closed-shape validation of an untrusted packet. Never repairs, never writes. */
export async function parsePacket(value: unknown): Promise<ParsedPacket> {
  try {
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'schema' in value) {
      const schema = (value as Json).schema;
      const match = typeof schema === 'string' ? SCHEMA_PATTERN.exec(schema) : null;
      if (match !== null && Number(match[1]) > 1) return { status: 'future-schema', schema: schema as string };
    }
    const packet = structure(value);
    const mismatch = await verify(packet);
    return mismatch === null ? { status: 'ok', packet } : { status: 'invalid', path: mismatch };
  } catch (error) {
    if (error instanceof Invalid) return { status: 'invalid', path: error.path };
    throw error;
  }
}

/* ------------------------------------------------------------ adoption prep -- */

/** Turns a validated packet into the prepared graph the import core applies. */
export function preparePacketAdoption(packet: ReferencePacket, now: string): PreparedGraph {
  const subjects: SubjectNode[] = packet.subjects.map((subject) => ({
    id: subject.id, kind: subject.identity.kind, identity: subject.identity, parentId: subject.parentId, steps: subject.steps,
    title: subject.title, rating: null, createdAt: now, tombstonedAt: null,
  }));
  const anchorsOf = new Map<string, AnchorNode[]>();
  for (const anchor of packet.anchors) {
    const node: AnchorNode = {
      id: anchor.id, captureId: anchor.captureId, assetDigest: anchor.assetDigest, kind: anchor.kind, key: anchor.key,
      parentId: anchor.parentId, label: anchor.label, rect: anchor.rect, createdAt: now,
    };
    anchorsOf.set(anchor.captureId, [...(anchorsOf.get(anchor.captureId) ?? []), node]);
  }
  const captures = packet.captures.map((capture): PreparedCapture => ({
    pendingBytes: null,
    rightsStated: true,
    sourceStated: capture.source.status !== 'unchecked',
    anchors: anchorsOf.get(capture.id) ?? [],
    record: {
      id: capture.id, subjectId: capture.subjectId, kind: capture.kind, captureKey: capture.captureKey, asset: capture.asset,
      capturedAt: capture.capturedAt, capturedBy: capture.capturedBy, nativeEvidence: capture.nativeEvidence, referenceId: null,
      provenance: { producer: capture.producer, origin: 'packet' as const, packetDigest: packet.packetDigest },
      lineage: { supersedes: null },
      // A packet proves integrity, not who judged it: an adopted claim is never an owner judgement here.
      rights: { ...capture.rights, setBy: 'agent-reported' as const, setAt: now },
      availability: {
        content: capture.asset === null ? 'no-image' as const : 'blob-missing' as const, contentCheckedAt: now,
        source: capture.source.status, sourceObservedAt: capture.source.observedAt, sourceObservedBy: capture.source.observedBy,
      },
      importedAt: now, lastImportedAt: now, importCount: 1, tombstonedAt: null,
    },
  }));
  return { subjects, captures };
}

/* ------------------------------------------------------------------ bundle -- */

export interface RightsSummary {
  readonly total: number;
  readonly permitted: number;
  readonly restricted: number;
  readonly unknown: number;
  /** Subset of `restricted`: private captures never enter publishable output. */
  readonly private: number;
  /** Grants not judged by the owner; callers may want to confirm these. */
  readonly agentReportedGrants: number;
  /** True only when there is at least one capture and every capture is an explicit non-private grant. */
  readonly publishable: boolean;
}

/** What a project request carries about a packet: IDs and digest, not content. */
export interface ReferenceBundle {
  readonly schema: typeof BUNDLE_SCHEMA;
  readonly packetDigest: string;
  readonly mode: PacketMode;
  readonly captureIds: readonly CaptureId[];
  readonly rights: RightsSummary;
  readonly excluded: readonly PacketExclusion[];
}

export function summarizeRights(captures: readonly Pick<PacketCapture, 'rights'>[]): RightsSummary {
  let permitted = 0;
  let restricted = 0;
  let unknown = 0;
  let isPrivate = 0;
  let agentReportedGrants = 0;
  let allPublishable = true;
  for (const { rights } of captures) {
    if (rights.effective === 'permitted') { permitted += 1; if (rights.setBy !== 'owner-judged') agentReportedGrants += 1; }
    else if (rights.effective === 'restricted') restricted += 1;
    else unknown += 1;
    if (rights.private) isPrivate += 1;
    if (!isGraphPublishable(rights)) allPublishable = false;
  }
  return {
    total: captures.length, permitted, restricted, unknown, private: isPrivate, agentReportedGrants,
    publishable: captures.length > 0 && allPublishable,
  };
}

/** Pure projection of a validated packet. The bundle names captures; it never embeds them. */
export function buildBundle(packet: ReferencePacket): ReferenceBundle {
  return {
    schema: BUNDLE_SCHEMA, packetDigest: packet.packetDigest, mode: packet.mode,
    captureIds: packet.captures.map((capture) => capture.id), rights: summarizeRights(packet.captures), excluded: packet.excluded,
  };
}

/** True only when the bundle is exactly the projection of this packet. */
export function bundleMatchesPacket(bundle: unknown, packet: ReferencePacket): boolean {
  try { return canonicalize(bundle) === canonicalize(buildBundle(packet)); } catch { return false; }
}

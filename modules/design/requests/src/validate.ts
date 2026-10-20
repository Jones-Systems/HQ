import {
  ANNOTATION_KINDS, CLAIM_LEVELS, DRAFT_PRIVACY, DRAFT_SCHEMA, FREEZE_SCHEMA, HANDOFF_STATES, HANDOFF_STATUS_SCHEMA,
  OWNER_REPORTED_EVIDENCE_KINDS, OWNER_REPORTED_STATUS, PACKET_SCHEMA, RETURN_ORIGINS, REVIEW_DECISIONS, REVIEW_EVENT_SCHEMA, SEND_SCHEMA,
  type AnchorTarget, type AnnotationRef, type AttachmentCandidate, type Brand, type CandidateClaim, type CandidateProvenance,
  type Clarification, type DecisionPacket, type Destination, type Digest, type DraftOrigin, type EvidenceRef, type FreezeRecord,
  type HandoffStatus, type HostModel, type NavigationIntent, type PacketLineage, type PacketLink, type Point, type Rect,
  type RequestDraft, type ReturnedCandidate, type ReviewEvent, type ReviewLink, type SelectedAttachment, type SendRecord,
  type SourceAnchor, type SourceRef,
} from './contract.ts';
import { isDigest } from './jcs.ts';

/** Strict validation for every persisted or exchanged shape. Unknown keys and schemas are rejected. */
export class ValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ValidationError';
    this.path = path;
  }
}

/** A recognised document family whose schema version this build does not support. */
export class UnsupportedSchemaError extends Error {
  readonly schema: unknown;
  constructor(schema: unknown) {
    super(`Unsupported schema ${String(schema)}`);
    this.name = 'UnsupportedSchemaError';
    this.schema = schema;
  }
}

export const LIMITS = {
  id: 160, label: 300, title: 300, intent: 20_000, note: 4_000, text: 4_000,
  list: 500, route: 2_000, path: 4_000,
} as const;

type Raw = Record<string, unknown>;

function fail(path: string, message: string): never { throw new ValidationError(path, message); }

function record(value: unknown, path: string, allowed: readonly string[], required: readonly string[] = allowed): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'expected object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, 'expected plain object');
  const raw = value as Raw;
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'unexpected key');
  for (const key of required) if (!(key in raw)) fail(`${path}.${key}`, 'missing');
  return raw;
}

/** Single-line bounded text: trimmed, no control characters. */
function line(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') fail(path, 'expected string');
  if (!allowEmpty && value.length === 0) fail(path, 'empty');
  if (value.length > max) fail(path, `longer than ${max}`);
  if (value.trim() !== value) fail(path, 'surrounding whitespace');
  if (/[\u0000-\u001f\u007f]/u.test(value)) fail(path, 'control character');
  return value;
}

/** Multi-line bounded prose, preserved byte-for-byte. */
function prose(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string') fail(path, 'expected string');
  if (value.length > max) fail(path, `longer than ${max}`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(path, 'control character');
  if (/\p{Cs}/u.test(value)) fail(path, 'lone surrogate');
  return value;
}

function int(value: unknown, path: string, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) fail(path, `expected integer >= ${min}`);
  return value;
}

function finite(value: unknown, path: string, min = -Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) fail(path, 'expected finite number');
  return value;
}

function list<T>(value: unknown, path: string, item: (value: unknown, path: string) => T, max: number = LIMITS.list): T[] {
  if (!Array.isArray(value)) fail(path, 'expected array');
  if (value.length > max) fail(path, `more than ${max} items`);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) fail(path, `expected one of ${options.join(', ')}`);
  return value as T;
}

function timestamp(value: unknown, path: string): string {
  const text = line(value, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/u.test(text) || Number.isNaN(Date.parse(text))) fail(path, 'expected UTC ISO timestamp');
  return text;
}

function digest(value: unknown, path: string): Digest {
  if (!isDigest(value)) fail(path, 'expected sha256 digest');
  return value;
}

function unique<T>(items: readonly T[], path: string, key: (item: T) => string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) fail(path, `duplicate ${value}`);
    seen.add(value);
  }
}

/** Branded identifier constructor: nonempty, bounded, single-line. Never derived from titles. */
export function brandId<K extends string>(value: unknown, path = 'id'): Brand<K> {
  return line(value, path, LIMITS.id) as Brand<K>;
}

/** Checked before strict keys so a newer document is reported as unsupported, not invalid. */
function schema(input: unknown, path: string, family: string, expected: string): void {
  const value = typeof input === 'object' && input !== null ? (input as Raw).schema : undefined;
  if (value === expected) return;
  if (typeof value === 'string' && value.startsWith(`${family}/`)) throw new UnsupportedSchemaError(value);
  fail(`${path}.schema`, `expected ${expected}`);
}

function rect(value: unknown, path: string): Rect {
  const raw = record(value, path, ['x', 'y', 'width', 'height']);
  return { x: finite(raw.x, `${path}.x`), y: finite(raw.y, `${path}.y`), width: finite(raw.width, `${path}.width`, 0), height: finite(raw.height, `${path}.height`, 0) };
}

function point(value: unknown, path: string): Point {
  const raw = record(value, path, ['x', 'y']);
  return { x: finite(raw.x, `${path}.x`), y: finite(raw.y, `${path}.y`) };
}

function target(value: unknown, path: string): AnchorTarget {
  const kind = (value as Raw | null)?.kind;
  switch (kind) {
    case 'element': {
      const raw = record(value, path, ['kind', 'path', 'rect', 'textHash'], ['kind', 'path', 'rect']);
      return {
        kind, path: line(raw.path, `${path}.path`, LIMITS.path), rect: rect(raw.rect, `${path}.rect`),
        ...('textHash' in raw ? { textHash: line(raw.textHash, `${path}.textHash`, LIMITS.id) } : {}),
      };
    }
    case 'text': {
      const raw = record(value, path, ['kind', 'quote', 'prefix', 'suffix', 'rects']);
      return {
        kind, quote: prose(raw.quote, `${path}.quote`, LIMITS.text), prefix: prose(raw.prefix, `${path}.prefix`, LIMITS.text),
        suffix: prose(raw.suffix, `${path}.suffix`, LIMITS.text), rects: list(raw.rects, `${path}.rects`, rect),
      };
    }
    case 'region': {
      const raw = record(value, path, ['kind', 'rect']);
      return { kind, rect: rect(raw.rect, `${path}.rect`) };
    }
    case 'ink': {
      const raw = record(value, path, ['kind', 'points']);
      return { kind, points: list(raw.points, `${path}.points`, point, 10_000) };
    }
    default: fail(`${path}.kind`, 'unknown anchor target');
  }
}

export function parseSourceAnchor(value: unknown, path = 'anchor'): SourceAnchor {
  const raw = record(value, path, ['versionId', 'route', 'state', 'viewport', 'scroll', 'captureDigest', 'target']);
  const viewport = record(raw.viewport, `${path}.viewport`, ['w', 'h', 'dpr']);
  const scroll = record(raw.scroll, `${path}.scroll`, ['x', 'y']);
  return {
    versionId: brandId(raw.versionId, `${path}.versionId`),
    route: line(raw.route, `${path}.route`, LIMITS.route, true),
    state: line(raw.state, `${path}.state`, LIMITS.label, true),
    viewport: { w: finite(viewport.w, `${path}.viewport.w`, 0), h: finite(viewport.h, `${path}.viewport.h`, 0), dpr: finite(viewport.dpr, `${path}.viewport.dpr`, 0) },
    scroll: { x: finite(scroll.x, `${path}.scroll.x`), y: finite(scroll.y, `${path}.scroll.y`) },
    captureDigest: line(raw.captureDigest, `${path}.captureDigest`, LIMITS.id),
    target: target(raw.target, `${path}.target`),
  };
}

export function parseAnnotationRef(value: unknown, path = 'annotation'): AnnotationRef {
  const raw = record(value, path, ['id', 'letter', 'anchor', 'note', 'kind']);
  return {
    id: brandId(raw.id, `${path}.id`), letter: line(raw.letter, `${path}.letter`, 8),
    anchor: parseSourceAnchor(raw.anchor, `${path}.anchor`), note: prose(raw.note, `${path}.note`, LIMITS.note),
    kind: oneOf(raw.kind, `${path}.kind`, ANNOTATION_KINDS),
  };
}

export function parseEvidenceRef(value: unknown, path = 'evidence'): EvidenceRef {
  const raw = record(value, path, ['evidenceId', 'kind', 'label', 'digest', 'versionId'], ['evidenceId', 'kind', 'label', 'digest']);
  return {
    evidenceId: brandId(raw.evidenceId, `${path}.evidenceId`),
    kind: oneOf(raw.kind, `${path}.kind`, ['capture', 'candidate', 'observation', 'note'] as const),
    label: line(raw.label, `${path}.label`, LIMITS.label), digest: line(raw.digest, `${path}.digest`, LIMITS.id),
    ...('versionId' in raw ? { versionId: brandId(raw.versionId, `${path}.versionId`) } : {}),
  };
}

export function parseSourceRef(value: unknown, path = 'source'): SourceRef {
  const raw = record(value, path, ['projectId', 'viewId', 'versionId', 'sourceRevision']);
  return {
    projectId: brandId(raw.projectId, `${path}.projectId`), viewId: brandId(raw.viewId, `${path}.viewId`),
    versionId: brandId(raw.versionId, `${path}.versionId`), sourceRevision: line(raw.sourceRevision, `${path}.sourceRevision`, LIMITS.label),
  };
}

function mediaType(value: unknown, path: string): string {
  const text = line(value, path, 100);
  if (!/^[a-z]+\/[a-z0-9.+-]+$/u.test(text)) fail(path, 'expected media type');
  return text;
}

export function parseAttachmentCandidate(value: unknown, path = 'attachment'): AttachmentCandidate {
  const raw = record(value, path, ['attachmentId', 'blobDigest', 'mediaType', 'bytes', 'label', 'selected']);
  if (typeof raw.selected !== 'boolean') fail(`${path}.selected`, 'expected boolean');
  return {
    attachmentId: brandId(raw.attachmentId, `${path}.attachmentId`), blobDigest: digest(raw.blobDigest, `${path}.blobDigest`),
    mediaType: mediaType(raw.mediaType, `${path}.mediaType`), bytes: int(raw.bytes, `${path}.bytes`, 0),
    label: line(raw.label, `${path}.label`, LIMITS.label), selected: raw.selected,
  };
}

function selectedAttachment(value: unknown, path: string): SelectedAttachment {
  const raw = record(value, path, ['attachmentId', 'blobDigest', 'mediaType', 'bytes', 'label']);
  return {
    attachmentId: brandId(raw.attachmentId, `${path}.attachmentId`), blobDigest: digest(raw.blobDigest, `${path}.blobDigest`),
    mediaType: mediaType(raw.mediaType, `${path}.mediaType`), bytes: int(raw.bytes, `${path}.bytes`, 0),
    label: line(raw.label, `${path}.label`, LIMITS.label),
  };
}

function clarification(value: unknown, path: string): Clarification {
  const raw = record(value, path, ['clarificationId', 'question', 'answer', 'dismissed'], ['clarificationId', 'question']);
  if ('dismissed' in raw && raw.dismissed !== true) fail(`${path}.dismissed`, 'expected true when present');
  return {
    clarificationId: brandId(raw.clarificationId, `${path}.clarificationId`),
    question: prose(raw.question, `${path}.question`, LIMITS.text),
    ...('answer' in raw ? { answer: prose(raw.answer, `${path}.answer`, LIMITS.text) } : {}),
    ...('dismissed' in raw ? { dismissed: true as const } : {}),
  };
}

function destination(value: unknown, path: string): Destination {
  const kind = (value as Raw | null)?.kind;
  if (kind === 'unassigned') { record(value, path, ['kind']); return { kind }; }
  if (kind === 'existing-thread') {
    const raw = record(value, path, ['kind', 'destinationId', 'label']);
    return { kind, destinationId: brandId(raw.destinationId, `${path}.destinationId`), label: line(raw.label, `${path}.label`, LIMITS.label) };
  }
  fail(`${path}.kind`, 'unknown destination');
}

export function parsePacketLink(value: unknown, path = 'link'): PacketLink {
  const raw = record(value, path, ['packetId', 'authoringDigest']);
  return { packetId: brandId(raw.packetId, `${path}.packetId`), authoringDigest: digest(raw.authoringDigest, `${path}.authoringDigest`) };
}

function nullable<T>(value: unknown, path: string, parse: (value: unknown, path: string) => T): T | null {
  return value === null ? null : parse(value, path);
}

function reviewLink(value: unknown, path: string): ReviewLink {
  const raw = record(value, path, ['reviewEventId', 'candidateId']);
  return { reviewEventId: brandId(raw.reviewEventId, `${path}.reviewEventId`), candidateId: brandId(raw.candidateId, `${path}.candidateId`) };
}

const ORIGINS: readonly DraftOrigin[] = ['initial', 'continuation', 'revision'];
const CONTENT_KEYS = ['title', 'intent', 'sources', 'annotations', 'evidence', 'clarifications', 'destination'] as const;

function content(raw: Raw, path: string) {
  const sources = list(raw.sources, `${path}.sources`, parseSourceRef);
  const annotations = list(raw.annotations, `${path}.annotations`, parseAnnotationRef);
  const evidence = list(raw.evidence, `${path}.evidence`, parseEvidenceRef);
  const clarifications = list(raw.clarifications, `${path}.clarifications`, clarification);
  unique(annotations, `${path}.annotations`, (item) => item.id);
  unique(annotations, `${path}.annotations`, (item) => `letter ${item.letter}`);
  unique(evidence, `${path}.evidence`, (item) => item.evidenceId);
  unique(clarifications, `${path}.clarifications`, (item) => item.clarificationId);
  unique(sources, `${path}.sources`, (item) => item.versionId);
  return {
    title: line(raw.title, `${path}.title`, LIMITS.title, true), intent: prose(raw.intent, `${path}.intent`, LIMITS.intent),
    sources, annotations, evidence, clarifications, destination: destination(raw.destination, `${path}.destination`),
  };
}

const DRAFT_KEYS = ['schema', 'privacy', 'requestId', 'draftId', 'revision', 'phase', 'createdAt', 'updatedAt', 'origin',
  'continuesFrom', 'review', 'attachments', ...CONTENT_KEYS];

export function parseDraft(value: unknown, path = 'draft'): RequestDraft {
  schema(value, path, 'hq.design.request-draft', DRAFT_SCHEMA);
  const raw = record(value, path, DRAFT_KEYS);
  if (raw.privacy !== DRAFT_PRIVACY) fail(`${path}.privacy`, `expected ${DRAFT_PRIVACY}`);
  const attachments = list(raw.attachments, `${path}.attachments`, parseAttachmentCandidate);
  unique(attachments, `${path}.attachments`, (item) => item.attachmentId);
  return {
    schema: DRAFT_SCHEMA, privacy: DRAFT_PRIVACY,
    requestId: brandId(raw.requestId, `${path}.requestId`), draftId: brandId(raw.draftId, `${path}.draftId`),
    revision: int(raw.revision, `${path}.revision`, 0), phase: oneOf(raw.phase, `${path}.phase`, ['draft', 'clarify'] as const),
    createdAt: timestamp(raw.createdAt, `${path}.createdAt`), updatedAt: timestamp(raw.updatedAt, `${path}.updatedAt`),
    origin: oneOf(raw.origin, `${path}.origin`, ORIGINS),
    continuesFrom: nullable(raw.continuesFrom, `${path}.continuesFrom`, parsePacketLink),
    review: nullable(raw.review, `${path}.review`, reviewLink),
    attachments, ...content(raw, path),
  };
}

function lineage(value: unknown, path: string): PacketLineage {
  const raw = record(value, path, ['requestId', 'sequence', 'rootPacketId', 'parent', 'origin', 'draft', 'review']);
  const draft = record(raw.draft, `${path}.draft`, ['draftId', 'revision']);
  return {
    requestId: brandId(raw.requestId, `${path}.requestId`), sequence: int(raw.sequence, `${path}.sequence`, 1),
    rootPacketId: brandId(raw.rootPacketId, `${path}.rootPacketId`), parent: nullable(raw.parent, `${path}.parent`, parsePacketLink),
    origin: oneOf(raw.origin, `${path}.origin`, ORIGINS),
    draft: { draftId: brandId(draft.draftId, `${path}.draft.draftId`), revision: int(draft.revision, `${path}.draft.revision`, 0) },
    review: nullable(raw.review, `${path}.review`, reviewLink),
  };
}

const PACKET_KEYS = ['schema', 'packetId', 'projectId', 'frozenAt', 'lineage', 'supersedes', 'attachments', 'authoringDigest', ...CONTENT_KEYS];

/** Structural packet validation. Digest verification is async: see verifyPacket in packet.ts. */
export function parsePacket(value: unknown, path = 'packet'): DecisionPacket {
  schema(value, path, 'hq.design.decision-packet', PACKET_SCHEMA);
  const raw = record(value, path, PACKET_KEYS);
  const attachments = list(raw.attachments, `${path}.attachments`, selectedAttachment);
  unique(attachments, `${path}.attachments`, (item) => item.attachmentId);
  const parsed: DecisionPacket = {
    schema: PACKET_SCHEMA, packetId: brandId(raw.packetId, `${path}.packetId`), projectId: brandId(raw.projectId, `${path}.projectId`),
    frozenAt: timestamp(raw.frozenAt, `${path}.frozenAt`), lineage: lineage(raw.lineage, `${path}.lineage`),
    supersedes: nullable(raw.supersedes, `${path}.supersedes`, parsePacketLink), attachments,
    authoringDigest: digest(raw.authoringDigest, `${path}.authoringDigest`), ...content(raw, path),
  };
  if (parsed.sources.length === 0) fail(`${path}.sources`, 'a packet needs at least one source');
  return parsed;
}

export function parseFreezeRecord(value: unknown, path = 'freeze'): FreezeRecord {
  schema(value, path, 'hq.design.request-freeze', FREEZE_SCHEMA);
  const raw = record(value, path, ['schema', 'packet', 'consumed', 'consumedDraft', 'continuation']);
  const consumed = record(raw.consumed, `${path}.consumed`, ['draftId', 'revision']);
  return {
    schema: FREEZE_SCHEMA, packet: parsePacket(raw.packet, `${path}.packet`),
    consumed: { draftId: brandId(consumed.draftId, `${path}.consumed.draftId`), revision: int(consumed.revision, `${path}.consumed.revision`, 0) },
    consumedDraft: parseDraft(raw.consumedDraft, `${path}.consumedDraft`), continuation: parseDraft(raw.continuation, `${path}.continuation`),
  };
}

function claim(value: unknown, path: string): CandidateClaim {
  const raw = record(value, path, ['claimId', 'text', 'level', 'evidence']);
  return {
    claimId: brandId(raw.claimId, `${path}.claimId`), text: prose(raw.text, `${path}.text`, LIMITS.text),
    level: oneOf(raw.level, `${path}.level`, CLAIM_LEVELS), evidence: list(raw.evidence, `${path}.evidence`, parseEvidenceRef),
  };
}

function hostModel(value: unknown, path: string): HostModel {
  const raw = record(value, path, ['host', 'model'], []);
  return {
    ...('host' in raw ? { host: line(raw.host, `${path}.host`, LIMITS.label) } : {}),
    ...('model' in raw ? { model: line(raw.model, `${path}.model`, LIMITS.label) } : {}),
  };
}

function provenance(value: unknown, path: string): CandidateProvenance {
  const raw = record(value, path, ['origin', 'host', 'model'], ['origin']);
  return {
    origin: oneOf(raw.origin, `${path}.origin`, RETURN_ORIGINS),
    ...('host' in raw ? { host: line(raw.host, `${path}.host`, LIMITS.label) } : {}),
    ...('model' in raw ? { model: line(raw.model, `${path}.model`, LIMITS.label) } : {}),
  };
}

/**
 * Strict candidate validation. An owner-reported return can only carry
 * agent-reported claims, note/capture evidence and the owner-reported status:
 * it can never assert an observation or an owner judgment.
 */
export function parseReturnedCandidate(value: unknown, path = 'candidate'): ReturnedCandidate {
  const raw = record(value, path, ['candidateId', 'packet', 'baselineVersionId', 'candidateVersionId', 'claims', 'observedStatus', 'observedAt', 'evidence', 'provenance'],
    ['candidateId', 'packet', 'baselineVersionId', 'candidateVersionId', 'claims', 'observedStatus', 'observedAt', 'evidence']);
  const claims = list(raw.claims, `${path}.claims`, claim);
  unique(claims, `${path}.claims`, (item) => item.claimId);
  const parsed: ReturnedCandidate = {
    candidateId: brandId(raw.candidateId, `${path}.candidateId`), packet: parsePacketLink(raw.packet, `${path}.packet`),
    baselineVersionId: brandId(raw.baselineVersionId, `${path}.baselineVersionId`),
    candidateVersionId: nullable(raw.candidateVersionId, `${path}.candidateVersionId`, (item, itemPath) => brandId<'VersionId'>(item, itemPath)),
    claims,
    observedStatus: line(raw.observedStatus, `${path}.observedStatus`, LIMITS.label),
    observedAt: timestamp(raw.observedAt, `${path}.observedAt`), evidence: list(raw.evidence, `${path}.evidence`, parseEvidenceRef),
    ...('provenance' in raw ? { provenance: provenance(raw.provenance, `${path}.provenance`) } : {}),
  };
  if (parsed.provenance?.origin === 'owner-reported') {
    if (parsed.observedStatus !== OWNER_REPORTED_STATUS) fail(`${path}.observedStatus`, `an owner-reported return has status ${OWNER_REPORTED_STATUS}`);
    if (parsed.candidateVersionId !== null) fail(`${path}.candidateVersionId`, 'an owner-reported return has no comparable version');
    for (const [index, item] of parsed.claims.entries()) {
      if (item.level !== 'agent-reported') fail(`${path}.claims[${index}].level`, 'an owner-reported return cannot assert observed or owner-judged claims');
    }
    const kinds = OWNER_REPORTED_EVIDENCE_KINDS as readonly string[];
    for (const [index, item] of [...parsed.evidence, ...parsed.claims.flatMap((entry) => entry.evidence)].entries()) {
      if (!kinds.includes(item.kind)) fail(`${path}.evidence[${index}].kind`, 'an owner-reported return cannot carry observation or candidate evidence');
    }
  }
  return parsed;
}

const HANDOFF_KEYS = ['schema', 'packet', 'state', 'observedAt', 'destination', 'pinned', 'actual', 'detail'];

/** Status read from the connector side. Untrusted: validated strictly before it is stored or shown. */
export function parseHandoffStatus(value: unknown, path = 'status'): HandoffStatus {
  schema(value, path, 'hq.design.request-handoff-status', HANDOFF_STATUS_SCHEMA);
  const raw = record(value, path, HANDOFF_KEYS, ['schema', 'packet', 'state', 'observedAt']);
  const dest = 'destination' in raw ? record(raw.destination, `${path}.destination`, ['destinationId', 'label']) : null;
  return {
    schema: HANDOFF_STATUS_SCHEMA, packet: parsePacketLink(raw.packet, `${path}.packet`),
    state: oneOf(raw.state, `${path}.state`, HANDOFF_STATES), observedAt: timestamp(raw.observedAt, `${path}.observedAt`),
    ...(dest ? { destination: { destinationId: brandId(dest.destinationId, `${path}.destination.destinationId`), label: line(dest.label, `${path}.destination.label`, LIMITS.label) } } : {}),
    ...('pinned' in raw ? { pinned: hostModel(raw.pinned, `${path}.pinned`) } : {}),
    ...('actual' in raw ? { actual: hostModel(raw.actual, `${path}.actual`) } : {}),
    ...('detail' in raw ? { detail: prose(raw.detail, `${path}.detail`, LIMITS.note) } : {}),
  };
}

export function parseSendRecord(value: unknown, path = 'send'): SendRecord {
  schema(value, path, 'hq.design.request-send', SEND_SCHEMA);
  const raw = record(value, path, ['schema', 'sendId', 'requestId', 'packet', 'destination', 'at']);
  const dest = record(raw.destination, `${path}.destination`, ['destinationId', 'label']);
  return {
    schema: SEND_SCHEMA, sendId: brandId(raw.sendId, `${path}.sendId`), requestId: brandId(raw.requestId, `${path}.requestId`),
    packet: parsePacketLink(raw.packet, `${path}.packet`),
    destination: { destinationId: brandId(dest.destinationId, `${path}.destination.destinationId`), label: line(dest.label, `${path}.destination.label`, LIMITS.label) },
    at: timestamp(raw.at, `${path}.at`),
  };
}

/** Navigation intents are closed shapes: any extra key (for example a send payload) is rejected. */
export function parseNavigationIntent(value: unknown, path = 'intent'): NavigationIntent {
  const type = (value as Raw | null)?.type;
  switch (type) {
    case 'open-request': case 'open-runs': {
      const raw = record(value, path, ['type', 'requestId']);
      return { type, requestId: brandId(raw.requestId, `${path}.requestId`) };
    }
    case 'open-packet': {
      const raw = record(value, path, ['type', 'requestId', 'packetId']);
      return { type, requestId: brandId(raw.requestId, `${path}.requestId`), packetId: brandId(raw.packetId, `${path}.packetId`) };
    }
    case 'open-returned': {
      const raw = record(value, path, ['type', 'requestId', 'candidateId']);
      return { type, requestId: brandId(raw.requestId, `${path}.requestId`), candidateId: brandId(raw.candidateId, `${path}.candidateId`) };
    }
    default: return fail(`${path}.type`, 'unknown navigation intent');
  }
}

export function parseReviewEvent(value: unknown, path = 'review'): ReviewEvent {
  schema(value, path, 'hq.design.request-review-event', REVIEW_EVENT_SCHEMA);
  const raw = record(value, path, ['schema', 'eventId', 'requestId', 'packet', 'candidateId', 'decision', 'note', 'at', 'judgments', 'revisionDraftId'],
    ['schema', 'eventId', 'requestId', 'packet', 'candidateId', 'decision', 'note', 'at', 'judgments']);
  const decision = oneOf(raw.decision, `${path}.decision`, REVIEW_DECISIONS);
  if ((decision === 'revise') !== ('revisionDraftId' in raw)) fail(`${path}.revisionDraftId`, 'required exactly for revise');
  const judgments = list(raw.judgments, `${path}.judgments`, (item, itemPath) => {
    const judgment = record(item, itemPath, ['claimId', 'judgment']);
    return { claimId: brandId<'ClaimId'>(judgment.claimId, `${itemPath}.claimId`), judgment: oneOf(judgment.judgment, `${itemPath}.judgment`, ['confirmed', 'disputed'] as const) };
  });
  unique(judgments, `${path}.judgments`, (item) => item.claimId);
  return {
    schema: REVIEW_EVENT_SCHEMA, eventId: brandId(raw.eventId, `${path}.eventId`), requestId: brandId(raw.requestId, `${path}.requestId`),
    packet: parsePacketLink(raw.packet, `${path}.packet`), candidateId: brandId(raw.candidateId, `${path}.candidateId`), decision,
    note: prose(raw.note, `${path}.note`, LIMITS.note), at: timestamp(raw.at, `${path}.at`), judgments,
    ...('revisionDraftId' in raw ? { revisionDraftId: brandId<'DraftId'>(raw.revisionDraftId, `${path}.revisionDraftId`) } : {}),
  };
}

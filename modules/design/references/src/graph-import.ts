import type {
  AssetRef, BlobDigest, ClaimLevel, ReferenceId, ReferenceKind, ReferenceSource, ValidationIssue,
} from './contract.ts';
import { APP_PLATFORMS, CLAIM_LEVELS, REFERENCE_KINDS } from './contract.ts';
import type {
  AnchorKind, AnchorNode, AppTreeCandidate, CaptureAvailability, CaptureId, CaptureOrigin, CaptureOutcomeStatus, CaptureRecord,
  GraphAnchorCandidate, GraphCaptureCandidate, GraphRights, GraphState, GraphTreeCandidate, SourceAvailability,
  SubjectId, SubjectIdentity, SubjectNode, SubjectOutcomeStatus, TreeImportReport, WebsiteTreeCandidate,
} from './graph-contract.ts';
import { ANCHOR_KINDS, SOURCE_AVAILABILITY } from './graph-contract.ts';
import {
  deriveAnchorId, deriveCaptureId, deriveSubjectId, normalizeOrigin, originOf,
} from './graph-identity.ts';
import { sha256Hex } from './jcs.ts';
import { optionalPositive } from './library.ts';
import {
  isBlobDigest, isIsoTime, isMediaType, isOneOf, isReferenceId, isText, mediaTypeFitsKind, normalizeSource,
  normalizeUrl, validateNativeEvidence,
} from './provenance.ts';
import { buildRights, isGraphPublishable, unknownRights } from './rights.ts';

/**
 * Bytes a capture may carry. Everything here is inert media; markup, scripts
 * and archives are never stored as capture content, so nothing a capture holds
 * can execute when it is shown.
 */
export const INERT_MEDIA_TYPES: readonly string[] = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/apng',
  'video/mp4', 'video/webm', 'video/quicktime',
];

export const MAX_PAGES = 2000;
export const MAX_CAPTURES = 5000;
export const MAX_ANCHORS_PER_CAPTURE = 500;
/** Placeholder key for a flat app reference that names no screen. */
export const APP_HOME_SCREEN = '(app)';

export function emptyGraph(): GraphState {
  return { schema: 'hq.design.reference-graph/v1', subjects: {}, captures: {}, anchors: {}, pins: {} };
}

export interface PreparedCapture {
  /** `lineage.supersedes` and `availability` are finalized when the capture is applied. */
  readonly record: CaptureRecord;
  readonly pendingBytes: Uint8Array | null;
  /** False when the candidate made no rights statement: re-imports must not touch stored rights. */
  readonly rightsStated: boolean;
  readonly sourceStated: boolean;
  readonly anchors: readonly AnchorNode[];
}

export interface PreparedGraph {
  /** Parents before children. */
  readonly subjects: readonly SubjectNode[];
  readonly captures: readonly PreparedCapture[];
}

export interface PrepareOptions {
  readonly origin?: CaptureOrigin;
  readonly packetDigest?: string | null;
}

type Issues = ValidationIssue[];

function isRect(value: unknown): value is { x: number; y: number; w: number; h: number } {
  if (value === null || typeof value !== 'object') return false;
  const { x, y, w, h, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return false;
  const fraction = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  return fraction(x) && fraction(y) && fraction(w) && fraction(h) && w > 0 && h > 0 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9;
}

export function isAnchorRect(value: unknown): value is { x: number; y: number; w: number; h: number } {
  return isRect(value);
}

async function prepareAnchors(
  capture: GraphCaptureCandidate, captureId: CaptureId, asset: AssetRef | null, now: string, path: string, issues: Issues,
): Promise<AnchorNode[]> {
  const candidates = capture.anchors ?? [];
  if (candidates.length === 0) return [];
  if (asset === null) { issues.push({ field: `${path}.anchors`, code: 'anchor-requires-asset' }); return []; }
  if (!Array.isArray(candidates) || candidates.length > MAX_ANCHORS_PER_CAPTURE) {
    issues.push({ field: `${path}.anchors`, code: 'too-many' });
    return [];
  }
  const out: AnchorNode[] = [];
  const byKey = new Map<string, AnchorNode>();
  for (const [index, raw] of (candidates as readonly GraphAnchorCandidate[]).entries()) {
    const at = `${path}.anchors[${index}]`;
    const before = issues.length;
    if (raw === null || typeof raw !== 'object') { issues.push({ field: at, code: 'invalid' }); continue; }
    if (!isText(raw.key, 200)) issues.push({ field: `${at}.key`, code: 'invalid' });
    if (!isOneOf(ANCHOR_KINDS, raw.kind)) issues.push({ field: `${at}.kind`, code: 'unsupported-kind' });
    if (!isText(raw.label, 200)) issues.push({ field: `${at}.label`, code: 'invalid' });
    if (raw.rect !== undefined && !isRect(raw.rect)) issues.push({ field: `${at}.rect`, code: 'invalid' });
    if (typeof raw.key === 'string' && byKey.has(raw.key)) issues.push({ field: `${at}.key`, code: 'duplicate' });
    let parent: AnchorNode | null = null;
    if (raw.parentKey !== undefined) {
      parent = byKey.get(raw.parentKey) ?? null;
      if (parent === null) issues.push({ field: `${at}.parentKey`, code: 'unknown-parent' });
      else if (raw.kind === 'section' && parent.kind !== 'section') issues.push({ field: `${at}.parentKey`, code: 'section-parent-must-be-section' });
    }
    if (issues.length > before) continue;
    const kind = raw.kind as AnchorKind;
    const id = await deriveAnchorId(captureId, asset.digest, kind, raw.key);
    const node: AnchorNode = {
      id, captureId, assetDigest: asset.digest, kind, key: raw.key, parentId: parent?.id ?? null,
      label: raw.label, rect: raw.rect ?? null, createdAt: now,
    };
    byKey.set(raw.key, node);
    out.push(node);
  }
  return out;
}

async function prepareCapture(
  raw: GraphCaptureCandidate, subjectId: SubjectId, source: ReferenceSource, now: string, path: string,
  options: PrepareOptions, issues: Issues,
): Promise<PreparedCapture | null> {
  const before = issues.length;
  if (raw === null || typeof raw !== 'object') { issues.push({ field: path, code: 'invalid' }); return null; }
  const kindOk = isOneOf(REFERENCE_KINDS, raw.kind);
  if (!kindOk) issues.push({ field: `${path}.kind`, code: 'unsupported-kind' });
  const kind = (kindOk ? raw.kind : 'screenshot') as ReferenceKind;
  if (!isIsoTime(raw.capturedAt)) issues.push({ field: `${path}.capturedAt`, code: 'invalid-time' });
  const capturedByOk = isOneOf(CLAIM_LEVELS, raw.capturedBy);
  if (!capturedByOk) issues.push({ field: `${path}.capturedBy`, code: 'invalid' });
  const capturedBy = (capturedByOk ? raw.capturedBy : 'agent-reported') as ClaimLevel;

  let asset: AssetRef | null = null;
  let pendingBytes: Uint8Array | null = null;
  const rawAsset = raw.asset;
  if (rawAsset !== undefined) {
    const at = `${path}.asset`;
    if (rawAsset === null || typeof rawAsset !== 'object' || !isMediaType(rawAsset.mediaType)) {
      issues.push({ field: `${at}.mediaType`, code: 'invalid' });
    } else {
      if (!INERT_MEDIA_TYPES.includes(rawAsset.mediaType)) issues.push({ field: `${at}.mediaType`, code: 'executable-or-unsupported-media-type' });
      else if (kindOk && !mediaTypeFitsKind(kind, rawAsset.mediaType)) issues.push({ field: `${at}.mediaType`, code: `not-a-${kind}-media-type` });
      const dims = {
        w: optionalPositive(rawAsset.w, `${at}.w`, issues), h: optionalPositive(rawAsset.h, `${at}.h`, issues),
        durationMs: optionalPositive(rawAsset.durationMs, `${at}.durationMs`, issues),
      };
      if ('bytes' in rawAsset) {
        if (!(rawAsset.bytes instanceof Uint8Array) || rawAsset.bytes.byteLength === 0) {
          issues.push({ field: `${at}.bytes`, code: 'invalid' });
        } else {
          const digest = `sha256:${await sha256Hex(rawAsset.bytes)}` as BlobDigest;
          asset = { digest, mediaType: rawAsset.mediaType, bytes: rawAsset.bytes.byteLength, ...dims };
          pendingBytes = rawAsset.bytes;
        }
      } else if (!isBlobDigest(rawAsset.digest)) {
        issues.push({ field: `${at}.digest`, code: 'invalid' });
      } else if (!Number.isSafeInteger(rawAsset.byteLength) || rawAsset.byteLength <= 0) {
        issues.push({ field: `${at}.byteLength`, code: 'invalid' });
      } else {
        asset = { digest: rawAsset.digest, mediaType: rawAsset.mediaType, bytes: rawAsset.byteLength, ...dims };
      }
    }
  }
  let captureKey: string | null = null;
  if (rawAsset === undefined) {
    if (!isText(raw.captureKey, 200)) issues.push({ field: `${path}.captureKey`, code: 'required-without-asset' });
    else captureKey = raw.captureKey;
  } else if (raw.captureKey !== undefined) {
    issues.push({ field: `${path}.captureKey`, code: 'forbidden-with-asset' });
  }

  const nativeEvidence = kindOk ? validateNativeEvidence(kind, source, raw.nativeEvidence, issues) : null;
  const rightsStated = raw.rights !== undefined;
  let setBy: ClaimLevel = capturedBy === 'owner-judged' ? 'owner-judged' : 'agent-reported';
  if (rightsStated && raw.rights!.setBy !== undefined) {
    // A claim level on rights is trusted only from the library's own records, never from an importer.
    if (options.origin === 'flat-library' && isOneOf(CLAIM_LEVELS, raw.rights!.setBy)) setBy = raw.rights!.setBy;
    else issues.push({ field: `${path}.rights.setBy`, code: 'not-allowed' });
  }
  const rights: GraphRights = rightsStated ? buildRights(raw.rights!, setBy, now, issues, `${path}.rights`) : unknownRights(setBy, now);

  let producer = null;
  if (raw.producer !== undefined) {
    if (raw.producer === null || typeof raw.producer !== 'object' || !isText(raw.producer.id, 100)
      || (raw.producer.label !== undefined && !isText(raw.producer.label, 200))) {
      issues.push({ field: `${path}.producer`, code: 'invalid' });
    } else {
      producer = { id: raw.producer.id, label: raw.producer.label ?? null };
    }
  }
  const sourceStated = raw.sourceStatus !== undefined;
  let sourceStatus: SourceAvailability = 'unchecked';
  if (sourceStated) {
    if (!isOneOf(SOURCE_AVAILABILITY, raw.sourceStatus) || raw.sourceStatus === 'unchecked') {
      issues.push({ field: `${path}.sourceStatus`, code: 'invalid' });
    } else {
      sourceStatus = raw.sourceStatus;
    }
  }
  let referenceId: ReferenceId | null = null;
  if (raw.referenceId !== undefined) {
    if (!isReferenceId(raw.referenceId)) issues.push({ field: `${path}.referenceId`, code: 'invalid' });
    else referenceId = raw.referenceId;
  }
  if (issues.length > before) return null;

  const id = await deriveCaptureId(subjectId, kind, asset?.digest ?? null, captureKey);
  const anchors = await prepareAnchors(raw, id, asset, now, path, issues);
  if (issues.length > before) return null;
  const availability: CaptureAvailability = {
    content: asset === null ? 'no-image' : 'blob-missing', contentCheckedAt: now, source: sourceStatus,
    sourceObservedAt: sourceStated ? now : null, sourceObservedBy: sourceStated ? capturedBy : null,
  };
  return {
    pendingBytes, rightsStated, sourceStated, anchors,
    record: {
      id, subjectId, kind, captureKey, asset, capturedAt: raw.capturedAt, capturedBy, nativeEvidence, referenceId,
      provenance: { producer, origin: options.origin ?? 'import', packetDigest: options.packetDigest ?? null },
      lineage: { supersedes: null }, rights, availability,
      importedAt: now, lastImportedAt: now, importCount: 1, tombstonedAt: null,
    },
  };
}

/** Builds a subject node with its derived ID. */
export async function buildSubject(
  identity: SubjectIdentity, parentId: SubjectId | null, title: string, steps: readonly SubjectId[], now: string,
): Promise<SubjectNode> {
  const id = await deriveSubjectId(identity);
  return { id, kind: identity.kind, identity, parentId, steps, title, rating: null, createdAt: now, tombstonedAt: null };
}

/**
 * Validates a website or app tree and derives every ID. Pure apart from
 * hashing; nothing is written. Any issue rejects the whole tree.
 */
export async function prepareTree(
  tree: GraphTreeCandidate, now: string, options: PrepareOptions = {},
): Promise<{ ok: true; prepared: PreparedGraph } | { ok: false; issues: readonly ValidationIssue[] }> {
  const issues: Issues = [];
  if (tree === null || typeof tree !== 'object') return { ok: false, issues: [{ field: '', code: 'invalid' }] };
  const subjects: SubjectNode[] = [];
  const captures: PreparedCapture[] = [];
  if (tree.kind === 'website') await prepareWebsite(tree, now, options, subjects, captures, issues);
  else if (tree.kind === 'app') await prepareApp(tree, now, options, subjects, captures, issues);
  else issues.push({ field: 'kind', code: 'unsupported' });
  if (captures.length > MAX_CAPTURES) issues.push({ field: 'captures', code: 'too-many' });
  const seen = new Set<string>();
  for (const capture of captures) {
    if (seen.has(capture.record.id)) issues.push({ field: 'captures', code: 'duplicate-capture' });
    seen.add(capture.record.id);
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, prepared: { subjects, captures } };
}

async function prepareWebsite(
  tree: WebsiteTreeCandidate, now: string, options: PrepareOptions, subjects: SubjectNode[],
  captures: PreparedCapture[], issues: Issues,
): Promise<void> {
  const origin = typeof tree.origin === 'string' ? normalizeOrigin(tree.origin) : null;
  if (origin === null) issues.push({ field: 'origin', code: 'invalid-origin' });
  if (!isText(tree.title, 300)) issues.push({ field: 'title', code: 'invalid' });
  if (!Array.isArray(tree.pages) || tree.pages.length > MAX_PAGES) issues.push({ field: 'pages', code: 'invalid' });
  if (origin === null || issues.length > 0) return;
  const site = await buildSubject({ kind: 'site', origin }, null, tree.title, [], now);
  subjects.push(site);
  const seen = new Set<string>();
  for (const [index, page] of tree.pages.entries()) {
    const path = `pages[${index}]`;
    const before = issues.length;
    const url = page !== null && typeof page === 'object' && typeof page.url === 'string' ? normalizeUrl(page.url) : null;
    if (url === null) issues.push({ field: `${path}.url`, code: 'invalid-url' });
    else if (originOf(url) !== origin) issues.push({ field: `${path}.url`, code: 'origin-mismatch' });
    else if (seen.has(url)) issues.push({ field: `${path}.url`, code: 'duplicate' });
    if (page === null || typeof page !== 'object' || !isText(page.title, 300)) issues.push({ field: `${path}.title`, code: 'invalid' });
    if (issues.length > before || url === null) continue;
    seen.add(url);
    const node = await buildSubject({ kind: 'page', url }, site.id, page.title, [], now);
    subjects.push(node);
    for (const [at, capture] of (page.captures ?? []).entries()) {
      const prepared = await prepareCapture(capture, node.id, { kind: 'url', url }, now, `${path}.captures[${at}]`, options, issues);
      if (prepared !== null) captures.push(prepared);
    }
  }
}

async function prepareApp(
  tree: AppTreeCandidate, now: string, options: PrepareOptions, subjects: SubjectNode[],
  captures: PreparedCapture[], issues: Issues,
): Promise<void> {
  const sourceIssues: Issues = [];
  const base = normalizeSource({ kind: 'app', platform: tree.platform, appId: tree.appId, appName: tree.title }, sourceIssues);
  for (const issue of sourceIssues) issues.push({ field: issue.field.replace(/^source\.appName$/u, 'title').replace(/^source\./u, ''), code: issue.code });
  if (base === null || base.kind !== 'app' || !isOneOf(APP_PLATFORMS, tree.platform)) return;
  if (!Array.isArray(tree.screens) || tree.screens.length > MAX_PAGES) { issues.push({ field: 'screens', code: 'invalid' }); return; }
  const app = await buildSubject({ kind: 'app', platform: base.platform, appId: base.appId }, null, tree.title, [], now);
  subjects.push(app);
  const screenIds = new Map<string, SubjectId>();
  for (const [index, screen] of tree.screens.entries()) {
    const path = `screens[${index}]`;
    const before = issues.length;
    if (screen === null || typeof screen !== 'object') { issues.push({ field: path, code: 'invalid' }); continue; }
    if (!isText(screen.key, 300)) issues.push({ field: `${path}.key`, code: 'invalid' });
    else if (screenIds.has(screen.key)) issues.push({ field: `${path}.key`, code: 'duplicate' });
    if (!isText(screen.title, 300)) issues.push({ field: `${path}.title`, code: 'invalid' });
    if (issues.length > before) continue;
    const node = await buildSubject({ kind: 'screen', app: app.id, key: screen.key }, app.id, screen.title, [], now);
    screenIds.set(screen.key, node.id);
    subjects.push(node);
    for (const [at, capture] of (screen.captures ?? []).entries()) {
      const source: ReferenceSource = { ...base, screen: screen.key };
      const prepared = await prepareCapture(capture, node.id, source, now, `${path}.captures[${at}]`, options, issues);
      if (prepared !== null) captures.push(prepared);
    }
  }
  const flowKeys = new Set<string>();
  for (const [index, flow] of (tree.flows ?? []).entries()) {
    const path = `flows[${index}]`;
    const before = issues.length;
    if (flow === null || typeof flow !== 'object') { issues.push({ field: path, code: 'invalid' }); continue; }
    if (!isText(flow.key, 300)) issues.push({ field: `${path}.key`, code: 'invalid' });
    else if (flowKeys.has(flow.key)) issues.push({ field: `${path}.key`, code: 'duplicate' });
    if (!isText(flow.title, 300)) issues.push({ field: `${path}.title`, code: 'invalid' });
    const steps: SubjectId[] = [];
    if (!Array.isArray(flow.steps) || flow.steps.length === 0) issues.push({ field: `${path}.steps`, code: 'required' });
    else {
      for (const key of flow.steps) {
        const id = typeof key === 'string' ? screenIds.get(key) : undefined;
        if (id === undefined) issues.push({ field: `${path}.steps`, code: 'unknown-screen' });
        else if (steps.includes(id)) issues.push({ field: `${path}.steps`, code: 'duplicate-step' });
        else steps.push(id);
      }
    }
    if (issues.length > before) continue;
    flowKeys.add(flow.key);
    const node = await buildSubject({ kind: 'flow', app: app.id, key: flow.key }, app.id, flow.title, steps, now);
    subjects.push(node);
    for (const [at, capture] of (flow.captures ?? []).entries()) {
      const prepared = await prepareCapture(capture, node.id, { ...base, screen: null }, now, `${path}.captures[${at}]`, options, issues);
      if (prepared !== null) captures.push(prepared);
    }
  }
}

/* ------------------------------------------------------------------ apply -- */

export type GraphApplication =
  | { readonly ok: true; readonly state: GraphState; readonly report: TreeImportReport }
  | { readonly ok: false; readonly code: string };

/** Total order used for lineage: capture time, then ID. */
function earlier(a: { capturedAt: string; id: string }, b: { capturedAt: string; id: string }): boolean {
  const byTime = Date.parse(a.capturedAt) - Date.parse(b.capturedAt);
  return byTime < 0 || (byTime === 0 && a.id < b.id);
}

function previousCapture(captures: GraphState['captures'], subjectId: SubjectId, incoming: CaptureRecord): CaptureRecord | null {
  let best: CaptureRecord | null = null;
  for (const capture of Object.values(captures)) {
    if (capture.subjectId !== subjectId || !earlier(capture, incoming)) continue;
    if (best === null || earlier(best, capture)) best = capture;
  }
  return best;
}

function contentOf(record: CaptureRecord, presence: ReadonlySet<BlobDigest>): CaptureAvailability['content'] {
  if (record.asset === null) return 'no-image';
  return presence.has(record.asset.digest) ? 'present' : 'blob-missing';
}

interface ObservedCapture {
  readonly capture: CaptureRecord;
  readonly differences: readonly string[];
}

/**
 * Observing an existing identity again never overwrites owner-reviewable
 * fields. Rights may only tighten (a publishable grant replaced by a
 * non-grant) and never over an owner judgement; availability facts update.
 */
function observeCapture(
  existing: CaptureRecord, incoming: PreparedCapture, content: CaptureAvailability['content'], now: string,
): ObservedCapture {
  const differences: string[] = [];
  const next = incoming.record;
  let capture = existing;
  if (existing.capturedAt !== next.capturedAt) {
    differences.push('capturedAt');
    if (Date.parse(next.capturedAt) < Date.parse(existing.capturedAt)) capture = { ...capture, capturedAt: next.capturedAt };
  }
  if (existing.capturedBy !== next.capturedBy) differences.push('capturedBy');
  if (JSON.stringify(existing.nativeEvidence) !== JSON.stringify(next.nativeEvidence)) differences.push('nativeEvidence');
  if (existing.asset?.mediaType !== next.asset?.mediaType) differences.push('asset.mediaType');
  if (incoming.record.provenance.producer !== null
    && JSON.stringify(existing.provenance.producer) !== JSON.stringify(next.provenance.producer)) differences.push('producer');
  if (incoming.rightsStated) {
    const same = existing.rights.declared.vocabulary === next.rights.declared.vocabulary
      && existing.rights.declared.value === next.rights.declared.value
      && existing.rights.basis === next.rights.basis && existing.rights.attribution === next.rights.attribution;
    if (!same) {
      if (isGraphPublishable(existing.rights) && !isGraphPublishable(next.rights) && existing.rights.setBy !== 'owner-judged') {
        differences.push('rights-tightened');
        capture = { ...capture, rights: next.rights };
      } else {
        differences.push('rights');
      }
    }
  }
  let availability = existing.availability;
  if (availability.content !== content) {
    differences.push('availability.content');
    availability = { ...availability, content, contentCheckedAt: now };
  }
  if (incoming.sourceStated && availability.source !== next.availability.source) {
    differences.push('availability.source');
    availability = {
      ...availability, source: next.availability.source, sourceObservedAt: next.availability.sourceObservedAt ?? now,
      sourceObservedBy: next.availability.sourceObservedBy,
    };
  }
  if (differences.length === 0) return { capture: existing, differences };
  return {
    differences,
    capture: { ...capture, availability, lastImportedAt: now, importCount: existing.importCount + 1 },
  };
}

/**
 * Commits a prepared graph. Re-applying the same identities is idempotent:
 * an identical repeat leaves the state object unchanged so callers skip writes.
 * `presence` is the set of digests currently readable from workspace storage.
 */
export function applyPrepared(
  state: GraphState, prepared: PreparedGraph, presence: ReadonlySet<BlobDigest>, now: string,
): GraphApplication {
  let subjects = state.subjects;
  let captures = state.captures;
  let anchors = state.anchors;
  let anchorsCreated = 0;
  let anchorsExisting = 0;
  const subjectReport: { id: SubjectId; status: SubjectOutcomeStatus }[] = [];
  const captureReport: { id: CaptureRecord['id']; status: CaptureOutcomeStatus; differences: readonly string[] }[] = [];

  for (const incoming of prepared.subjects) {
    const existing = subjects[incoming.id];
    if (existing === undefined) {
      subjects = { ...subjects, [incoming.id]: { ...incoming, createdAt: now } };
      subjectReport.push({ id: incoming.id, status: 'created' });
    } else if (existing.tombstonedAt !== null) {
      subjectReport.push({ id: incoming.id, status: 'tombstoned' });
    } else {
      const missing = incoming.steps.filter((step) => !existing.steps.includes(step));
      if (missing.length === 0) {
        subjectReport.push({ id: incoming.id, status: 'unchanged' });
      } else {
        subjects = { ...subjects, [incoming.id]: { ...existing, steps: [...existing.steps, ...missing] } };
        subjectReport.push({ id: incoming.id, status: 'updated' });
      }
    }
  }

  for (const incoming of prepared.captures) {
    const record = incoming.record;
    const subject = subjects[record.subjectId];
    if (subject === undefined) return { ok: false, code: 'subject-missing' };
    const content = contentOf(record, presence);
    const existing = captures[record.id];
    let live: CaptureRecord;
    if (subject.tombstonedAt !== null || (existing !== undefined && existing.tombstonedAt !== null)) {
      captureReport.push({ id: record.id, status: 'tombstoned', differences: [] });
      continue;
    }
    if (existing === undefined) {
      const previous = previousCapture(captures, record.subjectId, record);
      live = {
        ...record, lineage: { supersedes: previous?.id ?? null },
        availability: { ...record.availability, content, contentCheckedAt: now },
        importedAt: now, lastImportedAt: now,
      };
      captures = { ...captures, [live.id]: live };
      captureReport.push({ id: live.id, status: 'created', differences: [] });
    } else {
      const observed = observeCapture(existing, incoming, content, now);
      live = observed.capture;
      if (observed.differences.length === 0) {
        captureReport.push({ id: live.id, status: 'unchanged', differences: [] });
      } else {
        captures = { ...captures, [live.id]: live };
        captureReport.push({ id: live.id, status: 'observed-again', differences: observed.differences });
      }
    }
    for (const anchor of incoming.anchors) {
      if (anchors[anchor.id] !== undefined) { anchorsExisting += 1; continue; }
      if (anchor.parentId !== null && anchors[anchor.parentId] === undefined) return { ok: false, code: 'anchor-parent-missing' };
      anchors = { ...anchors, [anchor.id]: { ...anchor, createdAt: now } };
      anchorsCreated += 1;
    }
  }

  const created = subjectReport.some((item) => item.status === 'created') || captureReport.some((item) => item.status === 'created');
  const changed = created || anchorsCreated > 0 || subjectReport.some((item) => item.status === 'updated')
    || captureReport.some((item) => item.status === 'observed-again');
  const report: TreeImportReport = {
    status: created ? 'created' : changed ? 'observed-again' : 'unchanged',
    subjects: subjectReport, captures: captureReport, anchors: { created: anchorsCreated, existing: anchorsExisting },
  };
  if (!changed) return { ok: true, state, report };
  return { ok: true, state: { ...state, subjects, captures, anchors }, report };
}

/** Digests that the prepared graph needs to find in workspace storage. */
export function assetDigests(prepared: PreparedGraph): readonly BlobDigest[] {
  const digests = new Set<BlobDigest>();
  for (const capture of prepared.captures) if (capture.record.asset !== null) digests.add(capture.record.asset.digest);
  return [...digests].sort();
}

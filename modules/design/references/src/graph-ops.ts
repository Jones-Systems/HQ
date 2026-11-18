import type { BlobDigest, ClaimLevel, ProjectId, ValidationIssue, ViewId } from './contract.ts';
import { CLAIM_LEVELS } from './contract.ts';
import type {
  AnchorId, AvailabilityLabel, CaptureAvailability, CaptureId, CaptureRecord, DeclaredRightsInput, GraphState,
  PinId, ReferencePin, SourceAvailability, SubjectId, SubjectNode,
} from './graph-contract.ts';
import { SOURCE_AVAILABILITY } from './graph-contract.ts';
import { isOneOf, isText } from './provenance.ts';
import type { Result } from './library.ts';
import { buildRights } from './rights.ts';

const fail = (code: string): { ok: false; code: string } => ({ ok: false, code });

function liveSubject(state: GraphState, id: SubjectId): Result<SubjectNode> {
  const subject = state.subjects[id];
  if (subject === undefined) return fail('subject-not-found');
  if (subject.tombstonedAt !== null) return fail('subject-tombstoned');
  return { ok: true, value: subject };
}

function liveCapture(state: GraphState, id: CaptureId): Result<CaptureRecord> {
  const capture = state.captures[id];
  if (capture === undefined) return fail('capture-not-found');
  if (capture.tombstonedAt !== null) return fail('capture-tombstoned');
  return { ok: true, value: capture };
}

const putSubject = (state: GraphState, node: SubjectNode): GraphState => ({ ...state, subjects: { ...state.subjects, [node.id]: node } });
const putCapture = (state: GraphState, record: CaptureRecord): GraphState => ({ ...state, captures: { ...state.captures, [record.id]: record } });

/* ---------------------------------------------------------- subject edits -- */

/** Owner judgement. Imports and re-captures never read or write it, so it survives both. */
export function setRating(state: GraphState, id: SubjectId, rating: number | null): Result<GraphState> {
  const found = liveSubject(state, id);
  if (!found.ok) return found;
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return fail('invalid-rating');
  if (found.value.rating === rating) return { ok: true, value: state };
  return { ok: true, value: putSubject(state, { ...found.value, rating }) };
}

export function setSubjectTitle(state: GraphState, id: SubjectId, title: string): Result<GraphState> {
  const found = liveSubject(state, id);
  if (!found.ok) return found;
  if (!isText(title, 300)) return fail('invalid-title');
  return { ok: true, value: putSubject(state, { ...found.value, title }) };
}

export function tombstoneSubject(state: GraphState, id: SubjectId, now: string): Result<GraphState> {
  const found = liveSubject(state, id);
  if (!found.ok) return found;
  return { ok: true, value: putSubject(state, { ...found.value, tombstonedAt: now }) };
}

export function restoreSubject(state: GraphState, id: SubjectId): Result<GraphState> {
  const subject = state.subjects[id];
  if (subject === undefined) return fail('subject-not-found');
  if (subject.tombstonedAt === null) return { ok: true, value: state };
  return { ok: true, value: putSubject(state, { ...subject, tombstonedAt: null }) };
}

/* ---------------------------------------------------------- capture edits -- */

/** Owner decision on rights; the only path that records `owner-judged`, and the only one that can loosen. */
export function setCaptureRights(state: GraphState, id: CaptureId, raw: DeclaredRightsInput, now: string): Result<GraphState> {
  const found = liveCapture(state, id);
  if (!found.ok) return found;
  const issues: ValidationIssue[] = [];
  const rights = buildRights(raw, 'owner-judged', now, issues);
  if (issues.length > 0) return fail(issues[0]!.code);
  return { ok: true, value: putCapture(state, { ...found.value, rights }) };
}

/** Records what was learned about the live source. `unchecked` is not an observation. */
export function reportSourceStatus(
  state: GraphState, id: CaptureId, status: SourceAvailability, by: ClaimLevel, now: string,
): Result<GraphState> {
  const found = liveCapture(state, id);
  if (!found.ok) return found;
  if (!isOneOf(SOURCE_AVAILABILITY, status) || status === 'unchecked') return fail('invalid-status');
  if (!isOneOf(CLAIM_LEVELS, by)) return fail('invalid-claim');
  const availability: CaptureAvailability = { ...found.value.availability, source: status, sourceObservedAt: now, sourceObservedBy: by };
  return { ok: true, value: putCapture(state, { ...found.value, availability }) };
}

/** Re-derives content availability from the set of digests storage can serve. */
export function refreshContentAvailability(state: GraphState, presence: ReadonlySet<BlobDigest>, now: string): GraphState {
  let captures = state.captures;
  for (const capture of Object.values(state.captures)) {
    const content = capture.asset === null ? 'no-image' : presence.has(capture.asset.digest) ? 'present' : 'blob-missing';
    if (capture.availability.content === content) continue;
    captures = { ...captures, [capture.id]: { ...capture, availability: { ...capture.availability, content, contentCheckedAt: now } } };
  }
  return captures === state.captures ? state : { ...state, captures };
}

export function tombstoneCapture(state: GraphState, id: CaptureId, now: string): Result<GraphState> {
  const found = liveCapture(state, id);
  if (!found.ok) return found;
  return { ok: true, value: putCapture(state, { ...found.value, tombstonedAt: now }) };
}

export function restoreCapture(state: GraphState, id: CaptureId): Result<GraphState> {
  const capture = state.captures[id];
  if (capture === undefined) return fail('capture-not-found');
  if (capture.tombstonedAt === null) return { ok: true, value: state };
  return { ok: true, value: putCapture(state, { ...capture, tombstonedAt: null }) };
}

/* ------------------------------------------------------------------ pins -- */

export interface PinRequest {
  readonly projectId: string;
  readonly viewId: string | null;
  readonly captureId: CaptureId;
  readonly anchorId: AnchorId | null;
  readonly purpose: string;
}

/**
 * Pins a project to one exact immutable capture (and optionally one of its
 * anchors). The pin stores the capture's asset digest, so a later re-capture
 * of the subject can never move it. Repeating a pin returns the existing one.
 */
export function pinCapture(state: GraphState, id: PinId, request: PinRequest, now: string): Result<{ state: GraphState; pin: ReferencePin }> {
  const capture = liveCapture(state, request.captureId);
  if (!capture.ok) return capture;
  if (!isText(request.projectId, 160)) return fail('invalid-project');
  if (request.viewId !== null && !isText(request.viewId, 160)) return fail('invalid-view');
  if (typeof request.purpose !== 'string' || request.purpose.length > 500) return fail('invalid-purpose');
  if (request.anchorId !== null) {
    const anchor = state.anchors[request.anchorId];
    if (anchor === undefined) return fail('anchor-not-found');
    if (anchor.captureId !== capture.value.id || anchor.assetDigest !== capture.value.asset?.digest) return fail('anchor-capture-mismatch');
  }
  const existing = state.pins[id];
  if (existing !== undefined && existing.tombstonedAt === null) return { ok: true, value: { state, pin: existing } };
  const pin: ReferencePin = {
    id, projectId: request.projectId as ProjectId, viewId: request.viewId as ViewId | null, captureId: capture.value.id,
    assetDigest: capture.value.asset?.digest ?? null, anchorId: request.anchorId, purpose: request.purpose,
    pinnedAt: now, tombstonedAt: null,
  };
  return { ok: true, value: { state: { ...state, pins: { ...state.pins, [id]: pin } }, pin } };
}

export function unpin(state: GraphState, id: PinId, now: string): Result<GraphState> {
  const pin = state.pins[id];
  if (pin === undefined) return fail('pin-not-found');
  if (pin.tombstonedAt !== null) return { ok: true, value: state };
  return { ok: true, value: { ...state, pins: { ...state.pins, [id]: { ...pin, tombstonedAt: now } } } };
}

export function pinsForProject(state: GraphState, projectId: string): readonly ReferencePin[] {
  return Object.values(state.pins).filter((pin) => pin.projectId === projectId && pin.tombstonedAt === null)
    .sort((a, b) => a.pinnedAt.localeCompare(b.pinnedAt) || a.id.localeCompare(b.id));
}

/* --------------------------------------------------------------- queries -- */

/** Total order used everywhere captures are ordered: capture time, then ID. */
export function compareCaptures(a: CaptureRecord, b: CaptureRecord): number {
  return Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function capturesOfSubject(state: GraphState, subjectId: SubjectId, includeTombstoned = false): readonly CaptureRecord[] {
  return Object.values(state.captures)
    .filter((capture) => capture.subjectId === subjectId && (includeTombstoned || capture.tombstonedAt === null))
    .sort(compareCaptures);
}

/** Latest live capture of a subject; older captures stay reachable through lineage and pins. */
export function headCapture(state: GraphState, subjectId: SubjectId): CaptureRecord | null {
  const captures = capturesOfSubject(state, subjectId);
  return captures.at(-1) ?? null;
}

/** Follows `supersedes` pointers back from a capture, newest first, ending at the first capture. */
export function lineageOf(state: GraphState, id: CaptureId): readonly CaptureRecord[] {
  const chain: CaptureRecord[] = [];
  const seen = new Set<string>();
  let current: CaptureRecord | undefined = state.captures[id];
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.lineage.supersedes === null ? undefined : state.captures[current.lineage.supersedes];
  }
  return chain;
}

/**
 * One of five distinguishable display states. The record keeps both axes;
 * this projection prefers the worst news: missing bytes, then a source that
 * is gone, then a source that could not be judged, then no image, then present.
 */
export function availabilityLabel(availability: CaptureAvailability): AvailabilityLabel {
  if (availability.content === 'blob-missing') return 'blob-missing';
  if (availability.source === 'missing-at-source') return 'missing-at-source';
  if (availability.source === 'source-unavailable') return 'source-unavailable';
  return availability.content === 'no-image' ? 'no-image' : 'present';
}

/** Every digest referenced by any capture, live or tombstoned. */
export function referencedGraphDigests(state: GraphState): readonly BlobDigest[] {
  const digests = new Set<BlobDigest>();
  for (const capture of Object.values(state.captures)) if (capture.asset !== null) digests.add(capture.asset.digest);
  return [...digests].sort();
}

export interface BrowseNode {
  readonly subject: SubjectNode;
  readonly children: readonly BrowseNode[];
  readonly head: CaptureRecord | null;
  readonly captureCount: number;
  readonly availability: AvailabilityLabel | null;
}

function browseNode(state: GraphState, subject: SubjectNode, children: readonly BrowseNode[]): BrowseNode {
  const head = headCapture(state, subject.id);
  return {
    subject, children, head, captureCount: capturesOfSubject(state, subject.id).length,
    availability: head === null ? null : availabilityLabel(head.availability),
  };
}

/**
 * Browse tree: sites with their pages, apps with their flows (steps resolved
 * in order) and the screens that belong to no flow. Tombstoned subjects are hidden.
 */
export function browseGraph(state: GraphState): readonly BrowseNode[] {
  const live = Object.values(state.subjects).filter((subject) => subject.tombstonedAt === null)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const childrenOf = (parent: SubjectNode) => live.filter((subject) => subject.parentId === parent.id);
  const roots: BrowseNode[] = [];
  for (const root of live.filter((subject) => subject.parentId === null)) {
    if (root.kind === 'site') {
      roots.push(browseNode(state, root, childrenOf(root).map((page) => browseNode(state, page, []))));
      continue;
    }
    const screens = childrenOf(root).filter((subject) => subject.kind === 'screen');
    const flows = childrenOf(root).filter((subject) => subject.kind === 'flow');
    const inFlow = new Set(flows.flatMap((flow) => flow.steps));
    const flowNodes = flows.map((flow) => browseNode(
      state, flow,
      flow.steps.flatMap((step) => { const screen = screens.find((item) => item.id === step); return screen === undefined ? [] : [browseNode(state, screen, [])]; }),
    ));
    const loose = screens.filter((screen) => !inFlow.has(screen.id)).map((screen) => browseNode(state, screen, []));
    roots.push(browseNode(state, root, [...flowNodes, ...loose]));
  }
  return roots;
}

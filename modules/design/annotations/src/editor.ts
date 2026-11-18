import { ANNOTATION_DOCUMENT_SCHEMA } from './contract.ts';
import type {
  AgentEvent,
  AnchorTarget,
  AnnotationDocument,
  AnnotationId,
  AnnotationKind,
  AnnotationRef,
  Point,
  SourceAnchor,
  SourceFrame,
  VersionId,
} from './contract.ts';
import { rectFromPoints, targetDistance } from './geometry.ts';
import { letterForIndex } from './letters.ts';
import { LIMITS, kindMatchesTarget, parseTarget } from './validate.ts';

/** Pick and Cite are separate tools; there is no combined "select" tool. */
export const TOOLS = ['pick', 'cite', 'ink', 'box', 'arrow', 'label', 'eraser'] as const;
export type Tool = (typeof TOOLS)[number];
export type DrawKind = 'ink' | 'box' | 'arrow' | 'label';

/** Eraser removes drawn marks only; picks and citations are deleted explicitly. */
export const ERASABLE_KINDS: readonly AnnotationKind[] = ['ink', 'box', 'arrow', 'label'];

export const HISTORY_LIMIT = 200;

interface Snapshot {
  readonly annotations: readonly AnnotationRef[];
  readonly revisit: readonly AnnotationId[];
}

export interface HistoryEntry {
  readonly label: string;
  readonly before: Snapshot;
  readonly after: Snapshot;
}

export interface EditorState {
  readonly document: AnnotationDocument;
  readonly tool: Tool | null;
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
}

export type EditorAction =
  | { readonly type: 'select-tool'; readonly tool: Tool | null }
  | { readonly type: 'agent-event'; readonly id: AnnotationId; readonly event: AgentEvent; readonly frame: SourceFrame; readonly note?: string }
  | { readonly type: 'draw'; readonly id: AnnotationId; readonly kind: DrawKind; readonly points: readonly Point[]; readonly frame: SourceFrame; readonly note?: string }
  | { readonly type: 'erase'; readonly point: Point; readonly radius: number; readonly frame: SourceFrame }
  | { readonly type: 'set-note'; readonly id: AnnotationId; readonly note: string }
  | { readonly type: 'delete'; readonly id: AnnotationId }
  | { readonly type: 'toggle-revisit'; readonly id: AnnotationId }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' };

export type RejectReason =
  | 'tool-mismatch'
  | 'version-mismatch'
  | 'invalid-anchor'
  | 'empty-gesture'
  | 'duplicate-id'
  | 'unknown-annotation'
  | 'note-too-long'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'limit-reached'
  | 'no-frame'
  | 'read-only'
  | 'unavailable';

export type Outcome =
  | { readonly status: 'applied'; readonly created?: AnnotationRef; readonly removed?: readonly AnnotationId[] }
  | { readonly status: 'noop' }
  | { readonly status: 'rejected'; readonly reason: RejectReason };

export interface Transition {
  readonly state: EditorState;
  readonly outcome: Outcome;
}

export function emptyDocument(version: VersionId): AnnotationDocument {
  return { schema: ANNOTATION_DOCUMENT_SCHEMA, versionId: version, nextLetterIndex: 0, annotations: [], revisit: [] };
}

export function createEditor(document: AnnotationDocument): EditorState {
  return { document, tool: null, past: [], future: [] };
}

function snapshot(document: AnnotationDocument): Snapshot {
  return { annotations: document.annotations, revisit: document.revisit };
}

function reject(state: EditorState, reason: RejectReason): Transition {
  return { state, outcome: { status: 'rejected', reason } };
}

/** Applies an edit and records it; history never rewinds the letter cursor. */
function commit(state: EditorState, label: string, next: AnnotationDocument, outcome: Outcome): Transition {
  const entry: HistoryEntry = { label, before: snapshot(state.document), after: snapshot(next) };
  const past = [...state.past, entry].slice(-HISTORY_LIMIT);
  return { state: { ...state, document: next, past, future: [] }, outcome };
}

function anchorFrom(frame: SourceFrame, target: AnchorTarget, live?: AgentEvent['frame']): SourceAnchor {
  return {
    versionId: frame.versionId,
    route: frame.route,
    state: frame.state,
    viewport: live?.viewport ?? frame.viewport,
    scroll: live?.scroll ?? frame.scroll,
    captureDigest: frame.captureDigest,
    target,
  };
}

function drawTarget(kind: DrawKind, points: readonly Point[]): AnchorTarget | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;
  switch (kind) {
    case 'ink':
      return { kind: 'ink', points: points.map((p) => ({ x: p.x, y: p.y })) };
    case 'arrow':
      return first.x === last.x && first.y === last.y ? null : { kind: 'ink', points: [{ x: first.x, y: first.y }, { x: last.x, y: last.y }] };
    case 'box': {
      const rect = rectFromPoints(first, last);
      return rect.width < 1 && rect.height < 1 ? null : { kind: 'region', rect };
    }
    case 'label':
      return { kind: 'region', rect: { x: last.x, y: last.y, width: 0, height: 0 } };
  }
}

function create(state: EditorState, id: AnnotationId, kind: AnnotationKind, anchor: SourceAnchor, note: string): Transition {
  const { document } = state;
  if (anchor.versionId !== document.versionId) return reject(state, 'version-mismatch');
  // Re-validate through the persisted-format parser so nothing unstorable enters state.
  const target = parseTarget(anchor.target);
  if (target === null || !kindMatchesTarget(kind, target)) return reject(state, 'invalid-anchor');
  if (note.length > LIMITS.note) return reject(state, 'note-too-long');
  if (document.annotations.length >= LIMITS.annotations) return reject(state, 'limit-reached');
  if (document.annotations.some((a) => a.id === id)) return reject(state, 'duplicate-id');
  const annotation: AnnotationRef = { id, letter: letterForIndex(document.nextLetterIndex), anchor: { ...anchor, target }, note, kind };
  const next: AnnotationDocument = {
    ...document,
    nextLetterIndex: document.nextLetterIndex + 1,
    annotations: [...document.annotations, annotation],
  };
  return commit(state, `add ${kind} ${annotation.letter}`, next, { status: 'applied', created: annotation });
}

/** Pure reducer. Every edit is recorded so undo/redo are symmetric for every tool. */
export function reduce(state: EditorState, action: EditorAction): Transition {
  const { document } = state;
  switch (action.type) {
    case 'select-tool':
      return { state: { ...state, tool: action.tool }, outcome: { status: 'applied' } };

    case 'agent-event': {
      // Pick only accepts element picks, Cite only accepts text citations.
      if (action.event.type === 'element-picked' && state.tool !== 'pick') return reject(state, 'tool-mismatch');
      if (action.event.type === 'text-cited' && state.tool !== 'cite') return reject(state, 'tool-mismatch');
      if (action.frame.versionId !== document.versionId) return reject(state, 'version-mismatch');
      const kind: AnnotationKind = action.event.type === 'element-picked' ? 'pick' : 'cite';
      return create(state, action.id, kind, anchorFrom(action.frame, action.event.target, action.event.frame), action.note ?? '');
    }

    case 'draw': {
      if (state.tool !== action.kind) return reject(state, 'tool-mismatch');
      if (action.frame.versionId !== document.versionId) return reject(state, 'version-mismatch');
      const target = drawTarget(action.kind, action.points);
      if (target === null) return reject(state, 'empty-gesture');
      return create(state, action.id, action.kind, anchorFrom(action.frame, target), action.note ?? '');
    }

    case 'erase': {
      if (state.tool !== 'eraser') return reject(state, 'tool-mismatch');
      if (action.frame.versionId !== document.versionId) return reject(state, 'version-mismatch');
      const hit = new Set(document.annotations
        .filter((a) => ERASABLE_KINDS.includes(a.kind) && targetDistance(action.point, a.anchor.target) <= action.radius)
        .map((a) => a.id));
      if (hit.size === 0) return { state, outcome: { status: 'noop' } };
      const next: AnnotationDocument = {
        ...document,
        annotations: document.annotations.filter((a) => !hit.has(a.id)),
        revisit: document.revisit.filter((id) => !hit.has(id)),
      };
      return commit(state, `erase ${hit.size}`, next, { status: 'applied', removed: [...hit] });
    }

    case 'set-note': {
      const current = document.annotations.find((a) => a.id === action.id);
      if (current === undefined) return reject(state, 'unknown-annotation');
      if (action.note.length > LIMITS.note) return reject(state, 'note-too-long');
      if (current.note === action.note) return { state, outcome: { status: 'noop' } };
      const next: AnnotationDocument = {
        ...document,
        annotations: document.annotations.map((a) => (a.id === action.id ? { ...a, note: action.note } : a)),
      };
      return commit(state, `note ${current.letter}`, next, { status: 'applied' });
    }

    case 'delete': {
      const current = document.annotations.find((a) => a.id === action.id);
      if (current === undefined) return reject(state, 'unknown-annotation');
      const next: AnnotationDocument = {
        ...document,
        annotations: document.annotations.filter((a) => a.id !== action.id),
        revisit: document.revisit.filter((id) => id !== action.id),
      };
      return commit(state, `delete ${current.letter}`, next, { status: 'applied', removed: [action.id] });
    }

    case 'toggle-revisit': {
      const current = document.annotations.find((a) => a.id === action.id);
      if (current === undefined) return reject(state, 'unknown-annotation');
      const marked = document.revisit.includes(action.id);
      const next: AnnotationDocument = {
        ...document,
        revisit: marked ? document.revisit.filter((id) => id !== action.id) : [...document.revisit, action.id],
      };
      return commit(state, `${marked ? 'unmark' : 'mark'} revisit ${current.letter}`, next, { status: 'applied' });
    }

    case 'undo': {
      const entry = state.past[state.past.length - 1];
      if (entry === undefined) return reject(state, 'nothing-to-undo');
      return {
        state: {
          ...state,
          document: { ...document, ...entry.before },
          past: state.past.slice(0, -1),
          future: [entry, ...state.future],
        },
        outcome: { status: 'applied' },
      };
    }

    case 'redo': {
      const entry = state.future[0];
      if (entry === undefined) return reject(state, 'nothing-to-redo');
      return {
        state: {
          ...state,
          document: { ...document, ...entry.after },
          past: [...state.past, entry],
          future: state.future.slice(1),
        },
        outcome: { status: 'applied' },
      };
    }
  }
}

export function isRevisit(document: AnnotationDocument, id: AnnotationId): boolean {
  return document.revisit.includes(id);
}

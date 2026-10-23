import {
  ANNOTATION_DOCUMENT_SCHEMA,
  ANNOTATION_KINDS,
  TARGET_KIND_FOR,
  isIdText,
} from './contract.ts';
import type {
  AnchorTarget,
  AnnotationDocument,
  AnnotationId,
  AnnotationKind,
  AnnotationRef,
  Point,
  Rect,
  SourceAnchor,
  VersionId,
  Viewport,
} from './contract.ts';
import { isFiniteNumber } from './geometry.ts';
import { indexForLetter } from './letters.ts';

/** Bounds keep persisted documents and exports reasonable. */
export const LIMITS = {
  note: 4000,
  quote: 2000,
  context: 64,
  path: 2000,
  route: 2000,
  state: 500,
  digest: 200,
  rects: 200,
  points: 5000,
  annotations: 2000,
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function parsePoint(value: unknown): Point | null {
  if (!record(value) || !onlyKeys(value, ['x', 'y']) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { x: value.x, y: value.y };
}

function parseRect(value: unknown): Rect | null {
  if (!record(value) || !onlyKeys(value, ['x', 'y', 'width', 'height'])) return null;
  const { x, y, width, height } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width < 0 || height < 0) return null;
  return { x, y, width, height };
}

function parseViewport(value: unknown): Viewport | null {
  if (!record(value) || !onlyKeys(value, ['w', 'h', 'dpr'])) return null;
  const { w, h, dpr } = value;
  if (!isFiniteNumber(w) || !isFiniteNumber(h) || !isFiniteNumber(dpr) || w <= 0 || h <= 0 || dpr <= 0) return null;
  return { w, h, dpr };
}

function parseList<T>(value: unknown, max: number, item: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: T[] = [];
  for (const entry of value) {
    const parsed = item(entry);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

export function parseTarget(value: unknown): AnchorTarget | null {
  if (!record(value)) return null;
  switch (value.kind) {
    case 'element': {
      if (!onlyKeys(value, ['kind', 'path', 'rect', 'textHash'])) return null;
      const rect = parseRect(value.rect);
      if (!boundedString(value.path, LIMITS.path) || value.path.length === 0 || rect === null) return null;
      if ('textHash' in value && !boundedString(value.textHash, LIMITS.digest)) return null;
      return { kind: 'element', path: value.path, rect, ...(typeof value.textHash === 'string' ? { textHash: value.textHash } : {}) };
    }
    case 'text': {
      if (!onlyKeys(value, ['kind', 'quote', 'prefix', 'suffix', 'rects'])) return null;
      const rects = parseList(value.rects, LIMITS.rects, parseRect);
      if (!boundedString(value.quote, LIMITS.quote) || value.quote.trim().length === 0) return null;
      if (!boundedString(value.prefix, LIMITS.context) || !boundedString(value.suffix, LIMITS.context) || rects === null) return null;
      return { kind: 'text', quote: value.quote, prefix: value.prefix, suffix: value.suffix, rects };
    }
    case 'region': {
      if (!onlyKeys(value, ['kind', 'rect'])) return null;
      const rect = parseRect(value.rect);
      return rect === null ? null : { kind: 'region', rect };
    }
    case 'ink': {
      if (!onlyKeys(value, ['kind', 'points'])) return null;
      const points = parseList(value.points, LIMITS.points, parsePoint);
      return points === null || points.length === 0 ? null : { kind: 'ink', points };
    }
    default:
      return null;
  }
}

export function parseAnchor(value: unknown): SourceAnchor | null {
  if (!record(value) || !onlyKeys(value, ['versionId', 'route', 'state', 'viewport', 'scroll', 'captureDigest', 'target'])) return null;
  const viewport = parseViewport(value.viewport);
  const scroll = parsePoint(value.scroll);
  const target = parseTarget(value.target);
  if (!isIdText(value.versionId) || !boundedString(value.route, LIMITS.route) || !boundedString(value.state, LIMITS.state)) return null;
  if (!boundedString(value.captureDigest, LIMITS.digest) || value.captureDigest.length === 0) return null;
  if (viewport === null || scroll === null || target === null) return null;
  return {
    versionId: value.versionId as VersionId,
    route: value.route,
    state: value.state,
    viewport,
    scroll,
    captureDigest: value.captureDigest,
    target,
  };
}

function isKind(value: unknown): value is AnnotationKind {
  return typeof value === 'string' && ANNOTATION_KINDS.some((kind) => kind === value);
}

function isLetter(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    indexForLetter(value);
    return true;
  } catch {
    return false;
  }
}

/** Kind/target agreement: Pick is always an element, Cite always text, arrows are two-point ink. */
export function kindMatchesTarget(kind: AnnotationKind, target: AnchorTarget): boolean {
  if (TARGET_KIND_FOR[kind] !== target.kind) return false;
  if (kind === 'arrow') return target.kind === 'ink' && target.points.length === 2;
  return true;
}

export function parseAnnotationRef(value: unknown): AnnotationRef | null {
  if (!record(value) || !onlyKeys(value, ['id', 'letter', 'anchor', 'note', 'kind'])) return null;
  const anchor = parseAnchor(value.anchor);
  if (!isIdText(value.id) || !isLetter(value.letter) || !boundedString(value.note, LIMITS.note) || !isKind(value.kind)) return null;
  if (anchor === null || !kindMatchesTarget(value.kind, anchor.target)) return null;
  return { id: value.id as AnnotationId, letter: value.letter, anchor, note: value.note, kind: value.kind };
}

export type DocumentParse =
  | { readonly ok: true; readonly document: AnnotationDocument }
  | { readonly ok: false; readonly reason: 'unsupported-schema' | 'invalid' };

/**
 * Strictly parses a persisted document. An unknown schema is rejected as
 * unsupported (never repaired or down-converted); callers must not overwrite it.
 */
export function parseAnnotationDocument(value: unknown): DocumentParse {
  if (!record(value)) return { ok: false, reason: 'invalid' };
  if (value.schema !== ANNOTATION_DOCUMENT_SCHEMA) {
    return { ok: false, reason: typeof value.schema === 'string' ? 'unsupported-schema' : 'invalid' };
  }
  if (!onlyKeys(value, ['schema', 'versionId', 'nextLetterIndex', 'annotations', 'revisit'])) return { ok: false, reason: 'invalid' };
  const annotations = parseList(value.annotations, LIMITS.annotations, parseAnnotationRef);
  const revisit = parseList(value.revisit, LIMITS.annotations, (entry) => (isIdText(entry) ? (entry as AnnotationId) : null));
  const { nextLetterIndex } = value;
  if (!isIdText(value.versionId) || annotations === null || revisit === null) return { ok: false, reason: 'invalid' };
  if (typeof nextLetterIndex !== 'number' || !Number.isSafeInteger(nextLetterIndex) || nextLetterIndex < 0) return { ok: false, reason: 'invalid' };
  const ids = new Set<string>();
  const letters = new Set<string>();
  for (const annotation of annotations) {
    if (annotation.anchor.versionId !== value.versionId) return { ok: false, reason: 'invalid' };
    if (ids.has(annotation.id) || letters.has(annotation.letter)) return { ok: false, reason: 'invalid' };
    if (indexForLetter(annotation.letter) >= nextLetterIndex) return { ok: false, reason: 'invalid' };
    ids.add(annotation.id);
    letters.add(annotation.letter);
  }
  if (new Set(revisit).size !== revisit.length || revisit.some((id) => !ids.has(id))) return { ok: false, reason: 'invalid' };
  return {
    ok: true,
    document: {
      schema: ANNOTATION_DOCUMENT_SCHEMA,
      versionId: value.versionId as VersionId,
      nextLetterIndex,
      annotations,
      revisit,
    },
  };
}

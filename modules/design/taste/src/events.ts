import {
  EXAMPLE_SOURCE_KINDS, JUDGMENTS, MAX_LABEL_LENGTH, MAX_TEXT_LENGTH, SUBJECT_KINDS, isIdentifier,
  type ClaimedRating, type RatingTarget, type RatingValue, type TasteEvent, type TasteScope, type TasteSubject,
} from './contract.ts';

/** Strict parsers: unknown keys, wrong types and out-of-range values all fail. */

type Json = Record<string, unknown>;

function record(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value: Json, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => key in value) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && value.isWellFormed();
}

function label(value: unknown): value is string {
  return text(value, MAX_LABEL_LENGTH) && !/[\u0000-\u001f\u007f]/u.test(value);
}

function idOrNull(value: unknown): value is string | null {
  return value === null || isIdentifier(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some((item) => item === value);
}

export function isRatingValue(value: unknown): value is RatingValue {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function parseScope(value: unknown): TasteScope | null {
  if (!record(value)) return null;
  if (value.kind === 'general' && exactKeys(value, ['kind'])) return { kind: 'general' };
  if (value.kind === 'project' && exactKeys(value, ['kind', 'projectId']) && isIdentifier(value.projectId)) {
    return value as unknown as TasteScope;
  }
  return null;
}

export function parseTarget(value: unknown): RatingTarget | null {
  if (!record(value)) return null;
  if (value.kind === 'overall' && exactKeys(value, ['kind'])) return { kind: 'overall' };
  if (value.kind === 'aspect' && exactKeys(value, ['kind', 'aspect']) && isIdentifier(value.aspect)) {
    return value as unknown as RatingTarget;
  }
  return null;
}

export function parseSubject(value: unknown): TasteSubject | null {
  if (!record(value) || !exactKeys(value, ['id', 'kind', 'label'], ['versionId'])) return null;
  if (!isIdentifier(value.id) || !oneOf(SUBJECT_KINDS, value.kind) || !label(value.label)) return null;
  if ('versionId' in value && !isIdentifier(value.versionId)) return null;
  return value as unknown as TasteSubject;
}

/** Descriptive judgments describe a named quality; an "overall description" has no meaning. */
function judgmentFitsTarget(judgment: unknown, target: RatingTarget): boolean {
  return judgment === 'liking' || target.kind === 'aspect';
}

function parseClaimed(value: unknown): ClaimedRating | null {
  if (!record(value) || !exactKeys(value, ['judgment', 'target', 'value'])) return null;
  const target = parseTarget(value.target);
  if (!target || !oneOf(JUDGMENTS, value.judgment) || !isRatingValue(value.value)) return null;
  return judgmentFitsTarget(value.judgment, target) ? value as unknown as ClaimedRating : null;
}

export function parseTasteEvent(value: unknown): TasteEvent | null {
  if (!record(value)) return null;
  switch (value.type) {
    case 'assessment.recorded': {
      if (!exactKeys(value, ['type', 'assessmentId', 'scope', 'subject', 'judgment', 'target', 'value', 'supersedes'])) return null;
      const target = parseTarget(value.target);
      if (!isIdentifier(value.assessmentId) || !parseScope(value.scope) || !parseSubject(value.subject)
        || !oneOf(JUDGMENTS, value.judgment) || !target || !judgmentFitsTarget(value.judgment, target)
        || !isRatingValue(value.value) || !idOrNull(value.supersedes)) return null;
      return value as unknown as TasteEvent;
    }
    case 'note.added':
      if (!exactKeys(value, ['type', 'noteId', 'scope', 'subjectId', 'about', 'text'])) return null;
      if (!isIdentifier(value.noteId) || !parseScope(value.scope) || !idOrNull(value.subjectId)
        || !idOrNull(value.about) || !text(value.text, MAX_TEXT_LENGTH)) return null;
      return value as unknown as TasteEvent;
    case 'counterevidence.added': {
      if (!exactKeys(value, ['type', 'counterevidenceId', 'scope', 'judgment', 'target', 'subjectId', 'contradicts', 'text'])) return null;
      const target = parseTarget(value.target);
      if (!isIdentifier(value.counterevidenceId) || !parseScope(value.scope) || !oneOf(JUDGMENTS, value.judgment)
        || !target || !judgmentFitsTarget(value.judgment, target) || !idOrNull(value.subjectId)
        || !idOrNull(value.contradicts) || !text(value.text, MAX_TEXT_LENGTH)) return null;
      return value as unknown as TasteEvent;
    }
    case 'example.imported': {
      if (!exactKeys(value, ['type', 'exampleId', 'scope', 'subject', 'source', 'claimed'])) return null;
      const source = value.source;
      if (!isIdentifier(value.exampleId) || !parseScope(value.scope) || !parseSubject(value.subject)
        || !record(source) || !exactKeys(source, ['kind', 'label']) || !oneOf(EXAMPLE_SOURCE_KINDS, source.kind)
        || !label(source.label) || !Array.isArray(value.claimed) || value.claimed.length > 32
        || !value.claimed.every((claim) => parseClaimed(claim) !== null)) return null;
      return value as unknown as TasteEvent;
    }
    case 'project-contribution.set':
      if (!exactKeys(value, ['type', 'projectId', 'contributesToGeneral'])) return null;
      if (!isIdentifier(value.projectId) || typeof value.contributesToGeneral !== 'boolean') return null;
      return value as unknown as TasteEvent;
    default:
      return null;
  }
}

export function sameScope(a: TasteScope, b: TasteScope): boolean {
  return a.kind === b.kind && (a.kind === 'general' || (b.kind === 'project' && a.projectId === b.projectId));
}

export function sameTarget(a: RatingTarget, b: RatingTarget): boolean {
  return a.kind === b.kind && (a.kind === 'overall' || (b.kind === 'aspect' && a.aspect === b.aspect));
}

export function scopeKey(scope: TasteScope): string {
  return scope.kind === 'general' ? 'general' : `project:${scope.projectId}`;
}

export function targetKey(target: RatingTarget): string {
  return target.kind === 'overall' ? 'overall' : `aspect:${target.aspect}`;
}

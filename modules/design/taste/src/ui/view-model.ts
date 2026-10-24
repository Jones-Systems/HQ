import {
  aspectId, assessmentId, clientEventId, counterevidenceId, noteId, projectId as toProjectId,
  type AppendResult, type AspectId, type AssessmentView, type Judgment, type ProjectId, type RatingTarget,
  type RatingValue, type TasteCommand, type TasteScope, type TasteSnapshot, type TasteSubject,
} from '../contract.ts';
import { sameScope, sameTarget } from '../events.ts';

/** Pure state for the taste panel; React only renders what this derives. */

export interface AspectDefinition {
  readonly id: AspectId;
  readonly label: string;
  /** Descriptive scale ends: 1 and 5. */
  readonly low: string;
  readonly high: string;
}

export const DEFAULT_ASPECTS: readonly AspectDefinition[] = [
  { id: aspectId('typography'), label: 'Typography', low: 'Plain', high: 'Expressive' },
  { id: aspectId('color'), label: 'Color', low: 'Muted', high: 'Vivid' },
  { id: aspectId('layout'), label: 'Layout', low: 'Loose', high: 'Structured' },
  { id: aspectId('density'), label: 'Density', low: 'Airy', high: 'Dense' },
  { id: aspectId('hierarchy'), label: 'Hierarchy', low: 'Flat', high: 'Pronounced' },
  { id: aspectId('motion'), label: 'Motion', low: 'Still', high: 'Lively' },
];

export const LIKING_LABELS: Readonly<Record<RatingValue, string>> = {
  1: 'Strongly dislike', 2: 'Dislike', 3: 'Neutral', 4: 'Like', 5: 'Love',
};

export interface RatingSlot {
  readonly key: string;
  readonly judgment: Judgment;
  readonly target: RatingTarget;
  readonly label: string;
  readonly current: AssessmentView | null;
  /** Earlier values in this slot, oldest first; never edited in place. */
  readonly history: readonly AssessmentView[];
}

export function scopeFor(kind: 'general' | 'project', projectId: ProjectId | null): TasteScope | null {
  if (kind === 'general') return { kind: 'general' };
  return projectId ? { kind: 'project', projectId } : null;
}

export function ratingSlots(
  snapshot: TasteSnapshot, scope: TasteScope, subject: TasteSubject, aspects: readonly AspectDefinition[],
): { readonly liking: readonly RatingSlot[]; readonly descriptive: readonly RatingSlot[] } {
  const slot = (judgment: Judgment, target: RatingTarget, label: string): RatingSlot => {
    const items = snapshot.assessments.filter((item) => item.subject.id === subject.id && item.judgment === judgment
      && sameScope(item.scope, scope) && sameTarget(item.target, target));
    const current = items.find((item) => item.supersededBy === null) ?? null;
    return {
      key: `${judgment}:${target.kind === 'overall' ? 'overall' : target.aspect}`,
      judgment, target, label, current,
      history: items.filter((item) => item !== current),
    };
  };
  return {
    liking: [
      slot('liking', { kind: 'overall' }, 'Overall'),
      ...aspects.map((aspect) => slot('liking', { kind: 'aspect', aspect: aspect.id }, aspect.label)),
    ],
    descriptive: aspects.map((aspect) => slot('descriptive', { kind: 'aspect', aspect: aspect.id }, aspect.label)),
  };
}

export type NewId = () => string;

export const randomId: NewId = () => crypto.randomUUID();

/** A rating click; re-rating supersedes the slot's current value. Same value is a no-op. */
export function ratingCommand(
  scope: TasteScope, subject: TasteSubject, slot: RatingSlot, value: RatingValue, newId: NewId,
): TasteCommand | null {
  if (slot.current?.value === value) return null;
  return {
    clientEventId: clientEventId(newId()),
    event: {
      type: 'assessment.recorded', assessmentId: assessmentId(newId()), scope, subject,
      judgment: slot.judgment, target: slot.target, value, supersedes: slot.current?.assessmentId ?? null,
    },
  };
}

export function noteCommand(scope: TasteScope, subject: TasteSubject, text: string, newId: NewId): TasteCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    clientEventId: clientEventId(newId()),
    event: { type: 'note.added', noteId: noteId(newId()), scope, subjectId: subject.id, about: null, text: trimmed },
  };
}

export function counterevidenceCommand(
  scope: TasteScope, subject: TasteSubject, slot: RatingSlot, text: string, newId: NewId,
): TasteCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    clientEventId: clientEventId(newId()),
    event: {
      type: 'counterevidence.added', counterevidenceId: counterevidenceId(newId()), scope,
      judgment: slot.judgment, target: slot.target, subjectId: subject.id,
      contradicts: slot.current?.assessmentId ?? null, text: trimmed,
    },
  };
}

export function contributionCommand(projectId: string, contributes: boolean, newId: NewId): TasteCommand {
  return {
    clientEventId: clientEventId(newId()),
    event: { type: 'project-contribution.set', projectId: toProjectId(projectId), contributesToGeneral: contributes },
  };
}

/** Plain-language outcome; "unknown" keeps the same command for an idempotent retry. */
export type SubmitOutcome =
  | { readonly kind: 'saved' | 'already-saved'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'unknown'; readonly message: string; readonly retry: TasteCommand };

const REJECTIONS: Readonly<Record<string, string>> = {
  'stale-supersede': 'This rating changed elsewhere. Review the latest value and rate again.',
  'already-rated': 'This has a rating already. Rate again to replace it.',
  'id-reused': 'That entry already exists.',
  'unknown-assessment': 'The rating this refers to no longer exists.',
  'invalid-command': 'That entry could not be saved because it was malformed.',
  'invalid-event': 'That entry could not be saved because it was malformed.',
};

export function describeResult(result: AppendResult): SubmitOutcome {
  switch (result.status) {
    case 'appended':
      return { kind: 'saved', message: 'Saved.' };
    case 'duplicate':
      return { kind: 'already-saved', message: 'Already saved.' };
    case 'conflict':
      return { kind: 'refused', message: 'A different entry was already saved under this request. Nothing was changed.' };
    case 'rejected':
      return { kind: 'refused', message: REJECTIONS[result.reason] ?? `Not saved: ${result.reason}.` };
    case 'fail-closed':
      return { kind: 'refused', message: 'The taste journal is read-only after a storage fault. Nothing was saved.' };
    case 'closed':
      return { kind: 'refused', message: 'The taste journal is closed. Nothing was saved.' };
  }
}

export function describeUnknown(command: TasteCommand): SubmitOutcome {
  return {
    kind: 'unknown',
    message: 'The save may or may not have reached the journal. Retrying sends the same entry and cannot duplicate it.',
    retry: command,
  };
}

export function formatMean(mean: number | null): string {
  return mean === null ? '—' : mean.toFixed(1);
}

import {
  GENESIS_HASH,
  type AssessmentView, type ExampleView, type JournalHead, type JournalRecord, type Judgment, type ProfileExport,
  type ProfileExportOptions, type ProfileNote, type ProfileScope, type ProjectId, type RatingSummary, type RatingTarget,
  type SampleLimit, type Sha256Hex, type TasteProfile, type TasteScope,
} from './contract.ts';
import { canonicalize } from './jcs.ts';
import { sameTarget, scopeKey, targetKey } from './events.ts';

/** Pure projection of verified journal records into taste state and profiles. */

export const DEFAULT_SAMPLE_THRESHOLD = 5;

export interface TasteState {
  readonly head: JournalHead;
  /** Every owner assessment in journal order, including superseded history. */
  readonly assessments: readonly AssessmentView[];
  readonly notes: readonly ProfileNote[];
  readonly examples: readonly ExampleView[];
  /** Latest explicit choice per project; missing means "does not contribute". */
  readonly contributions: ReadonlyMap<string, boolean>;
}

/** One rating slot: a re-rating supersedes the current value in the same slot. */
export function assessmentKey(scope: TasteScope, subjectId: string, judgment: Judgment, target: RatingTarget): string {
  return JSON.stringify([scopeKey(scope), subjectId, judgment, targetKey(target)]);
}

export function projectTaste(records: readonly JournalRecord[]): TasteState {
  const assessments: AssessmentView[] = [];
  const byId = new Map<string, number>();
  const notes: ProfileNote[] = [];
  const examples: ExampleView[] = [];
  const contributions = new Map<string, boolean>();
  for (const record of records) {
    const event = record.payload;
    switch (event.type) {
      case 'assessment.recorded': {
        if (event.supersedes !== null) {
          const index = byId.get(event.supersedes);
          if (index !== undefined) assessments[index] = { ...assessments[index], supersededBy: event.assessmentId };
        }
        byId.set(event.assessmentId, assessments.length);
        assessments.push({
          assessmentId: event.assessmentId, seq: record.seq, recordedAt: record.recordedAt, scope: event.scope,
          subject: event.subject, judgment: event.judgment, target: event.target, value: event.value,
          supersedes: event.supersedes, supersededBy: null,
        });
        break;
      }
      case 'note.added':
        notes.push({ id: event.noteId, kind: 'note', scope: event.scope, text: event.text, target: null, judgment: null, subjectId: event.subjectId });
        break;
      case 'counterevidence.added':
        notes.push({
          id: event.counterevidenceId, kind: 'counterevidence', scope: event.scope, text: event.text,
          target: event.target, judgment: event.judgment, subjectId: event.subjectId,
        });
        break;
      case 'example.imported':
        examples.push({ exampleId: event.exampleId, scope: event.scope, subject: event.subject, source: event.source, claimed: event.claimed });
        break;
      case 'project-contribution.set':
        contributions.set(event.projectId, event.contributesToGeneral);
        break;
    }
  }
  const last = records.at(-1);
  return { head: last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH }, assessments, notes, examples, contributions };
}

export function currentAssessment(
  state: TasteState, scope: TasteScope, subjectId: string, judgment: Judgment, target: RatingTarget,
): AssessmentView | null {
  const key = assessmentKey(scope, subjectId, judgment, target);
  let current: AssessmentView | null = null;
  for (const item of state.assessments) {
    if (item.supersededBy === null && assessmentKey(item.scope, item.subject.id, item.judgment, item.target) === key) current = item;
  }
  return current;
}

export function sampleLimit(count: number, threshold: number, noun: string): SampleLimit {
  const limited = count < threshold;
  return {
    limited, count, threshold,
    label: limited ? `Limited sample: ${count} ${noun}${count === 1 ? '' : 's'}, fewer than ${threshold}` : null,
  };
}

function checkThreshold(threshold: number): number {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10_000) throw new RangeError('Sample threshold must be a positive integer');
  return threshold;
}

function profileScope(state: TasteState, scope: TasteScope): ProfileScope {
  if (scope.kind === 'project') return { kind: 'project', projectId: scope.projectId };
  const includedProjects = [...state.contributions].filter(([, value]) => value).map(([id]) => id as ProjectId).sort();
  return { kind: 'general', includedProjects };
}

/**
 * General taste reads general-scope entries plus projects the owner explicitly
 * opted in. A project profile reads only that project. Imported examples are
 * counted separately and never enter rating statistics.
 */
function includes(scope: ProfileScope, item: TasteScope): boolean {
  if (scope.kind === 'project') return item.kind === 'project' && item.projectId === scope.projectId;
  return item.kind === 'general' || scope.includedProjects.includes(item.projectId);
}

export function buildProfile(state: TasteState, scope: TasteScope, threshold = DEFAULT_SAMPLE_THRESHOLD): TasteProfile {
  checkThreshold(threshold);
  const resolved = profileScope(state, scope);
  const inScope = state.assessments.filter((item) => includes(resolved, item.scope));
  const notes = state.notes.filter((item) => includes(resolved, item.scope));
  const groups = new Map<string, { judgment: Judgment; target: RatingTarget }>();
  for (const item of inScope) groups.set(`${item.judgment}|${targetKey(item.target)}`, { judgment: item.judgment, target: item.target });

  const summaries: RatingSummary[] = [...groups.values()].map(({ judgment, target }) => {
    const slot = inScope.filter((item) => item.judgment === judgment && sameTarget(item.target, target));
    const current = slot.filter((item) => item.supersededBy === null);
    const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const item of current) distribution[item.value - 1] += 1;
    const total = current.reduce((sum, item) => sum + item.value, 0);
    return {
      judgment, target, count: current.length,
      mean: current.length ? Math.round((total / current.length) * 100) / 100 : null,
      distribution, superseded: slot.length - current.length,
      counterevidence: notes.filter((note) => note.kind === 'counterevidence' && note.judgment === judgment
        && note.target !== null && sameTarget(note.target, target)).length,
      sample: sampleLimit(current.length, threshold, 'rating'),
    };
  }).sort(compareSummaries);

  const subjects = new Set(inScope.filter((item) => item.supersededBy === null).map((item) => item.subject.id));
  return {
    schema: 'hq.design.taste-profile/v1',
    scope: resolved,
    journalHead: state.head,
    claimLevel: 'owner-judged',
    sample: sampleLimit(subjects.size, threshold, 'rated subject'),
    summaries,
    notes,
    importedExamples: { count: state.examples.filter((item) => includes(resolved, item.scope)).length, ownerJudgment: false },
  };
}

function compareSummaries(a: RatingSummary, b: RatingSummary): number {
  if (a.judgment !== b.judgment) return a.judgment === 'liking' ? -1 : 1;
  if (a.target.kind !== b.target.kind) return a.target.kind === 'overall' ? -1 : 1;
  return targetKey(a.target) < targetKey(b.target) ? -1 : targetKey(a.target) > targetKey(b.target) ? 1 : 0;
}

const encoder = new TextEncoder();

/**
 * Export is explicit about what it leaves out. History, imported example
 * content and the journal itself never leave through a profile export.
 */
export async function exportProfile(state: TasteState, options: ProfileExportOptions, sha256: Sha256Hex, threshold = DEFAULT_SAMPLE_THRESHOLD): Promise<ProfileExport> {
  const profile = buildProfile(state, options.scope, threshold);
  const omitted = ['assessment-history', 'imported-example-content', 'journal'];
  if (!options.includeNotes) omitted.push('notes');
  if (!options.includeCounterevidence) omitted.push('counterevidence');
  const notes = profile.notes.filter((note) => note.kind === 'note' ? options.includeNotes : options.includeCounterevidence);
  const document = {
    schema: 'hq.design.taste-profile-export/v1',
    profile: { ...profile, notes },
    omitted,
  };
  const json = canonicalize(document);
  return { json, digest: await sha256(encoder.encode(json)), omitted };
}

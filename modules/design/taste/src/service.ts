import {
  isIdentifier,
  type AppendResult, type JournalRecord, type ProfileExport, type ProfileExportOptions, type ProjectId,
  type Sha256Hex, type TasteClientPort, type TasteCommand, type TasteEvent, type TasteSnapshot,
} from './contract.ts';
import { parseScope, parseTasteEvent, sameScope } from './events.ts';
import type { AppendPrecondition, TasteJournal } from './journal.ts';
import { DEFAULT_SAMPLE_THRESHOLD, buildProfile, currentAssessment, exportProfile, projectTaste, type TasteState } from './profile.ts';

/**
 * Main-side taste service. It validates domain rules inside the journal's
 * serialized append and exposes the renderer-facing TasteClientPort shape.
 * Saving a rating only appends; nothing here changes model defaults or
 * activates guidance.
 */

export interface TasteServiceOptions {
  readonly sha256: Sha256Hex;
  readonly sampleThreshold?: number;
  readonly label?: string;
}

export type TasteJournalPort = Pick<TasteJournal, 'head' | 'status' | 'records' | 'append'>;

/** Validates an untrusted command arriving over a typed channel. */
export function parseTasteCommand(value: unknown): TasteCommand | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { clientEventId, event, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || !isIdentifier(clientEventId)) return null;
  const parsed = parseTasteEvent(event);
  return parsed ? { clientEventId: clientEventId as TasteCommand['clientEventId'], event: parsed } : null;
}

export function parseExportOptions(value: unknown): ProfileExportOptions | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { scope, includeNotes, includeCounterevidence, ...rest } = value as Record<string, unknown>;
  const parsedScope = parseScope(scope);
  if (Object.keys(rest).length > 0 || !parsedScope || typeof includeNotes !== 'boolean' || typeof includeCounterevidence !== 'boolean') return null;
  return { scope: parsedScope, includeNotes, includeCounterevidence };
}

function precondition(event: TasteEvent): AppendPrecondition {
  return (records: readonly JournalRecord[]) => {
    const state = projectTaste(records);
    const used = (id: string) => records.some(({ payload }) => (
      (payload.type === 'assessment.recorded' && payload.assessmentId === id)
      || (payload.type === 'note.added' && payload.noteId === id)
      || (payload.type === 'counterevidence.added' && payload.counterevidenceId === id)
      || (payload.type === 'example.imported' && payload.exampleId === id)));
    const assessmentExists = (id: string | null) => id === null || state.assessments.some((item) => item.assessmentId === id
      && 'scope' in event && sameScope(item.scope, event.scope));
    switch (event.type) {
      case 'assessment.recorded': {
        if (used(event.assessmentId)) return 'id-reused';
        const current = currentAssessment(state, event.scope, event.subject.id, event.judgment, event.target);
        if (event.supersedes === null) return current ? 'already-rated' : null;
        return current?.assessmentId === event.supersedes ? null : 'stale-supersede';
      }
      case 'note.added':
        if (used(event.noteId)) return 'id-reused';
        return assessmentExists(event.about) ? null : 'unknown-assessment';
      case 'counterevidence.added':
        if (used(event.counterevidenceId)) return 'id-reused';
        return assessmentExists(event.contradicts) ? null : 'unknown-assessment';
      case 'example.imported':
        return used(event.exampleId) ? 'id-reused' : null;
      case 'project-contribution.set':
        return null;
    }
  };
}

export class TasteService implements TasteClientPort {
  readonly label: string;
  readonly #journal: TasteJournalPort;
  readonly #options: TasteServiceOptions;
  #cache: { seq: number; state: TasteState } | null = null;

  constructor(journal: TasteJournalPort, options: TasteServiceOptions) {
    this.#journal = journal;
    this.#options = options;
    this.label = options.label ?? 'HQ taste journal';
  }

  #state(): TasteState {
    const seq = this.#journal.head.seq;
    if (this.#cache?.seq !== seq) this.#cache = { seq, state: projectTaste(this.#journal.records()) };
    return this.#cache.state;
  }

  async snapshot(projectId: ProjectId | null): Promise<TasteSnapshot> {
    const state = this.#state();
    const threshold = this.#options.sampleThreshold ?? DEFAULT_SAMPLE_THRESHOLD;
    return {
      journal: this.#journal.status,
      assessments: state.assessments,
      notes: state.notes,
      examples: state.examples,
      contributions: Object.fromEntries(state.contributions),
      general: buildProfile(state, { kind: 'general' }, threshold),
      project: projectId ? buildProfile(state, { kind: 'project', projectId }, threshold) : null,
    };
  }

  async submit(command: TasteCommand): Promise<AppendResult> {
    const parsed = parseTasteCommand(command);
    if (!parsed) return { status: 'rejected', reason: 'invalid-command' };
    return this.#journal.append(parsed.clientEventId, parsed.event, precondition(parsed.event));
  }

  async exportProfile(options: ProfileExportOptions): Promise<ProfileExport> {
    const parsed = parseExportOptions(options);
    if (!parsed) throw new TypeError('Invalid export options');
    return exportProfile(this.#state(), parsed, this.#options.sha256, this.#options.sampleThreshold ?? DEFAULT_SAMPLE_THRESHOLD);
  }
}

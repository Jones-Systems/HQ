import {
  assessmentId, clientEventId, exampleId, projectId, subjectId,
  type AspectId, type Clock, type Judgment, type RatingTarget, type RatingValue, type TasteCommand, type TasteScope,
  type TasteSubject,
} from '../src/contract.ts';
import { createFakeTasteFileSystem, type FakeTasteFileSystem } from '../src/fake-file-system.ts';
import { TasteJournal } from '../src/journal.ts';
import { nodeSha256 } from '../src/node-file-system.ts';
import { TasteService } from '../src/service.ts';

/** Synthetic fixtures only. */

export const JOURNAL = 'taste/journal.jsonl';
export const LOCK = 'taste/journal.lock';
export const GENERAL: TasteScope = { kind: 'general' };
export const PROJECT_A: TasteScope = { kind: 'project', projectId: projectId('project-a') };
export const PROJECT_B: TasteScope = { kind: 'project', projectId: projectId('project-b') };
export const OVERALL: RatingTarget = { kind: 'overall' };

export function aspect(id: string): RatingTarget {
  return { kind: 'aspect', aspect: id as AspectId };
}

export function subject(id: string): TasteSubject {
  return { id: subjectId(id), kind: 'version', label: `Synthetic ${id}`, versionId: `${id}-v1` };
}

export function fixedClock(start = Date.UTC(2026, 9, 20)): Clock {
  let tick = 0;
  return { now: () => new Date(start + (tick++) * 1000).toISOString() };
}

export async function openJournal(fs: FakeTasteFileSystem = createFakeTasteFileSystem(), token = 'writer-1', pid = 101) {
  const result = await TasteJournal.open({
    fs, path: JOURNAL, lockPath: LOCK, sha256: nodeSha256, clock: fixedClock(), lockToken: token, pid,
  });
  if (result.status !== 'opened') throw new Error(`Expected open, got ${result.status}`);
  return { fs, journal: result.journal };
}

export async function openService(fs?: FakeTasteFileSystem, sampleThreshold = 3) {
  const opened = await openJournal(fs);
  return { ...opened, service: new TasteService(opened.journal, { sha256: nodeSha256, sampleThreshold }) };
}

let counter = 0;
export function id(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function rate(options: {
  scope: TasteScope; subject: TasteSubject; value: RatingValue; judgment?: Judgment; target?: RatingTarget;
  supersedes?: string | null; event?: string; assessment?: string;
}): TasteCommand {
  return {
    clientEventId: clientEventId(options.event ?? id('evt')),
    event: {
      type: 'assessment.recorded',
      assessmentId: assessmentId(options.assessment ?? id('asm')),
      scope: options.scope,
      subject: options.subject,
      judgment: options.judgment ?? 'liking',
      target: options.target ?? OVERALL,
      value: options.value,
      supersedes: options.supersedes ? assessmentId(options.supersedes) : null,
    },
  };
}

export function importedExample(scope: TasteScope, item: TasteSubject, value: RatingValue): TasteCommand {
  return {
    clientEventId: clientEventId(id('evt')),
    event: {
      type: 'example.imported', exampleId: exampleId(id('ex')), scope, subject: item,
      source: { kind: 'reference-library', label: 'Synthetic gallery' },
      claimed: [{ judgment: 'liking', target: OVERALL, value }],
    },
  };
}

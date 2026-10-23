import {
  assessmentId, clientEventId, exampleId, projectId, subjectId,
  type TasteClientPort, type TasteSubject,
} from '../src/contract.ts';
import { FAKE_FILE_SYSTEM_LABEL, createFakeTasteFileSystem, type FakeTasteFileSystem } from '../src/fake-file-system.ts';
import { TasteJournal } from '../src/journal.ts';
import { TasteService } from '../src/service.ts';
import { webCryptoSha256 } from '../src/web-digest.ts';

/**
 * REVIEW HARNESS ONLY. Runs the real journal and service over the labelled
 * in-memory fake. Synthetic data; nothing is durable or sent anywhere.
 */

export const PREVIEW_PROJECT = projectId('synthetic-project');
export const PREVIEW_SUBJECT: TasteSubject = { id: subjectId('synthetic-landing'), kind: 'version', label: 'Synthetic landing page · v2', versionId: 'synthetic-landing-v2' };

export interface PreviewTaste {
  readonly client: TasteClientPort;
  readonly fs: FakeTasteFileSystem;
  /** Reopens the journal so a torn write on "disk" is detected as fail-closed. */
  readonly reopen: () => Promise<TasteClientPort>;
}

let generation = 0;

async function open(fs: FakeTasteFileSystem): Promise<{ service: TasteService; journal: TasteJournal }> {
  generation += 1;
  const result = await TasteJournal.open({
    fs, path: 'preview/journal.jsonl', lockPath: 'preview/journal.lock', sha256: webCryptoSha256,
    clock: { now: () => new Date().toISOString() }, lockToken: `preview-${generation}`, pid: generation,
  });
  if (result.status !== 'opened') throw new Error('Preview journal is locked');
  const service = new TasteService(result.journal, { sha256: webCryptoSha256, sampleThreshold: 5, label: FAKE_FILE_SYSTEM_LABEL });
  return { service, journal: result.journal };
}

export async function createPreviewTaste(): Promise<PreviewTaste> {
  const fs = createFakeTasteFileSystem();
  let current = await open(fs);
  const service = current.service;
  const other = (id: string, label: string): TasteSubject => ({ id: subjectId(id), kind: 'version', label });
  await service.submit({ clientEventId: clientEventId('seed-1'), event: { type: 'assessment.recorded', assessmentId: assessmentId('seed-a1'), scope: { kind: 'general' }, subject: other('synthetic-dashboard', 'Synthetic dashboard'), judgment: 'liking', target: { kind: 'overall' }, value: 4, supersedes: null } });
  await service.submit({ clientEventId: clientEventId('seed-2'), event: { type: 'assessment.recorded', assessmentId: assessmentId('seed-a2'), scope: { kind: 'project', projectId: PREVIEW_PROJECT }, subject: other('synthetic-pricing', 'Synthetic pricing'), judgment: 'liking', target: { kind: 'overall' }, value: 2, supersedes: null } });
  await service.submit({ clientEventId: clientEventId('seed-3'), event: { type: 'example.imported', exampleId: exampleId('seed-x1'), scope: { kind: 'project', projectId: PREVIEW_PROJECT }, subject: PREVIEW_SUBJECT, source: { kind: 'reference-library', label: 'Synthetic reference gallery' }, claimed: [{ judgment: 'liking', target: { kind: 'overall' }, value: 5 }] } });
  return {
    client: service, fs,
    reopen: async () => {
      await current.journal.close();
      current = await open(fs);
      return current.service;
    },
  };
}

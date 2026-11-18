import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessmentId, clientEventId, counterevidenceId, noteId, projectId, qualifySubjectId, projectVersionSubject, subjectId, type TasteEvent,
} from '../src/contract.ts';
import { Documents, bind, seedJournal } from './document-port.ts';
import { GENERAL, PROJECT_A, PROJECT_B, rate, subject } from './helpers.ts';

const A = projectId('project-a');
const B = projectId('project-b');
// Deterministic capture IDs repeat across projects: the same digest names a version in each.
const SHARED = 'capture-0123456789abcdef';
const OVERALL = { kind: 'overall' } as const;

const rated = (scope: typeof GENERAL | typeof PROJECT_A, id: string, value: 1 | 2 | 3 | 4 | 5, plain = SHARED): TasteEvent => ({
  type: 'assessment.recorded', assessmentId: assessmentId(id), scope, subject: subject(plain), judgment: 'liking', target: OVERALL, value, supersedes: null,
});
const promoted = (project: typeof A, enabled = true): TasteEvent => ({ type: 'project-contribution.set', projectId: project, contributesToGeneral: enabled });

/** A journal an earlier build wrote: every version subject carries the plain version ID. */
async function legacy(documents: Documents) {
  return seedJournal(documents, [
    { id: 'l1', event: rated(PROJECT_A, 'legacy-a', 4) },
    { id: 'l2', event: rated(PROJECT_B, 'legacy-b', 2) },
    { id: 'l3', event: rated(GENERAL, 'legacy-general', 5) },
    { id: 'l4', event: promoted(A) },
    { id: 'l5', event: promoted(B) },
  ]);
}

test('a journal saved before qualification is read without being written or rewritten', async () => {
  const documents = new Documents();
  const stored = await legacy(documents);
  const before = structuredClone(documents.value);
  const client = bind(documents, A);
  const view = await client.snapshot(A);
  assert.equal(view.journal.state, 'open');
  assert.equal(view.journal.state === 'open' ? view.journal.head.seq : -1, 5);
  assert.deepEqual(documents.value, before);
  assert.equal((documents.value as { jsonl: string }).jsonl, stored);
  assert.equal(documents.writes, 0);
  assert.equal(documents.revision, 1);

  // Only this project's entries and the general ones are visible, and the project's own are attributed to it.
  assert.deepEqual(view.assessments.map((item) => [item.assessmentId, item.scope.kind, item.subject.id]), [
    ['legacy-a', 'project', qualifySubjectId(A, SHARED)],
    ['legacy-general', 'general', SHARED],
  ]);
  assert.equal(view.project?.sample.count, 1);
  assert.equal(view.project?.summaries[0]?.mean, 4);
  // The profile counts three subjects: each project's version, and the unattributed general one. One ID, three ratings.
  assert.equal(view.general.sample.count, 3);
  assert.equal(view.general.summaries[0]?.count, 3);
  assert.equal(view.general.summaries[0]?.mean, 3.67);
  assert.equal(documents.writes, 0);
});

test('a project rating saved before qualification is found and re-rated from the same version', async () => {
  const documents = new Documents();
  const stored = await legacy(documents);
  const client = bind(documents, A);
  const version = projectVersionSubject(A, SHARED, 'Landing v2');
  // The slot is occupied by the earlier rating, so a fresh rating is refused and a stale one is too.
  assert.deepEqual(await client.submit(rate({ scope: PROJECT_A, subject: version, value: 3 })), { status: 'rejected', reason: 'already-rated' });
  assert.equal((await client.submit(rate({ scope: PROJECT_A, subject: version, value: 3, supersedes: 'legacy-b' }))).status, 'rejected');
  const result = await client.submit(rate({ scope: PROJECT_A, subject: version, value: 3, supersedes: 'legacy-a', assessment: 'replacement' }));
  assert.equal(result.status, 'appended');
  const view = await client.snapshot(A);
  assert.equal(view.assessments.find((item) => item.assessmentId === 'legacy-a')?.supersededBy, 'replacement');
  assert.equal(view.assessments.find((item) => item.assessmentId === 'replacement')?.subject.id, qualifySubjectId(A, SHARED));
  assert.equal(view.project?.summaries[0]?.mean, 3);
  assert.equal(documents.revision, 2);
  assert.equal((documents.value as { jsonl: string }).jsonl.startsWith(stored), true, 'the earlier bytes stay a prefix of the journal');
});

test('a plain general rating names no project, so it matches no version and is not re-rated by one', async () => {
  const documents = new Documents();
  await legacy(documents);
  const a = bind(documents, A);
  const b = bind(documents, B);
  const forA = projectVersionSubject(A, SHARED, 'Landing v2');
  const forB = projectVersionSubject(B, SHARED, 'Landing v2');
  // Neither project's version sees the plain rating as its own: both rate fresh in general taste.
  assert.equal((await a.submit(rate({ scope: GENERAL, subject: forA, value: 1, assessment: 'a-general' }))).status, 'appended');
  assert.equal((await b.submit(rate({ scope: GENERAL, subject: forB, value: 2, assessment: 'b-general' }))).status, 'appended');
  const view = await b.snapshot(B);
  const bySubject = (id: string) => view.assessments.filter((item) => item.scope.kind === 'general' && item.subject.id === id).map((item) => item.assessmentId);
  assert.deepEqual(bySubject(SHARED), ['legacy-general']);
  assert.deepEqual(bySubject(qualifySubjectId(A, SHARED)), ['a-general']);
  assert.deepEqual(bySubject(qualifySubjectId(B, SHARED)), ['b-general']);
  assert.equal(view.assessments.find((item) => item.assessmentId === 'legacy-general')?.supersededBy, null);
  // The qualified general ratings are the same subjects as each promoted project's earlier rating; the plain one is a third.
  assert.equal(view.general.sample.count, 3);
});

test('two projects reuse one version ID in general taste without merging', async () => {
  const documents = new Documents();
  const a = bind(documents, A);
  const b = bind(documents, B);
  // The caller names the version by its plain ID; the bound client qualifies it with its own project.
  assert.equal((await a.submit(rate({ scope: GENERAL, subject: subject(SHARED), value: 5, assessment: 'a-general' }))).status, 'appended');
  assert.equal((await b.submit(rate({ scope: GENERAL, subject: subject(SHARED), value: 1, assessment: 'b-general' }))).status, 'appended');
  const view = await b.snapshot(B);
  assert.deepEqual(view.assessments.map((item) => [item.assessmentId, item.subject.id]), [
    ['a-general', qualifySubjectId(A, SHARED)],
    ['b-general', qualifySubjectId(B, SHARED)],
  ]);
  assert.equal(view.general.sample.count, 2);
  assert.equal(view.general.summaries[0]?.mean, 3);
  // Re-rating from B's version replaces only B's rating.
  assert.equal((await b.submit(rate({ scope: GENERAL, subject: subject(SHARED), value: 4, supersedes: 'b-general' }))).status, 'appended');
  const after = await a.snapshot(A);
  assert.equal(after.assessments.find((item) => item.assessmentId === 'a-general')?.supersededBy, null);
  assert.equal(after.general.summaries[0]?.mean, 4.5);
});

test('every version subject is stored qualified, and a replay of the same command is a duplicate', async () => {
  const documents = new Documents();
  const client = bind(documents, A);
  const plain = rate({ scope: PROJECT_A, subject: subject(SHARED), value: 4, event: 'event-plain' });
  assert.equal((await client.submit(plain)).status, 'appended');
  const qualified = rate({ scope: GENERAL, subject: projectVersionSubject(A, SHARED, 'Landing v2'), value: 3, event: 'event-qualified' });
  assert.equal((await client.submit(qualified)).status, 'appended');
  const stored = (documents.value as { jsonl: string }).jsonl.trim().split('\n').map((line) => JSON.parse(line) as { payload: { subject: { id: string; versionId?: string } } });
  assert.deepEqual(stored.map((record) => record.payload.subject.id), [qualifySubjectId(A, SHARED), qualifySubjectId(A, SHARED)]);
  assert.equal(stored[0]?.payload.subject.versionId, `${SHARED}-v1`, 'the plain version ID stays in versionId');
  const writes = documents.writes;
  assert.equal((await bind(documents, A).submit(plain)).status, 'duplicate');
  assert.equal((await bind(documents, A).submit(qualified)).status, 'duplicate');
  assert.equal(documents.writes, writes);
});

test('a subject that is not a project version is stored as given', async () => {
  const documents = new Documents();
  const client = bind(documents, A);
  const gallery = { id: subjectId('gallery-item-1'), kind: 'reference' as const, label: 'Synthetic gallery item' };
  assert.equal((await client.submit(rate({ scope: GENERAL, subject: gallery, value: 4 }))).status, 'appended');
  // Gallery items are shared across projects, so every project rates the same slot.
  assert.deepEqual(await bind(documents, B).submit(rate({ scope: GENERAL, subject: gallery, value: 4 })), { status: 'rejected', reason: 'already-rated' });
  const view = await client.snapshot(A);
  assert.deepEqual(view.assessments.map((item) => item.subject.id), ['gallery-item-1']);
});

test('a client refuses a subject that is qualified for another project, and writes nothing', async () => {
  const documents = new Documents();
  const b = bind(documents, B);
  const foreign = projectVersionSubject(A, SHARED, 'Landing v2');
  assert.deepEqual(await b.submit(rate({ scope: GENERAL, subject: foreign, value: 5 })), { status: 'rejected', reason: 'project-mismatch' });
  assert.deepEqual(await b.submit(rate({ scope: PROJECT_B, subject: foreign, value: 5 })), { status: 'rejected', reason: 'project-mismatch' });
  assert.deepEqual(await b.submit({ clientEventId: clientEventId('note-event'), event: {
    type: 'note.added', noteId: noteId('foreign-note'), scope: GENERAL, subjectId: foreign.id, about: null, text: 'Synthetic note' } }),
  { status: 'rejected', reason: 'project-mismatch' });
  assert.deepEqual(await b.submit({ clientEventId: clientEventId('counter-event'), event: {
    type: 'counterevidence.added', counterevidenceId: counterevidenceId('foreign-counter'), scope: GENERAL, judgment: 'liking', target: OVERALL,
    subjectId: foreign.id, contradicts: null, text: 'Synthetic exception' } }), { status: 'rejected', reason: 'project-mismatch' });
  assert.equal(documents.writes, 0);
  // The project's own qualified subject, in a note, is allowed.
  const own = projectVersionSubject(B, SHARED, 'Landing v2');
  assert.equal((await b.submit({ clientEventId: clientEventId('own-note'), event: {
    type: 'note.added', noteId: noteId('own-note'), scope: GENERAL, subjectId: own.id, about: null, text: 'Synthetic note' } })).status, 'appended');
});

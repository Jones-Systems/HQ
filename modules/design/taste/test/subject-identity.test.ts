import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_ID_LENGTH, MAX_QUALIFIED_SUBJECT_ID_LENGTH, clientEventId, isSubjectIdentifier, noteId, parseQualifiedSubjectId, projectId,
  projectVersionSubject, qualifySubjectId, subjectId, type ProjectId, type SubjectId,
} from '../src/contract.ts';
import { TasteInvalidInputError } from '../src/errors.ts';
import { parseTasteEvent, subjectKey } from '../src/events.ts';
import { GENERAL, PROJECT_A, PROJECT_B, aspect, openService, rate, subject } from './helpers.ts';

const A = projectId('project-a');
const B = projectId('project-b');
// Deterministic capture IDs repeat across projects: the same digest names a version in each.
const SHARED = 'capture-0123456789abcdef';

const contribution = (project: ProjectId, enabled: boolean) => ({
  clientEventId: clientEventId(`promote-${project}-${enabled}`),
  event: { type: 'project-contribution.set' as const, projectId: project, contributesToGeneral: enabled },
});

describe('project-qualified subject IDs', () => {
  it('round-trips and never lets two different (project, version) pairs share an ID', () => {
    const id = qualifySubjectId(A, SHARED);
    assert.equal(id, `pv1:9:project-a${SHARED}`);
    assert.deepEqual(parseQualifiedSubjectId(id), { projectId: A, localId: SHARED });
    assert.notEqual(qualifySubjectId(A, SHARED), qualifySubjectId(B, SHARED));
    assert.notEqual(qualifySubjectId('a', 'bc'), qualifySubjectId('ab', 'c'));
    assert.deepEqual(parseQualifiedSubjectId(qualifySubjectId('ab', 'c')), { projectId: 'ab', localId: 'c' });
    assert.deepEqual(parseQualifiedSubjectId(qualifySubjectId('é-1', '日本')), { projectId: 'é-1', localId: '日本' });
  });

  it('accepts the longest valid pair and refuses anything unbounded or not an identifier', () => {
    const longest = qualifySubjectId('p'.repeat(MAX_ID_LENGTH), 'v'.repeat(MAX_ID_LENGTH));
    assert.equal(longest.length, MAX_QUALIFIED_SUBJECT_ID_LENGTH);
    assert.equal(isSubjectIdentifier(longest), true);
    assert.equal(subjectId(longest), longest);
    assert.equal(parseTasteEvent(rate({ scope: GENERAL, subject: { ...subject('x'), id: longest }, value: 3 }).event) !== null, true);
    for (const [project, version] of [['p'.repeat(MAX_ID_LENGTH + 1), 'v'], ['p', 'v'.repeat(MAX_ID_LENGTH + 1)], ['', 'v'], ['p', ''], [' p', 'v'], ['p', 'v\n']]) {
      assert.throws(() => qualifySubjectId(project, version), TasteInvalidInputError);
    }
    assert.equal(isSubjectIdentifier('x'.repeat(MAX_QUALIFIED_SUBJECT_ID_LENGTH + 1)), false);
    assert.equal(isSubjectIdentifier('x'.repeat(MAX_ID_LENGTH + 1)), false, 'only well-formed qualified IDs may exceed the plain limit');
    assert.throws(() => subjectId('x'.repeat(MAX_ID_LENGTH + 1)), TasteInvalidInputError);
    assert.throws(() => projectId(' '), TasteInvalidInputError);
    assert.throws(() => projectId(' '), TypeError, 'still a TypeError for existing handlers');
  });

  it('does not read a malformed qualified string as a project and version', () => {
    for (const value of ['pv1:', 'pv1:0:ab', 'pv1:3:ab', 'pv1:2:ab', 'pv1:02:abc', 'pv1:2:ab\u0000c', 'pv1:1: x', 'pv1:9999:a', SHARED, '', 42, null]) {
      assert.equal(parseQualifiedSubjectId(value), null, String(value));
    }
  });

  it('is accepted wherever a subject ID is stored: assessments, examples, notes and counterevidence', () => {
    const id = qualifySubjectId('p'.repeat(MAX_ID_LENGTH), SHARED);
    assert.equal(id.length > MAX_ID_LENGTH, true);
    const subjectOf = { ...subject('x'), id };
    assert.notEqual(parseTasteEvent(rate({ scope: GENERAL, subject: subjectOf, value: 3 }).event), null);
    assert.notEqual(parseTasteEvent({ type: 'note.added', noteId: noteId('n'), scope: GENERAL, subjectId: id, about: null, text: 'Synthetic' }), null);
    assert.notEqual(parseTasteEvent({ type: 'counterevidence.added', counterevidenceId: 'c', scope: GENERAL, judgment: 'liking',
      target: { kind: 'overall' }, subjectId: id, contradicts: null, text: 'Synthetic' }), null);
    assert.equal(parseTasteEvent(rate({ scope: GENERAL, subject: { ...subject('x'), id: 'x'.repeat(MAX_ID_LENGTH + 1) as SubjectId }, value: 3 }).event), null);
  });

  it('builds the subject for a saved version without touching the plain version ID', () => {
    assert.deepEqual(projectVersionSubject(A, SHARED, 'Landing v2'),
      { id: qualifySubjectId(A, SHARED), kind: 'version', label: 'Landing v2', versionId: SHARED });
  });
});

describe('subject identity inside a scope', () => {
  const version = { id: subjectId(SHARED), kind: 'version' as const };
  it('qualifies a plain version only where the project is known', () => {
    assert.equal(subjectKey(PROJECT_A, version), qualifySubjectId(A, SHARED));
    assert.equal(subjectKey(PROJECT_B, version), qualifySubjectId(B, SHARED));
    assert.equal(subjectKey(GENERAL, version), SHARED, 'a plain general-scope ID names no project');
    assert.equal(subjectKey(GENERAL, { id: qualifySubjectId(A, SHARED), kind: 'version' }), qualifySubjectId(A, SHARED));
    assert.equal(subjectKey(PROJECT_B, { id: qualifySubjectId(A, SHARED), kind: 'version' }), qualifySubjectId(A, SHARED));
  });

  it('leaves subjects that are shared across projects alone', () => {
    for (const kind of ['reference', 'component', 'flow', 'other'] as const) {
      assert.equal(subjectKey(PROJECT_A, { id: subjectId('shared-item'), kind }), 'shared-item');
    }
  });
});

describe('ratings of a version ID that two projects reuse', () => {
  it('keeps one rating slot per project in general taste', async () => {
    const { service } = await openService();
    const a = projectVersionSubject(A, SHARED, 'Landing v2');
    const b = projectVersionSubject(B, SHARED, 'Landing v2');
    const first = await service.submit(rate({ scope: GENERAL, subject: a, value: 5, assessment: 'a-general' }));
    assert.equal(first.status, 'appended');
    // Before qualification this was refused as "already rated" because both versions had one ID.
    assert.equal((await service.submit(rate({ scope: GENERAL, subject: b, value: 1, assessment: 'b-general' }))).status, 'appended');
    assert.deepEqual(await service.submit(rate({ scope: GENERAL, subject: a, value: 2 })), { status: 'rejected', reason: 'already-rated' });
    assert.deepEqual(await service.submit(rate({ scope: GENERAL, subject: b, value: 3, supersedes: 'a-general' })),
      { status: 'rejected', reason: 'stale-supersede' }, "one project's rating cannot be replaced from the other's version");
    assert.equal((await service.submit(rate({ scope: GENERAL, subject: b, value: 3, supersedes: 'b-general' }))).status, 'appended');

    const snapshot = await service.snapshot(null);
    assert.equal(snapshot.general.sample.count, 2);
    const overall = snapshot.general.summaries.find((item) => item.judgment === 'liking' && item.target.kind === 'overall');
    assert.deepEqual([overall?.count, overall?.mean, overall?.superseded], [2, 4, 1]);
    assert.equal(snapshot.assessments.find((item) => item.assessmentId === 'a-general')?.supersededBy, null);
  });

  it('counts the same version ID in two promoted projects as two subjects', async () => {
    const { service } = await openService();
    await service.submit(contribution(A, true));
    await service.submit(contribution(B, true));
    // Journals written before qualification hold the plain ID in project scope.
    await service.submit(rate({ scope: PROJECT_A, subject: subject(SHARED), value: 4 }));
    await service.submit(rate({ scope: PROJECT_B, subject: subject(SHARED), value: 2 }));
    const snapshot = await service.snapshot(null);
    assert.equal(snapshot.general.sample.count, 2);
    assert.deepEqual(snapshot.general.sample.label, 'Limited sample: 2 rated subjects, fewer than 3');
  });

  it('counts a version once when it is rated in both its project scope and general scope', async () => {
    const { service } = await openService();
    await service.submit(contribution(A, true));
    const a = projectVersionSubject(A, SHARED, 'Landing v2');
    await service.submit(rate({ scope: PROJECT_A, subject: a, value: 4 }));
    await service.submit(rate({ scope: GENERAL, subject: a, value: 5 }));
    await service.submit(rate({ scope: PROJECT_A, subject: subject(SHARED), judgment: 'descriptive', target: aspect('color'), value: 3 }));
    assert.equal((await service.snapshot(null)).general.sample.count, 1);
  });
});

describe('journals written before version subjects were qualified', () => {
  it('keeps a plain general-scope rating as its own unattributed subject', async () => {
    const { service } = await openService();
    const a = projectVersionSubject(A, SHARED, 'Landing v2');
    assert.equal((await service.submit(rate({ scope: GENERAL, subject: subject(SHARED), value: 5, assessment: 'legacy' }))).status, 'appended');
    // The plain rating is not this project's rating, so a new qualified rating is not a re-rating of it.
    assert.equal((await service.submit(rate({ scope: GENERAL, subject: a, value: 2, assessment: 'qualified' }))).status, 'appended');
    assert.equal((await service.snapshot(null)).general.sample.count, 2);
    // It stays rateable under its own ID: a re-rating of the plain ID supersedes the plain rating only.
    assert.equal((await service.submit(rate({ scope: GENERAL, subject: subject(SHARED), value: 4, supersedes: 'legacy' }))).status, 'appended');
    const after = await service.snapshot(null);
    assert.equal(after.assessments.find((item) => item.assessmentId === 'legacy')?.supersededBy !== null, true);
    assert.equal(after.assessments.find((item) => item.assessmentId === 'qualified')?.supersededBy, null);
  });

  it('keeps a plain project-scope rating attributed to its project, so it can still be re-rated', async () => {
    const { service } = await openService();
    const a = projectVersionSubject(A, SHARED, 'Landing v2');
    await service.submit(rate({ scope: PROJECT_A, subject: subject(SHARED), value: 2, assessment: 'legacy-a' }));
    assert.deepEqual(await service.submit(rate({ scope: PROJECT_A, subject: a, value: 4 })), { status: 'rejected', reason: 'already-rated' });
    assert.equal((await service.submit(rate({ scope: PROJECT_A, subject: a, value: 4, supersedes: 'legacy-a' }))).status, 'appended');
    // The other project's version with the same ID was never rated.
    assert.equal((await service.submit(rate({ scope: PROJECT_B, subject: projectVersionSubject(B, SHARED, 'Landing v2'), value: 1 }))).status, 'appended');
  });
});

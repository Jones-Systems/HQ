import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessmentId, clientEventId, counterevidenceId, noteId, projectId, type TasteProfile } from '../src/contract.ts';
import { nodeSha256 } from '../src/node-file-system.ts';
import { parseTasteEvent } from '../src/events.ts';
import { GENERAL, OVERALL, PROJECT_A, PROJECT_B, aspect, id, importedExample, openService, rate, subject } from './helpers.ts';

function overallLiking(profile: TasteProfile | null) {
  return profile?.summaries.find((item) => item.judgment === 'liking' && item.target.kind === 'overall') ?? null;
}

function contribute(project: string, value: boolean) {
  return { clientEventId: clientEventId(id('contrib')), event: { type: 'project-contribution.set' as const, projectId: projectId(project), contributesToGeneral: value } };
}

describe('general and project scopes', () => {
  it('project ratings never feed the general profile until the owner opts the project in', async () => {
    const { service, journal } = await openService();
    await service.submit(rate({ scope: GENERAL, subject: subject('g1'), value: 2 }));
    await service.submit(rate({ scope: PROJECT_A, subject: subject('p1'), value: 5 }));
    await service.submit(rate({ scope: PROJECT_A, subject: subject('p2'), value: 5 }));
    await service.submit(rate({ scope: PROJECT_B, subject: subject('p3'), value: 1 }));

    let snapshot = await service.snapshot(projectId('project-a'));
    assert.equal(overallLiking(snapshot.general)?.count, 1);
    assert.equal(overallLiking(snapshot.general)?.mean, 2);
    assert.deepEqual(snapshot.general.scope, { kind: 'general', includedProjects: [] });
    assert.equal(overallLiking(snapshot.project)?.count, 2, 'project profile reads only its project');
    assert.equal(overallLiking(snapshot.project)?.mean, 5);

    assert.equal((await service.submit(contribute('project-a', true))).status, 'appended');
    snapshot = await service.snapshot(null);
    assert.equal(overallLiking(snapshot.general)?.count, 3, 'opted-in project A joins; project B stays out');
    assert.deepEqual(snapshot.general.scope, { kind: 'general', includedProjects: ['project-a'] });

    await service.submit(contribute('project-a', false));
    snapshot = await service.snapshot(null);
    assert.equal(overallLiking(snapshot.general)?.count, 1, 'opting out removes the project again');
    await journal.close();
  });
});

describe('liking versus descriptive judgments', () => {
  it('keeps separate summaries and rejects an overall descriptive rating', async () => {
    const { service, journal } = await openService();
    await service.submit(rate({ scope: GENERAL, subject: subject('a'), value: 5, judgment: 'liking', target: aspect('density') }));
    await service.submit(rate({ scope: GENERAL, subject: subject('a'), value: 1, judgment: 'descriptive', target: aspect('density') }));
    const { general } = await service.snapshot(null);
    const liking = general.summaries.find((item) => item.judgment === 'liking' && item.target.kind === 'aspect');
    const descriptive = general.summaries.find((item) => item.judgment === 'descriptive');
    assert.equal(liking?.mean, 5);
    assert.equal(descriptive?.mean, 1);

    const invalid = rate({ scope: GENERAL, subject: subject('a'), value: 3, judgment: 'descriptive', target: OVERALL });
    assert.equal(parseTasteEvent(invalid.event), null);
    assert.deepEqual(await service.submit(invalid), { status: 'rejected', reason: 'invalid-command' });
    await journal.close();
  });
});

describe('re-rating', () => {
  it('supersedes the current value and keeps history', async () => {
    const { service, journal } = await openService();
    const a = subject('a');
    await service.submit(rate({ scope: GENERAL, subject: a, value: 2, assessment: 'first' }));
    assert.deepEqual(await service.submit(rate({ scope: GENERAL, subject: a, value: 4 })), { status: 'rejected', reason: 'already-rated' });
    assert.equal((await service.submit(rate({ scope: GENERAL, subject: a, value: 4, supersedes: 'first', assessment: 'second' }))).status, 'appended');
    assert.deepEqual(await service.submit(rate({ scope: GENERAL, subject: a, value: 5, supersedes: 'first' })), { status: 'rejected', reason: 'stale-supersede' });

    const snapshot = await service.snapshot(null);
    const summary = overallLiking(snapshot.general)!;
    assert.equal(summary.count, 1);
    assert.equal(summary.mean, 4);
    assert.equal(summary.superseded, 1);
    assert.deepEqual(snapshot.assessments.map((item) => [item.assessmentId, item.value, item.supersededBy]), [['first', 2, 'second'], ['second', 4, null]]);
    await journal.close();
  });

  it('a replayed rating stays a no-op even though its supersede is now stale', async () => {
    const { service, journal } = await openService();
    const a = subject('a');
    await service.submit(rate({ scope: GENERAL, subject: a, value: 2, assessment: 'first' }));
    const rerate = rate({ scope: GENERAL, subject: a, value: 4, supersedes: 'first', assessment: 'second' });
    assert.equal((await service.submit(rerate)).status, 'appended');
    assert.equal((await service.submit(rerate)).status, 'duplicate');
    await journal.close();
  });

  it('the same rating slot in different scopes is independent', async () => {
    const { service, journal } = await openService();
    const a = subject('a');
    assert.equal((await service.submit(rate({ scope: GENERAL, subject: a, value: 2 }))).status, 'appended');
    assert.equal((await service.submit(rate({ scope: PROJECT_A, subject: a, value: 5 }))).status, 'appended');
    await journal.close();
  });
});

describe('sample-limit labels', () => {
  it('labels a profile built from fewer than N ratings and clears the label at N', async () => {
    const { service, journal } = await openService(undefined, 3);
    await service.submit(rate({ scope: GENERAL, subject: subject('a'), value: 4 }));
    await service.submit(rate({ scope: GENERAL, subject: subject('b'), value: 5 }));
    let { general } = await service.snapshot(null);
    assert.deepEqual(general.sample, { limited: true, count: 2, threshold: 3, label: 'Limited sample: 2 rated subjects, fewer than 3' });
    assert.equal(overallLiking(general)?.sample.label, 'Limited sample: 2 ratings, fewer than 3');

    await service.submit(rate({ scope: GENERAL, subject: subject('c'), value: 3 }));
    ({ general } = await service.snapshot(null));
    assert.equal(general.sample.limited, false);
    assert.equal(general.sample.label, null);
    assert.equal(overallLiking(general)?.sample.label, null);
    await journal.close();
  });

  it('an empty profile is labelled limited', async () => {
    const { service, journal } = await openService(undefined, 5);
    const { general } = await service.snapshot(null);
    assert.equal(general.sample.label, 'Limited sample: 0 rated subjects, fewer than 5');
    await journal.close();
  });
});

describe('imported examples', () => {
  it('never count as owner judgments', async () => {
    const { service, journal } = await openService(undefined, 2);
    await service.submit(importedExample(GENERAL, subject('ex1'), 5));
    await service.submit(importedExample(GENERAL, subject('ex2'), 1));
    await service.submit(importedExample(GENERAL, subject('ex3'), 5));
    const snapshot = await service.snapshot(null);
    assert.equal(snapshot.general.summaries.length, 0, 'no rating statistics from examples');
    assert.equal(snapshot.general.sample.count, 0);
    assert.equal(snapshot.general.sample.limited, true);
    assert.deepEqual(snapshot.general.importedExamples, { count: 3, ownerJudgment: false });
    assert.equal(snapshot.assessments.length, 0);
    assert.equal(snapshot.examples.length, 3);

    await service.submit(rate({ scope: GENERAL, subject: subject('ex1'), value: 2 }));
    const after = await service.snapshot(null);
    assert.equal(overallLiking(after.general)?.count, 1);
    assert.equal(overallLiking(after.general)?.mean, 2, 'only the owner rating counts');
    await journal.close();
  });
});

describe('notes, counterevidence and export', () => {
  it('records notes and counterevidence and exports only what was chosen', async () => {
    const { service, journal } = await openService();
    await service.submit(rate({ scope: GENERAL, subject: subject('a'), value: 5, assessment: 'liked' }));
    await service.submit({ clientEventId: clientEventId('note-1'), event: { type: 'note.added', noteId: noteId('n1'), scope: GENERAL, subjectId: null, about: null, text: 'Private synthetic note' } });
    await service.submit({
      clientEventId: clientEventId('counter-1'),
      event: { type: 'counterevidence.added', counterevidenceId: counterevidenceId('c1'), scope: GENERAL, judgment: 'liking', target: OVERALL, subjectId: null, contradicts: assessmentId('liked'), text: 'Disliked a similar layout later' },
    });
    assert.deepEqual(await service.submit({
      clientEventId: clientEventId('counter-2'),
      event: { type: 'counterevidence.added', counterevidenceId: counterevidenceId('c2'), scope: GENERAL, judgment: 'liking', target: OVERALL, subjectId: null, contradicts: assessmentId('missing'), text: 'x' },
    }), { status: 'rejected', reason: 'unknown-assessment' });

    const { general } = await service.snapshot(null);
    assert.equal(overallLiking(general)?.counterevidence, 1);
    assert.equal(general.notes.length, 2);

    const minimal = await service.exportProfile({ scope: GENERAL, includeNotes: false, includeCounterevidence: false });
    assert.deepEqual(minimal.omitted, ['assessment-history', 'imported-example-content', 'journal', 'notes', 'counterevidence']);
    assert.ok(!minimal.json.includes('Private synthetic note'));
    assert.ok(!minimal.json.includes('Disliked a similar layout'));
    assert.equal(minimal.digest, await nodeSha256(new TextEncoder().encode(minimal.json)));
    const parsed = JSON.parse(minimal.json);
    assert.equal(parsed.schema, 'hq.design.taste-profile-export/v1');
    assert.equal(parsed.profile.claimLevel, 'owner-judged');

    const full = await service.exportProfile({ scope: GENERAL, includeNotes: true, includeCounterevidence: true });
    assert.ok(full.json.includes('Private synthetic note'));
    assert.ok(full.json.includes('Disliked a similar layout'));
    await assert.rejects(service.exportProfile({ scope: GENERAL, includeNotes: 'yes' } as never), TypeError);
    await journal.close();
  });
});

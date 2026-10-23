import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_ASPECTS, contributionCommand, describeResult, describeUnknown, noteCommand, ratingCommand, ratingSlots, scopeFor,
} from '../src/ui/view-model.ts';
import { GENERAL, PROJECT_A, openService, subject } from './helpers.ts';

function sequentialIds() {
  let next = 0;
  return () => `id-${(next += 1)}`;
}

describe('taste panel view-model', () => {
  it('builds liking overall+aspects and descriptive aspects only', async () => {
    const { service, journal } = await openService();
    const slots = ratingSlots(await service.snapshot(null), GENERAL, subject('a'), DEFAULT_ASPECTS);
    assert.equal(slots.liking.length, DEFAULT_ASPECTS.length + 1);
    assert.equal(slots.liking[0].target.kind, 'overall');
    assert.ok(slots.descriptive.every((slot) => slot.target.kind === 'aspect' && slot.judgment === 'descriptive'));
    await journal.close();
  });

  it('a re-rating click supersedes the current value; the same value is a no-op', async () => {
    const { service, journal } = await openService();
    const newId = sequentialIds();
    const a = subject('a');
    let slot = ratingSlots(await service.snapshot(null), GENERAL, a, DEFAULT_ASPECTS).liking[0];
    const first = ratingCommand(GENERAL, a, slot, 3, newId)!;
    assert.equal(first.event.type === 'assessment.recorded' && first.event.supersedes, null);
    assert.equal(describeResult(await service.submit(first)).kind, 'saved');

    slot = ratingSlots(await service.snapshot(null), GENERAL, a, DEFAULT_ASPECTS).liking[0];
    assert.equal(slot.current?.value, 3);
    assert.equal(ratingCommand(GENERAL, a, slot, 3, newId), null);
    const second = ratingCommand(GENERAL, a, slot, 5, newId)!;
    assert.equal(second.event.type === 'assessment.recorded' && second.event.supersedes, slot.current?.assessmentId);
    await service.submit(second);

    slot = ratingSlots(await service.snapshot(null), GENERAL, a, DEFAULT_ASPECTS).liking[0];
    assert.equal(slot.current?.value, 5);
    assert.deepEqual(slot.history.map((item) => item.value), [3]);
    await journal.close();
  });

  it('an unknown outcome retries the identical command, which cannot duplicate', async () => {
    const { service, journal } = await openService();
    const a = subject('a');
    const slot = ratingSlots(await service.snapshot(null), GENERAL, a, DEFAULT_ASPECTS).liking[0];
    const command = ratingCommand(GENERAL, a, slot, 4, sequentialIds())!;
    await service.submit(command); // reached the journal, but the response was "lost"
    const outcome = describeUnknown(command);
    assert.equal(outcome.kind, 'unknown');
    if (outcome.kind !== 'unknown') return;
    assert.equal(outcome.retry, command);
    assert.equal(describeResult(await service.submit(outcome.retry)).kind, 'already-saved');
    assert.equal((await service.snapshot(null)).assessments.length, 1);
    await journal.close();
  });

  it('project scope needs a project and contribution is an explicit command', () => {
    assert.equal(scopeFor('project', null), null);
    assert.deepEqual(scopeFor('project', PROJECT_A.kind === 'project' ? PROJECT_A.projectId : null), PROJECT_A);
    const command = contributionCommand('project-a', true, sequentialIds());
    assert.deepEqual(command.event, { type: 'project-contribution.set', projectId: 'project-a', contributesToGeneral: true });
    assert.equal(noteCommand(GENERAL, subject('a'), '   ', sequentialIds()), null);
  });

  it('every append result has a plain-language outcome', () => {
    assert.equal(describeResult({ status: 'fail-closed', reason: 'partial-write' }).kind, 'refused');
    assert.match(describeResult({ status: 'rejected', reason: 'stale-supersede' }).message, /changed elsewhere/u);
  });
});

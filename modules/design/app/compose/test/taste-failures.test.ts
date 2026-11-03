import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProfileExport, ProjectId, TasteClientPort, TasteCommand, TasteSnapshot } from '../../../taste/src/contract.ts';
import {
  TasteConflictError, TasteInvalidInputError, TasteJournalFaultError, TasteProjectBindingError, TasteReadOnlyError, TasteUnavailableError,
} from '../../../taste/src/project-service.ts';
import { DesignBridgeConflictError, DesignBridgeError } from '../bridge-documents.ts';
import type { DesignFeedback } from '../errors.ts';
import { TASTE_OPERATIONS, reportTasteFailures, type TasteOperation } from '../taste-failures.ts';

const snapshot = { journal: { state: 'closed' } } as unknown as TasteSnapshot;
const exported: ProfileExport = { json: '{}', digest: 'a'.repeat(64), omitted: [] };
const command = { clientEventId: 'event-1', event: { type: 'project-contribution.set', projectId: 'project-a', contributesToGeneral: true } } as unknown as TasteCommand;
const options = { scope: { kind: 'general' }, includeNotes: false, includeCounterevidence: false } as const;
const PROJECT = 'project-a' as ProjectId;

type Reported = readonly [TasteOperation, DesignFeedback | null];

function harness(fail?: (operation: 'snapshot' | 'submit' | 'exportProfile') => unknown) {
  const reports: Reported[] = [];
  const throwing = (operation: 'snapshot' | 'submit' | 'exportProfile') => { const error = fail?.(operation); if (error !== undefined) throw error; };
  const client: TasteClientPort = {
    label: 'Synthetic client',
    async snapshot() { throwing('snapshot'); return snapshot; },
    async submit() { throwing('submit'); return { status: 'appended' } as never; },
    async exportProfile() { throwing('exportProfile'); return exported; },
  };
  return { reports, wrapped: reportTasteFailures(client, (operation, feedback) => reports.push([operation, feedback])) };
}

describe('Taste operation names', () => {
  it('are stable and carry one short plain action each', () => {
    assert.deepEqual(Object.values(TASTE_OPERATIONS).map(({ section, operation, action }) => [section, operation, action]), [
      ['taste', 'taste.load', 'load your taste ratings'],
      ['taste', 'taste.save', 'save to your taste journal'],
      ['taste', 'taste.export', 'export your taste profile'],
    ]);
    assert.deepEqual(Object.values(TASTE_OPERATIONS).map((context) => 'write' in context && context.write === true), [false, true, false]);
  });
});

describe('reportTasteFailures', () => {
  it('passes results through unchanged and reports each success so its notice can clear', async () => {
    const { wrapped, reports } = harness();
    assert.equal(wrapped.label, 'Synthetic client');
    assert.equal(await wrapped.snapshot(PROJECT), snapshot);
    assert.deepEqual(await wrapped.submit(command), { status: 'appended' });
    assert.equal(await wrapped.exportProfile(options), exported);
    assert.deepEqual(reports, [['load', null], ['save', null], ['export', null]]);
    assert.ok(Object.isFrozen(wrapped));
  });

  it('reports a typed failure for the operation that failed and rethrows the same error', async () => {
    const cases: readonly [() => unknown, string, string | undefined, string][] = [
      [() => new TasteConflictError(), 'conflict', undefined, 'Reload'],
      [() => new TasteUnavailableError(), 'unavailable', undefined, 'Retry'],
      [() => new TasteProjectBindingError(), 'stale', 'project-binding', 'Choose again'],
      [() => new TasteInvalidInputError('Invalid export options'), 'invalid', undefined, ''],
      [() => new TasteReadOnlyError('unsupported-stored-schema'), 'read-only', 'unsupported-stored-schema', ''],
      [() => new TasteJournalFaultError('incomplete-tail'), 'corrupt', 'incomplete-tail', ''],
      [() => new DesignBridgeConflictError(), 'conflict', undefined, 'Reload'],
      [() => new DesignBridgeError('invalid'), 'invalid', undefined, ''],
    ];
    for (const [build, kind, reason, action] of cases) {
      for (const [call, operation, route] of [
        [(client: TasteClientPort) => client.snapshot(PROJECT), 'load', 'snapshot'], [(client: TasteClientPort) => client.submit(command), 'save', 'submit'],
        [(client: TasteClientPort) => client.exportProfile(options), 'export', 'exportProfile'],
      ] as const) {
        const error = build();
        const { wrapped, reports } = harness((failed) => (failed === route ? error : undefined));
        await assert.rejects(call(wrapped), (thrown: unknown) => thrown === error);
        const [[reported, feedback]] = reports as [Reported];
        assert.equal(reported, operation);
        assert.equal(feedback?.meta, reason === undefined ? `taste.${operation}` : `taste.${operation} · ${reason}`);
        assert.equal(feedback?.action?.label ?? '', action, `${kind} action`);
        assert.equal(feedback?.title, `Couldn't ${TASTE_OPERATIONS[operation].action}`);
        assert.equal(feedback?.inline, 'failed');
      }
    }
  });

  it('treats an unrecognised save failure as unconfirmed, and an unrecognised read failure as unavailable', async () => {
    const lost = harness(() => new Error('socket hang up'));
    await assert.rejects(lost.wrapped.submit(command));
    const [, saved] = lost.reports[0]!;
    assert.deepEqual([saved?.tone, saved?.inline, saved?.action?.label, saved?.persistent], ['unknown', 'unknown', 'Check', true]);
    assert.equal(saved?.title, 'Save to your taste journal: result not confirmed');

    const unread = harness(() => new Error('socket hang up'));
    await assert.rejects(unread.wrapped.snapshot(PROJECT));
    const [, loaded] = unread.reports[0]!;
    assert.deepEqual([loaded?.tone, loaded?.inline, loaded?.action?.label], ['danger', 'failed', 'Retry']);
  });

  it('reports the failure and then the recovery in order, so a later success clears only its own operation', async () => {
    let failing = true;
    const { wrapped, reports } = harness(() => (failing ? new TasteConflictError() : undefined));
    await assert.rejects(wrapped.submit(command));
    await assert.rejects(wrapped.snapshot(PROJECT));
    failing = false;
    await wrapped.snapshot(PROJECT);
    await wrapped.submit(command);
    assert.deepEqual(reports.map(([operation, feedback]) => [operation, feedback === null ? 'cleared' : feedback.meta]), [
      ['save', 'taste.save'], ['load', 'taste.load'], ['load', 'cleared'], ['save', 'cleared'],
    ]);
  });
});

// View state for the Choose → Review → Done flow. Everything here is about what the surface shows and says; what the
// importer plans, writes and undoes is covered by importer.test.ts and controller.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StorageConflictError } from '../src/contract.ts';
import {
  createImportsController, deriveStep, describeItemCount, describeLanded, formatExactTime, formatRelativeTime, summarizePlan,
  type ImportsOutcome, type ImportsState,
} from '../src/controller.ts';
import { editImportedRecord, listRecords, planImport } from '../src/importer.ts';
import { items, PROJECT, setup, source } from './fixtures.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const twoScreens = () => {
  const [home] = items(0);
  return source(0, { items: [home!, { ...home!, key: 'screens/settings.png', title: 'Settings', provenance: { originalName: 'settings.png' } }] });
};

function track(controller: ReturnType<typeof createImportsController>) {
  const outcomes: ImportsOutcome[] = [];
  const busy: string[] = [];
  controller.onOutcome((outcome) => outcomes.push(outcome));
  controller.subscribe(() => {
    const state = controller.getState();
    if (state.status === 'busy') busy.push(`${state.busyAction}${state.busyId === null ? '' : `:${state.busyId}`}`);
  });
  return { outcomes, busy };
}

test('deriveStep: Choose with no plan, Review with a plan, Done once applied', () => {
  const plan = { headline: '', detail: '', rows: [], canApply: true };
  const applied = { importId: 'imp' as never, importedAt: '', counts: { items: 0, created: 0, updated: 0, unchanged: 0, conflicts: 0 }, rows: [] };
  assert.equal(deriveStep({ summary: null, applied: null }), 'choose');
  assert.equal(deriveStep({ summary: plan, applied: null }), 'review');
  assert.equal(deriveStep({ summary: plan, applied }), 'done');
  assert.equal(deriveStep({ summary: null, applied }), 'done', 'a receipt wins even if the summary was cleared');
});

test('formatRelativeTime: just now, minutes, hours, yesterday, days, then a date', () => {
  assert.equal(formatRelativeTime(ago(0), NOW), 'Just now');
  assert.equal(formatRelativeTime(ago(44_000), NOW), 'Just now');
  assert.equal(formatRelativeTime(ago(60_000), NOW), '1 min ago');
  assert.equal(formatRelativeTime(ago(59 * MINUTE), NOW), '59 min ago');
  assert.equal(formatRelativeTime(ago(60 * MINUTE), NOW), '1 h ago');
  assert.equal(formatRelativeTime(ago(23 * HOUR), NOW), '23 h ago');
  assert.equal(formatRelativeTime(ago(24 * HOUR), NOW), 'Yesterday');
  assert.equal(formatRelativeTime(ago(3 * 24 * HOUR), NOW), '3 days ago');
  assert.equal(formatRelativeTime(ago(7 * 24 * HOUR), NOW), '13 Oct');
  assert.equal(formatRelativeTime('2025-03-02T09:00:00.000Z', NOW), '2 Mar 2025', 'a different year says the year');
  assert.equal(formatRelativeTime(new Date(NOW + 5 * MINUTE).toISOString(), NOW), 'Just now', 'a clock skewed ahead reads as now');
  assert.equal(formatRelativeTime('not a date', NOW), 'not a date', 'an unparseable time is shown as given, never as NaN');
});

test('formatExactTime is zone- and locale-independent', () => {
  assert.equal(formatExactTime('2026-10-20T12:00:00.000Z'), '20 Oct 2026, 12:00 UTC');
  assert.equal(formatExactTime('2026-01-05T04:07:00+02:00'), '5 Jan 2026, 02:07 UTC');
  assert.equal(formatExactTime('garbage'), 'garbage');
});

test('item counts name screens when every landed item is a PNG', () => {
  assert.equal(describeItemCount(2, ['screens/a.png', 'screens/B.PNG']), '2 screens');
  assert.equal(describeItemCount(1, ['screens/a.png']), '1 screen');
  assert.equal(describeItemCount(2, ['screens/a.png', 'flows/a.webm']), '2 items');
  assert.equal(describeItemCount(0, []), '0 items');
  assert.equal(describeLanded({ items: 4, created: 2, updated: 0, unchanged: 1, conflicts: 1 }), '2 new · 1 unchanged · 1 conflict');
  assert.equal(describeLanded({ items: 0, created: 0, updated: 0, unchanged: 0, conflicts: 0 }), 'Nothing changed');
});

test('plan rows carry a kind, and a rejection lists its problems as rejected rows', async () => {
  const { deps } = setup();
  const planned = await planImport(deps, { projectId: PROJECT, source: source(0) });
  assert.deepEqual(summarizePlan(planned).rows.map((row) => row.kind), ['new', 'new', 'new', 'new']);
  const rejected = summarizePlan(await planImport(deps, { projectId: PROJECT, source: source(0, { version: 7 }) }));
  assert.equal(rejected.canApply, false);
  assert.ok(rejected.rows.length > 0 && rejected.rows.every((row) => row.kind === 'rejected' && row.tone === 'critical'));
});

test('flow: Choose → Review → Done, with the busy target and one success outcome carrying Undo', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => twoScreens() });
  const { outcomes, busy } = track(controller);
  assert.equal(deriveStep(controller.getState()), 'choose');
  await controller.choose();
  assert.equal(deriveStep(controller.getState()), 'review');
  assert.equal(controller.getState().applied, null);
  await controller.apply();
  const state = controller.getState();
  assert.equal(deriveStep(state), 'done');
  assert.equal(state.status, 'applied');
  assert.equal(state.busyAction, null);
  assert.equal(state.applied?.counts.created, 2);
  assert.deepEqual(state.applied?.rows.map((row) => row.kind), ['new', 'new']);
  const importId = state.history[0]!.importId;
  assert.equal(state.applied?.importId, importId);
  assert.deepEqual(busy.filter((entry, index) => entry !== busy[index - 1]), ['choose', `apply:${importId}`]);
  const success = outcomes.filter((outcome) => outcome.tone === 'success');
  assert.equal(success.length, 1);
  assert.equal(success[0]!.title, 'Imported 2 screens');
  assert.equal(success[0]!.detail, '2 new');
  assert.equal(success[0]!.undoable, true);
  assert.equal(success[0]!.importId, importId);
  assert.equal(state.outcome, success[0], 'the latest outcome is also the state');
});

test('flow: reset refuses while an action is running', async () => {
  const { deps } = setup();
  let release: (picked: ReturnType<typeof source>) => void = () => {};
  const controller = createImportsController(deps, PROJECT, { pickSource: () => new Promise((resolve) => { release = resolve; }) });
  const choosing = controller.choose();
  assert.equal(controller.getState().busyAction, 'choose');
  controller.reset();
  assert.equal(controller.getState().status, 'busy', 'reset leaves the running action alone');
  release(source(0));
  await choosing;
  assert.equal(deriveStep(controller.getState()), 'review');
});

test('flow: reset returns to Choose without writing', async () => {
  const { storage, deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  await controller.choose();
  controller.reset();
  assert.equal(deriveStep(controller.getState()), 'choose');
  await controller.apply();
  assert.equal(storage.commitCalls, 0, 'with the plan dropped there is nothing to apply');
  await controller.choose();
  await controller.apply();
  assert.equal(deriveStep(controller.getState()), 'done');
  controller.reset();
  assert.equal(deriveStep(controller.getState()), 'choose');
  assert.equal(controller.getState().applied, null);
  assert.equal(controller.getState().history.length, 1, 'history is not the plan; it stays');
});

test('flow: a rejection stays in Review with a danger outcome and no Apply', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0, { version: 7 }) });
  const { outcomes } = track(controller);
  await controller.choose();
  const state = controller.getState();
  assert.equal(state.status, 'rejected');
  assert.equal(deriveStep(state), 'review');
  assert.equal(state.summary?.canApply, false);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.tone, 'danger');
  assert.equal(outcomes[0]!.where, 'review');
  assert.match(outcomes[0]!.detail, /newer format version.*Nothing was written/u);
});

test('outcome: a definite refusal says nothing was written and leaves the same plan to apply again', async () => {
  const { storage, deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  const { outcomes } = track(controller);
  await controller.choose();
  storage.failNextCommit(new StorageConflictError('Revision mismatch'));
  await controller.apply();
  assert.equal(controller.getState().status, 'planned', 'Apply is offered again');
  assert.equal(outcomes.at(-1)!.tone, 'danger');
  assert.equal(outcomes.at(-1)!.checkable, undefined, 'a known refusal is not an unknown result');
  assert.match(outcomes.at(-1)!.detail, /Nothing was changed/u);
  await controller.apply();
  assert.equal(controller.getState().status, 'applied');
});

test('outcome: an unexplained failure is unknown, and Check finds nothing written, so the plan is applicable again', async () => {
  const { storage, deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  const { outcomes } = track(controller);
  await controller.choose();
  storage.failNextCommit(new Error('The store did not answer'));
  await controller.apply();
  let state = controller.getState();
  assert.equal(outcomes.at(-1)!.tone, 'unknown');
  assert.equal(outcomes.at(-1)!.checkable, true);
  assert.equal(outcomes.at(-1)!.where, 'review');
  assert.equal(deriveStep(state), 'review', 'the screen keeps the preview');
  await controller.apply();
  assert.equal(storage.committedOps.length, 0, 'apply is held until Check, never a blind retry');
  await controller.check();
  state = controller.getState();
  const found = outcomes.at(-1)!;
  assert.equal(found.reconciles, true);
  assert.equal(found.tone, 'danger');
  assert.match(found.title, /not applied/u);
  assert.equal(state.status, 'planned');
  await controller.apply();
  assert.equal(controller.getState().status, 'applied');
  assert.equal(controller.getState().history.length, 1, 'applied once');
});

test('outcome: when the write landed but the reply was lost, Check finds it and moves to Done with Undo', async () => {
  const { storage, deps } = setup();
  const commit = storage.commit.bind(storage);
  let armed = true;
  storage.commit = async (ops) => { await commit(ops); if (armed) { armed = false; throw new Error('Connection lost'); } };
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  const { outcomes } = track(controller);
  await controller.choose();
  await controller.apply();
  assert.equal(outcomes.at(-1)!.tone, 'unknown');
  assert.equal(deriveStep(controller.getState()), 'review');
  await controller.check();
  const state = controller.getState();
  assert.equal(deriveStep(state), 'done');
  assert.equal(state.history.length, 1);
  assert.equal(outcomes.at(-1)!.tone, 'success');
  assert.equal(outcomes.at(-1)!.undoable, true);
  assert.equal(outcomes.at(-1)!.reconciles, true);
  assert.equal(state.applied?.importId, state.history[0]!.importId);
});

test('outcome: an unconfirmed undo is checked against what the store holds', async () => {
  const { storage, deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  const { outcomes } = track(controller);
  await controller.choose();
  await controller.apply();
  const id = controller.getState().history[0]!.importId;
  storage.failNextCommit(new Error('Timed out'));
  await controller.undo(id);
  assert.equal(outcomes.at(-1)!.tone, 'unknown');
  assert.equal(outcomes.at(-1)!.importId, id);
  await controller.check();
  assert.equal(outcomes.at(-1)!.tone, 'danger', 'not undone: it is still in place');
  assert.match(outcomes.at(-1)!.title, /not undone/u);
  await controller.undo(id);
  assert.equal(outcomes.at(-1)!.tone, 'success');
  assert.equal(outcomes.at(-1)!.title, 'Undid the import');
  assert.equal(controller.getState().history[0]!.undone, true);
});

test('outcome: a failed read is a danger outcome in place, never an unknown result', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => { throw new Error('Picker closed unexpectedly'); } });
  const { outcomes } = track(controller);
  await controller.choose();
  assert.equal(outcomes.at(-1)!.tone, 'danger');
  assert.equal(outcomes.at(-1)!.where, 'choose');
  assert.equal(deriveStep(controller.getState()), 'choose', 'the screen stays where it was');
  assert.equal(controller.getState().status, 'error');
});

test('outcome: dismissing clears the inline notice and the next action clears it too', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0, { version: 7 }) });
  await controller.choose();
  assert.ok(controller.getState().outcome);
  controller.dismissOutcome();
  assert.equal(controller.getState().outcome, null);
  await controller.choose();
  assert.equal(controller.getState().outcome?.tone, 'danger', 'a new rejection raises a new outcome');
});

test('export: the receipt says whether the bundle was saved, and the confirmation guard raises an info outcome', async () => {
  const { deps } = setup();
  const controller = createImportsController(deps, PROJECT);
  const { outcomes } = track(controller);
  controller.setExportChoice('draft-backup');
  assert.equal(await controller.exportNow(), null);
  assert.equal(outcomes.at(-1)!.tone, 'info');
  controller.setExportChoice('backup');
  await controller.exportNow();
  assert.equal(outcomes.at(-1)!.title, 'Bundle prepared');
  assert.match(outcomes.at(-1)!.detail, /nothing was written/u);
});

test('minBusyMs keeps a fast action visible as busy, and defaults to off', async () => {
  const { deps } = setup();
  const timed = createImportsController(deps, PROJECT, { pickSource: async () => source(0) }, { minBusyMs: 80 });
  const started = performance.now();
  await timed.choose();
  assert.ok(performance.now() - started >= 70, 'the busy state was held');
  const { deps: other } = setup();
  const instant = createImportsController(other, PROJECT, { pickSource: async () => source(0) });
  const begun = performance.now();
  await instant.choose();
  assert.ok(performance.now() - begun < 70, 'no hold by default');
});

test('undo marks its own import as the busy one', async () => {
  const { deps, clock } = setup();
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(0) });
  const { busy } = track(controller);
  await controller.choose();
  await controller.apply();
  clock.tick();
  const id = controller.getState().history[0]!.importId;
  busy.length = 0;
  await controller.undo(id);
  assert.ok(busy.length > 0 && busy.every((entry) => entry === `undo:${id}`), 'only the undone import shows busy');
  const snapshot: ImportsState = controller.getState();
  assert.equal(snapshot.busyAction, null);
  assert.equal(snapshot.status, 'idle');
});

test('resolving a conflict marks that conflict busy and reports where the owner is looking', async () => {
  const { deps, clock } = setup();
  let seed = 0;
  const controller = createImportsController(deps, PROJECT, { pickSource: async () => source(seed) });
  const { outcomes, busy } = track(controller);
  await controller.choose();
  await controller.apply();
  const record = (await listRecords(deps, PROJECT)).find((item) => item.itemKey === 'screens/home.png')!;
  await editImportedRecord(deps, record.recordId, { notes: 'mine' });
  seed = 1;
  clock.tick();
  await controller.choose();
  await controller.apply();
  const [conflict] = controller.getState().conflicts;
  assert.ok(conflict);
  busy.length = 0;
  await controller.resolve(conflict.recordId, 'take-incoming');
  assert.ok(busy.length > 0 && busy.every((entry) => entry === `resolve:${conflict.recordId}`));
  assert.equal(outcomes.at(-1)!.tone, 'success');
  assert.equal(outcomes.at(-1)!.where, 'conflicts');
  assert.equal(outcomes.at(-1)!.title, 'Took the incoming version.');
  assert.equal(controller.getState().conflicts.length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HostId, SourceProjectId } from '../src/contract.ts';
import type { RefreshReport } from '../src/discovery.ts';
import { deckState, plural, summarizeRefresh, type CatalogRow, type CatalogViewModel, type DeckDecision, type SourceRow } from '../src/view-model.ts';

const LAPTOP = 'host-laptop' as HostId;
const STUDIO = 'host-studio' as HostId;

function row(key: string, host: HostId = LAPTOP, status: CatalogRow['status'] = 'fresh'): CatalogRow {
  return {
    key: key as SourceProjectId, hostId: host, hostLabel: host === LAPTOP ? 'Laptop' : 'Studio', fake: true, displayName: key, relativePath: key, repoLabel: 'Local only',
    revision: null, status, statusLabel: status, updatedLabel: 'updated just now', linkedProjects: [], sameTitleCount: 0, preview: null, readOnly: true,
  };
}

function source(host: HostId, patch: Partial<SourceRow> = {}): SourceRow {
  return {
    hostId: host, label: host === LAPTOP ? 'Laptop' : 'Studio', adapterLabel: 'Synthetic fake source', fake: true, status: 'fresh', statusLabel: 'Up to date',
    updatedLabel: 'updated just now', error: null, conflict: false, projectCount: 0, ...patch,
  };
}

function model(rows: readonly CatalogRow[], sources: readonly SourceRow[]): CatalogViewModel {
  return { rows, sources, cacheLabel: 'Showing cached catalog', emptyLabel: null, totalCount: rows.length, countLabel: plural(rows.length, 'source project') };
}

const report = (...results: [HostId, string][]): RefreshReport => ({ contextId: 'all', superseded: false, results: results.map(([hostId, outcome]) => ({ hostId, outcome: outcome as RefreshReport['results'][number]['outcome'] })) });

test('the deck counts progress over the rows on show and ends with a summary', () => {
  const rows = ['a', 'b', 'c', 'd'].map((key) => row(key));
  const none = deckState(rows, new Map());
  assert.deepEqual([none.progressLabel, none.top?.key, none.next?.key, none.done, none.decided], ['1 of 4', 'a', 'b', false, 0]);

  const some = deckState(rows, new Map<string, DeckDecision>([['a', 'saved'], ['b', 'skipped']]));
  assert.deepEqual([some.progressLabel, some.top?.key, some.next?.key, some.saved, some.skipped, some.decided], ['3 of 4', 'c', 'd', 1, 1, 2]);

  const last = deckState(rows, new Map<string, DeckDecision>([['a', 'saved'], ['b', 'saved'], ['c', 'skipped']]));
  assert.deepEqual([last.progressLabel, last.top?.key, last.next, last.done], ['4 of 4', 'd', null, false], 'the last card has nothing peeking behind it');

  const all = deckState(rows, new Map<string, DeckDecision>([['a', 'saved'], ['b', 'saved'], ['c', 'skipped'], ['d', 'saved']]));
  assert.deepEqual([all.done, all.progressLabel, all.top, all.saved, all.skipped, all.total], [true, '4 of 4', null, 3, 1, 4]);
});

test('a decision about a row that left the list is ignored, and an empty deck is not "done"', () => {
  const rows = [row('a'), row('b')];
  const state = deckState(rows, new Map<string, DeckDecision>([['gone', 'saved'], ['a', 'skipped']]));
  assert.deepEqual([state.decided, state.saved, state.skipped, state.top?.key], [1, 0, 1, 'b']);
  const empty = deckState([], new Map<string, DeckDecision>([['a', 'saved']]));
  assert.deepEqual([empty.total, empty.done, empty.top, empty.progressLabel], [0, false, null, '0 of 0']);
});

test('a refresh that worked reports the source and project counts, and what is new', () => {
  const before = [row('a'), row('b', STUDIO)];
  const after = model([...before, row('c')], [source(LAPTOP), source(STUDIO)]);
  const summary = summarizeRefresh({ report: report([LAPTOP, 'applied'], [STUDIO, 'applied']), before, after });
  assert.equal(summary.tone, 'success');
  assert.equal(summary.title, 'Refreshed 2 sources');
  assert.equal(summary.meta, '3 projects · 1 new');
  assert.deepEqual(summary.addedKeys, ['c']);
  assert.equal(summary.refreshed, 2);
  assert.deepEqual(summary.problems, []);

  const same = summarizeRefresh({ report: report([LAPTOP, 'applied'], [STUDIO, 'ignored-stale-generation']), before, after: model(before, after.sources) });
  assert.equal(same.title, 'Refreshed 2 sources');
  assert.equal(same.meta, '2 projects · no changes');
  assert.deepEqual(same.addedKeys, []);

  const single = summarizeRefresh({ report: report([LAPTOP, 'applied']), before: [row('a')], after: model([row('a')], [source(LAPTOP)]) });
  assert.equal(single.title, 'Refreshed 1 source');
  assert.equal(single.meta, '1 project · no changes');
});

test('projects that newly went missing at the source are counted, not hidden', () => {
  const before = [row('a'), row('b')];
  const after = model([row('a'), row('b', LAPTOP, 'missing-at-source')], [source(LAPTOP)]);
  const summary = summarizeRefresh({ report: report([LAPTOP, 'applied']), before, after });
  assert.equal(summary.meta, '2 projects · 1 missing at source');
  const already = summarizeRefresh({ report: report([LAPTOP, 'applied']), before: after.rows, after });
  assert.equal(already.meta, '2 projects · no changes', 'a project that was already missing is not counted again');
});

test('a failed source is an error with what was kept; the other source still counts as refreshed', () => {
  const before = [row('a'), row('b', STUDIO)];
  const after = model(before, [source(LAPTOP), source(STUDIO, { status: 'offline', statusLabel: 'Offline', error: 'Fake source is offline' })]);
  const summary = summarizeRefresh({ report: report([LAPTOP, 'applied'], [STUDIO, 'offline']), before, after });
  assert.equal(summary.tone, 'danger');
  assert.equal(summary.title, "Couldn't refresh Studio");
  assert.equal(summary.description, 'Fake source is offline. 1 other source refreshed. Showing the saved catalog.');
  assert.equal(summary.meta, '2 projects · no changes');
  assert.deepEqual(summary.problems.map((problem) => [problem.hostId, problem.kind, problem.message]), [[STUDIO, 'failed', 'Fake source is offline']]);

  const both = summarizeRefresh({ report: report([LAPTOP, 'timeout'], [STUDIO, 'error']), before, after: model(before, [source(LAPTOP, { error: 'No response within 8000 ms' }), source(STUDIO, { error: 'Boom' })]) });
  assert.equal(both.tone, 'danger');
  assert.equal(both.title, "Couldn't refresh 2 sources");
  assert.equal(both.refreshed, 0);
});

test('a source with no adapter is a calm hold, not an error', () => {
  const before = [row('a')];
  const summary = summarizeRefresh({ report: report([LAPTOP, 'no-adapter']), before, after: model(before, [source(LAPTOP, { status: 'stale', statusLabel: 'Cached' })]) });
  assert.equal(summary.tone, 'info');
  assert.equal(summary.title, "Refresh isn't available yet");
  assert.equal(summary.description, 'No source is connected for Laptop. Showing the saved catalog.');
  assert.deepEqual(summary.problems.map((problem) => problem.kind), ['held']);
});

test('a changed host identity and a thrown refresh are both errors that keep the cached catalog', () => {
  const before = [row('a')];
  const after = model(before, [source(LAPTOP, { conflict: true, error: 'Host identity fingerprint changed; snapshot held until explicitly re-verified' })]);
  const conflict = summarizeRefresh({ report: report([LAPTOP, 'held-conflict']), before, after });
  assert.equal(conflict.tone, 'danger');
  assert.equal(conflict.problems[0]?.kind, 'conflict');

  const thrown = summarizeRefresh({ report: null, before, after });
  assert.equal(thrown.tone, 'danger');
  assert.equal(thrown.title, "Couldn't refresh sources");
  assert.equal(thrown.description, 'Showing the saved catalog (1 project).');
});

test('a cancelled host (the context changed) is not counted as a result', () => {
  const before = [row('a')];
  const summary = summarizeRefresh({ report: report([LAPTOP, 'applied'], [STUDIO, 'cancelled']), before, after: model(before, [source(LAPTOP)]) });
  assert.equal(summary.title, 'Refreshed 1 source');
  const nothing = summarizeRefresh({ report: report([LAPTOP, 'cancelled']), before, after: model(before, [source(LAPTOP)]) });
  assert.equal(nothing.tone, 'info');
  assert.equal(nothing.title, 'No sources to refresh');
});

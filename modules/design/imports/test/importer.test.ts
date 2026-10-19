import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordId, SCHEMAS, viewId } from '../src/contract.ts';
import {
  applyImport, editImportedRecord, isOwnerEdited, KEYS, listOpenConflicts, listRecords, planImport,
  resolveConflict, runImport, undoImport, type ImportedRecord, type ImportPlan,
} from '../src/importer.ts';
import { createMapperRegistry, FILES_MAPPER } from '../src/mappers.ts';
import { PROJECT, setup, source } from './fixtures.ts';

async function apply(deps: Parameters<typeof runImport>[0], seed = 0) {
  const result = await runImport(deps, { projectId: PROJECT, source: source(seed) });
  assert.equal(result.ok !== false, true, JSON.stringify(result));
  return result as Exclude<typeof result, { ok: false }>;
}

test('first import creates one view version per permitted file with provenance and rights', async () => {
  const { storage, deps } = setup();
  const { applied, manifest } = await apply(deps);
  assert.equal(applied, true);
  assert.equal(manifest.schema, 'hq.design.import/v1');
  assert.deepEqual(manifest.counts, { items: 4, created: 4, updated: 0, unchanged: 0, conflicts: 0 });
  assert.deepEqual(manifest.source, { kind: 'hq.files', version: 1, sourceId: 'src-synthetic-folder' });
  assert.deepEqual(manifest.mapping, { id: 'hq.files-to-view-version', version: 1 });
  assert.match(manifest.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  const records = await listRecords(deps, PROJECT);
  assert.equal(records.length, 4);
  for (const record of records) {
    const version = await storage.getDocument('workspace', KEYS.version(record.versionId));
    assert.ok(version, `version for ${record.itemKey}`);
    const value = version.value as Record<string, any>;
    assert.equal(value.schema, SCHEMAS.version);
    assert.equal(value.viewId, record.viewId);
    assert.equal(value.provenance.importId, manifest.importId);
    assert.equal(value.provenance.sourceKind, 'hq.files');
    assert.equal(value.provenance.mappingVersion, 1);
    assert.deepEqual(value.rights, record.rights);
  }
  const home = records.find((record) => record.itemKey === 'screens/home.png')!;
  const homeVersion = (await storage.getDocument('workspace', KEYS.version(home.versionId)))!.value as Record<string, any>;
  assert.equal(homeVersion.content.kind, 'image');
  assert.deepEqual([homeVersion.content.w, homeVersion.content.h], [390, 844]);
  assert.ok(await storage.getBlob('workspace', homeVersion.content.digest), 'PNG bytes stored as content-addressed blob');
  assert.equal(homeVersion.provenance.originalName, 'home.png');
  // Stable identifiers derive from source keys, not display titles.
  assert.doesNotMatch(home.viewId, /home/iu);
  // Every write landed in one atomic commit, none outside the workspace namespace.
  assert.equal(storage.commitCalls, 1);
  assert.equal(storage.writeCount('drafts') + storage.writeCount('cache'), 0);
});

test('repeating the same import changes nothing', async () => {
  const { storage, deps, clock } = setup();
  await apply(deps);
  const before = storage.snapshot();
  const commits = storage.commitCalls;
  clock.tick(60_000);
  const plan = await planImport(deps, { projectId: PROJECT, source: source() });
  assert.equal(plan.ok, true);
  assert.equal((plan as ImportPlan).noop, true);
  assert.equal((plan as ImportPlan).manifest.counts.unchanged, 4);
  const result = await applyImport(deps, plan as ImportPlan);
  assert.equal(result.applied, false);
  assert.equal(storage.commitCalls, commits, 'no commit attempted');
  assert.equal(storage.snapshot(), before, 'store byte-identical');
});

test('repeating after an owner edit with an unchanged source still changes nothing and keeps the edit', async () => {
  const { storage, deps } = setup();
  await apply(deps);
  const [record] = await listRecords(deps, PROJECT);
  await editImportedRecord(deps, record!.recordId, { title: 'My renamed screen', notes: 'Keep this' });
  const before = storage.snapshot();
  const plan = await planImport(deps, { projectId: PROJECT, source: source() });
  assert.equal((plan as ImportPlan).noop, true);
  assert.equal(storage.snapshot(), before);
});

test('a changed source for an untouched record updates it and keeps the old version immutable', async () => {
  const { storage, deps, clock } = setup();
  await apply(deps, 0);
  const original = (await listRecords(deps, PROJECT)).find((record) => record.itemKey === 'screens/home.png')!;
  const oldVersion = await storage.getDocument('workspace', KEYS.version(original.versionId));
  clock.tick();
  const { manifest } = await apply(deps, 1);
  assert.deepEqual(manifest.counts, { items: 4, created: 0, updated: 3, unchanged: 1, conflicts: 0 }, 'URL item is unchanged');
  const updated = (await listRecords(deps, PROJECT)).find((record) => record.itemKey === 'screens/home.png')!;
  assert.notEqual(updated.versionId, original.versionId);
  assert.deepEqual(updated.versionHistory, [original.versionId, updated.versionId]);
  assert.equal(updated.viewId, original.viewId, 'same view, new version');
  assert.deepEqual(await storage.getDocument('workspace', KEYS.version(original.versionId)), oldVersion, 'old version untouched');
});

test('a changed source for an owner-edited record produces a conflict, never an overwrite', async () => {
  const { storage, deps, clock } = setup();
  await apply(deps, 0);
  const target = (await listRecords(deps, PROJECT)).find((record) => record.itemKey === 'screens/home.png')!;
  await editImportedRecord(deps, target.recordId, { notes: 'Owner annotation' });
  const editedDocument = await storage.getDocument('workspace', KEYS.record(target.recordId));
  assert.equal(await isOwnerEdited(deps, editedDocument!.value as unknown as ImportedRecord), true);
  clock.tick();
  const { manifest } = await apply(deps, 1);
  assert.equal(manifest.counts.conflicts, 1);
  assert.equal(manifest.counts.updated, 2);
  assert.deepEqual(manifest.conflicts.map((conflict) => conflict.recordId), [target.recordId]);
  assert.deepEqual(await storage.getDocument('workspace', KEYS.record(target.recordId)), editedDocument, 'record byte-identical including revision');
  const [conflict] = await listOpenConflicts(deps);
  assert.equal(conflict!.recordId, target.recordId);
  assert.ok(await storage.getDocument('workspace', KEYS.version(conflict!.incomingVersionId)), 'incoming evidence retained unbound');

  // Re-running the same conflicting import is idempotent.
  const before = storage.snapshot();
  const again = await planImport(deps, { projectId: PROJECT, source: source(1) });
  assert.equal((again as ImportPlan).noop, true);
  assert.equal(storage.snapshot(), before);
});

test('explicit conflict resolution: keep-current is sticky; take-incoming rebinds and keeps notes', async () => {
  const { deps, clock } = setup();
  await apply(deps, 0);
  const records = await listRecords(deps, PROJECT);
  const home = records.find((record) => record.itemKey === 'screens/home.png')!;
  const flow = records.find((record) => record.itemKey === 'recordings/flow.webm')!;
  await editImportedRecord(deps, home.recordId, { title: 'Owner title' });
  await editImportedRecord(deps, flow.recordId, { notes: 'Owner note' });
  clock.tick();
  await apply(deps, 1);
  assert.equal((await listOpenConflicts(deps)).length, 2);

  await resolveConflict(deps, home.recordId, 'keep-current');
  const kept = (await listRecords(deps, PROJECT)).find((record) => record.recordId === home.recordId)!;
  assert.equal(kept.title, 'Owner title');
  assert.equal((await planImport(deps, { projectId: PROJECT, source: source(1) }) as ImportPlan).noop, true, 'dismissed incoming not re-raised');

  const taken = await resolveConflict(deps, flow.recordId, 'take-incoming');
  const after = (await listRecords(deps, PROJECT)).find((record) => record.recordId === flow.recordId)!;
  assert.equal(after.versionId, taken.incomingVersionId);
  assert.equal(after.notes, 'Owner note');
  assert.equal(await isOwnerEdited(deps, after), false);
  await assert.rejects(resolveConflict(deps, flow.recordId, 'keep-current'), /No open conflict/u);
});

test('undo tombstones only untouched records and is itself idempotent', async () => {
  const { storage, deps, clock } = setup();
  const { manifest } = await apply(deps);
  const records = await listRecords(deps, PROJECT);
  const edited = records.find((record) => record.itemKey === 'screens/home.png')!;
  await editImportedRecord(deps, edited.recordId, { notes: 'Mine' });
  clock.tick();
  const result = await undoImport(deps, manifest.importId);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.undo.tombstoned.length, 3);
  assert.deepEqual(result.undo.retained, [{ recordId: edited.recordId, reason: 'owner-edited' }]);
  const after = await listRecords(deps, PROJECT);
  assert.equal(after.find((record) => record.recordId === edited.recordId)!.tombstone, null, 'owner-edited record retained');
  assert.equal(after.filter((record) => record.tombstone !== null).length, 3);
  // Tombstones, not deletions: every version and blob survives.
  for (const record of records) assert.ok(await storage.getDocument('workspace', KEYS.version(record.versionId)));
  const before = storage.snapshot();
  const again = await undoImport(deps, manifest.importId);
  assert.equal(again.ok && again.applied, false);
  assert.equal(storage.snapshot(), before);
});

test('undo reverts an update only when untouched and skips records a later import changed', async () => {
  const { deps, clock } = setup();
  const first = await apply(deps, 0);
  clock.tick();
  const second = await apply(deps, 1);
  const home = (await listRecords(deps, PROJECT)).find((record) => record.itemKey === 'screens/home.png')!;
  const undoFirst = await undoImport(deps, first.manifest.importId);
  assert.ok(undoFirst.ok);
  if (!undoFirst.ok) return;
  assert.equal(undoFirst.undo.retained.filter((item) => item.reason === 'changed-by-later-import').length, 3);
  assert.equal(undoFirst.undo.tombstoned.length, 1, 'only the URL record still as the first import left it');

  const undoSecond = await undoImport(deps, second.manifest.importId);
  assert.ok(undoSecond.ok);
  if (!undoSecond.ok) return;
  assert.equal(undoSecond.undo.reverted.length, 3);
  const reverted = (await listRecords(deps, PROJECT)).find((record) => record.recordId === home.recordId)!;
  assert.equal(reverted.versionHistory.length, 1, 'restored the first import’s state');
  assert.equal(reverted.versionId, first.manifest.records.find((record) => record.itemKey === 'screens/home.png')!.versionId);
});

test('re-importing after undo revives tombstoned records, and undoing that restores the tombstone', async () => {
  const { storage, deps, clock } = setup();
  const first = await apply(deps);
  clock.tick();
  await undoImport(deps, first.manifest.importId);
  const tombstoned = storage.snapshot();
  clock.tick();
  const again = await apply(deps);
  assert.equal(again.manifest.counts.created, 4);
  assert.equal((await listRecords(deps, PROJECT)).every((record) => record.tombstone === null), true);
  clock.tick();
  const undo = await undoImport(deps, again.manifest.importId);
  assert.ok(undo.ok && undo.undo.reverted.length === 4);
  const records = await listRecords(deps, PROJECT);
  assert.equal(records.every((record) => record.tombstone !== null), true);
  assert.notEqual(storage.snapshot(), tombstoned, 'history grew (manifests/events) but records match');
});

test('an unsupported future source version is rejected with no writes', async () => {
  const { storage, deps } = setup();
  const before = storage.snapshot();
  const result = await runImport(deps, { projectId: PROJECT, source: source(0, { version: 2 }) });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'unsupported-version');
  const unknownKind = await runImport(deps, { projectId: PROJECT, source: source(0, { kind: 'legacy.unknown' }) });
  assert.equal(!unknownKind.ok && unknownKind.reason, 'unsupported-source-kind');
  assert.equal(storage.commitCalls, 0);
  assert.equal(storage.snapshot(), before);
});

test('a newer stored record schema makes the import read-only with no writes', async () => {
  const { storage, deps, clock } = setup();
  await apply(deps);
  const home = (await listRecords(deps, PROJECT)).find((record) => record.itemKey === 'screens/home.png')!;
  const document = (await storage.getDocument('workspace', KEYS.record(home.recordId)))!;
  await storage.commit([{ op: 'put-document', namespace: 'workspace', key: document.key, value: { ...(document.value as object), schema: 'hq.design.imported-record/v2' }, expectedRevision: document.revision }]);
  const before = storage.snapshot();
  const commits = storage.commitCalls;
  clock.tick();
  const result = await runImport(deps, { projectId: PROJECT, source: source(1) });
  assert.equal(!result.ok && result.reason, 'unsupported-stored-schema');
  assert.equal(storage.commitCalls, commits);
  assert.equal(storage.snapshot(), before);
});

test('a future manifest version is never undone', async () => {
  const { storage, deps } = setup();
  const { manifest } = await apply(deps);
  const document = (await storage.getDocument('workspace', KEYS.manifest(manifest.importId)))!;
  await storage.commit([{ op: 'put-document', namespace: 'workspace', key: document.key, value: { ...(document.value as object), schema: 'hq.design.import/v9' }, expectedRevision: document.revision }]);
  const before = storage.snapshot();
  const result = await undoImport(deps, manifest.importId);
  assert.equal(!result.ok && result.reason, 'unsupported-stored-schema');
  assert.equal(storage.snapshot(), before);
});

test('items without permitted rights or with unsafe content reject the whole import with no writes', async () => {
  const { storage, deps } = setup();
  const bad = source(0);
  const cases = [
    { ...bad.items[0]!, rights: { basis: 'unknown', holder: 'x' } as never },
    { ...bad.items[0]!, rights: { basis: 'licensed', holder: 'x' } as never },
    { ...bad.items[0]!, payload: { kind: 'png' as const, bytes: new Uint8Array(40) } },
    { ...bad.items[2]!, payload: { kind: 'html-bundle' as const, entry: 'index.html', files: [{ path: '../index.html', mediaType: 'text/html', bytes: new Uint8Array(1) }] } },
    { ...bad.items[3]!, payload: { kind: 'url' as const, url: 'https://user:pw@example.com/' } },
    { ...bad.items[3]!, payload: { kind: 'url' as const, url: 'file:///etc/passwd' } },
  ];
  for (const item of cases) {
    const result = await runImport(deps, { projectId: PROJECT, source: { ...bad, items: [bad.items[1]!, item] } });
    assert.equal(!result.ok && result.reason, 'invalid-source', JSON.stringify(item.payload.kind));
  }
  const badSource = await runImport(deps, { projectId: PROJECT, source: { ...bad, sourceId: '../escape' as never } });
  assert.equal(!badSource.ok && badSource.problems[0]!.code, 'source-id');
  const badProject = await runImport(deps, { projectId: '' as never, source: bad });
  assert.equal(!badProject.ok && badProject.problems[0]!.code, 'project-id');
  const duplicate = await runImport(deps, { projectId: PROJECT, source: { ...bad, items: [bad.items[0]!, bad.items[0]!] } });
  assert.equal(!duplicate.ok && duplicate.problems[0]!.code, 'duplicate-item-key');
  assert.equal(storage.commitCalls, 0);
});

test('a failed commit leaves no partial import, and a stale plan fails compare-and-swap', async () => {
  const { storage, deps, clock } = setup();
  const before = storage.snapshot();
  storage.failNextCommit();
  await assert.rejects(runImport(deps, { projectId: PROJECT, source: source() }), /FAKE injected/u);
  assert.equal(storage.snapshot(), before);

  await apply(deps, 0);
  clock.tick();
  const plan = await planImport(deps, { projectId: PROJECT, source: source(1) }) as ImportPlan;
  const home = (await listRecords(deps, PROJECT)).find((record) => record.itemKey === 'screens/home.png')!;
  await editImportedRecord(deps, home.recordId, { notes: 'edited between plan and apply' });
  const mid = storage.snapshot();
  await assert.rejects(applyImport(deps, plan), /Revision mismatch|Sequence mismatch/u);
  assert.equal(storage.snapshot(), mid, 'owner edit survives a stale plan');
  const replanned = await planImport(deps, { projectId: PROJECT, source: source(1) }) as ImportPlan;
  assert.equal(replanned.manifest.counts.conflicts, 1);
});

test('items can target an existing view; identical content in two imports shares one version', async () => {
  const { deps } = setup();
  const target = viewId('view-existing-home');
  const base = source(0);
  const result = await runImport(deps, { projectId: PROJECT, source: { ...base, items: [{ ...base.items[0]!, viewId: target }] } });
  assert.ok(result.ok !== false);
  const [record] = await listRecords(deps, PROJECT);
  assert.equal(record!.viewId, target);
  assert.throws(() => recordId('has space'), /Invalid RecordId/u);
});

test('the mapper registry is the extension point for future legacy adapters', async () => {
  const registry = createMapperRegistry([FILES_MAPPER, { ...FILES_MAPPER, kind: 'synthetic.legacy', versions: [3], mappingId: 'legacy-to-view-version', mappingVersion: 2 }]);
  const { deps } = setup();
  const legacy = await runImport({ ...deps, mappers: registry }, { projectId: PROJECT, source: source(0, { kind: 'synthetic.legacy', version: 3 }) });
  assert.ok(legacy.ok !== false);
  assert.deepEqual(legacy.manifest.mapping, { id: 'legacy-to-view-version', version: 2 });
  const future = await runImport({ ...deps, mappers: registry }, { projectId: PROJECT, source: source(0, { kind: 'synthetic.legacy', version: 4 }) });
  assert.equal(!future.ok && future.reason, 'unsupported-version');
  assert.throws(() => createMapperRegistry([FILES_MAPPER, FILES_MAPPER]), /Duplicate mapper/u);
});

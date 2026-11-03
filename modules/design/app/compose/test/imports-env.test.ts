import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createBridgedWorkspace } from '../bridged-workspace.ts';
import { createProjectContentEvents } from '../content-events.ts';
import { DesignOperationError } from '../errors.ts';
import { createWorkspaceThumbnailPort } from '../thumbnail-port.ts';
import { createProjectsStorage } from '../../storage/index.ts';
import { createImportsController, type ImportsController } from '../../../imports/src/controller.ts';
import { applyImport, editImportedRecord, listRecords, planImport, type ImportPlan } from '../../../imports/src/importer.ts';
import { projectId as importsProject } from '../../../imports/src/contract.ts';
import { CONTENT_SCHEMA, summarize } from '../../../projects/src/content.ts';
import { projectId as contentProject } from '../../../projects/src/ids.ts';
import { ProjectContentRepository, contentKey } from '../../../projects/src/repository.ts';
import { createImportsDouble, syntheticImportPng } from './imports-bridge-double.ts';

const project = { id: 'proj-imports-env', name: 'Imports env' };
const CONTENT_DOCUMENT = `design/projects/${contentKey(contentProject(project.id))}`;
type Picked = { name: string; mediaType: 'image/png'; bytes: Uint8Array };
const pngFile = (name: string, seed = 1, w = 16, h = 10): Picked => ({ name, mediaType: 'image/png', bytes: syntheticImportPng(w, h, seed) });

function setup() {
  const double = createImportsDouble();
  const documents = createBridgeWorkspaceDocuments(double.transport);
  const contentEvents = createProjectContentEvents();
  const workspace = createBridgedWorkspace(documents, { contentEvents });
  const env = workspace.importsFor(project);
  const controller: ImportsController = createImportsController(env.deps, importsProject(project.id), env.capabilities);
  const repository = new ProjectContentRepository(createProjectsStorage(documents), { now: () => new Date().toISOString() });
  const notified: number[] = [];
  contentEvents.subscribe(project.id, () => notified.push(contentEvents.revision(project.id)));
  const content = async () => {
    const loaded = await repository.load(contentProject(project.id));
    assert.equal(loaded.status, 'ok');
    if (loaded.status !== 'ok') throw new Error('content');
    return loaded.content;
  };
  const pick = (...files: Picked[]) => double.setPick({ status: 'picked', files });
  const commitCount = () => double.count('import.commit');
  return { double, documents, workspace, env, controller, repository, content, notified, contentEvents, pick, commitCount };
}

describe('durable Imports env over the bridge', () => {
  it('links imported PNGs into project content inside the same atomic import.commit, with thumbnails that resolve', async () => {
    const f = setup();
    const home = pngFile('home.png', 1, 390, 844), settings = pngFile('settings.png', 2, 320, 200);
    f.pick(home, settings);
    await f.controller.choose();
    assert.equal(f.controller.getState().status, 'planned');
    assert.deepEqual(f.controller.getState().summary?.rows.map((row) => [row.key, row.action]), [['home.png', 'New'], ['settings.png', 'New']]);
    assert.equal(f.commitCount(), 0, 'choosing and planning write nothing');
    await f.controller.apply();
    assert.equal(f.controller.getState().status, 'applied', f.controller.getState().message ?? '');
    assert.equal(f.commitCount(), 1, 'one atomic batch');
    const ops = f.double.commits[0]!.ops;
    const keys = ops.filter((op) => op.op === 'put-document').map((op) => (op as { key: string }).key);
    assert.ok(keys.includes(CONTENT_DOCUMENT), 'the project content document is part of the same batch');
    assert.equal(keys.at(-1), CONTENT_DOCUMENT, 'link operations come last');
    assert.equal(f.double.count('doc.put'), 0, 'nothing is written outside import.commit');

    const content = await f.content();
    assert.equal(content.schema, CONTENT_SCHEMA);
    assert.equal(content.views.length, 2);
    assert.equal(content.versions.length, 2);
    const records = await listRecords(f.env.deps, importsProject(project.id));
    for (const [index, file] of [home, settings].entries()) {
      const record = records.find((item) => item.itemKey === file.name)!;
      const version = content.versions.find((item) => item.id === record.versionId)!;
      assert.ok(version, `${file.name} is a project version`);
      assert.deepEqual([version.viewId, version.origin, version.ordinal], [record.viewId, 'imported', 1]);
      assert.match(version.id, /^ver_[0-9a-f]{32}$/u, 'deterministic IDs from the importer');
      assert.equal(content.views.find((view) => view.id === version.viewId)!.title, file.name.replace('.png', ''));
      assert.equal(version.label, `Imported ${file.name}`);
      assert.deepEqual(version.capture.viewport, index === 0 ? { w: 390, h: 844, dpr: 1 } : { w: 320, h: 200, dpr: 1 });
      assert.equal(version.capture.route, `imported/${file.name}`);
      assert.equal(version.thumbnail?.mediaType, 'image/png');
      assert.equal(version.thumbnail?.bytes, file.bytes.byteLength);
      assert.equal(version.capture.captureDigest, version.thumbnail?.digest);
      // The Projects thumbnail port resolves the exact PNG bytes.
      const bytes = await createWorkspaceThumbnailPort(f.documents).readThumbnail(version.thumbnail!, new AbortController().signal);
      assert.deepEqual([bytes.mediaType, [...bytes.bytes]], ['image/png', [...file.bytes]]);
    }
    assert.ok(summarize(content).cover, 'the project card has a cover');
    assert.deepEqual(f.notified, [1], 'project readers were told once, after the durable write');
  });

  it('re-picking identical files changes nothing: no commit, no content write, no notification', async () => {
    const f = setup();
    f.pick(pngFile('home.png', 1), pngFile('settings.png', 2));
    await f.controller.choose();
    await f.controller.apply();
    const before = JSON.stringify([...f.double.documents.entries()]);
    f.pick(pngFile('home.png', 1), pngFile('settings.png', 2));
    await f.controller.choose();
    assert.equal(f.controller.getState().summary?.canApply, false);
    assert.match(f.controller.getState().summary?.headline ?? '', /^Already imported/u);
    await f.controller.apply();
    assert.equal(f.commitCount(), 1);
    assert.equal(JSON.stringify([...f.double.documents.entries()]), before, 'every stored document is byte-identical');
    assert.deepEqual(f.notified, [1]);
  });

  it('a changed file under the same name is an update: a second version of the same view, and the old one stays', async () => {
    const f = setup();
    f.pick(pngFile('home.png', 1));
    await f.controller.choose();
    await f.controller.apply();
    const first = (await f.content()).versions[0]!;
    f.pick(pngFile('home.png', 9, 24, 24));
    await f.controller.choose();
    assert.deepEqual(f.controller.getState().summary?.rows.map((row) => row.action), ['Updated']);
    await f.controller.apply();
    const content = await f.content();
    assert.equal(content.views.length, 1);
    assert.deepEqual(content.versions.map((version) => [version.ordinal, version.viewId]), [[1, first.viewId], [2, first.viewId]]);
    assert.deepEqual(content.versions[0], first, 'the earlier version is byte-for-byte unchanged');
    assert.deepEqual(f.notified, [1, 2]);
  });

  it('undo changes the imports record but leaves the project versions in place, and writes no project content', async () => {
    const f = setup();
    f.pick(pngFile('home.png', 1));
    await f.controller.choose();
    await f.controller.apply();
    const before = await f.content();
    const importId = f.controller.getState().history[0]!.importId;
    await f.controller.undo(importId);
    assert.match(f.controller.getState().message ?? '', /^Undo removed 1, restored 0, kept 0/u);
    assert.equal(f.controller.getState().history[0]!.undone, true);
    assert.equal(f.commitCount(), 2);
    assert.ok(!f.double.commits[1]!.ops.some((op) => op.op === 'put-document' && op.key === CONTENT_DOCUMENT), 'the undo batch carries no content write');
    assert.deepEqual(await f.content(), before, 'versions are immutable and are never removed');
    assert.deepEqual((await listRecords(f.env.deps, importsProject(project.id))).map((record) => record.tombstone !== null), [true]);
    assert.deepEqual(f.notified, [1]);
  });

  it('keeps unrelated project content and appends to it with that document revision', async () => {
    const f = setup();
    const created = await f.repository.update(contentProject(project.id), (content, now) => ({ ...content, updatedAt: now,
      views: [{ id: 'view-existing' as never, title: 'Existing', kind: 'page', createdAt: now }] }));
    f.pick(pngFile('home.png', 1));
    await f.controller.choose();
    await f.controller.apply();
    const op = f.double.commits[0]!.ops.find((candidate) => candidate.op === 'put-document' && candidate.key === CONTENT_DOCUMENT);
    assert.equal((op as { expectedRevision: string }).expectedRevision, created.revision);
    const content = await f.content();
    assert.deepEqual(content.views.map((view) => view.title), ['Existing', 'home']);
  });

  it('refuses a project content document it cannot rewrite, with a typed read-only failure and no commit', async () => {
    const f = setup();
    f.double.documents.set(CONTENT_DOCUMENT, { namespace: 'workspace', key: CONTENT_DOCUMENT, revision: 1, valueDigest: `sha256:${'0'.repeat(64)}`,
      updatedAt: '2026-01-01T00:00:00Z', value: { schema: 'hq.design.project-content/v9', projectId: project.id } });
    f.pick(pngFile('home.png', 1));
    await f.controller.choose();
    const plan = await planImport(f.env.deps, { projectId: importsProject(project.id), source: (await f.env.capabilities.pickSource!())! }) as ImportPlan;
    await assert.rejects(() => applyImport(f.env.deps, plan), (error) => {
      assert.ok(error instanceof DesignOperationError);
      assert.deepEqual([error.kind, error.outcome, error.operation], ['read-only', 'no-effect', 'imports.apply']);
      return true;
    });
    assert.equal(f.commitCount(), 0);
    assert.deepEqual(f.notified, []);
  });

  it('an unknown outcome on apply is typed unknown and still tells readers; a retry then finds the import done', async () => {
    const f = setup();
    f.pick(pngFile('home.png', 1));
    await f.controller.choose();
    const plan = await planImport(f.env.deps, { projectId: importsProject(project.id), source: (await f.env.capabilities.pickSource!())! }) as ImportPlan;
    f.double.loseNextCommitReply();
    await assert.rejects(() => applyImport(f.env.deps, plan), (error) => {
      assert.ok(error instanceof DesignOperationError);
      assert.deepEqual([error.kind, error.outcome, error.recovery, error.operation], ['unknown', 'unknown-effect', 'check', 'imports.apply']);
      return true;
    });
    assert.deepEqual(f.notified, [1], 'readers re-read after an unknown outcome');
    assert.equal((await f.content()).versions.length, 1, 'the write did land, so the readers were right to re-read');
    f.pick(pngFile('home.png', 1));
    await f.controller.choose();
    assert.equal(f.controller.getState().summary?.canApply, false, 'checking shows the import is already there');
    assert.equal(f.commitCount(), 1);
  });

  it('a stale plan is a typed conflict that changes nothing', async () => {
    const f = setup();
    f.pick(pngFile('home.png', 1));
    const source = (await f.env.capabilities.pickSource!())!;
    const stale = await planImport(f.env.deps, { projectId: importsProject(project.id), source }) as ImportPlan;
    await f.controller.choose();
    await f.controller.apply();
    const content = await f.content();
    await assert.rejects(() => applyImport(f.env.deps, stale), (error) => {
      assert.ok(error instanceof DesignOperationError);
      assert.deepEqual([error.kind, error.outcome, error.recovery, error.operation], ['conflict', 'no-effect', 'reload', 'imports.apply']);
      return true;
    });
    assert.deepEqual(await f.content(), content);
  });

  it('an owner-edited record whose source changed is a conflict; the incoming version joins the project only if the owner takes it', async () => {
    const f = setup();
    f.pick(pngFile('a.png', 1), pngFile('b.png', 2));
    await f.controller.choose();
    await f.controller.apply();
    for (const record of await listRecords(f.env.deps, importsProject(project.id))) await editImportedRecord(f.env.deps, record.recordId, { title: `Mine ${record.itemKey}` });
    f.pick(pngFile('a.png', 7), pngFile('b.png', 8));
    await f.controller.choose();
    assert.deepEqual(f.controller.getState().summary?.rows.map((row) => row.action), ['Conflict — your edits kept', 'Conflict — your edits kept']);
    await f.controller.apply();
    await f.controller.refresh();
    const conflicts = f.controller.getState().conflicts;
    assert.equal(conflicts.length, 2);
    assert.equal((await f.content()).versions.length, 2, 'unaccepted incoming versions are evidence, not project content');
    const [keep, take] = [conflicts.find((row) => row.itemKey === 'a.png')!, conflicts.find((row) => row.itemKey === 'b.png')!];
    await f.controller.resolve(keep.recordId, 'keep-current');
    assert.equal((await f.content()).versions.length, 2, 'keeping the current record adds nothing');
    await f.controller.resolve(take.recordId, 'take-incoming');
    const content = await f.content();
    assert.equal(content.versions.length, 3);
    const records = await listRecords(f.env.deps, importsProject(project.id));
    const taken = records.find((record) => record.itemKey === 'b.png')!;
    assert.equal(content.versions.at(-1)!.id, taken.versionId);
    assert.equal(content.versions.at(-1)!.ordinal, 2);
    assert.equal(content.versions.at(-1)!.viewId, taken.viewId);
    assert.deepEqual(f.controller.getState().conflicts, []);
    // Resolving an already linked choice again writes nothing to project content.
    assert.equal(f.notified.length, 2);
  });

  it('the export action fails safely: a clear message, and nothing is written or read from the workspace', async () => {
    const f = setup();
    f.pick(pngFile('home.png', 1));
    await f.controller.choose();
    await f.controller.apply();
    const calls = f.double.calls.length;
    const documents = JSON.stringify([...f.double.documents.entries()]);
    for (const kind of ['backup', 'export'] as const) {
      f.controller.setExportChoice(kind);
      assert.equal(await f.controller.exportNow(), null);
      assert.equal(f.controller.getState().status, 'error');
      assert.equal(f.controller.getState().message, 'Backup and export are not available in this build');
      assert.equal(f.controller.getState().lastExport, null);
    }
    // Drafts live outside this store: the private draft backup has nothing to include, and nothing to save it with.
    f.controller.setExportChoice('draft-backup');
    f.controller.setConfirmPrivate(true);
    const draft = await f.controller.exportNow();
    assert.deepEqual(draft?.namespaces, []);
    assert.deepEqual(f.controller.getState().lastExport?.coverage.included, []);
    assert.equal(f.controller.getState().lastExport?.saved, null);
    assert.equal(f.controller.getState().message, 'Bundle prepared. Saving to disk is unavailable in this build.');
    assert.equal(f.env.capabilities.saveBundle, undefined);
    assert.equal(f.controller.getState().canSave, false);
    assert.equal(f.double.calls.length, calls, 'the export attempts made no transport call');
    assert.equal(JSON.stringify([...f.double.documents.entries()]), documents);
  });

  it('a workspace whose documents are not on the bridge offers no picker and says Imports are unavailable', async () => {
    const double = createImportsDouble();
    const bridged = createBridgeWorkspaceDocuments(double.transport);
    const workspace = createBridgedWorkspace({ ...bridged });
    const env = workspace.importsFor(project);
    assert.equal(env.capabilities.pickSource, undefined);
    const controller = createImportsController(env.deps, importsProject(project.id), env.capabilities);
    await controller.refresh();
    assert.equal(controller.getState().status, 'error');
    assert.equal(controller.getState().message, 'Imports are not available in this build');
    assert.equal(controller.getState().canPick, false);
    assert.equal(double.calls.length, 0);
    await assert.rejects(() => env.deps.storage.commit([]), (error) => error instanceof DesignOperationError && error.kind === 'disabled');
  });
});

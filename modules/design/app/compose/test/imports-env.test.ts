import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { DesignServiceParams } from '@hq/contracts/services';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createBridgedWorkspace } from '../bridged-workspace.ts';
import { createProjectContentEvents } from '../content-events.ts';
import { classifyDesignError, designFeedback, DesignOperationError } from '../errors.ts';
import { createImportsContentLink } from '../imports-content-link.ts';
import { blobCanonicalBytes, IMPORTS_CONTEXTS, type ImportsLinkContext } from '../imports-storage.ts';
import { createWorkspaceThumbnailPort } from '../thumbnail-port.ts';
import { createProjectsStorage } from '../../storage/index.ts';
import { createImportsController, type ImportsController } from '../../../imports/src/controller.ts';
import { applyImport, editImportedRecord, listRecords, planImport, type ImportPlan } from '../../../imports/src/importer.ts';
import { projectId as importsProject, SCHEMAS, type WriteOp } from '../../../imports/src/contract.ts';
import { CONTENT_SCHEMA, summarize } from '../../../projects/src/content.ts';
import { projectId as contentProject } from '../../../projects/src/ids.ts';
import { ProjectContentRepository, contentKey } from '../../../projects/src/repository.ts';
import { buildPng, createImportsDouble, largeImportPng, syntheticImportPng } from './imports-bridge-double.ts';

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

const feedbackTone = (cause: unknown) => designFeedback(classifyDesignError(cause, IMPORTS_CONTEXTS.read)).tone;

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
      // The typed failure's description joins its message, so the panel says what was kept.
      assert.equal(f.controller.getState().message, 'Backup and export are not available in this build. Your imports are saved on this device. Nothing was changed.');
      assert.deepEqual([classifyDesignError(f.controller.getState().cause, IMPORTS_CONTEXTS.read).kind, feedbackTone(f.controller.getState().cause)], ['disabled', 'info']);
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
    assert.equal(classifyDesignError(controller.getState().cause, IMPORTS_CONTEXTS.read).operation, 'imports.read');
    assert.equal(double.calls.length, 0, 'unregistered documents never acquire transport authority');
    assert.equal(controller.getState().status, 'error');
    // The typed failure's description joins its message, so the panel shows what was kept.
    assert.equal(controller.getState().message, 'Imports are not available in this build. Nothing was changed.');
    assert.equal(classifyDesignError(controller.getState().cause, IMPORTS_CONTEXTS.read).kind, 'disabled');
    assert.equal(controller.getState().canPick, false);
    assert.equal(double.calls.length, 0);
    await assert.rejects(() => env.deps.storage.commit([]), (error) => error instanceof DesignOperationError && error.kind === 'disabled');
  });
});

describe('typed Imports failures reach the view', () => {
  /** What a view does with the controller's error state. */
  const feedbackOf = (cause: unknown) => designFeedback(classifyDesignError(cause, IMPORTS_CONTEXTS.read));

  it('a refused pick shows the full sentence in the state and classifies as invalid, with the picker reason', async () => {
    const f = setup();
    f.double.setPick({ status: 'rejected', reason: 'invalid-png' });
    await f.controller.choose();
    const state = f.controller.getState();
    assert.equal(state.status, 'error');
    const failure = classifyDesignError(state.cause, IMPORTS_CONTEXTS.read);
    assert.deepEqual([failure.kind, failure.operation, failure.reason, failure.outcome], ['invalid', 'imports.pick', 'invalid-png', 'no-effect']);
    assert.equal(state.message, `${failure.message}. ${failure.description}`);
    assert.match(state.message ?? '', /not a PNG image\. Nothing was imported\.$/u);
    assert.equal(feedbackOf(state.cause).meta, 'imports.pick · invalid-png');
    // The next attempt replaces the sentence and clears the cause with it.
    f.pick(pngFile('home.png'));
    await f.controller.choose();
    assert.deepEqual([f.controller.getState().status, f.controller.getState().message, f.controller.getState().cause], ['planned', null, null]);
  });

  it('a conflicted apply shows the full sentence and classifies as conflict under its own operation', async () => {
    const f = setup();
    f.pick(pngFile('home.png'));
    await f.controller.choose();
    // Another window applies the same import first, so this controller's plan is stale.
    const source = (await f.env.capabilities.pickSource!())!;
    const rival = await planImport(f.env.deps, { projectId: importsProject(project.id), source }) as ImportPlan;
    await applyImport(f.env.deps, rival);
    await f.controller.apply();
    const state = f.controller.getState();
    assert.equal(state.status, 'error');
    assert.ok(state.cause instanceof DesignOperationError);
    const failure = classifyDesignError(state.cause, IMPORTS_CONTEXTS.read);
    assert.deepEqual([failure.kind, failure.operation, failure.outcome, failure.recovery], ['conflict', 'imports.apply', 'no-effect', 'reload']);
    assert.equal(state.message, `${failure.message}. ${failure.description}`);
    assert.match(state.message ?? '', /\. \S/u, 'a message and a description, joined');
    const feedback = feedbackOf(state.cause);
    assert.deepEqual([feedback.tone, feedback.status, feedback.action?.kind], ['danger', 'Changed elsewhere', 'reload']);
  });

  it('an apply whose reply is lost is unknown, offers Check, and still tells project readers to re-read', async () => {
    const f = setup();
    f.pick(pngFile('home.png'));
    await f.controller.choose();
    f.double.loseNextCommitReply();
    await f.controller.apply();
    const state = f.controller.getState();
    assert.equal(state.status, 'error');
    const failure = classifyDesignError(state.cause, IMPORTS_CONTEXTS.read);
    assert.deepEqual([failure.kind, failure.operation, failure.outcome, failure.recovery], ['unknown', 'imports.apply', 'unknown-effect', 'check']);
    assert.equal(state.message, `${failure.message}. ${failure.description}`);
    const feedback = feedbackOf(state.cause);
    assert.deepEqual([feedback.tone, feedback.inline, feedback.status, feedback.action, feedback.persistent],
      ['unknown', 'unknown', 'Unconfirmed', { kind: 'check', label: 'Check' }, true]);
    assert.deepEqual(f.notified, [1], 'the commit landed, so readers were told once');
    assert.equal((await f.content()).versions.length, 1, 'and the version is there: Check would find it');
  });

  it('a lost read is typed as unavailable with Retry, and the cause is what the view classifies', async () => {
    const f = setup();
    const lost = new Error('IPC channel closed');
    f.double.failWith((route) => { if (route === 'doc.list') throw lost; });
    await f.controller.refresh();
    const state = f.controller.getState();
    assert.equal(f.double.count('doc.list'), 2, 'one manifest read and one conflict read, with no retry');
    assert.equal(f.double.count('doc.get'), 0, 'failed listings never reach document reads');
    assert.equal(f.commitCount(), 0);
    assert.equal(f.double.count('doc.put'), 0);
    assert.equal(f.double.documents.size, 0);
    assert.deepEqual(f.notified, []);
    assert.equal(classifyDesignError(state.cause, IMPORTS_CONTEXTS.read).kind, 'unavailable');
    assert.equal(state.status, 'error');
    // Reads are typed too: a lost read is unavailable (nothing changed), with a Retry.
    const feedback = feedbackOf(state.cause);
    assert.deepEqual([feedback.status, feedback.action?.kind, feedback.meta], ['Unavailable', 'retry', 'imports.read']);
    assert.ok(state.message !== null && state.message.length > 0);
  });

  it('a failed explicit history read preserves an unknown write for a later read-only Check', async () => {
    const f = setup();
    f.pick(pngFile('home.png'));
    await f.controller.choose();
    f.double.loseNextCommitReply();
    await f.controller.apply();
    assert.equal(f.controller.getState().outcome?.checkable, true);
    const writes = f.commitCount();
    f.double.failWith((route) => { if (route === 'doc.list') throw new Error('History unavailable'); });
    await f.controller.refresh();
    assert.equal(f.controller.getState().status, 'error');
    assert.equal(f.controller.getState().outcome?.tone, 'unknown');
    assert.equal(f.controller.getState().outcome?.checkable, true);
    f.double.failWith(null);
    await f.controller.check();
    assert.equal(f.controller.getState().status, 'applied');
    assert.equal(f.controller.getState().outcome?.title, 'The import had landed');
    assert.equal(f.controller.getState().outcome?.reconciles, true);
    assert.equal(f.commitCount(), writes, 'history refresh and Check never repeat the unknown write');
  });
});

describe('large accepted PNGs get a deterministic thumbnail in the same atomic import', () => {
  const MIB2 = 2 * 1024 * 1024;
  const sha = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  type Op = DesignServiceParams['import.commit']['ops'][number];
  const blobsOf = (ops: readonly Op[]) => ops.filter((op): op is Extract<Op, { op: 'put-blob' }> => op.op === 'put-blob');
  const dimensions = (bytes: Uint8Array) => { const view = new DataView(bytes.buffer, bytes.byteOffset); return [view.getUint32(16), view.getUint32(20)]; };
  const large = (name: string, seed = 1, width = 900, height = 600): Picked => ({ name, mediaType: 'image/png', bytes: largeImportPng(seed, width, height) });
  const thumbnailOf = (ops: readonly Op[], source: Uint8Array) => blobsOf(ops).filter((op) => op.digest !== sha(source));

  it('carries a thumbnail blob in the same import.commit, and the linked version points at it', async () => {
    const f = setup();
    const file = large('poster.png');
    assert.ok(file.bytes.byteLength > MIB2, 'the fixture is over the Projects thumbnail cap');
    f.pick(file);
    await f.controller.choose();
    await f.controller.apply();
    assert.equal(f.controller.getState().status, 'applied', f.controller.getState().message ?? '');
    assert.equal(f.commitCount(), 1, 'one atomic batch');
    assert.equal(f.double.count('doc.put'), 0);
    const ops = f.double.commits[0]!.ops;
    assert.equal(blobsOf(ops).length, 2, 'the accepted image and one thumbnail');
    const [thumb] = thumbnailOf(ops, file.bytes);
    assert.ok(thumb, 'a thumbnail blob');
    assert.equal(thumb.mediaType, 'image/png');
    assert.equal(thumb.digest, sha(thumb.bytes));
    assert.ok(thumb.bytes.byteLength <= MIB2);
    const contentIndex = ops.findIndex((op) => op.op === 'put-document' && op.key === CONTENT_DOCUMENT);
    assert.ok(contentIndex > ops.indexOf(thumb), 'the thumbnail blob comes before the content document that points at it');
    assert.deepEqual(dimensions(thumb.bytes), [512, 341]);

    const version = (await f.content()).versions[0]!;
    assert.deepEqual(version.thumbnail, { digest: thumb.digest, mediaType: 'image/png', bytes: thumb.bytes.byteLength, w: 512, h: 341 });
    assert.ok(Math.max(version.thumbnail!.w!, version.thumbnail!.h!) <= 512);
    // Marks bind to the real pixels, never to the thumbnail.
    assert.equal(version.capture.captureDigest, sha(file.bytes));
    assert.notEqual(version.capture.captureDigest, version.thumbnail!.digest);
    assert.deepEqual(version.capture.viewport, { w: 900, h: 600, dpr: 1 });
    const resolved = await createWorkspaceThumbnailPort(f.documents).readThumbnail(version.thumbnail!, new AbortController().signal);
    assert.deepEqual([resolved.mediaType, [...resolved.bytes]], ['image/png', [...thumb.bytes]]);
    assert.deepEqual(f.notified, [1]);
  });

  it('keeps rights, provenance and deterministic IDs on the imports records; the thumbnail is a pure function of the image', async () => {
    const [a, b] = [setup(), setup()];
    const file = large('poster.png', 3);
    const digests: string[] = [];
    for (const f of [a, b]) {
      f.pick(file);
      await f.controller.choose();
      await f.controller.apply();
      digests.push((await f.content()).versions[0]!.thumbnail!.digest);
    }
    assert.equal(digests[0], digests[1], 'two independent imports of the same bytes make the same thumbnail');
    assert.deepEqual((await a.content()).versions[0]!.id, (await b.content()).versions[0]!.id);
    const record = (await listRecords(a.env.deps, importsProject(project.id)))[0]!;
    assert.match(record.versionId, /^ver_[0-9a-f]{32}$/u);
    const stored = a.double.documents.get(`design/imports/versions/${record.versionId}`)!.value as { content: { digest: string; bytes: number }; rights: { basis: string }; provenance: { itemKey: string } };
    assert.equal(stored.content.digest, sha(file.bytes), 'the imports version still describes the full image');
    assert.equal(stored.content.bytes, file.bytes.byteLength);
    assert.equal(stored.rights.basis, 'owned');
    assert.equal(stored.provenance.itemKey, 'poster.png');
  });

  it('re-picking the identical file makes no commit and no thumbnail', async () => {
    const f = setup();
    f.pick(large('poster.png'));
    await f.controller.choose();
    await f.controller.apply();
    const before = JSON.stringify([...f.double.documents.entries()]);
    const blobs = f.double.blobs.size;
    f.pick(large('poster.png'));
    await f.controller.choose();
    assert.equal(f.controller.getState().summary?.canApply, false);
    assert.match(f.controller.getState().summary?.headline ?? '', /^Already imported/u);
    await f.controller.apply();
    assert.equal(f.commitCount(), 1);
    assert.equal(JSON.stringify([...f.double.documents.entries()]), before);
    assert.equal(f.double.blobs.size, blobs);
    assert.deepEqual(f.notified, [1]);
  });

  it('a large PNG that cannot be decoded is imported and linked with no thumbnail, and the import succeeds', async () => {
    const f = setup();
    const interlaced = { name: 'interlaced.png', mediaType: 'image/png' as const, bytes: buildPng({ width: 900, height: 600, interlace: 1, seed: 4 }) };
    const padded = new Uint8Array(MIB2 + 4096);
    padded.set(syntheticImportPng(640, 480, 9));
    f.pick(interlaced, { name: 'header-only.png', mediaType: 'image/png', bytes: padded });
    await f.controller.choose();
    await f.controller.apply();
    assert.equal(f.controller.getState().status, 'applied', f.controller.getState().message ?? '');
    const ops = f.double.commits[0]!.ops;
    assert.equal(blobsOf(ops).length, 2, 'only the two accepted images: no thumbnail blob');
    const content = await f.content();
    assert.equal(content.versions.length, 2, 'both are linked');
    assert.deepEqual(content.versions.map((version) => version.thumbnail), [undefined, undefined]);
    assert.ok(content.versions.every((version) => version.capture.captureDigest !== undefined));
  });

  it('the same image under two names is two versions with one thumbnail blob operation', async () => {
    const f = setup();
    const png = largeImportPng(5);
    f.pick({ name: 'one.png', mediaType: 'image/png', bytes: png }, { name: 'two.png', mediaType: 'image/png', bytes: new Uint8Array(png) });
    await f.controller.choose();
    await f.controller.apply();
    assert.equal(f.controller.getState().status, 'applied', f.controller.getState().message ?? '');
    const ops = f.double.commits[0]!.ops;
    assert.equal(blobsOf(ops).length, 2, 'one image blob and one thumbnail blob');
    const content = await f.content();
    assert.equal(content.versions.length, 2);
    assert.equal(content.versions[0]!.thumbnail!.digest, content.versions[1]!.thumbnail!.digest);
    assert.equal(blobsOf(ops).filter((op) => op.digest === content.versions[0]!.thumbnail!.digest).length, 1);
    assert.equal(content.views.length, 2);
  });

  it('a PNG at or under 2 MiB behaves exactly as before: it is its own thumbnail, with no extra blob', async () => {
    const f = setup();
    const png = buildPng({ width: 400, height: 300, seed: 6 });
    assert.ok(png.byteLength > 400_000 && png.byteLength <= MIB2);
    f.pick({ name: 'small.png', mediaType: 'image/png', bytes: png }, pngFile('header.png', 2, 320, 200));
    await f.controller.choose();
    await f.controller.apply();
    const ops = f.double.commits[0]!.ops;
    assert.equal(blobsOf(ops).length, 2, 'the two accepted images only');
    for (const version of (await f.content()).versions) {
      assert.equal(version.thumbnail!.digest, version.capture.captureDigest);
    }
    assert.equal((await f.content()).versions.find((version) => version.label === 'Imported small.png')!.thumbnail!.bytes, png.byteLength);
  });

  it('taking the incoming version after a conflict generates the thumbnail from the stored blob', async () => {
    const f = setup();
    f.pick(pngFile('a.png', 1));
    await f.controller.choose();
    await f.controller.apply();
    for (const record of await listRecords(f.env.deps, importsProject(project.id))) await editImportedRecord(f.env.deps, record.recordId, { title: 'Mine' });
    const incoming = large('a.png', 7);
    f.pick(incoming);
    await f.controller.choose();
    await f.controller.apply();
    await f.controller.refresh();
    assert.equal(f.controller.getState().conflicts.length, 1);
    assert.equal(blobsOf(f.double.commits.at(-1)!.ops).length, 1, 'the conflict batch stores the evidence image and links nothing');
    assert.equal((await f.content()).versions.length, 1);
    const blobReads = f.double.count('blob.get');
    await f.controller.resolve(f.controller.getState().conflicts[0]!.recordId, 'take-incoming');
    const resolveOps = f.double.commits.at(-1)!.ops;
    assert.equal(blobsOf(resolveOps).length, 1, 'no image blob in this batch (it is already stored), only the new thumbnail');
    assert.ok(f.double.count('blob.get') > blobReads, 'the source image was read back from storage');
    const taken = (await f.content()).versions.at(-1)!;
    assert.equal(taken.thumbnail!.digest, blobsOf(resolveOps)[0]!.digest);
    assert.equal(taken.capture.captureDigest, sha(incoming.bytes));
    assert.deepEqual(dimensions(blobsOf(resolveOps)[0]!.bytes), [512, 341]);
  });

  it('a batch whose own operations nearly fill the 64 MiB limit still succeeds, without a thumbnail', { timeout: 120_000 }, async () => {
    const f = setup();
    const files = [1, 2, 3].map((seed): Picked => ({ name: `huge-${seed}.png`, mediaType: 'image/png', bytes: largeImportPng(seed, 2030, 2030) }));
    for (const file of files) assert.ok(file.bytes.byteLength > 16_400_000 && file.bytes.byteLength < 16 * 1024 * 1024);
    f.pick(...files);
    await f.controller.choose();
    await f.controller.apply();
    assert.equal(f.controller.getState().status, 'applied', f.controller.getState().message ?? '');
    const ops = f.double.commits[0]!.ops;
    assert.equal(blobsOf(ops).length, 3, 'only the accepted images');
    const canonical = ops.reduce((sum, op) => sum + (op.op === 'put-blob' ? blobCanonicalBytes(op.bytes.byteLength) : new TextEncoder().encode(JSON.stringify(op)).byteLength), 0);
    assert.ok(canonical <= 64 * 1024 * 1024 && canonical > 64 * 1024 * 1024 - 1_400_000, `the batch is within the limit and has no room for a thumbnail (${canonical})`);
    const content = await f.content();
    assert.equal(content.versions.length, 3, 'every image is linked');
    assert.deepEqual(content.versions.map((version) => version.thumbnail), [undefined, undefined, undefined]);
  });
});

describe('the content link plans thumbnails inside the host limits', () => {
  /** Synthetic link input: records and versions as an import batch would carry them, each pointing at a stored large PNG. */
  async function linkInputs(entries: readonly { n: number; width: number; height: number; digest: string }[]) {
    const f = setup();
    const ops: WriteOp[] = [];
    for (const { n, width, height, digest } of entries) {
      const hex = n.toString(16).padStart(32, '0');
      const [viewId, versionId] = [`view_${hex}`, `ver_${hex}`];
      const version = { schema: SCHEMAS.version, versionId, viewId, projectId: project.id,
        content: { kind: 'image', digest, mediaType: 'image/png', bytes: 3_000_000, w: width, h: height }, rights: { basis: 'owned', holder: 'Owner' }, provenance: { originalName: `n${n}.png` } };
      const record = { schema: SCHEMAS.record, recordId: `rec_${hex}`, projectId: project.id, viewId, versionId, title: `n${n}`, tombstone: null };
      ops.push({ op: 'put-document', namespace: 'workspace', key: `imports/versions/${versionId}`, value: version as never, expectedRevision: null },
        { op: 'put-document', namespace: 'workspace', key: `imports/records/rec_${hex}`, value: record as never, expectedRevision: null });
    }
    const link = createImportsContentLink({ repository: f.repository, clock: { now: () => '2026-11-17T00:00:00.000Z' }, documentKey: () => CONTENT_DOCUMENT, notify: () => {} });
    const read = async () => null;
    return { link, ops, read };
  }

  const source = largeImportPng(2);
  const context = (overrides: Partial<ImportsLinkContext> = {}, reads: string[] = []): ImportsLinkContext => ({
    readBlob: async (digest) => { reads.push(digest); return new Uint8Array(source); }, remainingBytes: 64 * 1024 * 1024, remainingOps: 10_000, ...overrides,
  });
  const digest = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
  const thumbsIn = (ops: readonly WriteOp[]) => ops.filter((op) => op.op === 'put-blob');
  const contentVersions = (ops: readonly WriteOp[]) => ((ops.find((op) => op.op === 'put-document')! as unknown as { value: { versions: { thumbnail?: unknown }[] } }).value.versions);

  it('adds one thumbnail blob before the content document when the batch has room', async () => {
    const { link, ops, read } = await linkInputs([{ n: 1, width: 900, height: 600, digest: digest(1) }]);
    const planned = await link.plan(ops, read, context());
    assert.deepEqual(planned.ops.map((op) => op.op), ['put-blob', 'put-document']);
    assert.deepEqual(planned.projects, [project.id]);
    assert.ok(contentVersions(planned.ops)[0]!.thumbnail);
  });

  it('without a context there is no source to read: the version links with no thumbnail', async () => {
    const { link, ops, read } = await linkInputs([{ n: 1, width: 900, height: 600, digest: digest(1) }]);
    const planned = await link.plan(ops, read);
    assert.deepEqual(planned.ops.map((op) => op.op), ['put-document']);
    assert.equal(contentVersions(planned.ops)[0]!.thumbnail, undefined);
  });

  it('skips the thumbnail, and never reads the image, when the free bytes cannot hold it', async () => {
    const { link, ops, read } = await linkInputs([{ n: 1, width: 900, height: 600, digest: digest(1) }]);
    const reads: string[] = [];
    const planned = await link.plan(ops, read, context({ remainingBytes: 500_000 }, reads));
    assert.deepEqual(planned.ops.map((op) => op.op), ['put-document'], 'the content document is still written');
    assert.deepEqual(reads, [], 'a thumbnail that cannot fit is not even decoded');
  });

  it('uses the free bytes exactly: it fits at the boundary and is skipped one byte short', async () => {
    const { link, ops, read } = await linkInputs([{ n: 1, width: 900, height: 600, digest: digest(1) }]);
    const roomy = await link.plan(ops, read, context());
    const thumb = thumbsIn(roomy.ops)[0] as Extract<WriteOp, { op: 'put-blob' }>;
    const cost = blobCanonicalBytes(thumb.bytes.byteLength);
    const content = JSON.stringify((roomy.ops.find((op) => op.op === 'put-document') as { value: unknown }).value).length;
    // Find the smallest free-byte count that still fits by probing around the cost plus the reserved content growth.
    let smallest = Infinity;
    for (let free = cost; free <= cost + content + 20_000; free += 1) {
      const planned = await link.plan(ops, read, context({ remainingBytes: free }));
      if (thumbsIn(planned.ops).length === 1) { smallest = free; break; }
    }
    assert.ok(Number.isFinite(smallest) && smallest > cost, 'the content document growth is reserved on top of the thumbnail');
    assert.equal(thumbsIn((await link.plan(ops, read, context({ remainingBytes: smallest - 1 }))).ops).length, 0);
    assert.equal(thumbsIn((await link.plan(ops, read, context({ remainingBytes: smallest }))).ops).length, 1);
  });

  it('keeps one operation free for the content document: a thumbnail needs two free operations', async () => {
    const { link, ops, read } = await linkInputs([{ n: 1, width: 900, height: 600, digest: digest(1) }]);
    assert.equal(thumbsIn((await link.plan(ops, read, context({ remainingOps: 1 }))).ops).length, 0);
    assert.equal(thumbsIn((await link.plan(ops, read, context({ remainingOps: 2 }))).ops).length, 1);
  });

  it('decodes at most 150 million source pixels per batch; later versions get no thumbnail', async () => {
    const { link, ops, read } = await linkInputs([
      { n: 1, width: 10_000, height: 10_000, digest: digest(1) }, { n: 2, width: 10_000, height: 10_000, digest: digest(2) },
      { n: 3, width: 900, height: 600, digest: digest(3) },
    ]);
    const reads: string[] = [];
    const planned = await link.plan(ops, read, context({}, reads));
    assert.deepEqual(reads, [digest(1)], 'only the first image was decoded');
    assert.deepEqual(contentVersions(planned.ops).map((version) => version.thumbnail !== undefined), [true, false, false],
      'once the pixel ceiling is hit, no later version is decoded');
  });

  it('a source that cannot be read, or a reader that throws, links with no thumbnail', async () => {
    const { link, ops, read } = await linkInputs([{ n: 1, width: 900, height: 600, digest: digest(1) }]);
    const missing = await link.plan(ops, read, context({ readBlob: async () => null }));
    assert.deepEqual(missing.ops.map((op) => op.op), ['put-document']);
    const throwing = await link.plan(ops, read, context({ readBlob: async () => { throw new Error('storage failed'); } }));
    assert.deepEqual(throwing.ops.map((op) => op.op), ['put-document']);
    const garbage = await link.plan(ops, read, context({ readBlob: async () => new Uint8Array(3_000_000) }));
    assert.deepEqual(garbage.ops.map((op) => op.op), ['put-document']);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CompareController, CompareSnapshot } from '../../../compare/src/controller.ts';
import { captureId, comparisonId, panelId, projectId as compareProjectId, versionId as compareVersionId, viewId as compareViewId } from '../../../compare/src/ids.ts';
import { createComparison } from '../../../compare/src/model.ts';
import { comparisonKey, serializeComparison } from '../../../compare/src/persist.ts';
import { addVersion, addView } from '../../../projects/src/content.ts';
import { projectId, versionId, viewId } from '../../../projects/src/ids.ts';
import { contentKey, ProjectContentRepository } from '../../../projects/src/repository.ts';
import { createCompareStorage, createProjectsStorage } from '../../storage/index.ts';
import { PROJECTS_KEY_ROOT } from '../../storage/section-documents.ts';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createBridgedWorkspace } from '../bridged-workspace.ts';
import { createProjectCompareCatalog } from '../compare-catalog.ts';
import { createTransportDouble } from './bridge-double.ts';

const alpha = { id: 'project-alpha', name: 'Same display name' };
const beta = { id: 'project-beta', name: 'Same display name' };
const view = viewId('view-shared');
const first = versionId('version-first');
const second = versionId('version-second');
const digest = `sha256:${'a'.repeat(64)}`;
const viewport = { w: 320, h: 640, dpr: 1 };
const clock = { now: () => '2026-01-01T00:00:00Z' };
const physicalContentKey = (id: ReturnType<typeof projectId>) => PROJECTS_KEY_ROOT + contentKey(id);

async function fixture() {
  const double = createTransportDouble();
  const documents = createBridgeWorkspaceDocuments(double.transport);
  const workspace = createBridgedWorkspace(documents);
  const repository = new ProjectContentRepository(createProjectsStorage(documents), clock);
  for (const project of [alpha, beta]) {
    await repository.update(projectId(project.id), (content, now) => addVersion(
      addView(content, { id: view, title: 'Same view title', kind: 'screen' }, now),
      { id: first, viewId: view, label: `${project.id} original`, origin: 'synthetic-fixture',
        capture: { route: `/${project.id}`, viewport, sourceRevision: 'source-original', captureDigest: digest },
        thumbnail: { digest, mediaType: 'image/png', bytes: 10, w: 320, h: 640 } }, now));
  }
  return { double, documents, workspace, repository, catalog: createProjectCompareCatalog(repository, projectId(alpha.id)) };
}

async function until(controller: CompareController, matches: (snapshot: CompareSnapshot) => boolean): Promise<CompareSnapshot> {
  let release: (() => void) | undefined;
  try {
    return await new Promise((resolve) => {
      const read = () => { const snapshot = controller.getSnapshot(); if (matches(snapshot)) resolve(snapshot); };
      release = controller.subscribe(read);
      read();
    });
  } finally { release?.(); }
}

describe('project-bound Compare catalog', () => {
  it('reads exact project/view/version identities without matching names, enumerating other projects, or reading blobs', async () => {
    const { double, repository, catalog } = await fixture();
    const start = double.calls.length;
    assert.deepEqual(await catalog.listViews(compareProjectId(beta.id)), []);
    assert.equal(double.calls.length, start, 'another project is refused before reading');
    assert.deepEqual(await catalog.listViews(compareProjectId(alpha.id)), [
      { projectId: compareProjectId(alpha.id), viewId: compareViewId(view), name: 'Same view title' },
    ]);
    const exact = await catalog.getVersion(compareVersionId(first));
    assert.deepEqual(exact, {
      projectId: compareProjectId(alpha.id), viewId: compareViewId(view), versionId: compareVersionId(first),
      label: 'project-alpha original', createdAt: clock.now(),
      sourceRevision: 'source-original', route: '/project-alpha', state: '', captures: [],
    });
    const other = createProjectCompareCatalog(repository, projectId(beta.id));
    assert.equal((await other.getVersion(compareVersionId(first)))?.route, '/project-beta', 'identical version IDs remain scoped to their project');
    assert.deepEqual(await catalog.listVersions(compareViewId('missing-view')), []);
    assert.equal(await catalog.getVersion(compareVersionId('missing-version')), null);
    const calls = double.calls.slice(start);
    assert.ok(calls.every((call) => call.route === 'doc.get'));
    assert.ok(calls.every((call) => call.params && 'key' in call.params
      && [physicalContentKey(projectId(alpha.id)), physicalContentKey(projectId(beta.id))].includes(call.params.key)));
  });

  it('sees appended versions on later reads without rebinding an earlier exact version or accepting moving aliases', async () => {
    const { repository, catalog, double } = await fixture();
    const before = await catalog.getVersion(compareVersionId(first));
    await repository.update(projectId(alpha.id), (content, now) => addVersion(content, {
      id: second, viewId: view, label: 'Appended version', origin: 'owner-created',
      capture: { route: '/appended', viewport }, basedOn: first,
    }, now));
    assert.deepEqual(await catalog.getVersion(compareVersionId(first)), before);
    assert.equal((await catalog.getVersion(compareVersionId(second)))?.route, '/appended');
    assert.deepEqual((await catalog.listVersions(compareViewId(view))).map((item) => item.versionId), [first, second]);
    const start = double.calls.length;
    for (const alias of ['latest', 'HEAD', 'current', 'newest', 'tip']) assert.equal(await catalog.getVersion(alias as ReturnType<typeof compareVersionId>), null);
    assert.equal(double.calls.length, start);
    assert.deepEqual(before?.captures, [], 'a thumbnail and digest do not establish static capture provenance');
  });

  it('keeps missing content empty and corrupt, foreign or future content explicit without writing', async () => {
    const { catalog, documents, double, repository } = await fixture();
    const empty = createProjectCompareCatalog(repository, projectId('project-empty'));
    assert.deepEqual(await empty.listViews(compareProjectId('project-empty')), []);
    assert.equal(await empty.getVersion(compareVersionId(first)), null);
    const betaDocument = await documents.getDocument(physicalContentKey(projectId(beta.id)));
    assert.ok(betaDocument, 'the foreign-project fixture exists');
    for (const [value, reason] of [
      [{ schema: 'hq.design.project-content/v99' }, 'unsupported-schema'],
      [{ schema: 'hq.design.project-content/v1' }, 'invalid'],
      [betaDocument.value, 'invalid'],
    ] as const) {
      await documents.putDocument(physicalContentKey(projectId(alpha.id)), value);
      const writes = double.calls.filter((call) => call.route === 'doc.put').length;
      await assert.rejects(catalog.getVersion(compareVersionId(first)), new RegExp(reason));
      await assert.rejects(catalog.listVersions(compareViewId(view)), new RegExp(reason));
      assert.equal(double.calls.filter((call) => call.route === 'doc.put').length, writes);
    }
  });

  it('honors cancellation before I/O and after a noncancellable document read returns', async () => {
    const { documents } = await fixture();
    const stored = await documents.getDocument(physicalContentKey(projectId(alpha.id)));
    assert.ok(stored, 'the cancellation fixture exists');
    let reads = 0;
    let finish!: (value: typeof stored) => void;
    const repository = new ProjectContentRepository(createProjectsStorage({ ...documents, getDocument() {
      reads++;
      return new Promise((resolve) => { finish = resolve; });
    } }), clock);
    const catalog = createProjectCompareCatalog(repository, projectId(alpha.id));
    const abort = new AbortController();
    const pending = catalog.getVersion(compareVersionId(first), abort.signal);
    assert.equal(reads, 1);
    abort.abort();
    finish(stored);
    await assert.rejects(pending, { name: 'AbortError' });
    await assert.rejects(catalog.getVersion(compareVersionId(first), abort.signal), { name: 'AbortError' });
    await assert.rejects(catalog.listVersions(compareViewId(view), abort.signal), { name: 'AbortError' });
    await assert.rejects(catalog.listViews(compareProjectId(alpha.id), abort.signal), { name: 'AbortError' });
    assert.equal(reads, 1);
  });

  it('rejects IDs unsupported by Compare instead of truncating or renaming them', async () => {
    const { repository, catalog } = await fixture();
    await repository.update(projectId(alpha.id), (content, now) => addView(content, { id: viewId('view with spaces'), title: 'Valid Projects view', kind: 'screen' }, now));
    await assert.rejects(catalog.listViews(compareProjectId(alpha.id)), /Invalid ViewId/u);
    assert.throws(() => createProjectCompareCatalog(repository, projectId('p'.repeat(129))), /Invalid ProjectId/u);
  });
});

describe('production Compare composition', () => {
  it('keeps two project controllers separate even when their view and version IDs collide', { timeout: 3000 }, async () => {
    const { documents, workspace } = await fixture();
    for (const project of [alpha, beta]) {
      const id = comparisonId(`${project.id}-compare`);
      const saved = createComparison(id, compareProjectId(project.id), [{ id: panelId('same-panel'), viewport,
        source: { kind: 'live-preview', versionId: compareVersionId(first), route: `/${project.id}`, state: '' } }]);
      await createCompareStorage(documents).write(comparisonKey(id), serializeComparison(saved));
    }
    const a = await workspace.compareFor(alpha);
    const b = await workspace.compareFor(beta);
    try {
      assert.notEqual(a, b);
      for (const [controller, project] of [[a, alpha], [b, beta]] as const) {
        const snapshot = await until(controller, (value) => value.runtime.get(panelId('same-panel'))?.status === 'unavailable');
        assert.equal(snapshot.runtime.get(panelId('same-panel'))?.version?.projectId, project.id);
        assert.equal(snapshot.runtime.get(panelId('same-panel'))?.version?.route, `/${project.id}`);
        assert.equal(snapshot.runtime.get(panelId('same-panel'))?.session, null);
        assert.equal(snapshot.preview, null);
      }
      assert.equal(await workspace.compareFor({ ...alpha, name: 'Renamed display only' }), a);
    } finally { a.dispose(); b.dispose(); }
  });

  it('resolves saved exact versions, preserves missing captures, and reopens the layout without writes', { timeout: 3000 }, async () => {
    const { workspace, documents, double, repository } = await fixture();
    await repository.update(projectId(alpha.id), (content, now) => addVersion(content, {
      id: second, viewId: view, label: 'Newer version', origin: 'owner-created', capture: { route: '/newer', viewport },
    }, now));
    const id = comparisonId(`${alpha.id}-compare`);
    const saved = createComparison(id, compareProjectId(alpha.id), [{ id: panelId('saved-panel'), role: 'baseline', viewport,
      source: { kind: 'static-capture', versionId: compareVersionId(first), captureId: captureId('saved-capture'), captureDigest: digest } }]);
    await createCompareStorage(documents).write(comparisonKey(id), serializeComparison(saved));
    const start = double.calls.length;
    for (const instance of [workspace, createBridgedWorkspace(documents)]) {
      const controller = await instance.compareFor(alpha);
      try {
        const snapshot = await until(controller, (value) => value.runtime.get(panelId('saved-panel'))?.status === 'failed'
          && value.versions.has(compareViewId(view)));
        assert.deepEqual(snapshot.comparison, saved);
        assert.equal(snapshot.runtime.get(panelId('saved-panel'))?.version?.versionId, first);
        assert.equal(snapshot.runtime.get(panelId('saved-panel'))?.version?.projectId, alpha.id);
        assert.equal(snapshot.runtime.get(panelId('saved-panel'))?.imageSrc, null);
        assert.match(snapshot.runtime.get(panelId('saved-panel'))!.error!, /pinned capture is not available/u);
        assert.deepEqual(snapshot.versions.get(compareViewId(view))!.map((version) => version.versionId), [first, second]);
        assert.equal(snapshot.preview, null);
        assert.equal(snapshot.dirty, false);
        await controller.selectVersion(panelId('saved-panel'), compareVersionId('missing-version'));
        assert.equal(controller.getSnapshot().lastError, 'unknown-version');
        assert.deepEqual(controller.getSnapshot().comparison, saved);
      } finally { controller.dispose(); }
    }
    assert.ok(double.calls.slice(start).every((call) => call.route === 'doc.get'), 'reads neither write layouts nor fetch arbitrary capture bytes');
  });

  it('refuses a saved layout belonging to another project before resolving any version', async () => {
    const { documents, workspace, double } = await fixture();
    const id = comparisonId(`${alpha.id}-compare`);
    const foreign = createComparison(id, compareProjectId(beta.id), [{ id: panelId('foreign-panel'), viewport,
      source: { kind: 'live-preview', versionId: compareVersionId(first), route: '/project-beta', state: '' } }]);
    await createCompareStorage(documents).write(comparisonKey(id), serializeComparison(foreign));
    const start = double.calls.length;
    await assert.rejects(workspace.compareFor(alpha), /belongs to another project/u);
    assert.equal(double.calls.length - start, 1);
  });
});

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { ProjectsController, ProjectsSnapshot } from '../../../projects/src/controller.ts';
import { projectId as projectsProjectId } from '../../../projects/src/ids.ts';
import type { CompareController, CompareSnapshot } from '../../../compare/src/controller.ts';
import { comparisonId, panelId, projectId as compareProjectId, versionId as compareVersionId, viewId as compareViewId } from '../../../compare/src/ids.ts';
import { createComparison } from '../../../compare/src/model.ts';
import { comparisonKey, serializeComparison } from '../../../compare/src/persist.ts';
import { createCompareStorage } from '../../storage/index.ts';
import { createDesignWorkspace } from '../workspace.ts';
import { createBridgedWorkspace } from '../bridged-workspace.ts';
import { DesignOperationError } from '../errors.ts';
import { alpha, beta, dataUrl, digestOf, durableFixture, installDesktopCatalog, png, saveVersion, seedRawContent } from './content-fixtures.ts';

const viewport = { w: 320, h: 640, dpr: 1 };
let restoreWindow: (() => void) | null = null;
afterEach(() => { restoreWindow?.(); restoreWindow = null; });

const contentGets = (calls: readonly { route: string; params: unknown }[], project: string) =>
  calls.filter((call) => call.route === 'doc.get' && (call.params as { key: string }).key.includes(project)).length;

async function untilProjects(controller: ProjectsController, matches: (snapshot: ProjectsSnapshot) => boolean): Promise<ProjectsSnapshot> {
  return new Promise((resolve) => {
    const check = () => { if (matches(controller.getSnapshot())) { stop(); resolve(controller.getSnapshot()); } };
    const stop = controller.subscribe(check);
    check();
  });
}

async function untilCompare(controller: CompareController, matches: (snapshot: CompareSnapshot) => boolean): Promise<CompareSnapshot> {
  return new Promise((resolve) => {
    const check = () => { if (matches(controller.getSnapshot())) { stop(); resolve(controller.getSnapshot()); } };
    const stop = controller.subscribe(check);
    check();
  });
}

describe('project content snapshot follows the project', () => {
  it('keeps one snapshot until the project changes, then shows what was saved', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'v1', digest: f.store(png(1)) });
    const first = f.workspace.contentFor(alpha);
    assert.equal(f.workspace.contentFor(alpha), first, 'stable promise for React use()');
    assert.deepEqual((await first).content.versions.map((version) => version.id), ['v1']);
    await saveVersion(f, alpha, { id: 'v2', digest: f.store(png(2)) });
    const second = f.workspace.contentFor(alpha);
    assert.notEqual(second, first);
    assert.deepEqual((await second).content.versions.map((version) => version.id), ['v1', 'v2']);
    assert.equal((await second).repository, (await first).repository, 'the repository itself is not rebuilt');
  });

  it('does not re-read this project for another project’s change', async () => {
    const f = durableFixture();
    await f.workspace.contentFor(alpha);
    await f.workspace.contentFor(beta);
    const reads = f.double.calls.length;
    f.contentEvents.notify(beta.id);
    f.contentEvents.notify('some-unrelated-project');
    await f.workspace.contentFor(alpha);
    assert.equal(f.double.calls.length, reads, 'alpha served from its cache');
    await f.workspace.contentFor(beta);
    assert.equal(contentGets(f.double.calls, beta.id), 2, 'beta re-read once');
  });

  it('Taste regression (PR #168 P2): versions saved after the first Taste visit appear in the snapshot Taste reads', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'first-visit' });
    assert.deepEqual((await f.workspace.contentFor(alpha)).content.versions.map((version) => version.id), ['first-visit']);
    // Later: a live capture is accepted, and an import links more versions.
    await saveVersion(f, alpha, { id: 'live-capture', digest: f.store(png(2)) });
    await saveVersion(f, alpha, { id: 'imported' });
    assert.deepEqual((await f.workspace.contentFor(alpha)).content.versions.map((version) => version.id), ['first-visit', 'live-capture', 'imported']);
  });

  it('only a writer that announces its change is seen: an unannounced write waits for the next announcement', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'v1' });
    await f.workspace.contentFor(alpha);
    await saveVersion(f, alpha, { id: 'v2' }, false);
    assert.deepEqual((await f.workspace.contentFor(alpha)).content.versions.map((version) => version.id), ['v1']);
    f.contentEvents.notify(alpha.id);
    assert.deepEqual((await f.workspace.contentFor(alpha)).content.versions.map((version) => version.id), ['v1', 'v2']);
  });

  it('serves the previous snapshot to a view that still shows it while the new snapshot loads', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'v1' });
    const gate: { held: Promise<void> | null } = { held: null };
    const workspace = createBridgedWorkspace({ ...f.documents, async getDocument(key) { if (gate.held) await gate.held; return f.documents.getDocument(key); } },
      { contentEvents: f.contentEvents });
    const shown = workspace.contentFor(alpha);
    await shown;
    const showing = f.contentEvents.revision(alpha.id);
    let release!: () => void;
    gate.held = new Promise<void>((resolve) => { release = resolve; });
    await saveVersion(f, alpha, { id: 'v2' });
    const fresh = workspace.contentFor(alpha);
    assert.notEqual(fresh, shown);
    assert.equal(workspace.contentFor(alpha, { revision: showing }), shown, 'a mounted view keeps its content, not a loading state');
    release();
    assert.deepEqual((await fresh).content.versions.map((version) => version.id), ['v1', 'v2']);
  });

  it('serves the fake workspace unchanged: same fixtures, same promises, and a revision argument it ignores', async () => {
    const workspace = createDesignWorkspace(null);
    assert.equal(workspace.bridged, false);
    const first = workspace.contentFor(alpha);
    assert.equal(workspace.contentFor(alpha, { revision: 7 }), first);
    workspace.contentEvents.notify(alpha.id);
    assert.equal(workspace.contentFor(alpha), first, 'synthetic fixtures do not change');
    assert.equal(workspace.contentEvents.revision(alpha.id), 1);
    assert.ok((await first).content.versions.length > 0);
  });
});

describe('Annotations follow the project’s newest stored capture', () => {
  it('opens on a capture saved after the first visit, without rebuilding the controller', async () => {
    const f = durableFixture();
    const earlier = png(1);
    await saveVersion(f, alpha, { id: 'v1', digest: f.store(earlier) });
    const before = (await f.workspace.annotationSessionFor(alpha))!;
    assert.equal(before.target.captureUrl, dataUrl(earlier));
    const later = png(2);
    await saveVersion(f, alpha, { id: 'live-capture', digest: f.store(later) });
    const after = (await f.workspace.annotationSessionFor(alpha))!;
    assert.equal(after.target.version, 'live-capture');
    assert.equal(after.target.captureUrl, dataUrl(later));
    assert.equal(after.target.frame.captureDigest, digestOf(later));
    assert.notEqual(after.controller, before.controller, 'marks are per exact version');
    assert.equal((await f.workspace.annotationSessionFor(alpha, { selection: 'v1' }))!.controller, before.controller);
  });
});

describe('Compare follows the project without losing the layout', () => {
  it('lists versions saved later in the same controller and keeps unsaved layout changes', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'v1' });
    const id = comparisonId(`${alpha.id}-compare`);
    const saved = createComparison(id, compareProjectId(alpha.id), [{ id: panelId('p1'), viewport,
      source: { kind: 'live-preview', versionId: compareVersionId('v1'), route: '/main', state: '' } }]);
    await createCompareStorage(f.documents).write(comparisonKey(id), serializeComparison(saved));
    const controller = await f.workspace.compareFor(alpha);
    try {
      const view = compareViewId('view-main');
      const first = await untilCompare(controller, (snapshot) => snapshot.versions.get(view)?.length === 1);
      assert.deepEqual(first.versions.get(view)!.map((version) => version.versionId), ['v1']);
      controller.resize(panelId('p1'), 700);
      await saveVersion(f, alpha, { id: 'v2' });
      const refreshed = await untilCompare(controller, (snapshot) => snapshot.versions.get(view)?.length === 2);
      assert.deepEqual(refreshed.versions.get(view)!.map((version) => version.versionId), ['v1', 'v2']);
      assert.equal(await f.workspace.compareFor(alpha), controller, 'same controller: it holds the owner’s layout');
      assert.equal(refreshed.dirty, true);
      assert.equal(refreshed.comparison.panels[0]!.width, 700);
      const catalogReads = f.double.calls.length;
      f.contentEvents.notify(beta.id);
      assert.equal(f.double.calls.length, catalogReads, 'another project’s change reads nothing');
    } finally { controller.dispose(); }
  });
});

describe('Canvas follows the project in place', () => {
  it('lists versions saved later in the same registry, without rebuilding the arrangement session', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'v1' });
    const env = (await f.workspace.canvasFor(alpha))!;
    const versions = () => env.registry.catalog(env.projectId).flatMap((group) => group.items).filter((item) => item.kind === 'view-version').map((item) => item.ref.revision);
    assert.deepEqual(versions(), ['v1']);
    await new Promise<void>((resolve) => {
      const stop = env.registry.subscribe(() => { if (versions().length === 2) { stop(); resolve(); } });
      void saveVersion(f, alpha, { id: 'v2' });
    });
    assert.deepEqual(versions(), ['v1', 'v2']);
    assert.equal(await f.workspace.canvasFor(alpha), env);
  });
});

describe('Projects follows writes made elsewhere and announces its own', () => {
  it('shows a version saved by a capture or import in the open project without reopening it', async () => {
    const f = durableFixture();
    restoreWindow = installDesktopCatalog(f);
    const controller = await f.workspace.projectsFor(alpha);
    const id = projectsProjectId(alpha.id);
    controller.openProject(id);
    await untilProjects(controller, (snapshot) => snapshot.active?.status === 'ready');
    const opened = controller.getSnapshot().active;
    assert.ok(opened?.status === 'ready' && opened.content.versions.length === 0);
    const thumbnail = { digest: digestOf(png(1)), mediaType: 'image/png', bytes: png(1).byteLength, w: 32, h: 20 };
    await saveVersion(f, alpha, { id: 'live-capture', digest: thumbnail.digest, thumbnail });
    const snapshot = await untilProjects(controller, (next) => next.active?.status === 'ready' && next.active.content.versions.length === 1);
    assert.equal(snapshot.summaries.get(id)?.versionCount, 1, 'the gallery tile counts it');
    assert.deepEqual(snapshot.summaries.get(id)?.cover, thumbnail, 'and uses its thumbnail as the cover');
  });

  it('refreshes a project this controller already showed even when another project is the one open', async () => {
    const f = durableFixture();
    restoreWindow = installDesktopCatalog(f);
    const controller = await f.workspace.projectsFor(alpha);
    controller.openProject(projectsProjectId(beta.id));
    await untilProjects(controller, (snapshot) => snapshot.active?.status === 'ready');
    controller.openProject(projectsProjectId(alpha.id));
    await untilProjects(controller, (snapshot) => snapshot.active?.projectId === projectsProjectId(alpha.id) && snapshot.active.status === 'ready');
    await saveVersion(f, beta, { id: 'beta-capture' });
    const snapshot = await untilProjects(controller, (next) => next.summaries.get(projectsProjectId(beta.id))?.versionCount === 1);
    assert.equal(snapshot.summaries.get(projectsProjectId(alpha.id))?.versionCount, 0);
  });

  it('announces a Projects edit so the other sections see the new view', async () => {
    const f = durableFixture();
    restoreWindow = installDesktopCatalog(f);
    const controller = await f.workspace.projectsFor(alpha);
    controller.openProject(projectsProjectId(alpha.id));
    await untilProjects(controller, (snapshot) => snapshot.active?.status === 'ready');
    const before = await f.workspace.contentFor(alpha);
    const revision = f.contentEvents.revision(alpha.id);
    assert.deepEqual(await controller.addView('Landing', 'page'), { ok: true });
    assert.equal(f.contentEvents.revision(alpha.id), revision + 1);
    assert.equal(f.contentEvents.revision(beta.id), 0);
    const after = await f.workspace.contentFor(alpha);
    assert.notEqual(after, before);
    assert.deepEqual(after.content.views.map((view) => view.title), ['Landing']);
  });
});

describe('typed failures from the durable accessors', () => {
  const failure = (error: unknown) => {
    assert.ok(error instanceof DesignOperationError, `expected a DesignOperationError, got ${String(error)}`);
    return error;
  };

  it('projects.load: an unreachable store is unavailable, stays failed for the revision, and recovers after a change', async () => {
    const f = durableFixture();
    f.fail((route) => (route === 'doc.get' ? { ok: false, kind: 'unavailable' } : undefined));
    const broken = f.workspace.contentFor(alpha);
    const error = failure(await broken.then(() => null, (reason: unknown) => reason));
    assert.deepEqual([error.kind, error.section, error.operation, error.outcome, error.recovery], ['unavailable', 'projects', 'projects.load', 'no-effect', 'retry']);
    assert.equal(f.workspace.contentFor(alpha), broken, 'a failure is not re-read in a loop');
    f.fail(null);
    f.contentEvents.notify(alpha.id);
    assert.deepEqual((await f.workspace.contentFor(alpha)).content.versions, []);
  });

  it('projects.load: content saved by a newer HQ is read-only and damaged content is corrupt, never repaired', async () => {
    const f = durableFixture();
    await seedRawContent(f, alpha, { schema: 'hq.design.project-content/v9' });
    const newer = failure(await f.workspace.contentFor(alpha).then(() => null, (reason: unknown) => reason));
    assert.deepEqual([newer.kind, newer.reason, newer.operation], ['read-only', 'unsupported-stored-schema', 'projects.load']);
    await seedRawContent(f, beta, { schema: 'hq.design.project-content/v1', surprise: true });
    const damaged = failure(await f.workspace.contentFor(beta).then(() => null, (reason: unknown) => reason));
    assert.deepEqual([damaged.kind, damaged.reason, damaged.recovery], ['corrupt', 'invalid-content', 'none']);
    assert.equal(f.double.calls.some((call) => call.route === 'doc.put'), false);
  });

  it('annotations.open: a missing version is not-found; a failing project load keeps its own operation name', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'v1', digest: f.store(png(1)) });
    const missing = failure(await f.workspace.annotationSessionFor(alpha, { selection: 'nope' }).then(() => null, (reason: unknown) => reason));
    assert.deepEqual([missing.kind, missing.operation], ['not-found', 'annotations.open']);
    f.fail((route) => (route === 'doc.get' ? { ok: false, kind: 'unavailable' } : undefined));
    f.contentEvents.notify(alpha.id);
    const unreadable = failure(await f.workspace.annotationSessionFor(alpha).then(() => null, (reason: unknown) => reason));
    assert.deepEqual([unreadable.kind, unreadable.operation], ['unavailable', 'projects.load']);
  });

  it('compare.load: a layout of another project or in a newer format is refused untouched', async () => {
    const f = durableFixture();
    const storage = createCompareStorage(f.documents);
    const id = comparisonId(`${alpha.id}-compare`);
    await storage.write(comparisonKey(id), serializeComparison(createComparison(id, compareProjectId(beta.id), [{ id: panelId('foreign'), viewport,
      source: { kind: 'live-preview', versionId: compareVersionId('v1'), route: '/main', state: '' } }])));
    const foreign = failure(await f.workspace.compareFor(alpha).then(() => null, (reason: unknown) => reason));
    assert.deepEqual([foreign.kind, foreign.operation, foreign.reason], ['corrupt', 'compare.load', 'wrong-project']);
    assert.match(foreign.message, /belongs to another project/u);
    await storage.write(comparisonKey(id), JSON.stringify({ schema: 'hq.design.comparison/v9' }));
    f.contentEvents.notify(alpha.id);
    const newer = failure(await f.workspace.compareFor(alpha).then(() => null, (reason: unknown) => reason));
    assert.deepEqual([newer.kind, newer.reason], ['read-only', 'unsupported-stored-schema']);
    await storage.write(comparisonKey(id), 'not json');
    f.contentEvents.notify(alpha.id);
    const damaged = failure(await f.workspace.compareFor(alpha).then(() => null, (reason: unknown) => reason));
    assert.deepEqual([damaged.kind, damaged.reason], ['corrupt', 'invalid-comparison']);
  });

  it('flows.load: an unreachable store is a typed read failure', async () => {
    const f = durableFixture();
    f.fail((route) => (route === 'doc.list' ? { ok: false, kind: 'unavailable' } : undefined));
    const error = failure(await f.workspace.flowsFor(alpha).then(() => null, (reason: unknown) => reason));
    assert.deepEqual([error.kind, error.section, error.operation], ['unavailable', 'flows', 'flows.load']);
  });

  it('taste.load: the client is built once per project and survives content changes (it holds retry state)', async () => {
    const f = durableFixture();
    const first = f.workspace.tasteFor(alpha);
    f.contentEvents.notify(alpha.id);
    f.contentEvents.notify(alpha.id);
    assert.equal(f.workspace.tasteFor(alpha), first);
    assert.equal((await first).projectId, alpha.id);
    const refused = failure(await f.workspace.tasteFor({ id: ' padded ', name: 'Bad' }).then(() => null, (reason: unknown) => reason));
    assert.deepEqual([refused.section, refused.operation, refused.kind, refused.reason], ['taste', 'taste.load', 'invalid', 'project-id']);
  });
});

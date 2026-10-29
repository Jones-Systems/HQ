import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import type { DesignServiceTransport, DesignServiceValues, DesignServiceParams, DesignServiceRoute, DesignStorageResult, StoredDocument } from '@hq/contracts/services';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createDesignWorkspace } from '../workspace.ts';
import * as fake from '../fake-workspace.ts';
import { FAKE_TAG } from '../labels.ts';
import { createTransportDouble } from './bridge-double.ts';
import { versionId } from '../../../annotations/src/contract.ts';
import { SYNTHETIC_CARD, SYNTHETIC_CARD_VARIANTS } from '../../../components/src/fixtures.ts';
import { artboardId } from '../../../canvas/src/contract.ts';
import { emptyArrangement } from '../../../canvas/src/arrangement.ts';
import { createCanvasState, reduceCanvas } from '../../../canvas/src/controller.ts';
import { loadArrangement, saveArrangement } from '../../../canvas/src/codec.ts';
import { TASTE_DOCUMENT_KEY } from '../../../taste/src/project-service.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

const project = { id: 'synthetic-project', name: 'Synthetic project' };
function setup() {
  const double = createTransportDouble();
  let catalogCache: StoredDocument | null = null;
  const nativeTransport: DesignServiceTransport = {
    async call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R]): Promise<DesignStorageResult<DesignServiceValues[R]>> {
      if (!['catalog.roots', 'cache.get', 'cache.put'].includes(route)) return double.transport.call(route, params);
      double.calls.push({ route, params: structuredClone(params) });
      let value: DesignServiceValues[DesignServiceRoute];
      if (route === 'catalog.roots') value = [];
      else if (route === 'cache.get') value = catalogCache;
      else {
        const input = params as DesignServiceParams['cache.put'];
        catalogCache = { namespace: 'cache', key: input.key, value: input.value, revision: (catalogCache?.revision ?? 0) + 1,
          valueDigest: `sha256:${'0'.repeat(64)}`, updatedAt: '2026-01-01T00:00:00Z' };
        value = catalogCache;
      }
      return { ok: true, value: value as DesignServiceValues[R] };
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { hqServices: { design: nativeTransport } } });
  const workspace = createDesignWorkspace(createBridgeWorkspaceDocuments(double.transport));
  assert.equal(double.calls.filter(({ route }) => route === 'doc.put').length, 0);
  assert.equal(workspace.bridged, true);
  if (!workspace.bridged) throw new Error('Expected bridge');
  return { double, workspace };
}

it('null injection preserves all existing fake functions and labels', async () => {
  const workspace = createDesignWorkspace(null);
  assert.equal(workspace.bridged, false);
  assert.equal(workspace.storageTag, FAKE_TAG);
  for (const key of ['projectsFor', 'componentsFor', 'flowsFor', 'compareFor', 'annotationsEnv', 'canvasFor', 'discoveryEnv', 'tasteEnv', 'importsFor'] as const) {
    assert.equal(workspace[key], fake[key]);
  }
});

it('durable sections use F1 roots; navigation and reads never put documents', async () => {
  const { double, workspace } = setup();
  assert.equal(workspace.storageTag.text, 'Saved on this device');
  await workspace.projectsFor(project);
  const library = await workspace.componentsFor(project);
  assert.deepEqual(await library.listComponents(), []);
  assert.deepEqual((await workspace.flowsFor(project)).flows, []);
  const compare = await workspace.compareFor(project);
  assert.deepEqual(compare.getSnapshot().comparison.panels, []);
  const annotations = await workspace.annotationsEnv().controllerFor(versionId('synthetic-version'));
  assert.deepEqual(annotations.snapshot.editor.document.annotations, []);
  assert.equal(workspace.annotationsEnv().store.adapter, 'real');
  const canvas = await workspace.canvasFor(project);
  assert.ok(canvas);
  assert.deepEqual(await loadArrangement(canvas.storage, canvas.canvasId), { status: 'missing' });
  assert.notEqual(workspace.discoveryEnv, fake.discoveryEnv);
  const discovery = await workspace.discoveryEnv();
  assert.equal(discovery.tag.status, 'cached');
  assert.deepEqual(discovery.readPort.current(), []);
  assert.equal(double.calls.some(({ route }) => route === 'catalog.snapshot'), false);
  assert.equal(typeof workspace.tasteFor, 'function');
  assert.equal('tasteEnv' in workspace, false);
  const beforeTaste = double.calls.length;
  const taste = await workspace.tasteFor(project);
  assert.equal(taste.projectId, project.id);
  assert.equal(double.calls.length, beforeTaste, 'constructing a project client performs no I/O');
  assert.equal(await workspace.tasteFor({ ...project, name: 'Renamed project' }), taste);
  const otherTaste = await workspace.tasteFor({ id: 'other-project', name: 'Other project' });
  assert.notEqual(otherTaste.client, taste.client);
  assert.equal(double.calls.length, beforeTaste, 'project navigation performs no I/O');
  await taste.client.snapshot(taste.projectId);
  await otherTaste.client.snapshot(otherTaste.projectId);
  assert.deepEqual(double.calls.slice(beforeTaste), [
    { route: 'doc.get', params: { key: TASTE_DOCUMENT_KEY } },
    { route: 'doc.get', params: { key: TASTE_DOCUMENT_KEY } },
  ]);
  assert.equal(workspace.importsFor, fake.importsFor);
  for (const root of ['design/projects/', 'design/components/', 'design/flows/', 'design/compare/', 'design/annotations/', 'design.canvas.arrangement.v1/']) {
    assert.ok(double.calls.some(({ params }) => ('key' in params ? params.key : 'prefix' in params ? params.prefix : '').startsWith(root)), root);
  }
  assert.equal(double.calls.filter(({ route }) => route === 'doc.put').length, 0);
  compare.dispose();
});

it('failed projects reads show the existing error state while other sections still load', async () => {
  const { double, workspace } = setup();
  double.failWith((_route, params) => 'key' in params && params.key.startsWith('design/projects/') ? { ok: false, kind: 'unavailable' } : undefined);
  const projects = await workspace.projectsFor(project);
  assert.equal(projects.getSnapshot().registry.status, 'error');
  assert.deepEqual(projects.getSnapshot().registry.projects, []);
  assert.deepEqual(await (await workspace.componentsFor(project)).listComponents(), []);
  assert.deepEqual((await workspace.flowsFor(project)).flows, []);
  const compare = await workspace.compareFor(project);
  assert.deepEqual(compare.getSnapshot().comparison.panels, []);
  const canvas = await workspace.canvasFor(project);
  assert.ok(canvas);
  assert.deepEqual(canvas.sourceErrors, ['Project views unavailable']);
  assert.deepEqual(await loadArrangement(canvas.storage, canvas.canvasId), { status: 'missing' });
  assert.equal(double.calls.filter(({ route }) => route === 'doc.put').length, 0);
  compare.dispose();
});

it('failed compare and annotations reads reject instead of substituting fakes', async () => {
  const { double, workspace } = setup();
  double.failWith((_route, params) => 'key' in params && /^design\/(compare|annotations)\//u.test(params.key) ? { ok: false, kind: 'unavailable' } : undefined);
  await assert.rejects(workspace.compareFor(project), { kind: 'unavailable' });
  await assert.rejects(workspace.annotationsEnv().controllerFor(versionId('synthetic-version')), { kind: 'unavailable' });
  assert.deepEqual(await (await workspace.componentsFor(project)).listComponents(), []);
  assert.equal(double.calls.filter(({ route }) => route === 'doc.put').length, 0);
});

it('controller writes survive rebuilding the workspace: projects CAS, components overwrite, canvas', async () => {
  const { double, workspace } = setup();
  const projects = await workspace.projectsFor(project);
  assert.deepEqual(await projects.createProject('Saved synthetic project'), { ok: true });
  const savedProject = projects.getSnapshot().registry.projects[0]!;
  assert.deepEqual(await projects.addView('Saved synthetic view', 'page'), { ok: true });
  const library = await workspace.componentsFor(project);
  const card = await library.saveSource(SYNTHETIC_CARD);
  await library.saveVariants(card, { componentId: card.componentId, sourceRevision: 1, variants: SYNTHETIC_CARD_VARIANTS });
  await library.saveVariants(card, { componentId: card.componentId, sourceRevision: 1, variants: SYNTHETIC_CARD_VARIANTS });
  const canvas = await workspace.canvasFor(project);
  assert.ok(canvas);
  const state = reduceCanvas(createCanvasState(emptyArrangement(canvas.canvasId, canvas.projectId)), { type: 'edit', edit: {
    kind: 'add-artboard', id: artboardId('synthetic-board'), name: 'Saved board', frame: { x: 0, y: 0, width: 200, height: 100 },
  } });
  assert.equal((await saveArrangement(canvas.storage, state.history.present, null)).status, 'saved');
  const beforeReload = double.calls.filter(({ route }) => route === 'doc.put').length;
  const reloaded = createDesignWorkspace(createBridgeWorkspaceDocuments(double.transport));
  assert.ok(reloaded.bridged);
  if (!reloaded.bridged) return;
  const restoredProjects = await reloaded.projectsFor(project);
  assert.equal(restoredProjects.getSnapshot().registry.projects[0]?.name, 'Saved synthetic project');
  const content = await reloaded.contentFor({ id: savedProject.id, name: savedProject.name });
  assert.equal(content.content.views[0]?.title, 'Saved synthetic view');
  const restoredLibrary = await reloaded.componentsFor(project);
  assert.deepEqual(await restoredLibrary.getSource(card.componentId, card.revision), card);
  assert.equal((await restoredLibrary.getVariants(card))?.variants.length, SYNTHETIC_CARD_VARIANTS.length);
  const restoredCanvas = await reloaded.canvasFor(project);
  assert.ok(restoredCanvas);
  const loaded = await loadArrangement(restoredCanvas.storage, restoredCanvas.canvasId);
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') assert.equal(loaded.arrangement.artboards[0]?.name, 'Saved board');
  assert.equal(double.calls.filter(({ route }) => route === 'doc.put').length, beforeReload);
  const puts = double.calls.filter(({ route }) => route === 'doc.put');
  assert.ok(puts.some(({ params }) => 'key' in params && params.key.startsWith('design/projects/') && 'expectedRevision' in params));
  assert.ok(puts.some(({ params }) => 'key' in params && params.key.startsWith('design/components/') && !('expectedRevision' in params)));
});

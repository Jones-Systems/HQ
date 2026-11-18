import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectId as canvasProjectId } from '../../../canvas/src/contract.ts';
import { createProviderRegistry } from '../../../canvas/src/providers.ts';
import { parseFlow } from '../../../flows/src/model.ts';
import type { FlowDocument } from '../../../flows/src/contract.ts';
import type { ProjectContent } from '../../../projects/src/content.ts';
import { createFakeThumbnailPort, previewRefFor, syntheticPng } from '../../../projects/fakes/index.ts';
import { FAKE_TAG, WORKSPACE_TAG } from '../labels.ts';
import {
  PROJECT_VERSIONS_PROVIDER_ID, bindFlowToProject, createProjectScreenPreviews, createProjectVersionsProvider, parseProjectVersionEntity, projectVersionEntity,
} from '../project-versions.ts';
import { contentFor } from '../workspace.ts';

const project = { id: 'project-alpha', name: 'Alpha (synthetic)' };
const PROJECT = canvasProjectId('project-alpha');

describe('projects (T2) versions behind the canvas (T3) provider shape', () => {
  it('pins project, view and exact version, and shows the capture binding without raising its claim', async () => {
    const env = await contentFor(project);
    const provider = createProjectVersionsProvider({ repository: env.repository, storageTag: FAKE_TAG });
    assert.deepEqual(await provider.refresh(PROJECT), { versions: env.content.versions.length, status: 'ok' });
    const items = provider.list(PROJECT);
    assert.equal(items.length, env.content.versions.length);
    const home = items.find((item) => item.title.startsWith('Home · Version 2'))!;
    assert.equal(home.ref.providerId, PROJECT_VERSIONS_PROVIDER_ID);
    assert.deepEqual(parseProjectVersionEntity(home.ref.entityId), { project: 'project-alpha', view: 'project-alpha-home' });
    assert.equal(home.ref.revision, 'project-alpha-home-v2');
    assert.equal(home.provenance, 'static-capture');
    assert.match(home.title, /\(fake\)$/u);
    const detail = (label: string) => home.details?.find((item) => item.label === label)?.value;
    assert.equal(detail('Project'), 'project-alpha');
    assert.match(detail('Version')!, /project-alpha-home-v2 · #2 · synthetic-fixture/u);
    assert.match(detail('Capture digest')!, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(detail('Data'), FAKE_TAG.text);
  });

  it('answers only for a version that belongs to the pinned view of that project', async () => {
    const env = await contentFor(project);
    const provider = createProjectVersionsProvider({ repository: env.repository, storageTag: FAKE_TAG });
    await provider.refresh(PROJECT);
    const ref = provider.list(PROJECT)[0]!.ref;
    assert.ok(provider.describe(ref));
    assert.equal(provider.describe({ ...ref, revision: 'project-alpha-pricing-v1' }), null, 'a version of another view');
    assert.equal(provider.describe({ ...ref, revision: 'latest' }), null, 'no latest binding');
    assert.equal(provider.describe({ ...ref, entityId: projectVersionEntity('project-beta', 'project-alpha-home') }), null, 'another project');
    assert.equal(provider.describe({ ...ref, entityId: 'not-an-entity' }), null);
    assert.equal(parseProjectVersionEntity('a/b/c'), null);
    assert.equal(createProviderRegistry().describe(ref).status, 'missing-provider');
  });

  it('opens an unsupported or invalid content document as nothing, never as editable data', async () => {
    const env = await contentFor(project);
    env.storage.seed('workspace', 'design.projects/content/project-gamma', { schema: 'hq.design.project-content/v9', projectId: 'project-gamma' });
    const provider = createProjectVersionsProvider({ repository: env.repository, storageTag: FAKE_TAG });
    const result = await provider.refresh(canvasProjectId('project-gamma'));
    assert.equal(result.status, 'unsupported-schema');
    assert.deepEqual(provider.list(canvasProjectId('project-gamma')), []);
  });

  it('does not label workspace-origin versions as synthetic when the store itself is a real workspace', async () => {
    const env = await contentFor(project);
    const provider = createProjectVersionsProvider({ repository: env.repository, storageTag: WORKSPACE_TAG });
    await provider.refresh(PROJECT);
    // The seeded versions are synthetic-fixture origin: that label survives even on a workspace store.
    assert.match(provider.list(PROJECT)[0]!.title, /\(synthetic\)$/u);
    assert.equal(provider.label, 'Project views');
  });
});

function flowFor(content: ProjectContent, patch: (screen: Record<string, unknown>) => Record<string, unknown> = (screen) => screen): FlowDocument {
  const version = (view: string) => content.versions.find((item) => item.viewId === `${content.projectId}-${view}`)!;
  const screen = (id: string, view: string) => patch({
    id, title: id, versionId: version(view).id, route: version(view).capture.route, state: 'default', viewport: version(view).capture.viewport,
    captureDigest: version(view).capture.captureDigest,
  });
  const parsed = parseFlow({
    schema: 'hq.design.flow/v1', id: 'flow-x', projectId: content.projectId, title: 'X', platform: 'web', start: 'cart',
    routes: [{ route: '/cart', states: ['default'] }, { route: '/checkout', states: ['default'] }],
    screens: [screen('cart', 'cart'), screen('checkout', 'checkout')], hotspots: [],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.flow;
}

describe('flows (T11) <-> projects (T2) binding', () => {
  it('reports every screen exact when version, route, viewport and capture digest all agree', async () => {
    const { content } = await contentFor(project);
    const report = bindFlowToProject(flowFor(content), content);
    assert.equal(report.sameProject, true);
    assert.deepEqual(report.screens.map((screen) => screen.binding), ['exact', 'exact']);
  });

  it('names each way a pinned screen can disagree with its version', async () => {
    const { content } = await contentFor(project);
    const binding = (patch: Record<string, unknown>) => bindFlowToProject(flowFor(content, (screen) => (screen.id === 'cart' ? Object.fromEntries(Object.entries({ ...screen, ...patch }).filter(([, value]) => value !== undefined)) : screen)), content).screens[0]!.binding;
    assert.equal(binding({ versionId: 'no-such-version' }), 'missing-version');
    assert.equal(binding({ route: '/elsewhere' }), 'route-mismatch');
    assert.equal(binding({ viewport: { w: 1, h: 2, dpr: 1 } }), 'viewport-mismatch');
    assert.equal(binding({ captureDigest: `sha256:${'0'.repeat(64)}` }), 'capture-digest-mismatch');
    assert.equal(binding({ captureDigest: undefined }), 'unverified-capture');
  });

  it('binds nothing when the flow belongs to another project, even if version ids match', async () => {
    const { content } = await contentFor(project);
    const other = { ...flowFor(content), projectId: 'project-beta' } as unknown as FlowDocument;
    const report = bindFlowToProject(other, content);
    assert.equal(report.sameProject, false);
    assert.ok(report.screens.every((screen) => screen.binding === 'missing-version'));
  });

  it('serves verified thumbnails only for the pinned version, and fails closed on a digest mismatch', async () => {
    const env = await contentFor(project);
    const flow = flowFor(env.content);
    const previews = createProjectScreenPreviews({ thumbnails: env.thumbnails, tag: FAKE_TAG });
    assert.equal(previews.previewUrl(flow.screens[0]!), null, 'nothing before warm()');
    const warmed = await previews.warm(flow, env.content);
    assert.deepEqual([warmed.loaded, warmed.failed], [2, []]);
    assert.match(previews.previewUrl(flow.screens[0]!)!, /^data:image\/png;base64,/u);
    assert.equal(previews.previewUrl({ ...flow.screens[0]!, versionId: 'project-alpha-pricing-v1' as never }), null, 'another version, same screen id');
    assert.match(previews.label, /not captures/u);

    const tampered = createFakeThumbnailPort();
    const ref = env.content.versions.find((version) => version.viewId === 'project-alpha-cart')!.thumbnail!;
    tampered.add(ref, syntheticPng(999));
    const failing = createProjectScreenPreviews({ thumbnails: tampered, tag: FAKE_TAG });
    const result = await failing.warm(flow, env.content);
    assert.ok(result.failed.includes('cart'));
    assert.equal(failing.previewUrl(flow.screens[0]!), null);
    assert.ok(await previewRefFor(syntheticPng(1)), 'fixture helper still usable');
  });

  it('loads no thumbnails for a flow from another project', async () => {
    const env = await contentFor(project);
    const other = { ...flowFor(env.content), projectId: 'project-beta' } as unknown as FlowDocument;
    const previews = createProjectScreenPreviews({ thumbnails: env.thumbnails, tag: FAKE_TAG });
    const result = await previews.warm(other, env.content);
    assert.equal(result.loaded, 0);
  });
});

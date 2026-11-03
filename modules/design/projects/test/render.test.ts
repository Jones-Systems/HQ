/**
 * React server-render checks. These prove component output and semantics, not
 * browser layout, scrolling or image decoding.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createProjectsController } from '../src/controller.ts';
import { createProvisionalLocalRegistry } from '../src/registry.ts';
import { ProjectsSection } from '../src/views/section.ts';
import { contentKey } from '../src/repository.ts';
import { projectId, versionId, viewId } from '../src/ids.ts';
import {
  createFakeCatalog, createFakeClock, createFakeThumbnailPort, createSpyStorage, seedSyntheticWorkspace, sequentialIds, syntheticCatalogEntry,
} from '../fakes/index.ts';

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function render(prepare?: (controller: ReturnType<typeof createProjectsController>, ids: ReturnType<typeof projectId>[]) => Promise<void> | void) {
  const storage = createSpyStorage();
  const thumbnails = createFakeThumbnailPort();
  const clock = createFakeClock();
  const { projectIds } = await seedSyntheticWorkspace(storage, thumbnails, 3, { clock, namePrefix: 'Atlas' });
  storage.seed('workspace', contentKey(projectId('future-project')), { schema: 'hq.design.project-content/v7', projectId: 'future-project' });
  const catalog = createFakeCatalog([
    syntheticCatalogEntry(1, { displayName: 'Atlas 1', status: 'stale', remote: 'example.invalid/atlas' }),
    syntheticCatalogEntry(2, { displayName: 'Ledger', status: 'missing-at-source', host: 'fake-host-b', hostLabel: 'Synthetic host B' }),
  ]);
  const controller = createProjectsController({
    registry: createProvisionalLocalRegistry({ storage, clock, ids: sequentialIds() }), storage, thumbnails, catalog, clock,
  });
  await controller.start();
  await prepare?.(controller, projectIds);
  return renderToString(createElement(ProjectsSection, { controller }));
}

describe('rendered projects section (server render)', () => {
  test('gallery labels device-local projects and marks source entries read-only with host and freshness', async () => {
    const html = await render();
    assert.match(html, /data-registry="provisional-local"/u);
    assert.match(html, /On this device/u);
    assert.match(html, /Projects saved on this device/u);
    assert.match(html, /Atlas 1 on Synthetic host A, read-only source entry/u);
    assert.match(html, /Stale/u);
    assert.match(html, /Missing at source/u);
    assert.equal((html.match(/data-key="workspace:/gu) ?? []).length, 3);
    assert.equal((html.match(/data-key="source:/gu) ?? []).length, 2, 'same-titled source entry stays separate');
    assert.match(html, /aria-label="Project gallery"/u);
    assert.match(html, /Switch project/u);
  });

  test('collapsed gallery group renders its header with aria-expanded=false and no tiles', async () => {
    const html = await render((controller) => controller.toggleGroup('origin:source'));
    assert.match(html, /aria-expanded="false"[^>]*>.*Source catalog \(read-only\)/u);
    assert.equal((html.match(/data-key="source:/gu) ?? []).length, 0);
  });

  test('project detail shows several views, versions, selection and collapse', async () => {
    const html = await render(async (controller, ids) => {
      controller.openProject(ids[2]!);
      await settle();
      controller.select(viewId('fake-view-3-1'), versionId('fake-version-3-1-2'));
      controller.toggleView(viewId('fake-view-3-2'));
    });
    assert.match(html, /← Back to Gallery/u);
    assert.match(html, /data-view="fake-view-3-1"/u);
    assert.match(html, /data-view="fake-view-3-2"/u);
    assert.match(html, /data-view="fake-view-3-3"/u);
    assert.match(html, /aria-pressed="true" data-version="fake-version-3-1-2"/u);
    assert.match(html, /aria-expanded="false" aria-controls="hqp-view-fake-view-3-2"/u);
    assert.doesNotMatch(html, /data-version="fake-version-3-2-/u, 'collapsed view hides its versions');
    assert.match(html, /Versions are immutable/u);
    assert.match(html, /Linking is always explicit/u);
  });

  test('a future-schema project opens read-only with an explanation', async () => {
    const html = await render(async (controller) => {
      controller.openProject(projectId('future-project'));
      await settle();
    });
    assert.match(html, /Read-only/u);
    assert.match(html, /newer format \(hq\.design\.project-content\/v7\); opened read-only/u);
    assert.match(html, /Not in registry/u);
  });
});

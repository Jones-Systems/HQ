/**
 * 500 synthetic projects: lazy summaries and thumbnails, measured.
 * No time budget is promised; timings are reported as diagnostics only.
 * Server rendering proves the rendered tile count is bounded; it is not
 * browser layout evidence (see the harness for actual browser runtime).
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createProjectsController } from '../src/controller.ts';
import { createProvisionalLocalRegistry } from '../src/registry.ts';
import { DEFAULT_GRID_METRICS, layoutGrid, planThumbnails, visibleBlocks } from '../src/grid.ts';
import { ProjectsSection } from '../src/views/section.ts';
import { contentKey } from '../src/repository.ts';
import { createFakeClock, createFakeThumbnailPort, createSpyStorage, seedSyntheticWorkspace, sequentialIds } from '../fakes/index.ts';

const COUNT = 500;
const VIEWPORT = { width: 1200, height: 800 };
const settle = async (rounds = 5) => { for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

test(`gallery with ${COUNT} synthetic projects loads summaries and thumbnails lazily (measured)`, async (t) => {
  const storage = createSpyStorage();
  const thumbnails = createFakeThumbnailPort();
  const clock = createFakeClock();
  const seedStart = performance.now();
  const { projectIds } = await seedSyntheticWorkspace(storage, thumbnails, COUNT, { clock });
  t.diagnostic(`seed ${COUNT} projects: ${(performance.now() - seedStart).toFixed(1)} ms`);

  const registry = createProvisionalLocalRegistry({ storage, clock, ids: sequentialIds() });
  const controller = createProjectsController({ registry, storage, thumbnails, clock });
  controller.setGalleryFilters({ groupBy: 'none' });
  const startAt = performance.now();
  await controller.start();
  const snapshot = controller.getSnapshot();
  const listed = snapshot.gallery.reduce((sum, group) => sum + group.items.length, 0);
  t.diagnostic(`registry list + gallery model (${listed} items): ${(performance.now() - startAt).toFixed(1)} ms`);
  assert.equal(listed, COUNT);
  const contentReads = () => storage.calls.filter((call) => call.op === 'read' && call.key.startsWith('design.projects/content/')).length;
  assert.equal(contentReads(), 0, 'listing reads no project content');

  // Server render: only blocks near the viewport are in the markup.
  const renderStart = performance.now();
  const html = renderToString(createElement(ProjectsSection, { controller, gallery: { initialViewport: VIEWPORT } }));
  const renderMs = performance.now() - renderStart;
  const renderedTiles = (html.match(/data-key="workspace:/gu) ?? []).length;
  t.diagnostic(`server render: ${renderMs.toFixed(1)} ms, ${renderedTiles} of ${COUNT} tiles in markup, ${html.length} bytes`);
  assert.match(html, /data-total-tiles="500"/u);
  assert.ok(renderedTiles > 0 && renderedTiles <= 30, `rendered ${renderedTiles}`);
  assert.equal(thumbnails.requested.length, 0, 'rendering alone fetches nothing');

  // What the mounted grid does: visible tiles request summaries, then covers.
  const layout = layoutGrid(controller.getSnapshot().gallery, { width: VIEWPORT.width, ...DEFAULT_GRID_METRICS });
  const releases: Array<() => void> = [];
  const mountViewport = (scrollTop: number) => {
    for (const release of releases.splice(0)) release();
    const tiles = visibleBlocks(layout, scrollTop, VIEWPORT.height).filter((block) => block.type === 'tile');
    for (const block of tiles) if (block.item.kind === 'workspace') releases.push(controller.requestSummary(block.item.projectId, 'visible'));
    return tiles.length;
  };
  const lazyStart = performance.now();
  const visibleCount = mountViewport(0);
  await settle();
  assert.equal(contentReads(), visibleCount, 'one content read per visible tile');
  const withCovers = layoutGrid(controller.getSnapshot().gallery, { width: VIEWPORT.width, ...DEFAULT_GRID_METRICS });
  const plan = planThumbnails(withCovers, 0, VIEWPORT.height, { prefetchRows: 2, maxPrefetch: 12 });
  for (const ref of plan.visible) releases.push(controller.thumbnails.subscribe(ref, 'visible', () => {}));
  for (const ref of plan.prefetch) releases.push(controller.thumbnails.subscribe(ref, 'prefetch', () => {}));
  await settle(20);
  t.diagnostic(`first viewport: ${visibleCount} visible tiles, ${thumbnails.requested.length} thumbnail fetches, ${(performance.now() - lazyStart).toFixed(1)} ms`);
  const visibleCovers = new Set(visibleBlocks(withCovers, 0, VIEWPORT.height)
    .flatMap((block) => (block.type === 'tile' && block.item.thumbnail ? [block.item.thumbnail.digest] : [])));
  assert.equal(plan.visible.length, visibleCovers.size, 'one request per distinct visible digest');
  assert.equal(new Set(thumbnails.requested).size, thumbnails.requested.length, 'duplicate digests are fetched once');
  assert.ok(thumbnails.requested.length <= visibleCovers.size + 12);
  assert.equal(controller.thumbnails.stats().completed, thumbnails.requested.length);

  // Scroll to the middle: earlier tiles release; requests stay bounded.
  const middle = layout.totalHeight / 2;
  const nextVisible = mountViewport(middle);
  await settle();
  assert.equal(contentReads(), visibleCount + nextVisible);
  assert.ok(controller.getSnapshot().summaries.size < COUNT / 10, `summaries loaded: ${controller.getSnapshot().summaries.size}`);
  assert.ok(projectIds.length === COUNT && storage.raw('workspace', contentKey(projectIds[COUNT - 1]!)) !== undefined);
  for (const release of releases.splice(0)) release();
  t.diagnostic(`after mid-scroll: ${contentReads()} content reads, ${thumbnails.requested.length} thumbnail fetches of ${COUNT} projects`);
});

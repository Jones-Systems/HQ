/**
 * Browser harness: mounts the projects section with LABELLED FAKES and 500
 * synthetic projects, and exposes read-only measurement hooks on
 * `window.hqProjectsHarness`. Query `?count=N&theme=dark` adjusts the fixture.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/projects.css';
import './harness.css';
import { createProjectsSection, createProvisionalLocalRegistry, ProjectsSection } from '../src/index.ts';
import {
  createFakeCatalog, createFakeClock, createFakeThumbnailPort, createSpyStorage, FAKE_LABEL, previewRefFor,
  seedSyntheticWorkspace, sequentialIds, syntheticCatalogEntry, syntheticPng,
} from '../fakes/index.ts';
import type { FreshnessStatus } from '../src/contract.ts';

const params = new URLSearchParams(location.search);
const count = Math.min(5000, Math.max(1, Number(params.get('count') ?? 500) || 500));
if (params.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';

const storage = createSpyStorage();
const thumbnails = createFakeThumbnailPort();
const clock = createFakeClock();
const seedStart = performance.now();
const { projectIds } = await seedSyntheticWorkspace(storage, thumbnails, count, { clock });
const statuses: FreshnessStatus[] = ['fresh', 'stale', 'offline', 'partial', 'missing-at-source'];
const entries = [];
for (let index = 0; index < 12; index += 1) {
  const bytes = syntheticPng(1000 + index);
  const preview = await previewRefFor(bytes, 'image/png', 32, 20);
  thumbnails.add(preview, bytes);
  entries.push(syntheticCatalogEntry(index + 1, {
    displayName: index % 4 === 0 ? `Synthetic project ${index + 1}` : `Source project ${index + 1}`,
    host: index % 2 ? 'fake-host-b' : 'fake-host-a', hostLabel: index % 2 ? 'Synthetic host B' : 'Synthetic host A',
    status: statuses[index % statuses.length]!, preview,
  }));
}
const seedMs = performance.now() - seedStart;
const catalog = createFakeCatalog(entries);
const registry = createProvisionalLocalRegistry({ storage, clock, ids: sequentialIds('harness') });
const { controller, ready } = createProjectsSection({ registry, storage, thumbnails, catalog, clock, ids: sequentialIds('harness') });

const mountStart = performance.now();
createRoot(document.getElementById('root')!).render(createElement(ProjectsSection, { controller }));
await ready;
const readyMs = performance.now() - mountStart;

const contentReads = () => storage.calls.filter((call) => call.op === 'read' && call.key.startsWith('design.projects/content/')).length;

Object.assign(window, {
  hqProjectsHarness: {
    label: FAKE_LABEL,
    count,
    projectIds,
    controller,
    timings: { seedMs, readyMs },
    measure: () => {
      const scroller = document.querySelector<HTMLElement>('.hqp-scroller');
      return {
        renderedTiles: document.querySelectorAll('.hqp-cell[role="listitem"]').length,
        visibleTiles: document.querySelectorAll('.hqp-cell[data-visible="true"]').length,
        loadedImages: document.querySelectorAll('.hqp-scroller img.hqp-thumb').length,
        totalTiles: Number(scroller?.dataset.totalTiles ?? 0),
        scrollTop: scroller?.scrollTop ?? null,
        scrollHeight: scroller?.scrollHeight ?? null,
        thumbnailFetches: thumbnails.requested.length,
        thumbnailAborts: thumbnails.aborted.length,
        contentReads: contentReads(),
        storageWrites: storage.writes().map((call) => `${call.namespace}:${call.key}`),
        loader: controller.thumbnails.stats(),
        summaries: controller.getSnapshot().summaries.size,
      };
    },
  },
});

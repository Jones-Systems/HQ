import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { isoFromMs, type HostId, type SourceEnrollment } from '../../../discovery/src/contract.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog } from '../../../discovery/src/catalog.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../../../discovery/src/cache.ts';
import { DiscoveryService } from '../../../discovery/src/discovery.ts';
import { DiscoveryCatalog } from '../../../discovery/src/CatalogView.ts';
import { FAKE_HOSTS, FakeClock, fixturePreview, fixtureSnapshot, MemoryCachePort } from '../../../discovery/src/fakes.ts';
import { PreviewFrame } from '../../PreviewFrame.tsx';
import { perProject } from '../../seeds.ts';

const NOW = Date.UTC(2026, 9, 20, 12);
const HOSTS: readonly (readonly [HostId, string])[] = [[FAKE_HOSTS.laptop, 'Laptop'], [FAKE_HOSTS.studio, 'Studio']];
const LABELS = { fake: { label: 'Synthetic fake source', fake: true } };

/**
 * Warm cache only. No source adapter is registered and refresh-on-open is off, so
 * the view renders the seeded cached snapshot and a refresh cannot reach any host.
 */
const load = perProject(async () => {
  const cache = new MemoryCachePort();
  let catalog = EMPTY_CATALOG;
  for (const [host] of HOSTS) {
    const projects = await Promise.all(Array.from({ length: 12 }, async (_, index) => ({
      path: `p${String(index).padStart(3, '0')}`,
      name: index === 0 ? 'Shared title' : `Project ${host.slice(5, 9)} ${String(index).padStart(3, '0')}`,
      previews: [(await fixturePreview(`${host}-${index}`)).ref],
    })));
    const parsed = await parseSnapshot(await fixtureSnapshot(host, 1, projects), host);
    if (!parsed.ok) throw new Error('synthetic discovery snapshot failed to parse');
    catalog = reduceCatalog(catalog, { type: 'snapshot', snapshot: parsed.snapshot, at: isoFromMs(NOW - 60 * 60_000) }).state;
  }
  cache.documents.set(CATALOG_CACHE_KEY, serializeCatalogCache(catalog, isoFromMs(NOW)));
  const enrollments: SourceEnrollment[] = HOSTS.map(([hostId, label]) => ({ hostId, label, adapterKey: 'fake', enrolledAt: isoFromMs(NOW) }));
  const clock = new FakeClock(NOW);
  return { service: new DiscoveryService({ adapters: {}, enrollments, cache, clock, refreshOnOpen: false }), clock };
});

export function DiscoveryPreview({ context }: DesignSectionProps) {
  const { service, clock } = use(load(context));
  return <PreviewFrame lane="T15 discovery" entry="discovery/src/CatalogView.ts › DiscoveryCatalog"
    notes={['warm cached snapshot', 'no source adapter registered', 'refresh-on-open off']}>
    <DiscoveryCatalog service={service} now={() => clock.now()} adapterLabels={LABELS} onRequestLink={() => undefined} />
  </PreviewFrame>;
}

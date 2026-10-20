import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { DiscoveryCatalog } from '../../../discovery/src/CatalogView.ts';
import { SYNTHETIC_TAG } from '../labels.ts';
import { discoveryEnv } from '../workspace.ts';
import { SectionFrame } from './SectionFrame.tsx';

/** Warm cached snapshot only: no source adapter is registered and refresh-on-open is off. */
export function DiscoveryView(_props: DesignSectionProps) {
  const { service, clock, adapterLabels } = use(discoveryEnv());
  return <SectionFrame lane="T15 discovery" entry="discovery/src/CatalogView.ts › DiscoveryCatalog" tags={[SYNTHETIC_TAG]}
    notes={['warm cached snapshot', 'no source adapter registered', 'refresh-on-open off']}>
    <DiscoveryCatalog service={service} now={() => clock.now()} adapterLabels={adapterLabels} onRequestLink={() => undefined} />
  </SectionFrame>;
}

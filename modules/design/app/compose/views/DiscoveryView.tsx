import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { DiscoveryCatalog } from '../../../discovery/src/CatalogView.ts';
import { useDesignWorkspace } from '../workspace-context.tsx';
import { SectionFrame } from './SectionFrame.tsx';

/** Opening discovery reads the existing snapshot; it never refreshes a source. */
export function DiscoveryView(_props: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const { service, clock, adapterLabels, tag } = use<Awaited<ReturnType<typeof workspace.discoveryEnv>>>(workspace.discoveryEnv());
  return <SectionFrame lane="T15 discovery" entry="discovery/src/CatalogView.ts › DiscoveryCatalog" tags={[tag]}
    notes={['Saved catalog snapshot; opening this page does not refresh sources.']}>
    <DiscoveryCatalog service={service} now={() => clock.now()} adapterLabels={adapterLabels} onRequestLink={() => undefined} />
  </SectionFrame>;
}

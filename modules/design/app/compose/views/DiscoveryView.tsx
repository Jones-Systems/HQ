import { use, useCallback } from 'react';
import { animateElement, Button, InlineNotice, Presence, Skeleton, StatusIndicator, useListMotion, useReducedMotion, useToast } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { DiscoveryCatalog, type DiscoveryKit } from '../../../discovery/src/CatalogView.ts';
import type { CatalogRow } from '../../../discovery/src/view-model.ts';
import '../../../discovery/src/discovery.css';
import { sendToTaste } from '../sources/taste-handoff.ts';
import { useDesignWorkspace } from '../workspace-context.tsx';
import { SectionFrame } from './SectionFrame.tsx';

/** F1's motion and feedback primitives. The section takes them as props so Node can still render it without CSS. */
const KIT: DiscoveryKit = { Button, StatusIndicator, InlineNotice, Skeleton, Presence, useToast, useListMotion, useReducedMotion, animateElement };

/** Opening discovery reads the existing snapshot; it never refreshes a source. */
export function DiscoveryView({ navigate }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const { service, clock, adapterLabels, tag } = use<Awaited<ReturnType<typeof workspace.discoveryEnv>>>(workspace.discoveryEnv());
  const toast = useToast();
  // Hands a discovered project to Taste's waiting queue. It does not rate anything or touch the source.
  const onSendToTaste = useCallback((row: CatalogRow, { imageUrl }: { readonly imageUrl: string | null }) => {
    sendToTaste({
      id: row.key, kind: 'other', label: row.displayName, detail: row.hostLabel, ...(imageUrl ? { imageUrl } : {}), from: 'discovery',
    }, navigate, toast);
  }, [navigate, toast]);
  return <SectionFrame lane="T15 discovery" entry="discovery/src/CatalogView.ts › DiscoveryCatalog" tags={[tag]} fill
    notes={['Saved catalog snapshot; opening this page does not refresh sources.']}>
    <DiscoveryCatalog service={service} now={() => clock.now()} adapterLabels={adapterLabels} kit={KIT} onSendToTaste={onSendToTaste} />
  </SectionFrame>;
}

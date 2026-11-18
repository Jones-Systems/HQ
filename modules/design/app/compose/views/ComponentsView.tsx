import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use } from 'react';
import { useToast } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { performanceClock } from '../../../components/src/workspace/fakes.ts';
import { ComponentsWorkspace } from '../../../components/ui/index.ts';
import '../../../components/ui/components.css';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';

import { useDesignWorkspace } from '../workspace-context.tsx';
import { sendToTaste } from '../sources/taste-handoff.ts';
import { SectionFrame } from './SectionFrame.tsx';

/** The app owns host access; the isolated Design preview never imports this module. */
async function copyTokenId(id: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Copying is unavailable');
  await navigator.clipboard.writeText(id);
}

/** Component execution is held: sandbox frames inherit the shell CSP (script-src 'self'). */
function ComponentsViewContent({ context, appearance, navigate }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const toast = useToast();
  const { componentsFor } = workspace;
  const library = use(componentsFor(context));
  return <SectionFrame lane="T10 components" entry="components/ui › ComponentsWorkspace" tags={workspace.bridged ? [workspace.storageTag] : [FAKE_TAG, SYNTHETIC_TAG]}
    notes={['component scripts HELD by the shell CSP (sandbox direction pending)', workspace.storageTag.text]}>
    <ComponentsWorkspace library={library} clock={performanceClock} appearance={appearance} copyTokenId={copyTokenId}
      onSendToTaste={({ componentId, name, revision, variantId, variantName }) => sendToTaste({
        id: `${componentId}-r${revision}-${variantId ?? 'base'}`,
        kind: 'component',
        label: `${name} · ${variantName}`,
        detail: `r${revision}`,
        from: 'components',
      }, navigate, toast)} />
  </SectionFrame>;
}

export const ComponentsView = withSectionErrorBoundary(ComponentsViewContent);

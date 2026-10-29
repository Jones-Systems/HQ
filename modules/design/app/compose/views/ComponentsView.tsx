import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { performanceClock } from '../../../components/src/workspace/fakes.ts';
import { ComponentsWorkspace } from '../../../components/ui/index.ts';
import '../../../components/ui/components.css';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';

import { useDesignWorkspace } from '../workspace-context.tsx';
import { SectionFrame } from './SectionFrame.tsx';

/** Component execution is held: sandbox frames inherit the shell CSP (script-src 'self'). */
function ComponentsViewContent({ context, appearance }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const { componentsFor } = workspace;
  const library = use(componentsFor(context));
  return <SectionFrame lane="T10 components" entry="components/ui › ComponentsWorkspace" tags={workspace.bridged ? [workspace.storageTag] : [FAKE_TAG, SYNTHETIC_TAG]}
    notes={['component scripts HELD by the shell CSP (sandbox direction pending)', workspace.storageTag.text]}>
    <ComponentsWorkspace library={library} clock={performanceClock} appearance={appearance} />
  </SectionFrame>;
}

export const ComponentsView = withSectionErrorBoundary(ComponentsViewContent);

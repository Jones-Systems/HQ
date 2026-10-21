import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { FlowsWorkspace } from '../../../flows/src/views.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';

import { useDesignWorkspace } from '../workspace-context.tsx';
import { InteractivePanel } from './InteractivePanel.tsx';
import { SectionFrame } from './SectionFrame.tsx';

/** Flows whose screens pin exact project versions; the binding of each screen is shown, never assumed. */
function FlowsViewContent({ context, navigate }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  if (workspace.bridged) return <BridgedFlows context={context} navigate={navigate} workspace={workspace} />;
  const { flow, binding, previews, warm } = use(workspace.flowsFor(context));
  return <SectionFrame lane="T11 flows" entry="flows/src/views.ts › FlowsWorkspace" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={[previews.label, `${warm.loaded} thumbnails verified, ${warm.failed.length} failed`]}>
    <details className="hqd-compose-note" open>
      <summary>Pinned project versions ({binding.sameProject ? `project ${flow.projectId}` : 'flow belongs to another project'})</summary>
      <ul>{binding.screens.map((screen) => <li key={screen.screenId}>{screen.screenId} → <code>{screen.versionId}</code>: {screen.binding}</li>)}</ul>
    </details>
    <FlowsWorkspace key={flow.id} flow={flow} previews={previews} />
  </SectionFrame>;
}

function BridgedFlows({ context, navigate, workspace }: { navigate: DesignSectionProps['navigate']; context: DesignSectionProps['context']; workspace: Extract<import('../workspace.ts').DesignWorkspace, { bridged: true }> }) {
  const { flows } = use(workspace.flowsFor(context));
  return <SectionFrame lane="T11 flows" entry="flows/src/views.ts › FlowsWorkspace" tags={[workspace.storageTag]}>
    <InteractivePanel context={context} navigate={navigate} />
    {flows.length === 0 ? <p>No saved flows for this project.</p> : flows.map((flow) => <FlowsWorkspace key={flow.id} flow={flow} previews={{ label: 'Preview unavailable', previewUrl: () => null }} />)}
  </SectionFrame>;
}

export const FlowsView = withSectionErrorBoundary(FlowsViewContent, true);

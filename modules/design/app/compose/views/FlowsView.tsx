import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { FlowsWorkspace } from '../../../flows/src/views.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { flowsFor } from '../workspace.ts';
import { SectionFrame } from './SectionFrame.tsx';

/** Flows whose screens pin exact project versions; the binding of each screen is shown, never assumed. */
export function FlowsView({ context }: DesignSectionProps) {
  const { flow, binding, previews, warm } = use(flowsFor(context));
  return <SectionFrame lane="T11 flows" entry="flows/src/views.ts › FlowsWorkspace" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={[previews.label, `${warm.loaded} thumbnails verified, ${warm.failed.length} failed`]}>
    <details className="hqd-compose-note" open>
      <summary>Pinned project versions ({binding.sameProject ? `project ${flow.projectId}` : 'flow belongs to another project'})</summary>
      <ul>{binding.screens.map((screen) => <li key={screen.screenId}>{screen.screenId} → <code>{screen.versionId}</code>: {screen.binding}</li>)}</ul>
    </details>
    <FlowsWorkspace key={flow.id} flow={flow} previews={previews} />
  </SectionFrame>;
}

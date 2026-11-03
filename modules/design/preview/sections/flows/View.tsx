import type { DesignSectionProps } from '../../../ui/contract.ts';
import { FlowsWorkspace } from '../../../flows/src/views.ts';
import { checkout } from '../../../flows/test/fixtures.ts';
import { PreviewFrame } from '../../PreviewFrame.tsx';

// The lane's synthetic checkout fixture. Its external hotspot is data only: the
// player records an exit step and never opens the URL.
const FLOW = checkout();

export function FlowsPreview(_props: DesignSectionProps) {
  return <PreviewFrame lane="T11 flows" entry="flows/src/views.ts › FlowsWorkspace"
    notes={['synthetic checkout fixture', 'no screen captures (fake previews)']}>
    <FlowsWorkspace key={FLOW.id} flow={FLOW} />
  </PreviewFrame>;
}

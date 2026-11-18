import { SecondaryBar } from '../../../ui/src/secondary-panels.tsx';
import { Button } from '@hq/ui';
import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use, useState } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { CompareWorkspace } from '../../../compare/src/view/index.tsx';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';

import { useDesignWorkspace } from '../workspace-context.tsx';
import { AnnotationSlot, type DrawTool } from './AnnotationSlot.tsx';
import { SectionFrame } from './SectionFrame.tsx';

const TOOLS: readonly (readonly [DrawTool | null, string])[] = [[null, 'No tool'], ['box', 'Box'], ['arrow', 'Arrow'], ['ink', 'Ink'], ['eraser', 'Eraser']];

/** Compare with annotations in its overlay slot: marks attach to the exact static capture of each panel. */
function CompareViewContent({ context }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const [tool, setTool] = useState<DrawTool | null>(null);
  const controller = workspace.bridged ? use(workspace.compareFor(context)) : workspace.compareFor(context);
  return <SectionFrame lane="T4 compare + T5 annotations" entry="compare/src/view › CompareWorkspace (renderOverlay → annotations overlay)" tags={workspace.bridged ? [workspace.storageTag] : [FAKE_TAG, SYNTHETIC_TAG]}
    notes={workspace.bridged ? ['Capture and live preview capabilities are unavailable'] : ['synthetic captures and labelled fake previews (no host surface)', 'marks need a static capture; live previews cannot be annotated']}>
    <SecondaryBar name="compare-annotations" label="Annotation tools"><div className="hqd-compose-tools" role="toolbar" aria-label="Annotation tool for compare panels">
      {TOOLS.map(([id, label]) => <Button size="sm" key={label} type="button" aria-pressed={tool === id} onClick={() => setTool(id)}>{label}</Button>)}
    </div></SecondaryBar>
    <CompareWorkspace controller={controller} renderOverlay={(frame) => <AnnotationSlot frame={frame} tool={tool} />} />
  </SectionFrame>;
}

export const CompareView = withSectionErrorBoundary(CompareViewContent);

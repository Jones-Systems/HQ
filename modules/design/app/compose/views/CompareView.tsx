import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use, useState } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { CompareWorkspace } from '../../../compare/src/view/index.tsx';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';

import { useDesignProject, useDesignWorkspace } from '../workspace-context.tsx';
import { AnnotationSlot, AnnotationTools, type DrawTool } from './AnnotationSlot.tsx';
import { ProjectScope } from './ProjectScope.tsx';
import { SectionFrame } from './SectionFrame.tsx';

/** Compare with annotations in its overlay slot: marks attach to the exact static capture of each panel. */
function CompareViewContent({ context, navigate }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const project = useDesignProject(context);
  const [tool, setTool] = useState<DrawTool | null>(null);
  const controller = use(workspace.compareFor(project));
  return <SectionFrame lane="T4 compare + T5 annotations" entry="compare/src/view › CompareWorkspace (renderOverlay → annotations overlay)"
    scope={<ProjectScope project={project} navigate={navigate} />} tags={workspace.bridged ? [workspace.storageTag] : [FAKE_TAG, SYNTHETIC_TAG]}
    notes={workspace.bridged ? ['Capture and live preview capabilities are unavailable'] : ['synthetic captures and labelled fake previews (no host surface)', 'marks need a static capture; live previews cannot be annotated']}>
    <CompareWorkspace key={project.id} controller={controller} onOpenProjects={() => navigate({ nav: 'projects', section: 'projects' })}
      renderTools={({ mode, hasPanels, hasCapture }) => <AnnotationTools tool={tool} onChange={setTool}
        unavailableReason={mode === 'swipe' ? 'Marks attach to one capture at a time. Switch to Side by side to draw or see them.'
          : !hasPanels ? 'Add a panel to draw marks on its capture.'
          : hasCapture ? null : 'Marks attach to a static capture. Every panel here is a live preview, which has no frozen bytes to anchor to.'} />}
      renderOverlay={(frame) => <AnnotationSlot frame={frame} tool={tool} />} />
  </SectionFrame>;
}

export const CompareView = withSectionErrorBoundary(CompareViewContent);

import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use } from 'react';
import type { DesignSectionProps, JsonValue } from '../../../ui/contract.ts';
import { CanvasWorkspace } from '../../../canvas/src/view/index.ts';
import '../../../canvas/src/view/canvas.css';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { canvasSessionToJson, parseCanvasSession } from '../session.ts';

import { useDesignProject, useDesignWorkspace } from '../workspace-context.tsx';
import { ProjectScope } from './ProjectScope.tsx';
import { SectionFrame } from './SectionFrame.tsx';

/**
 * Canvas over three providers behind composition adapters: project views (T2), flows (T11), components (T10).
 * Camera, selection and focus live in T14's session under this section id, so a domain switch restores them.
 */
function CanvasViewContent({ context, state, navigate }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const project = useDesignProject(context);
  const { canvasFor } = workspace;
  const env = use<Awaited<ReturnType<typeof canvasFor>>>(canvasFor(project));
  // The stored camera belongs to the shell project's canvas; another project's canvas opens at its default view.
  const own = project.id === context.id;
  const session = own ? parseCanvasSession(state.read()) : undefined;
  const scope = <ProjectScope project={project} navigate={navigate} />;
  if (env === null) {
    return <SectionFrame lane="T3 canvas" entry="canvas/src/view › CanvasWorkspace" tags={[workspace.storageTag]} scope={scope}>
      <p role="alert">This project id cannot be represented as a canvas id, so the canvas is not opened. Nothing was changed.</p>
    </SectionFrame>;
  }
  return <SectionFrame lane="T3 canvas" entry="canvas/src/view › CanvasWorkspace" fill scope={scope} tags={workspace.bridged ? [workspace.storageTag] : [FAKE_TAG, SYNTHETIC_TAG]}
    notes={[`providers: project views, ${env.adapters.map((adapter) => adapter.label).join(', ')}`, 'camera/selection kept in Design session state', ...('sourceErrors' in env ? env.sourceErrors : [])]}>
    <CanvasWorkspace key={env.canvasId} projectId={env.projectId} canvasId={env.canvasId} storage={env.storage} registry={env.registry} ids={env.ids}
      {...(session ? { session } : {})}
      onSessionChange={(next) => { if (own) state.write(canvasSessionToJson(next) as JsonValue); }} />
  </SectionFrame>;
}

export const CanvasView = withSectionErrorBoundary(CanvasViewContent);

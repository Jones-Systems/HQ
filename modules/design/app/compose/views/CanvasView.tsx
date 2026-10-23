import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use } from 'react';
import type { DesignSectionProps, JsonValue } from '../../../ui/contract.ts';
import { CanvasWorkspace } from '../../../canvas/src/view/index.ts';
import '../../../canvas/src/view/canvas.css';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { canvasSessionToJson, parseCanvasSession } from '../session.ts';

import { useDesignWorkspace } from '../workspace-context.tsx';
import { SectionFrame } from './SectionFrame.tsx';

/**
 * Canvas over three providers behind composition adapters: project views (T2), flows (T11), components (T10).
 * Camera, selection and focus live in T14's session under this section id, so a domain switch restores them.
 */
function CanvasViewContent({ context, state }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const { canvasFor } = workspace;
  const env = use<Awaited<ReturnType<typeof canvasFor>>>(canvasFor(context));
  const session = parseCanvasSession(state.read());
  if (env === null) {
    return <SectionFrame lane="T3 canvas" entry="canvas/src/view › CanvasWorkspace" tags={[workspace.storageTag]}>
      <p role="alert">This project id cannot be represented as a canvas id, so the canvas is not opened. Nothing was changed.</p>
    </SectionFrame>;
  }
  return <SectionFrame lane="T3 canvas" entry="canvas/src/view › CanvasWorkspace" fill tags={workspace.bridged ? [workspace.storageTag] : [FAKE_TAG, SYNTHETIC_TAG]}
    notes={[`providers: project views, ${env.adapters.map((adapter) => adapter.label).join(', ')}`, 'camera/selection kept in Design session state', ...('sourceErrors' in env ? env.sourceErrors : [])]}>
    <CanvasWorkspace projectId={env.projectId} canvasId={env.canvasId} storage={env.storage} registry={env.registry} ids={env.ids}
      {...(session ? { session } : {})}
      onSessionChange={(next) => { state.write(canvasSessionToJson(next) as JsonValue); }} />
  </SectionFrame>;
}

export const CanvasView = withSectionErrorBoundary(CanvasViewContent);

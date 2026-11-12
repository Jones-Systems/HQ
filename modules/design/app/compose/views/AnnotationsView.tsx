import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use, useState, startTransition } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { AnnotationsPanel } from '../../../annotations/src/ui/AnnotationsPanel.tsx';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';

import { useDesignProject, useDesignWorkspace } from '../workspace-context.tsx';
import { ProjectScope } from './ProjectScope.tsx';
import { useProjectContentRevision } from '../content-revision.ts';
import { SectionFrame } from './SectionFrame.tsx';

const ZOOM = 0.4;

/**
 * Annotations over the project's own pinned version: the frame carries that version's route, viewport and
 * capture digest from the projects content, so marks tie to the exact version. Static capture mode: there is
 * no preview agent, so Pick and Cite are unavailable.
 */
function AnnotationsViewContent({ context, surface, navigate }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const project = useDesignProject(context);
  const { annotationSessionFor } = workspace;
  const [choice, setChoice] = useState<{ projectId: string; version: string } | null>(null);
  const selection = choice?.projectId === project.id ? choice.version : undefined;
  const revision = useProjectContentRevision(workspace, project.id);
  const session = use<Awaited<ReturnType<typeof annotationSessionFor>>>(annotationSessionFor(project, { revision, ...(selection ? { selection } : {}) }));
  const scope = <ProjectScope project={project} navigate={navigate} />;
  if (session === null) return <SectionFrame lane="T5 annotations" entry="annotations/src/ui › AnnotationsPanel" tags={[workspace.storageTag]} scope={scope}><p>No saved project version is available to annotate.</p></SectionFrame>;
  const { target, controller } = session;
  const { viewport } = target.frame;
  const props = surface('capture');
  return <SectionFrame lane="T5 annotations" entry="annotations/src/ui › AnnotationsPanel" scope={scope} tags={workspace.bridged ? [workspace.storageTag] : [FAKE_TAG, SYNTHETIC_TAG]}
    notes={[`pinned to ${target.version}`, 'no preview agent: Pick/Cite unavailable', 'fake clipboard', workspace.bridged ? (target.captureUrl ? 'saved capture image' : 'Capture bytes unavailable') : 'thumbnail stands in for the capture']}>
    <label>Version
      <select aria-label="Annotation version" value={target.version} onChange={(event) => {
        const version = event.currentTarget.value;
        startTransition(() => setChoice({ projectId: project.id, version }));
      }}>
        {session.choices.map((item) => <option key={item.id} value={item.id}>{item.view ? `${item.view} · ` : ''}{item.label}</option>)}
      </select>
    </label>
    <AnnotationsPanel key={target.version} controller={controller} overlayFrame={{ viewport, scroll: { x: 0, y: 0 }, zoom: ZOOM }} title={workspace.bridged ? "Annotations" : "Annotations (synthetic version)"}>
      <div {...props} aria-label={workspace.bridged ? (target.captureUrl ? "Saved capture" : "Capture unavailable") : "Synthetic capture thumbnail (not a real version)"}
        style={{ ...props.style, width: viewport.w * ZOOM, height: viewport.h * ZOOM, background: '#fdfcf7', position: 'relative', overflow: 'hidden' }}>
        {(target.captureUrl ?? target.thumbnailUrl) === null ? null : <img src={target.captureUrl ?? target.thumbnailUrl ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'fill', imageRendering: 'pixelated' }} />}
      </div>
    </AnnotationsPanel>
  </SectionFrame>;
}

export const AnnotationsView = withSectionErrorBoundary(AnnotationsViewContent);

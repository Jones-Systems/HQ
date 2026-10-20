import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { AnnotationsPanel } from '../../../annotations/src/ui/AnnotationsPanel.tsx';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { annotationSessionFor } from '../workspace.ts';
import { SectionFrame } from './SectionFrame.tsx';

const ZOOM = 0.4;

/**
 * Annotations over the project's own pinned version: the frame carries that version's route, viewport and
 * capture digest from the projects content, so marks tie to the exact version. Static capture mode: there is
 * no preview agent, so Pick and Cite are unavailable.
 */
export function AnnotationsView({ context, surface }: DesignSectionProps) {
  const { target, controller } = use(annotationSessionFor(context));
  const { viewport } = target.frame;
  const props = surface('capture');
  return <SectionFrame lane="T5 annotations" entry="annotations/src/ui › AnnotationsPanel" tags={[FAKE_TAG, SYNTHETIC_TAG]}
    notes={[`pinned to ${target.version}`, 'no preview agent: Pick/Cite unavailable', 'fake clipboard', 'thumbnail stands in for the capture']}>
    <AnnotationsPanel controller={controller} overlayFrame={{ viewport, scroll: { x: 0, y: 0 }, zoom: ZOOM }} title="Annotations (synthetic version)">
      <div {...props} aria-label="Synthetic capture thumbnail (not a real version)"
        style={{ ...props.style, width: viewport.w * ZOOM, height: viewport.h * ZOOM, background: '#fdfcf7', position: 'relative', overflow: 'hidden' }}>
        {target.thumbnailUrl === null ? null : <img src={target.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'fill', imageRendering: 'pixelated' }} />}
      </div>
    </AnnotationsPanel>
  </SectionFrame>;
}

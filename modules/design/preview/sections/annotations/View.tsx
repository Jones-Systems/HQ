import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { AnnotationController, loadAnnotations } from '../../../annotations/src/controller.ts';
import { versionId, type SourceFrame } from '../../../annotations/src/contract.ts';
import { FakeClipboard, MemoryAnnotationStore, SequentialIds } from '../../../annotations/src/fakes.ts';
import { AnnotationsPanel } from '../../../annotations/src/ui/AnnotationsPanel.tsx';
import { PreviewFrame } from '../../PreviewFrame.tsx';
import { perProject } from '../../seeds.ts';

const VIEWPORT = { w: 1280, h: 800, dpr: 1 };
const OVERLAY = { viewport: VIEWPORT, scroll: { x: 0, y: 0 }, zoom: 0.5 };

/**
 * Static capture mode: no agent channel is supplied, so Pick element and Cite text
 * are visibly unavailable. Two synthetic marks are drawn through the controller.
 */
const load = perProject(async (project) => {
  const store = new MemoryAnnotationStore();
  const version = versionId(`${project.id}-home-v1`);
  const controller = new AnnotationController(await loadAnnotations(store, version), {
    ids: new SequentialIds(), clipboard: new FakeClipboard(), store,
  });
  const frame: SourceFrame = { versionId: version, route: '/home', state: 'default', viewport: VIEWPORT, scroll: { x: 0, y: 0 }, captureDigest: 'sha256:synthetic-capture' };
  controller.setFrame(frame);
  controller.selectTool('box');
  controller.draw('box', [{ x: 96, y: 120 }, { x: 620, y: 260 }], 'Tighten the hero heading spacing');
  controller.selectTool('arrow');
  controller.draw('arrow', [{ x: 900, y: 520 }, { x: 700, y: 420 }], 'Primary action should lead here');
  controller.selectTool(null);
  return controller;
});

/** Synthetic capture surface under the overlay. Fixed producer colours, unaffected by HQ appearance. */
function SyntheticCapture({ surface }: Pick<DesignSectionProps, 'surface'>) {
  return <div {...surface('capture')} aria-label="Synthetic capture (not a real version)"
    style={{ ...surface('capture').style, width: VIEWPORT.w * OVERLAY.zoom, height: VIEWPORT.h * OVERLAY.zoom, background: '#fdfcf7', position: 'relative' }}>
    <div style={{ position: 'absolute', left: 48, top: 60, width: 260, height: 70, background: '#2d3a8c' }} />
    <div style={{ position: 'absolute', left: 48, top: 150, width: 420, height: 12, background: '#c9c6bb' }} />
    <div style={{ position: 'absolute', left: 48, top: 172, width: 360, height: 12, background: '#c9c6bb' }} />
    <div style={{ position: 'absolute', left: 340, top: 230, width: 120, height: 36, borderRadius: 6, background: '#e4572e' }} />
  </div>;
}

export function AnnotationsPreview({ context, surface }: DesignSectionProps) {
  const controller = use(load(context));
  return <PreviewFrame lane="T5 annotations" entry="annotations/src/ui › AnnotationsPanel"
    notes={['static synthetic capture', 'no preview agent: Pick/Cite unavailable', 'fake clipboard']}>
    <AnnotationsPanel controller={controller} overlayFrame={OVERLAY} title="Annotations (synthetic capture)">
      <SyntheticCapture surface={surface} />
    </AnnotationsPanel>
  </PreviewFrame>;
}

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { OverlayFrame as CompareFrame } from '../../../compare/src/contract.ts';
import type { AnnotationController } from '../../../annotations/src/controller.ts';
import { resolveForDisplay } from '../../../annotations/src/resolution.ts';
import type { Tool } from '../../../annotations/src/editor.ts';
import { AnnotationOverlay } from '../../../annotations/src/ui/AnnotationOverlay.tsx';
import { adaptCompareFrame } from '../review-slots.ts';
import { annotationsEnv } from '../workspace.ts';

export type DrawTool = Extract<Tool, 'ink' | 'box' | 'arrow' | 'eraser'>;

function Layer({ controller, tool, overlay, display, readOnlyReason }: {
  readonly controller: AnnotationController; readonly tool: DrawTool | null;
  readonly overlay: Parameters<typeof AnnotationOverlay>[0]['frame']; readonly display: Parameters<typeof resolveForDisplay>[1];
  readonly readOnlyReason: string | null;
}) {
  const snapshot = useSyncExternalStore((listener) => controller.subscribe(listener), () => controller.snapshot, () => controller.snapshot);
  useEffect(() => { controller.selectTool(tool); }, [controller, tool]);
  const resolved = snapshot.editor.document.annotations.map((annotation) => resolveForDisplay(annotation, display));
  return <AnnotationOverlay frame={overlay} tool={tool} resolved={resolved} revisit={new Set(snapshot.editor.document.revisit)} selectedId={null}
    readOnly={snapshot.readOnly || readOnlyReason !== null} onDraw={(kind, points) => { controller.draw(kind, points); }}
    onErase={(point, radius) => { controller.erase(point, radius); }} onSelect={() => undefined} />;
}

/**
 * Compare's `renderOverlay` slot filled with the annotations overlay. The slot sits inside compare's scaled
 * frame, so the overlay box is counter-scaled: marks draw in screen pixels and pointer positions convert
 * back to source CSS pixels with compare's fit scale. A live preview has no frozen bytes, so it shows why
 * marks are unavailable instead of anchoring to nothing.
 */
export function AnnotationSlot({ frame, tool }: { readonly frame: CompareFrame; readonly tool: DrawTool | null }) {
  const adapted = adaptCompareFrame(frame);
  const [controller, setController] = useState<AnnotationController | null>(null);
  const source = adapted.status === 'ready' ? adapted.source : null;
  useEffect(() => {
    if (source === null) { setController(null); return undefined; }
    let current = true;
    void annotationsEnv().controllerFor(source.versionId).then((next) => {
      if (!current) return;
      next.setFrame(source);
      setController(next);
    });
    return () => { current = false; };
  }, [source?.versionId, source?.route, source?.state, source?.captureDigest, source?.viewport.w, source?.viewport.h, source?.viewport.dpr, source?.scroll.x, source?.scroll.y]);
  if (adapted.status === 'unavailable') return <span className="hqd-compose-note" role="note" style={{ position: 'absolute', left: 8, top: 8 }}>{adapted.message}</span>;
  if (controller === null) return null;
  const { content, overlay, display } = adapted;
  const scale = overlay.zoom;
  return <div style={{ position: 'absolute', left: 0, top: 0, width: content.width * scale, height: content.height * scale, transform: `scale(${1 / scale})`, transformOrigin: '0 0' }}>
    <Layer controller={controller} tool={tool} overlay={overlay} display={display} readOnlyReason={null} />
  </div>;
}

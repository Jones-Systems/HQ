import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { IconButton } from '@hq/ui';
import type { OverlayFrame as CompareFrame } from '../../../compare/src/contract.ts';
import type { AnnotationController } from '../../../annotations/src/controller.ts';
import { resolveForDisplay } from '../../../annotations/src/resolution.ts';
import type { Tool } from '../../../annotations/src/editor.ts';
import { AnnotationOverlay } from '../../../annotations/src/ui/AnnotationOverlay.tsx';
import { Reason } from '../../../compare/src/view/index.tsx';
import { adaptCompareFrame } from '../review-slots.ts';

import { useDesignWorkspace } from '../workspace-context.tsx';

export type DrawTool = Extract<Tool, 'ink' | 'box' | 'arrow' | 'eraser'>;

const icon = (paths: ReactNode) => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>;

/** `null` is the plain pointer: panels scroll and nothing is drawn. */
const TOOLS: readonly { readonly id: DrawTool | null; readonly label: string; readonly glyph: ReactNode }[] = [
  { id: null, label: 'Select', glyph: icon(<path d="M5 3.5 15 9l-4.2 1.3L13.5 15l-1.8 1-2.7-4.7L5.5 14.5z" />) },
  { id: 'box', label: 'Box', glyph: icon(<rect x="4" y="5.5" width="12" height="9" rx="1.5" />) },
  { id: 'arrow', label: 'Arrow', glyph: icon(<path d="M5 15 15 5M8.5 5H15v6.5" />) },
  { id: 'ink', label: 'Ink', glyph: icon(<><path d="m4 16 .8-3.6L13 4.2l3 3-8.2 8.2z" /><path d="m11.5 5.8 2.7 2.7" /></>) },
  { id: 'eraser', label: 'Eraser', glyph: icon(<><path d="m8.5 16.5 7.5-7.5-4.5-4.5L4 12l3 4.5z" /><path d="M8 8.5 12.5 13M8.5 16.5H16" /></>) },
];

/**
 * Annotation tools as a compact icon group for the compare toolbar. An unavailable tool stays visible and focusable
 * (`aria-disabled`) with its reason on hover and keyboard focus, and its activation is guarded.
 */
export function AnnotationTools({ tool, onChange, unavailableReason }: {
  readonly tool: DrawTool | null;
  readonly onChange: (tool: DrawTool | null) => void;
  readonly unavailableReason: string | null;
}) {
  const reasonId = useId();
  const reason = unavailableReason;
  return <span className="cmp-action">
    <span className="cmp-tools" role="group" aria-label="Annotation tool for compare panels">
      {TOOLS.map(({ id, label, glyph }) => <IconButton key={label} size="sm" label={label} icon={glyph} pressed={tool === id}
        aria-disabled={reason !== null ? true : undefined} aria-describedby={reason !== null ? reasonId : undefined}
        onClick={() => { if (reason === null) onChange(id); }} />)}
    </span>
    {reason !== null && <Reason id={reasonId}>{reason}</Reason>}
  </span>;
}

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
  const workspace = useDesignWorkspace();
  const { annotationsEnv } = workspace;
  const adapted = adaptCompareFrame(frame);
  const [error, setError] = useState(false);
  const [controller, setController] = useState<AnnotationController | null>(null);
  const source = adapted.status === 'ready' ? adapted.source : null;
  useEffect(() => {
    if (source === null) { setController(null); return undefined; }
    let current = true;
    setError(false);
    setController(null);
    void annotationsEnv().controllerFor(source.versionId).then((next) => {
      if (!current) return;
      next.setFrame(source);
      setController(next);
    }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [source?.versionId, source?.route, source?.state, source?.captureDigest, source?.viewport.w, source?.viewport.h, source?.viewport.dpr, source?.scroll.x, source?.scroll.y]);
  if (error) return <span role="alert">Annotations unavailable.</span>;
  // A live preview has no frozen bytes. Say so once someone picks a tool to draw with, not on every panel at rest.
  if (adapted.status === 'unavailable') return tool === null ? null : <span className="hqd-compose-note" role="note" style={{ position: 'absolute', left: 8, top: 8 }}>{adapted.message}</span>;
  if (controller === null) return null;
  const { content, overlay, display } = adapted;
  const scale = overlay.zoom;
  return <div style={{ position: 'absolute', left: 0, top: 0, width: content.width * scale, height: content.height * scale, transform: `scale(${1 / scale})`, transformOrigin: '0 0' }}>
    <Layer controller={controller} tool={tool} overlay={overlay} display={display} readOnlyReason={null} />
  </div>;
}

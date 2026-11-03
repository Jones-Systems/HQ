import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Point } from '../contract.ts';
import type { DrawKind, Tool } from '../editor.ts';
import { overlayToSourcePoint, sourceToOverlayPoint, sourceToOverlayRect } from '../geometry.ts';
import type { OverlayFrame } from '../geometry.ts';
import type { AnchorStatus, ResolvedAnnotation } from '../resolution.ts';

export interface OverlayProps {
  readonly frame: OverlayFrame;
  readonly tool: Tool | null;
  readonly resolved: readonly ResolvedAnnotation[];
  readonly revisit: ReadonlySet<string>;
  readonly selectedId: string | null;
  readonly readOnly: boolean;
  /** Points are source CSS px. */
  readonly onDraw: (kind: DrawKind, points: readonly Point[]) => void;
  readonly onErase: (point: Point, radius: number) => void;
  readonly onSelect: (id: string) => void;
}

const DRAW_TOOLS: readonly Tool[] = ['ink', 'box', 'arrow', 'label'];
const MARK = '#e4572e';
const ERASER_RADIUS_PX = 8;

function dashFor(status: AnchorStatus): string | undefined {
  return status === 'missing' || status === 'frame-mismatch' || status === 'changed' ? '6 4' : undefined;
}

/**
 * SVG overlay over a preview or capture. Pick/Cite gestures go to the preview
 * agent, so the overlay lets pointer events through for those tools.
 */
export function AnnotationOverlay(props: OverlayProps) {
  const { frame, tool, readOnly } = props;
  const [stroke, setStroke] = useState<Point[] | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const capturing = !readOnly && tool !== null && tool !== 'pick' && tool !== 'cite';

  const sourcePoint = (event: ReactPointerEvent<SVGSVGElement>): Point => {
    const box = svg.current!.getBoundingClientRect();
    return overlayToSourcePoint({ x: event.clientX - box.left, y: event.clientY - box.top }, frame);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!capturing || tool === null) return;
    const point = sourcePoint(event);
    if (tool === 'eraser') return props.onErase(point, ERASER_RADIUS_PX / frame.zoom);
    if (tool === 'label') return props.onDraw('label', [point]);
    event.currentTarget.setPointerCapture(event.pointerId);
    setStroke([point]);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (stroke === null) return;
    const point = sourcePoint(event);
    setStroke(tool === 'ink' ? [...stroke, point] : [stroke[0]!, point]);
  };
  const onPointerUp = () => {
    if (stroke !== null && tool !== null && DRAW_TOOLS.includes(tool)) props.onDraw(tool as DrawKind, stroke);
    setStroke(null);
  };

  const toOverlay = (p: Point) => sourceToOverlayPoint(p, frame);
  const polyline = (points: readonly Point[]) => points.map(toOverlay).map((p) => `${p.x},${p.y}`).join(' ');

  return <svg ref={svg} role="img" aria-label="Annotations overlay" data-testid="annotation-overlay"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: capturing ? 'auto' : 'none', cursor: capturing ? 'crosshair' : 'default' }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setStroke(null)}>
    <defs>
      <marker id="hq-annotation-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill={MARK} />
      </marker>
    </defs>
    {props.resolved.map(({ annotation, status, rects, points }) => {
      if (status === 'other-version') return null;
      const selected = props.selectedId === annotation.id;
      const width = selected ? 3 : 2;
      const dash = dashFor(status);
      const anchorPoint = rects[0] !== undefined ? toOverlay(rects[0]) : points[0] !== undefined ? toOverlay(points[0]) : null;
      return <g key={annotation.id} data-letter={annotation.letter} data-status={status} onClick={() => props.onSelect(annotation.id)}>
        {annotation.kind === 'label' ? null : rects.map((rect, i) => {
          const r = sourceToOverlayRect(rect, frame);
          return <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={annotation.kind === 'cite' ? 'rgba(228,87,46,0.15)' : 'none'}
            stroke={MARK} strokeWidth={width} strokeDasharray={dash} />;
        })}
        {points.length > 0 ? <polyline points={polyline(points)} fill="none" stroke={MARK} strokeWidth={width} strokeDasharray={dash}
          strokeLinecap="round" strokeLinejoin="round" markerEnd={annotation.kind === 'arrow' ? 'url(#hq-annotation-arrow)' : undefined} /> : null}
        {anchorPoint === null ? null : <g transform={`translate(${anchorPoint.x},${anchorPoint.y})`}>
          <circle r={10} fill={MARK} />
          <text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={11} fontWeight={700}>{annotation.letter}</text>
          {props.revisit.has(annotation.id) ? <circle r={13} fill="none" stroke={MARK} strokeWidth={1.5} strokeDasharray="2 2" /> : null}
          {annotation.kind === 'label' ? <text x={16} dominantBaseline="central" fill={MARK} fontSize={13} fontWeight={600}>{annotation.note}</text> : null}
        </g>}
      </g>;
    })}
    {stroke === null ? null : tool === 'box' && stroke.length > 1
      ? (() => {
        const a = toOverlay(stroke[0]!);
        const b = toOverlay(stroke[stroke.length - 1]!);
        return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} fill="none" stroke={MARK} strokeDasharray="4 3" />;
      })()
      : <polyline points={polyline(stroke)} fill="none" stroke={MARK} strokeWidth={2} strokeDasharray={tool === 'ink' ? undefined : '4 3'} />}
  </svg>;
}

import { useEffect, useLayoutEffect, useRef, type Dispatch, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasItemDescriptor, NodeId, Placement, Rect } from '../contract.ts';
import { handlesKey, visibleArrangement, type CanvasAction, type CanvasState } from '../controller.ts';
import { worldToScreen } from '../geometry.ts';
import type { Platform } from '../input.ts';
import { fallbackTitle, PROVENANCE_LABELS } from '../inspector.ts';
import type { ProviderRegistry } from '../providers.ts';

/** Renders a provider item's content inside its placement frame (world units, before zoom). */
export type CanvasItemRenderer = (descriptor: CanvasItemDescriptor, placement: Placement) => ReactNode;

export interface CanvasViewProps {
  readonly state: CanvasState;
  readonly dispatch: Dispatch<CanvasAction>;
  readonly registry: ProviderRegistry;
  readonly platform: Platform;
  /** Optional per-provider renderers supplied by root. Missing renderers show a labelled card. */
  readonly renderers?: Readonly<Record<string, CanvasItemRenderer>>;
  readonly label?: string;
}

export function detectPlatform(): Platform {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return nav && /Mac|iPhone|iPad/u.test(nav.platform || nav.userAgent) ? 'mac' : 'other';
}

function screenRect(state: CanvasState, frame: Rect): Rect {
  const origin = worldToScreen(state.camera, frame);
  return { x: origin.x, y: origin.y, width: frame.width * state.camera.zoom, height: frame.height * state.camera.zoom };
}

const px = (rect: Rect) => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });

function ItemContent({ placement, registry, renderers }: { placement: Placement; registry: ProviderRegistry; renderers: Readonly<Record<string, CanvasItemRenderer>> }) {
  const description = registry.describe(placement.ref);
  if (description.status !== 'ready') {
    const reason = description.status === 'missing-provider' ? 'Provider not available'
      : description.status === 'missing-item' ? 'Revision not found' : description.message;
    return <div className="hq-canvas-card is-missing">
      <strong>{fallbackTitle(placement.ref)}</strong>
      <span>{reason}</span>
    </div>;
  }
  const renderer = renderers[placement.ref.providerId];
  if (renderer) return <>{renderer(description.descriptor, placement)}</>;
  const { descriptor } = description;
  return <div className="hq-canvas-card">
    <strong>{descriptor.title}</strong>
    <span>{descriptor.kind} · {descriptor.ref.revision}</span>
    <span className="hq-canvas-provenance" data-provenance={descriptor.provenance}>{PROVENANCE_LABELS[descriptor.provenance]}</span>
  </div>;
}

function nodeLabel(registry: ProviderRegistry, placement: Placement): string {
  const description = registry.describe(placement.ref);
  return description.status === 'ready' ? description.descriptor.title : fallbackTitle(placement.ref);
}

/**
 * The infinite canvas surface. All behavior lives in the pure reducer; this
 * component translates DOM input into actions and renders the camera.
 */
export function CanvasView({ state, dispatch, registry, platform, renderers = {}, label = 'Design canvas' }: CanvasViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const spaceHeld = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const arrangement = visibleArrangement(state);
  const { camera } = state;

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => dispatch({ type: 'viewport', size: { width: element.clientWidth, height: element.clientHeight } });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [dispatch]);

  // React's wheel listener is passive; a native one is needed to stop page scroll and browser zoom.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      dispatch({
        type: 'wheel', anchor: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        input: { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey },
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [dispatch]);

  // Keep DOM focus on the node that holds canvas focus.
  useEffect(() => {
    const element = root.current;
    if (!element || !element.contains(document.activeElement)) return;
    const target = state.focusId ? element.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(state.focusId)}"]`) : element;
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [state.focusId]);

  const point = (event: { clientX: number; clientY: number }) => {
    const bounds = root.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    const target = (hit?.dataset.nodeId ?? null) as NodeId | null;
    const pan = event.button === 1 || spaceHeld.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.button === 1) event.preventDefault();
    if (!pan && target === null) root.current?.focus({ preventScroll: true });
    dispatch({ type: 'pointer-down', point: point(event), target, toggle: event.shiftKey || (platform === 'mac' ? event.metaKey : event.ctrlKey), pan });
  };

  const selected = new Set<string>(state.selection);
  const marquee = state.gesture?.kind === 'marquee' ? state.gesture : null;
  const gridStep = arrangement.grid.size * camera.zoom;
  const showGrid = gridStep >= 6;

  return <div
    ref={root}
    className="hq-canvas"
    tabIndex={state.focusId === null ? 0 : -1}
    role="application"
    aria-roledescription="canvas"
    aria-label={`${label}${state.readOnly ? ' (read-only)' : ''}`}
    data-gesture={state.gesture?.kind ?? undefined}
    style={showGrid ? {
      backgroundSize: `${gridStep}px ${gridStep}px`,
      backgroundPosition: `${-camera.x * camera.zoom}px ${-camera.y * camera.zoom}px`,
    } : { backgroundImage: 'none' }}
    onPointerDown={onPointerDown}
    onPointerMove={(event) => { if (stateRef.current.gesture) dispatch({ type: 'pointer-move', point: point(event), noSnap: platform === 'mac' ? event.metaKey : event.ctrlKey }); }}
    onPointerUp={() => dispatch({ type: 'pointer-up' })}
    onPointerCancel={() => dispatch({ type: 'pointer-cancel' })}
    onLostPointerCapture={() => { if (stateRef.current.gesture) dispatch({ type: 'pointer-up' }); }}
    onFocus={(event) => {
      if (event.target === root.current) { if (stateRef.current.focusId !== null) dispatch({ type: 'focus', id: null }); return; }
      const id = (event.target as HTMLElement).dataset.nodeId as NodeId | undefined;
      if (id && id !== stateRef.current.focusId) dispatch({ type: 'focus', id });
    }}
    onKeyDown={(event) => {
      if (event.key === ' ' && !event.repeat) spaceHeld.current = true;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const input = { key: event.key, code: event.code, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
      if (!handlesKey(stateRef.current, input, platform)) {
        if (event.key === ' ') event.preventDefault();
        return;
      }
      event.preventDefault();
      dispatch({ type: 'key', input, platform });
    }}
    onKeyUp={(event) => { if (event.key === ' ') spaceHeld.current = false; }}
    onBlur={() => { spaceHeld.current = false; }}
  >
    <div className="hq-canvas-world" style={{ transform: `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})` }}>
      {arrangement.artboards.map((board) => <div
        key={board.id} className="hq-canvas-artboard" data-node-id={board.id} data-selected={selected.has(board.id) || undefined}
        role="group" aria-label={`Artboard ${board.name}`} tabIndex={state.focusId === board.id ? 0 : -1}
        style={px(board.frame)} />)}
      {arrangement.items.filter((item) => !item.hidden).map((item) => <div
        key={item.id} className="hq-canvas-item" data-node-id={item.id} data-selected={selected.has(item.id) || undefined}
        data-locked={item.locked || undefined} role="button" aria-pressed={selected.has(item.id)}
        aria-label={nodeLabel(registry, item)} tabIndex={state.focusId === item.id ? 0 : -1} style={px(item.frame)}>
        <ItemContent placement={item} registry={registry} renderers={renderers} />
      </div>)}
    </div>
    <div className="hq-canvas-overlay" aria-hidden="true">
      {arrangement.artboards.map((board) => {
        const rect = screenRect(state, board.frame);
        return <span key={board.id} className="hq-canvas-artboard-name" style={{ left: rect.x, top: rect.y - 20 }}>{board.name}</span>;
      })}
      {state.selection.map((id) => {
        const node = arrangement.items.find((item) => item.id === id) ?? arrangement.artboards.find((board) => board.id === id);
        return node ? <div key={id} className="hq-canvas-selection" style={px(screenRect(state, node.frame))} /> : null;
      })}
      {state.guides.map((guide, index) => {
        const start = worldToScreen(camera, guide.axis === 'x' ? { x: guide.at, y: guide.from } : { x: guide.from, y: guide.at });
        const end = worldToScreen(camera, guide.axis === 'x' ? { x: guide.at, y: guide.to } : { x: guide.to, y: guide.at });
        return <div key={index} className="hq-canvas-guide" data-axis={guide.axis}
          style={guide.axis === 'x' ? { left: start.x, top: start.y, height: end.y - start.y } : { left: start.x, top: start.y, width: end.x - start.x }} />;
      })}
      {marquee && <div className="hq-canvas-marquee" style={px(screenRect(state, {
        x: Math.min(marquee.origin.x, marquee.current.x), y: Math.min(marquee.origin.y, marquee.current.y),
        width: Math.abs(marquee.current.x - marquee.origin.x), height: Math.abs(marquee.current.y - marquee.origin.y),
      }))} />}
    </div>
  </div>;
}

import {
  isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type Dispatch, type ReactNode, type PointerEvent as ReactPointerEvent,
} from 'react';
import { MOTION_DURATIONS, useReducedMotion } from '@hq/ui';
import type { CanvasItemDescriptor, NodeId, Placement, Rect } from '../contract.ts';
import { handlesKey, visibleArrangement, type CanvasAction, type CanvasState } from '../controller.ts';
import { worldToScreen } from '../geometry.ts';
import { keyCommand, type Platform } from '../input.ts';
import { fallbackTitle, PROVENANCE_LABELS } from '../inspector.ts';
import type { ProviderRegistry } from '../providers.ts';
import { cameraStyle, useCameraMotion } from './camera-motion.ts';

/**
 * What a renderer draws inside the frame: a node for the body alone, or a body with the caption's second line. The
 * frame adds the title and the caption strip, so a renderer never draws over its own capture.
 */
export interface CanvasItemFace {
  readonly body: ReactNode;
  /** Replaces the caption's second line. The default is the item's size and provenance. */
  readonly meta?: string;
}

/** Renders a provider item's content inside its placement frame (world units, before zoom). */
export type CanvasItemRenderer = (descriptor: CanvasItemDescriptor, placement: Placement) => ReactNode | CanvasItemFace;

export interface CanvasViewProps {
  readonly state: CanvasState;
  readonly dispatch: Dispatch<CanvasAction>;
  readonly registry: ProviderRegistry;
  readonly platform: Platform;
  /** Optional per-provider renderers supplied by root. Missing renderers show a labelled card. */
  readonly renderers?: Readonly<Record<string, CanvasItemRenderer>>;
  readonly label?: string;
  /**
   * The document has loaded, so items added from now on scale in and removed items scale out. Items present when it
   * loads appear without moving. Default true.
   */
  readonly settled?: boolean;
}

export function detectPlatform(): Platform {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return nav && /Mac|iPhone|iPad/u.test(nav.platform || nav.userAgent) ? 'mac' : 'other';
}

const isFace = (value: ReactNode | CanvasItemFace): value is CanvasItemFace =>
  typeof value === 'object' && value !== null && !isValidElement(value) && !Array.isArray(value) && 'body' in value;

/** The body of a renderer's output, for callers that draw it outside the frame, such as the inspector's preview. */
export const faceBody = (drawn: ReactNode | CanvasItemFace): ReactNode => (isFace(drawn) ? drawn.body : drawn);

function screenRect(state: CanvasState, frame: Rect): Rect {
  const origin = worldToScreen(state.camera, frame);
  return { x: origin.x, y: origin.y, width: frame.width * state.camera.zoom, height: frame.height * state.camera.zoom };
}

const px = (rect: Rect) => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });

/** A frame in world units for the overlay. CSS turns these and the camera into screen positions, so it follows a camera move. */
const frameVars = (frame: Rect) => ({
  '--hq-fx': String(frame.x), '--hq-fy': String(frame.y), '--hq-fw': String(frame.width), '--hq-fh': String(frame.height),
}) as CSSProperties;

/** Frames narrower than this on screen drop the caption, which would not fit. */
const COMPACT_SCREEN_PX = 140;
/** Frames smaller than this on screen have no room for text at all: they show the capture, or an empty well. */
const TINY_SCREEN_PX = { width: 72, height: 56 };

const sentence = (kind: string) => {
  const words = kind.replace(/[-_]+/gu, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function ItemContent({ placement, registry, renderers, zoom }: {
  placement: Placement; registry: ProviderRegistry; renderers: Readonly<Record<string, CanvasItemRenderer>>; zoom: number;
}) {
  const description = registry.describe(placement.ref);
  if (description.status !== 'ready') {
    const reason = description.status === 'missing-provider' ? 'Provider not available'
      : description.status === 'missing-item' ? 'Revision not found' : description.message;
    return <div className="hq-canvas-card is-missing">
      <div className="hq-canvas-card-body"><div className="hq-canvas-placeholder"><span>{reason}</span></div></div>
      <div className="hq-canvas-caption"><strong title={fallbackTitle(placement.ref)}>{fallbackTitle(placement.ref)}</strong></div>
    </div>;
  }
  const { descriptor } = description;
  const renderer = renderers[placement.ref.providerId];
  const drawn = renderer ? renderer(descriptor, placement) : null;
  const face = isFace(drawn) ? drawn : { body: drawn };
  const meta = face.meta ?? `${descriptor.intrinsicSize.width}×${descriptor.intrinsicSize.height} · ${PROVENANCE_LABELS[descriptor.provenance]}`;
  const compact = placement.frame.width * zoom < COMPACT_SCREEN_PX || placement.frame.height * zoom < COMPACT_SCREEN_PX * 0.7;
  const tiny = placement.frame.width * zoom < TINY_SCREEN_PX.width || placement.frame.height * zoom < TINY_SCREEN_PX.height;
  return <div className="hq-canvas-card" data-kind={descriptor.kind} data-compact={tiny ? 'tiny' : compact || undefined}>
    <div className="hq-canvas-card-body">
      {face.body ?? <div className="hq-canvas-placeholder"><span>{sentence(descriptor.kind)}</span></div>}
    </div>
    {!compact && <div className="hq-canvas-caption">
      <strong title={descriptor.title}>{descriptor.title}</strong>
      <span title={meta}>{meta}</span>
    </div>}
  </div>;
}

function nodeLabel(registry: ProviderRegistry, placement: Placement): string {
  const description = registry.describe(placement.ref);
  return description.status === 'ready' ? description.descriptor.title : fallbackTitle(placement.ref);
}

/** Removed items stay on screen until their exit animation ends. Never created under reduced motion. */
function Ghost({ item, onDone, children }: { item: Placement; onDone: (id: string) => void; children: ReactNode }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(item.id), MOTION_DURATIONS.slow + 80);
    return () => clearTimeout(timer);
  }, [item.id, onDone]);
  return <div className="hq-canvas-item" aria-hidden="true" data-hq-presence="exit" data-hq-motion="scale" style={px(item.frame)}
    onAnimationEnd={(event) => { if (event.target === event.currentTarget) onDone(item.id); }}>{children}</div>;
}

/**
 * The infinite canvas surface. All behavior lives in the pure reducer; this
 * component translates DOM input into actions and renders the camera.
 */
export function CanvasView({ state, dispatch, registry, platform, renderers = {}, label = 'Design canvas', settled = true }: CanvasViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const spaceHeld = useRef(false);
  const noSnap = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const arrangement = visibleArrangement(state);
  const { camera } = state;
  const { settle } = useCameraMotion(root, camera, state.cameraEase, state.viewport);

  // Direct input starts from the camera the page shows, so a wheel or drag in the middle of an eased move does not jump.
  const settleCamera = useCallback(() => {
    const live = settle();
    if (live) dispatch({ type: 'camera', camera: live });
  }, [settle, dispatch]);

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
      settleCamera();
      const bounds = element.getBoundingClientRect();
      dispatch({
        type: 'wheel', anchor: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        input: { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey },
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [dispatch, settleCamera]);

  // Keep DOM focus on the node that holds canvas focus.
  useEffect(() => {
    const element = root.current;
    if (!element || !element.contains(document.activeElement)) return;
    const target = state.focusId ? element.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(state.focusId)}"]`) : element;
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [state.focusId]);

  // Items added after the document loaded scale in, and removed ones scale out. Items already there never move on load.
  const reducedMotion = useReducedMotion();
  const animateRef = useRef(false);
  const animate = animateRef.current;
  useEffect(() => { animateRef.current = settled; });
  const visibleItems = arrangement.items.filter((item) => !item.hidden);
  const previousItems = useRef<readonly Placement[]>(visibleItems);
  const [ghosts, setGhosts] = useState<readonly Placement[]>([]);
  useLayoutEffect(() => {
    const now = new Set<string>(visibleItems.map((item) => item.id));
    const gone = animate && !reducedMotion ? previousItems.current.filter((item) => !now.has(item.id)) : [];
    previousItems.current = visibleItems;
    setGhosts((current) => {
      const kept = current.filter((ghost) => !now.has(ghost.id));
      const added = gone.filter((item) => !kept.some((ghost) => ghost.id === item.id));
      return added.length === 0 && kept.length === current.length ? current : [...kept, ...added];
    });
  });
  const dropGhost = useCallback((id: string) => setGhosts((current) => current.filter((ghost) => ghost.id !== id)), []);

  // After a real drag ends, the frames of what moved settle once more so the move reads as finished.
  const moving = state.gesture?.kind === 'move';
  const [dropped, setDropped] = useState<{ readonly tick: number; readonly ids: readonly string[] }>({ tick: 0, ids: [] });
  const drag = useRef<{ ids: readonly string[]; moved: boolean } | null>(null);
  useEffect(() => {
    if (state.gesture?.kind === 'move') {
      drag.current = { ids: state.gesture.ids, moved: (drag.current?.moved ?? false) || state.preview !== null };
      return;
    }
    const finished = drag.current;
    drag.current = null;
    if (finished?.moved) setDropped((current) => ({ tick: current.tick + 1, ids: finished.ids }));
  }, [state.gesture, state.preview]);

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
    settleCamera();
    dispatch({ type: 'pointer-down', point: point(event), target, toggle: event.shiftKey || (platform === 'mac' ? event.metaKey : event.ctrlKey), pan });
  };

  const selected = new Set<string>(state.selection);
  const draggingIds = new Set<string>(state.gesture?.kind === 'move' ? state.gesture.ids : []);
  const marquee = state.gesture?.kind === 'marquee' ? state.gesture : null;
  const gridStep = arrangement.grid.size * camera.zoom;
  const showGrid = gridStep >= 6;
  const snapping = moving && arrangement.grid.snap && !noSnap.current;

  return <div
    ref={root}
    className="hq-canvas"
    tabIndex={state.focusId === null ? 0 : -1}
    role="application"
    aria-roledescription="canvas"
    aria-label={`${label}${state.readOnly ? ' (read-only)' : ''}`}
    data-gesture={state.gesture?.kind ?? undefined}
    data-grid={showGrid ? 'on' : 'off'}
    data-snap={snapping || undefined}
    style={cameraStyle(camera, { '--hq-canvas-grid': String(arrangement.grid.size) })}
    onPointerDown={onPointerDown}
    onPointerMove={(event) => {
      noSnap.current = platform === 'mac' ? event.metaKey : event.ctrlKey;
      if (stateRef.current.gesture) dispatch({ type: 'pointer-move', point: point(event), noSnap: noSnap.current });
    }}
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
      // Zoom, fit and focus steps ease from where the camera is; every other key (panning, nudging) acts on what is shown.
      const command = keyCommand(input, platform, stateRef.current.selection.length > 0);
      if (command && command.kind !== 'zoom-step' && command.kind !== 'zoom-reset' && command.kind !== 'fit' && command.kind !== 'focus-step') settleCamera();
      dispatch({ type: 'key', input, platform });
    }}
    onKeyUp={(event) => { if (event.key === ' ') spaceHeld.current = false; }}
    onBlur={() => { spaceHeld.current = false; }}
  >
    <div className="hq-canvas-world">
      {arrangement.artboards.map((board) => <div
        key={board.id} className="hq-canvas-artboard" data-node-id={board.id} data-selected={selected.has(board.id) || undefined}
        role="group" aria-label={`Artboard ${board.name}`} tabIndex={state.focusId === board.id ? 0 : -1}
        style={px(board.frame)} />)}
      {visibleItems.map((item) => <ItemShell key={item.id} enter={animate} item={item} selected={selected.has(item.id)} dragging={draggingIds.has(item.id)}
        label={nodeLabel(registry, item)} tabIndex={state.focusId === item.id ? 0 : -1}>
        <ItemContent placement={item} registry={registry} renderers={renderers} zoom={camera.zoom} />
      </ItemShell>)}
      {ghosts.map((item) => <Ghost key={`gone:${item.id}`} item={item} onDone={dropGhost}>
        <ItemContent placement={item} registry={registry} renderers={renderers} zoom={camera.zoom} />
      </Ghost>)}
    </div>
    <div className="hq-canvas-overlay" aria-hidden="true">
      {arrangement.artboards.map((board) => <span key={board.id} className="hq-canvas-artboard-name" style={frameVars(board.frame)}>{board.name}</span>)}
      {state.selection.map((id) => {
        const node = arrangement.items.find((item) => item.id === id) ?? arrangement.artboards.find((board) => board.id === id);
        const settling = dropped.ids.includes(id);
        return node ? <div key={settling ? `${id}:${dropped.tick}` : id} className="hq-canvas-selection" data-appear={settling ? 'settle' : 'select'}
          data-dragging={draggingIds.has(id) || undefined} style={frameVars(node.frame)} /> : null;
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

/** One placed item. `enter` is read once, when the item first mounts, so it never replays on later renders. */
function ItemShell({ item, selected, dragging, label, tabIndex, enter, children }: {
  item: Placement; selected: boolean; dragging: boolean; label: string; tabIndex: 0 | -1; enter: boolean; children: ReactNode;
}) {
  const [entering] = useState(enter);
  return <div className={entering ? 'hq-canvas-item hq-enter-scale' : 'hq-canvas-item'} data-node-id={item.id} data-selected={selected || undefined}
    data-locked={item.locked || undefined} data-dragging={dragging || undefined} role="button" aria-pressed={selected}
    aria-label={label} tabIndex={tabIndex} style={px(item.frame)}>
    {children}
  </div>;
}

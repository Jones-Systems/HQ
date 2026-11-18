import { useEffect, useLayoutEffect, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from 'react';
import { prefersReducedMotion } from '@hq/ui';
import { flash, settleGhost, tiltFor } from '../motion';
import { createDragController, type DragEnd, type DropTarget } from './drag';

// The board's drag physics (flow assessment D-2). The pointer machinery is `createDragController`; this adds what the
// user sees: a ghost that lifts and tilts with the pointer's velocity (written through CSSOM on a requestAnimationFrame
// loop, because the app CSP forbids style attributes), edge auto-scroll, a settle onto the landing slot with the shared
// spring, and a flight back to the origin when the drag is cancelled. Nothing here writes to the Planner: a finished
// drag hands one `onDrop` to the board's single move path.

/** How close to the scroller's edge the pointer must be before the columns scroll, and the fastest scroll per frame. */
const EDGE_PX = 56;
const MAX_SCROLL_PX = 16;

export interface BoardDragView { id: string; target: DropTarget | null }

export interface UseBoardDragOptions {
  rootRef: RefObject<HTMLElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  /** Maps a viewport point to a column slot or a status tab, without the dragged card. */
  hitTest(x: number, y: number, id: string): DropTarget | null;
  /** The finished drag, as one move. */
  onDrop(id: string, target: DropTarget): void;
  /** Escape, pointercancel or blur ended the drag; nothing moved. */
  onCancel(): void;
}

const sameTarget = (a: DropTarget | null, b: DropTarget | null) => a === b || (a !== null && b !== null && a.status === b.status && a.index === b.index && a.zone === b.zone);
const cardSelector = (id: string) => `[data-card-id="${CSS.escape(id)}"]`;

interface Setters {
  drag: Dispatch<SetStateAction<BoardDragView | null>>;
  ghost: Dispatch<SetStateAction<string | null>>;
  landing: Dispatch<SetStateAction<string | null>>;
}

function createEngine(options: { current: UseBoardDragOptions }, ghostRef: RefObject<HTMLDivElement | null>, set: Setters) {
  const grab = { dx: 0, dy: 0, width: 0, height: 0 };
  const pointer = { x: 0, y: 0, id: -1, vx: 0, lastX: 0, lastT: 0 };
  let frame = 0;
  let active = false;
  let finishSettle: (() => void) | null = null;

  const paint = () => {
    const ghost = ghostRef.current;
    if (!ghost) return;
    // Tilt follows horizontal velocity; reduced motion keeps the ghost upright.
    const tilt = prefersReducedMotion() ? 0 : tiltFor(pointer.vx);
    ghost.style.setProperty('--wk-ghost-w', `${grab.width}px`);
    ghost.style.setProperty('transform', `translate3d(${pointer.x - grab.dx}px, ${pointer.y - grab.dy}px, 0) rotate(${tilt}deg)`);
  };

  const autoScroll = () => {
    const scroller = options.current.scrollerRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const box = scroller.getBoundingClientRect();
    if (pointer.y < box.top || pointer.y > box.bottom) return;
    const ramp = (distance: number) => Math.max(2, Math.ceil(MAX_SCROLL_PX * (1 - Math.max(distance, 0) / EDGE_PX)));
    const step = pointer.x - box.left < EDGE_PX ? -ramp(pointer.x - box.left) : box.right - pointer.x < EDGE_PX ? ramp(box.right - pointer.x) : 0;
    if (!step) return;
    const before = scroller.scrollLeft;
    scroller.scrollLeft += step;
    // The columns moved under a still pointer: look again at what it is over.
    if (scroller.scrollLeft !== before) controller.pointerMove(pointer.id, pointer.x, pointer.y);
  };

  const loop = () => {
    frame = 0;
    if (!active) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - pointer.lastT);
    pointer.vx += ((pointer.x - pointer.lastX) / elapsed - pointer.vx) * 0.3;
    pointer.lastX = pointer.x;
    pointer.lastT = now;
    paint();
    autoScroll();
    frame = requestAnimationFrame(loop);
  };

  const start = (x: number, y: number) => {
    active = true;
    pointer.x = x; pointer.y = y; pointer.vx = 0; pointer.lastX = x; pointer.lastT = performance.now();
    // The gap that opens in a column is as tall as the card you are holding.
    options.current.rootRef.current?.style.setProperty('--wk-slot-h', `${grab.height}px`);
    if (!frame) frame = requestAnimationFrame(loop);
  };

  const finish = (id: string) => {
    set.ghost(null);
    set.landing(null);
    finishSettle = null;
    const card = options.current.rootRef.current?.querySelector<HTMLElement>(cardSelector(id));
    if (card) flash(card);
  };

  /** Flies the ghost onto the card's slot (its new place after a move, or its origin after a cancel), then reveals it. */
  const land = (id: string, target: DropTarget | null) => {
    const ghost = ghostRef.current;
    const root = options.current.rootRef.current;
    if (!ghost || !root) { finish(id); return; }
    const card = root.querySelector<HTMLElement>(cardSelector(id));
    let rect: DOMRect | undefined;
    if (card) {
      // The landed card may still be mid-glide (list motion); its slot is what we want, not where the glide starts.
      const slot = card.closest<HTMLElement>('[data-hq-motion-key]');
      if (typeof slot?.getAnimations === 'function') for (const animation of slot.getAnimations()) animation.cancel();
      rect = card.getBoundingClientRect();
    } else if (target) {
      // Dropped on a status tab or a collapsed rail: the card has no slot here, so the ghost shrinks into that target.
      const zone = target.zone === 'tab' ? `[data-drop-tab="${target.status}"]` : `[data-drop-status="${target.status}"]`;
      rect = root.querySelector<HTMLElement>(zone)?.getBoundingClientRect();
    }
    if (!rect) { finish(id); return; }
    let done = false;
    const complete = () => { if (!done) { done = true; finish(id); } };
    finishSettle = complete;
    settleGhost(ghost, rect, complete);
  };

  const onEnd = (end: DragEnd) => {
    active = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (end.reason === 'cancel') options.current.onCancel();
    if (!ghostRef.current) { set.ghost(null); return; }
    // Under reduced motion there is no flight: the ghost goes away at once.
    if (prefersReducedMotion()) { set.ghost(null); return; }
    set.landing(end.id);
    // A release over a column waits for the move to render (onDrop below); anything else flies home now.
    if (end.reason === 'cancel' || !end.target) land(end.id, null);
  };

  const dropped = (id: string, target: DropTarget) => {
    options.current.onDrop(id, target);
    // The optimistic move renders within a frame; then the ghost lands on the card's new slot.
    requestAnimationFrame(() => {
      if (!options.current.rootRef.current) return;
      if (prefersReducedMotion()) {
        const card = options.current.rootRef.current?.querySelector<HTMLElement>(cardSelector(id));
        if (card) flash(card);
      } else land(id, target);
    });
  };

  const controller = createDragController({
    hitTest: (x, y, id) => options.current.hitTest(x, y, id),
    onChange: (view) => {
      if (!view) { set.drag(null); return; }
      pointer.x = view.x; pointer.y = view.y;
      if (!active) { set.ghost(view.id); start(view.x, view.y); }
      set.drag((previous) => (previous && previous.id === view.id && sameTarget(previous.target, view.target) ? previous : { id: view.id, target: view.target }));
    },
    onEnd,
    onDrop: dropped,
  });

  return {
    controller,
    paint: () => { if (active) paint(); },
    pointerDown(id: string, event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      // A new drag while the last one is still settling: let that finish first.
      finishSettle?.();
      const rect = event.currentTarget.getBoundingClientRect();
      grab.dx = event.clientX - rect.left; grab.dy = event.clientY - rect.top; grab.width = rect.width; grab.height = rect.height;
      pointer.id = event.pointerId;
      controller.pointerDown({ id, pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY });
    },
    dispose() {
      controller.cancel();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

export function useBoardDrag(options: UseBoardDragOptions) {
  const [optionsRef] = useState(() => ({ current: options }));
  optionsRef.current = options;
  const [ghostRef] = useState<{ current: HTMLDivElement | null }>(() => ({ current: null }));
  const [drag, setDrag] = useState<BoardDragView | null>(null);
  const [ghost, setGhost] = useState<string | null>(null);
  const [landing, setLanding] = useState<string | null>(null);
  const [engine] = useState(() => createEngine(optionsRef, ghostRef, { drag: setDrag, ghost: setGhost, landing: setLanding }));

  // Place the ghost before first paint, so it never flashes at the corner.
  useLayoutEffect(() => { if (ghost) engine.paint(); }, [ghost, engine]);

  useEffect(() => {
    const { controller } = engine;
    const onMove = (event: PointerEvent) => controller.pointerMove(event.pointerId, event.clientX, event.clientY);
    const onUp = (event: PointerEvent) => controller.pointerUp(event.pointerId);
    const onCancel = () => controller.cancel();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && controller.dragging) { event.preventDefault(); controller.cancel(); }
    };
    // After a touch hold the page must not scroll under the card.
    const onTouchMove = (event: TouchEvent) => { if (controller.dragging) event.preventDefault(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      engine.dispose();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [engine]);

  return {
    /** The card being dragged and what it is over; null between drags. Updates when the target changes, not per move. */
    drag,
    /** Id of the card whose ghost is on screen (dragging or settling). */
    ghost,
    /** Id of the card a drop or Escape is settling onto; keep it invisible until the ghost lands. */
    landing,
    ghostRef: ghostRef as RefObject<HTMLDivElement | null>,
    pointerDown: engine.pointerDown,
    /** True once for the click that ends a drag, so releasing over the source card does not open it. */
    consumeClick: () => engine.controller.consumeClick(),
  };
}

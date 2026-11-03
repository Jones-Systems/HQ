import type { Status } from '../core';

// Pointer and touch drag for board cards, as the Planner does it: a mouse or pen
// starts after 5 px of travel; touch starts after a 320 ms hold, so a swipe
// still scrolls. A drop becomes a MoveIntent and goes through the same
// resolveMove path as the keyboard and the menu. Escape cancels.

export const MOUSE_THRESHOLD_PX = 5;
export const TOUCH_HOLD_MS = 320;
/** Touch travel before the hold completes means the user is scrolling. */
export const TOUCH_SLOP_PX = 8;

export interface DropTarget { status: Status; index: number }

export interface DragView {
  id: string;
  x: number;
  y: number;
  /** Null while the pointer is over no column. */
  target: DropTarget | null;
}

export interface DragControllerOptions {
  /** Maps a viewport point to a column and an insertion index among its visible cards, without the dragged one. */
  hitTest(x: number, y: number, id: string): DropTarget | null;
  onChange(view: DragView | null): void;
  onDrop(id: string, target: DropTarget): void;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface PointerStart { id: string; pointerId: number; pointerType: string; x: number; y: number }

type Phase =
  | { kind: 'idle' }
  | { kind: 'pressed'; start: PointerStart; timer: unknown }
  | { kind: 'dragging'; start: PointerStart; view: DragView };

export type DragController = ReturnType<typeof createDragController>;

export function createDragController(options: DragControllerOptions) {
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let phase: Phase = { kind: 'idle' };
  /**
   * Set by a completed or cancelled drag so the click the browser may fire right after it does not open the card.
   * It lasts one task: a drag ending off its card gets no click, and a later real click must still work.
   */
  let suppressClick = false;
  const suppressNextClick = () => {
    suppressClick = true;
    setTimer(() => { suppressClick = false; }, 0);
  };

  function begin(start: PointerStart, x: number, y: number) {
    const view: DragView = { id: start.id, x, y, target: options.hitTest(x, y, start.id) };
    phase = { kind: 'dragging', start, view };
    options.onChange(view);
  }

  function reset() {
    if (phase.kind === 'pressed') clearTimer(phase.timer);
    const wasDragging = phase.kind === 'dragging';
    phase = { kind: 'idle' };
    if (wasDragging) options.onChange(null);
  }

  return {
    get dragging(): boolean { return phase.kind === 'dragging'; },
    get pending(): boolean { return phase.kind !== 'idle'; },

    pointerDown(start: PointerStart): void {
      reset();
      suppressClick = false;
      const touch = start.pointerType === 'touch';
      const timer = touch ? setTimer(() => {
        if (phase.kind === 'pressed' && phase.start.pointerId === start.pointerId) begin(start, start.x, start.y);
      }, TOUCH_HOLD_MS) : null;
      phase = { kind: 'pressed', start, timer };
    },

    pointerMove(pointerId: number, x: number, y: number): void {
      if (phase.kind === 'idle' || phase.start.pointerId !== pointerId) return;
      if (phase.kind === 'pressed') {
        const travel = Math.hypot(x - phase.start.x, y - phase.start.y);
        if (phase.start.pointerType === 'touch') {
          if (travel > TOUCH_SLOP_PX) reset();
          return;
        }
        if (travel >= MOUSE_THRESHOLD_PX) begin(phase.start, x, y);
        return;
      }
      const view: DragView = { id: phase.start.id, x, y, target: options.hitTest(x, y, phase.start.id) };
      phase = { ...phase, view };
      options.onChange(view);
    },

    /** Ends the gesture. A drag over a column drops there; a press without a drag is an ordinary click. */
    pointerUp(pointerId: number): void {
      if (phase.kind === 'idle' || phase.start.pointerId !== pointerId) return;
      if (phase.kind === 'dragging') {
        const { id, target } = phase.view;
        suppressNextClick();
        reset();
        if (target) options.onDrop(id, target);
        return;
      }
      reset();
    },

    /** Escape, pointercancel or loss of capture: nothing moves. */
    cancel(): void {
      if (phase.kind === 'dragging') suppressNextClick();
      reset();
    },

    /** Returns true once for the click event that ends a drag. */
    consumeClick(): boolean {
      const value = suppressClick;
      suppressClick = false;
      return value;
    },
  };
}

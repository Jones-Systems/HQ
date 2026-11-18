/** DOM-free input normalization for wheel, trackpad and keyboard. */

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export type WheelIntent =
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'zoom'; readonly factor: number };

export const LINE_HEIGHT_PX = 16;
/** Per-event zoom delta clamp, so one mouse notch with Ctrl is a modest step. */
const ZOOM_DELTA_LIMIT = 50;
const ZOOM_SENSITIVITY = 0.01;

/**
 * Two-finger trackpad scroll and the plain mouse wheel pan. Ctrl/Cmd + wheel
 * zooms; trackpad pinch arrives as a wheel event with `ctrlKey` set in Chromium
 * and Electron, so it zooms too. Shift + vertical wheel pans horizontally.
 */
export function normalizeWheel(input: WheelInput, pageHeight: number): WheelIntent {
  const unit = input.deltaMode === 1 ? LINE_HEIGHT_PX : input.deltaMode === 2 ? Math.max(1, pageHeight) : 1;
  let dx = (Number.isFinite(input.deltaX) ? input.deltaX : 0) * unit;
  let dy = (Number.isFinite(input.deltaY) ? input.deltaY : 0) * unit;
  if (input.ctrlKey || input.metaKey) {
    const clamped = Math.max(-ZOOM_DELTA_LIMIT, Math.min(ZOOM_DELTA_LIMIT, dy));
    return { kind: 'zoom', factor: Math.exp(-clamped * ZOOM_SENSITIVITY) };
  }
  if (input.shiftKey && dx === 0) [dx, dy] = [dy, 0];
  return { kind: 'pan', dx, dy };
}

export interface KeyInput {
  readonly key: string;
  /** KeyboardEvent.code, used where Shift changes `key` (digits). */
  readonly code: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export type Platform = 'mac' | 'other';

export type KeyCommand =
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'nudge'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'zoom-step'; readonly direction: 1 | -1 }
  | { readonly kind: 'zoom-reset' }
  | { readonly kind: 'fit'; readonly target: 'all' | 'selection' }
  | { readonly kind: 'focus-step'; readonly direction: 1 | -1 }
  | { readonly kind: 'activate'; readonly toggle: boolean }
  | { readonly kind: 'escape' }
  | { readonly kind: 'select-all' }
  | { readonly kind: 'remove' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'reorder'; readonly order: 'front' | 'back' | 'forward' | 'backward' };

export const KEY_PAN_PX = 48;
export const KEY_PAN_LARGE_PX = 240;
export const NUDGE = 1;
export const NUDGE_LARGE = 10;

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

/**
 * Map a key to a canvas command. Arrows nudge the selection, or pan when
 * nothing is selected; Alt/Option + arrows always pan. Tab moves keyboard focus
 * between canvas nodes. Returns `null` for keys the canvas does not own, so
 * the browser default (including Tab leaving the canvas) still applies.
 */
export function keyCommand(input: KeyInput, platform: Platform, hasSelection: boolean): KeyCommand | null {
  const mod = platform === 'mac' ? input.metaKey : input.ctrlKey;
  const arrow = ARROWS[input.key];
  if (arrow && !mod) {
    if (input.altKey || !hasSelection) {
      const step = input.shiftKey ? KEY_PAN_LARGE_PX : KEY_PAN_PX;
      return { kind: 'pan', dx: arrow[0] * step, dy: arrow[1] * step };
    }
    const step = input.shiftKey ? NUDGE_LARGE : NUDGE;
    return { kind: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
  }
  if (mod) {
    const key = input.key.toLowerCase();
    if (key === 'z') return input.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (key === 'y' && platform === 'other') return { kind: 'redo' };
    if (key === 'a') return { kind: 'select-all' };
    if (input.key === '=' || input.key === '+') return { kind: 'zoom-step', direction: 1 };
    if (input.key === '-' || input.key === '_') return { kind: 'zoom-step', direction: -1 };
    if (input.code === 'BracketRight') return { kind: 'reorder', order: input.shiftKey ? 'front' : 'forward' };
    if (input.code === 'BracketLeft') return { kind: 'reorder', order: input.shiftKey ? 'back' : 'backward' };
    return null;
  }
  if (input.altKey) return null;
  if (input.shiftKey && input.code === 'Digit0') return { kind: 'zoom-reset' };
  if (input.shiftKey && input.code === 'Digit1') return { kind: 'fit', target: 'all' };
  if (input.shiftKey && input.code === 'Digit2') return { kind: 'fit', target: 'selection' };
  switch (input.key) {
    case '=': case '+': return { kind: 'zoom-step', direction: 1 };
    case '-': case '_': return { kind: 'zoom-step', direction: -1 };
    case 'Tab': return { kind: 'focus-step', direction: input.shiftKey ? -1 : 1 };
    case 'Enter': case ' ': return { kind: 'activate', toggle: input.shiftKey };
    case 'Escape': return { kind: 'escape' };
    case 'Delete': case 'Backspace': return { kind: 'remove' };
    default: return null;
  }
}

export const ZOOM_STEP = 1.25;

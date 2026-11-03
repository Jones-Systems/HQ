import { useCallback, useLayoutEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import { animateElement } from '@hq/ui';
import type { Camera, Size } from '../contract.ts';

/**
 * The camera lives on the canvas root as three registered custom properties (see `canvas.css`). The world layer,
 * grid, selection frames and artboard names all derive their position from them with `calc()`, so one animation of
 * these properties moves every layer together. Wheel, pinch, pan and drag only change the inline values, so they
 * stay direct; button, preset, fit and keyboard-zoom moves run a token-timed Web Animations API animation instead.
 */
export const CAMERA_X = '--hq-canvas-x';
export const CAMERA_Y = '--hq-canvas-y';
export const CAMERA_ZOOM = '--hq-canvas-zoom';

/** Samples along the move. The browser interpolates linearly between them, so more samples follow the path closer. */
export const CAMERA_PATH_SAMPLES = 12;

export function cameraVars(camera: Camera): Record<string, string> {
  return { [CAMERA_X]: String(camera.x), [CAMERA_Y]: String(camera.y), [CAMERA_ZOOM]: String(camera.zoom) };
}

/** React style for the canvas root. Custom properties go through CSSOM, which the app CSP allows. */
export const cameraStyle = (camera: Camera, extra: Record<string, string> = {}): CSSProperties =>
  ({ ...cameraVars(camera), ...extra }) as CSSProperties;

/**
 * The camera at progress `t` (0 to 1) of a move. The point at the centre of the view travels in a straight line and
 * the zoom changes by a constant factor, so a zoom about the centre stays centred and zooming out and in feel alike.
 * The easing curve is applied by the animation, not here.
 */
export function cameraAt(from: Camera, to: Camera, viewport: Size, t: number): Camera {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const zoom = from.zoom * (to.zoom / from.zoom) ** t;
  const fromCentre = { x: from.x + viewport.width / 2 / from.zoom, y: from.y + viewport.height / 2 / from.zoom };
  const toCentre = { x: to.x + viewport.width / 2 / to.zoom, y: to.y + viewport.height / 2 / to.zoom };
  const centre = { x: fromCentre.x + (toCentre.x - fromCentre.x) * t, y: fromCentre.y + (toCentre.y - fromCentre.y) * t };
  return { x: centre.x - viewport.width / 2 / zoom, y: centre.y - viewport.height / 2 / zoom, zoom };
}

/** Keyframes for a move. The first and last frames are exactly `from` and `to`, so the animation ends where state is. */
export function cameraKeyframes(from: Camera, to: Camera, viewport: Size, samples = CAMERA_PATH_SAMPLES): Keyframe[] {
  return Array.from({ length: samples + 1 }, (_, index) => cameraVars(cameraAt(from, to, viewport, index / samples)));
}

export const sameCamera = (a: Camera, b: Camera): boolean => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/** The camera as the page currently shows it, including a move in flight, or `null` when it cannot be read. */
export function readCamera(element: Element): Camera | null {
  const style = getComputedStyle(element);
  const x = Number.parseFloat(style.getPropertyValue(CAMERA_X));
  const y = Number.parseFloat(style.getPropertyValue(CAMERA_Y));
  const zoom = Number.parseFloat(style.getPropertyValue(CAMERA_ZOOM));
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(zoom) && zoom > 0 ? { x, y, zoom } : null;
}

export interface CameraMotion {
  /**
   * Stops a move in flight and returns the camera the page shows right now, or `null` when nothing is moving.
   * Call it before handling direct input so the input starts from what the user sees, then give the result to the
   * reducer as a `camera` action.
   */
  readonly settle: () => Camera | null;
}

/**
 * Eases the camera when the reducer says the last move was an eased one (`cameraEase` rose); every other change is
 * applied at once. Under reduced motion `animateElement` returns null, so every move is instant.
 */
export function useCameraMotion(root: RefObject<HTMLElement | null>, camera: Camera, ease: number, viewport: Size): CameraMotion {
  const shown = useRef(camera);
  const seen = useRef(ease);
  const running = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const element = root.current;
    const eased = ease > seen.current;
    seen.current = ease;
    const live = running.current && element ? readCamera(element) : null;
    const from = live ?? shown.current;
    running.current?.cancel();
    running.current = null;
    shown.current = camera;
    if (!eased || !element || sameCamera(from, camera)) return;
    const animation = animateElement(element, cameraKeyframes(from, camera, viewport), { duration: 'slow', easing: 'standard' });
    if (!animation) return;
    running.current = animation;
    const done = () => { if (running.current === animation) running.current = null; };
    animation.addEventListener('finish', done);
    animation.addEventListener('cancel', done);
  }, [camera, ease]); // The viewport only shapes the path; a resize in the middle of a move must not restart it.

  useLayoutEffect(() => () => { running.current?.cancel(); }, []);

  const settle = useCallback((): Camera | null => {
    const animation = running.current;
    const element = root.current;
    if (!animation || !element) return null;
    const live = readCamera(element);
    animation.cancel();
    running.current = null;
    return live;
  }, [root]);

  return useMemo(() => ({ settle }), [settle]);
}

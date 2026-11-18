// @vitest-environment happy-dom
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MOTION_DURATIONS, MOTION_EASINGS } from '@hq/ui';
import type { Camera, Size } from '../../src/contract.ts';
import { fitRect, screenToWorld, zoomTo } from '../../src/geometry.ts';
import {
  CAMERA_PATH_SAMPLES, CAMERA_X, CAMERA_Y, CAMERA_ZOOM, cameraAt, cameraKeyframes, cameraStyle, cameraVars, readCamera, sameCamera, useCameraMotion,
  type CameraMotion,
} from '../../src/view/camera-motion.ts';

const viewport: Size = { width: 1000, height: 700 };
const home: Camera = { x: 0, y: 0, zoom: 1 };
const closeTo = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 9);

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-hq-motion');
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

describe('camera path maths', () => {
  it('starts exactly at the old camera and ends exactly at the target', () => {
    const target = fitRect({ x: 40, y: 40, width: 1400, height: 760 }, viewport);
    expect(cameraAt(home, target, viewport, 0)).toEqual(home);
    expect(cameraAt(home, target, viewport, 1)).toEqual(target);
    const frames = cameraKeyframes(home, target, viewport);
    expect(frames).toHaveLength(CAMERA_PATH_SAMPLES + 1);
    expect(frames[0]).toEqual(cameraVars(home));
    expect(frames.at(-1)).toEqual(cameraVars(target));
  });

  it('keeps the centre of the view still while zooming about it, and zooms by a constant factor', () => {
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    const out = zoomTo(home, centre, 0.25);
    const pinned = screenToWorld(home, centre);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const at = cameraAt(home, out, viewport, t);
      const where = screenToWorld(at, centre);
      closeTo(where.x, pinned.x);
      closeTo(where.y, pinned.y);
      closeTo(at.zoom, 0.25 ** t);
    }
  });

  it('moves the centre in a straight line when fitting somewhere else', () => {
    const target = fitRect({ x: 2000, y: 1000, width: 400, height: 300 }, viewport);
    const centreOf = (camera: Camera) => screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
    const from = centreOf(home);
    const to = centreOf(target);
    const middle = centreOf(cameraAt(home, target, viewport, 0.5));
    closeTo(middle.x, (from.x + to.x) / 2);
    closeTo(middle.y, (from.y + to.y) / 2);
  });

  it('writes the camera as three numbers, and reads back what the page shows', () => {
    expect(cameraVars({ x: -12.5, y: 8, zoom: 0.5 })).toEqual({ [CAMERA_X]: '-12.5', [CAMERA_Y]: '8', [CAMERA_ZOOM]: '0.5' });
    expect(cameraStyle(home, { '--hq-canvas-grid': '8' })).toMatchObject({ [CAMERA_ZOOM]: '1', '--hq-canvas-grid': '8' });
    const element = document.createElement('div');
    const values: Record<string, string> = { [CAMERA_X]: ' 3.25', [CAMERA_Y]: '-4', [CAMERA_ZOOM]: '1.5' };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: (name: string) => values[name] ?? '' } as CSSStyleDeclaration);
    expect(readCamera(element)).toEqual({ x: 3.25, y: -4, zoom: 1.5 });
    values[CAMERA_ZOOM] = '';
    expect(readCamera(element)).toBeNull();
    expect(sameCamera(home, { ...home })).toBe(true);
  });
});

/** A canvas root whose camera follows `props`, reporting the motion handle through `out`. */
function Harness({ camera, ease, out }: { camera: Camera; ease: number; out: { motion?: CameraMotion } }) {
  const root = useRef<HTMLDivElement>(null);
  out.motion = useCameraMotion(root, camera, ease, viewport);
  return <div ref={root} data-testid="root" style={cameraStyle(camera)} />;
}

function stubAnimate() {
  const animation = { cancel: vi.fn(), addEventListener: vi.fn() };
  const animate = vi.fn(() => animation);
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  return { animate, animation };
}

describe('easing the camera', () => {
  const target: Camera = { x: -100, y: -50, zoom: 0.5 };

  it('animates an eased move with the slow duration and standard easing from the tokens', () => {
    const { animate } = stubAnimate();
    const out: { motion?: CameraMotion } = {};
    const view = render(<Harness camera={home} ease={0} out={out} />);
    view.rerender(<Harness camera={target} ease={1} out={out} />);
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0] as unknown as [Record<string, string>[], KeyframeAnimationOptions];
    expect(keyframes[0]).toEqual(cameraVars(home));
    expect(keyframes.at(-1)).toEqual(cameraVars(target));
    expect(options).toMatchObject({ duration: MOTION_DURATIONS.slow, easing: MOTION_EASINGS.standard });
  });

  it('applies wheel, pinch, pan and drag at once, with no animation', () => {
    const { animate } = stubAnimate();
    const out: { motion?: CameraMotion } = {};
    const view = render(<Harness camera={home} ease={0} out={out} />);
    view.rerender(<Harness camera={target} ease={0} out={out} />);
    expect(animate).not.toHaveBeenCalled();
    expect(view.getByTestId('root').style.getPropertyValue(CAMERA_ZOOM)).toBe('0.5');
  });

  it('is instant under reduced motion: nothing animates and the camera is already at the target', () => {
    document.documentElement.setAttribute('data-hq-motion', 'reduce');
    const { animate } = stubAnimate();
    const out: { motion?: CameraMotion } = {};
    const view = render(<Harness camera={home} ease={0} out={out} />);
    view.rerender(<Harness camera={target} ease={1} out={out} />);
    expect(animate).not.toHaveBeenCalled();
    expect(view.getByTestId('root').style.getPropertyValue(CAMERA_X)).toBe('-100');
  });

  it('does nothing for an eased move that lands where it started', () => {
    const { animate } = stubAnimate();
    const out: { motion?: CameraMotion } = {};
    const view = render(<Harness camera={home} ease={0} out={out} />);
    view.rerender(<Harness camera={{ ...home }} ease={1} out={out} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('settles a move in flight: stops it and reports the camera on screen, so input starts from what the user sees', () => {
    const { animation } = stubAnimate();
    const out: { motion?: CameraMotion } = {};
    const view = render(<Harness camera={home} ease={0} out={out} />);
    expect(out.motion!.settle()).toBeNull();
    view.rerender(<Harness camera={target} ease={1} out={out} />);
    const values: Record<string, string> = { [CAMERA_X]: '-40', [CAMERA_Y]: '-20', [CAMERA_ZOOM]: '0.8' };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: (name: string) => values[name] ?? '' } as CSSStyleDeclaration);
    expect(out.motion!.settle()).toEqual({ x: -40, y: -20, zoom: 0.8 });
    expect(animation.cancel).toHaveBeenCalled();
    expect(out.motion!.settle()).toBeNull();
  });

  it('retargets from the camera on screen when a second eased move starts mid-flight', () => {
    const { animate, animation } = stubAnimate();
    const out: { motion?: CameraMotion } = {};
    const view = render(<Harness camera={home} ease={0} out={out} />);
    view.rerender(<Harness camera={target} ease={1} out={out} />);
    const values: Record<string, string> = { [CAMERA_X]: '-60', [CAMERA_Y]: '-30', [CAMERA_ZOOM]: '0.7' };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: (name: string) => values[name] ?? '' } as CSSStyleDeclaration);
    view.rerender(<Harness camera={home} ease={2} out={out} />);
    expect(animation.cancel).toHaveBeenCalled();
    const second = animate.mock.calls[1] as unknown as [Record<string, string>[]];
    expect(second[0][0]).toEqual({ [CAMERA_X]: '-60', [CAMERA_Y]: '-30', [CAMERA_ZOOM]: '0.7' });
  });
});

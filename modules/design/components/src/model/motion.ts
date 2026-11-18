import type {
  Easing, Keyframe, MotionFrame, MotionProperty, MotionStudy, MotionTrack,
} from '../contract.ts';
import { brandId } from './ids.ts';
import { deepFreeze } from './jcs.ts';

/**
 * Motion maths. Every function here is pure: a frame depends only on the study
 * and the requested time `t`, never on a clock, frame rate or playback history.
 */

export const EASING_PRESETS: Readonly<Record<'ease' | 'ease-in' | 'ease-out' | 'ease-in-out', Easing>> = {
  ease: { kind: 'cubic-bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  'ease-in': { kind: 'cubic-bezier', x1: 0.42, y1: 0, x2: 1, y2: 1 },
  'ease-out': { kind: 'cubic-bezier', x1: 0, y1: 0, x2: 0.58, y2: 1 },
  'ease-in-out': { kind: 'cubic-bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
};

const LINEAR: Easing = { kind: 'linear' };
const PROPERTIES: readonly MotionProperty[] = ['opacity', 'translateX', 'translateY', 'scale', 'rotate'];
const MAX_DURATION = 10 * 60 * 1000;

function bezierAxis(a: number, b: number, s: number): number {
  // Control points 0, a, b, 1 in Bernstein form.
  const inv = 1 - s;
  return 3 * inv * inv * s * a + 3 * inv * s * s * b + s * s * s;
}

function bezierAxisSlope(a: number, b: number, s: number): number {
  const inv = 1 - s;
  return 3 * inv * inv * a + 6 * inv * s * (b - a) + 3 * s * s * (1 - b);
}

/** Solves x(s) = p with bounded Newton steps, then a fixed bisection fallback. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number, p: number): number {
  let s = p;
  for (let i = 0; i < 8; i += 1) {
    const error = bezierAxis(x1, x2, s) - p;
    if (Math.abs(error) < 1e-7) return bezierAxis(y1, y2, s);
    const slope = bezierAxisSlope(x1, x2, s);
    if (Math.abs(slope) < 1e-6) break;
    s -= error / slope;
  }
  let low = 0;
  let high = 1;
  s = p;
  for (let i = 0; i < 40; i += 1) {
    const x = bezierAxis(x1, x2, s);
    if (Math.abs(x - p) < 1e-7) break;
    if (x < p) low = s;
    else high = s;
    s = (low + high) / 2;
  }
  return bezierAxis(y1, y2, s);
}

/** CSS Easing Level 2 step function, ignoring the before flag. */
function steps(count: number, position: Extract<Easing, { kind: 'steps' }>['position'], p: number): number {
  let current = Math.floor(p * count);
  if (position === 'jump-start' || position === 'jump-both') current += 1;
  const jumps = position === 'jump-none' ? count - 1 : position === 'jump-both' ? count + 1 : count;
  if (p >= 0 && current < 0) current = 0;
  if (p <= 1 && current > jumps) current = jumps;
  return current / jumps;
}

/** Closed-form damped spring from rest; segment time maps to physical seconds. */
function spring(stiffness: number, damping: number, mass: number, seconds: number): number {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let displacement: number;
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    displacement = Math.exp(-zeta * omega * seconds) * (Math.cos(damped * seconds) + (zeta * omega / damped) * Math.sin(damped * seconds));
  } else if (zeta === 1) {
    displacement = Math.exp(-omega * seconds) * (1 + omega * seconds);
  } else {
    const root = Math.sqrt(zeta * zeta - 1);
    const r1 = -omega * (zeta - root);
    const r2 = -omega * (zeta + root);
    displacement = (r2 * Math.exp(r1 * seconds) - r1 * Math.exp(r2 * seconds)) / (r2 - r1);
  }
  return 1 - displacement;
}

/**
 * Eases progress `p` in [0, 1]. `segmentMs` is only used by springs, whose
 * curve depends on physical time; a spring lands exactly on 1 at p = 1.
 */
export function ease(easing: Easing, p: number, segmentMs = 1000): number {
  if (p <= 0) return easing.kind === 'steps' ? steps(easing.count, easing.position, 0) : 0;
  if (p >= 1) return 1;
  switch (easing.kind) {
    case 'linear':
      return p;
    case 'cubic-bezier':
      return cubicBezier(easing.x1, easing.y1, easing.x2, easing.y2, p);
    case 'steps':
      return steps(easing.count, easing.position, p);
    case 'spring':
      return spring(easing.stiffness, easing.damping, easing.mass, (p * segmentMs) / 1000);
  }
}

/** Points for a curve preview, including both ends. */
export function easingCurve(easing: Easing, samples = 48, segmentMs = 1000): readonly { x: number; y: number }[] {
  return Array.from({ length: samples + 1 }, (_, i) => ({ x: i / samples, y: ease(easing, i / samples, segmentMs) }));
}

export function easingToCss(easing: Easing, segmentMs = 1000): string {
  switch (easing.kind) {
    case 'linear':
      return 'linear';
    case 'cubic-bezier':
      return `cubic-bezier(${easing.x1}, ${easing.y1}, ${easing.x2}, ${easing.y2})`;
    case 'steps':
      return `steps(${easing.count}, ${easing.position})`;
    case 'spring':
      return `linear(${easingCurve(easing, 32, segmentMs).map((point) => Number(point.y.toFixed(4))).join(', ')})`;
  }
}

export function totalDuration(study: MotionStudy): number {
  return study.duration * study.iterations;
}

/** Iteration-local progress at time `t` with fill-both semantics. */
export function progressAt(study: MotionStudy, t: number): { readonly iteration: number; readonly progress: number } {
  const total = totalDuration(study);
  const clamped = Number.isFinite(t) ? Math.min(Math.max(t, 0), total) : 0;
  let iteration = Math.floor(clamped / study.duration);
  let local = (clamped - iteration * study.duration) / study.duration;
  if (iteration >= study.iterations) {
    iteration = study.iterations - 1;
    local = 1;
  }
  const reversed = study.direction === 'reverse' || (study.direction === 'alternate' && iteration % 2 === 1);
  return { iteration, progress: reversed ? 1 - local : local };
}

export function trackValueAt(track: MotionTrack, progress: number, duration: number): number {
  const frames = track.keyframes;
  const first = frames[0] as Keyframe;
  const last = frames[frames.length - 1] as Keyframe;
  if (progress <= first.offset) return first.value;
  if (progress >= last.offset) return last.value;
  for (let i = 0; i < frames.length - 1; i += 1) {
    const from = frames[i] as Keyframe;
    const to = frames[i + 1] as Keyframe;
    if (progress >= from.offset && progress < to.offset) {
      const span = to.offset - from.offset;
      const eased = ease(from.easing, (progress - from.offset) / span, span * duration);
      return from.value + (to.value - from.value) * eased;
    }
  }
  return last.value;
}

/** The deterministic scrub primitive: same study and `t` always give the same frame. */
export function sampleStudy(study: MotionStudy, t: number): MotionFrame {
  const { progress } = progressAt(study, t);
  return Object.fromEntries(study.tracks.map((track) => [track.id, trackValueAt(track, progress, study.duration)]));
}

/** Frame as per-target CSS declarations, for the sandbox bridge and static exports. */
export function frameToStyles(study: MotionStudy, frame: MotionFrame): Readonly<Record<string, { opacity?: string; transform?: string }>> {
  const byTarget: Record<string, { opacity?: number; transforms: string[] }> = {};
  for (const track of study.tracks) {
    const value = frame[track.id];
    if (value === undefined) continue;
    const entry = byTarget[track.target] ?? (byTarget[track.target] = { transforms: [] });
    if (track.property === 'opacity') entry.opacity = Math.min(1, Math.max(0, value));
    if (track.property === 'translateX') entry.transforms.push(`translateX(${value}px)`);
    if (track.property === 'translateY') entry.transforms.push(`translateY(${value}px)`);
    if (track.property === 'scale') entry.transforms.push(`scale(${value})`);
    if (track.property === 'rotate') entry.transforms.push(`rotate(${value}deg)`);
  }
  return Object.fromEntries(Object.entries(byTarget).map(([target, entry]) => [target, {
    ...(entry.opacity === undefined ? {} : { opacity: String(entry.opacity) }),
    ...(entry.transforms.length === 0 ? {} : { transform: entry.transforms.join(' ') }),
  }]));
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function parseEasing(value: unknown): Easing {
  if (value === null || typeof value !== 'object') throw new TypeError('Easing must be an object.');
  const easing = value as Record<string, unknown>;
  switch (easing.kind) {
    case 'linear':
      return LINEAR;
    case 'cubic-bezier':
      if (!finiteIn(easing.x1, 0, 1) || !finiteIn(easing.x2, 0, 1) || !finiteIn(easing.y1, -5, 5) || !finiteIn(easing.y2, -5, 5)) {
        throw new TypeError('cubic-bezier needs x1, x2 in [0, 1] and y1, y2 in [-5, 5].');
      }
      return { kind: 'cubic-bezier', x1: easing.x1, y1: easing.y1, x2: easing.x2, y2: easing.y2 };
    case 'steps': {
      const position = easing.position;
      if (position !== 'jump-start' && position !== 'jump-end' && position !== 'jump-none' && position !== 'jump-both') {
        throw new TypeError('steps position is invalid.');
      }
      const min = position === 'jump-none' ? 2 : 1;
      if (!Number.isInteger(easing.count) || !finiteIn(easing.count, min, 1000)) throw new TypeError(`steps count must be an integer from ${min} to 1000.`);
      return { kind: 'steps', count: easing.count as number, position };
    }
    case 'spring':
      if (!finiteIn(easing.stiffness, 1, 5000) || !finiteIn(easing.damping, 0.1, 500) || !finiteIn(easing.mass, 0.1, 100)) {
        throw new TypeError('spring needs stiffness 1-5000, damping 0.1-500 and mass 0.1-100.');
      }
      return { kind: 'spring', stiffness: easing.stiffness, damping: easing.damping, mass: easing.mass };
    default:
      throw new TypeError('Unknown easing kind.');
  }
}

function parseTrack(value: unknown): MotionTrack {
  if (value === null || typeof value !== 'object') throw new TypeError('Track must be an object.');
  const track = value as Record<string, unknown>;
  if (typeof track.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(track.id)) throw new TypeError('Track id is invalid.');
  if (typeof track.target !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(track.target)) throw new TypeError(`Track "${track.id}" target is invalid.`);
  if (!PROPERTIES.includes(track.property as MotionProperty)) throw new TypeError(`Track "${track.id}" property is invalid.`);
  if (!Array.isArray(track.keyframes) || track.keyframes.length < 1 || track.keyframes.length > 64) throw new TypeError(`Track "${track.id}" needs 1-64 keyframes.`);
  let previous = -1;
  const keyframes = track.keyframes.map((item: unknown) => {
    if (item === null || typeof item !== 'object') throw new TypeError('Keyframe must be an object.');
    const frame = item as Record<string, unknown>;
    if (!finiteIn(frame.offset, 0, 1) || frame.offset <= previous) throw new TypeError(`Track "${track.id}" offsets must increase within [0, 1].`);
    if (!finiteIn(frame.value, -1e6, 1e6)) throw new TypeError(`Track "${track.id}" value must be finite.`);
    previous = frame.offset;
    return { offset: frame.offset, value: frame.value, easing: parseEasing(frame.easing) };
  });
  return { id: track.id, target: track.target, property: track.property as MotionProperty, keyframes };
}

export function parseMotionStudy(value: unknown): MotionStudy {
  if (value === null || typeof value !== 'object') throw new TypeError('Motion study must be an object.');
  const study = value as Record<string, unknown>;
  if (!Number.isInteger(study.revision) || (study.revision as number) < 1) throw new TypeError('Motion study revision must be a positive integer.');
  if (typeof study.title !== 'string' || study.title.trim().length === 0 || study.title.length > 200) throw new TypeError('Motion study title is invalid.');
  if (!finiteIn(study.duration, 1, MAX_DURATION)) throw new TypeError('Motion duration must be 1 ms to 10 minutes.');
  if (!Number.isInteger(study.iterations) || !finiteIn(study.iterations, 1, 100)) throw new TypeError('Iterations must be an integer from 1 to 100.');
  if (study.direction !== 'normal' && study.direction !== 'reverse' && study.direction !== 'alternate') throw new TypeError('Direction is invalid.');
  if (!Array.isArray(study.tracks) || study.tracks.length > 32) throw new TypeError('A study has at most 32 tracks.');
  const tracks = study.tracks.map(parseTrack);
  if (new Set(tracks.map((track) => track.id)).size !== tracks.length) throw new TypeError('Track ids must be unique.');
  let component: MotionStudy['component'];
  if (study.component !== undefined) {
    const ref = study.component as Record<string, unknown>;
    if (!Number.isInteger(ref.revision) || (ref.revision as number) < 1) throw new TypeError('Component reference needs an exact revision.');
    component = { componentId: brandId('ComponentId', ref.componentId), revision: ref.revision as number };
  }
  return deepFreeze({
    id: brandId('MotionStudyId', study.id),
    revision: study.revision as number,
    title: study.title,
    duration: study.duration,
    iterations: study.iterations as number,
    direction: study.direction,
    tracks,
    ...(component === undefined ? {} : { component }),
  });
}

/** Returns a new draft with one segment's easing replaced; the input is untouched. */
export function withSegmentEasing(study: MotionStudy, trackId: string, keyframeIndex: number, easing: Easing): MotionStudy {
  const parsed = parseEasing(easing);
  let found = false;
  const tracks = study.tracks.map((track) => {
    if (track.id !== trackId) return track;
    if (keyframeIndex < 0 || keyframeIndex >= track.keyframes.length - 1) throw new RangeError('Only a segment start keyframe has an easing.');
    found = true;
    return { ...track, keyframes: track.keyframes.map((frame, index) => (index === keyframeIndex ? { ...frame, easing: parsed } : frame)) };
  });
  if (!found) throw new RangeError(`Unknown track "${trackId}".`);
  return parseMotionStudy({ ...study, tracks });
}

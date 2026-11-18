/**
 * Swipe mode logic that needs no DOM: the divider's value, its keys, which panels can be swiped and how to bring two
 * mismatched viewports together. The mode and the divider value live in component state; nothing here is persisted.
 */
import type { CompareController, PanelRuntime } from '../controller.ts';
import type { VersionSummary } from '../contract.ts';
import type { PanelId } from '../ids.ts';
import type { Panel } from '../model.ts';
import { describeViewport, presetFor, sameViewport } from '../presets.ts';

export type CompareMode = 'side-by-side' | 'swipe';

/** The divider's value is the share of the width, from the left, that still shows the baseline. */
export const SWIPE_MIN = 0;
export const SWIPE_MAX = 100;
export const SWIPE_DEFAULT = 50;
export const SWIPE_STEP = 1;
export const SWIPE_STEP_LARGE = 10;

export function clampSwipe(value: number): number {
  if (!Number.isFinite(value)) return SWIPE_DEFAULT;
  return Math.min(SWIPE_MAX, Math.max(SWIPE_MIN, Math.round(value * 100) / 100));
}

/** The divider value after a key, or null when the key is not one the slider handles. Arrow keys move 1%, Shift 10%. */
export function swipeKeyValue(value: number, key: string, shiftKey = false): number | null {
  const step = shiftKey ? SWIPE_STEP_LARGE : SWIPE_STEP;
  const current = Math.round(clampSwipe(value));
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': return clampSwipe(current - step);
    case 'ArrowRight': case 'ArrowUp': return clampSwipe(current + step);
    case 'PageDown': return clampSwipe(current - SWIPE_STEP_LARGE);
    case 'PageUp': return clampSwipe(current + SWIPE_STEP_LARGE);
    case 'Home': return SWIPE_MIN;
    case 'End': return SWIPE_MAX;
    default: return null;
  }
}

export function swipeValueText(value: number): string {
  const left = Math.round(clampSwipe(value));
  return `${left}% baseline, ${100 - left}% candidate`;
}

/** The candidate is revealed to the right of the divider by clipping its layer; nothing is blended or faded. */
export function swipeClip(value: number): string {
  return `inset(0 0 0 ${clampSwipe(value)}%)`;
}

/** Pointer position as a divider value, relative to the box the divider travels across. */
export function swipeValueAt(clientX: number, box: { readonly left: number; readonly width: number }): number {
  return box.width > 0 ? clampSwipe(((clientX - box.left) / box.width) * 100) : SWIPE_DEFAULT;
}

export interface SwipePair {
  readonly baseline: Panel;
  readonly candidate: Panel;
  /** Panels that are neither, which Swipe leaves out of view. */
  readonly others: number;
}

export type SwipeAvailability =
  | { readonly ok: true; readonly pair: SwipePair }
  | { readonly ok: false; readonly reason: string };

const isHosted = (panel: Panel, runtime: ReadonlyMap<PanelId, PanelRuntime>) =>
  panel.source.kind === 'live-preview' && runtime.get(panel.id)?.session?.surface.kind === 'host-surface';

/** Swipe needs one baseline and one candidate. Anything else leaves the control in place but disabled, with the reason. */
export function swipeAvailability(panels: readonly Panel[], runtime: ReadonlyMap<PanelId, PanelRuntime>): SwipeAvailability {
  const baselines = panels.filter((panel) => panel.role === 'baseline');
  const candidates = panels.filter((panel) => panel.role === 'candidate');
  if (baselines.length !== 1) return { ok: false, reason: 'Swipe needs a baseline panel. Set one panel’s role to Baseline in its details.' };
  if (candidates.length === 0) return { ok: false, reason: 'Swipe needs a candidate panel. Set one panel’s role to Candidate in its details.' };
  if (candidates.length > 1) {
    return { ok: false, reason: `Swipe compares one baseline with one candidate, and ${candidates.length} panels are candidates. Set the others to Reference.` };
  }
  const [baseline] = baselines;
  const [candidate] = candidates;
  if (isHosted(baseline, runtime) || isHosted(candidate, runtime)) {
    return { ok: false, reason: 'A hosted live preview can’t be layered. Switch that panel to a static capture to swipe.' };
  }
  return { ok: true, pair: { baseline, candidate, others: panels.length - 2 } };
}

export function viewportsDiffer(pair: SwipePair): boolean {
  return !sameViewport(pair.baseline.viewport, pair.candidate.viewport);
}

export function describeMismatch(pair: SwipePair): string {
  return `The baseline is ${describeViewport(pair.baseline.viewport)} and the candidate is ${describeViewport(pair.candidate.viewport)}. A swipe only lines up when both use the same viewport.`;
}

export interface ViewportMatchPlan {
  readonly leader: Panel;
  readonly follower: Panel;
  /** `live` re-opens a live preview at the leader's viewport; `capture` switches a static panel to its capture at that size. */
  readonly via: 'live' | 'capture';
}

function canFollow(follower: Panel, leader: Panel, version: VersionSummary | null): ViewportMatchPlan['via'] | null {
  if (follower.source.kind === 'live-preview') return 'live';
  const wanted = leader.viewport;
  const hasCapture = version?.captures.some((item) => sameViewport(item.viewport, wanted)) ?? false;
  return hasCapture && presetFor(wanted) !== null ? 'capture' : null;
}

/**
 * How to bring the pair to one viewport: the candidate follows the baseline, else the baseline follows the candidate.
 * A static capture keeps the size it was captured at, so it can only follow when its version has a capture at that size.
 */
export function planViewportMatch(pair: SwipePair, versionOf: (panel: Panel) => VersionSummary | null): ViewportMatchPlan | null {
  const toBaseline = canFollow(pair.candidate, pair.baseline, versionOf(pair.candidate));
  if (toBaseline !== null) return { leader: pair.baseline, follower: pair.candidate, via: toBaseline };
  const toCandidate = canFollow(pair.baseline, pair.candidate, versionOf(pair.baseline));
  return toCandidate === null ? null : { leader: pair.candidate, follower: pair.baseline, via: toCandidate };
}

export const NO_MATCH_REASON = 'Neither panel can take the other’s viewport: a static capture keeps the size it was captured at. Choose a capture at the same size, or switch one panel to a live preview in its details.';

export function applyViewportMatch(controller: CompareController, plan: ViewportMatchPlan): void {
  if (plan.via === 'live') controller.matchViewports(plan.leader.id);
  else {
    const preset = presetFor(plan.leader.viewport);
    if (preset !== null) controller.applyPreset(plan.follower.id, preset.id);
  }
}

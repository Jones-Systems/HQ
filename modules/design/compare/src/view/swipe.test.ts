import { describe, expect, it } from 'vitest';
import type { PanelRuntime } from '../controller.ts';
import { sampleCatalogData } from '../fakes.ts';
import { comparisonId, panelId, projectId, type PanelId } from '../ids.ts';
import { createComparison, liveSource, staticSource, type Panel } from '../model.ts';
import { presetById } from '../presets.ts';
import {
  clampSwipe, describeMismatch, planViewportMatch, SWIPE_DEFAULT, swipeAvailability, swipeClip, swipeKeyValue, swipeValueAt, swipeValueText, viewportsDiffer,
} from './swipe.ts';

const data = sampleCatalogData();
const version = (id: string) => data.versions.find((item) => item.versionId === id)!;
const phone = presetById('phone')!.viewport;
const laptop = presetById('laptop')!.viewport;

function panels(...roles: Array<['baseline' | 'candidate' | 'reference', 'static' | 'live', typeof phone?]>): readonly Panel[] {
  return createComparison(comparisonId('cmp'), projectId('sample-project'), roles.map(([role, kind, viewport], index) => ({
    id: panelId(`p${index + 1}`), role, viewport: viewport ?? phone,
    source: kind === 'static' ? staticSource(version('home-v1').captures[0]) : liveSource(version('home-v2')),
  }))).panels;
}
const noRuntime = new Map<PanelId, PanelRuntime>();
/** A version captured only at the laptop size, and one captured only at the phone size. */
const laptopOnly = { ...version('home-v2'), captures: version('home-v2').captures.filter((capture) => capture.viewport.w === laptop.w) };
const phoneOnly = { ...version('home-v1'), captures: version('home-v1').captures.filter((capture) => capture.viewport.w === phone.w) };

describe('swipe divider value', () => {
  it('clamps to 0–100 and recovers from non-numbers', () => {
    expect(clampSwipe(-5)).toBe(0);
    expect(clampSwipe(140)).toBe(100);
    expect(clampSwipe(33.333)).toBe(33.33);
    expect(clampSwipe(Number.NaN)).toBe(SWIPE_DEFAULT);
    expect(clampSwipe(Number.POSITIVE_INFINITY)).toBe(SWIPE_DEFAULT);
  });

  it('moves 1% on the arrow keys and 10% with Shift, in both axes', () => {
    expect(swipeKeyValue(50, 'ArrowRight')).toBe(51);
    expect(swipeKeyValue(50, 'ArrowUp')).toBe(51);
    expect(swipeKeyValue(50, 'ArrowLeft')).toBe(49);
    expect(swipeKeyValue(50, 'ArrowDown')).toBe(49);
    expect(swipeKeyValue(50, 'ArrowRight', true)).toBe(60);
    expect(swipeKeyValue(50, 'ArrowLeft', true)).toBe(40);
    expect(swipeKeyValue(50, 'PageUp')).toBe(60);
    expect(swipeKeyValue(50, 'PageDown')).toBe(40);
  });

  it('jumps to the ends with Home and End and never leaves 0–100', () => {
    expect(swipeKeyValue(37, 'Home')).toBe(0);
    expect(swipeKeyValue(37, 'End')).toBe(100);
    expect(swipeKeyValue(0, 'ArrowLeft')).toBe(0);
    expect(swipeKeyValue(3, 'ArrowLeft', true)).toBe(0);
    expect(swipeKeyValue(100, 'ArrowRight')).toBe(100);
    expect(swipeKeyValue(96, 'ArrowRight', true)).toBe(100);
  });

  it('leaves other keys alone so Tab and shortcuts keep working', () => {
    for (const key of ['Tab', 'Enter', ' ', 'a', 'Escape']) expect(swipeKeyValue(50, key)).toBeNull();
  });

  it('steps from the rounded value so a dragged 33.33 moves in whole percents', () => {
    expect(swipeKeyValue(33.33, 'ArrowRight')).toBe(34);
    expect(swipeKeyValue(33.6, 'ArrowLeft')).toBe(33);
  });

  it('describes the split in words and clips the candidate to the right of the divider', () => {
    expect(swipeValueText(25)).toBe('25% baseline, 75% candidate');
    expect(swipeValueText(0)).toBe('0% baseline, 100% candidate');
    expect(swipeClip(25)).toBe('inset(0 0 0 25%)');
    expect(swipeClip(500)).toBe('inset(0 0 0 100%)');
  });

  it('maps a pointer position to a value across the track, clamped at its edges', () => {
    const box = { left: 100, width: 400 };
    expect(swipeValueAt(300, box)).toBe(50);
    expect(swipeValueAt(200, box)).toBe(25);
    expect(swipeValueAt(40, box)).toBe(0);
    expect(swipeValueAt(900, box)).toBe(100);
    expect(swipeValueAt(300, { left: 0, width: 0 })).toBe(SWIPE_DEFAULT);
  });
});

describe('swipe availability', () => {
  it('needs exactly one baseline and one candidate, and says which is missing', () => {
    const ok = swipeAvailability(panels(['baseline', 'static'], ['candidate', 'static']), noRuntime);
    expect(ok.ok && ok.pair.others).toBe(0);
    const none = swipeAvailability(panels(['reference', 'static'], ['candidate', 'static']), noRuntime);
    expect(none).toMatchObject({ ok: false });
    expect(!none.ok && none.reason).toContain('baseline');
    const lone = swipeAvailability(panels(['baseline', 'static'], ['reference', 'static']), noRuntime);
    expect(!lone.ok && lone.reason).toContain('candidate');
    const crowded = swipeAvailability(panels(['baseline', 'static'], ['candidate', 'static'], ['candidate', 'live']), noRuntime);
    expect(!crowded.ok && crowded.reason).toMatch(/2 panels are candidates/);
  });

  it('counts the references it leaves out of view', () => {
    const result = swipeAvailability(panels(['baseline', 'static'], ['candidate', 'live'], ['reference', 'live']), noRuntime);
    expect(result.ok && result.pair.others).toBe(1);
  });

  it('refuses a hosted live preview, which cannot be layered', () => {
    const list = panels(['baseline', 'static'], ['candidate', 'live']);
    const runtime = new Map<PanelId, PanelRuntime>([[list[1].id, {
      status: 'ready', version: null, capture: null, imageSrc: null, qualification: 'qualified', contentSize: null, error: null,
      session: { kind: 'live-preview', sessionId: 's', versionId: version('home-v2').versionId, qualification: 'qualified', viewport: phone,
        contentSize: { width: 390, height: 844 }, surface: { kind: 'host-surface', surfaceId: 'x' }, close() {} },
    }]]);
    const result = swipeAvailability(list, runtime);
    expect(!result.ok && result.reason).toContain('hosted live preview');
  });
});

describe('viewport match plan', () => {
  const pair = (baseline: ReturnType<typeof panels>[number], candidate: ReturnType<typeof panels>[number]) => ({ baseline, candidate, others: 0 });

  it('detects different viewports and names both sizes', () => {
    const [a, b] = panels(['baseline', 'live', phone], ['candidate', 'live', laptop]);
    expect(viewportsDiffer(pair(a, b))).toBe(true);
    expect(describeMismatch(pair(a, b))).toContain('390 × 844 @3x');
    expect(describeMismatch(pair(a, b))).toContain('1440 × 900 @2x');
    const [c, d] = panels(['baseline', 'live', phone], ['candidate', 'live', phone]);
    expect(viewportsDiffer(pair(c, d))).toBe(false);
  });

  it('has a live candidate follow the baseline', () => {
    const [a, b] = panels(['baseline', 'static', phone], ['candidate', 'live', laptop]);
    expect(planViewportMatch(pair(a, b), () => null)).toMatchObject({ leader: a, follower: b, via: 'live' });
  });

  it('has a static candidate follow through a capture at the baseline size, or else the baseline follows', () => {
    const [a, b] = panels(['baseline', 'live', phone], ['candidate', 'static', laptop]);
    // home-v1 has a capture at both phone and laptop sizes.
    expect(planViewportMatch(pair(a, b), () => version('home-v1'))).toMatchObject({ leader: a, follower: b, via: 'capture' });
    // The candidate's version only has a laptop capture, so it cannot take the phone size: the live baseline follows it instead.
    expect(planViewportMatch(pair(a, b), () => laptopOnly)).toMatchObject({ leader: b, follower: a, via: 'live' });
  });

  it('gives up when two static captures exist only at their own sizes', () => {
    const [a, b] = panels(['baseline', 'static', phone], ['candidate', 'static', laptop]);
    expect(planViewportMatch(pair(a, b), (panel) => (panel === a ? phoneOnly : laptopOnly))).toBeNull();
  });
});

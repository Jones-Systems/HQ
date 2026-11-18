import { describe, expect, it } from 'vitest';
import type { ContentSize, StaticCapture } from './contract.ts';
import { sampleCatalogData } from './fakes.ts';
import { mapScroll, scrollRange } from './geometry.ts';
import { comparisonId, panelId, parseVersionId, projectId, versionId, type PanelId } from './ids.ts';
import {
  addPanel, applyPreset, createBaselineCandidate, createComparison, liveSource, matchViewports, panelById,
  removePanel, resizePanel, scrollPanel, selectCaptureAtViewport, selectVersion, setRole, setSyncScroll,
  staticSource, type ComparisonState, type ContentMetrics,
} from './model.ts';
import { presetById } from './presets.ts';

const data = sampleCatalogData();
const version = (id: string) => data.versions.find((item) => item.versionId === id)!;
const phone = presetById('phone')!.viewport;
const ids = ['p1', 'p2', 'p3', 'p4'].map(panelId);

function fourPanels(): ComparisonState {
  return createComparison(comparisonId('cmp-1'), projectId('sample-project'), [
    { id: ids[0], role: 'baseline', source: liveSource(version('home-v1')), viewport: phone, width: 400 },
    { id: ids[1], role: 'candidate', source: liveSource(version('home-v2')), viewport: phone, width: 360 },
    { id: ids[2], source: staticSource(version('home-v1').captures[0]), viewport: phone, width: 520 },
    { id: ids[3], source: liveSource(version('pricing-v1')), viewport: phone, width: 300 },
  ]);
}

function metricsOf(entries: Array<[PanelId, ContentSize]>): ContentMetrics {
  return new Map(entries);
}

describe('independent panel sizing', () => {
  it('resizing panel 1 leaves the widths (and objects) of panels 2..N unchanged', () => {
    const before = fourPanels();
    const outcome = resizePanel(before, ids[0], 640);
    expect(outcome.ok).toBe(true);
    expect(outcome.state.panels.map((panel) => panel.width)).toEqual([640, 360, 520, 300]);
    for (let i = 1; i < 4; i += 1) expect(outcome.state.panels[i]).toBe(before.panels[i]);
    expect(before.panels[0].width).toBe(400);
  });

  it('resizing any middle or last panel touches only that panel, including clamping', () => {
    const before = fourPanels();
    const narrow = resizePanel(before, ids[2], 10).state;
    expect(narrow.panels.map((panel) => panel.width)).toEqual([400, 360, 200, 300]);
    const wide = resizePanel(narrow, ids[3], 99_999).state;
    expect(wide.panels.map((panel) => panel.width)).toEqual([400, 360, 200, 4000]);
    expect(resizePanel(before, panelId('missing'), 500)).toMatchObject({ ok: false, reason: 'unknown-panel' });
  });

  it('adding and removing panels does not redistribute other widths', () => {
    const before = fourPanels();
    const added = addPanel(before, { id: panelId('p5'), source: liveSource(version('home-v3')), viewport: phone, width: 450 }).state;
    expect(added.panels.map((panel) => panel.width)).toEqual([400, 360, 520, 300, 450]);
    const removed = removePanel(added, ids[1]).state;
    expect(removed.panels.map((panel) => panel.width)).toEqual([400, 520, 300, 450]);
  });
});

describe('synced scroll by ratio', () => {
  const content = metricsOf([
    [ids[0], { width: 390, height: 844 * 3 }],
    [ids[1], { width: 390, height: 844 * 5 }],
    [ids[2], { width: 390, height: 844 * 2 }],
    [ids[3], { width: 390, height: 844 }], // cannot scroll vertically
  ]);

  it('maps the leader position by ratio of each scroll range', () => {
    let state = setSyncScroll(fourPanels(), true, ids[0], content).state;
    const leaderRange = scrollRange(content.get(ids[0])!, phone).y; // 1688
    state = scrollPanel(state, ids[0], { x: 0, y: leaderRange / 2 }, content).state;
    expect(panelById(state, ids[0])!.scroll.y).toBe(844);
    expect(panelById(state, ids[1])!.scroll.y).toBe((844 * 4) / 2);
    expect(panelById(state, ids[2])!.scroll.y).toBe(844 / 2);
    expect(panelById(state, ids[3])!.scroll.y).toBe(0);
    state = scrollPanel(state, ids[0], { x: 0, y: 1e9 }, content).state;
    expect(state.panels.map((panel) => panel.scroll.y)).toEqual([1688, 844 * 4, 844, 0]);
  });

  it('turning sync off unlinks without moving anything; later scrolls move one panel only', () => {
    let state = setSyncScroll(fourPanels(), true, ids[0], content).state;
    state = scrollPanel(state, ids[0], { x: 0, y: 422 }, content).state;
    const linked = state.panels.map((panel) => panel.scroll.y);
    state = setSyncScroll(state, false, ids[0], content).state;
    expect(state.panels.map((panel) => panel.scroll.y)).toEqual(linked);
    const before = state;
    state = scrollPanel(state, ids[1], { x: 0, y: 3000 }, content).state;
    expect(panelById(state, ids[1])!.scroll.y).toBe(3000);
    for (const id of [ids[0], ids[2], ids[3]]) expect(panelById(state, id)).toBe(panelById(before, id));
  });

  it('re-enabling aligns the others to the chosen leader once', () => {
    let state = scrollPanel(fourPanels(), ids[1], { x: 0, y: 844 * 4 }, content).state; // panel 2 at its end, unsynced
    expect(panelById(state, ids[0])!.scroll.y).toBe(0);
    state = setSyncScroll(state, true, ids[1], content).state;
    expect(state.panels.map((panel) => panel.scroll.y)).toEqual([1688, 844 * 4, 844, 0]);
  });

  it('a panel with unknown content is left in place rather than guessed', () => {
    const partial = metricsOf([[ids[0], { width: 390, height: 2532 }]]);
    let state = setSyncScroll(fourPanels(), true, ids[0], partial).state;
    state = scrollPanel(state, ids[0], { x: 0, y: 500 }, partial).state;
    expect(state.panels.slice(1).every((panel) => panel.scroll.y === 0)).toBe(true);
  });

  it('ratio mapping round-trips without drift', () => {
    const from = { x: 0, y: 1688 };
    const to = { x: 0, y: 3376 };
    const forward = mapScroll({ x: 0, y: 517 }, from, to);
    expect(mapScroll(forward, to, from).y).toBeCloseTo(517, 9);
  });
});

describe('version binding is exact', () => {
  it('moving aliases are never VersionIds', () => {
    for (const alias of ['latest', 'LATEST', 'head', 'current', 'newest', 'tip']) expect(parseVersionId(alias)).toBeNull();
    expect(parseVersionId('')).toBeNull();
    expect(parseVersionId(' home-v1')).toBeNull();
    expect(parseVersionId('home-v1')).toBe('home-v1');
  });

  it('choosing a version binds that VersionId and its exact capture', () => {
    const state = fourPanels();
    const chosen = selectVersion(state, ids[2], version('home-v2')).state;
    const source = panelById(chosen, ids[2])!.source;
    expect(source).toEqual({
      kind: 'static-capture', versionId: 'home-v2',
      captureId: version('home-v2').captures[0].captureId, captureDigest: version('home-v2').captures[0].captureDigest,
    });
    const live = selectVersion(state, ids[1], version('home-v1')).state;
    expect(panelById(live, ids[1])!.source).toEqual({ kind: 'live-preview', versionId: 'home-v1', route: '/', state: 'default' });
  });

  it('static mode with no capture fails without changing the panel', () => {
    const empty = { ...version('home-v1'), versionId: versionId('home-v0'), captures: [] };
    const state = fourPanels();
    expect(selectVersion(state, ids[2], empty)).toMatchObject({ ok: false, reason: 'no-capture', state });
  });

  it('rejects a version summary carrying another version\'s capture', () => {
    const foreign: StaticCapture = version('home-v1').captures[0];
    const tampered = { ...version('home-v2'), captures: [foreign] };
    expect(selectVersion(fourPanels(), ids[2], tampered)).toMatchObject({ ok: false, reason: 'capture-version-mismatch' });
  });
});

describe('viewports, presets and roles', () => {
  it('a static capture keeps its captured viewport; a matching capture can be chosen', () => {
    const state = fourPanels();
    expect(applyPreset(state, ids[2], 'laptop')).toMatchObject({ ok: false, reason: 'static-viewport-fixed' });
    const laptop = presetById('laptop')!.viewport;
    const moved = selectCaptureAtViewport(state, ids[2], version('home-v1'), laptop).state;
    expect(panelById(moved, ids[2])!.viewport).toEqual(laptop);
    expect(panelById(moved, ids[2])!.presetId).toBe('laptop');
    expect(selectCaptureAtViewport(state, ids[2], version('home-v1'), presetById('tablet-portrait')!.viewport))
      .toMatchObject({ ok: false, reason: 'no-capture-at-viewport' });
  });

  it('live presets change only that panel and reset its scroll', () => {
    const state = fourPanels();
    const next = applyPreset(state, ids[1], 'tablet-portrait').state;
    expect(panelById(next, ids[1])).toMatchObject({ presetId: 'tablet-portrait', viewport: { w: 820, h: 1180, dpr: 2 }, width: 360 });
    expect(next.panels[0]).toBe(state.panels[0]);
    expect(applyPreset(state, ids[1], 'nope')).toMatchObject({ ok: false, reason: 'unknown-preset' });
  });

  it('match viewports applies to live panels and reports static ones skipped', () => {
    const state = applyPreset(fourPanels(), ids[0], 'laptop').state;
    const outcome = matchViewports(state, ids[0]);
    expect(outcome.skipped).toEqual([ids[2]]);
    expect(outcome.state.panels.map((panel) => panel.presetId)).toEqual(['laptop', 'laptop', 'phone', 'laptop']);
  });

  it('keeps at most one baseline', () => {
    const state = setRole(fourPanels(), ids[1], 'baseline').state;
    expect(state.panels.map((panel) => panel.role)).toEqual(['reference', 'baseline', 'reference', 'reference']);
    const pair = createBaselineCandidate(comparisonId('pair'), projectId('sample-project'),
      { id: ids[0], source: liveSource(version('home-v1')), viewport: phone },
      { id: ids[1], source: liveSource(version('home-v2')), viewport: phone });
    expect(pair.panels.map((panel) => [panel.role, panel.source.versionId])).toEqual([['baseline', 'home-v1'], ['candidate', 'home-v2']]);
  });
});

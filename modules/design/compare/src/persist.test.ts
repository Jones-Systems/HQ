import { describe, expect, it } from 'vitest';
import { loadComparison } from './controller.ts';
import { createFakeStorage, sampleCatalogData } from './fakes.ts';
import { comparisonId, panelId, projectId } from './ids.ts';
import { createComparison, liveSource, resizePanel, staticSource } from './model.ts';
import { COMPARISON_SCHEMA, comparisonKey, parseComparison, serializeComparison } from './persist.ts';
import { presetById } from './presets.ts';

const data = sampleCatalogData();
const phone = presetById('phone')!.viewport;
const state = resizePanel(createComparison(comparisonId('cmp-1'), projectId('sample-project'), [
  { id: panelId('a'), role: 'baseline', source: staticSource(data.versions[0].captures[0]), viewport: phone },
  { id: panelId('b'), role: 'candidate', source: liveSource(data.versions[1]), viewport: phone },
]), panelId('b'), 512).state;

describe('hq.design.comparison/v1 layout document', () => {
  it('round-trips exactly and re-serializes byte-identically', () => {
    const raw = serializeComparison(state);
    const parsed = parseComparison(raw);
    expect(parsed).toEqual({ status: 'ok', state });
    if (parsed.status === 'ok') expect(serializeComparison(parsed.state)).toBe(raw);
  });

  it('rejects moving version aliases, unknown fields and malformed values', () => {
    const doc = JSON.parse(serializeComparison(state));
    const variants: Array<(value: any) => void> = [
      (v) => { v.panels[1].source.versionId = 'latest'; },
      (v) => { v.panels[0].source.captureDigest = 'sha256:short'; },
      (v) => { v.panels[0].extra = true; },
      (v) => { v.extra = 1; },
      (v) => { v.panels[0].width = 10; },
      (v) => { v.panels[0].presetId = 'laptop'; }, // preset/viewport disagreement
      (v) => { v.panels[1].role = 'baseline'; },   // two baselines
      (v) => { v.panels[1].id = v.panels[0].id; }, // duplicate panel
      (v) => { v.panels = []; },
      (v) => { v.panels[0].scroll.y = -1; },
    ];
    for (const mutate of variants) {
      const copy = structuredClone(doc);
      mutate(copy);
      expect(parseComparison(JSON.stringify(copy))).toEqual({ status: 'invalid' });
    }
    expect(parseComparison('{not json')).toEqual({ status: 'invalid' });
  });

  it('reports a future schema without opening it, and loading never writes', async () => {
    const future = JSON.stringify({ ...JSON.parse(serializeComparison(state)), schema: 'hq.design.comparison/v2' });
    expect(parseComparison(future)).toEqual({ status: 'unsupported-version', schema: 'hq.design.comparison/v2' });
    const storage = createFakeStorage({ [comparisonKey('cmp-1')]: future });
    expect(await loadComparison(storage, comparisonId('cmp-1'))).toEqual({ status: 'unsupported-version', schema: 'hq.design.comparison/v2' });
    expect(storage.writes).toEqual([]);
    expect(storage.documents.get(comparisonKey('cmp-1'))).toBe(future);
    expect(await loadComparison(storage, comparisonId('other'))).toEqual({ status: 'missing' });
  });

  it('refuses a document stored under another comparison id', async () => {
    const storage = createFakeStorage({ [comparisonKey('cmp-2')]: serializeComparison(state) });
    expect(await loadComparison(storage, comparisonId('cmp-2'))).toEqual({ status: 'invalid' });
    expect(COMPARISON_SCHEMA).toBe('hq.design.comparison/v1');
  });
});

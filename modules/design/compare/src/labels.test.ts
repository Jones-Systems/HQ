import { describe, expect, it } from 'vitest';
import { sampleCatalogData } from './fakes.ts';
import { labelLive, labelSource, labelStatic } from './labels.ts';
import { liveSource, staticSource } from './model.ts';

const data = sampleCatalogData();
const browserCapture = data.versions[0].captures[0];
const simulatorCapture = data.versions[2].captures[0];

describe('static capture versus live preview labelling', () => {
  it('a static capture and a live preview never share a badge or evidence class', () => {
    const staticLabel = labelSource(staticSource(browserCapture), browserCapture, null, null);
    const liveLabel = labelSource(liveSource(data.versions[0]), null, 'labelled-fake', 'Fake preview');
    expect(staticLabel.badge).toBe('Static capture');
    expect(liveLabel.badge).toBe('Live preview');
    expect(staticLabel.evidence).not.toBe(liveLabel.evidence);
    expect(staticLabel.detail).not.toBe(liveLabel.detail);
  });

  it('a browser capture is never labelled native, and fixtures say so', () => {
    const label = labelStatic(browserCapture);
    expect(label.evidence).toBe('browser-capture');
    expect(label.detail).toBe('Browser capture · 390 × 844 @3x · 2026-10-19 14:02 UTC');
    expect(label.caveats).toContain('Browser capture; not native evidence.');
    expect(label.caveats).toContain('Synthetic fixture.');
    expect(`${label.detail} ${label.caveats.join(' ')}`).not.toMatch(/native (device )?capture/i);
    expect(labelStatic(simulatorCapture)).toMatchObject({ evidence: 'native-simulator-capture' });
    expect(labelStatic(simulatorCapture).caveats).toContain('Simulator capture; not device evidence.');
  });

  it('a fake preview is always labelled fake, never qualified', () => {
    const fake = labelLive('labelled-fake', 'Fake preview');
    expect(fake.evidence).toBe('live-preview-fake');
    expect(fake.detail).toBe('Fake preview · labelled fake');
    expect(fake.caveats.join(' ')).toMatch(/not a qualified preview/);
    expect(labelLive(null, null)).toMatchObject({ badge: 'Live preview', detail: 'Preview unavailable' });
    expect(labelLive('qualified', 'Desktop preview')).toMatchObject({ evidence: 'live-preview', detail: 'Desktop preview' });
  });

  it('an unresolved static capture is labelled unresolved, not as any other source', () => {
    expect(labelStatic(null)).toMatchObject({ badge: 'Static capture', evidence: 'unresolved' });
  });
});

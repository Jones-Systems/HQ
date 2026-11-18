import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PRESERVED_CONTENT_KINDS, PreservedContent, setContentScheme, type ContentScheme } from '../src';

// Happy-dom proves the marker and the CSSOM pin. That the pin decides the used color-scheme of an <img>, an
// SVG-as-<img> and a srcdoc iframe, with unchanged pixels, is proved in a browser: docs/evidence/hq-social-work/ui/.
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme; });

describe.each(PRESERVED_CONTENT_KINDS)('PreservedContent kind=%s', (kind) => {
  it.each(['light', 'dark'] as const)('pins --hq-content-scheme to recorded %s through every chrome change', (recorded) => {
    const { container } = render(<PreservedContent kind={kind} recordedScheme={recorded}><img alt="Fictional capture" src="data:," /></PreservedContent>);
    const well = container.firstElementChild as HTMLElement;
    expect(well.getAttribute('data-hq-content')).toBe(kind);
    expect(well.getAttribute('data-hq-recorded-scheme')).toBe(recorded);
    expect(well.hasAttribute('data-hq-matte')).toBe(false);
    for (const chrome of ['light', 'dark', undefined]) {
      if (chrome) document.documentElement.dataset.theme = chrome; else delete document.documentElement.dataset.theme;
      expect(well.style.getPropertyValue('--hq-content-scheme')).toBe(recorded);
    }
    // The pin is the only inline declaration: no filter, blend mode, opacity or colour reaches the well.
    expect(well.style.length).toBe(1);
    expect(well.style.item(0)).toBe('--hq-content-scheme');
  });
});

describe('PreservedContent', () => {
  it('follows a change of the recorded scheme, not of the chrome', () => {
    const { container, rerender } = render(<PreservedContent kind="captured" recordedScheme="light"><span /></PreservedContent>);
    const well = container.firstElementChild as HTMLElement;
    document.documentElement.dataset.theme = 'dark';
    expect(well.style.getPropertyValue('--hq-content-scheme')).toBe('light');
    rerender(<PreservedContent kind="captured" recordedScheme="dark"><span /></PreservedContent>);
    expect(well.style.getPropertyValue('--hq-content-scheme')).toBe('dark');
  });

  it('adds the fixed checker matte on request and passes through labelling attributes', () => {
    const { container } = render(<PreservedContent kind="export" recordedScheme="dark" matte="checker" aria-label="Export preview" className="hq-well-frame"><span /></PreservedContent>);
    const well = container.firstElementChild as HTMLElement;
    expect(well.getAttribute('data-hq-matte')).toBe('checker');
    expect(well.getAttribute('aria-label')).toBe('Export preview');
    expect(well.className).toBe('hq-well-frame');
  });

  it('exports setContentScheme for module-owned wells and rejects anything but light or dark', () => {
    const own = document.createElement('div');
    own.setAttribute('data-hq-content', 'producer');
    setContentScheme(own, 'dark');
    expect(own.style.getPropertyValue('--hq-content-scheme')).toBe('dark');
    expect(() => setContentScheme(own, 'system' as ContentScheme)).toThrow(/light or dark/);
    expect(own.style.getPropertyValue('--hq-content-scheme')).toBe('dark');
  });
});

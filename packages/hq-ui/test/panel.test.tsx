import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Panel, PanelGrid, PanelHeader, PanelRows, TileGrid } from '../src/panel';

afterEach(cleanup);

describe('opt-in panel composition', () => {
  it('preserves heading, freshness, actions, hairline rows and nested content ownership', () => {
    const { container } = render(<PanelGrid aria-label="Workspace panels">
      <Panel aria-labelledby="summary" padding="compact">
        <PanelHeader title={<span id="summary">Summary</span>} headingLevel={3} description="Saved locally"
          metadata={<details><summary>Freshness</summary>Last observed snapshot; refresh is unavailable.</details>}
          actions={<button type="button">Inspect</button>} />
        <PanelRows aria-label="Details"><span>Owner</span>{null}<div className="existing-card">{'LongIdentifier'.repeat(30)}</div></PanelRows>
      </Panel>
    </PanelGrid>);
    expect(screen.getByRole('heading', { level: 3, name: 'Summary' })).toBeTruthy();
    expect(screen.getByText('Freshness').closest('details')).toBeTruthy();
    expect(screen.getByText('Last observed snapshot; refresh is unavailable.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inspect' }).getAttribute('type')).toBe('button');
    const rows = screen.getByRole('list', { name: 'Details' });
    expect(within(rows).getAllByRole('listitem')).toHaveLength(2);
    expect(rows.querySelector('.existing-card')?.className).toBe('existing-card');
    expect(container.querySelector('.hq-panel--compact')).toBeTruthy();
  });

  it('keeps shrink-safe grid tracks and direct-child minimums without descendant card selectors', () => {
    const css = readFileSync(new NodeURL('../src/panel/panel.css', import.meta.url), 'utf8');
    expect(css).toContain('repeat(auto-fill, minmax(min(100%, 400px), 1fr))');
    expect(css).toContain('repeat(auto-fill, minmax(min(100%, 260px), 1fr))');
    expect(css).toContain('.hq-panel-grid > *, .hq-tile-grid > * { min-width: 0; }');
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(match => match[1]!.trim().split(','));
    expect(selectors.every(selector => /^\.hq-(panel|tile)/.test(selector.trim()))).toBe(true);
    expect(css).not.toMatch(/\.existing-card|\.hq-panel\s+(?:div|article|section|\.hq-panel)\b/);
    const { container } = render(<TileGrid><Panel>One tile</Panel><Panel>Another tile</Panel></TileGrid>);
    expect(container.firstElementChild?.className).toBe('hq-tile-grid');
    expect(container.querySelectorAll('.hq-panel')).toHaveLength(2);
  });
});

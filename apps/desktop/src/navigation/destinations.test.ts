// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DOMAIN_IDS, isDestination } from '@hq/contracts';
import { DESIGN_NAV_IDS } from '../../../../modules/design/ui/contract';
import { formatDestination as formatDesign, parseDestination as parseDesign } from '../../../../modules/design/ui/src/navigation';
import { parseSocialDestination } from '../../../../modules/social/nav/routes';
import { pageDestination, parseWorkDestination } from '../../../../modules/work/nav/routes';
import { parseDestination as parseWiki } from '../../../../modules/wiki/contract/src/index.ts';
import { allSectionDestinations, describeLocation, destinationParses, sectionDestinations, wikiSearchDestination } from './destinations';
import { buildCommands } from './commands';

describe('section destinations', () => {
  it('offers sections for every domain', () => {
    for (const domain of DOMAIN_IDS) expect(sectionDestinations(domain).length, domain).toBeGreaterThan(0);
    expect(sectionDestinations('work').map(entry => entry.label)).toContain('Planner settings');
    expect(sectionDestinations('social').map(entry => entry.label)).toContain('Library');
    expect(sectionDestinations('design').map(entry => entry.label)).toEqual(['Projects', 'Resources', 'Review', 'Requests', 'Runs']);
  });

  it("every destination is one its own module's parser accepts", () => {
    for (const entry of allSectionDestinations) {
      expect(isDestination(entry.destination), entry.destination).toBe(true);
      expect(destinationParses(entry), `${entry.domain} ${entry.destination}`).toBe(true);
    }
    for (const entry of sectionDestinations('social')) expect(parseSocialDestination(entry.destination), entry.destination).not.toBeNull();
    for (const entry of sectionDestinations('work')) {
      const route = parseWorkDestination(entry.destination);
      expect(route, entry.destination).not.toBeNull();
      // Canonical: the module formats the parsed page back to the same string.
      expect(route!.kind === 'page' ? pageDestination(route!) : null, entry.destination).toBe(entry.destination);
    }
    for (const entry of sectionDestinations('wiki').filter(item => item.destination !== 'home')) {
      expect(parseWiki(entry.destination).ok, entry.destination).toBe(true);
    }
    for (const entry of sectionDestinations('design')) {
      const location = parseDesign(entry.destination);
      expect(location.section).toBeNull();
      expect(formatDesign(location)).toBe(entry.destination);
      expect(DESIGN_NAV_IDS).toContain(location.nav);
    }
  });

  it('every navigate command the palette builds is a destination its module accepts', () => {
    const accepted = new Set(allSectionDestinations.map(entry => `${entry.domain}:${entry.destination}`));
    for (const command of buildCommands({ domain: 'work', settingsOpen: false, appearance: 'system', back: { label: 'Somewhere' }, mac: false })) {
      if (command.action.type !== 'navigate' || command.action.destination === undefined) continue;
      expect(accepted.has(`${command.action.domain}:${command.action.destination}`), command.id).toBe(true);
    }
  });

  it('rejects a destination its module would not open', () => {
    expect(destinationParses({ domain: 'work', destination: 'not-a-page', label: 'x', keywords: [] })).toBe(false);
    expect(destinationParses({ domain: 'work', destination: 'item/abc', label: 'x', keywords: [] })).toBe(false);
    expect(destinationParses({ domain: 'social', destination: 'nope', label: 'x', keywords: [] })).toBe(false);
    expect(destinationParses({ domain: 'design', destination: 'review/compare', label: 'x', keywords: [] })).toBe(false);
    expect(destinationParses({ domain: 'wiki', destination: 'page/bl/x', label: 'x', keywords: [] })).toBe(false);
  });
});

describe('wikiSearchDestination', () => {
  it('formats through the Wiki contract and round-trips', () => {
    const destination = wikiSearchDestination('espresso notes & more')!;
    expect(destination).toBe('search?q=espresso%20notes%20%26%20more');
    const parsed = parseWiki(destination);
    expect(parsed.ok && parsed.value).toEqual({ kind: 'search', query: 'espresso notes & more' });
    expect(isDestination(destination)).toBe(true);
  });
  it('is null for a query the Wiki would reject', () => {
    expect(wikiSearchDestination('')).toBeNull();
    expect(wikiSearchDestination('x'.repeat(5000))).toBeNull();
  });
});

describe('describeLocation', () => {
  it('names the domain and the section', () => {
    expect(describeLocation('work', 'board')).toBe('Work · Status board');
    expect(describeLocation('work', 'home')).toBe('Work · Status board');
    expect(describeLocation('work', 'item/abc123')).toBe('Work · Card');
    expect(describeLocation('social', 'library/draft-1')).toBe('Social · Library');
    expect(describeLocation('design', 'review')).toBe('Design · Review');
    expect(describeLocation('design', 'home')).toBe('Design · Projects');
  });
  it('falls back to the domain name alone', () => {
    expect(describeLocation('wiki', 'home')).toBe('Wiki');
    expect(describeLocation('social', 'nonsense/path')).toBe('Social');
    expect(describeLocation('work', 'nonsense')).toBe('Work');
    expect(describeLocation('wiki', 'search?q=tea')).toBe('Wiki · Search');
  });
});

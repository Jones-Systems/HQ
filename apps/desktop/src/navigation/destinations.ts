import { DOMAIN_IDS, type DomainId } from '@hq/contracts';
import { DOMAIN_LABELS } from '../domain-metadata';
import { DESIGN_NAV_IDS } from '../../../../modules/design/ui/contract';
import { NAV_LABELS as DESIGN_NAV_LABELS, formatDestination as formatDesignDestination, parseDestination as parseDesignDestination } from '../../../../modules/design/ui/src/navigation';
import { NAV_ITEMS as SOCIAL_NAV_ITEMS, SECTION_LABELS as SOCIAL_SECTION_LABELS, parseSocialDestination } from '../../../../modules/social/nav/routes';
import { NAV_ITEMS as WORK_NAV_ITEMS, PAGE_LABELS as WORK_PAGE_LABELS, parseWorkDestination } from '../../../../modules/work/nav/routes';
import { NAMESPACES } from '../../../../modules/wiki/contract/src/index.ts';
import { HOME as WIKI_HOME, resolveDestination as resolveWikiDestination, searchDestination, topicsDestination } from '../../../../modules/wiki/ui/src/destinations.ts';
import { namespaceLabel } from '../../../../modules/wiki/ui/src/format.ts';

/** A destination the palette may offer. Every string comes from the owning module's own route code. */
export interface SectionDestination {
  readonly domain: DomainId;
  readonly destination: string;
  readonly label: string;
  readonly keywords: readonly string[];
}

const SOCIAL: readonly SectionDestination[] = SOCIAL_NAV_ITEMS.map(item => ({
  domain: 'social' as const, destination: item.destination, label: item.label, keywords: item.tag ? [item.tag.toLowerCase()] : [],
}));

const WORK: readonly SectionDestination[] = WORK_NAV_ITEMS.map(item => ({
  domain: 'work' as const, destination: item.destination, label: item.label, keywords: [item.group === 'settings' ? 'planner' : item.group],
}));

const DESIGN: readonly SectionDestination[] = DESIGN_NAV_IDS.map(nav => ({
  domain: 'design' as const, destination: nav, label: DESIGN_NAV_LABELS[nav], keywords: [],
}));

const WIKI: readonly SectionDestination[] = [
  { domain: 'wiki' as const, destination: WIKI_HOME, label: 'Home', keywords: ['pages', 'knowledge'] },
  ...NAMESPACES.flatMap(namespace => {
    const destination = topicsDestination(namespace);
    return destination === null ? [] : [{ domain: 'wiki' as const, destination, label: `Topics · ${namespaceLabel(namespace)}`, keywords: ['topics', 'browse', namespace] }];
  }),
];

const BY_DOMAIN: Readonly<Record<DomainId, readonly SectionDestination[]>> = { design: DESIGN, social: SOCIAL, work: WORK, wiki: WIKI };

/** The main sections of a domain, in the order its own navigation shows them. */
export const sectionDestinations = (domain: DomainId): readonly SectionDestination[] => BY_DOMAIN[domain];
export const allSectionDestinations: readonly SectionDestination[] = DOMAIN_IDS.flatMap(domain => BY_DOMAIN[domain]);

/** Wiki search destination for a query, or null when the Wiki would reject it. */
export const wikiSearchDestination = (query: string): string | null => searchDestination(query);

/**
 * True when the owning module recognises `destination` as `section`. Design's parser never fails (it falls back to
 * Projects), so its result is compared with the input instead.
 */
export function destinationParses(entry: SectionDestination): boolean {
  switch (entry.domain) {
    case 'design': {
      const location = parseDesignDestination(entry.destination);
      return formatDesignDestination(location) === entry.destination && location.section === null;
    }
    case 'social': return parseSocialDestination(entry.destination) !== null;
    case 'work': {
      const route = parseWorkDestination(entry.destination);
      return route !== null && route.kind === 'page';
    }
    case 'wiki': return entry.destination === WIKI_HOME || resolveWikiDestination(entry.destination).view === 'topics';
  }
}

/** A short place name for return labels: `Work · Status board`, `Social · Library`, or just `Wiki`. */
export function describeLocation(domain: DomainId, destination: string): string {
  const name = DOMAIN_LABELS[domain];
  const section = sectionName(domain, destination);
  return section ? `${name} · ${section}` : name;
}

function sectionName(domain: DomainId, destination: string): string | null {
  switch (domain) {
    case 'design': return DESIGN_NAV_LABELS[parseDesignDestination(destination).nav];
    case 'social': {
      const route = parseSocialDestination(destination);
      return route ? SOCIAL_SECTION_LABELS[route.section] : null;
    }
    case 'work': {
      const route = parseWorkDestination(destination);
      return route === null ? null : route.kind === 'item' ? 'Card' : WORK_PAGE_LABELS[route.page];
    }
    case 'wiki': {
      const resolved = resolveWikiDestination(destination);
      return resolved.view === 'home' ? null : resolved.view === 'page' ? 'Page' : resolved.view === 'search' ? 'Search' : 'Topics';
    }
  }
}

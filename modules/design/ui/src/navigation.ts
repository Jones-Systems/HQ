import { isDestination } from '@hq/contracts';
import { DESIGN_NAV_IDS, type DesignLocation, type DesignNavId } from '../contract.ts';
import { isSectionId } from './json.ts';

export const NAV_LABELS: Readonly<Record<DesignNavId, string>> = {
  projects: 'Projects', resources: 'Resources', review: 'Review', requests: 'Requests', runs: 'Runs',
};

export const DEFAULT_LOCATION: DesignLocation = { nav: 'projects', section: null };

export function isNavId(value: unknown): value is DesignNavId {
  return typeof value === 'string' && DESIGN_NAV_IDS.some((id) => id === value);
}

/** `projects` or `review/compare`. Always a valid shell destination. */
export function formatDestination(location: DesignLocation): string {
  return location.section === null ? location.nav : `${location.nav}/${location.section}`;
}

/**
 * Parse the shell's opaque destination. Unknown or legacy values (the shell's
 * initial `home`) fall back to Projects rather than failing; the shell keeps
 * whatever it stored.
 */
export function parseDestination(destination: string): DesignLocation {
  if (!isDestination(destination)) return DEFAULT_LOCATION;
  const [nav, section, ...rest] = destination.split('/');
  if (!isNavId(nav) || rest.length > 0) return DEFAULT_LOCATION;
  if (section === undefined) return { nav, section: null };
  return isSectionId(section) ? { nav, section } : { nav, section: null };
}

export function sameLocation(a: DesignLocation, b: DesignLocation): boolean {
  return a.nav === b.nav && a.section === b.section;
}

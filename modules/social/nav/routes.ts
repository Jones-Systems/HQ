import { parseContentDestination } from '../content';
import { parseWorkbenchDestination } from '../workbench';

/**
 * Social destinations, reconciled with T3 (spec.hq-social-work#ctx.social-design-reconciliation.001):
 * `home` (Overview), `overview`, `sources[/<sourceId>]` (reserved), `workbenches[/<toolId>]`,
 * `library[/<draftId>]`, `calendar[/<YYYY-MM>]`, `runs[/<runId>]` and `channels`.
 * Destinations are module-local strings; the shell stores the last one and remounts the module with it.
 */

export const SOCIAL_SECTIONS = ['overview', 'sources', 'workbenches', 'library', 'calendar', 'runs', 'channels'] as const;
export type SocialSection = (typeof SOCIAL_SECTIONS)[number];

export type SocialRoute =
  | { readonly section: 'overview' }
  | { readonly section: 'sources'; readonly sourceId?: string }
  | { readonly section: 'workbenches' | 'runs' | 'library' | 'calendar' }
  | { readonly section: 'channels' };

export interface NavItem {
  readonly section: SocialSection;
  readonly label: string;
  /** Where the item goes when the section has no remembered destination. */
  readonly destination: string;
  readonly group: 'main' | 'later';
  /** A short status shown next to the label; never colour alone. */
  readonly tag?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { section: 'overview', label: 'Overview', destination: 'overview', group: 'main' },
  { section: 'sources', label: 'Sources', destination: 'sources', group: 'main', tag: 'Proposed' },
  { section: 'workbenches', label: 'Workbenches', destination: 'workbenches', group: 'main' },
  { section: 'library', label: 'Library', destination: 'library', group: 'main' },
  { section: 'calendar', label: 'Calendar', destination: 'calendar', group: 'main' },
  { section: 'runs', label: 'Run history', destination: 'runs', group: 'main' },
  { section: 'channels', label: 'Channels & accounts', destination: 'channels', group: 'later' },
];

export const SECTION_LABELS: { readonly [S in SocialSection]: string } = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.section, item.label]),
) as { readonly [S in SocialSection]: string };

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/u;

export function parseSocialDestination(destination: string): SocialRoute | null {
  if (destination === 'home' || destination === 'overview') return { section: 'overview' };
  if (destination === 'channels') return { section: 'channels' };
  const [head, id, ...rest] = destination.split('/');
  if (head === 'sources' && rest.length === 0) {
    if (id === undefined) return { section: 'sources' };
    return SEGMENT.test(id) ? { section: 'sources', sourceId: id } : null;
  }
  const workbench = parseWorkbenchDestination(destination);
  if (workbench) return { section: workbench.page === 'catalog' || workbench.page === 'tool' ? 'workbenches' : 'runs' };
  const content = parseContentDestination(destination);
  if (content) return { section: content.page };
  return null;
}

import { isDestination } from '@hq/contracts';
import type { PlanningViewId, WorkDestination } from '../views';

/**
 * Work destinations (spec.hq-social-work#iface.domain-module.001, with T4 P-8): `home` (Board), `glance`, `board`,
 * `board/by-date`, `list`, `calendar`, `calendar/<YYYY-MM>`, `timeline`, `review`, `archive`, `settings` and
 * `item/<itemId>`. `lists` is an alias of `board/by-date`; `item/<itemId>` opens the card detail over the last page;
 * `board/plan/<listBoardId>` is reserved for D-3. Destinations are module-local strings the shell stores per domain;
 * parsing one never writes or starts anything.
 */

export type WorkPage = 'board' | PlanningViewId | 'settings' | 'plan';

export type WorkRoute =
  | { readonly kind: 'page'; readonly page: Exclude<WorkPage, 'plan' | 'calendar'> }
  | { readonly kind: 'page'; readonly page: 'calendar'; readonly month?: string }
  | { readonly kind: 'page'; readonly page: 'plan'; readonly planId: string }
  | { readonly kind: 'item'; readonly itemId: string };

export interface NavItem {
  readonly page: Exclude<WorkPage, 'plan'>;
  readonly label: string;
  readonly destination: string;
  readonly group: 'views' | 'boards' | 'settings';
}

/** Planner order for views; the two boards; then the Planner settings the views follow. */
export const NAV_ITEMS: readonly NavItem[] = [
  { page: 'board', label: 'Status board', destination: 'board', group: 'boards' },
  { page: 'by-date', label: 'By date', destination: 'board/by-date', group: 'boards' },
  { page: 'glance', label: 'Glance', destination: 'glance', group: 'views' },
  { page: 'list', label: 'List', destination: 'list', group: 'views' },
  { page: 'calendar', label: 'Calendar', destination: 'calendar', group: 'views' },
  { page: 'timeline', label: 'Timeline', destination: 'timeline', group: 'views' },
  { page: 'review', label: 'Review', destination: 'review', group: 'views' },
  { page: 'archive', label: 'Archive', destination: 'archive', group: 'views' },
  { page: 'settings', label: 'Planner settings', destination: 'settings', group: 'settings' },
];

export const PAGE_LABELS: { readonly [P in WorkPage]: string } = {
  ...(Object.fromEntries(NAV_ITEMS.map((item) => [item.page, item.label])) as Record<Exclude<WorkPage, 'plan'>, string>),
  plan: 'Weekly plan',
};

const SIMPLE: Readonly<Record<string, Exclude<WorkPage, 'plan' | 'calendar'>>> = {
  home: 'board', board: 'board', 'board/by-date': 'by-date', lists: 'by-date',
  glance: 'glance', list: 'list', timeline: 'timeline', review: 'review', archive: 'archive', settings: 'settings',
};

const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PLAN_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/u;

export function parseWorkDestination(destination: string): WorkRoute | null {
  if (!isDestination(destination)) return null;
  const simple = SIMPLE[destination];
  if (simple) return { kind: 'page', page: simple };
  if (destination === 'calendar') return { kind: 'page', page: 'calendar' };
  const [head, second, third, ...rest] = destination.split('/');
  if (head === 'calendar' && second !== undefined && third === undefined) {
    return MONTH.test(second) ? { kind: 'page', page: 'calendar', month: second } : null;
  }
  if (head === 'item' && second !== undefined && third === undefined) {
    return ITEM_ID.test(second) ? { kind: 'item', itemId: second } : null;
  }
  if (head === 'board' && second === 'plan' && third !== undefined && rest.length === 0) {
    return PLAN_ID.test(third) ? { kind: 'page', page: 'plan', planId: third } : null;
  }
  return null;
}

/** The canonical destination of a page route; `home` and `lists` resolve to `board` and `board/by-date`. */
export function pageDestination(route: Exclude<WorkRoute, { kind: 'item' }>): string {
  switch (route.page) {
    case 'board': return 'board';
    case 'by-date': return 'board/by-date';
    case 'calendar': return route.month ? `calendar/${route.month}` : 'calendar';
    case 'plan': return `board/plan/${route.planId}`;
    default: return route.page;
  }
}

export function itemDestination(itemId: string): string {
  return `item/${itemId}`;
}

/** A view link (for example a Glance status pill) as a destination. Navigation only; it never writes. */
export function viewLinkDestination(to: WorkDestination): string {
  return to.view === 'board' ? 'board' : to.view === 'by-date' ? 'board/by-date' : to.view;
}

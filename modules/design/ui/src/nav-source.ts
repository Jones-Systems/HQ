import type { DomainNavSource, NavNode } from '@hq/ui';
import { DESIGN_NAV_IDS, type DesignLocation, type DesignNavId, type SectionSubRoutes } from '../contract.ts';
import { navTarget } from './focus.ts';
import { formatDestination, isValidSub, itemIdOf, NAV_LABELS, parseDestination, type SubRoutesLookup } from './navigation.ts';
import type { DesignRegistry, RegisteredSection } from './registry.ts';
import { sectionPayloadsFor, type SectionPayloads } from './section-payload.ts';
import type { SessionStore } from './session.ts';

/**
 * Design's navigation as data. Nothing here mounts a section, reads a store, starts a preview or
 * runner, or loads section code: the nodes come from descriptor metadata, and the only state read is the
 * chrome session's remembered section and view. Dynamic Components catalog children, shell registration
 * and the shell's own palette entries are not part of this module.
 */

/** The registry surface the route and navigation code needs. `DesignRegistry` satisfies it. */
export type RouteRegistry = Pick<DesignRegistry, 'byNav' | 'get'>;

/** The lookup `parseDestination` takes, from a registry. */
export function subRoutesLookup(registry: Pick<DesignRegistry, 'get'>): SubRoutesLookup {
  return (sectionId) => registry.get(sectionId)?.subRoutes;
}

/** The view a section shows when nothing was chosen: its first fixed view, or null (item sections choose their first entry). */
export function defaultSub(routes: SectionSubRoutes | undefined): string | null {
  if (routes === undefined || routes.itemPrefix !== undefined) return null;
  return routes.fixed[0]?.id ?? null;
}

export interface DesignRoute {
  /** What the chrome shows: the area, the section, and `sub` only when the route itself named a valid view. */
  readonly location: DesignLocation;
  /** The effective view: explicit valid route view, else the remembered one, else the default. */
  readonly sub: string | null;
  /** True only when the route named the view. A remembered or default view is never explicit. */
  readonly subExplicit: boolean;
}

export interface RouteInput {
  readonly requested: DesignLocation;
  readonly registry: RouteRegistry;
  readonly lastSection: Readonly<Partial<Record<DesignNavId, string>>>;
  /** The view remembered for this project and section, or null. */
  readonly remembered: (sectionId: string) => string | null;
}

/**
 * The one precedence rule: an explicit valid view in the route, else the view remembered for this project
 * and section, else the descriptor default. It only reads; a bare, restored, Back or reference destination
 * is shown with the effective view but never rewritten to carry it.
 */
export function resolveDesignRoute({ requested, registry, lastSection, remembered }: RouteInput): DesignRoute {
  const named = requested.section === null ? undefined : registry.get(requested.section);
  const requestedSection = named !== undefined && named.nav === requested.nav ? named : undefined;
  const sectionId = requestedSection !== undefined
    ? requestedSection.id : navTarget({ sectionsByNav: registry.byNav, lastSection }, requested.nav).section;
  const section = sectionId === null ? undefined : registry.get(sectionId);
  const routes = section?.subRoutes;
  const explicit = requestedSection !== undefined && isValidSub(requested.sub, routes) ? requested.sub : null;
  const stored = section !== undefined && routes !== undefined ? remembered(section.id) : null;
  const rememberedSub = stored !== null && isValidSub(stored, routes) ? stored : null;
  const location: DesignLocation = explicit === null
    ? { nav: requested.nav, section: sectionId } : { nav: requested.nav, section: sectionId, sub: explicit };
  return { location, sub: explicit ?? rememberedSub ?? defaultSub(routes), subExplicit: explicit !== null };
}

/** `Group`, `Group / Section` or `Group / Section / View`, as the hosted page head shows it. */
export function crumbFor(route: DesignRoute, registry: Pick<DesignRegistry, 'get'>): readonly string[] {
  const segments = [NAV_LABELS[route.location.nav]];
  const section = route.location.section === null ? undefined : registry.get(route.location.section);
  if (section === undefined) return segments;
  segments.push(section.title);
  const sub = route.sub;
  if (sub !== null) {
    const fixed = section.subRoutes?.fixed.find((item) => item.id === sub);
    const label = fixed !== undefined ? fixed.title : itemIdOf(sub);
    if (label !== null) segments.push(label);
  }
  return segments;
}

const areaId = (nav: DesignNavId) => `area:${nav}`;
const sectionNodeId = (sectionId: string) => `section:${sectionId}`;
const viewNodeId = (sectionId: string, subId: string) => `view:${sectionId}:${subId}`;

function sectionNode(section: RegisteredSection): NavNode {
  const routes = section.subRoutes;
  const views: NavNode[] = routes !== undefined && routes.navChildren
    ? routes.fixed.map((route) => ({
      id: viewNodeId(section.id, route.id), label: route.title,
      destination: formatDestination({ nav: section.nav, section: section.id, sub: route.id }),
    })) : [];
  return {
    id: sectionNodeId(section.id), label: section.title,
    destination: formatDestination({ nav: section.nav, section: section.id }),
    ...(views.length > 0 ? { children: views } : {}),
  };
}

/**
 * The static node tree: each area (destination: the bare area, which the chrome resolves to its remembered
 * section), its sections, and a section's fixed views when it declares `navChildren`. A Components library
 * level is not invented here; per-entry children are a later, lazily loaded addition.
 */
export function buildDesignNavNodes(registry: Pick<DesignRegistry, 'byNav'>): readonly NavNode[] {
  return DESIGN_NAV_IDS.map((nav): NavNode => {
    const children = registry.byNav[nav].map(sectionNode);
    return {
      id: areaId(nav), label: NAV_LABELS[nav], destination: nav,
      ...(children.length > 0 ? { children } : {}),
    };
  });
}

/** The node the effective route lands on: the fixed-view leaf, else the section (also for item views), else the area. */
export function currentNodeId(route: DesignRoute, registry: Pick<DesignRegistry, 'get'>): string | null {
  const { nav, section } = route.location;
  if (section === null) return areaId(nav);
  const routes = registry.get(section)?.subRoutes;
  const sub = route.sub;
  if (routes !== undefined && routes.navChildren && sub !== null && routes.fixed.some((item) => item.id === sub)) return viewNodeId(section, sub);
  return sectionNodeId(section);
}

export const NAV_SOURCE_LIMITS = Object.freeze({ projects: 32, listenersPerProject: 16, projectId: 128 });

export interface DesignNavSourceOptions {
  readonly registry: RouteRegistry;
  readonly sessions: Pick<SessionStore, 'get' | 'subscribe' | 'sectionHandle'>;
  /** Shares the chrome's payload owner by default (one per session store). */
  readonly payloads?: SectionPayloads;
}

const validProject = (projectId: unknown): projectId is string =>
  typeof projectId === 'string' && projectId.length > 0 && projectId.length <= NAV_SOURCE_LIMITS.projectId;

interface Subscription { readonly notify: () => void }

/**
 * The Design `DomainNavSource`. `getSnapshot` returns one immutable node array built from the descriptors.
 * `currentId` applies the route precedence rule to the project's remembered view. `subscribe` is bounded
 * (32 projects, 16 listeners each), notifies a project's listeners only when that project's remembered
 * section or view changes, holds one session subscription only while something listens, and returns an
 * idempotent cleanup. Invalid or excess subscriptions throw before attaching anything. There is no `activate`:
 * nothing here loads lazily.
 */
export function createDesignNavSource({ registry, sessions, payloads = sectionPayloadsFor(sessions) }: DesignNavSourceOptions): DomainNavSource {
  const nodes = buildDesignNavNodes(registry);
  const lookup = subRoutesLookup(registry);
  const routeFor = (projectId: string, destination: string): DesignRoute => resolveDesignRoute({
    requested: parseDestination(destination, lookup), registry, lastSection: sessions.get(projectId).lastSection,
    remembered: (sectionId) => payloads.view(projectId, sectionId),
  });
  const signature = (projectId: string): string => {
    const views: string[] = [];
    for (const nav of DESIGN_NAV_IDS) {
      for (const section of registry.byNav[nav]) {
        if (section.subRoutes !== undefined) views.push(`${section.id}=${payloads.view(projectId, section.id) ?? ''}`);
      }
    }
    return `${JSON.stringify(sessions.get(projectId).lastSection)}|${views.join(',')}`;
  };

  const listeners = new Map<string, Set<Subscription>>();
  const signatures = new Map<string, string>();
  let release: (() => void) | null = null;

  const onSessionChange = () => {
    for (const [projectId, subscribers] of [...listeners]) {
      const next = signature(projectId);
      if (signatures.get(projectId) === next) continue;
      signatures.set(projectId, next);
      for (const subscription of [...subscribers]) {
        if (!subscribers.has(subscription)) continue;
        // A failing subscriber must not starve the others or the session store that is notifying us.
        try { subscription.notify(); } catch { /* isolated */ }
      }
    }
  };

  return {
    getSnapshot(projectId) {
      if (!validProject(projectId)) throw new RangeError('Design navigation needs a project id of 1–128 characters');
      return nodes;
    },
    currentId(projectId, destination) {
      if (!validProject(projectId) || typeof destination !== 'string') return null;
      return currentNodeId(routeFor(projectId, destination), registry);
    },
    subscribe(projectId, listener) {
      if (!validProject(projectId) || typeof listener !== 'function') {
        throw new RangeError('Design navigation subscribes with a project id of 1–128 characters and a listener');
      }
      const existing = listeners.get(projectId);
      if (existing === undefined && listeners.size >= NAV_SOURCE_LIMITS.projects) throw new RangeError('Too many projects are subscribed to Design navigation');
      if (existing !== undefined && existing.size >= NAV_SOURCE_LIMITS.listenersPerProject) throw new RangeError('Too many subscribers for this project');
      // Everything that can fail has run; from here on the subscription is attached atomically.
      const fresh = existing === undefined ? signature(projectId) : null;
      const subscribers = existing ?? new Set<Subscription>();
      if (existing === undefined && fresh !== null) { listeners.set(projectId, subscribers); signatures.set(projectId, fresh); }
      if (release === null) release = sessions.subscribe(onSessionChange);
      const subscription: Subscription = { notify: listener };
      subscribers.add(subscription);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscribers.delete(subscription);
        if (subscribers.size === 0 && listeners.get(projectId) === subscribers) { listeners.delete(projectId); signatures.delete(projectId); }
        if (listeners.size === 0 && release !== null) { release(); release = null; }
      };
    },
  };
}

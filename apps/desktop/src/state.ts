import { isAppearance, isDestination, isDomainId, type Appearance, type DomainId, type ResolvedAppearance } from '@hq/contracts';

export interface ShellState {
  readonly domain: DomainId;
  readonly destinations: Readonly<Record<DomainId, string>>;
}
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_STATE: ShellState = {
  domain: 'design', destinations: { design: 'home', social: 'home', work: 'home', wiki: 'home' },
};
export const APPEARANCE_KEY = 'hq.appearance.v1';
export const RAIL_KEY = 'hq.rail.v1';
export const RAIL_MIN = 64;
export const RAIL_MAX = 280;
export const RAIL_DEFAULT = 160;
export const RAIL_COMPACT_MAX = 95;
export interface RailState { width: number; expanded: number }
export function cycleAppearance(appearance: Appearance): Appearance {
  return appearance === 'light' ? 'dark' : appearance === 'dark' ? 'system' : 'light';
}
export function resizeRail(state: RailState, value: number): RailState {
  if (!Number.isFinite(value)) return state;
  const width = Math.round(Math.max(RAIL_MIN, Math.min(RAIL_MAX, value)));
  return { width, expanded: width > RAIL_COMPACT_MAX ? width : state.expanded };
}
export function toggleRail(state: RailState): RailState {
  return { ...state, width: state.width <= RAIL_COMPACT_MAX ? state.expanded : RAIL_MIN };
}
export function readRail(storage: StoragePort): RailState {
  const fallback = { width: RAIL_DEFAULT, expanded: RAIL_DEFAULT };
  try {
    const value: unknown = JSON.parse(storage.getItem(RAIL_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return fallback;
    const { width, expanded } = value as Partial<RailState>;
    if (typeof width !== 'number' || !Number.isFinite(width) || width < RAIL_MIN || width > RAIL_MAX
      || typeof expanded !== 'number' || !Number.isFinite(expanded) || expanded <= RAIL_COMPACT_MAX || expanded > RAIL_MAX) return fallback;
    return { width: Math.round(width), expanded: Math.round(expanded) };
  } catch { return fallback; }
}
export const navigationKey = (projectId: string): string => `hq.navigation.v1:${encodeURIComponent(projectId)}`;

export function readAppearance(storage: StoragePort): Appearance {
  try { const value = storage.getItem(APPEARANCE_KEY); return isAppearance(value) ? value : 'system'; }
  catch { return 'system'; }
}

export function resolveAppearance(appearance: Appearance, systemDark: boolean): ResolvedAppearance {
  return appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
}

export function readNavigation(storage: StoragePort, projectId: string): ShellState {
  try {
    const value: unknown = JSON.parse(storage.getItem(navigationKey(projectId)) ?? 'null');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_STATE;
    const candidate = value as Record<string, unknown>;
    const domain = candidate.domain === 'home' ? 'wiki' : candidate.domain;
    if (!isDomainId(domain) || typeof candidate.destinations !== 'object'
      || candidate.destinations === null || Array.isArray(candidate.destinations)) return DEFAULT_STATE;
    const destinations = candidate.destinations as Record<string, unknown>;
    if (!isDestination(destinations.design) || !isDestination(destinations.social) || !isDestination(destinations.work)) return DEFAULT_STATE;
    if (destinations.wiki !== undefined && !isDestination(destinations.wiki)) return DEFAULT_STATE;
    return { domain, destinations: { design: destinations.design, social: destinations.social, work: destinations.work, wiki: destinations.wiki as string ?? 'home' } };
  } catch { return DEFAULT_STATE; }
}

export function persist(storage: StoragePort, key: string, value: string): boolean {
  try { storage.setItem(key, value); return true; } catch { return false; }
}

/** Domain switches and destinations only update local navigation state. */
export function navigate(state: ShellState, domain: DomainId, destination = state.destinations[domain]): ShellState {
  if (!isDomainId(domain) || !isDestination(destination)) return state;
  return { domain, destinations: { ...state.destinations, [domain]: destination } };
}

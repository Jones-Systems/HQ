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
  domain: 'design', destinations: { design: 'home', social: 'home', work: 'home' },
};
export const APPEARANCE_KEY = 'hq.appearance.v1';
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
    if (!isDomainId(candidate.domain) || typeof candidate.destinations !== 'object'
      || candidate.destinations === null || Array.isArray(candidate.destinations)) return DEFAULT_STATE;
    const destinations = candidate.destinations as Record<string, unknown>;
    if (!isDestination(destinations.design) || !isDestination(destinations.social) || !isDestination(destinations.work)) return DEFAULT_STATE;
    return { domain: candidate.domain, destinations: { design: destinations.design, social: destinations.social, work: destinations.work } };
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

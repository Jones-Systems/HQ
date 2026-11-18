import type { ProjectContext } from '@hq/contracts';
import { DEFAULT_FILTERS, isLibraryFilters } from '../content';
import { FEATURE_HQ_BRAND_PROJECT, hasFeature, type Brand, type SocialSession, type WorkspaceSnapshot } from '../core';
import { SOCIAL_SECTIONS, type SocialSection } from './routes';

/** Domain view state in the Social session: the chosen brand and each section's last destination. */
export interface DomainView {
  /** 'all' or a brand ID. */
  readonly brand: string;
  readonly sections: { readonly [S in SocialSection]?: string };
}

const VIEW_KEY = 'domain';
const EMPTY: DomainView = { brand: 'all', sections: {} };

export function domainView(view: Readonly<Record<string, unknown>>): DomainView {
  const stored = view[VIEW_KEY];
  if (typeof stored !== 'object' || stored === null) return EMPTY;
  const { brand, sections } = stored as Partial<DomainView>;
  const kept = typeof sections === 'object' && sections !== null
    ? Object.fromEntries(SOCIAL_SECTIONS.flatMap((section) => (typeof sections[section] === 'string' ? [[section, sections[section]]] : [])))
    : {};
  return { brand: typeof brand === 'string' ? brand : 'all', sections: kept };
}

export function rememberSection(session: SocialSession, section: SocialSection, destination: string): void {
  const view = domainView(session.getState().view);
  if (view.sections[section] === destination) return;
  session.setView(VIEW_KEY, { ...view, sections: { ...view.sections, [section]: destination } });
}

/**
 * Chooses the brand for the domain. It scopes Overview and the project check, and it is applied once to the
 * Library and Calendar brand filters, which stay independently adjustable afterwards.
 */
export function chooseBrand(session: SocialSession, brand: string): void {
  const state = session.getState();
  session.setView(VIEW_KEY, { ...domainView(state.view), brand });
  session.setView('library', { ...(isLibraryFilters(state.view.library) ? state.view.library : DEFAULT_FILTERS), brand });
  session.setView('calendarBrand', brand);
}

/** The selected brand, or null for all brands (including a remembered brand that no longer exists). */
export function selectedBrand(snapshot: WorkspaceSnapshot, brandId: string): Brand | null {
  return snapshot.brands.find((brand) => brand.id === brandId) ?? null;
}

/**
 * Brand ↔ HQ project (RC-7). The mapping is a proposed Social-owned field, keyed by the opaque HQ project
 * ID and readable only when the service advertises `hq-brand-project-v1`. HQ never stores it, never
 * switches project because of it, and never matches by name.
 */
export type ProjectLink =
  | { readonly kind: 'all' }
  | { readonly kind: 'unsupported'; readonly brand: Brand }
  | { readonly kind: 'unlinked'; readonly brand: Brand }
  | { readonly kind: 'same'; readonly brand: Brand }
  | { readonly kind: 'mismatch'; readonly brand: Brand; readonly projectId: string };

export function projectLink(snapshot: WorkspaceSnapshot, brand: Brand | null, context: ProjectContext): ProjectLink {
  if (!brand) return { kind: 'all' };
  if (!hasFeature(snapshot, FEATURE_HQ_BRAND_PROJECT)) return { kind: 'unsupported', brand };
  const projectId = brand.project_id;
  if (typeof projectId !== 'string' || projectId === '') return { kind: 'unlinked', brand };
  return projectId === context.id ? { kind: 'same', brand } : { kind: 'mismatch', brand, projectId };
}

export const SWITCH_PROJECT_REASON = 'Not available: HQ has one fixed project context and no project registry yet, so it cannot switch projects.';

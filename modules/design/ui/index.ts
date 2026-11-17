/**
 * Root-facing entry for Design's chrome (T14). Vite/renderer only: it pulls in
 * the section glob. Root wires `createProductionDesignDomain` into the shell's
 * module slot; framework-free models are importable from ./src directly.
 */
import { buildRegistry } from './src/registry.ts';
import { SECTION_ENTRIES } from './src/registry-glob.ts';
import { createDesignDomain, type DesignDomainOptions } from './src/domain.tsx';
import type { SectionView } from './src/view/SectionOutlet.tsx';

export type * from './contract.ts';
export { createDesignDomain, type DesignDomainOptions } from './src/domain.tsx';
export { buildRegistry, type DesignRegistry, type RegisteredSection } from './src/registry.ts';
export type { SectionView } from './src/view/SectionOutlet.tsx';
// Pure route, payload and navigation-source APIs. None mounts a section or touches a store.
export {
  formatDestination, parseDestination, sameLocation, itemSub, itemIdOf, isValidSub, isFixedSubId, MAX_DESTINATION, ITEM_PREFIX,
  type SubRoutesLookup,
} from './src/navigation.ts';
export {
  createDesignNavSource, resolveDesignRoute, buildDesignNavNodes, currentNodeId, crumbFor, defaultSub, subRoutesLookup, NAV_SOURCE_LIMITS,
  type DesignRoute, type DesignNavSourceOptions, type RouteInput, type RouteRegistry,
} from './src/nav-source.ts';
export {
  createSectionPayloads, sectionPayloadsFor, readPayload, PAYLOAD_VERSION, MAX_VIEW, MAX_MEMORY_VIEWS,
  type SectionPayloads, type PayloadSlot,
} from './src/section-payload.ts';

/** Registry of every `modules/design/<id>/design-module.ts` present at build time. */
export const designRegistry = buildRegistry<SectionView>(SECTION_ENTRIES);

export function createProductionDesignDomain(options: Omit<DesignDomainOptions, 'registry'>) {
  return createDesignDomain({ ...options, registry: designRegistry });
}

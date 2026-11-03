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

/** Registry of every `modules/design/<id>/design-module.ts` present at build time. */
export const designRegistry = buildRegistry<SectionView>(SECTION_ENTRIES);

export function createProductionDesignDomain(options: Omit<DesignDomainOptions, 'registry'>) {
  return createDesignDomain({ ...options, registry: designRegistry });
}

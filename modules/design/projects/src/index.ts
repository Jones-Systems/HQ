/**
 * Projects section entry (T2 / HQD-01).
 *
 * Root composes this section by injecting ports: the HQ shared project
 * registry (or, until then, the labelled provisional local registry), the
 * Design StoragePort, a thumbnail transport and the cached source catalog.
 * Stylesheet: `modules/design/projects/src/projects.css`.
 */
import type { ProjectContext } from '@hq/contracts';
import { createProjectsController, type ProjectsController, type ProjectsPorts } from './controller.ts';
import { projectId, type ProjectId } from './ids.ts';

export * from './contract.ts';
export * from './ids.ts';
export * from './content.ts';
export * from './gallery.ts';
export * from './grid.ts';
export * from './loader.ts';
export * from './session.ts';
export { ProjectContentRepository, ReadOnlyContentError, contentKey, type LoadedContent } from './repository.ts';
export { createProvisionalLocalRegistry, PROVISIONAL_REGISTRY_KEY, PROVISIONAL_REGISTRY_PROVENANCE } from './registry.ts';
export { createProjectsController, DEFAULT_LIMITS, ProjectsController } from './controller.ts';
export type { ActiveProject, EditResult, ProjectsLimits, ProjectsPorts, ProjectsSnapshot } from './controller.ts';
export { ProjectsSection, ProjectSwitcher, type ProjectsSectionProps } from './views/section.ts';
export { GalleryView, type GalleryViewOptions } from './views/gallery.ts';
export { ProjectDetail } from './views/detail.ts';

/** Shell ProjectContext ids are accepted as ProjectIds unchanged; no reformatting or title derivation. */
export function projectIdFromContext(context: ProjectContext): ProjectId {
  return projectId(context.id);
}

/** Creates and starts a controller. Rendering does not wait for the returned promise. */
export function createProjectsSection(ports: ProjectsPorts): { readonly controller: ProjectsController; readonly ready: Promise<void> } {
  const controller = createProjectsController(ports);
  return { controller, ready: controller.start() };
}

import { createElement as h, useEffect, useRef } from 'react';
import type { ProjectsController, ProjectsSnapshot } from '../controller.ts';
import { parseProjectId } from '../ids.ts';
import { ProjectDetail, type ProjectActions } from './detail.ts';
import { GalleryView, type GalleryViewOptions } from './gallery.ts';
import { useProjects } from './hooks.ts';
import { FALLBACK_UI, ProjectsUiContext, type ProjectsUi } from './ui.ts';

const GALLERY_OPTION = '__gallery__';

/** Compact project switcher. Selecting a project only navigates; it never submits or writes. */
export function ProjectSwitcher({ controller, snapshot }: { controller: ProjectsController; snapshot: ProjectsSnapshot }) {
  const { session, registry } = snapshot;
  const value = session.screen === 'project' && session.activeProjectId ? session.activeProjectId : GALLERY_OPTION;
  const known = registry.projects.some((project) => project.id === value);
  return h('label', { className: 'hqp-pick' }, h('span', null, 'Project'),
    h('select', {
      value, 'aria-label': 'Switch project',
      onChange: (event: { target: { value: string } }) => {
        if (event.target.value === GALLERY_OPTION) { controller.backToGallery(); return; }
        const id = parseProjectId(event.target.value);
        if (id) controller.openProject(id);
      },
    },
    h('option', { value: GALLERY_OPTION }, 'All projects'),
    value !== GALLERY_OPTION && !known ? h('option', { value }, `${value} (unresolved)`) : null,
    registry.projects.map((project) => h('option', { key: project.id, value: project.id }, project.name))));
}

export interface ProjectsSectionProps {
  readonly controller: ProjectsController;
  readonly gallery?: GalleryViewOptions;
  /** Where **Open canvas** and **Compare** lead. */
  readonly actions?: ProjectActions;
  /** Shared motion and feedback primitives. Without them the section renders the same markup with no animation or toasts. */
  readonly ui?: ProjectsUi;
}

/** Section root: either the all-projects gallery or the open project's overview and captures. */
export function ProjectsSection({ controller, gallery, actions, ui }: ProjectsSectionProps) {
  const snapshot = useProjects(controller);
  const entered = useRef(false);
  useEffect(() => { entered.current = true; }, []);
  const project = snapshot.session.screen === 'project' ? snapshot.session.activeProjectId : null;
  // Each screen rises in as it is mounted. After the first one, keyboard focus follows to the new page title.
  return h(ProjectsUiContext.Provider, { value: ui ?? FALLBACK_UI },
    h('div', { className: 'hqp-root' },
      h('div', { key: project ?? 'gallery', className: 'hqp-screen hq-enter-rise' },
        project
          ? h(ProjectDetail, { controller, snapshot, focusTitle: entered.current, ...(actions ? { actions } : {}) })
          : h(GalleryView, { controller, snapshot, focusTitle: entered.current, ...(gallery ? { options: gallery } : {}) }))));
}

import { createElement as h, useState } from 'react';
import type { ProjectsController, ProjectsSnapshot } from '../controller.ts';
import { parseProjectId } from '../ids.ts';
import { ProjectDetail } from './detail.ts';
import { GalleryView, type GalleryViewOptions } from './gallery.ts';
import { useProjects } from './hooks.ts';

const GALLERY_OPTION = '__gallery__';

/** Compact project switcher. Selecting a project only navigates; it never submits or writes. */
export function ProjectSwitcher({ controller, snapshot }: { controller: ProjectsController; snapshot: ProjectsSnapshot }) {
  const [name, setName] = useState('');
  const { session, registry } = snapshot;
  const value = session.screen === 'project' && session.activeProjectId ? session.activeProjectId : GALLERY_OPTION;
  const known = registry.projects.some((project) => project.id === value);
  return h('div', { className: 'hqp-switcher' },
    h('label', { className: 'hqp-field' }, h('span', null, 'Project'),
      h('select', {
        value, 'aria-label': 'Switch project',
        onChange: (event: { target: { value: string } }) => {
          if (event.target.value === GALLERY_OPTION) { controller.backToGallery(); return; }
          const id = parseProjectId(event.target.value);
          if (id) controller.openProject(id);
        },
      },
      h('option', { value: GALLERY_OPTION }, 'All projects (gallery)'),
      value !== GALLERY_OPTION && !known ? h('option', { value }, `${value} (unresolved)`) : null,
      registry.projects.map((project) => h('option', { key: project.id, value: project.id }, project.name)))),
    h('form', {
      className: 'hqp-inline-form', 'aria-label': 'New project',
      onSubmit: (event: { preventDefault(): void }) => {
        event.preventDefault();
        if (name.trim() === '') return;
        void controller.createProject(name).then((result) => { if (result.ok) setName(''); });
      },
    },
    h('input', { 'aria-label': 'New project name', placeholder: 'New project name', value: name,
      onChange: (event: { target: { value: string } }) => setName(event.target.value) }),
    h('button', { type: 'submit', disabled: name.trim() === '' }, 'Create')),
    h('span', {
      className: `hqp-badge ${registry.provenance.kind === 'provisional-local' ? 'hqp-badge-warning' : ''}`,
      title: registry.provenance.label, 'data-registry': registry.provenance.kind,
    }, registry.provenance.kind === 'provisional-local' ? 'On this device' : 'HQ registry'),
    registry.status === 'error' ? h('span', { className: 'hqp-badge hqp-badge-warning', role: 'status' }, 'Registry refresh failed; showing last list') : null);
}

export interface ProjectsSectionProps {
  readonly controller: ProjectsController;
  readonly gallery?: GalleryViewOptions;
}

/** Section root: switcher plus either the gallery or the open project. */
export function ProjectsSection({ controller, gallery }: ProjectsSectionProps) {
  const snapshot = useProjects(controller);
  return h('div', { className: 'hqp-root' },
    h('div', { className: 'hqp-toolbar' },
      h('p', { className: 'hqp-registry-note' }, snapshot.registry.provenance.label),
      h(ProjectSwitcher, { controller, snapshot })),
    snapshot.session.screen === 'project'
      ? h(ProjectDetail, { key: snapshot.session.activeProjectId ?? 'none', controller, snapshot })
      : h(GalleryView, { controller, snapshot, ...(gallery ? { options: gallery } : {}) }));
}

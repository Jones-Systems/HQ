import { Menu, type MenuItem } from '@hq/ui';
import type { DomainId, ProjectContext } from '@hq/contracts';
import { ShellIcon } from './icons';
import type { RecentProject } from './recent-projects';

/**
 * What the shell's project context means in each domain, said where the switcher is. Design's source project and
 * reference links follow it; the other domains keep their own grouping, so switching never silently re-scopes them.
 */
export const PROJECT_SCOPE: Readonly<Record<DomainId, string | null>> = {
  design: null,
  social: 'Social is scoped by brand',
  work: 'Work isn’t project-scoped',
  wiki: 'Wiki is scoped by namespace',
};

export interface ProjectSwitcherProps {
  readonly current: ProjectContext;
  /** Projects opened on this device, newest first. */
  readonly recent: readonly RecentProject[];
  /** Always offered, so there is a way home. */
  readonly fallback: RecentProject;
  readonly domain: DomainId;
  readonly onSelect: (project: RecentProject) => void;
  readonly onBrowse: () => void;
}

/** Explicit project context change: recent projects and a way into Design's project list. Opening it changes nothing. */
export function ProjectSwitcher({ current, recent, fallback, domain, onSelect, onBrowse }: ProjectSwitcherProps) {
  const choices = [current, ...recent, fallback].filter((project, index, all) => all.findIndex((other) => other.id === project.id) === index);
  const items: MenuItem[] = [
    ...choices.map((project) => ({ id: `project:${project.id}`, label: project.name, checked: project.id === current.id,
      onSelect: () => { if (project.id !== current.id) onSelect(project); } })),
    { id: 'browse', label: 'Browse Design projects…', onSelect: onBrowse },
  ];
  const scope = PROJECT_SCOPE[domain];
  return (
    <div className="shell-project">
      <Menu className="shell-project-menu" variant="ghost" size="sm" triggerLabel={`Project: ${current.name}`} items={items}
        trigger={<><span className="shell-eyebrow" aria-hidden="true">Project</span><strong>{current.name}</strong><ShellIcon name="chevron" className="shell-chevron" /></>} />
      {scope && <span className="shell-scope-note">{scope}</span>}
    </div>
  );
}

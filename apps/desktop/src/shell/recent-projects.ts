import type { ProjectContext } from '@hq/contracts';
import type { StoragePort } from '../state';

/** Projects this device has opened, newest first. Local UI memory only; it never lists or reads project sources. */
export const RECENT_PROJECTS_KEY = 'hq.recent-projects.v1';
export const RECENT_PROJECTS_LIMIT = 6;

export interface RecentProject { readonly id: string; readonly name: string }

function valid(value: unknown): value is RecentProject {
  if (!value || typeof value !== 'object') return false;
  const { id, name } = value as Record<string, unknown>;
  return typeof id === 'string' && id.length > 0 && id.length <= 512 && typeof name === 'string' && name.trim().length > 0 && name.length <= 512;
}

export function readRecentProjects(storage: StoragePort): readonly RecentProject[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(RECENT_PROJECTS_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter(valid).filter((project) => !seen.has(project.id) && seen.add(project.id)).slice(0, RECENT_PROJECTS_LIMIT)
      .map(({ id, name }) => ({ id, name }));
  } catch { return []; }
}

/** Moves `project` to the front, keeping at most `RECENT_PROJECTS_LIMIT` entries. */
export function rememberProject(recent: readonly RecentProject[], project: ProjectContext): readonly RecentProject[] {
  return [{ id: project.id, name: project.name }, ...recent.filter((entry) => entry.id !== project.id)].slice(0, RECENT_PROJECTS_LIMIT);
}

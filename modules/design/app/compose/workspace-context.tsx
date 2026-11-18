import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ProjectContext } from '@hq/contracts';
import { createDesignWorkspace } from './workspace.ts';
import type { DesignWorkspace } from './workspace.ts';
import { resolveDesignProject } from './active-project.ts';
export const DesignWorkspaceContext = createContext<DesignWorkspace>(createDesignWorkspace(null));
export const useDesignWorkspace = () => useContext(DesignWorkspaceContext);

/** The project this section works on: the one opened in Projects, else the shell context. */
export function useDesignProject(shell: ProjectContext): ProjectContext {
  const { activeProject } = useDesignWorkspace();
  const active = useSyncExternalStore(activeProject.subscribe, activeProject.current, activeProject.current);
  return resolveDesignProject(shell, active);
}

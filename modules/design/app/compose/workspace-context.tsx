import { createContext, useContext } from 'react';
import { createDesignWorkspace } from './workspace.ts';
import type { DesignWorkspace } from './workspace.ts';
export const DesignWorkspaceContext = createContext<DesignWorkspace>(createDesignWorkspace(null));
export const useDesignWorkspace = () => useContext(DesignWorkspaceContext);

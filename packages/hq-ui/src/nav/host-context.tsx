import { createContext, useContext, type ReactNode } from 'react';

const ModuleNavHostContext = createContext(false);

/** An explicit future shell opt-in; creating this provider registers or mounts no domain. */
export function ModuleNavHostProvider({ enabled = false, children }: { readonly enabled?: boolean; readonly children?: ReactNode }) {
  return <ModuleNavHostContext.Provider value={enabled}>{children}</ModuleNavHostContext.Provider>;
}

export function useModuleNavHost(): boolean {
  return useContext(ModuleNavHostContext);
}

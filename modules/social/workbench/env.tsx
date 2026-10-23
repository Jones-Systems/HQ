import { createContext, useContext, type ReactNode } from 'react';
import type { ProjectContext } from '@hq/contracts';
import { useSocialSession, type SocialSession, type SocialSessionState, type SocialWorkspacePort } from '../core';
import type { Visibility } from './polling';

export interface WorkbenchEnvironment {
  readonly port: SocialWorkspacePort;
  readonly context: ProjectContext;
  readonly navigate: (destination: string) => void;
  readonly clock: () => Date;
  readonly visibility?: Visibility;
  readonly pollIntervalMs?: number;
}

const Environment = createContext<WorkbenchEnvironment | null>(null);

export function WorkbenchEnvironmentProvider({ value, children }: { readonly value: WorkbenchEnvironment; readonly children: ReactNode }) {
  return <Environment.Provider value={value}>{children}</Environment.Provider>;
}

export function useWorkbench(): WorkbenchEnvironment & { readonly session: SocialSession; readonly state: SocialSessionState } {
  const environment = useContext(Environment);
  if (!environment) throw new Error('Workbench components need a WorkbenchSection');
  const { session, state } = useSocialSession(environment.context.id);
  return { ...environment, session, state };
}

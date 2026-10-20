import type { SocialWorkspacePort } from '../core';
import { createWorkbenchFixture } from '../workbench/fixtures/examples';

/**
 * The one Social workspace port behind the domain. No Social service is reachable from HQ yet (the
 * service bridge and live adapter are held), so it is the fictional example workspace: in memory, for
 * this window only. Every page mounts this same instance through the same module-level session.
 */
let current: SocialWorkspacePort | null = null;

export function socialWorkspacePort(): SocialWorkspacePort {
  current ??= createWorkbenchFixture().port;
  return current;
}

/** Test and evidence harnesses only: replace the module-level port, or pass null to start a fresh one. */
export function setSocialWorkspacePort(port: SocialWorkspacePort | null): void {
  current = port;
}

export const EXAMPLE_WORKSPACE_NOTE = 'Fictional example workspace, kept in this window until HQ closes. '
  + 'No Social service is connected yet, so nothing is sent anywhere and runs stay queued.';

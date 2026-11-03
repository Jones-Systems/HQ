import { FEATURE_HQ_EDITORIAL_TIMEBOX, FEATURE_HQ_REFERENCES, type SocialWorkspacePort } from '../core';
import { createLiveSocialPort, socialServiceBridge } from '../live';
import { createWorkbenchFixture } from '../workbench/fixtures/examples';

/**
 * The one Social workspace port behind the domain, chosen once per window. A structurally valid
 * `window.hqServices.social` bridge selects the live service; without one, the fictional example
 * workspace (in memory, for this window only) is used and labelled. The choice never changes for the
 * window, so fixture and live sessions never mix, and an unreachable service never falls back to the
 * fixture: it shows the unreachable state. Every page mounts this same instance.
 */
export type SocialWorkspaceSource = 'fixture' | 'live';

export interface SocialWorkspace {
  readonly port: SocialWorkspacePort;
  readonly source: SocialWorkspaceSource;
}

let current: SocialWorkspace | null = null;

/**
 * The fictional example workspace, the one factory every example selection uses (the module default, the
 * shell's unconfigured service and the browser preview). Its brand and sample links point into `projectId`,
 * the HQ project it is shown in, so they read as this project's rather than another's.
 */
export function createExampleWorkspace(projectId?: string): SocialWorkspacePort {
  return createWorkbenchFixture({ features: [FEATURE_HQ_REFERENCES, FEATURE_HQ_EDITORIAL_TIMEBOX], ...(projectId ? { projectId } : {}) }).port;
}

export function selectSocialWorkspace(scope: unknown = globalThis, projectId?: string): SocialWorkspace {
  const bridge = socialServiceBridge(scope);
  return bridge ? { port: createLiveSocialPort(bridge), source: 'live' } : { port: createExampleWorkspace(projectId), source: 'fixture' };
}

/** `projectId` only shapes a first, example selection; the choice then holds for the window. */
export function socialWorkspace(projectId?: string): SocialWorkspace {
  current ??= selectSocialWorkspace(globalThis, projectId);
  return current;
}

export function socialWorkspacePort(): SocialWorkspacePort {
  return socialWorkspace().port;
}

/**
 * Test and evidence harnesses only: replace the module-level port (labelled as `source`, the fixture by
 * default), or pass null so the next use selects again.
 */
export function setSocialWorkspacePort(port: SocialWorkspacePort | null, source: SocialWorkspaceSource = 'fixture'): void {
  current = port ? { port, source } : null;
}

export const EXAMPLE_WORKSPACE_NOTE = 'Fictional example workspace, kept in this window until HQ closes. '
  + 'No Social service is set up yet, so nothing is sent anywhere and runs stay queued.';

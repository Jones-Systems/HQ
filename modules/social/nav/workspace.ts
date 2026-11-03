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

export function selectSocialWorkspace(scope: unknown = globalThis): SocialWorkspace {
  const bridge = socialServiceBridge(scope);
  return bridge ? { port: createLiveSocialPort(bridge), source: 'live' }
    : { port: createWorkbenchFixture({ features: [FEATURE_HQ_REFERENCES, FEATURE_HQ_EDITORIAL_TIMEBOX] }).port, source: 'fixture' };
}

export function socialWorkspace(): SocialWorkspace {
  current ??= selectSocialWorkspace();
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
  + 'No Social service is connected yet, so nothing is sent anywhere and runs stay queued.';

import type { ModulePort } from '@hq/contracts';
import { SocialDomain, socialWorkspacePort } from './nav';

/**
 * The Social domain entry for the HQ module registry (task.social-domain.001). It takes exactly T0's
 * `ModulePort`; its state lives in the module-level Social session for `context.id`, so the shell
 * remounting it on a domain switch restores page, filters, selection, brand and unsaved text.
 * No Social service is reachable yet, so it shows the fictional example workspace, labelled as such.
 */
export function SocialModule(props: ModulePort) {
  return <SocialDomain {...props} port={socialWorkspacePort()} example />;
}

export default SocialModule;

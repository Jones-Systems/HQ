import type { ModulePort } from '@hq/contracts';
import { SocialDomain } from './nav';
import { socialWorkspace } from './nav/workspace';

/**
 * The Social domain entry for the HQ module registry (task.social-domain.001). It takes exactly T0's
 * `ModulePort`; its state lives in the module-level Social session for `context.id`, so the shell
 * remounting it on a domain switch restores page, filters, selection, brand and unsaved text.
 * The workspace source is chosen once per window; only the fictional example workspace is labelled as such.
 */
export function SocialModule(props: ModulePort) {
  const { port, source } = socialWorkspace();
  return <SocialDomain {...props} port={port} example={source === 'fixture'} />;
}

export default SocialModule;

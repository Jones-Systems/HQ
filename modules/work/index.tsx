import type { ModulePort } from '@hq/contracts';
import { WorkDomain } from './nav';

/**
 * The Work domain entry for the HQ module registry (task.work-domain.001). It takes exactly T0's `ModulePort`; its
 * state lives in the module-level Work session for `context.id`, so the shell remounting it on a domain switch
 * restores page, filters, selection, scroll and unsaved text. No Planner service is reachable yet, so it shows the
 * fictional example planning, labelled as such. Nothing in Work can start a run: its Planner port has no execution member.
 */
export function WorkModule(props: ModulePort) {
  return <WorkDomain {...props} />;
}

export default WorkModule;

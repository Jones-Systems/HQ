import type { ModulePort } from '@hq/contracts';
import { WorkDomain } from './nav';

export { setWorkSessionPort, examplePlanner } from './nav/session';

/**
 * The Work domain entry for the HQ module registry (task.work-domain.001). It takes exactly T0's `ModulePort`; its
 * state lives in the module-level Work session for `context.id`, so the shell remounting it on a domain switch
 * restores page, filters, selection, scroll and unsaved text. The shell may inject its Planner before the first
 * session; otherwise the legacy bridge-or-labelled-example selection applies. Live errors never select the example.
 * Nothing in Work can start a run: its Planner port has no execution member.
 */
export function WorkModule(props: ModulePort) {
  return <WorkDomain {...props} />;
}

export default WorkModule;

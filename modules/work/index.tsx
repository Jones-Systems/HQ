import type { ModulePort } from '@hq/contracts';
import { WorkDomain } from './nav';
import type { ReferencePort, ReturnContext } from '@hq/ui';

export interface WorkModuleProps extends ModulePort {
  readonly references?: ReferencePort;
  readonly returnContext?: ReturnContext;
}
export { createWorkReferenceProvider, type ReferenceProvider } from './references';

export { setWorkSessionPort, examplePlanner } from './nav/session';

/**
 * The Work domain entry for the HQ module registry (task.work-domain.001). It structurally extends T0's `ModulePort` with optional reference context; its
 * state lives in the module-level Work session for `context.id`, so the shell remounting it on a domain switch
 * restores page, filters, selection, scroll and unsaved text. The shell may inject its Planner before the first
 * session; otherwise the legacy bridge-or-labelled-example selection applies. Live errors never select the example.
 * Nothing in Work can start a run: its Planner port has no execution member.
 */
export function WorkModule(props: WorkModuleProps) {
  return <WorkDomain {...props} />;
}

export default WorkModule;

import { useEffect, useState, type ReactNode } from 'react';
import type { ModulePort } from '@hq/contracts';
import type { HqServices, ServiceDomain } from '@hq/contracts/services';
import { createWorkExportClient } from './work-export';
import { WorkModule, setWorkSessionPort, examplePlanner } from '@hq/work';
import { SocialDomain } from '../../../../modules/social/nav';
import { createLiveSocialPort } from '../../../../modules/social/live';
import { createWorkbenchFixture } from '../../../../modules/social/workbench/fixtures/examples';
import { bridgeTransport, createPlannerLive } from '../../../../modules/work/live';

type Selection = 'live' | 'example' | 'unavailable';
export const RELOAD_NOTE = 'Endpoint changes apply after HQ reloads.';
/** No endpoint is read here. Only an explicit, valid unconfigured answer selects examples. */
export async function selectService(services: HqServices | undefined, domain: ServiceDomain): Promise<Selection> {
  try {
    if (!services || typeof services[domain]?.call !== 'function' || typeof services.config?.status !== 'function') return 'unavailable';
    const status = await services.config.status(domain);
    if (!status || status.policy !== 'ok' || typeof status.configured !== 'boolean') return 'unavailable';
    if (status.configured) return status.transport === 'https' || status.transport === 'loopback-http' ? 'live' : 'unavailable';
    return status.transport === null ? 'example' : 'unavailable';
  } catch { return 'unavailable'; }
}
function Surface({ domain, selection, children }: { domain: string; selection: Selection; children?: ReactNode }) {
  return <section aria-label={`${domain} service`}>
    <p role="status">{domain}: {selection === 'live' ? 'Live service' : selection === 'example' ? 'Synthetic example' : 'Unavailable — service is not configured correctly'}.</p>
    <p>{RELOAD_NOTE}</p>
    {children}
  </section>;
}
/** One factory per renderer. Promises cache the choice across remounts and concurrent renders. */
export function createServiceDomains(getServices: () => HqServices | undefined) {
  let socialChoice: ReturnType<typeof chooseSocial> | undefined;
  let workChoice: Promise<Selection> | undefined;
  let workExport: ReturnType<typeof createWorkExportClient> | undefined;
  async function chooseSocial() {
    const services = getServices();
    const selection = await selectService(services, 'social');
    const port = selection === 'live' ? createLiveSocialPort(services!.social)
      : selection === 'example' ? createWorkbenchFixture().port : null;
    return { selection, port };
  }
  function Social(props: ModulePort) {
    const [choice, setChoice] = useState<Awaited<ReturnType<typeof chooseSocial>> | null>(null);
    useEffect(() => { let mounted = true; socialChoice ??= chooseSocial(); void socialChoice.then(value => { if (mounted) setChoice(value); }); return () => { mounted = false; }; }, []);
    return choice ? <Surface domain="Social" selection={choice.selection}>{choice.port && <SocialDomain {...props} port={choice.port} example={choice.selection === 'example'} />}</Surface> : <p role="status">Checking Social configuration…</p>;
  }
  async function chooseWork(): Promise<Selection> {
    const services = getServices();
    const selection = await selectService(services, 'work');
    if (selection === 'live') {
      const planner = createPlannerLive(bridgeTransport(services!.work));
      workExport = createWorkExportClient(services!.work);
      setWorkSessionPort(planner.port, { example: false, recovery: planner.recovery });
    } else if (selection === 'example') setWorkSessionPort(examplePlanner(), { example: true });
    return selection;
  }
  function Work(props: ModulePort) {
    const [selection, setSelection] = useState<Selection | null>(null);
    useEffect(() => { let mounted = true; workChoice ??= chooseWork(); void workChoice.then(value => { if (mounted) setSelection(value); }); return () => { mounted = false; }; }, []);
    return selection ? <Surface domain="Work" selection={selection}>{selection !== 'unavailable' && <WorkModule {...props} workExport={workExport} />}</Surface> : <p role="status">Checking Work configuration…</p>;
  }
  return { Social, Work };
}

/** Production wrapper identities, constructed once for this renderer. */
export const SERVICE_DOMAINS = createServiceDomains(() => window.hqServices);

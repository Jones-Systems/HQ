import { useEffect, useState, type ReactNode } from 'react';
import { Skeleton, StateView, StatusIndicator } from '@hq/ui';
import type { PlannerPort, PlannerRecovery } from '../../../../modules/work/core';
import { PortFailure, type SocialWorkspacePort } from '../../../../modules/social/core';
import type { ModulePort } from '@hq/contracts';
import type { HqServices, ServiceConfigStatus, ServiceDomain } from '@hq/contracts/services';
import { createWorkExportClient } from './work-export';
import { WorkModule, setWorkSessionPort, examplePlanner } from '@hq/work';
import { SocialDomain, createExampleWorkspace } from '../../../../modules/social/nav';
import { createLiveSocialPort } from '../../../../modules/social/live';
import { registerWorkDurability } from '../../../../modules/work/core';
import { WORKSPACE_SCOPE } from '../references';
import { bridgeTransport, createPlannerLive, isWorkLocalBridge, workLocalPersistence } from '../../../../modules/work/live';
import { serviceStatus, UNAVAILABLE, type SourceStatus } from './data-source-status';
import { describe, observeSocial, observeWork, useObservedStatus } from './observed-status';
import './service-domain.css';

type Services = Pick<HqServices, 'social' | 'work'> & Partial<Pick<HqServices, 'workLocal'>> & { config: Pick<HqServices['config'], 'status'> };
type Examples = { planner?: () => import('../../../../modules/work/core/port').PlannerPort; social?: (projectId: string) => import('../../../../modules/social/core/port').SocialWorkspacePort };

type Selection = 'live' | 'example' | 'unavailable';
export const RELOAD_NOTE = 'Endpoint changes apply after HQ reloads.';
interface ServiceChoice {
  readonly selection: Selection;
  /** The configuration the choice was made from, as `serviceStatus` words it; never synthesized. */
  readonly config: SourceStatus;
}
/** No endpoint is read here. Only an explicit, valid unconfigured answer selects examples. */
async function readService(services: Services | undefined, domain: ServiceDomain): Promise<ServiceChoice> {
  const unavailable = (status?: ServiceConfigStatus) => ({ selection: 'unavailable' as const, config: status ? serviceStatus(status) : UNAVAILABLE });
  try {
    if (!services || typeof services[domain]?.call !== 'function' || typeof services.config?.status !== 'function') return unavailable();
    const status = await services.config.status(domain);
    if (!status || status.policy !== 'ok' || typeof status.configured !== 'boolean') return unavailable(status ?? undefined);
    if (status.configured) return status.transport === 'https' || status.transport === 'loopback-http' ? { selection: 'live', config: serviceStatus(status) } : unavailable(status);
    return status.transport === null ? { selection: 'example', config: serviceStatus(status) } : unavailable(status);
  } catch { return unavailable(); }
}
export async function selectService(services: Services | undefined, domain: ServiceDomain): Promise<Selection> {
  return (await readService(services, domain)).selection;
}

type DomainName = 'Work' | 'Social';
const openSettings = (domain: DomainName) => window.dispatchEvent(new CustomEvent('hq-open-settings', { detail: { source: domain.toLowerCase() } }));
/** The same `describe` the Sources popover and Settings read, over the configuration this domain was chosen from. */
function StatusStrip({ domain, choice }: { domain: DomainName; choice: ServiceChoice }) {
  const source = domain === 'Work' ? 'work' : 'social';
  const observed = useObservedStatus(source);
  const wording = describe(source, { config: choice.config, observed: choice.selection === 'live' ? observed : null });
  const selection = choice.selection;
  return <div className="service-status" title={RELOAD_NOTE}>
    <span className="service-status-name">{domain}</span>
    <StatusIndicator tone={wording.indicator} label={wording.label} detail={wording.detail || undefined}
      action={{ label: selection === 'example' ? 'Set up' : 'Settings', onAction: () => openSettings(domain) }} />
  </div>;
}
function Surface({ domain, choice, children }: { domain: DomainName; choice: ServiceChoice; children?: ReactNode }) {
  return <section className="service-domain" aria-label={`${domain} service`}>
    <StatusStrip domain={domain} choice={choice} />
    {choice.selection === 'unavailable'
      ? <div className="service-empty hq-enter-rise">
        <StateView state="unavailable" title={`${domain} isn't connected`}
          description={`This build has no reachable ${domain} service configured, so nothing can be read or changed.`}
          action={{ label: 'Open settings', onAction: () => openSettings(domain) }} />
      </div>
      : children}
  </section>;
}

/** The pause before the skeleton appears, so a check that finishes quickly shows nothing. */
export const CONNECTING_DELAY_MS = 150;
/** Shaped like the domain: Work as board columns, Social as library rows. */
function ConnectingSkeleton({ domain }: { domain: DomainName }) {
  return <div className="service-skeleton hq-enter-fade" aria-hidden="true">
    <Skeleton shape="text" width="220px" />
    {domain === 'Work'
      ? <div className="service-skeleton-columns">{[0, 1, 2, 3].map(column => <div key={column} className="service-skeleton-column">
        <Skeleton shape="text" width="60%" /><Skeleton shape="block" height="72px" /><Skeleton shape="block" height="72px" />
      </div>)}</div>
      : <div className="service-skeleton-rows">{[0, 1, 2, 3].map(row => <Skeleton key={row} shape="block" height="56px" />)}</div>}
  </div>;
}
function Connecting({ domain }: { domain: DomainName }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setShown(true), CONNECTING_DELAY_MS); return () => clearTimeout(timer); }, []);
  return <section className="service-domain" aria-label={`${domain} service`} aria-busy="true">
    <div className="service-checking">
      <p className="service-checking-status" role="status">{shown && <span className="hq-enter-fade">Connecting to {domain}…</span>}</p>
      {shown && <ConnectingSkeleton domain={domain} />}
    </div>
  </section>;
}

/** One factory per renderer. Promises cache the choice across remounts and concurrent renders.
 * `workspaceScope` binds reference-first example selection; custom hosts pass their shown workspace id.
 */
export function createServiceDomains(getServices: () => Services | undefined, examples?: Examples, workspaceScope: string = WORKSPACE_SCOPE) {
  let socialChoice: ReturnType<typeof chooseSocial> | undefined;
  let workChoice: ReturnType<typeof chooseWork> | undefined;
  let workMounted: Promise<ServiceChoice> | undefined;
  let workExport: ReturnType<typeof createWorkExportClient> | undefined;
  async function chooseSocial(projectId: string) {
    const services = getServices();
    const choice = await readService(services, 'social');
    const { selection } = choice;
    const port = selection === 'live' ? createLiveSocialPort(observeSocial(services!.social))
      : selection === 'example' ? (examples?.social?.(projectId) ?? createExampleWorkspace(projectId)) : null;
    return { choice, port };
  }
  const getSocial = (projectId: string = workspaceScope) => socialChoice ??= chooseSocial(projectId);
  function Social(props: ModulePort) {
    const [choice, setChoice] = useState<Awaited<ReturnType<typeof chooseSocial>> | null>(null);
    useEffect(() => { let mounted = true; void getSocial(props.context.id).then(value => { if (mounted) setChoice(value); }); return () => { mounted = false; }; }, []);
    return choice ? <Surface domain="Social" choice={choice.choice}>{choice.port && <SocialDomain {...props} port={choice.port} example={choice.choice.selection === 'example'} />}</Surface> : <Connecting domain="Social" />;
  }
  async function chooseWork() {
    const services = getServices();
    const choice = await readService(services, 'work');
    const { selection } = choice;
    let port: PlannerPort | null = null;
    let recovery: PlannerRecovery | null = null;
    if (selection === 'live') {
      const work = observeWork(services!.work);
      const planner = createPlannerLive(bridgeTransport(work));
      workExport = createWorkExportClient(work);
      port = planner.port;
      recovery = planner.recovery;
    } else if (selection === 'example') port = examples?.planner?.() ?? examplePlanner();
    return { choice, port, recovery, workLocal: services?.workLocal };
  }
  const getWork = () => workChoice ??= chooseWork();
  async function mountWork() {
    const { choice, port, recovery, workLocal } = await getWork();
    if (port && choice.selection === 'live' && isWorkLocalBridge(workLocal)) {
      registerWorkDurability(port, workLocalPersistence(workLocal));
    }
    if (port) setWorkSessionPort(port, { example: choice.selection === 'example', ...(recovery ? { recovery } : {}) });
    return choice;
  }
  function Work(props: ModulePort) {
    const [choice, setChoice] = useState<ServiceChoice | null>(null);
    useEffect(() => { let mounted = true; workMounted ??= mountWork(); void workMounted.then(value => { if (mounted) setChoice(value); }); return () => { mounted = false; }; }, []);
    return choice ? <Surface domain="Work" choice={choice}>{choice.selection !== 'unavailable' && <WorkModule {...props} workExport={workExport} />}</Surface> : <Connecting domain="Work" />;
  }
  // Read capabilities share the mounted domain's frozen selection and exact port. Search never mounts a Work session.
  const referenceReads = {
    social: {
      async snapshot() { const { port } = await getSocial(); if (!port) throw new PortFailure({ kind: 'unavailable' }); return port.snapshot(); },
      async run(id: string) { const { port } = await getSocial(); if (!port) throw new PortFailure({ kind: 'unavailable' }); return port.run(id); },
    } satisfies Pick<SocialWorkspacePort, 'snapshot' | 'run'>,
    work: {
      async snapshot() { const { port } = await getWork(); if (!port) throw Error('Work unavailable'); return port.snapshot(); },
    } satisfies Pick<PlannerPort, 'snapshot'>,
  };
  return { Social, Work, referenceReads };
}

/** Production wrapper identities, constructed once for this renderer. */
export const SERVICE_DOMAINS = createServiceDomains(() => window.hqServices);

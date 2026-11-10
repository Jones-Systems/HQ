import { useEffect, useState, type ReactNode } from 'react';
import { Skeleton, StateView, StatusIndicator } from '@hq/ui';
import type { ModulePort } from '@hq/contracts';
import type { HqServices, ServiceConfigStatus, ServiceDomain } from '@hq/contracts/services';
import { createWorkExportClient } from './work-export';
import { WorkModule, setWorkSessionPort, examplePlanner } from '@hq/work';
import { SocialDomain } from '../../../../modules/social/nav';
import { createLiveSocialPort } from '../../../../modules/social/live';
import { createWorkbenchFixture } from '../../../../modules/social/workbench/fixtures/examples';
import { FEATURE_HQ_EDITORIAL_TIMEBOX, FEATURE_HQ_REFERENCES } from '../../../../modules/social/core';
import { bridgeTransport, createPlannerLive } from '../../../../modules/work/live';
import { serviceStatus, UNAVAILABLE, type SourceStatus } from './data-source-status';
import { describe, observeSocial, observeWork, useObservedStatus } from './observed-status';
import './service-domain.css';

type Services = Pick<HqServices, 'social' | 'work'> & { config: Pick<HqServices['config'], 'status'> };
type Examples = { planner?: () => import('../../../../modules/work/core/port').PlannerPort; social?: () => import('../../../../modules/social/core/port').SocialWorkspacePort };

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

/** One factory per renderer. Promises cache the choice across remounts and concurrent renders. */
export function createServiceDomains(getServices: () => Services | undefined, examples?: Examples) {
  let socialChoice: ReturnType<typeof chooseSocial> | undefined;
  let workChoice: Promise<ServiceChoice> | undefined;
  let workExport: ReturnType<typeof createWorkExportClient> | undefined;
  async function chooseSocial() {
    const services = getServices();
    const choice = await readService(services, 'social');
    const { selection } = choice;
    const port = selection === 'live' ? createLiveSocialPort(observeSocial(services!.social))
      : selection === 'example' ? (examples?.social?.() ?? createWorkbenchFixture({ features: [FEATURE_HQ_REFERENCES, FEATURE_HQ_EDITORIAL_TIMEBOX] }).port) : null;
    return { choice, port };
  }
  function Social(props: ModulePort) {
    const [choice, setChoice] = useState<Awaited<ReturnType<typeof chooseSocial>> | null>(null);
    useEffect(() => { let mounted = true; socialChoice ??= chooseSocial(); void socialChoice.then(value => { if (mounted) setChoice(value); }); return () => { mounted = false; }; }, []);
    return choice ? <Surface domain="Social" choice={choice.choice}>{choice.port && <SocialDomain {...props} port={choice.port} example={choice.choice.selection === 'example'} />}</Surface> : <Connecting domain="Social" />;
  }
  async function chooseWork(): Promise<ServiceChoice> {
    const services = getServices();
    const choice = await readService(services, 'work');
    const { selection } = choice;
    if (selection === 'live') {
      const work = observeWork(services!.work);
      const planner = createPlannerLive(bridgeTransport(work));
      workExport = createWorkExportClient(work);
      setWorkSessionPort(planner.port, { example: false, recovery: planner.recovery });
    } else if (selection === 'example') setWorkSessionPort(examples?.planner?.() ?? examplePlanner(), { example: true });
    return choice;
  }
  function Work(props: ModulePort) {
    const [choice, setChoice] = useState<ServiceChoice | null>(null);
    useEffect(() => { let mounted = true; workChoice ??= chooseWork(); void workChoice.then(value => { if (mounted) setChoice(value); }); return () => { mounted = false; }; }, []);
    return choice ? <Surface domain="Work" choice={choice}>{choice.selection !== 'unavailable' && <WorkModule {...props} workExport={workExport} />}</Surface> : <Connecting domain="Work" />;
  }
  return { Social, Work };
}

/** Production wrapper identities, constructed once for this renderer. */
export const SERVICE_DOMAINS = createServiceDomains(() => window.hqServices);

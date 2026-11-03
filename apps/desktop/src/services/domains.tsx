import { useEffect, useState, type ReactNode } from 'react';
import { Skeleton, StateView, StatusIndicator } from '@hq/ui';
import type { ModulePort } from '@hq/contracts';
import type { HqServices, ServiceDomain } from '@hq/contracts/services';
import { createWorkExportClient } from './work-export';
import { WorkModule, setWorkSessionPort, examplePlanner } from '@hq/work';
import { SocialDomain } from '../../../../modules/social/nav';
import { createLiveSocialPort } from '../../../../modules/social/live';
import { createWorkbenchFixture } from '../../../../modules/social/workbench/fixtures/examples';
import { FEATURE_HQ_EDITORIAL_TIMEBOX, FEATURE_HQ_REFERENCES } from '../../../../modules/social/core';
import { bridgeTransport, createPlannerLive } from '../../../../modules/work/live';
import { serviceStatus } from './data-source-status';
import { describeObservation, observeSocial, observeWork, useObservedStatus, type ObservedWording } from './observed-status';
import './service-domain.css';

type Services = Pick<HqServices, 'social' | 'work'> & { config: Pick<HqServices['config'], 'status'> };
type Examples = { planner?: () => import('../../../../modules/work/core/port').PlannerPort; social?: () => import('../../../../modules/social/core/port').SocialWorkspacePort };

type Selection = 'live' | 'example' | 'unavailable';
export const RELOAD_NOTE = 'Endpoint changes apply after HQ reloads.';
/** No endpoint is read here. Only an explicit, valid unconfigured answer selects examples. */
export async function selectService(services: Services | undefined, domain: ServiceDomain): Promise<Selection> {
  try {
    if (!services || typeof services[domain]?.call !== 'function' || typeof services.config?.status !== 'function') return 'unavailable';
    const status = await services.config.status(domain);
    if (!status || status.policy !== 'ok' || typeof status.configured !== 'boolean') return 'unavailable';
    if (status.configured) return status.transport === 'https' || status.transport === 'loopback-http' ? 'live' : 'unavailable';
    return status.transport === null ? 'example' : 'unavailable';
  } catch { return 'unavailable'; }
}

type DomainName = 'Work' | 'Social';
const openSettings = (domain: DomainName) => window.dispatchEvent(new CustomEvent('hq-open-settings', { detail: { source: domain.toLowerCase() } }));
/** With nothing observed yet the strip says only what configuration says; real traffic then replaces it. */
function configuredWording(selection: Selection): ObservedWording {
  const status = serviceStatus(selection === 'example' ? { configured: false, policy: 'ok', transport: null } : selection === 'live' ? { configured: true, policy: 'ok', transport: 'https' } : undefined);
  const [label = status.text, detail = ''] = status.text.split(' · ');
  return { tone: selection === 'example' ? 'info' : selection === 'live' ? 'neutral' : 'unavailable', label, detail };
}
function StatusStrip({ domain, selection }: { domain: DomainName; selection: Selection }) {
  const observed = useObservedStatus(domain === 'Work' ? 'work' : 'social');
  const wording = selection === 'live' && observed ? describeObservation(observed) : configuredWording(selection);
  return <div className="service-status" title={RELOAD_NOTE}>
    <span className="service-status-name">{domain}</span>
    <StatusIndicator tone={wording.tone} label={wording.label} detail={wording.detail || undefined}
      action={{ label: selection === 'example' ? 'Set up' : 'Settings', onAction: () => openSettings(domain) }} />
  </div>;
}
function Surface({ domain, selection, children }: { domain: DomainName; selection: Selection; children?: ReactNode }) {
  return <section className="service-domain" aria-label={`${domain} service`}>
    <StatusStrip domain={domain} selection={selection} />
    {selection === 'unavailable'
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
  let workChoice: Promise<Selection> | undefined;
  let workExport: ReturnType<typeof createWorkExportClient> | undefined;
  async function chooseSocial() {
    const services = getServices();
    const selection = await selectService(services, 'social');
    const port = selection === 'live' ? createLiveSocialPort(observeSocial(services!.social))
      : selection === 'example' ? (examples?.social?.() ?? createWorkbenchFixture({ features: [FEATURE_HQ_REFERENCES, FEATURE_HQ_EDITORIAL_TIMEBOX] }).port) : null;
    return { selection, port };
  }
  function Social(props: ModulePort) {
    const [choice, setChoice] = useState<Awaited<ReturnType<typeof chooseSocial>> | null>(null);
    useEffect(() => { let mounted = true; socialChoice ??= chooseSocial(); void socialChoice.then(value => { if (mounted) setChoice(value); }); return () => { mounted = false; }; }, []);
    return choice ? <Surface domain="Social" selection={choice.selection}>{choice.port && <SocialDomain {...props} port={choice.port} example={choice.selection === 'example'} />}</Surface> : <Connecting domain="Social" />;
  }
  async function chooseWork(): Promise<Selection> {
    const services = getServices();
    const selection = await selectService(services, 'work');
    if (selection === 'live') {
      const work = observeWork(services!.work);
      const planner = createPlannerLive(bridgeTransport(work));
      workExport = createWorkExportClient(work);
      setWorkSessionPort(planner.port, { example: false, recovery: planner.recovery });
    } else if (selection === 'example') setWorkSessionPort(examples?.planner?.() ?? examplePlanner(), { example: true });
    return selection;
  }
  function Work(props: ModulePort) {
    const [selection, setSelection] = useState<Selection | null>(null);
    useEffect(() => { let mounted = true; workChoice ??= chooseWork(); void workChoice.then(value => { if (mounted) setSelection(value); }); return () => { mounted = false; }; }, []);
    return selection ? <Surface domain="Work" selection={selection}>{selection !== 'unavailable' && <WorkModule {...props} workExport={workExport} />}</Surface> : <Connecting domain="Work" />;
  }
  return { Social, Work };
}

/** Production wrapper identities, constructed once for this renderer. */
export const SERVICE_DOMAINS = createServiceDomains(() => window.hqServices);

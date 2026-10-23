import { useEffect, useId, useRef, useState } from 'react';
import type { ModulePort } from '@hq/contracts';
import { Button, Dialog, Splitter, StateView, type ReferencePort, type ReturnContext } from '@hq/ui';
import { BrandManager, SocialContent } from '../content';
import { useSocialSession, workspaceSnapshot, type SocialWorkspacePort } from '../core';
import { WorkbenchSection, type Visibility } from '../workbench';
import { chooseBrand, domainView, projectLink, rememberSection, selectedBrand } from './brand';
import { BrandSwitcher, ProjectMismatchBanner } from './BrandSwitcher';
import { Channels } from './Channels';
import { isOffline } from './freshness';
import { Overview } from './Overview';
import { NAV_ITEMS, SECTION_LABELS, parseSocialDestination, type NavItem } from './routes';
import { Sources } from './Sources';
import { EXAMPLE_WORKSPACE_NOTE } from './workspace';
import './nav.css';

export interface SocialDomainProps extends ModulePort {
  readonly references?: ReferencePort;
  readonly returnContext?: ReturnContext;
  readonly port: SocialWorkspacePort;
  /** Label the workspace as the fictional example workspace. */
  readonly example?: boolean;
  readonly now?: () => Date;
  readonly visibility?: Visibility;
  readonly pollIntervalMs?: number;
}

const SIDEBAR_KEY = 'hq.social.sidebar.v1';
const DEFAULT_SIDEBAR = { width: 216, restored: 216 };

function readSidebar(): typeof DEFAULT_SIDEBAR {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && 'width' in saved && 'restored' in saved
      && typeof saved.width === 'number' && Number.isFinite(saved.width)
      && (saved.width === 0 || saved.width >= 80) && saved.width <= 320
      && typeof saved.restored === 'number' && Number.isFinite(saved.restored)
      && saved.restored >= 80 && saved.restored <= 320) {
      return { width: saved.width, restored: saved.restored };
    }
  } catch { /* Storage can be unavailable; layout remains usable for this mount. */ }
  return DEFAULT_SIDEBAR;
}

const PAUSED = 'The Social service is unreachable. Changes are paused; your text is kept.';

/**
 * The Social domain (task.social-domain.001): secondary navigation, brand switcher, project check and
 * the section for the current destination. Content state lives in the Social session for `context.id`;
 * sidebar size is a local display preference. Rendering and navigating make no execution call.
 */
export function SocialDomain({ context, destination, navigate, port, example = false, now, visibility, pollIntervalMs, references, returnContext }: SocialDomainProps) {
  const { state, session } = useSocialSession(context.id);
  const id = useId();
  const domain = useRef<HTMLDivElement>(null);
  const [sidebar, setSidebar] = useState(readSidebar);
  useEffect(() => {
    // CSSOM property assignment supports the shell CSP without injecting a style element.
    domain.current?.style.setProperty('--sd-side-width', `${sidebar.width}px`);
    try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebar)); }
    catch { /* A blocked preference store must not prevent resizing. */ }
  }, [sidebar]);
  const resizeSidebar = (size: number) => setSidebar((current) => {
    const width = size < 80 ? 0 : Math.min(320, size);
    return { width, restored: width > 0 ? width : current.restored };
  });
  const toggleSidebar = () => setSidebar((current) => ({
    ...current, width: current.width === 0 ? current.restored : 0,
  }));
  const [managing, setManaging] = useState(false);
  const route = parseSocialDestination(destination);
  const view = domainView(state.view);
  const load = state.workspace;
  const snapshot = workspaceSnapshot(load);
  const brand = snapshot ? selectedBrand(snapshot, view.brand) : null;
  const link = snapshot ? projectLink(snapshot, brand, context) : null;
  const section = route?.section;

  // One content-class read per session; a remount reuses the session's snapshot.
  useEffect(() => {
    if (session.getState().workspace.status === 'idle') void session.load(port);
  }, [session, port]);

  useEffect(() => {
    if (section) rememberSection(session, section, destination);
  }, [session, section, destination]);

  const open = (item: NavItem) => navigate(item.section === section ? item.destination : view.sections[item.section] ?? item.destination);

  const navList = (group: NavItem['group']) => (
    <ul>
      {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
        <li key={item.section}>
          <button type="button" className="sd-nav-item" aria-current={item.section === section ? 'page' : undefined} onClick={() => open(item)}>
            <span>{item.label}</span>
            {item.tag && <span className="sd-tag">{item.tag}</span>}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="sd-domain" ref={domain}>
      <aside className="sd-side" aria-label="Social workspace" hidden={sidebar.width === 0}>
        <BrandSwitcher
          snapshot={snapshot} value={brand ? brand.id : 'all'} link={link}
          onChoose={(value) => chooseBrand(session, value)} onManage={() => setManaging(true)}
        />
        <nav className="sd-nav" aria-label="Social">
          {navList('main')}
          <p className="sd-group" id={`${id}-later`}>Later</p>
          <div role="group" aria-labelledby={`${id}-later`}>{navList('later')}</div>
        </nav>
      </aside>
      <div className="sd-divider" onKeyDownCapture={(event) => {
        if (sidebar.width === 0 && event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          toggleSidebar();
        }
      }}>
        <Splitter label="Social sidebar" value={sidebar.width} min={0} max={320}
          onResize={resizeSidebar} onToggle={toggleSidebar} />
      </div>

      <div className="sd-main">
        {returnContext && <p role="note">Reference opened from {returnContext.label}.</p>}
        {example && (
          <details className="sd-example"><summary>Example data</summary><p role="note">{EXAMPLE_WORKSPACE_NOTE}</p></details>
        )}
        {link && <ProjectMismatchBanner link={link} projectName={context.name} />}
        {!route ? (
          <StateView
            state="unavailable" title="This Social page doesn't exist"
            description={`“${destination}” isn't a Social page. Nothing was changed.`}
            action={{ label: 'Open overview', onAction: () => navigate('overview') }}
          />
        ) : route.section === 'overview' ? (
          snapshot ? <Overview snapshot={snapshot} load={load} editors={state.editors} brand={brand} navigate={navigate} now={now ?? (() => new Date())} onCheck={() => void session.load(port)} />
            : load.status === 'error' ? (
              <StateView
                state={load.error.kind === 'unavailable' ? 'unavailable' : 'error'}
                title={load.error.kind === 'unavailable' ? 'The Social service is unreachable' : 'The workspace could not be loaded'}
                description="Nothing was changed. Unsaved text in open drafts is kept for this session."
                action={{ label: 'Try again', onAction: () => void session.load(port) }}
              />
            ) : <StateView state="loading" title="Loading the Social workspace…" />
        ) : route.section === 'sources' ? <Sources sourceId={route.sourceId} navigate={navigate} />
          : route.section === 'channels' ? <Channels navigate={navigate} />
            : route.section === 'workbenches' || route.section === 'runs' ? (
              <WorkbenchSection
                port={port} context={context} destination={destination} navigate={navigate}
                {...(now ? { clock: now } : {})} {...(visibility ? { visibility } : {})} {...(pollIntervalMs ? { pollIntervalMs } : {})}
              />
            ) : (
              <>
                <h1 className="hq-sr-only">{SECTION_LABELS[route.section]}</h1>
                <SocialContent references={references} port={port} projectId={context.id} destination={destination} navigate={navigate} {...(now ? { now } : {})} />
              </>
            )}
      </div>

      <Dialog
        open={managing && Boolean(snapshot)} onClose={() => setManaging(false)} title="Manage brands"
        actions={<Button variant="secondary" onClick={() => setManaging(false)}>Close</Button>}
      >
        {snapshot && <BrandManager session={session} port={port} snapshot={snapshot} paused={isOffline(load) ? PAUSED : undefined} />}
      </Dialog>
    </div>
  );
}

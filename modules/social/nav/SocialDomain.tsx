import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ModulePort } from '@hq/contracts';
import { Button, Dialog, InlineNotice, Skeleton, Splitter, StateView, useToast, type ReferencePort, type ReturnContext } from '@hq/ui';
import { BrandManager, SocialContent } from '../content';
import { isActiveRun, isDirty, useSocialSession, workspaceSnapshot, type PortError, type SocialSessionState, type SocialWorkspacePort, type WorkspaceLoad } from '../core';
import { PageHeader, SocialFrameContext, SocialIcon, SyncPill, shortTime, type SocialFrame, type SocialIconName } from '../ui';
import { DELIVERED_LIMITS, WorkbenchSection, type Visibility } from '../workbench';
import { chooseBrand, domainView, projectLink, rememberSection, selectedBrand } from './brand';
import { BrandSwitcher, ProjectMismatchBanner } from './BrandSwitcher';
import { Channels } from './Channels';
import { isOffline } from './freshness';
import { Overview } from './Overview';
import { NAV_ITEMS, SECTION_LABELS, parseSocialDestination, type NavItem, type SocialSection } from './routes';
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

const NAV_ICONS: { readonly [S in SocialSection]: SocialIconName } = {
  overview: 'overview', sources: 'sources', workbenches: 'workbenches', library: 'library', calendar: 'calendar', runs: 'runs', channels: 'channels',
};

/** Sections whose page reads the workspace; the frame shows their first load in place of the page. */
const NEEDS_WORKSPACE: ReadonlySet<SocialSection> = new Set(['overview', 'workbenches', 'runs', 'library', 'calendar']);

/**
 * The connection state last announced per project, kept across remounts so switching domains never repeats a
 * notice. A toast is raised only when the read moves between reachable and unreachable.
 */
const announced = new Map<string, 'ok' | 'offline' | 'stale'>();

function readState(load: WorkspaceLoad): 'ok' | 'offline' | 'stale' | null {
  if (load.status === 'ready') return 'ok';
  if (load.status === 'error') return load.error.kind === 'unavailable' ? 'offline' : 'stale';
  return null;
}

function useConnectionNotices(projectId: string, load: WorkspaceLoad, check: () => void): void {
  const toast = useToast();
  const state = readState(load);
  const last = workspaceSnapshot(load);
  useEffect(() => {
    if (state === null) return;
    const previous = announced.get(projectId);
    announced.set(projectId, state);
    if (previous === state) return;
    const id = `social-connection:${projectId}`;
    if (state === 'ok') {
      // Only a recovery is news; the first successful read is not.
      if (previous === 'offline' || previous === 'stale') toast.show({ id, tone: 'success', title: 'Social workspace synced again', meta: last ? `Synced ${shortTime(last.observedAt)}` : undefined });
      return;
    }
    if (!last) return; // Nothing has loaded: the page itself explains the failure.
    // Only an unreachable service pauses changes; a failed refresh keeps them working on the data shown.
    toast.show({
      id, tone: 'warning',
      title: state === 'offline' ? 'The Social service is unreachable' : 'The Social workspace could not be refreshed',
      description: state === 'offline'
        ? `Showing what loaded at ${shortTime(last.observedAt)}. Saving, calendar moves and runs are paused; your text is kept.`
        : `Showing what loaded at ${shortTime(last.observedAt)}.`,
      meta: 'Checking again never resends a run',
      action: { label: 'Check again', onAction: check },
    });
  }, [projectId, state, last, toast, check]);
}

/** Sidebar counts: active drafts in the brand, and runs (with a live dot while any is queued or running). */
function useNavCounts(state: SocialSessionState, brandId: string | null): Partial<Record<SocialSection, { count?: number; active?: boolean; dirty?: boolean }>> {
  const { workspace, editors } = state;
  const snapshot = workspaceSnapshot(workspace);
  return useMemo(() => {
    if (!snapshot) return {};
    const drafts = snapshot.content.filter((draft) => draft.archived === 0 && (!brandId || draft.brand_id === brandId)).length;
    const dirty = Object.entries(editors).some(([key, editor]) => !key.startsWith('change:') && (isDirty(editor) || editor.status !== 'editing'));
    return {
      library: { count: drafts, dirty },
      runs: { count: snapshot.runs.length, active: snapshot.runs.some(isActiveRun) },
    };
  }, [snapshot, editors, brandId]);
}

/** Opens HQ Settings on the Social data source; the shell listens for this event. */
function openSocialSettings(): void {
  window.dispatchEvent(new CustomEvent('hq-open-settings', { detail: { source: 'social' } }));
}

/**
 * A page that reads the workspace before its first snapshot. Loading shows the page's shape. If the read fails,
 * the page keeps its frame and says so inline, with the recovery next to it: nothing has loaded, so there is
 * nothing to keep, but navigation, the pill and pages that don't need the workspace stay usable.
 */
function FirstLoad({ load, onRetry, title, example }: { readonly load: WorkspaceLoad; readonly onRetry: () => void; readonly title: string; readonly example: boolean }) {
  // Hold a failure through *Try again* so the page doesn't flip back to its loading shape while the read runs.
  const [held, setHeld] = useState<PortError | null>(null);
  useEffect(() => {
    if (load.status === 'error') setHeld(load.error);
    else if (load.status !== 'loading') setHeld(null);
  }, [load]);
  const failed = load.status === 'error' ? load.error : load.status === 'loading' ? held : null;
  const retrying = load.status === 'loading' && held !== null;
  const offline = failed?.kind === 'unavailable';
  return (
    <div className="sx-page sd-first-load" aria-busy={failed ? undefined : 'true'} data-failed={failed ? '' : undefined}>
      <header className="sx-head">
        <div className="sx-head-row">
          <div className="sx-head-text">
            {/* While loading there is no h1: the heading arrives with the page. A failed page is a page. */}
            {failed ? <h1>{title}</h1> : <p className="sd-first-load-title" aria-hidden="true">{title}</p>}
            <p className="sx-head-description sd-loading-text">{failed ? 'Nothing has loaded yet.' : 'Loading the Social workspace…'}</p>
          </div>
          <div className="sx-head-actions"><SyncPill /></div>
        </div>
        {failed && (
          <InlineNotice
            tone={offline ? 'warning' : 'danger'}
            title={offline ? 'The Social service is unreachable' : 'The workspace could not be loaded'}
            actions={[
              { label: 'Try again', onAction: onRetry, busy: retrying, busyLabel: 'Trying again…' },
              ...(example ? [] : [{ label: 'Open Social settings', onAction: openSocialSettings }]),
            ]}
          >
            Nothing was changed. Unsaved text in open drafts is kept for this session. This page fills in as soon as the
            workspace answers.
          </InlineNotice>
        )}
      </header>
      <div className="sx-grid sd-first-load-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="sx-panel">
            <Skeleton shape="text" width="40%" />
            <Skeleton shape="text" lines={3} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The Social domain (task.social-domain.001): secondary navigation, brand switcher, project check and the section
 * for the current destination, inside one frame that tells every page how current the workspace is. Content state
 * lives in the Social session for `context.id`; sidebar size is a local display preference. Rendering and
 * navigating make no execution call.
 */
export function SocialDomain({ context, destination, navigate, port, example = false, now, visibility, pollIntervalMs, references, returnContext }: SocialDomainProps) {
  const { state, session } = useSocialSession(context.id);
  const id = useId();
  const domain = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
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
  const counts = useNavCounts(state, brand?.id ?? null);

  const check = useMemo(() => () => { void session.load(port); }, [session, port]);
  const frame = useMemo<SocialFrame>(() => ({
    load, example, onCheck: check, limits: DELIVERED_LIMITS, exampleNote: EXAMPLE_WORKSPACE_NOTE,
  }), [load, example, check]);
  useConnectionNotices(context.id, load, check);

  // One content-class read per session; a remount reuses the session's snapshot.
  useEffect(() => {
    if (session.getState().workspace.status === 'idle') void session.load(port);
  }, [session, port]);

  useEffect(() => {
    if (section) rememberSection(session, section, destination);
  }, [session, section, destination]);

  // A new section starts at its top, wherever the last one was scrolled to (pages within a section keep theirs). When
  // the control that changed it left with the old page, focus lands on the new page's heading, not the document.
  const shownSection = useRef(section);
  useEffect(() => {
    if (shownSection.current === section) return;
    shownSection.current = section;
    const area = main.current;
    if (!area) return;
    area.scrollTop = 0;
    let frame = 0;
    let tries = 0;
    const land = () => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const heading = area.querySelector<HTMLElement>('h1[tabindex]');
      if (heading) heading.focus({ preventScroll: true });
      else if (++tries < 30) frame = requestAnimationFrame(land);
    };
    land();
    return () => cancelAnimationFrame(frame);
  }, [section]);

  // N starts a new draft from anywhere in Social, unless the user is typing.
  useEffect(() => {
    const root = domain.current;
    if (!root) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'n' && event.key !== 'N') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog')) return;
      event.preventDefault();
      navigate('library/new');
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [navigate]);

  const open = (item: NavItem) => navigate(item.section === section ? item.destination : view.sections[item.section] ?? item.destination);

  const navList = (group: NavItem['group']) => (
    <ul>
      {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
        const extra = counts[item.section];
        return (
          <li key={item.section}>
            <button type="button" className="sd-nav-item" title={item.label} aria-current={item.section === section ? 'page' : undefined} onClick={() => open(item)}>
              <SocialIcon name={NAV_ICONS[item.section]} className="sd-nav-icon" />
              <span className="sd-nav-label">{item.label}</span>
              {item.tag && <span className="sd-tag">{item.tag}</span>}
              {extra?.dirty && <span className="sd-nav-dirty" aria-hidden="true" title="Unsaved changes" />}
              {extra?.active && <span className="sd-nav-live" aria-hidden="true" title="A run is in progress" />}
              {extra?.count !== undefined && <span className="sd-nav-count" aria-hidden="true">{extra.count}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  const needsWorkspace = route ? NEEDS_WORKSPACE.has(route.section) : false;

  return (
    <SocialFrameContext.Provider value={frame}>
      <div className="sd-domain" ref={domain}>
        <aside className="sd-side" aria-label="Social workspace" hidden={sidebar.width === 0}>
          <BrandSwitcher
            snapshot={snapshot} value={brand ? brand.id : 'all'} link={link} unavailable={load.status === 'error'}
            onChoose={(value) => chooseBrand(session, value)} onManage={() => setManaging(true)}
          />
          <nav className="sd-nav" aria-label="Social">
            {navList('main')}
            <p className="sd-group" id={`${id}-later`}>Later</p>
            <div role="group" aria-labelledby={`${id}-later`}>{navList('later')}</div>
          </nav>
          <p className="sd-side-foot">
            {example ? 'Example workspace. Analysis runs on data you supply; nothing is collected or posted.'
              : 'Analysis runs on data you supply. Nothing is collected or posted automatically.'}
          </p>
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

        <div className="sd-main" ref={main} aria-busy={needsWorkspace && !snapshot ? true : undefined}>
          {returnContext && <p className="sd-return" role="note"><SocialIcon name="link" />Reference opened from {returnContext.label}.</p>}
          {link && <ProjectMismatchBanner link={link} projectName={context.name} />}
          <div className="sd-view hq-enter-rise" key={section ?? 'missing'}>
            {!route ? (
              <StateView
                state="unavailable" title="This Social page doesn't exist"
                description={`“${destination}” isn't a Social page. Nothing was changed.`}
                action={{ label: 'Open overview', onAction: () => navigate('overview') }}
              />
            ) : needsWorkspace && !snapshot ? (
              <FirstLoad load={load} onRetry={check} title={SECTION_LABELS[route.section]} example={example} />
            ) : route.section === 'overview' ? (
              snapshot && (
                <Overview
                  snapshot={snapshot} load={load} editors={state.editors} brand={brand} navigate={navigate} now={now ?? (() => new Date())}
                  projectId={context.id} {...(references ? { references } : {})}
                />
              )
            ) : route.section === 'sources' ? <Sources sourceId={route.sourceId} navigate={navigate} projectId={context.id} {...(now ? { now } : {})} />
              : route.section === 'channels' ? <Channels navigate={navigate} />
                : route.section === 'workbenches' || route.section === 'runs' ? (
                  <WorkbenchSection
                    port={port} context={context} destination={destination} navigate={navigate}
                    {...(now ? { clock: now } : {})} {...(visibility ? { visibility } : {})} {...(pollIntervalMs ? { pollIntervalMs } : {})}
                  />
                ) : (
                  <div className="sx-page sx-page--wide">
                    <PageHeader
                      title={SECTION_LABELS[route.section]}
                      description={route.section === 'calendar'
                        ? 'Your editorial plan. Drag a draft to a day, or select it to move it with the keyboard.'
                        : 'Drafts for every brand and channel, ready to shape, plan and check.'}
                      actions={<Button variant="primary" onClick={() => navigate('library/new')}><SocialIcon name="plus" />New draft</Button>}
                    />
                    <SocialContent references={references} port={port} projectId={context.id} destination={destination} navigate={navigate} {...(now ? { now } : {})} />
                  </div>
                )}
          </div>
        </div>

        <Dialog
          open={managing && Boolean(snapshot)} onClose={() => setManaging(false)} title="Manage brands"
          actions={<Button variant="secondary" onClick={() => setManaging(false)}>Close</Button>}
        >
          {snapshot && <BrandManager session={session} port={port} snapshot={snapshot} paused={isOffline(load) ? PAUSED : undefined} />}
        </Dialog>
      </div>
    </SocialFrameContext.Provider>
  );
}

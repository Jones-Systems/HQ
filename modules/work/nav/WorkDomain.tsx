import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ModulePort } from '@hq/contracts';
import { navigateWithTransition, Splitter, StateView, type ReferencePort, type ReturnContext } from '@hq/ui';
import { StatusBoard, SyncBanners, WorkToasts } from '../board';
import { DraftsPanel, QuickCapture, useCaptureShortcut } from '../capture';
import {
  DEFAULT_SETTINGS, isLive, reviewBucketsFor, useWorkState,
  type DateInput, type Settings, type Status,
} from '../core';
import { CardDetail } from '../detail';
import { WorkExport, type WorkExportPort } from '../export';
import { PLANNING_VIEW_IDS, PlanningViews, PROJECT_NOTE, type PlanningViewId, type WorkDestination } from '../views';
import {
  itemDestination, PAGE_LABELS, pageDestination, parseWorkDestination, viewLinkDestination,
  type WorkPage, type WorkRoute,
} from './routes';
import { useWorkUi, workSession, type WorkUi } from './session';
import { useCssVars, useRemembered } from '../views/env';
import { TopBarStatus } from '../board/SyncStatus';
import { BarStatus, ExampleMarker, FilterBar } from './TopBar';
import { WorkNav } from './WorkNav';
import { DetailSheet, SHEET_BREAKPOINT } from './DetailSheet';
import { useWidth } from './useWidth';
import { useNumberKeys } from './keys';
import { ToolbarCapture } from './ToolbarCapture';
import { workUndoHandler } from './undo';
import '../theme';
import '../board/feedback.css';
import './nav.css';

export { EXAMPLE_NOTE } from './TopBar';

/**
 * PlanningViews subscribes to the same store and would poll it a second time; the domain's own subscription polls,
 * so the views' interval is set beyond any session (setInterval's maximum delay).
 */
const VIEWS_POLL_MS = 2_147_483_647;

export interface WorkDomainProps extends ModulePort {
  readonly workExport?: WorkExportPort;
  readonly references?: ReferencePort;
  readonly returnContext?: ReturnContext;
  /** Clock for "today" in the Planner display zone; tests pin it. */
  readonly now?: () => Date;
  readonly pollMs?: number;
}

type PageRoute = Exclude<WorkRoute, { kind: 'item' }>;

const isPlanningView = (page: WorkPage): page is PlanningViewId => (PLANNING_VIEW_IDS as readonly string[]).includes(page);

/**
 * The Work domain (task.work-domain.001): secondary navigation, filters, toolbar capture and the page for the current
 * destination, with the card detail over it. Everything it keeps lives in the module-level Work session for
 * `context.id`, so the shell remounting it on a domain switch restores page, filters, selection, scroll and unsaved
 * text. Remounting, navigating and switching pages read nothing new and write nothing; a focused card-detail field is
 * still saved by the detail panel itself when focus leaves it. The Planner port has no execution member at all.
 */
export function WorkDomain({ context, destination, navigate, now, pollMs, references, returnContext, workExport }: WorkDomainProps) {
  const session = workSession(context.id);
  const { store, feedback, drafts, detail, ui } = session;
  const state = useWorkState(store, pollMs === undefined ? {} : { pollMs });
  const view = useWorkUi(ui);
  const rootRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [navWidth, setNavWidth] = useRemembered('work.nav.width', 184);
  const [restoreWidth, setRestoreWidth] = useRemembered('work.nav.restore', 184);
  const [detailWidth, setDetailWidth] = useRemembered('work.detail.width', 360);
  const [detailRestore, setDetailRestore] = useRemembered('work.detail.restore', 360);
  const areaRef = useRef<HTMLDivElement>(null);
  const areaWidth = useWidth(areaRef);
  const sheet = areaWidth > 0 && areaWidth < SHEET_BREAKPOINT;
  const go = useCallback((to: string) => navigateWithTransition(() => navigate(to)), [navigate]);
  useNumberKeys(rootRef, go);
  const live = state.items.filter(isLive);
  const buckets = reviewBucketsFor(live, state.confirmed?.settings ?? DEFAULT_SETTINGS, now?.() ?? new Date());
  const inboxCount = live.filter((item) => item.status === 'inbox').length;
  const reviewCount = Object.values(buckets).reduce((sum, items) => sum + items.length, 0);
  const counts = { board: { count: inboxCount, words: `${inboxCount} in Inbox` }, review: { count: reviewCount, words: `${reviewCount} review prompts` } };
  useCssVars(rootRef, { '--wd-nav-width': `${navWidth}px`, '--wd-detail-width': `${detailWidth}px` });
  const resizeDetail = (size: number) => {
    const next = size < 112 ? 0 : Math.max(240, Math.min(640, size));
    if (next > 0) setDetailRestore(next);
    setDetailWidth(next);
  };
  const resizeNav = (size: number) => {
    const next = size < 112 ? 0 : Math.min(280, size);
    if (next > 0) setRestoreWidth(next);
    setNavWidth(next);
  };
  const [dialog, setDialog] = useState<Status | null>(null);

  const route = parseWorkDestination(destination);
  const lastRoute = parseWorkDestination(view.lastPage);
  const page: PageRoute | null = route?.kind === 'page' ? route
    : route?.kind === 'item' ? (lastRoute?.kind === 'page' ? lastRoute : { kind: 'page', page: 'board' }) : null;
  const itemId = route?.kind === 'item' ? route.itemId : null;
  const pageKey = page ? pageDestination(page) : 'unknown';

  // The last page is session state, so `item/<id>` opens over it. Remembering it never writes.
  useEffect(() => {
    if (route?.kind === 'page' && ui.getState().lastPage !== pageKey) ui.update({ lastPage: pageKey });
  }, [route?.kind, pageKey, ui]);

  const openCapture = useCallback(() => setDialog('inbox'), []);
  useCaptureShortcut(rootRef, openCapture);

  const links = {
    openItem: (id: string) => navigate(itemDestination(id)),
    editDate: (id: string) => navigate(itemDestination(id)),
    capture: ({ date }: { date?: DateInput }) => {
      ui.setCapture({ date: date ?? null });
      captureRef.current?.focus();
    },
    navigate: (to: WorkDestination) => navigate(viewLinkDestination(to)),
  };

  let body: ReactNode;
  if (!page) {
    body = (
      <StateView
        state="unavailable" title="This Work page doesn't exist"
        description={`“${destination}” isn't a Work page. Nothing was changed.`}
        action={{ label: 'Open the board', onAction: () => navigate('board') }}
      />
    );
  } else if (page.page === 'board') {
    body = (
      <>
        <SyncBanners store={store} state={state} />
        <StatusBoard
          store={store} state={state} feedback={feedback} filters={view.filters} {...(now ? { now } : {})}
          selectedId={itemId} onOpenItem={links.openItem} onCapture={setDialog}
          collapsed={view.collapsed} onCollapsedChange={(collapsed) => ui.update({ collapsed })}
        />
      </>
    );
  } else if (isPlanningView(page.page)) {
    body = <PlanningViews store={store} view={page.page} feedback={feedback} filters={view.filters} {...(now ? { now } : {})} pollMs={VIEWS_POLL_MS} {...links} />;
  } else if (page.page === 'settings') {
    body = <><SettingsPage settings={state.confirmed?.settings ?? null} loading={state.confirmed === null} /><WorkExport key={context.id} port={workExport} /></>;
  } else {
    body = (
      <StateView
        state="unavailable" title="Proposed — not available"
        description="Weekly plan boards (editable lists) are deferred (D-3). Nothing was changed. Use Plan week to arrange existing planning dates."
        action={{ label: 'Open Plan week', onAction: () => go('board/week') }}
      />
    );
  }

  const cardDetail = itemId ? <CardDetail
    projectId={context.id} {...(references ? { references } : {})}
    store={store} state={state} feedback={feedback} itemId={itemId} detail={detail} {...(now ? { now } : {})}
    onClose={() => navigate(view.lastPage)}
  /> : null;

  return (
    <TopBarStatus>
    <div className="wd-domain work-ui" ref={rootRef} onKeyDown={workUndoHandler(store, feedback)}>
      <aside className="wd-side" aria-label="Work workspace" hidden={navWidth === 0}>
        <WorkNav current={page?.page ?? null} counts={counts} onOpen={(item) => go(item.destination)} />
      </aside>
      <div className="wd-nav-divider">
        <Splitter label="Work navigation width" value={navWidth} min={0} max={280} onResize={resizeNav} onToggle={() => resizeNav(navWidth === 0 ? restoreWidth : 0)} />
        {navWidth === 0 && <button type="button" className="wd-nav-restore" aria-label="Show Work navigation" title="Show Work navigation" onClick={() => resizeNav(restoreWidth)}>›</button>}
      </div>
      <div className="wd-main">
        {returnContext && <p className="hq-meta">From {returnContext.label} · {returnContext.to.domain} · {returnContext.to.destination}</p>}
        <h1 className="hq-sr-only">Work · {page ? PAGE_LABELS[page.page] : 'Unknown page'}</h1>
        <div className="wd-topbar">
          <ToolbarCapture ref={captureRef} session={session} state={state} {...(now ? { now } : {})} onMore={openCapture} />
          {page && page.page !== 'settings' && page.page !== 'plan' && <FilterBar ui={ui} filters={view.filters} state={state} />}
          <div className="wd-topbar-end"><BarStatus store={store} state={state} />{session.example && <ExampleMarker />}</div>
        </div>
        <DraftsPanel drafts={drafts} store={store} feedback={feedback} />
        <div ref={areaRef} className={`wd-workarea${itemId && !sheet ? ' wd-workarea--detail' : ''}`}>
          <div className="wd-page" inert={Boolean(itemId && sheet)}><ScrollArea ui={ui} pageKey={pageKey} ready={state.confirmed !== null}>{body}</ScrollArea></div>
          {itemId && !sheet && <>
            <div className="wd-detail-divider">
              <Splitter label="Work detail width" value={detailWidth} min={0} max={640} side="end" onResize={resizeDetail} onToggle={() => resizeDetail(detailWidth === 0 ? detailRestore : 0)} />
              {detailWidth === 0 && <button type="button" className="wd-detail-restore" aria-label="Show item details" title="Show item details" onClick={() => resizeDetail(detailRestore)}>‹</button>}
            </div>
            <div className="wd-detail-host" hidden={detailWidth === 0}>
            {cardDetail}
            </div>
          </>}
          {itemId && sheet && <DetailSheet label="Card details" onClose={() => navigate(view.lastPage)}>{cardDetail}</DetailSheet>}
        </div>
      </div>

      <QuickCapture
        open={dialog !== null} initialStatus={dialog ?? 'inbox'} onClose={() => setDialog(null)}
        store={store} state={state} feedback={feedback} drafts={drafts} {...(now ? { now } : {})}
      />
      <WorkToasts store={store} state={state} feedback={feedback} />
    </div>
    </TopBarStatus>
  );
}

/** Restores each page's owned scroll offsets after its content is available. */

function ScrollArea({ ui, pageKey, ready, children }: { ui: WorkUi; pageKey: string; ready: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const restored = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Set on the work area, so the card detail beside the page shares the same height.
    const area = el.closest<HTMLElement>('.wd-workarea') ?? el;
    const fit = () => {
      area.style.setProperty('--wd-scroll-max', `${area.clientHeight}px`);
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(area);
    window.addEventListener('resize', fit);
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit); };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ready || restored.current === pageKey) return;
    restored.current = pageKey;
    // A page never visited starts at the top: the scroller element is shared, so it would keep the last page's offset.
    const saved = ui.getState().scroll[pageKey] ?? { top: 0, left: 0, columns: 0 };
    el.scrollTop = saved.top;
    el.scrollLeft = saved.left;
    const columns = el.querySelector<HTMLElement>('.work-columns');
    if (columns) columns.scrollLeft = saved.columns;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const record = () => {
      if (restored.current !== pageKey) return;
      const columns = el.querySelector<HTMLElement>('.work-columns');
      ui.rememberScroll(pageKey, { top: el.scrollTop, left: el.scrollLeft, columns: columns?.scrollLeft ?? 0 });
    };
    el.addEventListener('scroll', record, { capture: true, passive: true });
    return () => el.removeEventListener('scroll', record, { capture: true });
  }, [ui, pageKey]);

  return <div className="wd-scroll" ref={ref} data-page={pageKey}>{children}</div>;
}

function SettingsPage({ settings, loading }: { settings: Settings | null; loading: boolean }) {
  if (loading) return <StateView state="loading" title="Loading the Planner…" />;
  const shown = settings ?? DEFAULT_SETTINGS;
  return (
    <section className="wd-settings" aria-labelledby="wd-settings-title">
      <h2 id="wd-settings-title">Planner settings</h2>
      <p className="wd-note" role="note">{PROJECT_NOTE}</p>
      <dl>
        <dt>Week starts on</dt><dd>{shown.week_start === 'mon' ? 'Monday' : 'Sunday'}</dd>
        <dt>Display time zone</dt><dd>{shown.default_tz}</dd>
        <dt>Quiet after</dt><dd>{shown.stale_days} days</dd>
      </dl>
      <p className="hq-meta">Read from the Planner settings. The By date board, Calendar and Glance group weeks by this week start. HQ does not change these settings yet.</p>
    </section>
  );
}


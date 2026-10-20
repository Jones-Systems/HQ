import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ModulePort } from '@hq/contracts';
import { Button, StateView, Toast, ToastRegion, type ReferencePort, type ReturnContext } from '@hq/ui';
import { StatusBoard, SyncBanners, undoFromToast, useFeedback, WorkToasts, type Feedback } from '../board';
import { DraftsPanel, QuickCapture, useCaptureShortcut } from '../capture';
import {
  activeFilterCount, areasOf, DEFAULT_SETTINGS, EMPTY_FILTERS, HORIZONS, KINDS, useWorkState,
  type DateInput, type Filters, type Settings, type Status, type WorkState, type WorkStore,
} from '../core';
import { CardDetail } from '../detail';
import { WorkExport, type WorkExportPort } from '../export';
import { PLANNING_VIEW_IDS, PlanningViews, PROJECT_NOTE, type PlanningViewId, type WorkDestination } from '../views';
import {
  itemDestination, NAV_ITEMS, PAGE_LABELS, pageDestination, parseWorkDestination, viewLinkDestination,
  type NavItem, type WorkPage, type WorkRoute,
} from './routes';
import { useWorkUi, workSession, type WorkUi } from './session';
import { ToolbarCapture } from './ToolbarCapture';
import { workUndoHandler } from './undo';
import './nav.css';

/** The honest label on the example Planner: fictional, in memory, for this session only. */
export const EXAMPLE_NOTE = 'Fictional example planning, kept in memory for this session only. No Planner is connected, nothing is saved beyond this session, and nothing starts.';

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
    body = <PlanningViews store={store} view={page.page} filters={view.filters} {...(now ? { now } : {})} pollMs={VIEWS_POLL_MS} {...links} />;
  } else if (page.page === 'settings') {
    body = <><SettingsPage settings={state.confirmed?.settings ?? null} loading={state.confirmed === null} /><WorkExport key={context.id} port={workExport} /></>;
  } else {
    body = (
      <StateView
        state="unavailable" title="Proposed — not available"
        description="Weekly plan boards (editable lists) are deferred (D-3). Nothing was changed. The By date board shows dated planning today."
        action={{ label: 'Open By date', onAction: () => navigate('board/by-date') }}
      />
    );
  }

  return (
    <div className="wd-domain work-ui" ref={rootRef} onKeyDown={workUndoHandler(store, feedback)}>
      <aside className="wd-side" aria-label="Work workspace">
        <WorkNav current={page?.page ?? null} onOpen={(item) => navigate(item.destination)} />
      </aside>

      <div className="wd-main">
        {returnContext && <p className="hq-meta">From {returnContext.label} · {returnContext.to.domain} · {returnContext.to.destination}</p>}
        <h1 className="hq-sr-only">Work · {page ? PAGE_LABELS[page.page] : 'Unknown page'}</h1>
        {session.example && (
          <p className="wd-example" role="note"><span className="wd-tag">Example data</span> {EXAMPLE_NOTE}</p>
        )}
        <div className="wd-toolbar">
          <ToolbarCapture ref={captureRef} session={session} state={state} {...(now ? { now } : {})} onMore={openCapture} />
          {page && page.page !== 'settings' && page.page !== 'plan' && <FilterBar ui={ui} filters={view.filters} state={state} />}
        </div>
        <DraftsPanel drafts={drafts} store={store} feedback={feedback} />
        <div className={`wd-workarea${itemId ? ' wd-workarea--detail' : ''}`}>
          <ScrollArea ui={ui} pageKey={pageKey} ready={state.confirmed !== null}>{body}</ScrollArea>
          {itemId && (
            <CardDetail
              projectId={context.id} {...(references ? { references } : {})}
              store={store} state={state} feedback={feedback} itemId={itemId} detail={detail} {...(now ? { now } : {})}
              onClose={() => navigate(view.lastPage)}
            />
          )}
        </div>
      </div>

      <QuickCapture
        open={dialog !== null} initialStatus={dialog ?? 'inbox'} onClose={() => setDialog(null)}
        store={store} state={state} feedback={feedback} drafts={drafts} {...(now ? { now } : {})}
      />
      {page && isPlanningView(page.page)
        ? <FeedbackToasts store={store} state={state} feedback={feedback} />
        : <WorkToasts store={store} state={state} feedback={feedback} />}
    </div>
  );
}

function WorkNav({ current, onOpen }: { current: WorkPage | null; onOpen(item: NavItem): void }) {
  const id = useId();
  const group = (name: NavItem['group'], label: string) => (
    <>
      <p className="wd-group" id={`${id}-${name}`}>{label}</p>
      <ul aria-labelledby={`${id}-${name}`}>
        {NAV_ITEMS.filter((item) => item.group === name).map((item) => (
          <li key={item.page}>
            <button type="button" className="wd-nav-item" aria-current={item.page === current ? 'page' : undefined} onClick={() => onOpen(item)}>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
  return (
    <nav className="wd-nav" aria-label="Work">
      {group('boards', 'Boards')}
      {group('views', 'Views')}
      {group('settings', 'Planner')}
    </nav>
  );
}

/** Board-level filters. Area filters by the Planner's label; it is never a project and never switches one. */
function FilterBar({ ui, filters, state }: { ui: WorkUi; filters: Filters; state: WorkState }) {
  const id = useId();
  const set = (patch: Partial<Filters>) => ui.update({ filters: { ...filters, ...patch } });
  const areas = areasOf(state.items);
  const count = activeFilterCount(filters);
  return (
    <div className="wd-filters" role="group" aria-label="Filter planning">
      <label className="wd-filter" htmlFor={`${id}-q`}>
        <span className="work-field-label">Search</span>
        <input id={`${id}-q`} className="work-input" type="search" value={filters.q} onChange={(event) => set({ q: event.target.value })} />
      </label>
      <label className="wd-filter" htmlFor={`${id}-kind`}>
        <span className="work-field-label">Kind</span>
        <select id={`${id}-kind`} className="work-input" value={filters.kind} onChange={(event) => set({ kind: event.target.value })}>
          <option value="">Any</option>
          {KINDS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <label className="wd-filter" htmlFor={`${id}-horizon`}>
        <span className="work-field-label">Horizon</span>
        <select id={`${id}-horizon`} className="work-input" value={filters.horizon} onChange={(event) => set({ horizon: event.target.value })}>
          <option value="">Any</option>
          {HORIZONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          <option value="__none">Not set</option>
        </select>
      </label>
      <div className="wd-filter">
        <label className="work-field-label" htmlFor={`${id}-area`}>Area label</label>
        <select id={`${id}-area`} className="work-input" value={filters.area} onChange={(event) => set({ area: event.target.value })} aria-describedby={`${id}-area-hint`}>
          <option value="">Any</option>
          {areas.map((area) => <option key={area} value={area}>{area}</option>)}
          <option value="__none">No label</option>
        </select>
        <span className="hq-sr-only" id={`${id}-area-hint`}>A Planner label, not a project.</span>
      </div>
      {count > 0 && <Button size="sm" variant="ghost" onClick={() => ui.update({ filters: EMPTY_FILTERS })}>Clear filters ({count})</Button>}
    </div>
  );
}

/**
 * The page's own scroller. Its position is recorded per page in the session and put back once the page has content
 * after a remount, together with the board's horizontal column scroll. The height comes through CSSOM because the app
 * CSP forbids inline style attributes.
 */
function ScrollArea({ ui, pageKey, ready, children }: { ui: WorkUi; pageKey: string; ready: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const restored = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Set on the work area, so the card detail beside the page shares the same height.
    const area = el.parentElement ?? el;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      area.style.setProperty('--wd-scroll-max', `${Math.max(320, Math.round(window.innerHeight - top - 24))}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
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

/** Toasts for board, detail and capture actions on a planning view page, whose own banners already show notices. */
function FeedbackToasts({ store, state, feedback }: { store: WorkStore; state: WorkState; feedback: Feedback }) {
  const toasts = useFeedback(feedback);
  const live = new Set(state.undo.map((entry) => entry.id));
  return (
    <ToastRegion label="Work card notifications">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          className={`work-toast work-toast--${toast.tone}`}
          message={toast.message}
          meta={toast.meta}
          action={toast.undoId && live.has(toast.undoId) ? { label: 'Undo', onAction: () => void undoFromToast(store, feedback, toast) } : undefined}
          onDismiss={() => feedback.dismiss(toast.id)}
        />
      ))}
    </ToastRegion>
  );
}


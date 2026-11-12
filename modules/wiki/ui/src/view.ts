// The Wiki view: a sidebar, a top bar (navigation, breadcrumb, search, history) and one scrolling content column over
// home / search / reader / topics / disambiguation. The root owns navigation, keyboard shortcuts and focus; views only
// read through the injected WikiService.

import { createElement as h, useEffect, useId, useReducer, useRef, useState, type ComponentType, type ReactElement } from 'react';
import { NAMESPACES, type PageKey, type WikiNamespace, type WikiService } from '../../contract/src/index.ts';
import { createWikiCache, type WikiCache } from './cache.ts';
import { buildCrumbs, isTextTarget, shownOf, useSessionTick } from './chrome.ts';
import { Disambiguation } from './common.ts';
import type { ViewCtx, WikiHostAffordances, WikiToastPort } from './context.ts';
import { HOME, pageDestination, resolveDestination, searchDestination, topicsDestination } from './destinations.ts';
import { Notice } from './feedback.ts';
import { currentEntry, initialNav, navReducer, shellRequestFor, type HistoryEntry } from './history.ts';
import { pageId } from './resources.ts';
import { createWikiSession, type WikiSession } from './session.ts';
import { usableQuery } from './search-data.ts';
import { useWikiStatus } from './status.ts';
import { HomeView } from './view-home.ts';
import { ReaderView } from './view-reader.ts';
import { SearchView } from './view-search.ts';
import { Sidebar } from './view-sidebar.ts';
import { TopBar } from './view-topbar.ts';
import { TopicsView } from './view-topics.ts';

export interface WikiViewProps {
  /** `home`, `page/<ns>/<path>`, `search?q=…` or `topics/<ns>`. Anything else shows home with a notice. */
  readonly destination: string;
  readonly appearance: 'light' | 'dark';
  /** A request that the shell persist this destination. The view keeps its own in-session history regardless. */
  readonly navigate: (destination: string) => void;
}

interface WikiRuntime {
  readonly service: WikiService;
  readonly cache: WikiCache;
  readonly session: WikiSession;
  readonly toast: WikiToastPort | null;
  readonly openSettings: (() => void) | null;
}

/** How long a restored scroll position keeps waiting for the content to grow tall enough. */
const RESTORE_MS = 1500;
/** How long focus waits for a newly shown view's heading to appear. */
const HEADING_MS = 4000;

const scrollId = (index: number, entry: HistoryEntry): string => `${index}\u0000${entry.destination}\u0000${entry.ambiguity?.label ?? ''}`;

function WikiRoot(props: WikiViewProps & { readonly runtime: WikiRuntime }): ReactElement {
  const { runtime } = props;
  const { service, session } = runtime;
  const destination = typeof props.destination === 'string' ? props.destination : '';
  // History lives in the session so switching domains away and back keeps it.
  const [nav, dispatch] = useReducer(navReducer, destination, (initial: string) => session.nav ?? initialNav(initial));
  useEffect(() => {
    session.nav = nav;
  }, [session, nav]);
  const [repos, setReposState] = useState<readonly WikiNamespace[]>(() => session.repos);
  const setRepos = (update: (previous: readonly WikiNamespace[]) => readonly WikiNamespace[]): void =>
    setReposState((previous) => {
      const next = update(previous);
      session.repos = next;
      return next;
    });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState<{ readonly message: string; readonly index: number } | null>(null);
  const uid = useId();
  const sidebarId = `${uid}-sidebar`;
  const rootEl = useRef<HTMLDivElement | null>(null);
  const main = useRef<HTMLElement | null>(null);
  const refs = { input: useRef<HTMLInputElement | null>(null), browse: useRef<HTMLButtonElement | null>(null), history: useRef<HTMLButtonElement | null>(null) };
  useSessionTick(session);

  // Re-sync with the shell: a changed `destination` prop is either the echo of our own request or an external navigation.
  const entry = currentEntry(nav);
  const here = scrollId(nav.index, entry);
  const hereRef = useRef(here);
  hereRef.current = here;
  if (nav.seenProp !== destination) {
    if (main.current !== null) session.saveScroll(here, main.current.scrollTop);
    dispatch({ type: 'prop', destination });
  }

  const request = (target: HistoryEntry): void => {
    const shell = shellRequestFor(nav, target);
    if (shell === null) return;
    try {
      props.navigate(shell);
    } catch {
      // The shell refusing a request must not break in-session navigation.
    }
  };
  const remember = (): number => {
    const top = main.current === null ? 0 : main.current.scrollTop;
    session.saveScroll(here, top);
    return top;
  };
  const go = (target: HistoryEntry, replace = false): void => {
    const top = remember();
    request(target);
    // A fresh entry starts at the top; a replaced one (search as you type) keeps its place.
    session.saveScroll(scrollId(replace ? nav.index : nav.index + 1, target), replace ? top : 0);
    dispatch({ type: replace ? 'replace' : 'go', entry: target });
  };
  const goTo = (target: string | null, replace = false): void => {
    if (target === null) setNotice({ message: 'That link cannot be opened.', index: nav.index });
    else go({ destination: target }, replace);
  };
  const move = (index: number): void => {
    const target = nav.entries[index];
    if (target === undefined) return;
    remember();
    request(target);
    dispatch({ type: 'jump', index });
  };

  const ctx: ViewCtx = {
    service,
    cache: runtime.cache,
    session,
    toast: runtime.toast,
    openSettings: runtime.openSettings,
    openHome: () => go({ destination: HOME }),
    openPage: (key: PageKey) => goTo(pageDestination(key)),
    openSearch: (query: string, options?: { readonly replace?: boolean }) => goTo(searchDestination(query), options?.replace === true),
    openTopics: (namespace: WikiNamespace) => goTo(topicsDestination(namespace)),
    openAmbiguity: (label, candidates) => go({ destination: entry.destination, ambiguity: { label, candidates } }),
  };
  const status = useWikiStatus(ctx);

  const resolved = resolveDestination(entry.destination);
  const shown = shownOf(entry);
  const contentKey = entry.ambiguity !== undefined ? `ambiguity:${nav.index}` : resolved.view === 'page' ? `page:${pageId(resolved.key)}` : resolved.view === 'topics' ? `topics:${resolved.namespace}` : resolved.view;
  const onSearchPage = entry.ambiguity === undefined && resolved.view === 'search';

  // The search field and the results page share one draft. It follows the destination when that changes, except when
  // the change is the page recording what was typed.
  const [draft, setDraft] = useState(() => (shown.view === 'search' ? shown.query : ''));
  const [syncedTo, setSyncedTo] = useState(here);
  if (syncedTo !== here) {
    setSyncedTo(here);
    if (shown.view === 'search') {
      if (usableQuery(draft) !== shown.query) setDraft(shown.query);
    } else if (draft !== '') setDraft('');
  }

  const toggleRepo = (namespace: WikiNamespace): void =>
    setRepos((previous) => (previous.includes(namespace) ? previous.filter((item) => item !== namespace) : NAMESPACES.filter((item) => item === namespace || previous.includes(item))));
  const selectAllRepos = (): void => setRepos(() => NAMESPACES);

  const closeSidebar = (focusBrowse: boolean): void => {
    setSidebarOpen(false);
    if (focusBrowse) refs.browse.current?.focus();
  };

  // Shortcuts live on the window only while the Wiki is mounted, and only act while it is visible.
  const keys = useRef({ back: () => {}, forward: () => {}, canBack: false, canForward: false, historyOpen: false, sidebarOpen: false, closeHistory: () => {}, closeSidebar: () => {} });
  keys.current = {
    back: () => move(nav.index - 1),
    forward: () => move(nav.index + 1),
    canBack: nav.index > 0,
    canForward: nav.index < nav.entries.length - 1,
    historyOpen,
    sidebarOpen,
    closeHistory: () => {
      setHistoryOpen(false);
      refs.history.current?.focus();
    },
    closeSidebar: () => closeSidebar(true),
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const root = rootEl.current;
      if (root === null || root.closest('[hidden]') !== null || event.defaultPrevented || event.isComposing) return;
      const k = keys.current;
      const typing = isTextTarget(event.target);
      if (event.key === 'Escape') {
        if (k.historyOpen) {
          event.preventDefault();
          k.closeHistory();
        } else if (k.sidebarOpen) {
          event.preventDefault();
          k.closeSidebar();
        }
      } else if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !typing) {
        event.preventDefault();
        refs.input.current?.focus();
        refs.input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // The handler reads everything through `keys` and the refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening the narrow overlay moves focus into it.
  useEffect(() => {
    if (sidebarOpen) rootEl.current?.querySelector<HTMLElement>('.wiki-sidebar button')?.focus();
  }, [sidebarOpen]);

  // After navigating, focus moves to the new view's heading (never on first mount). While the view is still loading its
  // heading, focus rests on the content region and moves once the heading appears, unless the user has moved on.
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return undefined;
    }
    const region = main.current;
    if (region === null) return undefined;
    const label = (heading: HTMLElement): void => {
      if (heading.id === '') heading.id = `${uid}-heading`;
      region.setAttribute('aria-labelledby', heading.id);
    };
    const focusIn = (heading: HTMLElement): void => {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    };
    const first = (): HTMLElement | null => region.querySelector<HTMLElement>('h1, h2');
    const found = first();
    if (found !== null) {
      label(found);
      focusIn(found);
      return undefined;
    }
    region.focus({ preventScroll: true });
    const observer = new MutationObserver(() => {
      const heading = first();
      if (heading === null) return;
      observer.disconnect();
      label(heading);
      if (region.ownerDocument.activeElement === region) focusIn(heading);
    });
    observer.observe(region, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), HEADING_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    // `contentKey` names the view; replacing the search destination while typing must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.index, contentKey]);

  // Back and Forward bring the saved scroll position back once the content is tall enough to reach it.
  useEffect(() => {
    const region = main.current;
    const target = session.scrollFor(here) ?? 0;
    if (region === null || target <= 0) return undefined;
    const apply = (): boolean => {
      if (region.scrollHeight - region.clientHeight < target) return false;
      region.scrollTop = target;
      return true;
    };
    if (apply()) return undefined;
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(region, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), RESTORE_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, contentKey]);

  let body: ReactElement;
  if (entry.ambiguity !== undefined) {
    body = h(Disambiguation, { ctx, label: entry.ambiguity.label, candidates: entry.ambiguity.candidates });
  } else if (resolved.view === 'page') {
    body = h(ReaderView, { ctx, pageKey: resolved.key });
  } else if (resolved.view === 'search') {
    body = h(SearchView, { ctx, query: resolved.query, draft, setDraft, repos, allRepos: NAMESPACES, toggleRepo, selectAllRepos, onBack: nav.index > 0 ? () => move(nav.index - 1) : null });
  } else if (resolved.view === 'topics') {
    body = h(TopicsView, { ctx, namespace: resolved.namespace });
  } else {
    body = h(HomeView, { ctx, notice: resolved.notice, status });
  }

  return h(
    'div',
    { ref: rootEl, className: 'wiki-view', role: 'region', 'aria-label': 'Wiki', 'data-appearance': props.appearance === 'dark' ? 'dark' : 'light', 'data-sidebar': sidebarOpen ? 'open' : 'closed',
      onKeyDown: (event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || isTextTarget(event.target)
          || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const next = event.key === 'ArrowLeft' ? nav.index - 1 : event.key === 'ArrowRight' ? nav.index + 1 : -1;
        if (next < 0 || next >= nav.entries.length) return;
        // Handle module history before the shell's bubbling ReturnPill listener; at an edge the shell keeps ownership.
        event.preventDefault();
        move(next);
      },
    },
    h(
      'div',
      { className: 'wiki-frame' },
      h(Sidebar, { ctx, id: sidebarId, status, shown, open: sidebarOpen, onChoose: () => setSidebarOpen(false) }),
      sidebarOpen ? h('button', { type: 'button', className: 'wiki-scrim', 'aria-label': 'Close navigation', tabIndex: -1, onClick: () => closeSidebar(true) }) : null,
      h(TopBar, {
        ctx,
        crumbs: buildCrumbs(shown, session, ctx),
        entries: nav.entries,
        index: nav.index,
        onBack: () => move(nav.index - 1),
        onForward: () => move(nav.index + 1),
        onJump: move,
        draft,
        setDraft,
        repos,
        suggest: !onSearchPage,
        onSearch: (query) => ctx.openSearch(query, { replace: onSearchPage }),
        historyOpen,
        setHistoryOpen,
        sidebarOpen,
        sidebarId,
        onBrowse: () => (sidebarOpen ? closeSidebar(true) : setSidebarOpen(true)),
        refs,
      }),
      notice !== null && notice.index === nav.index
        ? h('div', { className: 'wiki-flash' }, h(Notice, { tone: 'warning', variant: 'bar', title: notice.message, live: 'polite', data: { 'data-notice': 'action' } }))
        : null,
      h(
        'main',
        {
          key: contentKey,
          className: 'wiki-main wiki-scroll wiki-enter',
          ref: main,
          tabIndex: -1,
          onScroll: (event) => session.saveScroll(hereRef.current, event.currentTarget.scrollTop),
        },
        body,
      ),
    ),
  );
}

/** Wraps a host port so a throwing host can never break the view. */
function guardToast(port: WikiToastPort | null | undefined): WikiToastPort | null {
  if (port === null || port === undefined) return null;
  const call = (name: keyof WikiToastPort) => (...args: unknown[]): unknown => {
    try {
      return (port[name] as (...a: unknown[]) => unknown).apply(port, args);
    } catch {
      return undefined;
    }
  };
  return { info: call('info'), success: call('success'), warning: call('warning'), error: call('error'), dismiss: call('dismiss') };
}

function guardAction(action: (() => void) | null | undefined): (() => void) | null {
  if (typeof action !== 'function') return null;
  return () => {
    try {
      action();
    } catch {
      // The shell refusing a request must not break the view.
    }
  };
}

/**
 * Builds the Wiki view over an injected, read-only WikiService and optional host affordances. The response cache and
 * session state are created here, once, so they outlive remounts of the returned component.
 */
export function createWikiView(service: WikiService, affordances: WikiHostAffordances = {}): ComponentType<WikiViewProps> {
  const runtime: WikiRuntime = {
    service,
    cache: createWikiCache(),
    session: createWikiSession(),
    toast: guardToast(affordances.toast),
    openSettings: guardAction(affordances.openSettings),
  };
  function WikiView(props: WikiViewProps): ReactElement {
    return h(WikiRoot, { ...props, runtime });
  }
  WikiView.displayName = 'WikiView';
  return WikiView;
}

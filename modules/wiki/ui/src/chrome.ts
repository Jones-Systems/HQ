// Small pieces the chrome views share: re-rendering when session titles arrive, what a history entry or the current view
// is called, the breadcrumb, outage toasts and the keyboard helpers. No state of its own beyond hook refs.

import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react';
import type { PageKey, WikiError, WikiNamespace } from '../../contract/src/index.ts';
import type { ViewCtx } from './context.ts';
import { resolveDestination } from './destinations.ts';
import { excerpt, folderParts, isOutage, namespaceLabel, pageName } from './format.ts';
import type { HistoryEntry } from './history.ts';
import type { IconName } from './icons.ts';
import type { WikiSession } from './session.ts';

/** Re-renders the caller whenever the session records a page (titles for breadcrumbs, history and recent pages). */
export function useSessionTick(session: WikiSession): void {
  const [, setTick] = useState(0);
  useEffect(() => session.subscribe(() => setTick((count) => count + 1)), [session]);
}

/** Title of a page the session has seen, else a readable name from its path. */
export function pageTitle(session: WikiSession, key: PageKey): string {
  return session.titleOf(key) ?? pageName(key.path);
}

/** The repository name as a small pill. */
export function RepoBadge(props: { readonly namespace: string }): ReactElement {
  return h('span', { className: 'wiki-ns', 'data-namespace': props.namespace }, namespaceLabel(props.namespace));
}

/** What the root is showing, in the terms the sidebar and breadcrumb need. */
export type Shown =
  | { readonly view: 'home' }
  | { readonly view: 'page'; readonly key: PageKey }
  | { readonly view: 'search'; readonly query: string }
  | { readonly view: 'topics'; readonly namespace: WikiNamespace }
  | { readonly view: 'ambiguity'; readonly label: string };

export function shownOf(entry: HistoryEntry): Shown {
  if (entry.ambiguity !== undefined) return { view: 'ambiguity', label: entry.ambiguity.label };
  const resolved = resolveDestination(entry.destination);
  switch (resolved.view) {
    case 'page':
      return { view: 'page', key: resolved.key };
    case 'search':
      return { view: 'search', query: resolved.query };
    case 'topics':
      return { view: 'topics', namespace: resolved.namespace };
    default:
      return { view: 'home' };
  }
}

export interface EntryText {
  readonly icon: IconName;
  /** Human label: the page title when known, "Search “…”", "BusinessLessons topics", "Home", "Disambiguation · …". */
  readonly label: string;
  /** Secondary text (the repository of a page). */
  readonly detail: string | null;
}

export function describeEntry(shown: Shown, session: WikiSession): EntryText {
  switch (shown.view) {
    case 'page':
      return { icon: 'page', label: excerpt(pageTitle(session, shown.key), 80), detail: namespaceLabel(shown.key.namespace) };
    case 'search':
      return { icon: 'search', label: `Search “${excerpt(shown.query, 60)}”`, detail: null };
    case 'topics':
      return { icon: 'topics', label: `${namespaceLabel(shown.namespace)} topics`, detail: null };
    case 'ambiguity':
      return { icon: 'ambiguous', label: `Disambiguation · ${excerpt(shown.label, 60)}`, detail: null };
    default:
      return { icon: 'home', label: 'Home', detail: null };
  }
}

export interface Crumb {
  readonly label: string;
  /** Null for the current crumb and for plain-text crumbs (folders). */
  readonly action: (() => void) | null;
  readonly current: boolean;
}

/** Wiki › repository › folders › page, "Wiki › Search", "Wiki › Topics › repository". The last crumb is current. */
export function buildCrumbs(shown: Shown, session: WikiSession, ctx: Pick<ViewCtx, 'openHome' | 'openTopics'>): readonly Crumb[] {
  const root: Crumb = { label: 'Wiki', action: shown.view === 'home' ? null : ctx.openHome, current: shown.view === 'home' };
  switch (shown.view) {
    case 'home':
      return [root];
    case 'search':
      return [root, { label: 'Search', action: null, current: true }];
    case 'topics':
      return [root, { label: 'Topics', action: null, current: false }, { label: namespaceLabel(shown.namespace), action: null, current: true }];
    case 'ambiguity':
      return [root, { label: 'Disambiguation', action: null, current: false }, { label: excerpt(shown.label, 40), action: null, current: true }];
    default: {
      const { key } = shown;
      return [
        root,
        { label: namespaceLabel(key.namespace), action: () => ctx.openTopics(key.namespace), current: false },
        ...folderParts(key.path).map((label): Crumb => ({ label, action: null, current: false })),
        { label: excerpt(pageTitle(session, key), 60), action: null, current: true },
      ];
    }
  }
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image']);

/** True for targets where typing a character types it: text fields, selects and editable regions. */
export function isTextTarget(target: EventTarget | null): boolean {
  const element = target as { readonly tagName?: unknown; readonly type?: unknown; readonly isContentEditable?: unknown } | null;
  if (element === null || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(typeof element.type === 'string' ? element.type.toLowerCase() : 'text');
  return element.isContentEditable === true;
}

/** Index of the next focusable item when moving `step` through `count` items (wrapping), `from` -1 meaning none yet. */
export function stepIndex(from: number, step: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (from < 0) return step === 1 ? 0 : count - 1;
  return (from + step + count) % count;
}

export const OUTAGE_TOAST_ID = 'wiki-outage';

/**
 * Raises the outage toasts for a view whose reads can fail while it shows content. One warning per episode while the
 * view keeps showing what it had (`session.outage` is the episode flag, shared with every view), an error when a Retry
 * the user pressed fails again, and a success when a request answers again after a toast. Failures with nothing shown
 * are the screen's to show and get no toast. Returns `noteRetry`, to call from the view's Retry action.
 */
export function useOutageSignals(
  ctx: ViewCtx,
  input: { readonly error: WikiError | null; readonly refreshing: boolean; readonly hasContent: boolean },
): { readonly noteRetry: () => void } {
  const retried = useRef(false);
  const wasRefreshing = useRef(false);
  const latest = useRef(ctx);
  latest.current = ctx;
  const { error, refreshing, hasContent } = input;

  useEffect(() => {
    const current = latest.current;
    const { toast, session } = current;
    const settings = current.openSettings === null ? undefined : { label: 'Wiki settings', onAction: current.openSettings };
    if (error !== null && isOutage(error) && !refreshing) {
      if (retried.current) {
        // A Retry failing inside an episode that already raised its toast updates that toast; without an episode the
        // screen (an error notice with nothing shown) already says so.
        retried.current = false;
        if (session.outage) toast?.error("The Wiki still isn't answering", { id: OUTAGE_TOAST_ID, description: 'Showing pages you already opened. Try again in a moment.', action: settings });
      } else if (hasContent && !session.outage) {
        session.outage = true;
        toast?.warning("The Wiki isn't answering", { id: OUTAGE_TOAST_ID, description: 'Showing pages you already opened.', action: settings });
      }
    } else if (error === null && !refreshing && wasRefreshing.current && session.outage) {
      session.outage = false;
      toast?.success('The Wiki is back', { id: OUTAGE_TOAST_ID });
    } else if (error === null && !refreshing) {
      retried.current = false;
    }
    wasRefreshing.current = refreshing;
  }, [error, refreshing, hasContent]);

  return {
    noteRetry: () => {
      retried.current = true;
    },
  };
}

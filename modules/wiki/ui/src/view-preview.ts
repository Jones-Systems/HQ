// Link and backlink previews. One card at a time, opened after a short hover (350 ms) or focus (500 ms) delay, kept
// while the pointer is over it and closed on Escape, scroll or blur. The card is `aria-hidden` supplementary content:
// activation is unchanged and focus never moves into it. There are no portals and no style attributes: the card is a
// sibling of its link, and CSS anchor positioning follows a class toggled on the active link (see wiki-reader.css).

import { createContext, createElement as h, useContext, useEffect, useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import type { BacklinkEntry, LinkTarget, PageKey } from '../../contract/src/index.ts';
import { NamespaceBadge } from './common.ts';
import type { ViewCtx } from './context.ts';
import { folderParts, pageName } from './format.ts';
import { useResource } from './load.ts';
import { backlinkContext, pageSummary, type BacklinkContext } from './reader-model.ts';
import { pageResource } from './resources.ts';
import { Skeleton } from './feedback.ts';

export const HOVER_DELAY_MS = 350;
export const FOCUS_DELAY_MS = 500;
/** Grace after the pointer leaves, so crossing the small gap between a link and its card does not close it. */
export const CLOSE_GRACE_MS = 120;

type Source = 'hover' | 'focus';

export interface PreviewTiming {
  readonly hover: number;
  readonly focus: number;
  readonly close: number;
}

export interface PreviewStore {
  subscribe(listener: () => void): () => void;
  /** The id of the open preview, if any. */
  active(): string | null;
  /** The pointer or focus reached `id`. `warm` runs at once (prefetch), the card opens after the source's delay. */
  enter(id: string, source: Source, warm?: () => void): void;
  /** The pointer or focus left `id`. The card closes once neither is on it. */
  leave(id: string, source: Source): void;
  /** Closes now (Escape, scroll). Hovering or focus that is still there does not reopen it. */
  close(): void;
  /** Clears timers and document listeners; the store can be used again. */
  dispose(): void;
}

export function createPreviewStore(timing: PreviewTiming = { hover: HOVER_DELAY_MS, focus: FOCUS_DELAY_MS, close: CLOSE_GRACE_MS }): PreviewStore {
  let active: string | null = null;
  const listeners = new Set<() => void>();
  const holds = new Map<string, Set<Source>>();
  let opening: { readonly id: string; readonly handle: ReturnType<typeof setTimeout> } | null = null;
  let closing: { readonly id: string; readonly handle: ReturnType<typeof setTimeout> } | null = null;
  let attached = false;

  const cancelOpening = (): void => {
    if (opening !== null) clearTimeout(opening.handle);
    opening = null;
  };
  const cancelClosing = (): void => {
    if (closing !== null) clearTimeout(closing.handle);
    closing = null;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || active === null) return;
    // The card is the topmost layer while it is open, so Escape is its alone.
    event.stopPropagation();
    store.close();
  };
  const onScroll = (): void => store.close();
  const attach = (): void => {
    if (attached || typeof document === 'undefined') return;
    attached = true;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
  };
  const detach = (): void => {
    if (!attached) return;
    attached = false;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', onScroll, true);
  };
  const setActive = (id: string | null): void => {
    if (active === id) return;
    active = id;
    if (id === null) detach();
    else attach();
    for (const listener of [...listeners]) listener();
  };
  const held = (id: string): boolean => (holds.get(id)?.size ?? 0) > 0;

  const store: PreviewStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    active: () => active,
    enter(id, source, warm) {
      warm?.();
      const sources = holds.get(id) ?? new Set<Source>();
      sources.add(source);
      holds.set(id, sources);
      if (closing !== null && closing.id === id) cancelClosing();
      if (active === id) return;
      if (opening !== null && opening.id === id) return;
      cancelOpening();
      const handle = setTimeout(
        () => {
          opening = null;
          if (!held(id)) return;
          cancelClosing();
          setActive(id);
        },
        source === 'hover' ? timing.hover : timing.focus,
      );
      opening = { id, handle };
    },
    leave(id, source) {
      const sources = holds.get(id);
      sources?.delete(source);
      if (held(id)) return;
      holds.delete(id);
      if (opening !== null && opening.id === id) cancelOpening();
      if (active !== id) return;
      if (source === 'focus') {
        store.close();
        return;
      }
      cancelClosing();
      const handle = setTimeout(() => {
        closing = null;
        if (active === id && !held(id)) setActive(null);
      }, timing.close);
      closing = { id, handle };
    },
    close() {
      cancelOpening();
      cancelClosing();
      setActive(null);
    },
    dispose() {
      cancelOpening();
      cancelClosing();
      active = null;
      detach();
    },
  };
  return store;
}

const NO_STORE: PreviewStore = {
  subscribe: () => () => undefined,
  active: () => null,
  enter: () => undefined,
  leave: () => undefined,
  close: () => undefined,
  dispose: () => undefined,
};

const PreviewContext = createContext<PreviewStore>(NO_STORE);

/** Owns one preview store for a reader page and disposes it with the page. */
export function PreviewProvider(props: { readonly children: ReactNode; readonly timing?: PreviewTiming }): ReactElement {
  const store = useMemo(() => createPreviewStore(props.timing), [props.timing]);
  useEffect(() => () => store.dispose(), [store]);
  return h(PreviewContext.Provider, { value: store }, props.children);
}

export type PreviewKind = 'page' | 'ambiguous' | 'missing' | 'external' | 'backlink';

/**
 * Wraps one link-like control. `children` receives the class to add to the control while its card is open (it carries
 * the CSS anchor name); the card renders next to it, and only for the one preview that is open.
 */
export function Previewable(props: {
  readonly id: string;
  readonly kind: PreviewKind;
  /** `inline` sits under a link in text; `rail` sits beside a row in the right rail. */
  readonly placement: 'inline' | 'rail';
  /** Prefetch on hover or focus, before the card opens. */
  readonly warm?: () => void;
  readonly card: () => ReactNode;
  readonly children: (anchorClass: string) => ReactNode;
}): ReactElement {
  const store = useContext(PreviewContext);
  const { id } = props;
  const open = useSyncExternalStore(store.subscribe, () => store.active() === id, () => false);
  return h(
    'span',
    {
      className: `wiki-previewable wiki-previewable--${props.placement}`,
      onMouseEnter: () => store.enter(id, 'hover', props.warm),
      onMouseLeave: () => store.leave(id, 'hover'),
      onFocus: () => store.enter(id, 'focus', props.warm),
      onBlur: () => store.leave(id, 'focus'),
    },
    props.children(open ? ' wiki-anchor-on' : ''),
    open
      ? h('span', { className: `wiki-preview wiki-preview--${props.placement}`, 'aria-hidden': 'true', 'data-preview': props.kind }, props.card())
      : null,
  );
}

// ---- warming ----

/** Starts loading a page for a preview. It is the same cache entry the reader shows, so opening the page is instant. */
export function warmPage(ctx: ViewCtx, key: PageKey): () => void {
  return () => {
    const spec = pageResource(ctx.service, key);
    ctx.cache.prefetch(spec.key, spec.load, spec.check);
  };
}

// ---- cards ----

function folderText(key: PageKey): string {
  return folderParts(key.path).join(' / ');
}

function PreviewHead(props: { readonly title: string; readonly pageKey: PageKey }): ReactElement {
  const folder = folderText(props.pageKey);
  return h(
    'span',
    { className: 'wiki-preview-head' },
    h('span', { className: 'wiki-preview-title' }, props.title),
    h(NamespaceBadge, { namespace: props.pageKey.namespace }),
    folder === '' ? null : h('span', { className: 'wiki-preview-path' }, folder),
  );
}

function PagePreview(props: { readonly ctx: ViewCtx; readonly pageKey: PageKey }): ReactElement {
  const { ctx, pageKey } = props;
  const page = useResource(pageResource(ctx.service, pageKey), ctx.cache);
  const value = page.value;
  const title = value?.title ?? ctx.session.titleOf(pageKey) ?? pageName(pageKey.path);
  const summary = value === undefined ? '' : pageSummary(value);
  return h(
    'span',
    { className: 'wiki-preview-body', 'data-preview-state': value !== undefined ? 'ready' : page.status === 'error' ? 'error' : 'loading' },
    h(PreviewHead, { title, pageKey }),
    value !== undefined
      ? summary === ''
        ? h('span', { className: 'wiki-preview-note' }, 'This page has no text to preview.')
        : h('span', { className: 'wiki-preview-text' }, summary)
      : page.status === 'error'
        ? h('span', { className: 'wiki-preview-note' }, 'Couldn’t load a preview of this page.')
        : h(Skeleton, { shape: 'line', lines: 3 }),
  );
}

/** What a link points at, without leaving the page. `label` is the link's own words. */
export function LinkPreview(props: { readonly ctx: ViewCtx; readonly target: LinkTarget; readonly label: string }): ReactElement {
  const { ctx, target } = props;
  switch (target.kind) {
    case 'page':
      return h(PagePreview, { ctx, pageKey: target.key });
    case 'ambiguous':
      return h(
        'span',
        { className: 'wiki-preview-body' },
        h('span', { className: 'wiki-preview-title' }, `“${props.label}” matches ${target.candidates.length} pages`),
        h(
          'span',
          { className: 'wiki-preview-list' },
          target.candidates.map((candidate) =>
            h(
              'span',
              { key: `${candidate.namespace}/${candidate.path}`, className: 'wiki-preview-item' },
              h('span', { className: 'wiki-preview-item-name' }, ctx.session.titleOf(candidate) ?? pageName(candidate.path)),
              h(NamespaceBadge, { namespace: candidate.namespace }),
              h('span', { className: 'wiki-preview-path' }, candidate.path),
            ),
          ),
        ),
        h('span', { className: 'wiki-preview-note' }, 'Choose one when you open the link.'),
      );
    case 'missing':
      return h(
        'span',
        { className: 'wiki-preview-body' },
        h('span', { className: 'wiki-preview-title' }, `No page named “${target.label}” yet`),
        h('span', { className: 'wiki-preview-note' }, 'The link is kept as written. There is nothing to open.'),
      );
    default:
      return h(
        'span',
        { className: 'wiki-preview-body' },
        h('span', { className: 'wiki-preview-title' }, 'External link'),
        h('span', { className: 'wiki-preview-url' }, target.url),
        h('span', { className: 'wiki-preview-note' }, 'External links don’t open from the Wiki.'),
      );
  }
}

export interface BacklinkContextState {
  readonly status: 'loading' | 'error' | 'ready';
  /** The block that links here; null when there is nothing to quote (see `raw`). */
  readonly context: BacklinkContext | null;
  /** The source page is shown as plain text, so its links are not marked. */
  readonly raw: boolean;
}

/**
 * Uses an inert provider excerpt when available; older providers fall back to the cached source document.
 */
export function useBacklinkContext(ctx: ViewCtx, entry: BacklinkEntry, current: PageKey): BacklinkContextState {
  const page = useResource(entry.excerpt === undefined ? pageResource(ctx.service, entry.source) : null, ctx.cache);
  if (entry.excerpt !== undefined) return { status: 'ready', context: { kind: 'sentence', segments: [{ text: entry.excerpt, match: false }], mentions: 1 }, raw: false };
  const value = page.value;
  if (value === undefined) return { status: page.status === 'error' ? 'error' : 'loading', context: null, raw: false };
  if (value.content.state !== 'parsed') return { status: 'ready', context: null, raw: true };
  return { status: 'ready', context: backlinkContext(value.content.ast, current), raw: false };
}

/** The sentence or list item that links to `current`, fetched lazily through the same cache. */
export function BacklinkPreview(props: { readonly ctx: ViewCtx; readonly entry: BacklinkEntry; readonly current: PageKey }): ReactElement {
  const { entry } = props;
  const { status, context, raw } = useBacklinkContext(props.ctx, entry, props.current);
  return h(
    'span',
    { className: 'wiki-preview-body', 'data-preview-state': status },
    h(PreviewHead, { title: entry.title, pageKey: entry.source }),
    status !== 'ready'
      ? status === 'error'
        ? h('span', { className: 'wiki-preview-note' }, 'Couldn’t load this page to show where it links here.')
        : h(Skeleton, { shape: 'line', lines: 2 })
      : context === null
        ? h(
            'span',
            { className: 'wiki-preview-note' },
            raw ? 'This page is shown as plain text, so the link isn’t marked.' : 'The link is not in the page text.',
          )
        : h(
            'span',
            { className: 'wiki-preview-context', 'data-context': context.kind },
            h(
              'span',
              { className: 'wiki-preview-text' },
              context.segments.map((segment, index) => (segment.match ? h('mark', { key: index, className: 'wiki-preview-mark' }, segment.text) : segment.text)),
            ),
            context.mentions > 1 ? h('span', { className: 'wiki-preview-note' }, `${context.mentions - 1} more ${context.mentions === 2 ? 'mention' : 'mentions'} on this page`) : null,
          ),
  );
}

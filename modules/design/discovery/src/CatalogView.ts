/**
 * React catalog view. Written with `createElement` (no JSX) so Node's built-in test runner can render it
 * with type stripping alone. The first render uses whatever the cache already holds; previews are
 * requested only by mounted, visible cards and are withdrawn when a card unmounts.
 *
 * Two ways to browse the same read-only catalog: a virtualised card **grid** (Are.na / Pinterest style) and an
 * **Explore** deck that shows one large card at a time. Nothing here writes to a source: the only actions are
 * Refresh (a read), filtering, and handing a project to the host through optional callbacks.
 *
 * Motion and feedback come from `@hq/ui`, but a section never imports another package's CSS, and Node cannot load
 * it. The composed view passes the primitives in as `kit`; without one the view renders plain, inert markup.
 */
import {
  createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ComponentType, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
  type ReactElement, type ReactNode, type RefObject,
} from 'react';
import type { HostId, WorkspaceSourceLink } from './contract.ts';
import type { DiscoveryService, RefreshReport } from './discovery.ts';
import { DEFAULT_GRID, gridMetrics, planGridWindow } from './previews.ts';
import {
  buildCatalogView, deckState, moveGridIndex, plural, previewDataUrl, previewImageType, statusTone, summarizeRefresh,
  type CatalogRow, type DeckDecision, type DeckState, type SourceRow, type ViewOptions,
} from './view-model.ts';

// ---- injected primitives -----------------------------------------------------------------------

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'unknown' | 'unavailable';

export interface KitButtonProps {
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly size?: 'sm' | 'md';
  readonly busy?: boolean;
  readonly busyLabel?: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly tabIndex?: number;
  readonly onClick?: () => void;
  readonly 'aria-label'?: string;
  readonly 'aria-pressed'?: boolean;
  readonly 'data-autofocus'?: string;
  readonly children?: ReactNode;
}
export interface KitStatusProps {
  readonly tone: Tone;
  readonly label: string;
  readonly detail?: ReactNode;
  readonly busy?: boolean;
  readonly live?: boolean;
  readonly className?: string;
}
export interface KitNoticeProps {
  readonly tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'unknown';
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: readonly { readonly label: string; readonly onAction: () => void; readonly busy?: boolean; readonly busyLabel?: string }[];
  readonly onDismiss?: () => void;
  readonly variant?: 'banner' | 'bar';
  readonly live?: 'polite' | 'assertive' | 'off';
  readonly className?: string;
}
export interface KitSkeletonProps { readonly shape?: 'text' | 'block' | 'circle'; readonly className?: string }
export interface KitPresenceProps {
  readonly show: boolean;
  readonly motion?: 'fade' | 'rise' | 'drop' | 'scale' | 'slide-end' | 'slide-start' | 'collapse';
  readonly initial?: boolean;
  readonly as?: 'div' | 'section' | 'li' | 'span' | 'aside';
  readonly className?: string;
  readonly children?: ReactNode;
}
export interface KitToastInput {
  readonly id?: string;
  readonly tone?: 'info' | 'success' | 'warning' | 'danger';
  readonly title: string;
  readonly description?: string;
  readonly meta?: string;
  readonly action?: { readonly label: string; readonly onAction: () => void };
}
export interface DiscoveryToast {
  show(input: KitToastInput): string;
  error(title: string, options?: Omit<KitToastInput, 'title' | 'tone'>): string;
}
export interface KitMotionOptions {
  readonly duration?: 'instant' | 'fast' | 'base' | 'slow' | 'slower';
  readonly easing?: 'standard' | 'exit' | 'enter' | 'spring';
  readonly delay?: number;
}

/** The `@hq/ui` pieces this view uses. `DiscoveryView` supplies the real ones. */
export interface DiscoveryKit {
  readonly Button: ComponentType<KitButtonProps>;
  readonly StatusIndicator: ComponentType<KitStatusProps>;
  readonly InlineNotice: ComponentType<KitNoticeProps>;
  readonly Skeleton: ComponentType<KitSkeletonProps>;
  readonly Presence: ComponentType<KitPresenceProps>;
  readonly useToast: () => DiscoveryToast;
  /** Put the returned ref on the list and `data-hq-motion-key` on each item; items glide when `order` changes. */
  readonly useListMotion: (order: string) => RefObject<HTMLUListElement | null>;
  readonly useReducedMotion: () => boolean;
  readonly animateElement: (element: Element, keyframes: Keyframe[], options?: KitMotionOptions) => Animation | null;
}

const joinClass = (...parts: readonly (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

const NO_TOAST: DiscoveryToast = { show: () => '', error: () => '' };

/** Inert stand-ins used when no kit is supplied (Node renders, harnesses): same markup shape, no motion, no toasts. */
export const PLAIN_KIT: DiscoveryKit = {
  Button: (props) => h('button', {
    type: 'button', className: joinClass('discovery-plain-button', props.className), disabled: props.disabled, title: props.title, tabIndex: props.tabIndex,
    'aria-label': props['aria-label'], 'aria-pressed': props['aria-pressed'], 'aria-busy': props.busy || undefined,
    'data-autofocus': props['data-autofocus'], onClick: props.busy ? undefined : props.onClick,
  }, props.busy ? props.busyLabel ?? props.children : props.children),
  StatusIndicator: (props) => h('span', { className: joinClass('hq-indicator', props.className), 'data-tone': props.tone, 'aria-busy': props.busy || undefined },
    h('span', { className: `hq-status hq-status--${props.tone}` },
      h('span', { className: 'hq-status-shape', 'aria-hidden': true }),
      h('b', { className: 'hq-status-label' }, props.label),
      props.detail ? h('span', { className: 'hq-status-detail' }, props.detail) : null)),
  InlineNotice: (props) => h('div', {
    className: joinClass('hq-notice', `hq-notice--${props.tone}`, props.variant === 'bar' && 'hq-notice--bar', props.className), 'data-tone': props.tone,
    role: (props.live ?? (props.tone === 'danger' || props.tone === 'unknown' ? 'assertive' : 'polite')) === 'assertive' ? 'alert' : props.live === 'off' ? undefined : 'status',
  }, h('strong', { className: 'hq-notice-title' }, props.title), props.children ? h('span', { className: 'hq-notice-description' }, props.children) : null,
  ...(props.actions ?? []).map((action) => h('button', { key: action.label, type: 'button', onClick: action.onAction }, action.label))),
  Skeleton: (props) => h('span', { className: joinClass('hq-skeleton', `hq-skeleton--${props.shape ?? 'text'}`, props.className), 'aria-hidden': true }),
  Presence: ({ show, as = 'div', className, children }) => show ? h(as, className ? { className } : null, children) : null,
  useToast: () => NO_TOAST,
  useListMotion: () => useRef<HTMLUListElement | null>(null),
  useReducedMotion: () => false,
  animateElement: () => null,
};

// ---- props -------------------------------------------------------------------------------------

export interface DiscoveryCatalogProps {
  readonly service: DiscoveryService;
  readonly now?: () => number;
  readonly links?: readonly WorkspaceSourceLink[];
  readonly adapterLabels?: Readonly<Record<string, { readonly label: string; readonly fake: boolean }>>;
  /** Explicit user action; the host (Projects/root) decides which workspace project to link. The button shows only when this is set. */
  readonly onRequestLink?: (row: CatalogRow) => void;
  /** Hands a project to the host (for example to Taste). `imageUrl` is the `data:` URL of its preview when it has loaded. */
  readonly onSendToTaste?: (row: CatalogRow, info: { readonly imageUrl: string | null }) => void;
  /** Motion and feedback primitives from `@hq/ui`. */
  readonly kit?: DiscoveryKit;
  /** Distance between row tops. Defaults to the measured card height plus the gap. */
  readonly rowHeight?: number;
  /** Height used to plan the window until the real one is measured. */
  readonly viewportHeight?: number;
  /** Rows beyond the visible ones whose previews are requested early. */
  readonly prefetchRows?: number;
  /** Fixed column count. Measured from the container width by default. */
  readonly columns?: number;
  /** Which view opens first. Default the grid. */
  readonly defaultMode?: 'grid' | 'explore';
  /** Shortest time the Refresh button and indicator stay busy, so a fast refresh is still seen. Default 450 ms. */
  readonly minBusyMs?: number;
}

// ---- preview data URLs -------------------------------------------------------------------------

interface UrlCache {
  has(digest: string): boolean;
  get(digest: string): string | null | undefined;
  set(digest: string, url: string | null): void;
}

/** Small LRU of decoded `data:` URLs, so scrolling cards back in does not decode them again. */
function createUrlCache(limit = 64): UrlCache {
  const entries = new Map<string, string | null>();
  return {
    has: (digest) => entries.has(digest),
    get(digest) {
      if (!entries.has(digest)) return undefined;
      const value = entries.get(digest)!;
      entries.delete(digest);
      entries.set(digest, value);
      return value;
    },
    set(digest, url) {
      entries.delete(digest);
      entries.set(digest, url);
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
    },
  };
}

// ---- small pieces ------------------------------------------------------------------------------

const ICONS = {
  bookmark: 'M8 4h8a1 1 0 0 1 1 1v14.5l-5-3.4-5 3.4V5a1 1 0 0 1 1-1z',
  saved: 'M8 4h8a1 1 0 0 1 1 1v14.5l-5-3.4-5 3.4V5a1 1 0 0 1 1-1z M9.5 10.5l1.8 1.8 3.2-3.6',
  link: 'M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-.9.9 M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.5 3.5 0 0 0 5 5l.9-.9',
  close: 'm7 7 10 10M17 7 7 17',
  image: 'M4.5 6h15v12h-15z M4.5 15.5l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5 M9 9.6h.01',
} as const;

function Icon(props: { readonly name: keyof typeof ICONS }): ReactElement {
  return h('svg', { className: 'discovery-icon', viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false }, h('path', { d: ICONS[props.name] }));
}

function Badge(props: { readonly text: string; readonly title?: string | undefined; readonly className?: string }): ReactElement {
  return h('span', { className: joinClass('discovery-badge', props.className), ...(props.title !== undefined ? { title: props.title } : {}) }, props.text);
}

function FreshnessIndicator(props: { readonly kit: DiscoveryKit; readonly row: CatalogRow }): ReactElement {
  return h(props.kit.StatusIndicator, { tone: statusTone(props.row.status), label: props.row.statusLabel, live: false, className: 'discovery-freshness' });
}

// ---- previews ----------------------------------------------------------------------------------

type PreviewPhase = 'none' | 'unsupported' | 'pending' | 'ready' | 'failed';
const PHASE_LABEL: Record<Exclude<PreviewPhase, 'pending' | 'ready'>, string> = { none: 'No preview', unsupported: 'No preview', failed: 'Preview unavailable' };

/**
 * The 16:10 preview well. Loads only while mounted (the grid mounts visible cards plus a short prefetch window),
 * withdraws its request when it unmounts, and shows a `data:` URL, never a `blob:` one (the shell CSP blocks those).
 */
function PreviewImage(props: { readonly service: DiscoveryService; readonly row: CatalogRow; readonly priority: 'visible' | 'prefetch'; readonly kit: DiscoveryKit; readonly cache: UrlCache }): ReactElement {
  const { service, row, priority, kit, cache } = props;
  const ref = row.preview;
  const supported = ref !== null && previewImageType(ref.mediaType) !== null;
  const [outcome, setOutcome] = useState<{ readonly digest: string; readonly failed: boolean } | null>(null);
  useEffect(() => {
    if (!ref || !supported || cache.has(ref.digest)) return undefined;
    const controller = new AbortController();
    service.loadPreview(row.hostId, ref, { priority, signal: controller.signal }).then((bytes) => {
      if (controller.signal.aborted) return;
      cache.set(ref.digest, previewDataUrl(bytes, ref.mediaType));
      setOutcome({ digest: ref.digest, failed: false });
    }, () => { if (!controller.signal.aborted) setOutcome({ digest: ref.digest, failed: true }); });
    return () => controller.abort();
  }, [service, cache, row.hostId, ref?.digest, supported, priority]);

  let phase: PreviewPhase;
  let url: string | null = null;
  if (!ref) phase = 'none';
  else if (!supported) phase = 'unsupported';
  else if (outcome?.digest === ref.digest && outcome.failed) phase = 'failed';
  else if (cache.has(ref.digest)) {
    url = cache.get(ref.digest) ?? null;
    phase = url ? 'ready' : 'unsupported';
  } else phase = 'pending';

  // Preview bytes keep their own colours: they sit in a preserved-content well and take no filter or fade.
  if (phase === 'ready' && url) {
    return h('div', { className: 'discovery-preview', 'data-preview': 'ready', 'data-hq-content': 'producer', 'aria-hidden': true },
      h('img', {
        src: url, alt: '', draggable: false, decoding: 'async',
        onError: () => { if (ref) setOutcome({ digest: ref.digest, failed: true }); },
      }));
  }
  if (phase === 'pending') {
    return h('div', { className: 'discovery-preview', 'data-preview': 'pending', 'aria-hidden': true }, h(kit.Skeleton, { shape: 'block' }));
  }
  return h('div', { className: 'discovery-preview', 'data-preview': phase, 'aria-hidden': true },
    h('span', { className: 'discovery-preview-empty' }, h(Icon, { name: 'image' }), h('span', null, PHASE_LABEL[phase as keyof typeof PHASE_LABEL])));
}

// ---- cards -------------------------------------------------------------------------------------

interface CardProps {
  readonly row: CatalogRow;
  readonly index: number;
  readonly total: number;
  readonly priority: 'visible' | 'prefetch';
  readonly tabbable: boolean;
  readonly height: number;
  readonly service: DiscoveryService;
  readonly kit: DiscoveryKit;
  readonly cache: UrlCache;
  readonly saved: boolean;
  readonly flash: boolean;
  readonly onSave: ((row: CatalogRow) => void) | undefined;
  readonly onLink: ((row: CatalogRow) => void) | undefined;
  readonly onOpen: (row: CatalogRow, trigger: HTMLElement) => void;
  readonly onFocusCard: (index: number) => void;
}

function Card(props: CardProps): ReactElement {
  const { row, kit } = props;
  const tab = props.tabbable ? 0 : -1;
  return h('li', {
    className: 'discovery-row', 'data-source-project': row.key, 'data-status': row.status, 'data-index': props.index,
    'data-hq-motion-key': row.key, tabIndex: tab, style: { height: props.height },
    'aria-label': `${row.displayName} on ${row.hostLabel}, ${row.statusLabel}, read-only source project`,
    'aria-posinset': props.index + 1, 'aria-setsize': props.total,
    onFocus: (event: { target: unknown; currentTarget: unknown }) => { if (event.target === event.currentTarget) props.onFocusCard(props.index); },
    onClick: (event: { target: unknown; currentTarget: HTMLElement }) => {
      if ((event.target as Element).closest('button')) return;
      props.onOpen(row, event.currentTarget);
    },
  },
  h('div', { className: joinClass('discovery-card', 'hq-lift', 'hq-press', props.flash && 'hq-flash') },
    h('div', { className: 'discovery-media' },
      h(PreviewImage, { service: props.service, row, priority: props.priority, kit, cache: props.cache }),
      row.linkedProjects.length > 0 || row.sameTitleCount > 0 ? h('span', { className: 'discovery-tags' },
        row.linkedProjects.length > 0 ? h(Badge, { text: `Linked (${row.linkedProjects.length})`, className: 'discovery-badge--onmedia' }) : null,
        row.sameTitleCount > 0 ? h(Badge, { text: 'Same name elsewhere', title: 'Different source identity; not merged', className: 'discovery-badge--onmedia' }) : null) : null,
      props.onSave || props.onLink ? h('span', { className: 'discovery-quick' },
        props.onSave ? h('button', {
          type: 'button', className: 'discovery-quick-button hq-press', tabIndex: tab, 'data-saved': props.saved || undefined,
          'aria-label': props.saved ? 'Saved for Taste' : 'Save for Taste', title: props.saved ? 'Saved for Taste' : 'Save for Taste',
          onClick: () => props.onSave?.(row),
        }, h(Icon, { name: props.saved ? 'saved' : 'bookmark' })) : null,
        props.onLink ? h('button', {
          type: 'button', className: 'discovery-quick-button hq-press', tabIndex: tab, 'aria-label': 'Link to project…', title: 'Link to project…',
          onClick: () => props.onLink?.(row),
        }, h(Icon, { name: 'link' })) : null) : null),
    h('div', { className: 'discovery-card-body' },
      h('strong', null, row.displayName),
      h('div', { className: 'discovery-card-tags' },
        h('span', { className: 'discovery-chip', title: `Host ${row.hostId}` }, row.hostLabel),
        h(FreshnessIndicator, { kit, row })),
      h('span', { className: 'discovery-meta', title: `${row.relativePath} · ${row.repoLabel}` }, `${row.relativePath} · ${row.repoLabel}`))));
}

// ---- source strip ------------------------------------------------------------------------------

function SourceStrip(props: { readonly sources: readonly SourceRow[]; readonly kit: DiscoveryKit; readonly active: HostId | null; readonly onToggle: (host: HostId) => void }): ReactElement {
  const { kit } = props;
  return h('ul', { className: 'discovery-sources', 'aria-label': 'Sources' },
    props.sources.map((source) => {
      const pressed = props.active === source.hostId;
      return h('li', { key: source.hostId, className: 'discovery-source-item', 'data-host': source.hostId, 'data-status': source.status },
        h('button', {
          type: 'button', className: 'discovery-source hq-press', 'aria-pressed': pressed,
          title: pressed ? `Showing only ${source.label}. Select to show every source.` : `Show only ${source.label}`,
          onClick: () => props.onToggle(source.hostId),
        },
        h('span', { className: 'discovery-source-head' },
          h('strong', null, source.label),
          h('span', { className: 'discovery-source-meta' },
            source.fake ? h(Badge, { text: 'Fake source', title: source.adapterLabel }) : null,
            h('span', { className: 'discovery-source-count', title: `${plural(source.projectCount, 'source project')}` }, String(source.projectCount)))),
        h('span', { className: 'discovery-source-state' },
          h(kit.StatusIndicator, {
            tone: statusTone(source.status), label: source.statusLabel, busy: source.status === 'refreshing', live: false,
            detail: source.updatedLabel,
          }))));
    }));
}

interface Notice {
  readonly tone: 'neutral' | 'warning' | 'danger';
  readonly title: string;
  readonly body: string | null;
  readonly live: 'assertive' | 'off';
  readonly retry: boolean;
  readonly dismiss: boolean;
}

function noticeFor(source: SourceRow, hold: string | undefined): Notice | null {
  if (source.conflict) {
    return { tone: 'danger', title: 'Host identity changed — re-verify before trusting new data.', body: source.label, live: 'assertive', retry: false, dismiss: false };
  }
  if (source.error) {
    const tone = source.status === 'error' ? 'danger' : 'warning';
    return { tone, title: `${source.label} · ${source.statusLabel.toLowerCase()}`, body: `${source.error.replace(/[.…]+$/u, '')}. Showing the saved catalog.`, live: 'off', retry: true, dismiss: false };
  }
  if (hold) return { tone: 'neutral', title: `${source.label} · refresh isn't available yet`, body: `${hold}. Showing the saved catalog.`, live: 'off', retry: false, dismiss: true };
  return null;
}

/** One slot per source, so a notice slides open and closed instead of jumping. */
function SourceNotice(props: { readonly source: SourceRow; readonly hold: string | undefined; readonly kit: DiscoveryKit; readonly busy: boolean; readonly onRetry: () => void; readonly onDismiss: () => void }): ReactElement {
  const { kit } = props;
  const notice = noticeFor(props.source, props.hold);
  const last = useRef<Notice | null>(notice);
  if (notice) last.current = notice;
  const shown = notice ?? last.current;
  return h(kit.Presence, { show: notice !== null, motion: 'collapse', className: 'discovery-notice-slot' },
    shown ? h(kit.InlineNotice, {
      tone: shown.tone, variant: 'bar', live: shown.live, title: shown.title, className: 'discovery-notice',
      ...(shown.retry ? { actions: [{ label: 'Retry', onAction: props.onRetry, busy: props.busy, busyLabel: 'Refreshing…' }] } : {}),
      ...(shown.dismiss ? { onDismiss: props.onDismiss } : {}),
      children: shown.body,
    }) : null);
}

// ---- details -----------------------------------------------------------------------------------

function Facts(props: { readonly row: CatalogRow; readonly source: SourceRow | undefined; readonly kit: DiscoveryKit }): ReactElement {
  const { row, source } = props;
  const facts: [string, ReactNode, boolean][] = [
    ['Host', h('span', null, row.hostLabel, source?.fake ? [' ', h(Badge, { key: 'fake', text: 'Fake source', ...(source ? { title: source.adapterLabel } : {}) })] : null), false],
    ['Path', row.relativePath, true],
    ['Repository', row.repoLabel, true],
    ['Revision', row.revision ?? 'Not recorded', row.revision !== null],
    ['Freshness', h('span', { className: 'discovery-fact-status' }, h(FreshnessIndicator, { kit: props.kit, row }), h('span', { className: 'discovery-fact-age' }, row.updatedLabel)), false],
  ];
  if (row.linkedProjects.length > 0) facts.push(['Linked', plural(row.linkedProjects.length, 'workspace project'), false]);
  if (row.sameTitleCount > 0) facts.push(['Same name', `${plural(row.sameTitleCount, 'other source project')} — separate, not merged`, false]);
  return h('dl', { className: 'discovery-facts' },
    facts.flatMap(([label, value, mono]) => [
      h('dt', { key: `${label}-t` }, label),
      h('dd', { key: `${label}-d`, className: mono ? 'discovery-fact-mono' : undefined }, value),
    ]));
}

function Details(props: {
  readonly row: CatalogRow; readonly source: SourceRow | undefined; readonly service: DiscoveryService; readonly kit: DiscoveryKit; readonly cache: UrlCache;
  readonly saved: boolean; readonly onSave: ((row: CatalogRow) => void) | undefined; readonly onLink: ((row: CatalogRow) => void) | undefined; readonly onClose: () => void;
}): ReactElement {
  const { row, kit } = props;
  return h('div', { className: 'discovery-details', role: 'dialog', 'aria-modal': false, 'aria-labelledby': 'discovery-details-title' },
    h('header', { className: 'discovery-details-head' },
      h('h3', { id: 'discovery-details-title' }, row.displayName),
      h(kit.Button, { variant: 'ghost', size: 'sm', 'aria-label': 'Close details', title: 'Close details (Esc)', className: 'discovery-details-close', 'data-autofocus': 'true', onClick: props.onClose }, h(Icon, { name: 'close' }))),
    h('div', { className: 'discovery-details-media' }, h(PreviewImage, { service: props.service, row, priority: 'visible', kit, cache: props.cache })),
    h(Facts, { row, source: props.source, kit }),
    h('p', { className: 'discovery-details-note' }, 'Read-only source project. HQ reads its catalog entry and preview; it never runs, clones or writes at the source.'),
    props.onSave || props.onLink ? h('div', { className: 'discovery-details-actions' },
      props.onSave ? h(kit.Button, { variant: 'primary', size: 'sm', onClick: () => props.onSave?.(row) }, props.saved ? 'Saved for Taste' : 'Save for Taste') : null,
      props.onLink ? h(kit.Button, { variant: 'secondary', size: 'sm', onClick: () => props.onLink?.(row) }, 'Link to project…') : null) : null);
}

// ---- explore deck ------------------------------------------------------------------------------

const SWIPE_DISTANCE = 96;

function DeckCard(props: {
  readonly row: CatalogRow; readonly slot: 'top' | 'next'; readonly service: DiscoveryService; readonly kit: DiscoveryKit; readonly cache: UrlCache;
  readonly source: SourceRow | undefined; readonly saveWord: string; readonly cardRef?: (element: HTMLElement | null) => void;
  readonly onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void; readonly onPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerEnd?: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactElement {
  const { row, slot, kit } = props;
  return h('article', {
    className: 'discovery-deck-card hq-enter-fade', 'data-slot': slot, 'data-source-project': row.key, 'data-status': row.status,
    'aria-label': `${row.displayName} on ${row.hostLabel}, ${row.statusLabel}, read-only source project`,
    ...(slot === 'next' ? { inert: true, 'aria-hidden': true } : {}),
    ref: props.cardRef, onPointerDown: props.onPointerDown, onPointerMove: props.onPointerMove, onPointerUp: props.onPointerEnd, onPointerCancel: props.onPointerEnd,
  },
  h('div', { className: 'discovery-media' },
    h(PreviewImage, { service: props.service, row, priority: slot === 'top' ? 'visible' : 'prefetch', kit, cache: props.cache }),
    slot === 'top' ? h('span', { className: 'discovery-stamp', 'data-kind': 'save', 'aria-hidden': true }, props.saveWord) : null,
    slot === 'top' ? h('span', { className: 'discovery-stamp', 'data-kind': 'skip', 'aria-hidden': true }, 'Skip') : null),
  h('div', { className: 'discovery-deck-body' },
    h('h3', null, row.displayName),
    h('div', { className: 'discovery-card-tags' }, h('span', { className: 'discovery-chip' }, row.hostLabel), h(FreshnessIndicator, { kit, row })),
    h('span', { className: 'discovery-meta' }, `${row.relativePath} · ${row.repoLabel}${row.revision ? ` · ${row.revision.slice(0, 12)}` : ''}`),
    h('span', { className: 'discovery-meta discovery-meta--quiet' }, row.updatedLabel)));
}

function Deck(props: {
  readonly rows: readonly CatalogRow[]; readonly decisions: ReadonlyMap<string, DeckDecision>; readonly sources: readonly SourceRow[];
  readonly service: DiscoveryService; readonly kit: DiscoveryKit; readonly cache: UrlCache; readonly reduced: boolean; readonly canSave: boolean;
  readonly onDecide: (row: CatalogRow, decision: DeckDecision) => void; readonly onOpen: (row: CatalogRow, trigger: HTMLElement) => void;
  readonly onRestart: () => void; readonly onBackToGrid: () => void;
}): ReactElement {
  const { rows, decisions, kit, reduced } = props;
  const deck: DeckState = deckState(rows, decisions);
  const saveLabel = props.canSave ? 'Save for Taste' : 'Keep';
  const saveWord = props.canSave ? 'Save' : 'Keep';
  const rootRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLElement | null>(null);
  const busy = useRef(false);
  const drag = useRef<{ id: number; x: number; dx: number; moved: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Entering Explore puts focus on the deck so the arrow keys work straight away.
  useEffect(() => { rootRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { busy.current = false; }, [deck.top?.key]);

  const swipe = (element: HTMLElement, dx: number) => {
    element.style.transform = `translateX(${dx}px) rotate(${reduced ? 0 : dx / 22}deg)`;
    element.style.setProperty('--discovery-swipe', String(Math.max(-1, Math.min(1, dx / SWIPE_DISTANCE))));
  };

  const decide = (decision: DeckDecision) => {
    const row = deck.top;
    const element = topRef.current;
    if (!row || busy.current) return;
    busy.current = true;
    const commit = () => {
      setAnnouncement(`${decision === 'saved' ? (props.canSave ? 'Saved for Taste' : 'Kept') : 'Skipped'}: ${row.displayName}`);
      props.onDecide(row, decision);
    };
    if (!element || reduced) { commit(); return; }
    const direction = decision === 'saved' ? 1 : -1;
    const from = element.style.transform || 'none';
    const to = `translateX(${direction * (element.offsetWidth * 1.15)}px) rotate(${direction * 16}deg)`;
    element.style.setProperty('--discovery-swipe', String(direction));
    const animation = kit.animateElement(element, [{ transform: from }, { transform: to }], { duration: 'slow', easing: 'exit' });
    if (!animation) { commit(); return; }
    element.style.transform = to; // hold the exit pose until the card is replaced
    void animation.finished.then(commit, commit);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select') || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); decide('saved'); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); decide('skipped'); }
    else if ((event.key === 'Enter' || event.key === ' ') && target === event.currentTarget && deck.top) {
      event.preventDefault();
      props.onOpen(deck.top, event.currentTarget);
    }
  };

  const pointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || busy.current || (event.target as Element).closest('button')) return;
    drag.current = { id: event.pointerId, x: event.clientX, dx: 0, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.dataset.dragging = 'true';
  };
  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    state.dx = event.clientX - state.x;
    if (Math.abs(state.dx) > 5) state.moved = true;
    if (state.moved) swipe(event.currentTarget, state.dx);
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    const element = event.currentTarget;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    delete element.dataset.dragging;
    if (event.type === 'pointercancel' || !state.moved) {
      if (state.moved) element.style.transform = '';
      if (event.type !== 'pointercancel' && deck.top) props.onOpen(deck.top, rootRef.current ?? element);
      element.style.removeProperty('--discovery-swipe');
      return;
    }
    if (Math.abs(state.dx) >= SWIPE_DISTANCE) { decide(state.dx > 0 ? 'saved' : 'skipped'); return; }
    const from = element.style.transform || 'none';
    element.style.transform = '';
    element.style.removeProperty('--discovery-swipe');
    kit.animateElement(element, [{ transform: from }, { transform: 'none' }], { duration: 'base', easing: 'spring' });
  };

  const sourceFor = (row: CatalogRow) => props.sources.find((source) => source.hostId === row.hostId);
  const top = deck.top;
  const next = deck.next;
  return h('div', {
    ref: rootRef, className: 'discovery-deck', tabIndex: 0, role: 'group', 'aria-roledescription': 'deck',
    'aria-label': deck.done ? 'Explore deck, all reviewed' : `Explore deck, card ${deck.position} of ${deck.total}. Right arrow to ${saveLabel.toLowerCase()}, left arrow to skip, Enter for details.`,
    onKeyDown,
  },
  h('div', { className: 'discovery-deck-progress' },
    h('span', { className: 'discovery-deck-count' }, deck.progressLabel),
    h('div', { className: 'discovery-deck-track', role: 'progressbar', 'aria-label': 'Cards reviewed', 'aria-valuemin': 0, 'aria-valuemax': deck.total, 'aria-valuenow': deck.decided },
      h('span', { className: 'discovery-deck-bar', style: { width: `${deck.total === 0 ? 0 : (deck.decided / deck.total) * 100}%` } }))),
  deck.done ? h('div', { className: 'discovery-deck-summary hq-enter-rise' },
    h('h3', null, `That's all ${plural(deck.total, 'source project')}`),
    h('p', null, props.canSave
      ? `${deck.saved} saved for Taste · ${deck.skipped} skipped${deck.saved > 0 ? '. Saved items are waiting in Taste.' : '.'}`
      : `${deck.saved} kept · ${deck.skipped} skipped.`),
    h('div', { className: 'discovery-deck-summary-actions' },
      h(kit.Button, { variant: 'primary', size: 'sm', onClick: props.onRestart }, 'Start over'),
      h(kit.Button, { variant: 'secondary', size: 'sm', onClick: props.onBackToGrid }, 'Back to grid')))
    : h('div', { className: 'discovery-deck-layout' },
      h('div', { className: 'discovery-deck-stage' },
        next ? h(DeckCard, { key: next.key, row: next, slot: 'next', service: props.service, kit, cache: props.cache, source: sourceFor(next), saveWord }) : null,
        top ? h(DeckCard, {
          key: top.key, row: top, slot: 'top', service: props.service, kit, cache: props.cache, source: sourceFor(top), saveWord,
          cardRef: (element) => { topRef.current = element; }, onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerEnd: pointerEnd,
        }) : null),
      top ? h('aside', { className: 'discovery-deck-aside', 'aria-label': 'Source facts' }, h(Facts, { row: top, source: sourceFor(top), kit })) : null),
  deck.done ? null : h('div', { className: 'discovery-deck-actions' },
    h(kit.Button, { variant: 'secondary', size: 'md', onClick: () => decide('skipped') }, 'Skip', h('kbd', null, '←')),
    h(kit.Button, { variant: 'ghost', size: 'md', onClick: () => { if (top) props.onOpen(top, rootRef.current!); } }, 'Details', h('kbd', null, 'Enter')),
    h(kit.Button, { variant: 'primary', size: 'md', onClick: () => decide('saved') }, saveLabel, h('kbd', null, '→'))),
  h('p', { className: 'discovery-visually-hidden', role: 'status', 'aria-live': 'polite' }, announcement));
}

// ---- the catalog -------------------------------------------------------------------------------

const VIEWPORT_PAD = 4;
type Mode = 'grid' | 'explore';

/** Catalog of read-only source projects: card grid and Explore deck, host and freshness status, windowed lazy previews. */
export function DiscoveryCatalog(props: DiscoveryCatalogProps): ReactElement {
  const { service } = props;
  const kit = props.kit ?? PLAIN_KIT;
  const toast = kit.useToast();
  const reduced = kit.useReducedMotion();
  const state = useSyncExternalStore((listener) => service.subscribe(listener), () => service.getState(), () => service.getState());
  const [query, setQuery] = useState('');
  const [hostFilter, setHostFilter] = useState<HostId | null>(null);
  const [mode, setMode] = useState<Mode>(props.defaultMode ?? 'grid');
  const [scrollTop, setScrollTop] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState(0);
  const [detailsKey, setDetailsKey] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<ReadonlyMap<string, DeckDecision>>(() => new Map());
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(() => new Set());
  const [holds, setHolds] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [pending, setPending] = useState(false);
  const [intro, setIntro] = useState<'playing' | 'done'>('playing');
  const [tick, setTick] = useState(0);
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const cache = useMemo(() => createUrlCache(), []);
  const focusRequest = useRef<number | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const nowRef = useRef(props.now ?? Date.now);
  nowRef.current = props.now ?? Date.now;
  const latest = useRef({ props, toast });
  latest.current = { props, toast };

  const now = useMemo(() => nowRef.current(), [state, tick]);
  const activeHost = hostFilter !== null && state.enrollments.some((item) => item.hostId === hostFilter) ? hostFilter : null;
  const viewOptions = (at: number): ViewOptions => ({
    now: at, ...(props.links ? { links: props.links } : {}), ...(props.adapterLabels ? { adapterLabels: props.adapterLabels } : {}),
  });
  const view = useMemo(() => buildCatalogView(state, { ...viewOptions(now), query, hostFilter: activeHost }),
    [state, now, query, activeHost, props.links, props.adapterLabels]);
  const rows = view.rows;
  useEffect(() => { void service.open(); }, [service]);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  // ---- grid geometry and window
  const canSave = props.onSendToTaste !== undefined;
  const metrics = gridMetrics(box.width, DEFAULT_GRID);
  const columns = Math.max(1, Math.floor(props.columns ?? metrics.columns));
  const rowHeight = props.rowHeight ?? metrics.rowHeight;
  const cardHeight = Math.max(1, rowHeight - DEFAULT_GRID.gap);
  const viewportHeight = props.viewportHeight ?? (box.height > 0 ? box.height : 480);
  const win = planGridWindow({ total: rows.length, columns, rowHeight, scrollTop, viewportHeight, prefetchRows: props.prefetchRows ?? 4 });
  const mounted = [...win.visible.map((index) => [index, 'visible'] as const), ...win.prefetch.map((index) => [index, 'prefetch'] as const)];
  const activeIndex = Math.min(active, Math.max(0, rows.length - 1));
  const tabbableIndex = mounted.some(([index]) => index === activeIndex) ? activeIndex : mounted[0]?.[0] ?? 0;

  useLayoutEffect(() => {
    if (!viewportEl) return undefined;
    const measure = () => setBox((previous) => {
      const next = { width: Math.max(0, viewportEl.clientWidth - VIEWPORT_PAD * 2), height: viewportEl.clientHeight };
      return previous.width === next.width && previous.height === next.height ? previous : next;
    });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(viewportEl);
    return () => observer.disconnect();
  }, [viewportEl]);

  // A resize changes the row height: re-read the scroll position so the window stays under the viewport.
  useLayoutEffect(() => { if (viewportEl) setScrollTop(viewportEl.scrollTop); }, [viewportEl, rowHeight]);

  const rowHeightRef = useRef(rowHeight);
  rowHeightRef.current = rowHeight;
  const lastRow = useRef(0);
  const onScroll = useCallback((event: { currentTarget: { scrollTop: number } }) => {
    const top = event.currentTarget.scrollTop;
    const row = Math.floor(top / rowHeightRef.current);
    if (row === lastRow.current) return;
    lastRow.current = row;
    setScrollTop(top);
  }, []);

  const resetScroll = () => { if (viewportEl) viewportEl.scrollTop = 0; lastRow.current = 0; setScrollTop(0); };

  // First load only: cards rise in one after another, then the class is dropped so later mounts do not replay it.
  useEffect(() => {
    if (intro !== 'playing' || rows.length === 0) return undefined;
    const timer = setTimeout(() => setIntro('done'), 700);
    return () => clearTimeout(timer);
  }, [intro, rows.length > 0]);

  const orderSignature = useMemo(() => rows.map((row) => row.key).join(','), [rows]);
  const listRef = kit.useListMotion(orderSignature);

  // ---- details
  const detailRow = detailsKey === null ? null : rows.find((row) => row.key === detailsKey) ?? null;
  const detailShown = useRef<CatalogRow | null>(null);
  if (detailRow) detailShown.current = detailRow;
  const wasOpen = useRef(false);
  const openDetails = useCallback((row: CatalogRow, trigger: HTMLElement) => {
    returnFocus.current = trigger;
    setDetailsKey(row.key);
  }, []);
  const closeDetails = useCallback(() => setDetailsKey(null), []);
  useEffect(() => {
    const open = detailRow !== null;
    if (open && !wasOpen.current) {
      rootRef.current?.querySelector<HTMLElement>('.discovery-details [data-autofocus]')?.focus({ preventScroll: true });
    } else if (!open && wasOpen.current) {
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [detailRow !== null]);

  // ---- keyboard focus in the grid
  const moveTo = (next: number) => {
    setActive(next);
    focusRequest.current = next;
    if (!viewportEl) return;
    const top = VIEWPORT_PAD + Math.floor(next / columns) * rowHeight;
    const bottom = top + cardHeight;
    if (top - VIEWPORT_PAD < viewportEl.scrollTop) viewportEl.scrollTop = Math.max(0, top - VIEWPORT_PAD);
    else if (bottom + VIEWPORT_PAD > viewportEl.scrollTop + viewportEl.clientHeight) viewportEl.scrollTop = bottom + VIEWPORT_PAD - viewportEl.clientHeight;
  };
  useEffect(() => {
    const target = focusRequest.current;
    if (target === null || !viewportEl) return;
    const node = viewportEl.querySelector<HTMLElement>(`[data-index="${target}"]`);
    if (!node) return;
    focusRequest.current = null;
    node.focus({ preventScroll: true });
  });
  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const card = event.target as HTMLElement;
    if (!card.matches('li[data-index]')) return; // arrows and Enter on a card's own buttons keep their meaning
    const index = Number(card.dataset['index']);
    if (!Number.isInteger(index)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const row = rows[index];
      if (row) openDetails(row, card);
      return;
    }
    const next = moveGridIndex(index, event.key, {
      columns, total: rows.length, ctrl: event.ctrlKey || event.metaKey, pageRows: Math.max(1, Math.floor(viewportHeight / rowHeight) - 1),
    });
    if (next === null) return;
    event.preventDefault();
    if (next !== index) moveTo(next);
  };

  // ---- sending to Taste
  const sendTaste = useCallback((row: CatalogRow) => {
    const handler = latest.current.props.onSendToTaste;
    if (!handler) return;
    handler(row, { imageUrl: row.preview ? cache.get(row.preview.digest) ?? null : null });
    setSaved((previous) => new Set(previous).add(row.key));
  }, [cache]);
  const onDecide = useCallback((row: CatalogRow, decision: DeckDecision) => {
    if (decision === 'saved') sendTaste(row);
    setDecisions((previous) => new Map(previous).set(row.key, decision));
  }, [sendTaste]);
  const requestLink = props.onRequestLink;

  // ---- refresh
  const refreshingHosts = state.refreshing.length;
  const refreshing = pending || refreshingHosts > 0;
  const runRefresh = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setHolds(new Map());
    const { props: current } = latest.current;
    const options = (at: number): ViewOptions => ({
      now: at, ...(current.links ? { links: current.links } : {}), ...(current.adapterLabels ? { adapterLabels: current.adapterLabels } : {}),
    });
    const before = buildCatalogView(service.getState(), options(nowRef.current())).rows;
    let report: RefreshReport | null = null;
    try {
      const hold = new Promise<void>((resolve) => { setTimeout(resolve, current.minBusyMs ?? 450); });
      [report] = await Promise.all([service.refresh(), hold]);
    } catch {
      report = null;
    }
    pendingRef.current = false;
    const after = buildCatalogView(service.getState(), options(nowRef.current()));
    const summary = summarizeRefresh({ report, before, after });
    const notify = latest.current.toast;
    const body = {
      id: 'discovery-refresh',
      ...(summary.description !== null ? { description: summary.description } : {}),
      ...(summary.meta !== null ? { meta: summary.meta } : {}),
    };
    if (summary.tone === 'danger') notify.error(summary.title, { ...body, action: { label: 'Retry', onAction: () => { void runRefresh(); } } });
    else notify.show({ ...body, tone: summary.tone === 'success' ? 'success' : 'info', title: summary.title });
    setHolds(new Map(summary.problems.filter((problem) => problem.kind === 'held').map((problem) => [problem.hostId as string, problem.message])));
    if (summary.addedKeys.length > 0) {
      setFlashing(new Set(summary.addedKeys));
      setTimeout(() => setFlashing(new Set()), 1800);
    }
    setPending(false);
  }, [service]);

  // ---- render
  const toggleHost = (host: HostId) => { setHostFilter((current) => current === host ? null : host); setActive(0); resetScroll(); };
  const clearFilters = () => { setHostFilter(null); setQuery(''); setActive(0); resetScroll(); };
  const narrowed = activeHost !== null || query.trim() !== '';
  const hostLabel = activeHost === null ? null : view.sources.find((source) => source.hostId === activeHost)?.label ?? null;
  const setSearch = (value: string) => { setQuery(value); setActive(0); resetScroll(); };
  const notOpened = !state.opened;
  const showDetails = detailShown.current;

  const modeButton = (value: Mode, label: string) => h('button', {
    type: 'button', className: 'discovery-mode-button hq-press', 'aria-pressed': mode === value,
    onClick: () => { setMode(value); setDetailsKey(null); },
  }, label);

  return h('section', {
    ref: rootRef, className: 'discovery-catalog', 'aria-labelledby': 'discovery-title', 'data-mode': mode, 'data-details': detailRow ? 'open' : 'closed',
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape' && detailRow) { event.stopPropagation(); closeDetails(); }
    },
  },
  h('header', { className: 'discovery-head' },
    h('div', { className: 'discovery-heading' },
      h('h2', { id: 'discovery-title' }, 'Source projects'),
      h('span', { className: 'discovery-cache', role: 'status' }, view.cacheLabel)),
    h('div', { className: 'discovery-actions' },
      refreshing ? h(kit.StatusIndicator, {
        tone: 'neutral', busy: true, label: 'Refreshing…', className: 'discovery-refreshing',
        ...(view.sources.length > 1 ? { detail: `${Math.max(0, view.sources.length - refreshingHosts)} of ${view.sources.length}` } : {}),
      }) : null,
      h('div', { className: 'discovery-mode', role: 'group', 'aria-label': 'View' }, modeButton('grid', 'Grid'), modeButton('explore', 'Explore')),
      h(kit.Button, { variant: 'secondary', size: 'md', busy: refreshing, busyLabel: 'Refreshing…', className: 'discovery-refresh', onClick: () => { void runRefresh(); } }, 'Refresh'))),
  h('div', { className: 'discovery-filter' },
    h('input', {
      type: 'search', className: 'discovery-search', placeholder: 'Filter by name or path', 'aria-label': 'Filter source projects', value: query,
      onChange: (event: { target: { value: string } }) => setSearch(event.target.value),
    }),
    h('span', { className: 'discovery-count', role: 'status' }, view.countLabel, hostLabel ? ` · ${hostLabel}` : ''),
    narrowed ? h(kit.Button, { variant: 'ghost', size: 'sm', onClick: clearFilters }, 'Show all') : null),
  h(SourceStrip, { sources: view.sources, kit, active: activeHost, onToggle: toggleHost }),
  h('div', { className: 'discovery-notices' },
    view.sources.map((source) => h(SourceNotice, {
      key: source.hostId, source, hold: holds.get(source.hostId), kit, busy: refreshing, onRetry: () => { void runRefresh(); },
      onDismiss: () => setHolds((previous) => { const next = new Map(previous); next.delete(source.hostId); return next; }),
    }))),
  view.emptyLabel ? h('p', { className: 'discovery-empty' }, view.emptyLabel) : null,
  notOpened && rows.length === 0 ? h('div', { className: 'discovery-loading', 'aria-busy': true },
    Array.from({ length: 4 }, (_, index) => h('div', { key: index, className: 'discovery-loading-card' }, h(kit.Skeleton, { shape: 'block' })))) : null,
  rows.length === 0 ? null : h('div', { className: 'discovery-body' },
    h('div', { className: 'discovery-main' },
      mode === 'grid' ? h('div', {
        ref: setViewportEl, className: 'discovery-viewport', role: 'region', 'aria-label': 'Source project list', onScroll,
        // The padding leaves room for focus rings and the hover lift; the negative margin keeps the cards aligned with the toolbar above.
        style: { padding: VIEWPORT_PAD, marginInline: -VIEWPORT_PAD, ...(props.viewportHeight !== undefined ? { height: props.viewportHeight } : {}) },
      },
      h('div', { className: 'discovery-spacer', style: { height: win.totalHeight } },
        h('ul', {
          ref: listRef, role: 'list', className: joinClass('discovery-window', intro === 'playing' && 'hq-stagger'), onKeyDown: onGridKeyDown,
          style: {
            top: win.offsetTop, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: `${cardHeight}px`, columnGap: DEFAULT_GRID.gap, rowGap: DEFAULT_GRID.gap,
          } satisfies CSSProperties,
        }, mounted.map(([index, priority]) => h(Card, {
          key: rows[index]!.key, row: rows[index]!, index, total: rows.length, priority, tabbable: index === tabbableIndex, height: cardHeight, service, kit, cache,
          saved: saved.has(rows[index]!.key) || decisions.get(rows[index]!.key) === 'saved', flash: flashing.has(rows[index]!.key),
          onSave: canSave ? sendTaste : undefined, onLink: requestLink, onOpen: openDetails, onFocusCard: setActive,
        })))))
        : h(Deck, {
          rows, decisions, sources: view.sources, service, kit, cache, reduced, canSave, onDecide, onOpen: openDetails,
          onRestart: () => setDecisions(new Map()), onBackToGrid: () => setMode('grid'),
        })),
    h('div', { className: 'discovery-scrim', 'aria-hidden': true, onClick: closeDetails }),
    h(kit.Presence, { show: detailRow !== null, motion: 'slide-end', as: 'aside', className: 'discovery-details-slot' },
      showDetails ? h(Details, {
        row: showDetails, source: view.sources.find((source) => source.hostId === showDetails.hostId), service, kit, cache,
        saved: saved.has(showDetails.key) || decisions.get(showDetails.key) === 'saved', onSave: canSave ? sendTaste : undefined, onLink: requestLink, onClose: closeDetails,
      }) : null)));
}

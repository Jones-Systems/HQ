import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FRESHNESS_STATUSES, type FreshnessStatus } from '../contract.ts';
import type { ProjectsController, ProjectsSnapshot } from '../controller.ts';
import type { GalleryGrouping, GalleryItem, GalleryOrigin, GallerySort } from '../gallery.ts';
import { DEFAULT_GRID_METRICS, layoutGrid, planThumbnails, visibleBlocks, type GridBlock } from '../grid.ts';
import { parseHostId } from '../ids.ts';
import type { Priority } from '../loader.ts';
import { CLEARED_FILTERS, count, filterControls, filtersActive, galleryPhase, shownItems, type FilterControls } from '../view-model.ts';
import { Chevron } from './chevron.ts';
import { ActionButton } from './controls.ts';
import { NewProjectForm } from './forms.ts';
import { CaptureFrame } from './frame.ts';
import { scrollParent, usePrefetch, useReflowWindow, useSize } from './hooks.ts';
import { useProjectsUi } from './ui.ts';

export { count } from '../view-model.ts';

export interface GalleryViewOptions {
  /** Viewport used before the scroll container is measured (and for server rendering). */
  readonly initialViewport?: { readonly width: number; readonly height: number };
  readonly onOpenSource?: (item: Extract<GalleryItem, { kind: 'source' }>, trigger: HTMLButtonElement) => void;
  readonly prefetchRows?: number;
  readonly maxPrefetch?: number;
  /** Controls for choosing and refreshing source folders, offered where the desktop provides them. */
  readonly folders?: ReactNode;
}

const FRESHNESS_LABELS: Record<FreshnessStatus, string> = {
  fresh: 'Fresh', stale: 'Stale', offline: 'Offline', timeout: 'Timed out', error: 'Refresh failed',
  partial: 'Partial', 'missing-at-source': 'Missing at source',
};

/** Tiles a little wider and taller than the stock grid so a capture reads at a glance. */
const GALLERY_METRICS = { ...DEFAULT_GRID_METRICS, minTileWidth: 232, tileHeight: 236, headerHeight: 40 };
/** Room around the grid so a lifted tile's shadow is not clipped by the scroller. Matches `.hqp-scroller` padding. */
const EDGE = 6;

const PLUS = h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' },
  h('path', { d: 'M8 3.5v9M3.5 8h9' }));
const SEARCH = h('svg', { className: 'hqp-search-icon', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' },
  h('circle', { cx: 7, cy: 7, r: 4.25 }), h('path', { d: 'm10.5 10.5 3 3' }));

function Tile({ controller, item, position, total, priority, live, onOpenSource }: {
  controller: ProjectsController; item: GalleryItem; position: number; total: number; priority: Priority;
  /** False until the grid is measured, so a provisional first layout requests nothing. */
  live: boolean;
  onOpenSource?: GalleryViewOptions['onOpenSource'];
}) {
  const projectId = item.kind === 'workspace' ? item.projectId : null;
  const hasSummary = item.kind === 'workspace' && item.summary !== undefined;
  useEffect(() => (live && projectId && !hasSummary ? controller.requestSummary(projectId, priority) : undefined), [controller, projectId, hasSummary, priority, live]);
  if (item.kind === 'workspace') {
    const summary = item.summary;
    return h('button', {
      type: 'button', className: 'hqp-tile hq-lift hq-press', 'data-key': item.key, 'aria-posinset': position, 'aria-setsize': total,
      onClick: () => controller.openProject(item.projectId),
    }, h(CaptureFrame, { loader: controller.thumbnails, preview: item.thumbnail, priority, live, empty: summary && summary.versionCount === 0 ? 'No captures yet' : 'No preview' }),
    h('span', { className: 'hqp-tile-title' }, item.title),
    summary
      ? h('span', { className: 'hqp-tile-meta' }, `${count(summary.viewCount, 'view')} · ${count(summary.versionCount, 'version')}`)
      : h('span', { className: 'hqp-tile-meta hq-shimmer-text' }, 'Loading details…'),
    h('span', { className: 'hqp-badges' }, h('span', { className: 'hqp-badge hqp-badge-workspace' }, 'Workspace')));
  }
  return h(onOpenSource ? 'button' : 'article', {
    ...(onOpenSource ? { type: 'button', onClick: (event: { currentTarget: HTMLButtonElement }) => onOpenSource(item, event.currentTarget) } : {}),
    className: `hqp-tile hqp-tile-source${onOpenSource ? ' hq-lift hq-press' : ''}`, 'data-key': item.key, 'aria-posinset': position, 'aria-setsize': total,
    'aria-label': `${item.title} on ${item.hostLabel}, read-only source entry`,
  }, h(CaptureFrame, { loader: controller.thumbnails, preview: item.thumbnail, priority, live }),
  h('span', { className: 'hqp-tile-title' }, item.title),
  h('span', { className: 'hqp-tile-meta' }, `${item.hostLabel} · ${item.relativePath}`),
  h('span', { className: 'hqp-badges' },
    h('span', { className: 'hqp-badge hqp-badge-host' }, item.hostLabel),
    h('span', { className: `hqp-badge hqp-fresh-${item.freshness.status}` }, FRESHNESS_LABELS[item.freshness.status]),
    h('span', { className: 'hqp-badge' }, 'Read-only'),
    item.linkedProjectIds.length > 0 ? h('span', { className: 'hqp-badge hqp-badge-linked' }, `Linked ×${item.linkedProjectIds.length}`) : null));
}

function FilterBar({ controller, snapshot, controls, shown, total }: {
  controller: ProjectsController; snapshot: ProjectsSnapshot; controls: FilterControls; shown: number; total: number;
}) {
  const ui = useProjectsUi();
  const { filters } = snapshot.session.gallery;
  const hosts = useMemo(() => {
    const known = new Map<string, string>();
    for (const entry of snapshot.catalog) known.set(entry.hostId, entry.hostLabel);
    return [...known.entries()];
  }, [snapshot.catalog]);
  const active = filtersActive(filters);
  const pick = (label: string, value: string, options: ReadonlyArray<readonly [string, string]>, onChange: (value: string) => void) =>
    h('label', { className: 'hqp-pick' }, h('span', null, label),
      h('select', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) },
        options.map(([optionValue, text]) => h('option', { key: optionValue, value: optionValue }, text))));
  return h(ui.Presence, { show: controls.bar, motion: 'drop', initial: false, className: 'hqp-filterbar-wrap' },
    h('div', { className: 'hqp-filterbar', role: 'search', 'aria-label': 'Filter projects' },
      controls.search ? h('label', { className: 'hqp-search' }, SEARCH,
        h('input', { type: 'search', 'aria-label': 'Search projects', value: filters.query, placeholder: 'Search projects', autoComplete: 'off',
          onChange: (event: { target: { value: string } }) => controller.setGalleryFilters({ query: event.target.value }) })) : null,
      controls.origin ? pick('Show', filters.origin, [['all', 'All'], ['workspace', 'Workspace'], ['source', 'Source catalog']],
        (value) => controller.setGalleryFilters({ origin: value as GalleryOrigin })) : null,
      controls.host ? pick('Host', filters.hosts[0] ?? '', [['', 'Any host'], ...hosts.map(([id, label]) => [id, label] as const)],
        (value) => { const host = parseHostId(value); controller.setGalleryFilters({ hosts: host ? [host] : [] }); }) : null,
      controls.freshness ? pick('Freshness', filters.freshness[0] ?? '', [['', 'Any status'], ...FRESHNESS_STATUSES.map((status) => [status, FRESHNESS_LABELS[status]] as const)],
        (value) => controller.setGalleryFilters({ freshness: value ? [value as FreshnessStatus] : [] })) : null,
      controls.group ? pick('Group', filters.groupBy, [['origin', 'Origin'], ['host', 'Host'], ['freshness', 'Freshness'], ['none', 'None']],
        (value) => controller.setGalleryFilters({ groupBy: value as GalleryGrouping })) : null,
      controls.sort ? pick('Sort', filters.sort, [['name', 'Name'], ['recent', 'Recent']],
        (value) => controller.setGalleryFilters({ sort: value as GallerySort })) : null,
      active ? h('button', { type: 'button', className: 'hq-btn hq-btn--ghost hq-btn--sm', onClick: () => controller.setGalleryFilters(CLEARED_FILTERS) }, 'Clear filters') : null,
      h('span', { className: 'hqp-filter-status', role: 'status' }, active ? `Showing ${shown} of ${total}` : '')));
}

function GroupHeader({ controller, block }: { controller: ProjectsController; block: Extract<GridBlock, { type: 'header' }> }) {
  const { group } = block;
  return h('h2', { className: 'hqp-group' },
    h('button', { type: 'button', 'aria-expanded': !group.collapsed, onClick: () => controller.toggleGroup(group.key) },
      h(Chevron, { direction: 'down' }),
      group.label, h('span', { className: 'hqp-count' }, String(group.total))));
}

function Cell({ block, reflowing, visible, children }: { block: GridBlock; reflowing: boolean; visible: boolean; children: ReactNode }) {
  // Only a cell that appears while the list reflows fades in; scrolling cells and the first layout appear at once.
  const [entering] = useState(reflowing);
  const tile = block.type === 'tile';
  return h('div', {
    role: tile ? 'listitem' : 'presentation',
    className: `hqp-cell${tile ? '' : ' hqp-cell-header'}${entering ? ' hq-enter-fade' : ''}`,
    'data-visible': tile ? visible : undefined,
    style: tile
      ? { transform: `translate(${block.x}px, ${block.y}px)`, width: `${block.width}px`, height: `${block.height}px` }
      : { transform: `translate(0px, ${block.y}px)`, height: `${block.height}px` },
  }, children);
}

function StatePanel({ title, role, children }: { title: string; role?: 'status' | 'alert'; children: ReactNode }) {
  return h('section', { className: 'hqp-state', role }, h('h2', null, title), children);
}

function LoadingTiles() {
  const ui = useProjectsUi();
  return h('div', { className: 'hqp-loading', 'aria-busy': true },
    h('p', { className: 'hqp-status-text', role: 'status' }, 'Loading projects…'),
    h('div', { className: 'hqp-skeleton-grid', 'aria-hidden': true },
      Array.from({ length: 6 }, (_, index) => h('div', { key: index, className: 'hqp-tile hqp-tile-skeleton' },
        h('span', { className: 'hqp-frame' }, h(ui.Skeleton, { shape: 'block', className: 'hqp-skeleton' })),
        h(ui.Skeleton, { shape: 'text', width: '62%' }), h(ui.Skeleton, { shape: 'text', width: '38%' })))));
}

/** Virtualized gallery grid: renders only blocks near the viewport and lazily requests their thumbnails. */
export function GalleryView({ controller, snapshot, options = {}, focusTitle = false }: {
  controller: ProjectsController; snapshot: ProjectsSnapshot; options?: GalleryViewOptions;
  /** Move focus to the page title on arrival, so keyboard and screen reader users land on the new screen. */
  focusTitle?: boolean;
}) {
  const ui = useProjectsUi();
  const viewport = options.initialViewport ?? { width: 960, height: 720 };
  const root = useRef<HTMLElement | null>(null);
  const title = useRef<HTMLHeadingElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const restored = useRef(false);
  const { width, height, measured } = useSize(scroller, viewport);
  const [scrollTop, setScrollTop] = useState(snapshot.session.gallery.scroll);
  const [creating, setCreating] = useState(false);
  const { registry, gallery: groups } = snapshot;
  const { filters } = snapshot.session.gallery;
  const projects = registry.projects.length;
  const sources = snapshot.catalog.length;
  const total = projects + sources;
  const shown = shownItems(groups);
  const phase = galleryPhase({ registryStatus: registry.status, total, shown });
  const hostCount = useMemo(() => new Set(snapshot.catalog.map((entry) => entry.hostId)).size, [snapshot.catalog]);
  const controls = filterControls({ projects, sources, hosts: hostCount, filters });

  // One group needs no header; its tiles start at the top.
  const single = groups.length === 1 && !groups[0]!.collapsed;
  const metrics = useMemo(() => ({ ...GALLERY_METRICS, headerHeight: single ? 0 : GALLERY_METRICS.headerHeight }), [single]);
  const layout = useMemo(() => layoutGrid(groups, { width: Math.max(0, width - 2 * EDGE), ...metrics }), [groups, width, metrics]);
  const signature = useMemo(() => `${layout.columns}:${layout.blocks.map((block) => block.key).join('|')}`, [layout]);
  const reflowing = useReflowWindow(signature, canvas);
  const blocks = visibleBlocks(layout, scrollTop, height, metrics.tileHeight);
  const visibleRange = visibleBlocks(layout, scrollTop, height);
  const plan = planThumbnails(layout, scrollTop, height, { prefetchRows: options.prefetchRows ?? 2, maxPrefetch: options.maxPrefetch ?? 12 });
  usePrefetch(controller.thumbnails, measured && phase === 'ready' ? plan.prefetch : []);

  useLayoutEffect(() => {
    // The page scrolls the whole section; start a freshly opened gallery at its top.
    const port = scrollParent(root.current);
    if (port) port.scrollTop = 0;
    if (focusTitle) title.current?.focus({ preventScroll: true });
    // Mount only.
  }, []);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || restored.current) return;
    // Restore the remembered gallery position the first time the grid is shown.
    restored.current = true;
    node.scrollTop = snapshot.session.gallery.scroll;
    setScrollTop(node.scrollTop);
  }, [phase]);

  const tiles = blocks.filter((block) => block.type === 'tile');
  const tileIndex = new Map<string, number>();
  let index = 0;
  for (const group of groups) for (const item of group.items) tileIndex.set(item.key, ++index);
  const visibleKeys = new Set(visibleRange.filter((block) => block.type === 'tile').map((block) => block.key));

  const closeCreate = () => { setCreating(false); opener.current?.focus(); };
  const createSlot = h(ui.Presence, { show: creating, motion: 'collapse', initial: false, className: 'hqp-slot' },
    h('div', { className: 'hqp-slot-body' }, h(NewProjectForm, { controller, onClose: closeCreate })));
  const newProject = h(ActionButton, {
    label: 'New project', variant: 'primary', icon: PLUS, expanded: creating, onClick: () => setCreating(true), buttonRef: opener,
  });

  const header = h('header', { className: 'hqp-page-head' },
    h('div', { className: 'hqp-head-text' },
      h('div', { className: 'hqp-title-row' },
        h('h1', { className: 'hqp-title', ref: title, tabIndex: -1 }, 'Projects'),
        h('span', { className: 'hqp-count-pill', 'aria-label': `${count(total, 'item')}` }, String(total)),
        h('span', {
          className: `hqp-badge ${registry.provenance.kind === 'provisional-local' ? 'hqp-badge-warning' : ''}`,
          title: registry.provenance.label, 'data-registry': registry.provenance.kind,
        }, registry.provenance.kind === 'provisional-local' ? 'On this device' : 'HQ registry')),
      h('p', { className: 'hqp-meta' }, registry.status === 'loading' && projects === 0
        ? 'Loading projects…'
        : `${count(projects, 'project')}${sources > 0 ? ` · ${count(sources, 'read-only source')}` : ''} · ${registry.provenance.label}`)),
    phase === 'empty' ? null : h('div', { className: 'hqp-head-actions' }, newProject));

  return h('section', { ref: root, className: 'hqp-gallery', 'aria-label': 'Project gallery' },
    header,
    phase === 'empty' ? null : createSlot,
    h(ui.Presence, { show: registry.status === 'error' && phase !== 'error', motion: 'collapse', initial: false },
      h('div', { className: 'hqp-slot-body' }, h(ui.InlineNotice, {
        tone: 'warning', variant: 'bar', title: "Couldn't refresh projects", live: 'polite',
        actions: [{ label: 'Retry', onAction: () => void controller.refreshRegistry() }],
      }, 'Showing the last list. Nothing was changed.'))),
    options.folders && phase !== 'empty' ? h('div', { className: 'hqp-folders' }, options.folders) : null,
    phase === 'empty' || phase === 'loading' || phase === 'error' ? null : h(FilterBar, { controller, snapshot, controls, shown, total }),
    phase === 'loading' ? h(LoadingTiles) : null,
    phase === 'error' ? h(StatePanel, { title: "Couldn't load your projects", role: 'alert' },
      h('p', null, `${registry.error ?? 'The project list did not load.'} Nothing was changed.`),
      h('div', { className: 'hqp-form-actions' }, h('button', { type: 'button', className: 'hq-btn hq-btn--secondary', onClick: () => void controller.refreshRegistry() }, 'Try again'))) : null,
    phase === 'empty' ? h(StatePanel, { title: 'No projects yet' },
      h('p', null, 'Create a project to collect captures of your pages and screens, compare versions and ask for changes.'),
      creating ? createSlot : h('div', { className: 'hqp-form-actions' }, newProject),
      options.folders ? h('div', { className: 'hqp-folders hqp-folders-empty' }, options.folders) : null) : null,
    phase === 'no-match' ? h(StatePanel, { title: 'No projects match', role: 'status' },
      h('p', null, 'No projects match these filters.'),
      h('div', { className: 'hqp-form-actions' }, h('button', { type: 'button', className: 'hq-btn hq-btn--secondary', onClick: () => controller.setGalleryFilters(CLEARED_FILTERS) }, 'Clear filters'))) : null,
    phase === 'ready' ? h('div', {
      ref: scroller, className: 'hqp-scroller', tabIndex: -1, 'data-rendered-tiles': tiles.length, 'data-total-tiles': total,
      style: { height: `${layout.totalHeight + 2 * EDGE}px` },
      onScroll: (event: { currentTarget: HTMLDivElement }) => {
        const top = event.currentTarget.scrollTop;
        setScrollTop(top);
        controller.setGalleryScroll(top);
      },
    }, h('div', { ref: canvas, className: 'hqp-canvas', role: 'list', 'data-reflow': reflowing, style: { height: `${layout.totalHeight}px` } },
      blocks.filter((block) => !(single && block.type === 'header')).map((block) => h(Cell, {
        key: block.key, block, reflowing, visible: block.type === 'tile' && visibleKeys.has(block.key),
      }, block.type === 'tile'
        ? h(Tile, { controller, item: block.item, position: tileIndex.get(block.key) ?? 0, total: tileIndex.size,
          priority: visibleKeys.has(block.key) ? 'visible' : 'prefetch', live: measured, onOpenSource: options.onOpenSource })
        : h(GroupHeader, { controller, block }))))) : null);
}

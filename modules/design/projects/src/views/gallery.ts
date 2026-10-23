import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FRESHNESS_STATUSES, type FreshnessStatus } from '../contract.ts';
import type { ProjectsController, ProjectsSnapshot } from '../controller.ts';
import type { GalleryGrouping, GalleryItem, GalleryOrigin, GallerySort } from '../gallery.ts';
import { DEFAULT_GRID_METRICS, layoutGrid, planThumbnails, visibleBlocks, type GridBlock } from '../grid.ts';
import { parseHostId } from '../ids.ts';
import type { Priority } from '../loader.ts';
import { usePrefetch, useSize, useThumbnail } from './hooks.ts';

export interface GalleryViewOptions {
  /** Viewport used before the scroll container is measured (and for server rendering). */
  readonly initialViewport?: { readonly width: number; readonly height: number };
  readonly onOpenSource?: (item: Extract<GalleryItem, { kind: 'source' }>, trigger: HTMLButtonElement) => void;
  readonly prefetchRows?: number;
  readonly maxPrefetch?: number;
}

export const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? '' : 's'}`;

const FRESHNESS_LABELS: Record<FreshnessStatus, string> = {
  fresh: 'Fresh', stale: 'Stale', offline: 'Offline', timeout: 'Timed out', error: 'Refresh failed',
  partial: 'Partial', 'missing-at-source': 'Missing at source',
};

function Thumbnail({ controller, item, priority, live }: { controller: ProjectsController; item: GalleryItem; priority: Priority; live: boolean }) {
  const state = useThumbnail(controller.thumbnails, live ? item.thumbnail : undefined, priority);
  if (!item.thumbnail) return h('div', { className: 'hqp-thumb hqp-thumb-empty', 'aria-hidden': true }, 'No preview');
  if (state.status === 'ready') {
    return h('img', { className: 'hqp-thumb', src: state.value, alt: '', decoding: 'async', draggable: false,
      width: item.thumbnail.w, height: item.thumbnail.h, 'data-digest': item.thumbnail.digest });
  }
  return h('div', { className: `hqp-thumb hqp-thumb-${state.status}`, 'aria-hidden': true, 'data-digest': item.thumbnail.digest },
    state.status === 'error' ? 'Preview unavailable' : '');
}

function Tile({ controller, item, position, total, priority, live, onOpenSource }: {
  controller: ProjectsController; item: GalleryItem; position: number; total: number; priority: Priority;
  /** False until the grid is measured, so a provisional first layout requests nothing. */
  live: boolean;
  onOpenSource?: GalleryViewOptions['onOpenSource'];
}) {
  const projectId = item.kind === 'workspace' ? item.projectId : null;
  const hasSummary = item.kind === 'workspace' && item.summary !== undefined;
  useEffect(() => (live && projectId && !hasSummary ? controller.requestSummary(projectId, priority) : undefined), [controller, projectId, hasSummary, priority, live]);
  const thumb = h(Thumbnail, { controller, item, priority, live });
  if (item.kind === 'workspace') {
    const meta = item.summary ? `${count(item.summary.viewCount, 'view')} · ${count(item.summary.versionCount, 'version')}` : 'Loading details…';
    return h('button', {
      type: 'button', className: 'hqp-tile', 'data-key': item.key, 'aria-posinset': position, 'aria-setsize': total,
      onClick: () => controller.openProject(item.projectId),
    }, thumb, h('span', { className: 'hqp-tile-title' }, item.title),
    h('span', { className: 'hqp-tile-meta' }, meta),
    h('span', { className: 'hqp-badges' }, h('span', { className: 'hqp-badge hqp-badge-workspace' }, 'Workspace')));
  }
  return h(onOpenSource ? 'button' : 'article', {
    ...(onOpenSource ? { type: 'button', onClick: (event: { currentTarget: HTMLButtonElement }) => onOpenSource(item, event.currentTarget) } : {}),
    className: 'hqp-tile hqp-tile-source', 'data-key': item.key, 'aria-posinset': position, 'aria-setsize': total,
    'aria-label': `${item.title} on ${item.hostLabel}, read-only source entry`,
  }, thumb, h('span', { className: 'hqp-tile-title' }, item.title),
  h('span', { className: 'hqp-tile-meta' }, `${item.hostLabel} · ${item.relativePath}`),
  h('span', { className: 'hqp-badges' },
    h('span', { className: 'hqp-badge hqp-badge-host' }, item.hostLabel),
    h('span', { className: `hqp-badge hqp-fresh-${item.freshness.status}` }, FRESHNESS_LABELS[item.freshness.status]),
    h('span', { className: 'hqp-badge' }, 'Read-only'),
    item.linkedProjectIds.length > 0 ? h('span', { className: 'hqp-badge hqp-badge-linked' }, `Linked ×${item.linkedProjectIds.length}`) : null));
}

function Filters({ controller, snapshot }: { controller: ProjectsController; snapshot: ProjectsSnapshot }) {
  const { filters } = snapshot.session.gallery;
  const hosts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of snapshot.catalog) seen.set(entry.hostId, entry.hostLabel);
    return [...seen.entries()];
  }, [snapshot.catalog]);
  const select = (label: string, value: string, options: ReadonlyArray<readonly [string, string]>, onChange: (value: string) => void) =>
    h('label', { className: 'hqp-field' }, h('span', null, label),
      h('select', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) },
        options.map(([optionValue, text]) => h('option', { key: optionValue, value: optionValue }, text))));
  return h('div', { className: 'hqp-filters', role: 'search' },
    h('label', { className: 'hqp-field hqp-field-grow' }, h('span', null, 'Search'),
      h('input', { type: 'search', value: filters.query, placeholder: 'Filter projects',
        onChange: (event: { target: { value: string } }) => controller.setGalleryFilters({ query: event.target.value }) })),
    select('Show', filters.origin, [['all', 'All'], ['workspace', 'Workspace'], ['source', 'Source catalog']],
      (value) => controller.setGalleryFilters({ origin: value as GalleryOrigin })),
    select('Host', filters.hosts[0] ?? '', [['', 'Any host'], ...hosts.map(([id, label]) => [id, label] as const)],
      (value) => { const host = parseHostId(value); controller.setGalleryFilters({ hosts: host ? [host] : [] }); }),
    select('Freshness', filters.freshness[0] ?? '', [['', 'Any status'], ...FRESHNESS_STATUSES.map((status) => [status, FRESHNESS_LABELS[status]] as const)],
      (value) => controller.setGalleryFilters({ freshness: value ? [value as FreshnessStatus] : [] })),
    select('Group', filters.groupBy, [['origin', 'Origin'], ['host', 'Host'], ['freshness', 'Freshness'], ['none', 'None']],
      (value) => controller.setGalleryFilters({ groupBy: value as GalleryGrouping })),
    select('Sort', filters.sort, [['name', 'Name'], ['recent', 'Recent']],
      (value) => controller.setGalleryFilters({ sort: value as GallerySort })));
}

function Header({ controller, block }: { controller: ProjectsController; block: Extract<GridBlock, { type: 'header' }> }) {
  const { group } = block;
  return h('h2', { className: 'hqp-group' },
    h('button', { type: 'button', 'aria-expanded': !group.collapsed, onClick: () => controller.toggleGroup(group.key) },
      h('span', { className: 'hqp-chevron', 'aria-hidden': true }),
      group.label, h('span', { className: 'hqp-count' }, String(group.total))));
}

/** Virtualized gallery grid: renders only blocks near the viewport and lazily requests their thumbnails. */
export function GalleryView({ controller, snapshot, options = {} }: { controller: ProjectsController; snapshot: ProjectsSnapshot; options?: GalleryViewOptions }) {
  const viewport = options.initialViewport ?? { width: 960, height: 720 };
  const scroller = useRef<HTMLDivElement | null>(null);
  const { width, height, measured } = useSize(scroller, viewport);
  const [scrollTop, setScrollTop] = useState(snapshot.session.gallery.scroll);
  const layout = useMemo(() => layoutGrid(snapshot.gallery, { width, ...DEFAULT_GRID_METRICS }), [snapshot.gallery, width]);
  const blocks = visibleBlocks(layout, scrollTop, height, DEFAULT_GRID_METRICS.tileHeight);
  const visibleRange = visibleBlocks(layout, scrollTop, height);
  const plan = planThumbnails(layout, scrollTop, height, { prefetchRows: options.prefetchRows ?? 2, maxPrefetch: options.maxPrefetch ?? 12 });
  usePrefetch(controller.thumbnails, measured ? plan.prefetch : []);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    // Restore the remembered gallery position when the gallery is shown again.
    node.scrollTop = snapshot.session.gallery.scroll;
    setScrollTop(node.scrollTop);
    // Mount only: later positions come from the element's own scroll events.
  }, []);

  const tiles = blocks.filter((block) => block.type === 'tile');
  const total = snapshot.gallery.reduce((sum, group) => sum + group.items.length, 0);
  const tileIndex = new Map<string, number>();
  let index = 0;
  for (const group of snapshot.gallery) for (const item of group.items) tileIndex.set(item.key, ++index);
  const visibleKeys = new Set(visibleRange.filter((block) => block.type === 'tile').map((block) => block.key));

  return h('section', { className: 'hqp-gallery', 'aria-label': 'Project gallery' },
    h(Filters, { controller, snapshot }),
    snapshot.gallery.length === 0
      ? h('p', { className: 'hqp-empty' }, snapshot.registry.status === 'loading' ? 'Loading projects…' : 'No projects match these filters.')
      : null,
    h('div', {
      ref: scroller, className: 'hqp-scroller', tabIndex: -1, 'data-rendered-tiles': tiles.length, 'data-total-tiles': total,
      onScroll: (event: { currentTarget: HTMLDivElement }) => {
        const top = event.currentTarget.scrollTop;
        setScrollTop(top);
        controller.setGalleryScroll(top);
      },
    }, h('div', { className: 'hqp-canvas', role: 'list', style: { height: `${layout.totalHeight}px` } },
      blocks.map((block) => h('div', {
        key: block.key, role: block.type === 'tile' ? 'listitem' : 'presentation',
        className: block.type === 'tile' ? 'hqp-cell' : 'hqp-cell hqp-cell-header',
        'data-visible': block.type === 'tile' ? visibleKeys.has(block.key) : undefined,
        style: block.type === 'tile'
          ? { transform: `translate(${block.x}px, ${block.y}px)`, width: `${block.width}px`, height: `${block.height}px` }
          : { transform: `translate(0px, ${block.y}px)`, height: `${block.height}px` },
      }, block.type === 'tile'
        ? h(Tile, { controller, item: block.item, position: tileIndex.get(block.key) ?? 0, total,
          priority: visibleKeys.has(block.key) ? 'visible' : 'prefetch', live: measured, onOpenSource: options.onOpenSource })
        : h(Header, { controller, block }))))));
}

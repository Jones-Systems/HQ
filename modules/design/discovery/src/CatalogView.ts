/**
 * React catalog view. Written with `createElement` (no JSX) so Node's built-in test runner can render it
 * with type stripping alone. The first render uses whatever the cache already holds; previews are
 * requested only by mounted, visible tiles and are withdrawn when a tile unmounts.
 */
import { createElement as h, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactElement } from 'react';
import type { WorkspaceSourceLink } from './contract.ts';
import type { DiscoveryService } from './discovery.ts';
import { planPreviewWindow } from './previews.ts';
import { buildCatalogView, type CatalogRow, type SourceRow } from './view-model.ts';

export interface DiscoveryCatalogProps {
  readonly service: DiscoveryService;
  readonly now?: () => number;
  readonly links?: readonly WorkspaceSourceLink[];
  readonly adapterLabels?: Readonly<Record<string, { readonly label: string; readonly fake: boolean }>>;
  /** Explicit user action; the host (Projects/root) decides which workspace project to link. */
  readonly onRequestLink?: (row: CatalogRow) => void;
  readonly rowHeight?: number;
  readonly viewportHeight?: number;
  readonly prefetchRows?: number;
}

const BADGE: CSSProperties = { display: 'inline-block', padding: '1px 6px', borderRadius: 999, fontSize: 11, border: '1px solid var(--hq-border, GrayText)', marginInlineEnd: 4 };
const STATUS_TONE: Record<string, string> = {
  fresh: 'var(--hq-positive, green)', stale: 'var(--hq-muted, GrayText)', partial: 'var(--hq-warning, darkorange)',
  offline: 'var(--hq-warning, darkorange)', timeout: 'var(--hq-warning, darkorange)', error: 'var(--hq-danger, crimson)',
  'missing-at-source': 'var(--hq-danger, crimson)', never: 'var(--hq-muted, GrayText)', refreshing: 'var(--hq-muted, GrayText)',
};

function Badge(props: { readonly text: string; readonly tone?: string | undefined; readonly title?: string | undefined }): ReactElement {
  return h('span', { className: 'discovery-badge', style: { ...BADGE, color: props.tone ?? 'inherit' }, title: props.title }, props.text);
}

function SourceStrip(props: { readonly sources: readonly SourceRow[] }): ReactElement {
  return h('ul', { className: 'discovery-sources', 'aria-label': 'Sources', style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 } },
    props.sources.map((source) => h('li', { key: source.hostId, 'data-host': source.hostId, 'data-status': source.status },
      h('strong', null, source.label), ' ',
      source.fake ? h(Badge, { text: 'Fake source', title: source.adapterLabel }) : null,
      h(Badge, { text: source.statusLabel, tone: STATUS_TONE[source.status] }),
      h('span', { className: 'discovery-updated' }, source.updatedLabel),
      source.conflict ? h('span', { role: 'alert' }, ' Host identity changed — re-verify before trusting new data.') : null,
      source.error && !source.conflict ? h('span', { className: 'discovery-error', role: 'status' }, ` ${source.error}`) : null)));
}

function PreviewTile(props: { readonly service: DiscoveryService; readonly row: CatalogRow; readonly priority: 'visible' | 'prefetch' }): ReactElement {
  const { service, row, priority } = props;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = row.preview;
  useEffect(() => {
    if (!ref) return undefined;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    service.loadPreview(row.hostId, ref, { priority, signal: controller.signal }).then((bytes) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ref.mediaType }));
      setUrl(objectUrl);
    }, () => { if (!controller.signal.aborted) setFailed(true); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [service, row.hostId, ref?.digest, priority]);
  const box: CSSProperties = { width: 64, height: 40, flex: 'none', borderRadius: 4, overflow: 'hidden', background: 'var(--hq-subtle, Canvas)' };
  if (!ref) return h('div', { className: 'discovery-preview', style: box, 'aria-hidden': true });
  // Captured preview bytes keep their own colors; no theme filter is applied.
  return url
    ? h('img', { className: 'discovery-preview', src: url, alt: '', width: 64, height: 40, style: { ...box, objectFit: 'cover' } })
    : h('div', { className: 'discovery-preview', style: box, 'data-preview': failed ? 'unavailable' : 'pending', 'aria-hidden': true });
}

function Row(props: { readonly row: CatalogRow; readonly service: DiscoveryService; readonly priority: 'visible' | 'prefetch'; readonly top: number; readonly height: number; readonly onRequestLink?: (row: CatalogRow) => void }): ReactElement {
  const { row } = props;
  return h('li', {
    className: 'discovery-row', 'data-source-project': row.key, 'data-status': row.status, tabIndex: 0,
    'aria-label': `${row.displayName} on ${row.hostLabel}, ${row.statusLabel}, read-only source project`,
    style: { position: 'absolute', top: props.top, insetInline: 0, height: props.height, display: 'flex', alignItems: 'center', gap: 12, paddingInline: 8 },
  },
  h(PreviewTile, { service: props.service, row, priority: props.priority }),
  h('div', { style: { minWidth: 0, flex: 1 } },
    h('div', null, h('strong', null, row.displayName), ' ',
      h(Badge, { text: row.hostLabel, title: `Host ${row.hostId}` }),
      row.fake ? h(Badge, { text: 'Fake source' }) : null,
      h(Badge, { text: row.statusLabel, tone: STATUS_TONE[row.status] }),
      row.linkedProjects.length > 0 ? h(Badge, { text: `Linked (${row.linkedProjects.length})` }) : null,
      row.sameTitleCount > 0 ? h(Badge, { text: 'Same name elsewhere', title: 'Different source identity; not merged' }) : null),
    h('div', { className: 'discovery-meta', style: { fontSize: 12, opacity: 0.8 } },
      `${row.relativePath} · ${row.repoLabel}${row.revision ? ` · ${row.revision.slice(0, 12)}` : ''} · ${row.updatedLabel}`)),
  props.onRequestLink ? h('button', { type: 'button', onClick: () => props.onRequestLink?.(row) }, 'Link to project…') : null);
}

/** Catalog of read-only source projects with host/freshness badges and windowed lazy previews. */
export function DiscoveryCatalog(props: DiscoveryCatalogProps): ReactElement {
  const { service } = props;
  const state = useSyncExternalStore((listener) => service.subscribe(listener), () => service.getState(), () => service.getState());
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const now = (props.now ?? Date.now)();
  const view = useMemo(() => buildCatalogView(state, {
    now, query, ...(props.links ? { links: props.links } : {}), ...(props.adapterLabels ? { adapterLabels: props.adapterLabels } : {}),
  }), [state, now, query, props.links, props.adapterLabels]);
  useEffect(() => { void service.open(); }, [service]);

  const rowHeight = props.rowHeight ?? 56;
  const viewportHeight = props.viewportHeight ?? 480;
  const first = Math.floor(scrollTop / rowHeight);
  const slice = planPreviewWindow(view.rows.length, first, Math.ceil(viewportHeight / rowHeight) + 1, props.prefetchRows ?? 4);
  const mounted = [...slice.visible.map((index) => [index, 'visible'] as const), ...slice.prefetch.map((index) => [index, 'prefetch'] as const)];

  return h('section', { className: 'discovery-catalog', 'aria-labelledby': 'discovery-title' },
    h('header', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
      h('h2', { id: 'discovery-title', style: { margin: 0 } }, 'Source projects'),
      h('span', { className: 'discovery-cache', role: 'status' }, view.cacheLabel),
      h('input', { type: 'search', 'aria-label': 'Filter source projects', value: query, onChange: (event: { target: { value: string } }) => setQuery(event.target.value) }),
      h('button', { type: 'button', onClick: () => { void service.refresh(); } }, 'Refresh')),
    h(SourceStrip, { sources: view.sources }),
    view.emptyLabel ? h('p', { className: 'discovery-empty' }, view.emptyLabel) : null,
    h('div', {
      className: 'discovery-viewport', tabIndex: 0, 'aria-label': 'Source project list',
      style: { position: 'relative', height: viewportHeight, overflowY: 'auto' },
      onScroll: (event: { currentTarget: { scrollTop: number } }) => setScrollTop(event.currentTarget.scrollTop),
    },
    h('ul', { role: 'list', style: { position: 'relative', margin: 0, padding: 0, listStyle: 'none', height: view.rows.length * rowHeight } },
      mounted.map(([index, priority]) => h(Row, {
        key: view.rows[index]!.key, row: view.rows[index]!, service, priority, top: index * rowHeight, height: rowHeight,
        ...(props.onRequestLink ? { onRequestLink: props.onRequestLink } : {}),
      })))));
}

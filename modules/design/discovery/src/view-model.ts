/**
 * Framework-free projection of discovery state into what the catalog view renders. Source entries are
 * read-only rows with host and freshness badges; identical titles stay separate rows.
 */
import type { FreshnessStatus, HostId, PreviewRef, ProjectId, SourceProjectId, WorkspaceSourceLink } from './contract.ts';
import type { SourceStatus } from './catalog.ts';
import type { DiscoveryState } from './discovery.ts';

export interface CatalogRow {
  readonly key: SourceProjectId;
  readonly hostId: HostId;
  readonly hostLabel: string;
  readonly fake: boolean;
  readonly displayName: string;
  readonly relativePath: string;
  readonly repoLabel: string;
  readonly revision: string | null;
  readonly status: FreshnessStatus;
  readonly statusLabel: string;
  readonly updatedLabel: string;
  readonly linkedProjects: readonly ProjectId[];
  /** Other visible rows with the same title. They are distinct sources and are never merged. */
  readonly sameTitleCount: number;
  readonly preview: PreviewRef | null;
  readonly readOnly: true;
}

export interface SourceRow {
  readonly hostId: HostId;
  readonly label: string;
  readonly adapterLabel: string;
  readonly fake: boolean;
  readonly status: SourceStatus | 'refreshing';
  readonly statusLabel: string;
  readonly updatedLabel: string;
  readonly error: string | null;
  readonly conflict: boolean;
}

export interface CatalogViewModel {
  readonly rows: readonly CatalogRow[];
  readonly sources: readonly SourceRow[];
  readonly cacheLabel: string;
  readonly emptyLabel: string | null;
}

export interface ViewOptions {
  readonly now: number;
  /** Fresh records older than this are shown as stale. */
  readonly staleAfterMs?: number;
  readonly links?: readonly WorkspaceSourceLink[];
  readonly query?: string;
  readonly adapterLabels?: Readonly<Record<string, { readonly label: string; readonly fake: boolean }>>;
}

const STATUS_LABELS: Record<FreshnessStatus, string> = {
  fresh: 'Fresh', stale: 'Cached', offline: 'Offline', timeout: 'Timed out', error: 'Error', partial: 'Partial', 'missing-at-source': 'Missing at source',
};

const SOURCE_LABELS: Record<SourceStatus | 'refreshing', string> = {
  never: 'Not refreshed yet', fresh: 'Up to date', stale: 'Cached', partial: 'Partial results', offline: 'Offline',
  timeout: 'Timed out', error: 'Error', refreshing: 'Refreshing…',
};

const CACHE_LABELS: Record<DiscoveryState['cacheStatus'], string> = {
  'not-loaded': 'Loading cache…', warm: 'Showing cached catalog', cold: 'No cached catalog yet',
  'corrupt-rebuilt': 'Cache was unreadable and has been rebuilt', 'future-readonly': 'Cache is from a newer version and is left unchanged',
  'unavailable-readonly': 'Cache could not be read and is left unchanged',
};

export function ageLabel(iso: string | null, now: number): string {
  if (!iso) return 'never updated';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'updated just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `updated ${hours} h ago`;
  return `updated ${Math.round(hours / 24)} d ago`;
}

export function buildCatalogView(state: DiscoveryState, options: ViewOptions): CatalogViewModel {
  const staleAfter = options.staleAfterMs ?? 15 * 60_000;
  const hosts = new Set<string>(state.context.hostIds);
  const enrollments = new Map(state.enrollments.map((item) => [item.hostId as string, item]));
  const adapterFor = (host: string) => {
    const key = enrollments.get(host)?.adapterKey;
    return (key && options.adapterLabels?.[key]) || { label: key ?? 'Not enrolled', fake: true };
  };
  const linksBySource = new Map<string, ProjectId[]>();
  for (const link of options.links ?? []) {
    const list = linksBySource.get(link.sourceProjectId) ?? [];
    list.push(link.projectId);
    linksBySource.set(link.sourceProjectId, list);
  }
  const query = options.query?.trim().toLowerCase() ?? '';
  const visible = Object.values(state.catalog.records).filter((record) => hosts.has(record.entry.hostId)
    && enrollments.has(record.entry.hostId)
    && (!query || record.entry.displayName.toLowerCase().includes(query) || record.entry.relativePath.toLowerCase().includes(query)));
  const titleCounts = new Map<string, number>();
  for (const record of visible) titleCounts.set(record.entry.displayName, (titleCounts.get(record.entry.displayName) ?? 0) + 1);

  const rows: CatalogRow[] = visible.map((record) => {
    const { entry, freshness } = record;
    const aged = freshness.status === 'fresh' && freshness.lastSuccessAt !== null && options.now - Date.parse(freshness.lastSuccessAt) > staleAfter;
    const status: FreshnessStatus = aged ? 'stale' : freshness.status;
    const adapter = adapterFor(entry.hostId);
    return {
      key: entry.sourceProjectId, hostId: entry.hostId, hostLabel: enrollments.get(entry.hostId)?.label ?? entry.hostId,
      fake: adapter.fake, displayName: entry.displayName, relativePath: entry.relativePath,
      repoLabel: entry.repoIdentity.normalizedRemote ?? (entry.repoIdentity.localOnly ? 'Local only' : 'No remote'),
      revision: entry.revision ?? null, status, statusLabel: STATUS_LABELS[status],
      updatedLabel: ageLabel(freshness.lastSuccessAt, options.now),
      linkedProjects: linksBySource.get(entry.sourceProjectId) ?? [],
      sameTitleCount: (titleCounts.get(entry.displayName) ?? 1) - 1,
      preview: entry.previews[0] ?? null, readOnly: true,
    };
  });
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.hostLabel.localeCompare(b.hostLabel)
    || a.relativePath.localeCompare(b.relativePath) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const refreshing = new Set<string>(state.refreshing);
  const sources: SourceRow[] = state.context.hostIds.filter((host) => enrollments.has(host)).map((host) => {
    const source = state.catalog.sources[host];
    const adapter = adapterFor(host);
    const status: SourceRow['status'] = refreshing.has(host) ? 'refreshing' : source?.status ?? 'never';
    return {
      hostId: host, label: enrollments.get(host)!.label, adapterLabel: adapter.label, fake: adapter.fake,
      status, statusLabel: SOURCE_LABELS[status], updatedLabel: ageLabel(source?.lastSuccessAt ?? null, options.now),
      error: source?.error?.message ?? null, conflict: source?.conflict !== null && source?.conflict !== undefined,
    };
  });

  const emptyLabel = rows.length > 0 ? null
    : sources.length === 0 ? 'No sources are enrolled. Enroll a source to see its projects.'
      : query ? 'No source projects match this search.'
        : state.cacheStatus === 'not-loaded' ? 'Loading cached catalog…' : 'No source projects found yet.';
  return { rows, sources, cacheLabel: CACHE_LABELS[state.cacheStatus], emptyLabel };
}

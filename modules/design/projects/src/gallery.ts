/**
 * Gallery model: editable workspace projects and read-only source catalog
 * entries, filtered, sorted and grouped with collapsible groups.
 *
 * Items keep their own identity: a workspace project and a source entry with
 * the same title, or two source entries with the same remote, stay separate.
 */
import { FRESHNESS_STATUSES, type CatalogEntryView, type FreshnessStatus, type PreviewRef, type ProjectRecord } from './contract.ts';
import type { ProjectSummary } from './content.ts';
import type { HostId, ProjectId, SourceProjectId } from './ids.ts';

export type GalleryItem =
  | {
    readonly kind: 'workspace';
    readonly key: string;
    readonly projectId: ProjectId;
    readonly title: string;
    readonly createdAt: string;
    /** Absent until its content summary has been lazily loaded. */
    readonly summary?: ProjectSummary;
    readonly thumbnail?: PreviewRef;
  }
  | {
    readonly kind: 'source';
    readonly key: string;
    readonly sourceProjectId: SourceProjectId;
    readonly hostId: HostId;
    readonly hostLabel: string;
    readonly title: string;
    readonly relativePath: string;
    readonly revision?: string;
    readonly freshness: CatalogEntryView['freshness'];
    readonly thumbnail?: PreviewRef;
    /** Workspace projects that explicitly link this entry. */
    readonly linkedProjectIds: readonly ProjectId[];
  };

export type GalleryOrigin = 'all' | 'workspace' | 'source';
export type GallerySort = 'name' | 'recent';
export type GalleryGrouping = 'none' | 'origin' | 'host' | 'freshness';

export interface GalleryFilters {
  readonly query: string;
  readonly origin: GalleryOrigin;
  /** Empty means every host. */
  readonly hosts: readonly HostId[];
  /** Empty means every status. Applies to source entries only. */
  readonly freshness: readonly FreshnessStatus[];
  readonly sort: GallerySort;
  readonly groupBy: GalleryGrouping;
}

export const DEFAULT_GALLERY_FILTERS: GalleryFilters = Object.freeze({
  query: '', origin: 'all', hosts: Object.freeze([]), freshness: Object.freeze([]), sort: 'name', groupBy: 'origin',
});

export interface GalleryGroup {
  readonly key: string;
  readonly label: string;
  readonly total: number;
  readonly collapsed: boolean;
  /** Empty while collapsed; `total` still reports the hidden count. */
  readonly items: readonly GalleryItem[];
}

export const workspaceKey = (id: ProjectId): string => `workspace:${id}`;
export const sourceKey = (id: SourceProjectId): string => `source:${id}`;

export function buildGalleryItems(input: {
  readonly projects: readonly ProjectRecord[];
  readonly summaries: ReadonlyMap<ProjectId, ProjectSummary>;
  readonly catalog: readonly CatalogEntryView[];
  readonly links: ReadonlyMap<SourceProjectId, readonly ProjectId[]>;
}): GalleryItem[] {
  const items: GalleryItem[] = input.projects.map((project) => {
    const summary = input.summaries.get(project.id);
    return {
      kind: 'workspace', key: workspaceKey(project.id), projectId: project.id, title: project.name, createdAt: project.createdAt,
      ...(summary ? { summary } : {}), ...(summary?.cover ? { thumbnail: summary.cover } : {}),
    };
  });
  for (const entry of input.catalog) {
    items.push({
      kind: 'source', key: sourceKey(entry.sourceProjectId), sourceProjectId: entry.sourceProjectId,
      hostId: entry.hostId, hostLabel: entry.hostLabel, title: entry.displayName, relativePath: entry.relativePath,
      ...(entry.revision ? { revision: entry.revision } : {}), freshness: entry.freshness,
      ...(entry.previews[0] ? { thumbnail: entry.previews[0] } : {}),
      linkedProjectIds: input.links.get(entry.sourceProjectId) ?? [],
    });
  }
  return items;
}

function matches(item: GalleryItem, filters: GalleryFilters, needle: string): boolean {
  if (filters.origin !== 'all' && item.kind !== filters.origin) return false;
  if (item.kind === 'source') {
    if (filters.hosts.length > 0 && !filters.hosts.includes(item.hostId)) return false;
    if (filters.freshness.length > 0 && !filters.freshness.includes(item.freshness.status)) return false;
  } else if (filters.hosts.length > 0 || filters.freshness.length > 0) {
    // Host and freshness describe source entries; a workspace project has neither.
    return false;
  }
  if (needle === '') return true;
  const haystack = item.kind === 'source' ? `${item.title}\n${item.relativePath}\n${item.hostLabel}` : item.title;
  return haystack.toLocaleLowerCase().includes(needle);
}

const recency = (item: GalleryItem): string =>
  item.kind === 'workspace' ? (item.summary?.updatedAt ?? item.createdAt) : (item.freshness.lastSuccessAt ?? '');

function compare(sort: GallerySort): (a: GalleryItem, b: GalleryItem) => number {
  const byName = (a: GalleryItem, b: GalleryItem) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
  if (sort === 'name') return byName;
  return (a, b) => recency(b).localeCompare(recency(a)) || byName(a, b);
}

function groupOf(item: GalleryItem, grouping: GalleryGrouping): { key: string; label: string; rank: number } {
  switch (grouping) {
    case 'none': return { key: 'all', label: 'All projects', rank: 0 };
    case 'origin': return item.kind === 'workspace'
      ? { key: 'origin:workspace', label: 'Workspace projects', rank: 0 }
      : { key: 'origin:source', label: 'Source catalog (read-only)', rank: 1 };
    case 'host': return item.kind === 'workspace'
      ? { key: 'host:workspace', label: 'This workspace', rank: 0 }
      : { key: `host:${item.hostId}`, label: item.hostLabel, rank: 1 };
    case 'freshness': return item.kind === 'workspace'
      ? { key: 'freshness:workspace', label: 'Workspace projects', rank: 0 }
      : { key: `freshness:${item.freshness.status}`, label: item.freshness.status, rank: 1 + FRESHNESS_STATUSES.indexOf(item.freshness.status) };
  }
}

export function queryGallery(items: readonly GalleryItem[], filters: GalleryFilters, collapsed: ReadonlySet<string>): GalleryGroup[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  const sorted = items.filter((item) => matches(item, filters, needle)).sort(compare(filters.sort));
  const groups = new Map<string, { label: string; rank: number; items: GalleryItem[] }>();
  for (const item of sorted) {
    const group = groupOf(item, filters.groupBy);
    const bucket = groups.get(group.key) ?? { label: group.label, rank: group.rank, items: [] };
    bucket.items.push(item);
    groups.set(group.key, bucket);
  }
  return [...groups.entries()]
    .sort(([keyA, a], [keyB, b]) => a.rank - b.rank || a.label.localeCompare(b.label) || keyA.localeCompare(keyB))
    .map(([key, group]) => ({
      key, label: group.label, total: group.items.length, collapsed: collapsed.has(key),
      items: collapsed.has(key) ? [] : group.items,
    }));
}

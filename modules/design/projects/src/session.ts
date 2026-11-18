/**
 * Pure navigation session for the projects section.
 *
 * Each project keeps its own selection, filters, collapsed views and scroll,
 * restored when it is reopened. The gallery keeps its own filters, collapsed
 * groups and scroll. Nothing here performs I/O: switching cannot write or
 * submit anything.
 */
import { DEFAULT_GALLERY_FILTERS, type GalleryFilters } from './gallery.ts';
import { VIEW_KINDS, type ViewKind } from './content.ts';
import { parseHostId, parseProjectId, parseVersionId, parseViewId, type HostId, type ProjectId, type VersionId, type ViewId } from './ids.ts';
import { FRESHNESS_STATUSES } from './contract.ts';

export interface DetailFilters {
  readonly query: string;
  /** Empty means every kind. */
  readonly kinds: readonly ViewKind[];
}

export interface ProjectMemory {
  readonly selection: { readonly viewId: ViewId | null; readonly versionId: VersionId | null };
  readonly filters: DetailFilters;
  readonly collapsedViews: readonly ViewId[];
  readonly scroll: { readonly x: number; readonly y: number };
}

export interface GalleryMemory {
  readonly filters: GalleryFilters;
  readonly collapsedGroups: readonly string[];
  readonly scroll: number;
}

export interface SessionState {
  readonly screen: 'gallery' | 'project';
  readonly activeProjectId: ProjectId | null;
  /** Increments on every project open; late loads for an older generation are not shown. */
  readonly generation: number;
  readonly gallery: GalleryMemory;
  readonly memory: Readonly<Record<string, ProjectMemory>>;
}

export const EMPTY_PROJECT_MEMORY: ProjectMemory = Object.freeze({
  selection: Object.freeze({ viewId: null, versionId: null }),
  filters: Object.freeze({ query: '', kinds: Object.freeze([]) }),
  collapsedViews: Object.freeze([]),
  scroll: Object.freeze({ x: 0, y: 0 }),
});

export const INITIAL_SESSION: SessionState = Object.freeze({
  screen: 'gallery', activeProjectId: null, generation: 0,
  gallery: Object.freeze({ filters: DEFAULT_GALLERY_FILTERS, collapsedGroups: Object.freeze([]), scroll: 0 }),
  memory: Object.freeze({}),
});

export type SessionAction =
  | { readonly type: 'open-project'; readonly projectId: ProjectId }
  | { readonly type: 'back-to-gallery' }
  | { readonly type: 'select'; readonly viewId: ViewId | null; readonly versionId: VersionId | null }
  | { readonly type: 'set-detail-filters'; readonly filters: Partial<DetailFilters> }
  | { readonly type: 'toggle-view'; readonly viewId: ViewId }
  | { readonly type: 'set-detail-scroll'; readonly x: number; readonly y: number }
  | { readonly type: 'set-gallery-filters'; readonly filters: Partial<GalleryFilters> }
  | { readonly type: 'toggle-group'; readonly key: string }
  | { readonly type: 'set-gallery-scroll'; readonly y: number };

export function memoryFor(state: SessionState, project: ProjectId | null): ProjectMemory {
  return (project && state.memory[project]) || EMPTY_PROJECT_MEMORY;
}

const finiteScroll = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

function withMemory(state: SessionState, change: (memory: ProjectMemory) => ProjectMemory): SessionState {
  const project = state.activeProjectId;
  if (!project || state.screen !== 'project') return state;
  return { ...state, memory: { ...state.memory, [project]: change(memoryFor(state, project)) } };
}

const toggle = <T>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter((other) => other !== item) : [...list, item]);

export function reduceSession(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'open-project':
      if (state.screen === 'project' && state.activeProjectId === action.projectId) return state;
      return { ...state, screen: 'project', activeProjectId: action.projectId, generation: state.generation + 1 };
    case 'back-to-gallery':
      return state.screen === 'gallery' ? state : { ...state, screen: 'gallery' };
    case 'select':
      return withMemory(state, (memory) => ({ ...memory, selection: { viewId: action.viewId, versionId: action.versionId } }));
    case 'set-detail-filters':
      return withMemory(state, (memory) => ({ ...memory, filters: { ...memory.filters, ...action.filters } }));
    case 'toggle-view':
      return withMemory(state, (memory) => ({ ...memory, collapsedViews: toggle(memory.collapsedViews, action.viewId) }));
    case 'set-detail-scroll':
      return withMemory(state, (memory) => ({ ...memory, scroll: { x: finiteScroll(action.x), y: finiteScroll(action.y) } }));
    case 'set-gallery-filters':
      return { ...state, gallery: { ...state.gallery, filters: { ...state.gallery.filters, ...action.filters } } };
    case 'toggle-group':
      return { ...state, gallery: { ...state.gallery, collapsedGroups: toggle(state.gallery.collapsedGroups, action.key) } };
    case 'set-gallery-scroll':
      return { ...state, gallery: { ...state.gallery, scroll: finiteScroll(action.y) } };
  }
}

// ------------------------------------------------------- shell destination

/** Opaque ModulePort destination strings. Navigation never dispatches work. */
export function toDestination(state: SessionState): string {
  return state.screen === 'project' && state.activeProjectId ? `projects/${encodeURIComponent(state.activeProjectId)}` : 'projects';
}

export function parseDestination(destination: string): { readonly screen: 'gallery' } | { readonly screen: 'project'; readonly projectId: ProjectId } | null {
  if (destination === 'projects' || destination === 'home') return { screen: 'gallery' };
  const match = /^projects\/([^/]+)$/u.exec(destination);
  if (!match) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(match[1]!); } catch { return null; }
  const project = parseProjectId(decoded);
  return project ? { screen: 'project', projectId: project } : null;
}

// ----------------------------------------------- memory snapshot (optional)

export const SESSION_MEMORY_SCHEMA = 'hq.design.projects.session-memory/v1';

/** Serializable UI memory for root to persist wherever it keeps shell UI state. */
export function exportSessionMemory(state: SessionState): unknown {
  return JSON.parse(JSON.stringify({ schema: SESSION_MEMORY_SCHEMA, gallery: state.gallery, memory: state.memory }));
}

function parseMemory(value: unknown): ProjectMemory | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  const selection = item.selection as Record<string, unknown> | undefined;
  const filters = item.filters as Record<string, unknown> | undefined;
  const scroll = item.scroll as Record<string, unknown> | undefined;
  if (!selection || !filters || !scroll || typeof filters.query !== 'string' || !Array.isArray(filters.kinds)
    || !Array.isArray(item.collapsedViews) || typeof scroll.x !== 'number' || typeof scroll.y !== 'number') return null;
  const viewId = selection.viewId === null ? null : parseViewId(selection.viewId);
  const versionId = selection.versionId === null ? null : parseVersionId(selection.versionId);
  if ((selection.viewId !== null && !viewId) || (selection.versionId !== null && !versionId)) return null;
  const kinds = filters.kinds.filter((kind): kind is ViewKind => VIEW_KINDS.some((known) => known === kind));
  const collapsedViews = item.collapsedViews.map(parseViewId).filter((id): id is ViewId => id !== null);
  return { selection: { viewId, versionId }, filters: { query: filters.query, kinds }, collapsedViews, scroll: { x: finiteScroll(scroll.x), y: finiteScroll(scroll.y) } };
}

/** Restores memory leniently: unknown entries are dropped, never repaired into a different meaning. */
export function importSessionMemory(value: unknown): SessionState {
  if (typeof value !== 'object' || value === null || (value as Record<string, unknown>).schema !== SESSION_MEMORY_SCHEMA) return INITIAL_SESSION;
  const record = value as Record<string, unknown>;
  const memory: Record<string, ProjectMemory> = {};
  if (typeof record.memory === 'object' && record.memory !== null) {
    for (const [key, item] of Object.entries(record.memory)) {
      const project = parseProjectId(key);
      const parsed = parseMemory(item);
      if (project && parsed) memory[project] = parsed;
    }
  }
  const gallery = record.gallery as Record<string, unknown> | undefined;
  const filters = gallery?.filters as Record<string, unknown> | undefined;
  const restored: GalleryFilters = filters ? {
    query: typeof filters.query === 'string' ? filters.query : '',
    origin: filters.origin === 'workspace' || filters.origin === 'source' ? filters.origin : 'all',
    hosts: Array.isArray(filters.hosts) ? filters.hosts.map(parseHostId).filter((id): id is HostId => id !== null) : [],
    freshness: Array.isArray(filters.freshness) ? FRESHNESS_STATUSES.filter((status) => (filters.freshness as unknown[]).includes(status)) : [],
    sort: filters.sort === 'recent' ? 'recent' : 'name',
    groupBy: filters.groupBy === 'none' || filters.groupBy === 'host' || filters.groupBy === 'freshness' ? filters.groupBy : 'origin',
  } : DEFAULT_GALLERY_FILTERS;
  return {
    ...INITIAL_SESSION,
    gallery: {
      filters: restored,
      collapsedGroups: Array.isArray(gallery?.collapsedGroups) ? gallery.collapsedGroups.filter((key): key is string => typeof key === 'string') : [],
      scroll: typeof gallery?.scroll === 'number' ? finiteScroll(gallery.scroll) : 0,
    },
    memory,
  };
}

/**
 * Framework-free projection of discovery state into what the catalog view renders. Source entries are
 * read-only rows with host and freshness badges; identical titles stay separate rows.
 */
import type { FreshnessStatus, HostId, PreviewRef, ProjectId, SourceProjectId, WorkspaceSourceLink } from './contract.ts';
import type { SourceStatus } from './catalog.ts';
import type { DiscoveryState, RefreshReport } from './discovery.ts';

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
  /** Source projects from this host that match the search, before any host filter. */
  readonly projectCount: number;
}

export interface CatalogViewModel {
  readonly rows: readonly CatalogRow[];
  readonly sources: readonly SourceRow[];
  readonly cacheLabel: string;
  readonly emptyLabel: string | null;
  /** Rows that match the search across every source, before the host filter. */
  readonly totalCount: number;
  /** "8 of 16 source projects" while a search or source filter narrows the catalog. */
  readonly countLabel: string;
}

export interface ViewOptions {
  readonly now: number;
  /** Fresh records older than this are shown as stale. */
  readonly staleAfterMs?: number;
  readonly links?: readonly WorkspaceSourceLink[];
  readonly query?: string;
  /** Show only this source's projects. The source strip still lists every source. */
  readonly hostFilter?: HostId | null;
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

export type IndicatorTone = 'neutral' | 'success' | 'warning' | 'danger';

/** Shape-and-word tone for a freshness or source status. Cached data is calm, not a warning. */
export function statusTone(status: FreshnessStatus | SourceStatus | 'refreshing'): IndicatorTone {
  switch (status) {
    case 'fresh': return 'success';
    case 'partial': case 'offline': case 'timeout': return 'warning';
    case 'error': case 'missing-at-source': return 'danger';
    default: return 'neutral';
  }
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

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
  const hostFilter = options.hostFilter ?? null;
  const matching = Object.values(state.catalog.records).filter((record) => hosts.has(record.entry.hostId)
    && enrollments.has(record.entry.hostId)
    && (!query || record.entry.displayName.toLowerCase().includes(query) || record.entry.relativePath.toLowerCase().includes(query)));
  const visible = hostFilter === null ? matching : matching.filter((record) => record.entry.hostId === hostFilter);
  // Same-name detection looks across every source, so a host filter never hides that a title exists elsewhere.
  const titleCounts = new Map<string, number>();
  const hostCounts = new Map<string, number>();
  for (const record of matching) {
    titleCounts.set(record.entry.displayName, (titleCounts.get(record.entry.displayName) ?? 0) + 1);
    hostCounts.set(record.entry.hostId, (hostCounts.get(record.entry.hostId) ?? 0) + 1);
  }

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
      projectCount: hostCounts.get(host) ?? 0,
    };
  });

  const filterLabel = hostFilter === null ? null : sources.find((source) => source.hostId === hostFilter)?.label ?? null;
  const emptyLabel = rows.length > 0 ? null
    : sources.length === 0 ? 'No sources are enrolled. Enroll a source to see its projects.'
      : query ? 'No source projects match this search.'
        : filterLabel !== null ? `No source projects from ${filterLabel} yet.`
          : state.cacheStatus === 'not-loaded' ? 'Loading cached catalog…' : 'No source projects found yet.';
  const narrowed = query !== '' || hostFilter !== null;
  const countLabel = narrowed ? `${rows.length} of ${plural(matching.length, 'source project')}` : plural(rows.length, 'source project');
  // A warm cache that every source has since confirmed is simply current, so it stops saying "cached".
  const confirmed = state.cacheStatus === 'warm' && sources.length > 0 && sources.every((source) => source.status === 'fresh');
  return { rows, sources, cacheLabel: confirmed ? 'Catalog is up to date' : CACHE_LABELS[state.cacheStatus], emptyLabel, totalCount: matching.length, countLabel };
}

// ---- preview data URLs -------------------------------------------------------------------------

/** Raster media types the view may show. SVG, GIF and anything else stays a "no preview" tile. */
export const PREVIEW_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp'] as const);
export type PreviewImageType = (typeof PREVIEW_IMAGE_TYPES)[number];

/** The allow-listed raster type named by a media type (parameters and case ignored), or null. */
export function previewImageType(mediaType: string): PreviewImageType | null {
  const base = mediaType.split(';')[0]!.trim().toLowerCase();
  return (PREVIEW_IMAGE_TYPES as readonly string[]).includes(base) ? base as PreviewImageType : null;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) => signature.every((value, index) => bytes[at + index] === value);

/** True when the bytes begin like the declared raster format, so a mislabelled blob never becomes a broken image. */
function hasSignature(type: PreviewImageType, bytes: Uint8Array): boolean {
  switch (type) {
    case 'image/png': return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg': return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/webp': return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without `btoa`, so it runs unchanged in Node tests and in the renderer, for any byte length. */
export function base64Encode(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const a = bytes[offset]!;
    const b = bytes[offset + 1];
    const c = bytes[offset + 2];
    const word = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    chunks.push(BASE64[(word >> 18) & 63]!, BASE64[(word >> 12) & 63]!,
      b === undefined ? '=' : BASE64[(word >> 6) & 63]!, c === undefined ? '=' : BASE64[word & 63]!);
  }
  return chunks.join('');
}

/**
 * A `data:` URL for a preview, only for png, jpeg and webp whose bytes match their type. The shell CSP
 * allows `img-src data:` but not `blob:`. Returns null for everything else.
 */
export function previewDataUrl(bytes: Uint8Array, mediaType: string): string | null {
  const type = previewImageType(mediaType);
  if (!type || !hasSignature(type, bytes)) return null;
  return `data:${type};base64,${base64Encode(bytes)}`;
}

// ---- grid keyboard navigation ------------------------------------------------------------------

export interface GridMoveOptions {
  readonly columns: number;
  readonly total: number;
  /** Rows a page key moves. Default 3. */
  readonly pageRows?: number;
  readonly ctrl?: boolean;
}

/**
 * Roving-focus target for a navigation key in a row-major grid, or null when the key is not navigation or
 * nothing lies in that direction. Moving down from a column that the last row lacks lands on the last card.
 */
export function moveGridIndex(index: number, key: string, options: GridMoveOptions): number | null {
  const { total, ctrl = false } = options;
  const columns = Math.max(1, Math.floor(options.columns));
  if (total <= 0) return null;
  const last = total - 1;
  const rowStart = index - (index % columns);
  const clamp = (value: number) => Math.max(0, Math.min(last, value));
  let next: number;
  switch (key) {
    case 'ArrowLeft': next = index - 1; break;
    case 'ArrowRight': next = index + 1; break;
    case 'ArrowUp': next = index - columns; break;
    case 'ArrowDown': next = index + columns > last && rowStart + columns <= last ? last : index + columns; break;
    case 'Home': next = ctrl ? 0 : rowStart; break;
    case 'End': next = ctrl ? last : Math.min(last, rowStart + columns - 1); break;
    case 'PageUp': next = index - columns * (options.pageRows ?? 3); break;
    case 'PageDown': next = index + columns * (options.pageRows ?? 3); break;
    default: return null;
  }
  if (next < 0 && key !== 'PageUp') return null;
  if (next > last && key !== 'PageDown') return null;
  return clamp(next);
}

// ---- refresh results ---------------------------------------------------------------------------

export interface RefreshProblem {
  readonly hostId: HostId;
  readonly label: string;
  readonly outcome: string;
  /** `held` is a capability that is not connected yet; `conflict` is a changed host identity. */
  readonly kind: 'failed' | 'held' | 'conflict';
  readonly message: string;
}

export interface RefreshSummary {
  /** `danger` for failures (toast.error), `info` for a calm hold, `success` otherwise. */
  readonly tone: 'success' | 'info' | 'danger';
  readonly title: string;
  readonly description: string | null;
  /** Result counts in mono: projects, new, missing. */
  readonly meta: string | null;
  readonly refreshed: number;
  /** Rows that were not in the catalog before the refresh, so the view can flash where they landed. */
  readonly addedKeys: readonly string[];
  readonly problems: readonly RefreshProblem[];
}

const OK_OUTCOMES = new Set(['applied', 'ignored-stale-generation', 'recorded']);

const OUTCOME_MESSAGES: Record<string, string> = {
  offline: 'The source is offline', timeout: 'The source did not respond in time', error: 'The source reported an error',
  'invalid-snapshot': 'The source sent a catalog that could not be read', 'no-adapter': 'No source is connected yet',
  'not-enrolled': 'The source is not enrolled', 'held-conflict': 'Host identity changed — re-verify before trusting new data.',
  'rejected-collision': 'The source claimed a project that belongs to another source',
};

/**
 * Result counts for a finished refresh. `before` is every cached row before it started; `after` is the
 * catalog afterwards. A failed refresh never removes rows, so the summary always says what stays readable.
 */
export function summarizeRefresh(input: { readonly report: RefreshReport | null; readonly before: readonly CatalogRow[]; readonly after: CatalogViewModel }): RefreshSummary {
  const { report, before, after } = input;
  const total = after.rows.length;
  if (!report) {
    return { tone: 'danger', title: "Couldn't refresh sources", description: `Showing the saved catalog (${plural(total, 'project')}).`, meta: null, refreshed: 0, addedKeys: [], problems: [] };
  }
  const attempted = report.results.filter((result) => result.outcome !== 'cancelled');
  const sourceFor = (hostId: string) => after.sources.find((source) => source.hostId === hostId);
  const problems: RefreshProblem[] = attempted.filter((result) => !OK_OUTCOMES.has(result.outcome)).map((result) => {
    const source = sourceFor(result.hostId);
    const kind = result.outcome === 'held-conflict' ? 'conflict' : result.outcome === 'no-adapter' ? 'held' : 'failed';
    const message = kind === 'failed' && source?.error ? source.error : OUTCOME_MESSAGES[result.outcome] ?? 'The source could not be refreshed';
    return { hostId: result.hostId, label: source?.label ?? result.hostId, outcome: result.outcome, kind, message };
  });
  const refreshed = attempted.length - problems.length;
  const known = new Set(before.map((row) => row.key as string));
  const wasMissing = new Set(before.filter((row) => row.status === 'missing-at-source').map((row) => row.key as string));
  const addedKeys = after.rows.filter((row) => !known.has(row.key)).map((row) => row.key as string);
  const added = addedKeys.length;
  const missing = after.rows.filter((row) => row.status === 'missing-at-source' && !wasMissing.has(row.key)).length;
  const counts = [plural(total, 'project'), added > 0 ? `${added} new` : null, missing > 0 ? `${missing} missing at source` : null];
  const meta = counts.filter((part): part is string => part !== null).join(' · ') + (added === 0 && missing === 0 ? ' · no changes' : '');

  if (problems.length === 0) {
    if (attempted.length === 0) return { tone: 'info', title: 'No sources to refresh', description: null, meta: null, refreshed: 0, addedKeys: [], problems };
    return { tone: 'success', title: `Refreshed ${plural(refreshed, 'source')}`, description: null, meta, refreshed, addedKeys, problems };
  }
  const failed = problems.filter((problem) => problem.kind !== 'held');
  if (failed.length === 0) {
    const names = problems.map((problem) => problem.label).join(', ');
    return { tone: 'info', title: "Refresh isn't available yet", description: `No source is connected for ${names}. Showing the saved catalog.`, meta: plural(total, "project"), refreshed, addedKeys, problems };
  }
  const subject = failed.length === 1 ? failed[0]!.label : plural(failed.length, 'source');
  const detail = failed.length === 1 ? `${failed[0]!.message.replace(/[.…]+$/u, '')}. ` : '';
  const kept = refreshed > 0 ? `${plural(refreshed, 'other source')} refreshed. ` : '';
  return { tone: 'danger', title: `Couldn't refresh ${subject}`, description: `${detail}${kept}Showing the saved catalog.`, meta, refreshed, addedKeys, problems };
}

// ---- explore deck ------------------------------------------------------------------------------

export type DeckDecision = 'saved' | 'skipped';

export interface DeckState {
  /** Cards in the deck: the rows currently shown. */
  readonly total: number;
  readonly decided: number;
  readonly saved: number;
  readonly skipped: number;
  /** One-based position of the top card, or `total` once the deck is finished. */
  readonly position: number;
  readonly top: CatalogRow | null;
  /** The card peeking behind the top one. */
  readonly next: CatalogRow | null;
  readonly done: boolean;
  readonly progressLabel: string;
}

/** Deck progress over the rows on show. A row that leaves the list (filtered out) simply leaves the deck. */
export function deckState(rows: readonly CatalogRow[], decisions: ReadonlyMap<string, DeckDecision>): DeckState {
  const remaining = rows.filter((row) => !decisions.has(row.key));
  let saved = 0;
  for (const row of rows) if (decisions.get(row.key) === 'saved') saved += 1;
  const decided = rows.length - remaining.length;
  const done = rows.length > 0 && remaining.length === 0;
  const position = done ? rows.length : Math.min(rows.length, decided + 1);
  return {
    total: rows.length, decided, saved, skipped: decided - saved, position, top: remaining[0] ?? null, next: remaining[1] ?? null,
    done, progressLabel: `${position} of ${rows.length}`,
  };
}

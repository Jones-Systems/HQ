/**
 * Pure presentation rules for the Projects screens: which gallery state to show, the project overview line,
 * filter tabs, capture chips and form validation. Nothing here renders, reads storage or touches the DOM, so
 * Node tests cover every branch.
 */
import { VIEW_KINDS, type ProjectContent, type VersionOrigin, type VersionRecord, type ViewKind, type ViewRecord, type Viewport } from './content.ts';
import type { PreviewRef } from './contract.ts';
import type { GalleryFilters, GalleryGroup } from './gallery.ts';
import type { DetailFilters } from './session.ts';

export const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? '' : 's'}`;

// ------------------------------------------------------------------ gallery

export type GalleryPhase = 'loading' | 'error' | 'empty' | 'no-match' | 'ready';

/**
 * Which state the all-projects gallery shows. "No match" is reserved for filters that exclude something;
 * nothing is ever reported missing while the registry is still loading.
 */
export function galleryPhase(input: {
  readonly registryStatus: 'loading' | 'ready' | 'error';
  /** Projects and source entries before any filter. */
  readonly total: number;
  /** Items that survive the filters, counting collapsed groups. */
  readonly shown: number;
}): GalleryPhase {
  if (input.shown > 0) return 'ready';
  if (input.total > 0) return 'no-match';
  if (input.registryStatus === 'loading') return 'loading';
  return input.registryStatus === 'error' ? 'error' : 'empty';
}

export const shownItems = (groups: readonly GalleryGroup[]): number => groups.reduce((sum, group) => sum + group.total, 0);

/** Search, origin, host and freshness narrow the list; sort and grouping only arrange it. */
export function filtersActive(filters: GalleryFilters): boolean {
  return filters.query.trim() !== '' || filters.origin !== 'all' || filters.hosts.length > 0 || filters.freshness.length > 0;
}

export const CLEARED_FILTERS = Object.freeze({ query: '', origin: 'all', hosts: Object.freeze([]), freshness: Object.freeze([]) }) satisfies Pick<GalleryFilters, 'query' | 'origin' | 'hosts' | 'freshness'>;

export interface FilterControls {
  readonly bar: boolean;
  readonly search: boolean;
  readonly origin: boolean;
  readonly host: boolean;
  readonly freshness: boolean;
  readonly group: boolean;
  readonly sort: boolean;
}

/** The compact filter bar appears only when there is something to filter, and keeps what is active reachable. */
export function filterControls(input: { readonly projects: number; readonly sources: number; readonly hosts: number; readonly filters: GalleryFilters }): FilterControls {
  const total = input.projects + input.sources;
  const bar = total >= 2 || filtersActive(input.filters);
  return {
    bar,
    search: bar,
    origin: bar && input.projects > 0 && input.sources > 0,
    host: bar && input.hosts >= 2,
    freshness: bar && input.sources > 0,
    group: bar && input.sources > 0,
    sort: bar && total >= 2,
  };
}

// ------------------------------------------------------------------ project

export interface CaptureSummary {
  readonly viewCount: number;
  readonly versionCount: number;
  /** Newest version timestamp, or null while nothing has been captured. */
  readonly lastCaptureAt: string | null;
}

export function captureSummary(content: ProjectContent): CaptureSummary {
  let last: string | null = null;
  for (const version of content.versions) if (last === null || version.createdAt > last) last = version.createdAt;
  return { viewCount: content.views.length, versionCount: content.versions.length, lastCaptureAt: last };
}

/** `18 Oct 2026 14:02` in the reader's time zone (or `timeZone`). Anything unparseable is shown as written. */
export function formatCaptureDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('day')} ${pick('month')} ${pick('year')} ${pick('hour')}:${pick('minute')}`;
}

/** `3 views · 5 versions · last capture 18 Oct 2026 14:02`. */
export function overviewLine(summary: CaptureSummary, timeZone?: string): string {
  const base = `${count(summary.viewCount, 'view')} · ${count(summary.versionCount, 'version')}`;
  return summary.lastCaptureAt === null ? base : `${base} · last capture ${formatCaptureDate(summary.lastCaptureAt, timeZone)}`;
}

const KIND_LABELS: Readonly<Record<ViewKind, readonly [string, string]>> = {
  page: ['Page', 'Pages'], screen: ['Screen', 'Screens'], component: ['Component', 'Components'],
  prototype: ['Prototype', 'Prototypes'], flow: ['Flow', 'Flows'], other: ['Other', 'Other'],
};

export const kindLabel = (kind: ViewKind, plural = false): string => KIND_LABELS[kind][plural ? 1 : 0];

export interface KindTab {
  /** Null is the "All" tab. */
  readonly kind: ViewKind | null;
  readonly label: string;
  readonly count: number;
}

/** "All" plus one tab per kind that exists, in a stable order. */
export function kindTabs(content: ProjectContent): readonly KindTab[] {
  const tabs: KindTab[] = [{ kind: null, label: 'All', count: content.views.length }];
  for (const kind of VIEW_KINDS) {
    const matching = content.views.filter((view) => view.kind === kind).length;
    if (matching > 0) tabs.push({ kind, label: kindLabel(kind, true), count: matching });
  }
  return tabs;
}

/** The tab a filter selects. Several kinds at once (never produced by the tabs) read as "All". */
export const activeKind = (filters: DetailFilters): ViewKind | null => (filters.kinds.length === 1 ? filters.kinds[0]! : null);

export function visibleViews(content: ProjectContent, filters: DetailFilters): readonly ViewRecord[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  return content.views.filter((view) => (filters.kinds.length === 0 || filters.kinds.includes(view.kind))
    && (needle === '' || view.title.toLocaleLowerCase().includes(needle)));
}

/** Tabs and search are offered when there are at least two kinds, or enough views to search; active filters stay. */
export function detailFilterControls(content: ProjectContent, filters: DetailFilters): { readonly tabs: boolean; readonly search: boolean } {
  const kinds = new Set(content.views.map((view) => view.kind)).size;
  return { tabs: kinds >= 2 || filters.kinds.length > 0, search: content.views.length >= 4 || filters.query.trim() !== '' };
}

/** The tab to focus after an arrow, Home or End key press, or null for any other key. */
export function tabAfterKey(key: string, index: number, length: number): number | null {
  if (length < 1) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + length) % length;
  if (key === 'Home') return 0;
  return key === 'End' ? length - 1 : null;
}

// ------------------------------------------------------------------ captures

const ORIGIN_LABELS: Readonly<Record<VersionOrigin, string>> = {
  'owner-created': 'Owner-created', imported: 'Imported', 'returned-candidate': 'Returned work', 'synthetic-fixture': 'Example',
};

export const originLabel = (origin: VersionOrigin): string => ORIGIN_LABELS[origin];

export const viewportLabel = (viewport: Viewport): string => `${viewport.w}×${viewport.h}`;

/** Long hex revisions read as the usual seven characters; anything else is shortened only when it is long. */
export function shortRevision(revision: string): string {
  if (/^[0-9a-f]{12,}$/iu.test(revision)) return revision.slice(0, 7);
  return revision.length > 16 ? `${revision.slice(0, 15)}…` : revision;
}

export interface CaptureChips {
  readonly viewport: string;
  /** Pixel ratio, shown only when it is not 1. */
  readonly density: string | null;
  readonly origin: string;
  readonly revision: string | null;
}

export function captureChips(version: VersionRecord): CaptureChips {
  const { viewport, sourceRevision } = version.capture;
  return {
    viewport: viewportLabel(viewport), density: viewport.dpr === 1 ? null : `${viewport.dpr}x`,
    origin: originLabel(version.origin), revision: sourceRevision ? shortRevision(sourceRevision) : null,
  };
}

/** A capture keeps its own proportion: the saved image when it has dimensions, otherwise the capture viewport. */
export function captureRatio(version: VersionRecord): { readonly w: number; readonly h: number } {
  const thumbnail: PreviewRef | undefined = version.thumbnail;
  if (thumbnail?.w && thumbnail.h) return { w: thumbnail.w, h: thumbnail.h };
  return { w: version.capture.viewport.w, h: version.capture.viewport.h };
}

export const shortDigest = (digest: string): string => (digest.length > 18 ? `${digest.slice(0, 17)}…` : digest);

// -------------------------------------------------------------- form input

export const TEXT_MAX = 300;
export const ROUTE_MAX = 2048;
const CONTROL = /[\u0000-\u001f\u007f]/u;

/** Mirrors what the content model accepts, so the form says what is wrong before anything is submitted. */
export function validateText(raw: string, noun: string, max = TEXT_MAX): string | null {
  const value = raw.trim();
  if (value === '') return `Enter a ${noun}.`;
  if (value.length > max) return `Use ${max} characters or fewer.`;
  if (CONTROL.test(value)) return 'Remove line breaks and control characters.';
  return null;
}

export const validateProjectName = (raw: string): string | null => validateText(raw, 'project name');
export const validateViewTitle = (raw: string): string | null => validateText(raw, 'view title');
export const validateVersionLabel = (raw: string): string | null => validateText(raw, 'version label');
export const validateRoute = (raw: string): string | null => validateText(raw, 'route', ROUTE_MAX);

export interface ViewportPreset {
  readonly id: string;
  readonly label: string;
  readonly viewport: Viewport;
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = Object.freeze([
  { id: 'desktop', label: 'Desktop 1280×800', viewport: { w: 1280, h: 800, dpr: 1 } },
  { id: 'laptop', label: 'Laptop 1440×900', viewport: { w: 1440, h: 900, dpr: 1 } },
  { id: 'tablet', label: 'Tablet 820×1180', viewport: { w: 820, h: 1180, dpr: 2 } },
  { id: 'mobile', label: 'Mobile 390×844', viewport: { w: 390, h: 844, dpr: 3 } },
]);

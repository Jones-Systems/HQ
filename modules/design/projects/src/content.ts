/**
 * Project content: several views per project and append-only versions per view.
 *
 * Versions are immutable once added. Every operation returns a new deeply
 * frozen document; `assertAppendOnly` is the guard persistence applies before
 * any write, so an edited, removed or reordered earlier version is refused.
 */
import type { PreviewRef, WorkspaceSourceLink } from './contract.ts';
import {
  parseProjectId, parseSourceProjectId, parseVersionId, parseViewId,
  type ProjectId, type SourceProjectId, type VersionId, type ViewId,
} from './ids.ts';

export const CONTENT_SCHEMA = 'hq.design.project-content/v1';

export const VIEW_KINDS = ['page', 'screen', 'component', 'prototype', 'flow', 'other'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export const VERSION_ORIGINS = ['owner-created', 'imported', 'returned-candidate', 'synthetic-fixture'] as const;
export type VersionOrigin = (typeof VERSION_ORIGINS)[number];

export interface Viewport { readonly w: number; readonly h: number; readonly dpr: number }

/** A version stays bound to the route, viewport, source revision and capture it was made from. */
export interface CaptureBinding {
  readonly route: string;
  readonly viewport: Viewport;
  readonly sourceRevision?: string;
  readonly captureDigest?: string;
}

export interface ViewRecord {
  readonly id: ViewId;
  readonly title: string;
  readonly kind: ViewKind;
  readonly createdAt: string;
}

export interface VersionRecord {
  readonly id: VersionId;
  readonly viewId: ViewId;
  /** 1-based position within its view; never reused. */
  readonly ordinal: number;
  readonly label: string;
  readonly createdAt: string;
  readonly capture: CaptureBinding;
  readonly thumbnail?: PreviewRef;
  readonly origin: VersionOrigin;
  /** Explicit lineage only; never inferred as "latest". */
  readonly basedOn?: VersionId;
}

export interface ProjectContent {
  readonly schema: typeof CONTENT_SCHEMA;
  readonly projectId: ProjectId;
  readonly views: readonly ViewRecord[];
  readonly versions: readonly VersionRecord[];
  readonly links: readonly WorkspaceSourceLink[];
  readonly updatedAt: string;
}

export class ContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentError';
  }
}

export class VersionMutationError extends ContentError {
  readonly versionId: string;
  constructor(versionId: string, reason: string) {
    super(`Version ${versionId} is immutable: ${reason}`);
    this.name = 'VersionMutationError';
    this.versionId = versionId;
  }
}

// ----------------------------------------------------------------- helpers

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

/** Stable sorted-key serialization used for equality only; not the shared JCS digest. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const isTimestamp = (value: unknown): value is string => typeof value === 'string' && ISO.test(value);
const positiveFinite = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;

export function parsePreviewRef(value: unknown): PreviewRef | null {
  if (!plainRecord(value) || !onlyKeys(value, ['digest', 'mediaType', 'bytes', 'w', 'h'])) return null;
  if (typeof value.digest !== 'string' || !DIGEST.test(value.digest) || !text(value.mediaType, 100)
    || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0) return null;
  if ('w' in value && !(Number.isSafeInteger(value.w) && positiveFinite(value.w, 100_000))) return null;
  if ('h' in value && !(Number.isSafeInteger(value.h) && positiveFinite(value.h, 100_000))) return null;
  return {
    digest: value.digest, mediaType: value.mediaType, bytes: value.bytes as number,
    ...(typeof value.w === 'number' ? { w: value.w } : {}),
    ...(typeof value.h === 'number' ? { h: value.h } : {}),
  };
}

function parseCapture(value: unknown): CaptureBinding | null {
  if (!plainRecord(value) || !onlyKeys(value, ['route', 'viewport', 'sourceRevision', 'captureDigest'])) return null;
  const viewport = value.viewport;
  if (!text(value.route, 2048) || !plainRecord(viewport) || !onlyKeys(viewport, ['w', 'h', 'dpr'])
    || !positiveFinite(viewport.w, 100_000) || !positiveFinite(viewport.h, 100_000) || !positiveFinite(viewport.dpr, 16)) return null;
  if ('sourceRevision' in value && !text(value.sourceRevision, 300)) return null;
  if ('captureDigest' in value && !(typeof value.captureDigest === 'string' && DIGEST.test(value.captureDigest))) return null;
  return {
    route: value.route, viewport: { w: viewport.w, h: viewport.h, dpr: viewport.dpr },
    ...(typeof value.sourceRevision === 'string' ? { sourceRevision: value.sourceRevision } : {}),
    ...(typeof value.captureDigest === 'string' ? { captureDigest: value.captureDigest } : {}),
  };
}

function parseView(value: unknown): ViewRecord | null {
  if (!plainRecord(value) || !onlyKeys(value, ['id', 'title', 'kind', 'createdAt'])) return null;
  const id = parseViewId(value.id);
  if (!id || !text(value.title, 300) || !VIEW_KINDS.some((kind) => kind === value.kind) || !isTimestamp(value.createdAt)) return null;
  return { id, title: value.title, kind: value.kind as ViewKind, createdAt: value.createdAt };
}

function parseVersion(value: unknown): VersionRecord | null {
  if (!plainRecord(value)
    || !onlyKeys(value, ['id', 'viewId', 'ordinal', 'label', 'createdAt', 'capture', 'thumbnail', 'origin', 'basedOn'])) return null;
  const id = parseVersionId(value.id);
  const view = parseViewId(value.viewId);
  const capture = parseCapture(value.capture);
  if (!id || !view || !capture || !Number.isSafeInteger(value.ordinal) || (value.ordinal as number) < 1
    || !text(value.label, 300) || !isTimestamp(value.createdAt)
    || !VERSION_ORIGINS.some((origin) => origin === value.origin)) return null;
  const thumbnail = 'thumbnail' in value ? parsePreviewRef(value.thumbnail) : undefined;
  if (thumbnail === null) return null;
  const basedOn = 'basedOn' in value ? parseVersionId(value.basedOn) : undefined;
  if (basedOn === null) return null;
  return {
    id, viewId: view, ordinal: value.ordinal as number, label: value.label, createdAt: value.createdAt, capture,
    ...(thumbnail ? { thumbnail } : {}), origin: value.origin as VersionOrigin, ...(basedOn ? { basedOn } : {}),
  };
}

function parseLink(value: unknown, project: ProjectId): WorkspaceSourceLink | null {
  if (!plainRecord(value) || !onlyKeys(value, ['projectId', 'sourceProjectId', 'linkedAt', 'observedRevision'])) return null;
  const source = parseSourceProjectId(value.sourceProjectId);
  if (value.projectId !== project || !source || !isTimestamp(value.linkedAt)
    || !(value.observedRevision === null || text(value.observedRevision, 300))) return null;
  return { projectId: project, sourceProjectId: source, linkedAt: value.linkedAt, observedRevision: value.observedRevision };
}

export type ParsedContent =
  | { readonly status: 'ok'; readonly content: ProjectContent }
  | { readonly status: 'unsupported-schema'; readonly schema: string }
  | { readonly status: 'invalid'; readonly reason: string };

/** Strict parse. A future schema is reported, never coerced; callers open it read-only. */
export function parseProjectContent(value: unknown): ParsedContent {
  if (!plainRecord(value)) return { status: 'invalid', reason: 'not an object' };
  if (value.schema !== CONTENT_SCHEMA) {
    return typeof value.schema === 'string' && /^hq\.design\.project-content\/v\d+$/u.test(value.schema)
      ? { status: 'unsupported-schema', schema: value.schema }
      : { status: 'invalid', reason: 'unknown schema' };
  }
  if (!onlyKeys(value, ['schema', 'projectId', 'views', 'versions', 'links', 'updatedAt'])) return { status: 'invalid', reason: 'unexpected field' };
  const project = parseProjectId(value.projectId);
  if (!project || !Array.isArray(value.views) || !Array.isArray(value.versions) || !Array.isArray(value.links)
    || !isTimestamp(value.updatedAt)) return { status: 'invalid', reason: 'malformed document' };
  const views: ViewRecord[] = [];
  for (const item of value.views) {
    const view = parseView(item);
    if (!view || views.some((other) => other.id === view.id)) return { status: 'invalid', reason: 'malformed or duplicate view' };
    views.push(view);
  }
  const versions: VersionRecord[] = [];
  for (const item of value.versions) {
    const version = parseVersion(item);
    if (!version || versions.some((other) => other.id === version.id)
      || !views.some((view) => view.id === version.viewId)) return { status: 'invalid', reason: 'malformed, duplicate or orphan version' };
    const expected = versions.filter((other) => other.viewId === version.viewId).length + 1;
    if (version.ordinal !== expected) return { status: 'invalid', reason: 'version ordinals are not contiguous' };
    if (version.basedOn && !versions.some((other) => other.id === version.basedOn)) return { status: 'invalid', reason: 'unknown lineage' };
    versions.push(version);
  }
  const links: WorkspaceSourceLink[] = [];
  for (const item of value.links) {
    const link = parseLink(item, project);
    if (!link || links.some((other) => other.sourceProjectId === link.sourceProjectId)) return { status: 'invalid', reason: 'malformed or duplicate link' };
    links.push(link);
  }
  return { status: 'ok', content: deepFreeze({ schema: CONTENT_SCHEMA, projectId: project, views, versions, links, updatedAt: value.updatedAt }) };
}

// -------------------------------------------------------------- operations

export function createProjectContent(project: ProjectId, now: string): ProjectContent {
  return deepFreeze({ schema: CONTENT_SCHEMA, projectId: project, views: [], versions: [], links: [], updatedAt: now });
}

export function addView(content: ProjectContent, input: { readonly id: ViewId; readonly title: string; readonly kind: ViewKind }, now: string): ProjectContent {
  if (!text(input.title, 300)) throw new ContentError('View title must be nonempty trimmed text');
  if (!VIEW_KINDS.includes(input.kind)) throw new ContentError('Unknown view kind');
  if (content.views.some((view) => view.id === input.id)) throw new ContentError(`View ${input.id} already exists`);
  const view: ViewRecord = { id: input.id, title: input.title, kind: input.kind, createdAt: now };
  return deepFreeze({ ...content, views: [...content.views, view], updatedAt: now });
}

/** View metadata is editable; its versions are not touched. */
export function renameView(content: ProjectContent, id: ViewId, title: string, now: string): ProjectContent {
  if (!text(title, 300)) throw new ContentError('View title must be nonempty trimmed text');
  if (!content.views.some((view) => view.id === id)) throw new ContentError(`Unknown view ${id}`);
  return deepFreeze({ ...content, views: content.views.map((view) => (view.id === id ? { ...view, title } : view)), updatedAt: now });
}

export interface NewVersion {
  readonly id: VersionId;
  readonly viewId: ViewId;
  readonly label: string;
  readonly capture: CaptureBinding;
  readonly thumbnail?: PreviewRef;
  readonly origin: VersionOrigin;
  readonly basedOn?: VersionId;
}

/** Appends a version; earlier versions are carried over by reference, unchanged. */
export function addVersion(content: ProjectContent, input: NewVersion, now: string): ProjectContent {
  if (!content.views.some((view) => view.id === input.viewId)) throw new ContentError(`Unknown view ${input.viewId}`);
  if (content.versions.some((version) => version.id === input.id)) throw new ContentError(`Version ${input.id} already exists`);
  if (input.basedOn && !content.versions.some((version) => version.id === input.basedOn)) throw new ContentError('basedOn must name an existing version');
  const record: VersionRecord = {
    id: input.id, viewId: input.viewId,
    ordinal: content.versions.filter((version) => version.viewId === input.viewId).length + 1,
    label: input.label, createdAt: now, capture: input.capture,
    ...(input.thumbnail ? { thumbnail: input.thumbnail } : {}),
    origin: input.origin, ...(input.basedOn ? { basedOn: input.basedOn } : {}),
  };
  // Round-trip through the strict parser so an invalid capture or thumbnail never enters the document.
  const parsed = parseVersion(JSON.parse(JSON.stringify(record)));
  if (!parsed) throw new ContentError('Version fields are invalid');
  return deepFreeze({ ...content, versions: [...content.versions, parsed], updatedAt: now });
}

/** Explicit owner action. Never inferred from matching titles or remotes. */
export function linkSource(content: ProjectContent, source: SourceProjectId, observedRevision: string | null, now: string): ProjectContent {
  if (content.links.some((link) => link.sourceProjectId === source)) return content;
  const link: WorkspaceSourceLink = { projectId: content.projectId, sourceProjectId: source, linkedAt: now, observedRevision };
  return deepFreeze({ ...content, links: [...content.links, link], updatedAt: now });
}

export function unlinkSource(content: ProjectContent, source: SourceProjectId, now: string): ProjectContent {
  if (!content.links.some((link) => link.sourceProjectId === source)) return content;
  return deepFreeze({ ...content, links: content.links.filter((link) => link.sourceProjectId !== source), updatedAt: now });
}

/**
 * Refuses any change to earlier versions: each previous version must appear in
 * the same position with identical serialized fields.
 */
export function assertAppendOnly(previous: ProjectContent | null, next: ProjectContent): void {
  if (!previous) return;
  if (previous.projectId !== next.projectId) throw new ContentError('Project identity cannot change');
  previous.versions.forEach((version, index) => {
    const candidate = next.versions[index];
    if (!candidate) throw new VersionMutationError(version.id, 'removed');
    if (candidate.id !== version.id) throw new VersionMutationError(version.id, 'reordered or replaced');
    if (stableStringify(candidate) !== stableStringify(version)) throw new VersionMutationError(version.id, 'fields changed');
  });
  for (const view of previous.views) {
    if (!next.views.some((other) => other.id === view.id)) throw new ContentError(`View ${view.id} cannot be removed while it owns versions`);
  }
}

// ------------------------------------------------------------------ queries

export function versionsOf(content: ProjectContent, view: ViewId): readonly VersionRecord[] {
  return content.versions.filter((version) => version.viewId === view);
}

export interface ProjectSummary {
  readonly projectId: ProjectId;
  readonly viewCount: number;
  readonly versionCount: number;
  readonly linkedSources: readonly SourceProjectId[];
  readonly cover?: PreviewRef;
  readonly updatedAt: string;
}

/** Cover is the newest version that has a thumbnail. */
export function summarize(content: ProjectContent): ProjectSummary {
  const cover = [...content.versions].reverse().find((version) => version.thumbnail)?.thumbnail;
  return {
    projectId: content.projectId, viewCount: content.views.length, versionCount: content.versions.length,
    linkedSources: content.links.map((link) => link.sourceProjectId), ...(cover ? { cover } : {}), updatedAt: content.updatedAt,
  };
}

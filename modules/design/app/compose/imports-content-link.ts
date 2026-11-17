/**
 * Links imported PNG versions into project content (B3 backend contract, section 12).
 *
 * An import commit writes imports records. Projects, Gallery, Compare and Annotations read project content, so the
 * same atomic batch also carries the project's content document: a view per imported record and a version per
 * imported image, with a thumbnail pointing at the PNG blob. Either everything lands or nothing does.
 *
 * - IDs are the importer's own deterministic IDs (`view_...`, `ver_...`). A version already in the content is skipped,
 *   so linking the same ops again changes nothing.
 * - Versions are immutable and are never removed. Undo, and keeping the current record in a conflict, leave them where
 *   they are; only the imports record changes.
 * - A conflict keeps the incoming version as unbound evidence. It joins project content only if the owner takes it.
 * - Only PNG image versions are linked. Recordings, HTML bundles and URLs have nothing a view can show yet.
 * - A PNG over the Projects thumbnail cap (2 MiB) gets a deterministic generated thumbnail (`png-thumbnail.ts`, at most
 *   512 px on the long side). Its blob travels in the same atomic batch, before the content document. Any failure, an
 *   unsupported PNG variant or a shortfall in the batch budget links the version with no thumbnail; a thumbnail is never
 *   the reason an import fails or is refused as too large.
 */
import { addVersion, addView, assertAppendOnly, type NewVersion } from '../../projects/src/content.ts';
import { DEFAULT_LIMITS } from '../../projects/src/controller.ts';
import type { ClockPort } from '../../projects/src/contract.ts';
import { parseViewId, parseVersionId, projectId as contentProjectId, type VersionId, type ViewId } from '../../projects/src/ids.ts';
import { ReadOnlyContentError, type ProjectContentRepository } from '../../projects/src/repository.ts';
import { SCHEMAS, type Sha256Digest, type WriteOp } from '../../imports/src/contract.ts';
import type { ImportedRecord, ViewVersionDocument } from '../../imports/src/importer.ts';
import { sha256Hex } from './canonical.ts';
import { pngThumbnail, pngThumbnailSize } from './png-thumbnail.ts';
import { blobCanonicalBytes, type ImportsCommitLink, type ImportsLinkContext } from './imports-storage.ts';

const RECORDS = 'imports/records/';
const VERSIONS = 'imports/versions/';
/** Total source pixels decoded for thumbnails in one batch. Later versions get none once it would be exceeded. */
const BATCH_DECODE_PIXELS = 150_000_000;
/** Allowance for the content document growth per version added: its view, its version entry and a thumbnail reference. */
const CONTENT_GROWTH_PER_VERSION = 4096;
/** Allowance for the content document's own operation envelope. */
const CONTENT_OPERATION_OVERHEAD = 1024;

export interface ImportsContentLinkOptions {
  readonly repository: Pick<ProjectContentRepository, 'load'>;
  readonly clock: ClockPort;
  /** The workspace key of a project's content document (the same key the Projects repository reads and writes). */
  readonly documentKey: (project: string) => string;
  /** Called with a project whose content the batch tried to change, after any outcome: success, refusal or unknown. */
  readonly notify: (project: string) => void;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Display text the content model accepts: trimmed, no control characters, bounded. */
function safeText(value: unknown, max: number, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max).trim() : '';
  return text === '' ? fallback : text;
}

function asRecord(value: unknown): ImportedRecord | null {
  if (!isObject(value) || value.schema !== SCHEMAS.record || value.tombstone !== null || typeof value.versionId !== 'string'
    || typeof value.viewId !== 'string' || typeof value.projectId !== 'string' || typeof value.title !== 'string') return null;
  return value as unknown as ImportedRecord;
}

function asImageVersion(value: unknown): ViewVersionDocument | null {
  if (!isObject(value) || value.schema !== SCHEMAS.version || !isObject(value.content) || value.content.kind !== 'image') return null;
  return value as unknown as ViewVersionDocument;
}

type ImageContent = Extract<ViewVersionDocument['content'], { kind: 'image' }>;
type ThumbnailRef = NonNullable<NewVersion['thumbnail']>;
type PlannedEntry = { record: ImportedRecord; version: ViewVersionDocument; view: ViewId; id: VersionId };

/**
 * Generated thumbnails for one `plan()` call. It owns the batch budgets and the memo, so the same image under two names
 * is decoded once and produces one blob operation. Nothing here throws.
 */
function createThumbnailPlanner(ops: readonly WriteOp[], context: ImportsLinkContext | undefined, reservedBytes: number, reservedOps: number) {
  const inBatch = new Map<string, Uint8Array>();
  for (const op of ops) if (op.op === 'put-blob' && op.namespace === 'workspace') inBatch.set(op.digest, op.bytes);
  const memo = new Map<string, ThumbnailRef | null>();
  const blobOps: WriteOp[] = [];
  let decodedPixels = 0;
  let exhausted = false;
  let plannedBytes = 0;

  /** Whether one more blob of this canonical size, plus its operation, still leaves the batch within the host limits. */
  const fits = (cost: number): boolean => context !== undefined && cost <= context.remainingBytes - reservedBytes - plannedBytes
    && blobOps.length + reservedOps < context.remainingOps;

  async function generate(content: ImageContent): Promise<ThumbnailRef | null> {
    if (context === undefined || exhausted) return null;
    const pixels = content.w * content.h;
    if (!Number.isSafeInteger(pixels) || pixels < 1) return null;
    // The encoded size follows from the dimensions, so a thumbnail that cannot fit is refused before any decoding.
    const expected = pngThumbnailSize(content.w, content.h);
    if (expected === null || !fits(blobCanonicalBytes(expected.bytes))) return null;
    if (decodedPixels + pixels > BATCH_DECODE_PIXELS) { exhausted = true; return null; }
    const source = inBatch.get(content.digest) ?? await context.readBlob(content.digest);
    if (source === null) return null;
    decodedPixels += pixels;
    const thumbnail = await pngThumbnail(source);
    if (thumbnail === null) return null;
    const cost = blobCanonicalBytes(thumbnail.bytes.length);
    // A thumbnail is optional: it may only use what the importer's own operations and the content documents leave free.
    if (!fits(cost)) return null;
    const digest = `sha256:${await sha256Hex(thumbnail.bytes)}` as Sha256Digest;
    plannedBytes += cost;
    blobOps.push({ op: 'put-blob', namespace: 'workspace', digest, mediaType: 'image/png', bytes: thumbnail.bytes });
    return { digest, mediaType: 'image/png', bytes: thumbnail.bytes.length, w: thumbnail.w, h: thumbnail.h };
  }

  return {
    blobOps,
    async thumbnailFor(content: ImageContent): Promise<ThumbnailRef | undefined> {
      // An image within the Projects cap is its own thumbnail.
      if (content.bytes <= DEFAULT_LIMITS.maxThumbnailBytes) return { digest: content.digest, mediaType: content.mediaType, bytes: content.bytes, w: content.w, h: content.h };
      if (!memo.has(content.digest)) {
        let ref: ThumbnailRef | null = null;
        try { ref = await generate(content); } catch { ref = null; }
        memo.set(content.digest, ref);
      }
      return memo.get(content.digest) ?? undefined;
    },
  };
}

export function createImportsContentLink(options: ImportsContentLinkOptions): ImportsCommitLink {
  return {
    async plan(ops, read, context) {
      const versionsInBatch = new Map<string, unknown>();
      const records: ImportedRecord[] = [];
      for (const op of ops) {
        if (op.op !== 'put-document') continue;
        if (op.key.startsWith(VERSIONS)) versionsInBatch.set(op.key, op.value);
        else if (op.key.startsWith(RECORDS)) {
          const record = asRecord(op.value);
          if (record !== null) records.push(record);
        }
      }
      const byProject = new Map<string, { record: ImportedRecord; version: ViewVersionDocument }[]>();
      for (const record of records) {
        const key = VERSIONS + record.versionId;
        const version = asImageVersion(versionsInBatch.has(key) ? versionsInBatch.get(key) : (await read(key))?.value);
        // A record only ever points at a version of its own project and view; anything else is left alone.
        if (version === null || version.projectId !== record.projectId || version.viewId !== record.viewId || version.versionId !== record.versionId) continue;
        const list = byProject.get(record.projectId) ?? [];
        list.push({ record, version });
        byProject.set(record.projectId, list);
      }
      // Load every project's content first: what it will grow by is reserved before any optional thumbnail is planned.
      const encoder = new TextEncoder();
      const loadedProjects: { project: string; loaded: Extract<Awaited<ReturnType<ProjectContentRepository['load']>>, { status: 'ok' }>; fresh: PlannedEntry[] }[] = [];
      let reservedBytes = 0;
      for (const [project, entries] of byProject) {
        const loaded = await options.repository.load(contentProjectId(project));
        // An unsupported or damaged content document opens read-only and is never rewritten.
        if (loaded.status !== 'ok') throw new ReadOnlyContentError(contentProjectId(project), loaded.status);
        const fresh: PlannedEntry[] = [];
        const seen = new Set<string>();
        for (const { record, version } of entries) {
          const view = parseViewId(record.viewId);
          const id = parseVersionId(version.versionId);
          if (view === null || id === null || seen.has(id) || loaded.content.versions.some((existing) => existing.id === id)) continue;
          seen.add(id);
          fresh.push({ record, version, view, id });
        }
        if (fresh.length === 0) continue;
        reservedBytes += encoder.encode(JSON.stringify(loaded.content)).byteLength + CONTENT_OPERATION_OVERHEAD + CONTENT_GROWTH_PER_VERSION * fresh.length;
        loadedProjects.push({ project, loaded, fresh });
      }
      const thumbnails = createThumbnailPlanner(ops, context, reservedBytes, loadedProjects.length);
      const planned: WriteOp[] = [];
      const projects: string[] = [];
      for (const { project, loaded, fresh } of loadedProjects) {
        const now = options.clock.now();
        let next = loaded.content;
        for (const { record, version, view, id } of fresh) {
          if (!next.views.some((existing) => existing.id === view)) next = addView(next, { id: view, title: safeText(record.title, 300, 'Imported image'), kind: 'screen' }, now);
          next = addVersion(next, versionInput(view, id, record, version, await thumbnails.thumbnailFor(version.content as ImageContent)), now);
        }
        if (next === loaded.content) continue;
        assertAppendOnly(loaded.revision === null ? null : loaded.content, next);
        planned.push({ op: 'put-document', namespace: 'workspace', key: options.documentKey(project), value: JSON.parse(JSON.stringify(next)), expectedRevision: loaded.revision });
        projects.push(project);
      }
      // Thumbnail blobs come before the content documents that point at them.
      return { ops: [...thumbnails.blobOps, ...planned], projects };
    },
    changed: options.notify,
  };
}

function versionInput(view: ViewId, id: VersionId, record: ImportedRecord, version: ViewVersionDocument, thumbnail: ThumbnailRef | undefined): NewVersion {
  const content = version.content as ImageContent;
  const name = safeText(version.provenance?.originalName, 200, safeText(record.title, 200, 'image'));
  return {
    id, viewId: view, label: safeText(`Imported ${name}`, 300, 'Imported image'), origin: 'imported',
    // The stored image is the capture: it is bound by its own digest, so marks attach to these exact pixels, never to a thumbnail.
    capture: { route: safeText(`imported/${name}`, 2048, 'imported'), viewport: { w: content.w, h: content.h, dpr: 1 }, captureDigest: content.digest },
    // The Projects thumbnail port refuses anything over its cap, so an image over it carries a generated thumbnail, or none.
    ...(thumbnail === undefined ? {} : { thumbnail }),
  };
}

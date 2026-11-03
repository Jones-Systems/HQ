/**
 * Links imported PNG versions into project content (B3 backend contract, section 7).
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
 */
import { addVersion, addView, assertAppendOnly, type NewVersion } from '../../projects/src/content.ts';
import { DEFAULT_LIMITS } from '../../projects/src/controller.ts';
import type { ClockPort } from '../../projects/src/contract.ts';
import { parseViewId, parseVersionId, projectId as contentProjectId, type VersionId, type ViewId } from '../../projects/src/ids.ts';
import { ReadOnlyContentError, type ProjectContentRepository } from '../../projects/src/repository.ts';
import { SCHEMAS, type WriteOp } from '../../imports/src/contract.ts';
import type { ImportedRecord, ViewVersionDocument } from '../../imports/src/importer.ts';
import type { ImportsCommitLink } from './imports-storage.ts';

const RECORDS = 'imports/records/';
const VERSIONS = 'imports/versions/';

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

export function createImportsContentLink(options: ImportsContentLinkOptions): ImportsCommitLink {
  return {
    async plan(ops, read) {
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
      const planned: WriteOp[] = [];
      const projects: string[] = [];
      for (const [project, entries] of byProject) {
        const loaded = await options.repository.load(contentProjectId(project));
        // An unsupported or damaged content document opens read-only and is never rewritten.
        if (loaded.status !== 'ok') throw new ReadOnlyContentError(contentProjectId(project), loaded.status);
        const now = options.clock.now();
        let next = loaded.content;
        for (const { record, version } of entries) {
          const view = parseViewId(record.viewId);
          const id = parseVersionId(version.versionId);
          if (view === null || id === null || next.versions.some((existing) => existing.id === id)) continue;
          if (!next.views.some((existing) => existing.id === view)) next = addView(next, { id: view, title: safeText(record.title, 300, 'Imported image'), kind: 'screen' }, now);
          next = addVersion(next, versionInput(view, id, record, version), now);
        }
        if (next === loaded.content) continue;
        assertAppendOnly(loaded.revision === null ? null : loaded.content, next);
        planned.push({ op: 'put-document', namespace: 'workspace', key: options.documentKey(project), value: JSON.parse(JSON.stringify(next)), expectedRevision: loaded.revision });
        projects.push(project);
      }
      return { ops: planned, projects };
    },
    changed: options.notify,
  };
}

function versionInput(view: ViewId, id: VersionId, record: ImportedRecord, version: ViewVersionDocument): NewVersion {
  const content = version.content as Extract<ViewVersionDocument['content'], { kind: 'image' }>;
  const name = safeText(version.provenance?.originalName, 200, safeText(record.title, 200, 'image'));
  return {
    id, viewId: view, label: safeText(`Imported ${name}`, 300, 'Imported image'), origin: 'imported',
    // The stored image is the capture: it is bound by its own digest, so marks attach to these exact pixels.
    capture: { route: safeText(`imported/${name}`, 2048, 'imported'), viewport: { w: content.w, h: content.h, dpr: 1 }, captureDigest: content.digest },
    // The Projects thumbnail port refuses anything over its cap, so a larger image has no thumbnail rather than a broken one.
    ...(content.bytes <= DEFAULT_LIMITS.maxThumbnailBytes
      ? { thumbnail: { digest: content.digest, mediaType: content.mediaType, bytes: content.bytes, w: content.w, h: content.h } } : {}),
  };
}

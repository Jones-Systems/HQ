/**
 * Canvas provider over projects (T2) views and versions, and the flows (T11) <-> projects binding.
 *
 * Project identity and version identity are preserved end to end: a placement pins
 * `entityId = <projectId>/<viewId>` and `revision = <versionId>`, T2 versions are append-only, and the
 * provider never answers for a version that is not in that project's content document.
 */
import {
  providerId as canvasProviderId, type CanvasItemDescriptor, type CanvasItemProvider, type CanvasItemRef, type ProjectId as CanvasProjectId,
} from '../../canvas/src/contract.ts';
import type { ProjectContent, VersionRecord, ViewRecord } from '../../projects/src/content.ts';
import type { ProjectContentRepository } from '../../projects/src/repository.ts';
import type { PreviewRef, ThumbnailPort } from '../../projects/src/contract.ts';
import { verifiedDataUrl } from '../../projects/src/loader.ts';
import type { FlowDocument, Screen, ScreenPreviewPort } from '../../flows/src/contract.ts';
import { labelledProviderTitle, tagForVersionOrigin, type EvidenceTag } from './labels.ts';

export const PROJECT_VERSIONS_PROVIDER_ID = 'hq.design.project-versions';

export const projectVersionEntity = (project: string, view: string): string => `${encodeURIComponent(project)}/${encodeURIComponent(view)}`;

export function parseProjectVersionEntity(entityId: string): { readonly project: string; readonly view: string } | null {
  const parts = entityId.split('/');
  if (parts.length !== 2) return null;
  try { return { project: decodeURIComponent(parts[0]!), view: decodeURIComponent(parts[1]!) }; } catch { return null; }
}

export interface ProjectVersionsProvider extends CanvasItemProvider {
  readonly tag: EvidenceTag;
  list(project: CanvasProjectId): readonly CanvasItemDescriptor[];
  /** Load a project's content document (read only). Unsupported or invalid documents contribute nothing. */
  refresh(project: CanvasProjectId): Promise<{ readonly versions: number; readonly status: 'ok' | 'unsupported-schema' | 'invalid' }>;
}

export interface ProjectVersionsOptions {
  readonly repository: Pick<ProjectContentRepository, 'load'>;
  /** Maps the canvas's project id to the shell/content project id (identity when the canvas uses the shell id). */
  readonly toContentProject?: (project: CanvasProjectId) => string;
  /** Tag for where the content document lives: FAKE_TAG for an in-memory store, WORKSPACE_TAG for the durable one. */
  readonly storageTag: EvidenceTag;
}

const finitePositive = (value: number): number => (Number.isFinite(value) && value >= 1 ? value : 1);

export function createProjectVersionsProvider(options: ProjectVersionsOptions): ProjectVersionsProvider {
  const id = canvasProviderId(PROJECT_VERSIONS_PROVIDER_ID);
  const contents = new Map<string, ProjectContent>();
  const listeners = new Set<() => void>();
  const label = labelledProviderTitle('Project views', options.storageTag);
  const contentProject = options.toContentProject ?? ((project: CanvasProjectId): string => project);

  const tagOf = (version: VersionRecord): EvidenceTag => (options.storageTag.status === 'workspace' ? tagForVersionOrigin(version.origin) : options.storageTag);

  const describeVersion = (content: ProjectContent, view: ViewRecord, version: VersionRecord): CanvasItemDescriptor => {
    const tag = tagOf(version);
    const capture = version.capture;
    return {
      ref: { providerId: id, entityId: projectVersionEntity(content.projectId, view.id), revision: version.id },
      title: `${view.title} · ${version.label}${tag.status === 'workspace' ? '' : ` (${tag.status})`}`,
      kind: 'view-version',
      intrinsicSize: { width: finitePositive(capture.viewport.w), height: finitePositive(capture.viewport.h) },
      // A stored capture is a static capture of a browser view; without a capture digest nothing is claimed.
      provenance: capture.captureDigest === undefined ? 'unspecified' : 'static-capture',
      details: [
        { label: 'Project', value: content.projectId },
        { label: 'View', value: `${view.title} (${view.id})` },
        { label: 'Version', value: `${version.id} · #${version.ordinal} · ${version.origin}` },
        { label: 'Route', value: capture.route },
        { label: 'Viewport', value: `${capture.viewport.w}×${capture.viewport.h} @${capture.viewport.dpr}x` },
        { label: 'Source revision', value: capture.sourceRevision ?? 'none recorded' },
        { label: 'Capture digest', value: capture.captureDigest ?? 'none recorded' },
        { label: 'Data', value: tag.text },
      ],
    };
  };

  const find = (ref: CanvasItemRef): CanvasItemDescriptor | null => {
    if (ref.providerId !== id) return null;
    const entity = parseProjectVersionEntity(ref.entityId);
    const content = entity && contents.get(entity.project);
    if (!entity || !content) return null;
    const view = content.views.find((candidate) => candidate.id === entity.view);
    // The exact version must belong to the view and the project; nothing else is ever returned.
    const version = content.versions.find((candidate) => candidate.id === ref.revision && candidate.viewId === entity.view);
    return view && version ? describeVersion(content, view, version) : null;
  };

  return {
    id, label, tag: options.storageTag,
    describe: find,
    list(project) {
      const content = contents.get(contentProject(project));
      if (!content) return [];
      return content.versions.flatMap((version) => {
        const view = content.views.find((candidate) => candidate.id === version.viewId);
        return view ? [describeVersion(content, view, version)] : [];
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refresh(project) {
      const key = contentProject(project);
      const loaded = await options.repository.load(key as ProjectContent['projectId']);
      if (loaded.status === 'ok') contents.set(key, loaded.content); else contents.delete(key);
      for (const listener of [...listeners]) listener();
      return { versions: loaded.status === 'ok' ? loaded.content.versions.length : 0, status: loaded.status };
    },
  };
}

// ---------------------------------------------------------------- flows <-> projects

export type ScreenBinding =
  | 'exact'
  | 'missing-version'
  | 'route-mismatch'
  | 'viewport-mismatch'
  | 'capture-digest-mismatch'
  | 'unverified-capture';

export interface FlowBindingReport {
  /** False when the flow belongs to another project: nothing in it may be resolved against this content. */
  readonly sameProject: boolean;
  readonly screens: readonly { readonly screenId: string; readonly versionId: string; readonly binding: ScreenBinding }[];
}

/**
 * Check each flow screen against the exact T2 version it pins. A screen is `exact` only when the version
 * exists in the same project and agrees on route and viewport and, when the screen records a capture digest,
 * on that digest. Matching titles never bind anything.
 */
export function bindFlowToProject(flow: FlowDocument, content: ProjectContent): FlowBindingReport {
  const sameProject = (flow.projectId as string) === (content.projectId as string);
  return {
    sameProject,
    screens: flow.screens.map((screen) => ({ screenId: screen.id, versionId: screen.versionId, binding: sameProject ? bindScreen(screen, content) : 'missing-version' })),
  };
}

function bindScreen(screen: Screen, content: ProjectContent): ScreenBinding {
  const version = content.versions.find((candidate) => (candidate.id as string) === (screen.versionId as string));
  if (!version) return 'missing-version';
  if (version.capture.route !== screen.route) return 'route-mismatch';
  const a = version.capture.viewport;
  const b = screen.viewport;
  if (a.w !== b.w || a.h !== b.h || a.dpr !== b.dpr) return 'viewport-mismatch';
  if (screen.captureDigest === undefined) return 'unverified-capture';
  if (version.capture.captureDigest === undefined) return 'unverified-capture';
  return version.capture.captureDigest === screen.captureDigest ? 'exact' : 'capture-digest-mismatch';
}

export interface ProjectScreenPreviews extends ScreenPreviewPort {
  /** Fetch verified thumbnails for the screens whose pinned version exists with a thumbnail. */
  warm(flow: FlowDocument, content: ProjectContent, signal?: AbortSignal): Promise<{ readonly loaded: number; readonly failed: readonly string[] }>;
}

const THUMBNAIL_LIMIT = 2 * 1024 * 1024;

/**
 * `ScreenPreviewPort` over project version thumbnails. It answers only for a screen whose pinned version
 * (and recorded digest, when present) matches what was loaded, and only with bytes verified against their
 * `PreviewRef` digest. The URLs are thumbnails, not the captures: the label says so.
 */
export function createProjectScreenPreviews(options: { readonly thumbnails: ThumbnailPort; readonly tag: EvidenceTag }): ProjectScreenPreviews {
  const loaded = new Map<string, { readonly versionId: string; readonly url: string }>();
  return {
    label: `Project version thumbnails (not captures) — ${options.tag.text}`,
    previewUrl(screen) {
      const entry = loaded.get(screen.id);
      return entry && entry.versionId === (screen.versionId as string) ? entry.url : null;
    },
    async warm(flow, content, signal) {
      const failed: string[] = [];
      let count = 0;
      const report = bindFlowToProject(flow, content);
      if (!report.sameProject) return { loaded: 0, failed: flow.screens.map((screen) => screen.id) };
      for (const screen of flow.screens) {
        const binding = report.screens.find((item) => item.screenId === screen.id)?.binding;
        if (binding === 'missing-version' || binding === 'route-mismatch' || binding === 'viewport-mismatch' || binding === 'capture-digest-mismatch') continue;
        const ref: PreviewRef | undefined = content.versions.find((version) => (version.id as string) === (screen.versionId as string))?.thumbnail;
        if (!ref) continue;
        try {
          const controller = new AbortController();
          signal?.addEventListener('abort', () => controller.abort(), { once: true });
          const bytes = await options.thumbnails.readThumbnail(ref, controller.signal);
          loaded.set(screen.id, { versionId: screen.versionId as string, url: await verifiedDataUrl(ref, bytes, THUMBNAIL_LIMIT) });
          count += 1;
        } catch { failed.push(screen.id); }
      }
      return { loaded: count, failed };
    },
  };
}

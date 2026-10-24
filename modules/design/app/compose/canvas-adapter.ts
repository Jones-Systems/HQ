/**
 * Adapter from the asynchronous `listItems`/`resolveItem` provider shape that components (T10) and flows
 * (T11) export to the synchronous `describe`/`list` provider the canvas (T3) consumes. The canvas stays
 * as completed: composition primes a cache before the canvas renders and again when pinned items change.
 *
 * Identity rules, enforced here and pinned by tests:
 * - a placement's `entityId` is the source item key and its `revision` is the source's `sourceRevision`
 *   digest, so the pin is exact; there is no "latest";
 * - `describe` answers only when the cached item still has the pinned revision, otherwise the canvas
 *   shows the placement as unavailable instead of silently rebinding;
 * - an item that belongs to another project or another provider is never exposed;
 * - evidence claims map through `provenanceForClaim`, which never produces native evidence;
 * - data from a fake or synthetic source is labelled in the provider label and in every item's details.
 */
import {
  providerId as canvasProviderId, type CanvasItemDescriptor, type CanvasItemProvider, type CanvasItemRef, type ProjectId as CanvasProjectId,
} from '../../canvas/src/contract.ts';
import { labelledProviderTitle, provenanceForClaim, type EvidenceTag } from './labels.ts';

/** Largest entity id the canvas codec stores. */
export const MAX_ENTITY_ID = 300;

/** The fields of a lane descriptor composition reads. T10's and T11's descriptors both satisfy this. */
export interface SourceItem {
  readonly key: string;
  readonly providerId: string;
  readonly kind: string;
  readonly projectId: string;
  readonly title: string;
  readonly sourceRevision: string;
  readonly intrinsicSize: { readonly width: number; readonly height: number };
  readonly evidence: string;
}

export type SourceResolution<Item extends SourceItem> =
  | { readonly status: 'ok'; readonly item: Item }
  | { readonly status: 'missing'; readonly key: string };

/** The common asynchronous provider shape (T10 `CanvasItemProvider`, T11 `CanvasItemProvider`). */
export interface AsyncCanvasSource<Project extends string, Item extends SourceItem> {
  readonly providerId: string;
  listItems(projectId: Project, signal?: AbortSignal): Promise<readonly Item[]>;
  resolveItem(key: string, signal?: AbortSignal): Promise<SourceResolution<Item>>;
}

export interface RefreshReport {
  /** Items the provider listed for the project. */
  readonly listed: number;
  /** Pinned placements that resolved to their exact revision. */
  readonly pinned: number;
  /** Pinned keys the provider no longer has, or has at another revision. */
  readonly unavailable: readonly string[];
  /** Items left out: identity mismatch or an id the canvas cannot store. */
  readonly skipped: readonly string[];
  /** Provider failures; the previous cache for the failed step is kept. */
  readonly errors: readonly string[];
}

export interface CanvasProviderAdapter extends CanvasItemProvider {
  readonly tag: EvidenceTag;
  list(project: CanvasProjectId): readonly CanvasItemDescriptor[];
  /** Prime the cache for a project and for the placements already pinned in its arrangement. */
  refresh(project: CanvasProjectId, pinned?: readonly CanvasItemRef[], signal?: AbortSignal): Promise<RefreshReport>;
}

export interface CanvasAdapterOptions<Project extends string, Item extends SourceItem> {
  readonly source: AsyncCanvasSource<Project, Item>;
  readonly label: string;
  readonly tag: EvidenceTag;
  /** Converts the canvas project brand to the lane's own project brand without reformatting. */
  readonly toSourceProject: (project: CanvasProjectId) => Project;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : 'Provider failed');

export function createCanvasProviderAdapter<Project extends string, Item extends SourceItem>(
  options: CanvasAdapterOptions<Project, Item>,
): CanvasProviderAdapter {
  const { source, tag } = options;
  const id = canvasProviderId(source.providerId);
  const label = labelledProviderTitle(options.label, tag);
  const items = new Map<string, { readonly project: string; readonly item: Item }>();
  const listed = new Map<string, Set<string>>();
  const listeners = new Set<() => void>();

  const describeItem = (item: Item): CanvasItemDescriptor => ({
    ref: { providerId: id, entityId: item.key, revision: item.sourceRevision },
    title: tag.status === 'workspace' ? item.title : `${item.title} (${tag.status})`,
    kind: item.kind,
    intrinsicSize: { width: item.intrinsicSize.width, height: item.intrinsicSize.height },
    provenance: provenanceForClaim(item.evidence),
    details: [
      { label: 'Project', value: item.projectId },
      { label: 'Source revision', value: item.sourceRevision },
      { label: 'Evidence', value: `${item.evidence} (not native evidence)` },
      { label: 'Data', value: tag.text },
    ],
  });

  const accept = (project: string, item: Item, skipped: string[]): boolean => {
    if (item.providerId !== source.providerId || item.projectId !== project || item.key.length > MAX_ENTITY_ID) {
      skipped.push(item.key);
      return false;
    }
    return true;
  };

  return {
    id,
    label,
    tag,
    describe(ref) {
      if (ref.providerId !== id) return null;
      const entry = items.get(ref.entityId);
      // Never rebind: another revision of the same item is "not available", not "latest".
      return entry && entry.item.sourceRevision === ref.revision ? describeItem(entry.item) : null;
    },
    list(project) {
      const keys = listed.get(project);
      return keys === undefined ? [] : [...keys].flatMap((key) => {
        const entry = items.get(key);
        return entry ? [describeItem(entry.item)] : [];
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refresh(project, pinned = [], signal) {
      const sourceProject = options.toSourceProject(project);
      const skipped: string[] = [];
      const errors: string[] = [];
      const unavailable: string[] = [];
      let listedCount = 0;
      let pinnedCount = 0;
      try {
        const fresh = await source.listItems(sourceProject, signal);
        const keys = new Set<string>();
        for (const item of fresh) {
          if (!accept(sourceProject, item, skipped)) continue;
          items.set(item.key, { project: sourceProject, item });
          keys.add(item.key);
        }
        listed.set(project, keys);
        listedCount = keys.size;
      } catch (error) { errors.push(`list: ${message(error)}`); }
      for (const ref of pinned) {
        if (ref.providerId !== id) continue;
        try {
          const resolved = await source.resolveItem(ref.entityId, signal);
          if (resolved.status === 'missing' || !accept(sourceProject, resolved.item, skipped)) {
            items.delete(ref.entityId);
            unavailable.push(ref.entityId);
          } else if (resolved.item.sourceRevision !== ref.revision) {
            // The key now points at other content; keep it visible as "not available at the pinned revision".
            items.set(resolved.item.key, { project: sourceProject, item: resolved.item });
            unavailable.push(ref.entityId);
          } else {
            items.set(resolved.item.key, { project: sourceProject, item: resolved.item });
            pinnedCount += 1;
          }
        } catch (error) { errors.push(`resolve ${ref.entityId}: ${message(error)}`); }
      }
      for (const listener of [...listeners]) listener();
      return { listed: listedCount, pinned: pinnedCount, unavailable, skipped, errors };
    },
  };
}

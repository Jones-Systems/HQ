/**
 * Lazy caches behind the canvas item renderers: capture thumbnails of project versions and flow summaries.
 * Framework-free, so the loading rules are tested without a renderer.
 */
import type { FlowDocument } from '../../flows/src/contract.ts';
import { parseFlowItemKey } from '../../flows/src/canvas.ts';
import type { ProjectContent } from '../../projects/src/content.ts';
import type { ThumbnailPort } from '../../projects/src/contract.ts';
import { verifiedDataUrl } from '../../projects/src/loader.ts';
import { parseProjectVersionEntity } from './project-versions.ts';

export type Loaded<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'failed' };

const LOADING: Loaded<never> = { status: 'loading' };
const FAILED: Loaded<never> = { status: 'failed' };

export interface LoadCache<T> {
  /** What is known for `key`. The same object until the state changes, so it suits `useSyncExternalStore`. */
  peek(key: string): Loaded<T>;
  /** Start loading `key` unless it is loading, loaded or failed already. */
  want(key: string): void;
  subscribe(listener: () => void): () => void;
  /** Load again whatever failed, for example after the sources refreshed. */
  retryFailed(): void;
  dispose(): void;
}

/** A keyed cache over an asynchronous loader. A loaded value is kept; a failure is kept until `retryFailed`. */
export function createLoadCache<T>(load: (key: string, signal: AbortSignal) => Promise<T>): LoadCache<T> {
  const states = new Map<string, Loaded<T>>();
  const listeners = new Set<() => void>();
  const controller = new AbortController();
  let disposed = false;
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const start = (key: string) => {
    states.set(key, LOADING);
    load(key, controller.signal).then(
      (value) => { if (!disposed) { states.set(key, { status: 'ready', value }); emit(); } },
      () => { if (!disposed) { states.set(key, FAILED); emit(); } },
    );
  };
  return {
    peek: (key) => states.get(key) ?? LOADING,
    want(key) { if (!states.has(key)) start(key); },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    retryFailed() {
      const failed = [...states].filter(([, state]) => state.status === 'failed').map(([key]) => key);
      for (const key of failed) start(key);
      if (failed.length > 0) emit();
    },
    dispose() { disposed = true; controller.abort(); listeners.clear(); },
  };
}

export const THUMBNAIL_LIMIT = 2 * 1024 * 1024;

/** A verified thumbnail as a `data:` URL, or `null` when the version has no thumbnail. A thumbnail, not the capture. */
export type CaptureValue = { readonly url: string } | null;

export const captureKey = (entityId: string, revision: string): string => `${revision}|${entityId}`;

/**
 * Thumbnails of project versions. Each is read through the project content, so versions added in Projects after
 * the canvas opened are found, and verified against the digest in their reference before they are shown.
 */
export function createCaptureCache(options: { readonly readContent: () => Promise<ProjectContent>; readonly thumbnails: ThumbnailPort }): LoadCache<CaptureValue> {
  let content: Promise<ProjectContent> | null = null;
  const cache = createLoadCache<CaptureValue>(async (key, signal) => {
    const split = key.indexOf('|');
    const revision = key.slice(0, split);
    const entity = parseProjectVersionEntity(key.slice(split + 1));
    if (!entity) throw new Error('Not a project version');
    content ??= options.readContent().catch((error: unknown) => { content = null; throw error; });
    const version = (await content).versions.find((candidate) => candidate.id === revision && candidate.viewId === entity.view);
    if (!version) throw new Error('Version not found');
    const ref = version.thumbnail;
    if (!ref) return null;
    return { url: await verifiedDataUrl(ref, await options.thumbnails.readThumbnail(ref, signal), THUMBNAIL_LIMIT) };
  });
  // A retry reads the project content again, since a version missing from it may have been added since.
  return { ...cache, retryFailed() { content = null; cache.retryFailed(); } };
}

export interface FlowSummary {
  readonly title: string;
  readonly steps: number;
}

/** The title and step count of a flow, for the canvas frame. */
export const summarizeFlow = (flow: Pick<FlowDocument, 'title' | 'screens'>): FlowSummary => ({ title: flow.title, steps: flow.screens.length });

/** Flow summaries by canvas item key, read once per flow. */
export function createFlowCache(read: (flowId: string) => Promise<FlowSummary>): LoadCache<FlowSummary> {
  return createLoadCache<FlowSummary>(async (key) => {
    const parsed = parseFlowItemKey(key);
    if (!parsed) throw new Error('Not a flow item');
    return read(parsed.flowId);
  });
}

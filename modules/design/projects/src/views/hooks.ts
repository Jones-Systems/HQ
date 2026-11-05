import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { PreviewRef } from '../contract.ts';
import type { ProjectsController, ProjectsSnapshot } from '../controller.ts';
import type { LoadState, Priority, ThumbnailLoader } from '../loader.ts';

export function useProjects(controller: ProjectsController): ProjectsSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

const PENDING: LoadState<string> = { status: 'pending' };

/**
 * Subscribes while mounted; unmounting (scrolling away) releases the request.
 * A priority change subscribes anew before releasing the old subscription so
 * an in-flight fetch is not aborted and restarted.
 */
export function useThumbnail(loader: ThumbnailLoader, ref: PreviewRef | undefined, priority: Priority): LoadState<string> {
  const [state, setState] = useState<LoadState<string>>(PENDING);
  const release = useRef<(() => void) | null>(null);
  const digest = ref?.digest;
  useEffect(() => {
    setState(PENDING); // A ready value is delivered synchronously by subscribe.
    const next = ref ? loader.subscribe(ref, priority, setState) : null;
    release.current?.();
    release.current = next;
  }, [loader, digest, priority]);
  useEffect(() => () => { release.current?.(); release.current = null; }, []);
  return ref ? state : PENDING;
}

/**
 * Replaces one prefetch subscription set with another; returns the new releases.
 * Subscribes the new set before releasing the old one so a digest present in
 * both windows is not aborted and re-queued.
 */
export function swapPrefetch(loader: ThumbnailLoader, refs: readonly PreviewRef[], previous: readonly (() => void)[]): (() => void)[] {
  const next = refs.map((ref) => loader.subscribe(ref, 'prefetch', () => {}));
  for (const release of previous) release();
  return next;
}

/** Keeps bounded prefetch subscriptions alive without rendering them. */
export function usePrefetch(loader: ThumbnailLoader, refs: readonly PreviewRef[]): void {
  const releases = useRef<readonly (() => void)[]>([]);
  const key = refs.map((ref) => ref.digest).join('|');
  useEffect(() => {
    releases.current = swapPrefetch(loader, refs, releases.current);
  }, [loader, key]);
  useEffect(() => () => { for (const release of releases.current) release(); releases.current = []; }, []);
}

/**
 * Element client size via ResizeObserver. `fallback` is used before measurement
 * and on the server; `measured` turns true once the real size is known.
 */
export function useSize(element: RefObject<HTMLElement | null>, fallback: { readonly width: number; readonly height: number }): { width: number; height: number; measured: boolean } {
  const [size, setSize] = useState({ width: fallback.width, height: fallback.height, measured: false });
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return undefined;
    const measure = () => setSize((previous) => {
      const next = { width: node.clientWidth || fallback.width, height: node.clientHeight || fallback.height, measured: true };
      return next.width === previous.width && next.height === previous.height && previous.measured ? previous : next;
    });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [element, fallback.width, fallback.height]);
  return size;
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { PreviewRef } from '../contract.ts';
import type { ProjectsController, ProjectsSnapshot } from '../controller.ts';
import type { LoadState, Priority, ThumbnailLoader } from '../loader.ts';

export function useProjects(controller: ProjectsController): ProjectsSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

const PENDING: LoadState<string> = { status: 'pending' };

/**
 * Verified thumbnails seen by this renderer, newest last. A tile scrolled back into view starts from its image
 * instead of repeating the placeholder-to-image reveal; the loader's own retention stays the source of truth.
 */
const SEEN = new WeakMap<ThumbnailLoader, Map<string, string>>();
const SEEN_LIMIT = 200;

function seen(loader: ThumbnailLoader, digest: string | undefined): LoadState<string> {
  const url = digest ? SEEN.get(loader)?.get(digest) : undefined;
  return url === undefined ? PENDING : { status: 'ready', value: url };
}

function remember(loader: ThumbnailLoader, digest: string, url: string): void {
  let known = SEEN.get(loader);
  if (!known) { known = new Map(); SEEN.set(loader, known); }
  known.delete(digest);
  known.set(digest, url);
  while (known.size > SEEN_LIMIT) known.delete(known.keys().next().value as string);
}

/**
 * Subscribes while mounted; unmounting (scrolling away) releases the request.
 * A priority change subscribes anew before releasing the old subscription so
 * an in-flight fetch is not aborted and restarted.
 */
export function useThumbnail(loader: ThumbnailLoader, ref: PreviewRef | undefined, priority: Priority): LoadState<string> {
  const digest = ref?.digest;
  const [shown, setShown] = useState<{ readonly digest: string | undefined; readonly state: LoadState<string> }>(() => ({ digest, state: seen(loader, digest) }));
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    // A ready value is delivered synchronously by subscribe when the loader still holds it.
    const next = ref ? loader.subscribe(ref, priority, (state) => {
      if (state.status === 'ready' && digest) remember(loader, digest, state.value);
      setShown({ digest, state });
    }) : null;
    release.current?.();
    release.current = next;
  }, [loader, digest, priority]);
  useEffect(() => () => { release.current?.(); release.current = null; }, []);
  if (!ref) return PENDING;
  return shown.digest === digest ? shown.state : seen(loader, digest);
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

// ------------------------------------------------------------------ motion

/** Milliseconds of a duration token as the document resolves it (0 under reduced motion), or 0 when unset. */
export function tokenMs(element: Element | null, name: string): number {
  if (!element || typeof getComputedStyle !== 'function') return 0;
  const raw = getComputedStyle(element).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : 0;
}

/** Margin after the longest move, matching how long the shared Presence waits for an exit. */
const SETTLE_MARGIN_MS = 80;

/**
 * True for the length of one `slow` move after `signature` changes (never on the first render). Cells use it to turn
 * their `transform` transition and enter animation on only while the list reflows, so scrolling, first layout and
 * live resizing stay instant. The window length comes from the motion token, so it is zero under reduced motion.
 */
export function useReflowWindow(signature: string, host: RefObject<HTMLElement | null>): boolean {
  const [current, setCurrent] = useState(signature);
  const [active, setActive] = useState(false);
  if (current !== signature) {
    setCurrent(signature);
    setActive(true);
  }
  useEffect(() => {
    if (!active) return undefined;
    const length = tokenMs(host.current, '--hq-duration-slow');
    const timer = setTimeout(() => setActive(false), length > 0 ? length + SETTLE_MARGIN_MS : 0);
    return () => clearTimeout(timer);
  }, [active, current, host]);
  return active;
}

/** Marks one id as "just changed" for a short time, so its card plays `hq-flash` once. */
export function useFlash(): { readonly id: string | null; readonly flash: (id: string) => void } {
  const [id, setId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setId(next);
    // Longer than the flash itself, so the class is gone before any later remount could replay it.
    timer.current = setTimeout(() => setId(null), 1600);
  }, []);
  return { id, flash };
}

/** Nearest ancestor that scrolls vertically; Design's content area scrolls the whole section. */
export function scrollParent(element: HTMLElement | null): HTMLElement | null {
  if (!element || typeof getComputedStyle !== 'function') return null;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

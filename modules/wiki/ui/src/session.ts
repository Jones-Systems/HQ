// Session state that outlives a mount. The shell remounts a domain when the user switches away and back, so the
// in-session history, recent pages, the repository filter and scroll positions live here, created once per Wiki
// view. Memory only: nothing is written to storage, and it ends with the window.

import { NAMESPACES, pageKeyEquals, type PageKey, type WikiNamespace } from '../../contract/src/index.ts';
import type { NavState } from './history.ts';

export interface RecentPage {
  readonly key: PageKey;
  readonly title: string;
  /** Session clock, ms. */
  readonly at: number;
}

export interface WikiSession {
  /** The last navigation state, restored on remount. Null before the first mount. */
  nav: NavState | null;
  /** The search repository filter. */
  repos: readonly WikiNamespace[];
  /** Pages opened in the reader, most recent first, unique by key. Stable until the next `visit`. */
  recent(): readonly RecentPage[];
  /** Records that the reader showed `key` with `title`. */
  visit(key: PageKey, title: string): void;
  /** A title seen for `key` this session (reader, search hit or backlink), for labels that only have a key. */
  titleOf(key: PageKey): string | undefined;
  rememberTitle(key: PageKey, title: string): void;
  /** Scroll offset for a view, keyed by the caller (usually history index and destination). */
  scrollFor(id: string): number | undefined;
  saveScroll(id: string, top: number): void;
  /** True while the host is failing after content was shown, so the view raises one toast per outage. */
  outage: boolean;
  subscribe(listener: () => void): () => void;
}

export const MAX_RECENT = 12;
const MAX_TITLES = 500;
const MAX_SCROLL = 200;

export function createWikiSession(now: () => number = () => Date.now()): WikiSession {
  let recent: readonly RecentPage[] = [];
  const titles = new Map<string, string>();
  const scroll = new Map<string, number>();
  const listeners = new Set<() => void>();
  const id = (key: PageKey): string => `${key.namespace}\u0000${key.path}`;
  const bounded = <K, V>(map: Map<K, V>, max: number): void => {
    while (map.size > max) {
      const oldest = map.keys().next();
      if (oldest.done === true) break;
      map.delete(oldest.value);
    }
  };

  const session: WikiSession = {
    nav: null,
    repos: NAMESPACES,
    recent: () => recent,
    visit(key, title) {
      session.rememberTitle(key, title);
      const first = recent[0];
      if (first !== undefined && pageKeyEquals(first.key, key) && first.title === title) return;
      recent = [{ key, title, at: now() }, ...recent.filter((item) => !pageKeyEquals(item.key, key))].slice(0, MAX_RECENT);
      for (const listener of [...listeners]) listener();
    },
    titleOf: (key) => titles.get(id(key)),
    rememberTitle(key, title) {
      titles.delete(id(key));
      titles.set(id(key), title);
      bounded(titles, MAX_TITLES);
    },
    scrollFor: (key) => scroll.get(key),
    saveScroll(key, top) {
      scroll.delete(key);
      scroll.set(key, Math.max(0, Math.round(top)));
      bounded(scroll, MAX_SCROLL);
    },
    outage: false,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return session;
}

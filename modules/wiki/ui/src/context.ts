// What a view may do: read through the injected service (through the session cache), ask the root to navigate, and
// use the two host affordances the shell may inject: toasts and "open Wiki settings". Nothing else is reachable.

import type { PageKey, WikiNamespace, WikiService } from '../../contract/src/index.ts';
import type { WikiCache } from './cache.ts';
import type { WikiSession } from './session.ts';

export interface WikiToastAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface WikiToastOptions {
  /** Showing the same id again updates that toast in place. */
  readonly id?: string;
  readonly description?: string;
  /** Mono provenance line. */
  readonly meta?: string;
  readonly action?: WikiToastAction;
}

/**
 * Structural subset of the shell's toast API, injected by the host; the Wiki never imports it. Use toasts only for
 * one-off events while the screen keeps older content (an outage while browsing, a retry that failed again), never
 * for state a view already shows inline. Failures stay until dismissed.
 */
export interface WikiToastPort {
  info(title: string, options?: WikiToastOptions): unknown;
  success(title: string, options?: WikiToastOptions): unknown;
  warning(title: string, options?: WikiToastOptions): unknown;
  error(title: string, options?: WikiToastOptions): unknown;
  dismiss(id?: string): unknown;
}

/** Host affordances. Both are optional: without them the view still works and shows inline guidance instead. */
export interface WikiHostAffordances {
  readonly toast?: WikiToastPort | null;
  /** Opens HQ Settings at Data sources › Local Wiki. A request; the shell decides. */
  readonly openSettings?: (() => void) | null;
}

export interface ViewCtx {
  readonly service: WikiService;
  /** Session-wide response cache: instant Back, link previews and keeping what loaded when a request fails. */
  readonly cache: WikiCache;
  /** Session state that survives the module remounting: history, recent pages, filter, scroll positions. */
  readonly session: WikiSession;
  /** Null when the host injected none. Calls never throw into the view. */
  readonly toast: WikiToastPort | null;
  /** Null when the host injected none; views then omit the action instead of showing a control that cannot work. */
  readonly openSettings: (() => void) | null;
  readonly openHome: () => void;
  readonly openPage: (key: PageKey) => void;
  /** `replace` updates the current search entry instead of adding one (search as you type). */
  readonly openSearch: (query: string, options?: { readonly replace?: boolean }) => void;
  readonly openTopics: (namespace: WikiNamespace) => void;
  readonly openAmbiguity: (label: string, candidates: readonly PageKey[]) => void;
}

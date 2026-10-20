// Destination handling. `home` is a UI convention; every other form goes through the contract helpers.

import {
  formatDestination,
  parseDestination,
  type PageKey,
  type WikiNamespace,
} from '../../contract/src/index.ts';
import { excerpt } from './format.ts';

export const HOME = 'home';

export interface Notice {
  readonly excerpt: string;
  readonly reason: string;
}

export type Resolved =
  | { readonly view: 'home'; readonly notice: Notice | null }
  | { readonly view: 'page'; readonly key: PageKey }
  | { readonly view: 'search'; readonly query: string }
  | { readonly view: 'topics'; readonly namespace: WikiNamespace };

/** `home` selects home. A destination that does not parse selects home plus an inert notice. */
export function resolveDestination(destination: unknown): Resolved {
  if (destination === HOME) return { view: 'home', notice: null };
  if (typeof destination !== 'string') return { view: 'home', notice: { excerpt: '', reason: 'wrong-type' } };
  const parsed = parseDestination(destination);
  if (!parsed.ok) return { view: 'home', notice: { excerpt: excerpt(destination), reason: parsed.error.reason } };
  switch (parsed.value.kind) {
    case 'page':
      return { view: 'page', key: parsed.value.key };
    case 'search':
      return { view: 'search', query: parsed.value.query };
    default:
      return { view: 'topics', namespace: parsed.value.namespace };
  }
}

function formatted(result: ReturnType<typeof formatDestination>): string | null {
  return result.ok ? result.value : null;
}

export const pageDestination = (key: PageKey): string | null => formatted(formatDestination({ kind: 'page', key }));
export const searchDestination = (query: string): string | null => formatted(formatDestination({ kind: 'search', query }));
export const topicsDestination = (namespace: WikiNamespace): string | null => formatted(formatDestination({ kind: 'topics', namespace }));

/** Short label for the history list. */
export function describeDestination(destination: string): string {
  const resolved = resolveDestination(destination);
  switch (resolved.view) {
    case 'page':
      return `Page · ${resolved.key.namespace}/${excerpt(resolved.key.path, 60)}`;
    case 'search':
      return `Search · ${excerpt(resolved.query, 60)}`;
    case 'topics':
      return `Topics · ${resolved.namespace}`;
    default:
      return resolved.notice === null ? 'Home' : 'Home (unrecognised destination)';
  }
}

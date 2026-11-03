// The Wiki as an HQ reference provider (cross-app finding X9): other HQ apps can find a Wiki page ("Link to…", the
// cross-HQ palette) and later resolve and open it, with the shell's usual Back-to-origin behaviour.
//
// It is structural on purpose. The canonical `ReferenceProvider` lives in `@hq/contracts`, which the app layer does
// not import (see port.ts); the desktop registry proves assignability at compile time when it registers this.
//
// Everything goes through `createWikiClient`, so every response is validated and only the seven reads can be sent.
// Pages are the only kind. A page's identity is `<namespace>/<path>` and its destination is the contract's
// `page/<namespace>/<encoded path>`. A hit that cannot be named within the envelope rules is skipped, never
// shortened: a truncated identity would point at a different page.

import {
  MAX_RESULTS,
  formatDestination,
  makePageKey,
  pageKeyId,
  validateQuery,
  type PageKey,
  type SearchHit,
  type WikiService,
} from '../../contract/src/index.ts';
import { createWikiClient } from './client.ts';
import type { WikiHostPort } from './port.ts';

/** The envelope rules the shell applies to every reference: non-empty, bounded, trimmed, no control characters. */
const MAX_ID_LENGTH = 160;
const MAX_TITLE_LENGTH = 300;
const MAX_DESTINATION_LENGTH = 512;
const ENVELOPE_CONTROL = /[\u0000-\u001f\u007f]/u;

function fits(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !ENVELOPE_CONTROL.test(value);
}

export interface WikiReferenceEnvelope {
  readonly version: 1;
  readonly domain: 'wiki';
  readonly projectId: string;
  readonly kind: 'page';
  readonly entityId: string;
  readonly title: string;
  readonly returnDestination: { readonly domain: 'wiki'; readonly destination: string };
}

/** The part of an envelope this provider reads; a supertype of the shell's `ReferenceEnvelope`. */
export interface WikiReferenceInput {
  readonly domain: string;
  readonly kind: string;
  readonly entityId: string;
  readonly sourceRevision?: string | undefined;
}

export interface WikiReferenceResolution {
  readonly status: 'available' | 'changed' | 'missing' | 'unavailable' | 'unknown';
  readonly observedAt: string;
  readonly latestTitle?: string;
  /** The commit the page was read from. */
  readonly latestRevision?: string;
  readonly destination?: string;
}

export interface WikiReferenceProvider {
  readonly domain: 'wiki';
  readonly kinds: readonly ['page'];
  find(
    query: string,
    scope: { projectId: string; kinds?: readonly string[]; limit: number },
  ): Promise<readonly WikiReferenceEnvelope[]>;
  resolve(envelope: WikiReferenceInput): Promise<WikiReferenceResolution>;
}

function toEnvelope(hit: SearchHit, projectId: string): WikiReferenceEnvelope | null {
  const entityId = pageKeyId(hit.key);
  const destination = formatDestination({ kind: 'page', key: hit.key });
  if (!destination.ok || !fits(entityId, MAX_ID_LENGTH) || !fits(hit.title, MAX_TITLE_LENGTH) || !fits(destination.value, MAX_DESTINATION_LENGTH)) {
    return null;
  }
  return {
    version: 1,
    domain: 'wiki',
    projectId,
    kind: 'page',
    entityId,
    title: hit.title,
    returnDestination: { domain: 'wiki', destination: destination.value },
  };
}

/** `<namespace>/<path>` back to a validated key. Namespaces hold no `/`, so the first one separates them. */
function keyOf(entityId: string): PageKey | null {
  const slash = entityId.indexOf('/');
  if (slash < 0) return null;
  const made = makePageKey(entityId.slice(0, slash), entityId.slice(slash + 1));
  return made.ok ? made.value : null;
}

/**
 * Builds the Wiki reference provider. `getPort` is the same preload-bridge supplier the Wiki domain uses (read on
 * every call; `null` means no bridge) and `now` stamps each observation as an ISO-8601 instant. Nothing here throws:
 * an absent or failing bridge finds nothing and resolves as `unavailable`.
 *
 * `latestRevision` is the page's `commit`, which is the commit the namespace is pinned to. A `changed` result
 * therefore means the Wiki source has moved on since the reference was taken, not necessarily that this page did.
 * Search hits carry no commit, so references made from a search carry no `sourceRevision` and are never `changed`.
 */
export function createWikiReferenceProvider(getPort: () => WikiHostPort | null, now: () => string): WikiReferenceProvider {
  const service: WikiService = createWikiClient(getPort);

  return Object.freeze({
    domain: 'wiki',
    kinds: Object.freeze(['page'] as const),

    async find(query, scope) {
      try {
        if (!Number.isSafeInteger(scope.limit) || scope.limit < 1) return [];
        if (scope.kinds !== undefined && !(Array.isArray(scope.kinds) && scope.kinds.includes('page'))) return [];
        if (!fits(scope.projectId, MAX_ID_LENGTH) || !validateQuery(query).ok) return [];
        const limit = Math.min(scope.limit, MAX_RESULTS);
        const result = await service.search({ query, limit });
        if (!result.ok) return [];
        const found: WikiReferenceEnvelope[] = [];
        for (const hit of result.value.hits) {
          const envelope = toEnvelope(hit, scope.projectId);
          if (envelope !== null) found.push(envelope);
          if (found.length >= limit) break;
        }
        return found;
      } catch {
        return [];
      }
    },

    async resolve(envelope) {
      try {
        const key =
          typeof envelope === 'object' && envelope !== null && envelope.domain === 'wiki' && envelope.kind === 'page' && typeof envelope.entityId === 'string'
            ? keyOf(envelope.entityId)
            : null;
        if (key === null) return { status: 'unknown', observedAt: now() };
        const result = await service.getPage({ key });
        const observedAt = now();
        if (!result.ok) {
          const { code } = result.error;
          return { status: code === 'not-found' ? 'missing' : code === 'invalid-input' ? 'unknown' : 'unavailable', observedAt };
        }
        const page = result.value;
        const destination = formatDestination({ kind: 'page', key: page.key });
        // A page the shell could not be handed a destination for is not offered as openable.
        if (!destination.ok || !fits(destination.value, MAX_DESTINATION_LENGTH)) return { status: 'unknown', observedAt };
        const changed = envelope.sourceRevision !== undefined && envelope.sourceRevision !== page.commit;
        return {
          status: changed ? 'changed' : 'available',
          observedAt,
          latestTitle: page.title,
          latestRevision: page.commit,
          destination: destination.value,
        };
      } catch {
        return { status: 'unavailable', observedAt: now() };
      }
    },
  } satisfies WikiReferenceProvider);
}

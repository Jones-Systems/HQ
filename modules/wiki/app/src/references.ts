// The Wiki as a cross-module reference TARGET (task B5-W2, spec.hq-social-work#req.references.001).
//
// A reference provider that lets Work and Social attach a Wiki page and later resolve it. The Wiki is read-only
// (its Git sources are never written), so this provider only ever answers `find` and `resolve`; it stores no
// outgoing HQ links (RL-1: a link belongs to its source record) and has no execution member (RL-10). It reads the
// Wiki through the contract's `WikiService` and calls exactly two of its methods, `search` and `getPage`.
//
// Identity. The reference is `{ domain: 'wiki', kind: 'page', entityId: <namespace>/<path> }` (`pageKeyId`). The
// Wiki is workspace-wide, so a resolution never carries `targetProjectId` and is never `moved`, `archived` or
// `forbidden`.
//
// Revision. `sourceRevision` is a content token, `wiki-c1:` + the SHA-256 (Web Crypto) of the canonical JSON of
// `{ byteLength, title, fields, content }` of the page as the contract returns it. A page therefore reads `changed`
// only when its own content changes: a new commit that leaves the page untouched yields the same token, so a link
// does not turn `changed` on every unrelated commit to the repository. The commit id is deliberately not part of it,
// and neither is the key (the envelope's `entityId` already names the page). `wiki-c1` versions the recipe: change
// the recipe, change the prefix.
//
// Limits. This module cannot import `@hq/contracts` (the Wiki package depends on `react` alone), so the caps of
// `parseReference` (id <= 160, title <= 300, destination <= 512, text rules) are restated below as `fits`;
// `references.test.ts` pins that restatement to the real `parseReference` and `isDestination`.
//   - A page whose id (`<namespace>/<path>`) would exceed 160 characters cannot be a reference: `find` omits it, and
//     `resolve` answers `unknown` for such an id. Likewise a page whose formatted destination exceeds 512.
//   - A title longer than 300 is cut on a code point boundary and ends with an ellipsis.

import {
  MAX_RESULTS,
  clampQuery,
  formatDestination,
  makePageKey,
  pageKeyEquals,
  pageKeyId,
  type Page,
  type PageKey,
  type WikiService,
} from '../../contract/src/index.ts';

const KIND = 'page';
export const WIKI_REVISION_PREFIX = 'wiki-c1:';
const MAX_ID = 160;
const MAX_TITLE = 300;
const MAX_DESTINATION = 512;

/** Structural counterpart of the `ReferenceEnvelope` that `find` returns. */
export interface WikiReferenceEnvelope {
  readonly version: 1;
  readonly domain: 'wiki';
  readonly projectId: string;
  readonly kind: 'page';
  readonly entityId: string;
  readonly title: string;
  readonly returnDestination: { readonly domain: 'wiki'; readonly destination: string };
  readonly sourceRevision: string;
}

/** The part of any `ReferenceEnvelope` that `resolve` reads. */
export interface WikiReferenceInput {
  readonly domain: string;
  readonly kind: string;
  readonly entityId: string;
  readonly sourceRevision?: string;
}

/** The statuses a Wiki page can have; the rest of the shared vocabulary does not apply to a read-only, workspace-wide source. */
export type WikiReferenceStatus = 'available' | 'changed' | 'missing' | 'unavailable' | 'unknown';

export interface WikiReferenceResolution {
  readonly status: WikiReferenceStatus;
  readonly observedAt: string;
  readonly latestTitle?: string;
  readonly latestRevision?: string;
  readonly destination?: string;
}

/** Structural counterpart of `ReferenceProvider` in `@hq/contracts`; the desktop registry proves assignability. */
export interface WikiReferenceProvider {
  readonly domain: 'wiki';
  readonly kinds: readonly string[];
  find(query: string, scope: { projectId: string; kinds?: readonly string[]; limit: number }): Promise<readonly WikiReferenceEnvelope[]>;
  resolve(envelope: WikiReferenceInput): Promise<WikiReferenceResolution>;
}

const CONTROL = /[\u0000-\u001f\u007f]/u;
const SCHEME_OR_NETWORK = /^[a-z][a-z\d+.-]*:|^[/\\]{2}/iu;

/** `text` of `parseReference`: non-empty, bounded, already trimmed, no control characters. */
function text(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && value.trim() === value && !CONTROL.test(value);
}

/** Whether `parseReference` would accept an envelope with these parts (the destination is checked by `destinationOf`). */
function fits(projectId: string, id: string, title: string, revision: string): boolean {
  return text(projectId, MAX_ID) && text(id, MAX_ID) && text(title, MAX_TITLE) && text(revision, MAX_TITLE);
}

/** Trims, and cuts an over-long title to 300 UTF-16 units without splitting a surrogate pair. */
function displayTitle(title: string, fallback: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return fallback;
  if (trimmed.length <= MAX_TITLE) return trimmed;
  let end = MAX_TITLE - 1;
  const last = trimmed.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${trimmed.slice(0, end).trimEnd()}…`;
}

/** JSON with object keys sorted, so equal content hashes equally whatever order a host built it in. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record).sort().filter((name) => record[name] !== undefined)
      .map((name) => `${JSON.stringify(name)}:${canonicalJson(record[name])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function revisionOf(page: Page): Promise<string> {
  const body = canonicalJson({ byteLength: page.byteLength, title: page.title, fields: page.fields, content: page.content });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  return WIKI_REVISION_PREFIX + Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** `<namespace>/<path>` back to a validated key: the namespace is everything before the first `/`. */
function keyOfId(id: unknown): PageKey | null {
  if (typeof id !== 'string' || id.length > MAX_ID) return null;
  const slash = id.indexOf('/');
  if (slash <= 0) return null;
  const made = makePageKey(id.slice(0, slash), id.slice(slash + 1));
  return made.ok ? made.value : null;
}

function destinationOf(key: PageKey): string | null {
  const formatted = formatDestination({ kind: 'page', key });
  return formatted.ok && text(formatted.value, MAX_DESTINATION) && !SCHEME_OR_NETWORK.test(formatted.value) ? formatted.value : null;
}

/**
 * The Wiki reference provider. `now` stamps `observedAt`, taken after the read it describes. Failures never escape
 * `find` (an empty list) or `resolve` (a status); nothing here writes, and nothing but `search` and `getPage` is called.
 */
export function createWikiReferenceProvider(service: WikiService, now: () => Date = () => new Date()): WikiReferenceProvider {
  async function envelopeFor(key: PageKey, projectId: string): Promise<WikiReferenceEnvelope | null> {
    const id = pageKeyId(key);
    const destination = destinationOf(key);
    // Cheap checks first: an id or destination that cannot be carried costs no read.
    if (id.length > MAX_ID || destination === null) return null;
    const read = await service.getPage({ key: { namespace: key.namespace, path: key.path } });
    if (!read.ok || !pageKeyEquals(read.value.key, key)) return null;
    const sourceRevision = await revisionOf(read.value);
    const title = displayTitle(read.value.title, id);
    if (!fits(projectId, id, title, sourceRevision)) return null;
    return { version: 1, domain: 'wiki', projectId, kind: KIND, entityId: id, title,
      returnDestination: { domain: 'wiki', destination }, sourceRevision };
  }

  return {
    domain: 'wiki',
    kinds: [KIND],
    async find(query, scope) {
      try {
        if (typeof query !== 'string' || !Number.isSafeInteger(scope.limit) || scope.limit <= 0) return [];
        if (scope.kinds && !scope.kinds.includes(KIND)) return [];
        const trimmed = query.trim();
        if (trimmed.length === 0) return [];
        // Both namespaces: `namespaces` is omitted. The search cap is the contract's.
        const searched = await service.search({ query: clampQuery(trimmed), limit: Math.min(scope.limit, MAX_RESULTS) });
        if (!searched.ok) return [];
        // A search hit has no content, so each hit's revision comes from reading that page. A hit that cannot be read
        // or does not fit the envelope limits is left out rather than listed without a revision.
        const settled = await Promise.all(searched.value.hits.map((hit) => envelopeFor(hit.key, scope.projectId).catch(() => null)));
        return settled.filter((envelope): envelope is WikiReferenceEnvelope => envelope !== null);
      } catch {
        return [];
      }
    },
    async resolve(envelope) {
      const stamp = (status: WikiReferenceStatus, rest: Omit<WikiReferenceResolution, 'status' | 'observedAt'> = {}): WikiReferenceResolution =>
        ({ status, observedAt: now().toISOString(), ...rest });
      const key = typeof envelope === 'object' && envelope !== null && envelope.domain === 'wiki' && envelope.kind === KIND
        ? keyOfId(envelope.entityId) : null;
      const destination = key === null ? null : destinationOf(key);
      if (key === null || destination === null) return stamp('unknown');
      let read: Awaited<ReturnType<WikiService['getPage']>>;
      try {
        read = await service.getPage({ key: { namespace: key.namespace, path: key.path } });
      } catch {
        return stamp('unavailable');
      }
      if (!read.ok) return stamp(read.error.code === 'not-found' ? 'missing' : read.error.code === 'unavailable' ? 'unavailable' : 'unknown');
      if (!pageKeyEquals(read.value.key, key)) return stamp('unknown');
      let latestRevision: string;
      try {
        latestRevision = await revisionOf(read.value);
      } catch {
        return stamp('unknown');
      }
      const changed = typeof envelope.sourceRevision === 'string' && envelope.sourceRevision !== latestRevision;
      return stamp(changed ? 'changed' : 'available', { latestTitle: displayTitle(read.value.title, pageKeyId(key)), latestRevision, destination });
    },
  };
}

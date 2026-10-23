// Namespace-scoped link and alias resolution. Everything resolves lexically against the set of page
// paths of one namespace: a link can never name a host path, another namespace or a Git location.

import {
  MAX_PATH_LENGTH,
  MAX_RESULTS,
  pageKeyId,
  validatePagePath,
  type AliasResolution,
  type LinkTarget,
  type PageKey,
  type WikiNamespace,
} from '../../contract/src/index.ts';
import type { RawLink } from './draft.ts';
import { cleanLabel, compareUnits, dirName, normalizeAlias } from './text.ts';

/** What a namespace exposes for resolving names. */
export interface PageDirectory {
  readonly namespace: WikiNamespace;
  /** Exact page paths (relative to the namespace root). */
  readonly paths: ReadonlySet<string>;
  readonly extensions: readonly string[];
  /** Normalised alias -> sorted unique page paths. */
  readonly aliases: ReadonlyMap<string, readonly string[]>;
}

/** Build the alias map from each page's names (title, alias fields, file stem). */
export function buildAliasMap(pages: readonly { readonly path: string; readonly names: readonly string[] }[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const name of page.names) {
      const key = normalizeAlias(name);
      if (key === '') continue;
      const set = map.get(key);
      if (set === undefined) map.set(key, new Set([page.path]));
      else set.add(page.path);
    }
  }
  const out = new Map<string, string[]>();
  for (const [key, set] of map) out.set(key, [...set].sort(compareUnits));
  return out;
}

function pageTarget(namespace: WikiNamespace, path: string): LinkTarget {
  return { kind: 'page', key: { namespace, path } };
}

function missing(text: string): LinkTarget {
  const label = cleanLabel(text, MAX_PATH_LENGTH);
  return { kind: 'missing', label: label === '' ? '(invalid link)' : label };
}

function findPage(dir: PageDirectory, path: string): string | null {
  if (dir.paths.has(path)) return path;
  for (const ext of dir.extensions) if (dir.paths.has(path + ext)) return path + ext;
  return null;
}

function keysOf(namespace: WikiNamespace, paths: readonly string[]): PageKey[] {
  return paths.slice(0, MAX_RESULTS).map((path) => ({ namespace, path }));
}

/** Resolve a free-text name: an exact page path first, then the namespace-scoped alias map. */
export function resolveName(dir: PageDirectory, name: string): AliasResolution {
  const text = cleanLabel(name, 4096);
  const asPath = text.replace(/^\/+/, '');
  if (asPath !== '' && validatePagePath(asPath).ok) {
    const found = findPage(dir, asPath);
    if (found !== null) return { status: 'resolved', target: { namespace: dir.namespace, path: found } };
  }
  const hits = dir.aliases.get(normalizeAlias(text));
  if (hits === undefined || hits.length === 0) return { status: 'missing' };
  if (hits.length === 1) return { status: 'resolved', target: { namespace: dir.namespace, path: hits[0] as string } };
  return { status: 'ambiguous', candidates: keysOf(dir.namespace, hits) };
}

function resolvePath(dir: PageDirectory, dest: string, fromPath: string): LinkTarget {
  let decoded: string;
  try {
    decoded = decodeURIComponent(dest);
  } catch {
    return missing(dest);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\\]/.test(decoded) || decoded.endsWith('/')) return missing(dest);
  const resolved: string[] = decoded.startsWith('/') ? [] : dirName(fromPath).split('/').filter((s) => s !== '');
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) return missing(dest);
      resolved.pop();
    } else resolved.push(segment);
  }
  const path = resolved.join('/');
  if (path === '' || !validatePagePath(path).ok) return missing(dest);
  const found = findPage(dir, path);
  return found === null ? missing(dest) : pageTarget(dir.namespace, found);
}

/** Resolve a draft link for the page at `fromPath`. External links pass through unchanged. */
export function resolveLink(dir: PageDirectory, link: RawLink, fromPath: string): LinkTarget {
  switch (link.kind) {
    case 'external':
      return { kind: 'external', url: link.url };
    case 'path':
      return resolvePath(dir, link.dest, fromPath);
    case 'wiki': {
      const result = resolveName(dir, link.target);
      if (result.status === 'resolved') return pageTarget(dir.namespace, result.target.path);
      if (result.status === 'ambiguous') return { kind: 'ambiguous', candidates: result.candidates };
      return missing(link.target);
    }
  }
}

/** Stable identity of a target, for de-duplication. */
export function targetId(target: LinkTarget): string {
  switch (target.kind) {
    case 'page':
      return `p:${pageKeyId(target.key)}`;
    case 'ambiguous':
      return `a:${target.candidates.map(pageKeyId).join('\n')}`;
    case 'missing':
      return `m:${target.label}`;
    case 'external':
      return `e:${target.url}`;
  }
}

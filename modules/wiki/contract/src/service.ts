// WikiService: the closed read-only surface between the renderer and the Wiki host.
// Inputs are logical keys and queries only. There is deliberately no way to name a root,
// ref, URL, filesystem path or argv, and no method that writes, fetches or executes anything.

import type { AliasResolution, BacklinkResult, IndexStatus, SearchResult, TopicList } from './records.ts';
import { checkAliasText } from './records.ts';
import { checkKeys, isRecord } from './guard.ts';
import { checkQuery, checkResultLimit, MAX_RESULTS } from './limits.ts';
import { checkNamespace, NAMESPACES, type WikiNamespace } from './namespace.ts';
import type { Page } from './page.ts';
import { checkPageKey, type PageKey } from './page-key.ts';
import { failWith, invalid, resultOf, type WikiError, type WikiResult } from './result.ts';
import type { SourceDescriptor } from './source.ts';

export interface SearchRequest {
  readonly query: string;
  /** Repository filter. Omitted = every namespace. */
  readonly namespaces?: readonly WikiNamespace[];
  /** 1..MAX_RESULTS; omitted = MAX_RESULTS. */
  readonly limit?: number;
}
export interface GetPageRequest {
  readonly key: PageKey;
}
export interface ResolveAliasRequest {
  readonly namespace: WikiNamespace;
  readonly alias: string;
}
export interface GetBacklinksRequest {
  readonly key: PageKey;
  /** 1..MAX_RESULTS; omitted = MAX_RESULTS. */
  readonly limit?: number;
}
export interface ListTopicsRequest {
  readonly namespace: WikiNamespace;
}

export interface WikiService {
  listSources(): Promise<WikiResult<readonly SourceDescriptor[]>>;
  search(request: SearchRequest): Promise<WikiResult<SearchResult>>;
  getPage(request: GetPageRequest): Promise<WikiResult<Page>>;
  resolveAlias(request: ResolveAliasRequest): Promise<WikiResult<AliasResolution>>;
  getBacklinks(request: GetBacklinksRequest): Promise<WikiResult<BacklinkResult>>;
  listTopics(request: ListTopicsRequest): Promise<WikiResult<TopicList>>;
  indexStatus(): Promise<WikiResult<IndexStatus>>;
}

/** The complete method set, in declaration order. */
export const WIKI_SERVICE_METHODS = [
  'listSources',
  'search',
  'getPage',
  'resolveAlias',
  'getBacklinks',
  'listTopics',
  'indexStatus',
] as const;

export type WikiServiceMethodName = (typeof WIKI_SERVICE_METHODS)[number];

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** Compile-time guard: fails to type-check if WikiService gains or loses a method relative to WIKI_SERVICE_METHODS. */
export type ServiceMethodSetIsExact = Assert<Equal<keyof WikiService, WikiServiceMethodName>>;

/**
 * Top-level request property names that would hand the renderer a root, ref, URL, path or argv.
 * Rejected with `forbidden-capability` (compared case-insensitively) before any other property check.
 */
export const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  'root',
  'roots',
  'ref',
  'refs',
  'branch',
  'commit',
  'url',
  'urls',
  'uri',
  'remote',
  'repo',
  'repository',
  'path',
  'paths',
  'file',
  'files',
  'dir',
  'directory',
  'cwd',
  'gitdir',
  'argv',
  'args',
  'command',
  'cmd',
  'exec',
  'shell',
  'env',
];

function checkRequestObject(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'request must be an object', path);
  return checkKeys(value, allowed, required, path, FORBIDDEN_REQUEST_KEYS);
}

export interface ResolvedSearchRequest {
  readonly query: string;
  readonly namespaces: readonly WikiNamespace[];
  readonly limit: number;
}

/** Validates and normalises a search request: defaults filled, namespaces de-duplicated. Over-limit input is rejected, not clamped. */
export function validateSearchRequest(value: unknown): WikiResult<ResolvedSearchRequest> {
  const shape = checkRequestObject(value, ['query', 'namespaces', 'limit'], ['query'], '$');
  if (shape !== null) return failWith(shape);
  const request = value as Record<string, unknown>;
  const queryError = checkQuery(request['query'], '$.query');
  if (queryError !== null) return failWith(queryError);

  let namespaces: readonly WikiNamespace[] = NAMESPACES;
  if ('namespaces' in request) {
    const list = request['namespaces'];
    if (!Array.isArray(list)) return failWith(invalid('wrong-type', 'namespaces must be an array', '$.namespaces'));
    if (list.length === 0) return failWith(invalid('empty', 'omit namespaces to search all of them', '$.namespaces'));
    if (list.length > NAMESPACES.length * 4) return failWith(invalid('too-long', 'too many namespaces', '$.namespaces'));
    for (const [i, ns] of list.entries()) {
      const error = checkNamespace(ns, `$.namespaces[${i}]`);
      if (error !== null) return failWith(error);
    }
    namespaces = [...new Set(list as WikiNamespace[])];
  }

  let limit = MAX_RESULTS;
  if ('limit' in request) {
    const error = checkResultLimit(request['limit'], '$.limit');
    if (error !== null) return failWith(error);
    limit = request['limit'] as number;
  }
  return { ok: true, value: { query: request['query'] as string, namespaces, limit } };
}

export function validateGetPageRequest(value: unknown): WikiResult<GetPageRequest> {
  const error = checkRequestObject(value, ['key'], ['key'], '$') ?? checkPageKey((value as Record<string, unknown>)['key'], '$.key');
  return resultOf(error, value as GetPageRequest);
}

export function validateResolveAliasRequest(value: unknown): WikiResult<ResolveAliasRequest> {
  const error =
    checkRequestObject(value, ['namespace', 'alias'], ['namespace', 'alias'], '$') ??
    checkNamespace((value as Record<string, unknown>)['namespace'], '$.namespace') ??
    checkAliasText((value as Record<string, unknown>)['alias'], '$.alias');
  return resultOf(error, value as ResolveAliasRequest);
}

export interface ResolvedBacklinksRequest {
  readonly key: PageKey;
  readonly limit: number;
}

export function validateGetBacklinksRequest(value: unknown): WikiResult<ResolvedBacklinksRequest> {
  const shape = checkRequestObject(value, ['key', 'limit'], ['key'], '$');
  if (shape !== null) return failWith(shape);
  const request = value as Record<string, unknown>;
  const keyError = checkPageKey(request['key'], '$.key');
  if (keyError !== null) return failWith(keyError);
  let limit = MAX_RESULTS;
  if ('limit' in request) {
    const error = checkResultLimit(request['limit'], '$.limit');
    if (error !== null) return failWith(error);
    limit = request['limit'] as number;
  }
  return { ok: true, value: { key: request['key'] as PageKey, limit } };
}

export function validateListTopicsRequest(value: unknown): WikiResult<ListTopicsRequest> {
  const error =
    checkRequestObject(value, ['namespace'], ['namespace'], '$') ?? checkNamespace((value as Record<string, unknown>)['namespace'], '$.namespace');
  return resultOf(error, value as ListTopicsRequest);
}

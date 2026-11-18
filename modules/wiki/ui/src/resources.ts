// One descriptor per read: the cache key that names every input, the service call and the contract check. Views,
// previews and prefetching share these so a page loaded for a hover preview is the same entry the reader shows.

import {
  pageKeyEquals,
  validateAliasResolution,
  validateBacklinkResult,
  validateIndexStatus,
  validatePage,
  validateSearchResult,
  validateSourceDescriptor,
  validateTopicList,
  type AliasResolution,
  type BacklinkResult,
  type IndexStatus,
  type Page,
  type PageKey,
  type SearchResult,
  type SourceDescriptor,
  type TopicList,
  type WikiError,
  type WikiNamespace,
  type WikiResult,
  type WikiService,
} from '../../contract/src/index.ts';
import { invalidResponse } from './format.ts';
import { contract } from './load.ts';

export interface ResourceSpec<T> {
  /** Names every input of `load`. */
  readonly key: string;
  readonly load: () => Promise<WikiResult<T>>;
  readonly check: (value: T) => WikiError | null;
}

export const pageId = (key: PageKey): string => `${key.namespace}\u0000${key.path}`;

export function pageResource(service: WikiService, key: PageKey): ResourceSpec<Page> {
  return {
    key: `page:${pageId(key)}`,
    load: () => service.getPage({ key }),
    check: contract(validatePage, (value) => (pageKeyEquals(value.key, key) ? null : 'The Wiki returned a different page than requested.')),
  };
}

export function backlinksResource(service: WikiService, key: PageKey): ResourceSpec<BacklinkResult> {
  return {
    key: `backlinks:${pageId(key)}`,
    load: () => service.getBacklinks({ key }),
    check: contract(validateBacklinkResult, (value) => (pageKeyEquals(value.target, key) ? null : 'The Wiki returned backlinks for a different page.')),
  };
}

/** `repos` is the filter; all repositories search without a namespace list, exactly as before. */
export function searchResource(service: WikiService, query: string, repos: readonly WikiNamespace[], all: readonly WikiNamespace[]): ResourceSpec<SearchResult> {
  const filtered = repos.length < all.length;
  return {
    key: `search:${repos.join(',')}\u0000${query}`,
    load: () => service.search(filtered ? { query, namespaces: repos } : { query }),
    check: contract(validateSearchResult),
  };
}

export function aliasResource(service: WikiService, namespace: WikiNamespace, alias: string): ResourceSpec<AliasResolution> {
  return {
    key: `alias:${namespace}\u0000${alias}`,
    load: () => service.resolveAlias({ namespace, alias }),
    check: contract(validateAliasResolution),
  };
}

export function topicsResource(service: WikiService, namespace: WikiNamespace): ResourceSpec<TopicList> {
  return {
    key: `topics:${namespace}`,
    load: () => service.listTopics({ namespace }),
    check: contract(validateTopicList, (value) => (value.namespace === namespace ? null : 'The Wiki returned topics for a different repository.')),
  };
}

const checkDescriptor = contract(validateSourceDescriptor);

function checkSources(value: readonly SourceDescriptor[]): WikiError | null {
  if (!Array.isArray(value)) return invalidResponse('The source list was not an array.');
  for (const descriptor of value) {
    const problem = checkDescriptor(descriptor);
    if (problem !== null) return problem;
  }
  return null;
}

export function sourcesResource(service: WikiService): ResourceSpec<readonly SourceDescriptor[]> {
  return { key: 'sources', load: () => service.listSources(), check: checkSources };
}

export function indexStatusResource(service: WikiService): ResourceSpec<IndexStatus> {
  return { key: 'status', load: () => service.indexStatus(), check: contract(validateIndexStatus) };
}

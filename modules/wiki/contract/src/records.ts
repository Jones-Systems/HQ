// Result records: alias resolution, search hits, backlinks, topics, index status.

import { checkInertText, checkInteger, checkKeys, checkLabel, isRecord } from './guard.ts';
import {
  MAX_LABEL_LENGTH,
  MAX_RESULTS,
  MAX_SNIPPET_LENGTH,
  MAX_TOPIC_ID_LENGTH,
  MAX_TOPICS,
  checkQuery,
} from './limits.ts';
import { checkNamespace, NAMESPACES, type WikiNamespace } from './namespace.ts';
import { checkPageKey, pageKeyId, type PageKey } from './page-key.ts';
import { invalid, resultOf, type WikiError, type WikiResult } from './result.ts';
import { checkSourceDescriptor, type SourceDescriptor } from './source.ts';

const MAX_COUNT = 1_000_000_000;

function checkKeyList(value: unknown, path: string, min: number, max: number): WikiError | null {
  if (!Array.isArray(value)) return invalid('wrong-type', 'expected an array of page keys', path);
  if (value.length < min || value.length > max) return invalid('out-of-range', `expected ${min}..${max} page keys`, path);
  const seen = new Set<string>();
  for (const [i, item] of value.entries()) {
    const error = checkPageKey(item, `${path}[${i}]`);
    if (error !== null) return error;
    const id = pageKeyId(item as PageKey);
    if (seen.has(id)) return invalid('duplicate', 'duplicate page key', `${path}[${i}]`);
    seen.add(id);
  }
  return null;
}

// ---- aliases ----

/**
 * Alias lookup is namespace-scoped: the same title in `bl` and `appdev` never resolve to each other.
 * Ambiguity within a namespace is preserved rather than guessed.
 */
export type AliasResolution =
  | { readonly status: 'resolved'; readonly target: PageKey }
  | { readonly status: 'ambiguous'; readonly candidates: readonly PageKey[] }
  | { readonly status: 'missing' };

export function checkAliasText(value: unknown, path: string): WikiError | null {
  return checkLabel(value, path, MAX_LABEL_LENGTH);
}

export function checkAliasResolution(value: unknown, path: string = '$'): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'alias resolution must be an object', path);
  switch (value['status']) {
    case 'resolved':
      return checkKeys(value, ['status', 'target'], ['status', 'target'], path) ?? checkPageKey(value['target'], `${path}.target`);
    case 'ambiguous': {
      const keys = checkKeys(value, ['status', 'candidates'], ['status', 'candidates'], path);
      if (keys !== null) return keys;
      const list = checkKeyList(value['candidates'], `${path}.candidates`, 2, MAX_RESULTS);
      if (list !== null) return list;
      const namespaces = new Set((value['candidates'] as PageKey[]).map((k) => k.namespace));
      return namespaces.size === 1 ? null : invalid('inconsistent', 'alias candidates must share one namespace', `${path}.candidates`);
    }
    case 'missing':
      return checkKeys(value, ['status'], ['status'], path);
    default:
      return invalid('invalid-format', 'status must be resolved, ambiguous or missing', `${path}.status`);
  }
}

export function validateAliasResolution(value: unknown): WikiResult<AliasResolution> {
  return resultOf(checkAliasResolution(value), value as AliasResolution);
}

// ---- search ----

export interface SearchHit {
  readonly key: PageKey;
  readonly title: string;
  /** Lexical relevance; larger is better. Finite and non-negative. */
  readonly score: number;
  /** Plain-text excerpt, shown inertly. */
  readonly snippet: string;
}

export interface SearchResult {
  readonly query: string;
  readonly hits: readonly SearchHit[];
  /** Total matches before the result cap. */
  readonly totalHits: number;
  /** True exactly when `totalHits` exceeds `hits.length`. */
  readonly truncated: boolean;
}

function checkSearchHit(value: unknown, path: string): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'search hit must be an object', path);
  const head =
    checkKeys(value, ['key', 'title', 'score', 'snippet'], ['key', 'title', 'score', 'snippet'], path) ??
    checkPageKey(value['key'], `${path}.key`) ??
    checkLabel(value['title'], `${path}.title`, MAX_LABEL_LENGTH);
  if (head !== null) return head;
  const score = value['score'];
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return invalid('out-of-range', 'score must be a finite number ≥ 0', `${path}.score`);
  }
  return checkInertText(value['snippet'], `${path}.snippet`, MAX_SNIPPET_LENGTH);
}

export function checkSearchResult(value: unknown, path: string = '$'): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'search result must be an object', path);
  const head =
    checkKeys(value, ['query', 'hits', 'totalHits', 'truncated'], ['query', 'hits', 'totalHits', 'truncated'], path) ??
    checkQuery(value['query'], `${path}.query`);
  if (head !== null) return head;
  const hits = value['hits'];
  if (!Array.isArray(hits)) return invalid('wrong-type', 'hits must be an array', `${path}.hits`);
  if (hits.length > MAX_RESULTS) return invalid('too-large', `a response carries at most ${MAX_RESULTS} hits`, `${path}.hits`);
  const seen = new Set<string>();
  for (const [i, hit] of hits.entries()) {
    const error = checkSearchHit(hit, `${path}.hits[${i}]`);
    if (error !== null) return error;
    const id = pageKeyId((hit as SearchHit).key);
    if (seen.has(id)) return invalid('duplicate', 'duplicate hit', `${path}.hits[${i}].key`);
    seen.add(id);
  }
  const total = checkInteger(value['totalHits'], `${path}.totalHits`, hits.length, MAX_COUNT);
  if (total !== null) return total;
  if (typeof value['truncated'] !== 'boolean') return invalid('wrong-type', 'truncated must be a boolean', `${path}.truncated`);
  return value['truncated'] === (value['totalHits'] as number > hits.length)
    ? null
    : invalid('inconsistent', 'truncated must equal totalHits > hits.length', `${path}.truncated`);
}

export function validateSearchResult(value: unknown): WikiResult<SearchResult> {
  return resultOf(checkSearchResult(value), value as SearchResult);
}

// ---- backlinks ----

export interface BacklinkEntry {
  readonly source: PageKey;
  readonly title: string;
}

export interface BacklinkResult {
  readonly target: PageKey;
  readonly entries: readonly BacklinkEntry[];
  readonly total: number;
  readonly truncated: boolean;
}

export function checkBacklinkResult(value: unknown, path: string = '$'): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'backlink result must be an object', path);
  const head =
    checkKeys(value, ['target', 'entries', 'total', 'truncated'], ['target', 'entries', 'total', 'truncated'], path) ??
    checkPageKey(value['target'], `${path}.target`);
  if (head !== null) return head;
  const entries = value['entries'];
  if (!Array.isArray(entries)) return invalid('wrong-type', 'entries must be an array', `${path}.entries`);
  if (entries.length > MAX_RESULTS) return invalid('too-large', `a response carries at most ${MAX_RESULTS} backlinks`, `${path}.entries`);
  const seen = new Set<string>();
  for (const [i, entry] of entries.entries()) {
    const entryPath = `${path}.entries[${i}]`;
    if (!isRecord(entry)) return invalid('wrong-type', 'backlink must be an object', entryPath);
    const error =
      checkKeys(entry, ['source', 'title'], ['source', 'title'], entryPath) ??
      checkPageKey(entry['source'], `${entryPath}.source`) ??
      checkLabel(entry['title'], `${entryPath}.title`, MAX_LABEL_LENGTH);
    if (error !== null) return error;
    const id = pageKeyId((entry as unknown as BacklinkEntry).source);
    if (seen.has(id)) return invalid('duplicate', 'duplicate backlink source', `${entryPath}.source`);
    seen.add(id);
  }
  const total = checkInteger(value['total'], `${path}.total`, entries.length, MAX_COUNT);
  if (total !== null) return total;
  if (typeof value['truncated'] !== 'boolean') return invalid('wrong-type', 'truncated must be a boolean', `${path}.truncated`);
  return value['truncated'] === (value['total'] as number > entries.length)
    ? null
    : invalid('inconsistent', 'truncated must equal total > entries.length', `${path}.truncated`);
}

export function validateBacklinkResult(value: unknown): WikiResult<BacklinkResult> {
  return resultOf(checkBacklinkResult(value), value as BacklinkResult);
}

// ---- topics ----

export interface Topic {
  /** Namespace-local identifier; contains no `/`. */
  readonly id: string;
  readonly label: string;
  /** Parent topic id within the same list, or null for a root topic. */
  readonly parentId: string | null;
  /** Number of pages carrying the topic. */
  readonly pageCount: number;
  /** Preview of member pages, at most MAX_RESULTS. */
  readonly pages: readonly PageKey[];
}

export interface TopicList {
  readonly namespace: WikiNamespace;
  readonly topics: readonly Topic[];
}

function checkTopicId(value: unknown, path: string): WikiError | null {
  const label = checkLabel(value, path, MAX_TOPIC_ID_LENGTH);
  if (label !== null) return label;
  return (value as string).includes('/') ? invalid('invalid-format', 'topic ids cannot contain "/"', path) : null;
}

export function checkTopicList(value: unknown, path: string = '$'): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'topic list must be an object', path);
  const head =
    checkKeys(value, ['namespace', 'topics'], ['namespace', 'topics'], path) ?? checkNamespace(value['namespace'], `${path}.namespace`);
  if (head !== null) return head;
  const topics = value['topics'];
  if (!Array.isArray(topics)) return invalid('wrong-type', 'topics must be an array', `${path}.topics`);
  if (topics.length > MAX_TOPICS) return invalid('too-large', `a response carries at most ${MAX_TOPICS} topics`, `${path}.topics`);
  const ids = new Set<string>();
  for (const [i, topic] of topics.entries()) {
    const topicPath = `${path}.topics[${i}]`;
    if (!isRecord(topic)) return invalid('wrong-type', 'topic must be an object', topicPath);
    const error =
      checkKeys(topic, ['id', 'label', 'parentId', 'pageCount', 'pages'], ['id', 'label', 'parentId', 'pageCount', 'pages'], topicPath) ??
      checkTopicId(topic['id'], `${topicPath}.id`) ??
      checkLabel(topic['label'], `${topicPath}.label`, MAX_LABEL_LENGTH) ??
      (topic['parentId'] === null ? null : checkTopicId(topic['parentId'], `${topicPath}.parentId`)) ??
      checkInteger(topic['pageCount'], `${topicPath}.pageCount`, 0, MAX_COUNT) ??
      checkKeyList(topic['pages'], `${topicPath}.pages`, 0, MAX_RESULTS);
    if (error !== null) return error;
    const id = topic['id'] as string;
    if (ids.has(id)) return invalid('duplicate', `duplicate topic "${id}"`, `${topicPath}.id`);
    ids.add(id);
    if ((topic['pages'] as PageKey[]).some((k) => k.namespace !== value['namespace'])) {
      return invalid('inconsistent', 'topic pages must belong to the list namespace', `${topicPath}.pages`);
    }
    if ((topic['pages'] as unknown[]).length > (topic['pageCount'] as number)) {
      return invalid('inconsistent', 'pageCount cannot be smaller than the previewed pages', `${topicPath}.pageCount`);
    }
  }
  for (const [i, topic] of topics.entries()) {
    const parentId = (topic as Topic).parentId;
    if (parentId !== null && (!ids.has(parentId) || parentId === (topic as Topic).id)) {
      return invalid('inconsistent', 'parentId must name another topic in the list', `${path}.topics[${i}].parentId`);
    }
  }
  return null;
}

export function validateTopicList(value: unknown): WikiResult<TopicList> {
  return resultOf(checkTopicList(value), value as TopicList);
}

// ---- index status ----

export const INDEX_STATES = ['ready', 'building', 'stale', 'unavailable'] as const;
export type IndexState = (typeof INDEX_STATES)[number];

export interface NamespaceIndexStatus {
  readonly namespace: WikiNamespace;
  readonly state: IndexState;
  readonly pageCount: number;
  /** Null exactly when the source is `unavailable`. */
  readonly source: SourceDescriptor | null;
}

export interface IndexStatus {
  readonly namespaces: readonly NamespaceIndexStatus[];
}

export function checkIndexStatus(value: unknown, path: string = '$'): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'index status must be an object', path);
  const keys = checkKeys(value, ['namespaces'], ['namespaces'], path);
  if (keys !== null) return keys;
  const entries = value['namespaces'];
  if (!Array.isArray(entries)) return invalid('wrong-type', 'namespaces must be an array', `${path}.namespaces`);
  if (entries.length > NAMESPACES.length) return invalid('too-large', 'one entry per namespace at most', `${path}.namespaces`);
  const seen = new Set<string>();
  for (const [i, entry] of entries.entries()) {
    const entryPath = `${path}.namespaces[${i}]`;
    if (!isRecord(entry)) return invalid('wrong-type', 'entry must be an object', entryPath);
    const error =
      checkKeys(entry, ['namespace', 'state', 'pageCount', 'source'], ['namespace', 'state', 'pageCount', 'source'], entryPath) ??
      checkNamespace(entry['namespace'], `${entryPath}.namespace`) ??
      checkInteger(entry['pageCount'], `${entryPath}.pageCount`, 0, MAX_COUNT);
    if (error !== null) return error;
    const state = entry['state'];
    if (typeof state !== 'string' || !(INDEX_STATES as readonly string[]).includes(state)) {
      return invalid('invalid-format', `state must be one of ${INDEX_STATES.join(', ')}`, `${entryPath}.state`);
    }
    const source = entry['source'];
    if (state === 'unavailable') {
      if (source !== null) return invalid('inconsistent', 'an unavailable source carries no descriptor', `${entryPath}.source`);
    } else {
      const descriptor = checkSourceDescriptor(source, `${entryPath}.source`);
      if (descriptor !== null) return descriptor;
      if ((source as SourceDescriptor).namespace !== entry['namespace']) {
        return invalid('inconsistent', 'descriptor namespace must match the entry', `${entryPath}.source.namespace`);
      }
    }
    const ns = entry['namespace'] as string;
    if (seen.has(ns)) return invalid('duplicate', `duplicate namespace "${ns}"`, `${entryPath}.namespace`);
    seen.add(ns);
  }
  return null;
}

export function validateIndexStatus(value: unknown): WikiResult<IndexStatus> {
  return resultOf(checkIndexStatus(value), value as IndexStatus);
}

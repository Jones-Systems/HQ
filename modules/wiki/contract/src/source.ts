// SourceDescriptor: provenance and freshness of one namespace's pinned source.
// Graph-snapshot freshness (is our index built from the pinned commit?) is deliberately
// separate from content freshness (is the pinned commit current against the remote?).

import { checkKeys, checkLabel, isIsoUtcTimestamp, isRecord } from './guard.ts';
import { checkNamespace, SOURCE_SCHEMA_ID, type WikiNamespace } from './namespace.ts';
import { invalid, resultOf, type WikiError, type WikiResult } from './result.ts';

export type GraphFreshnessState = 'current' | 'stale' | 'indexing' | 'unavailable';
export type ContentFreshnessState = 'current' | 'behind' | 'unknown';

export const GRAPH_FRESHNESS_STATES: readonly GraphFreshnessState[] = ['current', 'stale', 'indexing', 'unavailable'];
export const CONTENT_FRESHNESS_STATES: readonly ContentFreshnessState[] = ['current', 'behind', 'unknown'];

export interface GraphFreshness {
  readonly state: GraphFreshnessState;
  /** Commit the link/search graph was built from; null when no snapshot exists. `current` requires it to equal the descriptor commit. */
  readonly indexedCommit: string | null;
}

export interface ContentFreshness {
  readonly state: ContentFreshnessState;
  /** When the remote comparison was made. Null exactly when `state` is `unknown` (remote freshness may be unknown). */
  readonly checkedAt: string | null;
}

export interface SourceFreshness {
  readonly graph: GraphFreshness;
  readonly content: ContentFreshness;
}

export interface SourceDescriptor {
  readonly schema: typeof SOURCE_SCHEMA_ID;
  readonly namespace: WikiNamespace;
  /** Display label of the pinned ref (e.g. `main`). Output only: the renderer can never supply a ref. */
  readonly ref: string;
  /** Pinned commit id, lowercase hex (40 SHA-1 or 64 SHA-256). */
  readonly commit: string;
  readonly commitTime: string;
  /** When the graph snapshot was built; null if never indexed. */
  readonly indexedAt: string | null;
  readonly freshness: SourceFreshness;
}

const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REF_LABEL = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,255}$/;

export function checkCommitId(value: unknown, path: string): WikiError | null {
  if (typeof value !== 'string') return invalid('wrong-type', 'commit must be a string', path);
  return COMMIT_ID.test(value) ? null : invalid('invalid-format', 'commit must be 40 or 64 lowercase hex characters', path);
}

export function checkTimestamp(value: unknown, path: string): WikiError | null {
  if (typeof value !== 'string') return invalid('wrong-type', 'timestamp must be a string', path);
  return isIsoUtcTimestamp(value) ? null : invalid('invalid-format', 'timestamp must be ISO-8601 UTC (YYYY-MM-DDTHH:mm:ss[.fff]Z)', path);
}

function checkRef(value: unknown, path: string): WikiError | null {
  const label = checkLabel(value, path, 256);
  if (label !== null) return label;
  const text = value as string;
  if (!REF_LABEL.test(text) || text.includes('..') || text.endsWith('/')) return invalid('invalid-format', 'ref must be a plain ref label', path);
  return null;
}

function checkNullableTimestamp(value: unknown, path: string): WikiError | null {
  return value === null ? null : checkTimestamp(value, path);
}

function checkFreshness(value: unknown, commit: unknown, indexedAt: unknown, path: string): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'freshness must be an object', path);
  const keys = checkKeys(value, ['graph', 'content'], ['graph', 'content'], path);
  if (keys !== null) return keys;

  const graph = value['graph'];
  if (!isRecord(graph)) return invalid('wrong-type', 'graph freshness must be an object', `${path}.graph`);
  const graphKeys = checkKeys(graph, ['state', 'indexedCommit'], ['state', 'indexedCommit'], `${path}.graph`);
  if (graphKeys !== null) return graphKeys;
  const graphState = graph['state'];
  if (typeof graphState !== 'string' || !(GRAPH_FRESHNESS_STATES as readonly string[]).includes(graphState)) {
    return invalid('invalid-format', `graph state must be one of ${GRAPH_FRESHNESS_STATES.join(', ')}`, `${path}.graph.state`);
  }
  const indexedCommit = graph['indexedCommit'];
  if (indexedCommit !== null) {
    const idError = checkCommitId(indexedCommit, `${path}.graph.indexedCommit`);
    if (idError !== null) return idError;
  }
  if (graphState === 'current') {
    if (indexedCommit !== commit) return invalid('inconsistent', 'a current graph must be indexed from the descriptor commit', `${path}.graph.indexedCommit`);
    if (indexedAt === null) return invalid('inconsistent', 'a current graph needs an indexedAt time', `${path}.graph.state`);
  }

  const content = value['content'];
  if (!isRecord(content)) return invalid('wrong-type', 'content freshness must be an object', `${path}.content`);
  const contentKeys = checkKeys(content, ['state', 'checkedAt'], ['state', 'checkedAt'], `${path}.content`);
  if (contentKeys !== null) return contentKeys;
  const contentState = content['state'];
  if (typeof contentState !== 'string' || !(CONTENT_FRESHNESS_STATES as readonly string[]).includes(contentState)) {
    return invalid('invalid-format', `content state must be one of ${CONTENT_FRESHNESS_STATES.join(', ')}`, `${path}.content.state`);
  }
  const checkedAt = content['checkedAt'];
  if (contentState === 'unknown') {
    if (checkedAt !== null) return invalid('inconsistent', 'unknown content freshness cannot carry a check time', `${path}.content.checkedAt`);
  } else {
    if (checkedAt === null) return invalid('inconsistent', 'known content freshness needs a check time', `${path}.content.checkedAt`);
    return checkTimestamp(checkedAt, `${path}.content.checkedAt`);
  }
  return null;
}

export function checkSourceDescriptor(value: unknown, path: string = '$'): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'source descriptor must be an object', path);
  const keys = checkKeys(
    value,
    ['schema', 'namespace', 'ref', 'commit', 'commitTime', 'indexedAt', 'freshness'],
    ['schema', 'namespace', 'ref', 'commit', 'commitTime', 'indexedAt', 'freshness'],
    path,
  );
  if (keys !== null) return keys;
  if (value['schema'] !== SOURCE_SCHEMA_ID) return invalid('invalid-format', `schema must be ${SOURCE_SCHEMA_ID}`, `${path}.schema`);
  return (
    checkNamespace(value['namespace'], `${path}.namespace`) ??
    checkRef(value['ref'], `${path}.ref`) ??
    checkCommitId(value['commit'], `${path}.commit`) ??
    checkTimestamp(value['commitTime'], `${path}.commitTime`) ??
    checkNullableTimestamp(value['indexedAt'], `${path}.indexedAt`) ??
    checkFreshness(value['freshness'], value['commit'], value['indexedAt'], `${path}.freshness`)
  );
}

export function validateSourceDescriptor(value: unknown): WikiResult<SourceDescriptor> {
  return resultOf(checkSourceDescriptor(value), value as SourceDescriptor);
}

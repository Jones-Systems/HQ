// What the Wiki knows about its repositories, read once by the root: the sidebar, the footer chip and Home all show the
// same answer. Per-repository state comes from the index status, with the source descriptor as a fallback.

import {
  NAMESPACES,
  type IndexStatus,
  type SourceDescriptor,
  type WikiError,
  type WikiNamespace,
} from '../../contract/src/index.ts';
import type { ViewCtx } from './context.ts';
import type { StatusTone } from './feedback.ts';
import { isOutage, namespaceLabel } from './format.ts';
import { useResource, type Resource } from './load.ts';
import { indexStatusResource, sourcesResource } from './resources.ts';

export type RepoState = 'ready' | 'stale' | 'building' | 'unavailable' | 'unknown' | 'loading';

export interface RepoRow {
  readonly namespace: WikiNamespace;
  readonly label: string;
  readonly state: RepoState;
  /** Status word shown next to the shape: Ready, Stale, Indexing, Unavailable. */
  readonly word: string;
  readonly tone: StatusTone;
  readonly pageCount: number | null;
  readonly source: SourceDescriptor | null;
}

export interface OverallStatus {
  readonly word: string;
  readonly tone: StatusTone;
  readonly busy: boolean;
}

export interface WikiStatus {
  readonly sources: Resource<readonly SourceDescriptor[]>;
  readonly index: Resource<IndexStatus>;
  readonly rows: readonly RepoRow[];
  /** Nothing is known yet and a request is still running. */
  readonly loading: boolean;
  /** Something about the repositories is known (a value is shown). */
  readonly known: boolean;
  /** The Wiki is not set up or its host does not answer, and nothing has loaded: one calm "Connect" state. */
  readonly notConnected: boolean;
  readonly overall: OverallStatus;
  /** The failure of the first request that has one (a value may still be shown next to it). */
  readonly error: WikiError | null;
  /** Asks both reads again, whatever the cache holds. */
  readonly retry: () => void;
}

const WORDS: Readonly<Record<Exclude<RepoState, 'loading' | 'unknown'>, { readonly word: string; readonly tone: StatusTone }>> = {
  ready: { word: 'Ready', tone: 'ok' },
  stale: { word: 'Stale', tone: 'warning' },
  building: { word: 'Indexing', tone: 'pending' },
  unavailable: { word: 'Unavailable', tone: 'danger' },
};

function fromDescriptor(source: SourceDescriptor): RepoState {
  switch (source.freshness.graph.state) {
    case 'current':
      return 'ready';
    case 'stale':
      return 'stale';
    case 'indexing':
      return 'building';
    default:
      return 'unavailable';
  }
}

function row(namespace: WikiNamespace, sources: Resource<readonly SourceDescriptor[]>, index: Resource<IndexStatus>): RepoRow {
  const entry = index.value?.namespaces.find((candidate) => candidate.namespace === namespace) ?? null;
  const descriptor = sources.value?.find((candidate) => candidate.namespace === namespace) ?? entry?.source ?? null;
  const label = namespaceLabel(namespace);
  let state: RepoState;
  if (entry !== null) state = entry.state;
  else if (descriptor !== null) state = fromDescriptor(descriptor);
  else if (sources.status === 'loading' || index.status === 'loading') state = 'loading';
  else if (index.error !== null && isOutage(index.error)) state = 'unavailable';
  else state = 'unknown';
  const pageCount = entry === null || entry.state === 'unavailable' ? null : entry.pageCount;
  if (state === 'loading') return { namespace, label, state, word: 'Checking', tone: 'neutral', pageCount, source: descriptor };
  if (state === 'unknown') return { namespace, label, state, word: 'Unknown', tone: 'neutral', pageCount, source: descriptor };
  return { namespace, label, state, ...WORDS[state], pageCount, source: descriptor };
}

export function useWikiStatus(ctx: ViewCtx): WikiStatus {
  const sources = useResource(sourcesResource(ctx.service), ctx.cache);
  const index = useResource(indexStatusResource(ctx.service), ctx.cache);
  const rows = NAMESPACES.map((namespace) => row(namespace, sources, index));
  const known = sources.value !== undefined || index.value !== undefined;
  const loading = !known && (sources.status === 'loading' || index.status === 'loading');

  const hostSilent =
    sources.value === undefined && index.value === undefined && sources.error !== null && index.error !== null && isOutage(sources.error) && isOutage(index.error);
  const notSetUp =
    index.value !== undefined &&
    index.value.namespaces.every((entry) => entry.state === 'unavailable' && entry.source === null) &&
    (sources.value === undefined || sources.value.length === 0);
  const notConnected = hostSilent || notSetUp;

  const failing = (sources.error !== null && isOutage(sources.error)) || (index.error !== null && isOutage(index.error));
  let overall: OverallStatus;
  if (loading) overall = { word: 'Checking', tone: 'neutral', busy: true };
  else if (notConnected) overall = { word: 'Not connected', tone: 'neutral', busy: false };
  else if (failing || rows.some((item) => item.state === 'unavailable')) overall = { word: 'Unavailable', tone: 'danger', busy: false };
  else if (rows.some((item) => item.state === 'stale')) overall = { word: 'Stale', tone: 'warning', busy: false };
  else if (rows.some((item) => item.state === 'building')) overall = { word: 'Indexing', tone: 'pending', busy: true };
  else if (rows.every((item) => item.state === 'ready')) overall = { word: 'Ready', tone: 'ok', busy: false };
  else overall = { word: 'Unknown', tone: 'neutral', busy: false };

  return {
    sources,
    index,
    rows,
    loading,
    known,
    notConnected,
    overall,
    error: sources.error ?? index.error,
    retry: () => {
      sources.retry();
      index.retry();
    },
  };
}

export { WikiSetupGate, classifyWikiSetup } from './setup.ts';
export type { WikiSetup, WikiSetupGateProps } from './setup.ts';

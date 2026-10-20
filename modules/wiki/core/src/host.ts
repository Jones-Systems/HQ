// The Wiki host: owns the sources, the index lifecycle and the read-only WikiService.
// `refresh` is host-only and deliberately not part of WikiService: the renderer can never trigger
// source access beyond reading a page blob that the current index already knows.

import {
  MAX_PAGE_BLOB_BYTES,
  NAMESPACES,
  failWith,
  ok,
  serviceError,
  validateAliasResolution,
  validateBacklinkResult,
  validateGetBacklinksRequest,
  validateGetPageRequest,
  validateIndexStatus,
  validateListTopicsRequest,
  validateNamespace,
  validatePage,
  validateResolveAliasRequest,
  validateSearchRequest,
  validateSearchResult,
  validateSourceDescriptor,
  validateTopicList,
  type BacklinkResult,
  type IndexStatus,
  type NamespaceIndexStatus,
  type SourceDescriptor,
  type WikiNamespace,
  type WikiResult,
  type WikiService,
} from '../../contract/src/index.ts';
import { analyzePage, buildPage } from './analyze.ts';
import { buildSnapshot } from './build.ts';
import { createNamespaceIndex, pageKey, rank, toSearchHit, type NamespaceIndex } from './namespace-index.ts';
import type { Clock, GitObjectSource, IndexStore, Pin } from './ports.ts';
import { profileIndexKey, validateSourceProfile, type SourceProfile } from './profile.ts';
import { resolveName } from './resolver.ts';
import { parseSnapshot } from './snapshot.ts';
import { tokenize } from './text.ts';

export interface WikiHostOptions {
  /** Data-only source profiles; each is validated and normalised. At most one per namespace. */
  readonly profiles: readonly unknown[];
  /** The Git-object source of each namespace. A profile without a source is permanently unavailable. */
  readonly sources: Readonly<Partial<Record<WikiNamespace, GitObjectSource>>>;
  readonly store: IndexStore;
  readonly clock: Clock;
}

export interface WikiHost {
  readonly service: WikiService;
  /**
   * Re-pin and re-index one namespace (or all configured ones, one after another). Host-only:
   * WikiService has no refresh. Resolves to the resulting index status.
   */
  refresh(namespace?: WikiNamespace): Promise<WikiResult<IndexStatus>>;
}

interface Active {
  readonly index: NamespaceIndex;
}

interface State {
  readonly profile: SourceProfile;
  readonly profileKey: string;
  readonly source: GitObjectSource | null;
  active: Active | null;
  pending: Pin | null;
  building: boolean;
  /** The last refresh could not reach or read the source. */
  failed: boolean;
  inflight: Promise<void> | null;
}

const UNKNOWN_CONTENT = { state: 'unknown', checkedAt: null } as const;

function unavailable(reason: 'source-unavailable' | 'index-unavailable', message: string): WikiResult<never> {
  return failWith(serviceError('unavailable', reason, message));
}

function internalError(): WikiResult<never> {
  return failWith(serviceError('internal', 'internal', 'internal error'));
}

function descriptor(state: State): SourceDescriptor | null {
  const { active, pending, building, failed, profile } = state;
  if (active === null) {
    if (!building || pending === null) return null;
    return {
      schema: 'hq.wiki.source/v1',
      namespace: profile.namespace,
      ref: pending.ref,
      commit: pending.commit,
      commitTime: pending.commitTime,
      indexedAt: null,
      freshness: { graph: { state: 'indexing', indexedCommit: null }, content: UNKNOWN_CONTENT },
    };
  }
  const snapshot = active.index.snapshot;
  const target = building && pending !== null ? pending : snapshot;
  const graph = building
    ? ({ state: 'indexing', indexedCommit: snapshot.commit } as const)
    : failed
      ? ({ state: 'stale', indexedCommit: snapshot.commit } as const)
      : ({ state: 'current', indexedCommit: snapshot.commit } as const);
  return {
    schema: 'hq.wiki.source/v1',
    namespace: profile.namespace,
    ref: target.ref,
    commit: target.commit,
    commitTime: target.commitTime,
    indexedAt: snapshot.indexedAt,
    freshness: { graph, content: UNKNOWN_CONTENT },
  };
}

function statusOf(state: State): NamespaceIndexStatus {
  const source = descriptor(state);
  const pageCount = state.active?.index.pages.length ?? 0;
  if (source === null) return { namespace: state.profile.namespace, state: 'unavailable', pageCount: 0, source: null };
  const phase = state.building ? 'building' : state.failed ? 'stale' : 'ready';
  return { namespace: state.profile.namespace, state: phase, pageCount, source };
}

function pinIsSound(pin: Pin): boolean {
  return validateSourceDescriptor({
    schema: 'hq.wiki.source/v1',
    namespace: 'bl',
    ref: pin.ref,
    commit: pin.commit,
    commitTime: pin.commitTime,
    indexedAt: null,
    freshness: { graph: { state: 'unavailable', indexedCommit: null }, content: UNKNOWN_CONTENT },
  }).ok;
}

/**
 * Create the host. Profiles are validated here: an invalid or duplicate profile is a configuration
 * error and throws, so a misconfigured host fails loudly instead of serving a partial wiki.
 */
export function createWikiHost(options: WikiHostOptions): WikiHost {
  const states = new Map<WikiNamespace, State>();
  for (const candidate of options.profiles) {
    const checked = validateSourceProfile(candidate);
    if (!checked.ok) throw new Error(`invalid source profile: ${checked.error.reason} at ${checked.error.path ?? '$'}`);
    const profile = checked.value;
    if (states.has(profile.namespace)) throw new Error(`duplicate source profile for namespace ${profile.namespace}`);
    states.set(profile.namespace, {
      profile,
      profileKey: profileIndexKey(profile),
      source: options.sources[profile.namespace] ?? null,
      active: null,
      pending: null,
      building: false,
      failed: false,
      inflight: null,
    });
  }
  const configured = NAMESPACES.filter((ns) => states.has(ns));
  const indexOf = (namespace: WikiNamespace): NamespaceIndex | null => states.get(namespace)?.active?.index ?? null;

  const guard = async <T>(run: () => Promise<WikiResult<T>>): Promise<WikiResult<T>> => {
    try {
      return await run();
    } catch {
      return internalError();
    }
  };
  const checked = <T>(result: WikiResult<T>): WikiResult<T> => (result.ok ? result : internalError());
  const noIndex = (): WikiResult<never> => unavailable('index-unavailable', 'no index is available for that source');

  const status = (): IndexStatus => ({ namespaces: configured.map((ns) => statusOf(states.get(ns) as State)) });

  const service: WikiService = {
    listSources() {
      return guard(async () => {
        const sources: SourceDescriptor[] = [];
        for (const ns of configured) {
          const source = descriptor(states.get(ns) as State);
          if (source !== null) sources.push(source);
        }
        for (const source of sources) if (!validateSourceDescriptor(source).ok) return internalError();
        return ok(sources);
      });
    },

    search(request) {
      return guard(async () => {
        const valid = validateSearchRequest(request);
        if (!valid.ok) return valid;
        const { query, namespaces, limit } = valid.value;
        const indexes = namespaces.map(indexOf).filter((index): index is NamespaceIndex => index !== null);
        if (indexes.length === 0) return noIndex();
        const terms = [...new Set(tokenize(query))];
        const ranked = rank(indexes, terms);
        const termSet = new Set(terms);
        const hits = ranked.slice(0, limit).map((hit) => toSearchHit(hit, termSet));
        return checked(validateSearchResult({ query, hits, totalHits: ranked.length, truncated: ranked.length > hits.length }));
      });
    },

    getPage(request) {
      return guard(async () => {
        const valid = validateGetPageRequest(request);
        if (!valid.ok) return valid;
        const { namespace, path } = valid.value.key;
        const state = states.get(namespace);
        const index = state?.active?.index ?? null;
        if (state === undefined || index === null) return noIndex();
        const entry = index.byPath.get(path);
        if (entry === undefined) return failWith(serviceError('not-found', 'not-found', 'page not found'));
        if (state.source === null) return unavailable('source-unavailable', 'the source is not available');
        const blob = await state.source.readBlob(entry.oid, MAX_PAGE_BLOB_BYTES);
        if (!blob.ok) {
          if (blob.reason === 'unavailable') return unavailable('source-unavailable', 'the source is not available');
          return failWith(serviceError('not-found', 'not-found', 'page not found'));
        }
        const analysis = analyzePage(path, blob.value, state.profile);
        return checked(validatePage(buildPage(analysis, index.directory, path, index.snapshot.commit)));
      });
    },

    resolveAlias(request) {
      return guard(async () => {
        const valid = validateResolveAliasRequest(request);
        if (!valid.ok) return valid;
        const index = indexOf(valid.value.namespace);
        if (index === null) return noIndex();
        return checked(validateAliasResolution(resolveName(index.directory, valid.value.alias)));
      });
    },

    getBacklinks(request) {
      return guard(async () => {
        const valid = validateGetBacklinksRequest(request);
        if (!valid.ok) return valid;
        const { key, limit } = valid.value;
        const index = indexOf(key.namespace);
        if (index === null) return noIndex();
        if (!index.byPath.has(key.path)) return failWith(serviceError('not-found', 'not-found', 'page not found'));
        const sources = index.backlinks.get(key.path) ?? [];
        const entries = sources.slice(0, limit).map((page) => ({ source: pageKey(key.namespace, page.path), title: page.title }));
        const result: BacklinkResult = { target: pageKey(key.namespace, key.path), entries, total: sources.length, truncated: sources.length > entries.length };
        return checked(validateBacklinkResult(result));
      });
    },

    listTopics(request) {
      return guard(async () => {
        const valid = validateListTopicsRequest(request);
        if (!valid.ok) return valid;
        const index = indexOf(valid.value.namespace);
        if (index === null) return noIndex();
        return checked(validateTopicList(index.topics));
      });
    },

    indexStatus() {
      return guard(async () => checked(validateIndexStatus(status())));
    },
  };

  const refreshOne = async (state: State): Promise<void> => {
    const { profile, source } = state;
    if (source === null) {
      state.failed = state.active !== null;
      return;
    }
    const pin = await source.resolvePin();
    if (!pin.ok || !pinIsSound(pin.value)) {
      state.failed = true;
      return;
    }
    state.pending = pin.value;
    state.building = true;
    try {
      const current = state.active?.index.snapshot;
      if (current !== undefined && current.commit === pin.value.commit && current.profileKey === state.profileKey) {
        state.failed = false;
        return;
      }
      const expected = { namespace: profile.namespace, commit: pin.value.commit, profileKey: state.profileKey };
      let snapshot = parseSnapshot(await options.store.read(profile.namespace, pin.value.commit).catch(() => null), expected);
      if (snapshot === null) {
        const built = await buildSnapshot({
          profile,
          source,
          pin: pin.value,
          indexedAt: new Date(options.clock.now()).toISOString(),
        });
        if (!built.ok) {
          state.failed = true;
          return;
        }
        snapshot = built.snapshot;
        // A cache that cannot be written is not a reason to withhold a correct index.
        await options.store.write(profile.namespace, pin.value.commit, snapshot).catch(() => undefined);
      }
      state.active = { index: createNamespaceIndex(snapshot, profile.topicMode, profile.pageExtensions) };
      state.failed = false;
    } catch {
      state.failed = true;
    } finally {
      state.building = false;
      state.pending = null;
    }
  };

  const refreshState = (state: State): Promise<void> => {
    if (state.inflight !== null) return state.inflight;
    const run = refreshOne(state)
      .catch(() => {
        state.failed = true;
      })
      .finally(() => {
        state.inflight = null;
      });
    state.inflight = run;
    return run;
  };

  return {
    service,
    async refresh(namespace) {
      let targets: readonly WikiNamespace[] = configured;
      if (namespace !== undefined) {
        const valid = validateNamespace(namespace);
        if (!valid.ok) return valid;
        targets = configured.filter((ns) => ns === valid.value);
      }
      for (const ns of targets) await refreshState(states.get(ns) as State);
      return validateIndexStatus(status());
    },
  };
}

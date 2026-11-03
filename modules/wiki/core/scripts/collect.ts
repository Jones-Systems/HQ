// Collector: builds one namespace with the real Git adapter and host (in memory, nothing written), runs
// the seven WikiService methods and reduces everything to counts, rates and timings. Page data is read
// only to be counted or classified; no value derived from it other than a number or a member of a fixed
// enumeration is ever stored in the result.

import { execFile } from 'node:child_process';
import {
  MAX_OUT_LINKS,
  RAW_REASONS,
  validateAliasResolution,
  validateBacklinkResult,
  validateIndexStatus,
  validatePage,
  validateSearchResult,
  validateSourceDescriptor,
  validateTopicList,
  type RawReason,
  type WikiNamespace,
  type WikiResult,
} from '../../contract/src/index.ts';
import {
  MAX_EXCERPT_UNITS,
  createMemoryIndexStore,
  createNodeGitObjectSource,
  createWikiHost,
  parseSnapshot,
  profileIndexKey,
  type IndexSnapshot,
  type SourceProfile,
} from '../src/index.ts';
import { normalizeAlias } from '../src/text.ts';
import { AMBIGUOUS_BUCKETS, LINK_KINDS, MISSING_SHAPES, ambiguousBucket, everyNth, missingShape, percentile, round2 } from './classify.ts';
import { ERROR_CODES, MAX_SAMPLE, type NamespaceReport } from './report.ts';

type Count<K extends string> = { [P in K]: number };
type ErrorTally = Count<(typeof ERROR_CODES)[number]>;

function zeros<const K extends readonly string[]>(keys: K): Count<K[number]> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Count<K[number]>;
}

/** The part of a report that depends only on the stored snapshot. */
type SnapshotFigures = Pick<
  NamespaceReport,
  'raw' | 'nullOmissions' | 'skipped' | 'oversize' | 'outLinkCaps' | 'excerptsAtCap' | 'links' | 'missingShapes' | 'ambiguousCandidates' | 'backlinks'
>;

export interface SnapshotSummary {
  readonly figures: SnapshotFigures;
  /** Distinct topics before the contract's cap: labels (field mode) or directories (directory mode). */
  readonly topicCandidates: number;
}

/** Count what the snapshot holds: stats, link targets by kind and shape, backlink edges, topic candidates. */
export function summarizeSnapshot(snapshot: IndexSnapshot, profile: SourceProfile): SnapshotSummary {
  const { stats } = snapshot;
  const targets = zeros(LINK_KINDS);
  const missingShapes = zeros(MISSING_SHAPES);
  const ambiguousCandidates = zeros(AMBIGUOUS_BUCKETS);
  const known = new Set(snapshot.pages.map((page) => page.path));
  const inbound = new Set<string>();
  const topicLabels = new Set<string>();
  const directories = new Set<string>();
  let edges = 0;
  let excerptsAtCap = 0;
  for (const page of snapshot.pages) {
    if (page.excerpt.length >= MAX_EXCERPT_UNITS) excerptsAtCap++;
    for (const link of page.links) {
      targets[link.kind]++;
      if (link.kind === 'missing') missingShapes[missingShape(link.label, profile.pageExtensions)]++;
      else if (link.kind === 'ambiguous') ambiguousCandidates[ambiguousBucket(link.candidates.length)]++;
      else if (link.kind === 'page' && link.key.path !== page.path && known.has(link.key.path)) {
        edges++;
        inbound.add(link.key.path);
      }
    }
    if (profile.topicMode === 'field') {
      for (const label of page.topics) {
        const key = normalizeAlias(label);
        if (key !== '') topicLabels.add(key);
      }
    } else if (profile.topicMode === 'directory') {
      const segments = page.path.split('/').slice(0, -1);
      for (let depth = 1; depth <= segments.length; depth++) directories.add(segments.slice(0, depth).join('/'));
    }
  }
  const internal = targets.page + targets.missing + targets.ambiguous;
  const rawTotal = stats.rawFrontmatter + stats.rawMarkdown + stats.rawNotText;
  return {
    figures: {
      raw: {
        total: rawTotal,
        ratePct: snapshot.pages.length === 0 ? 0 : round2((rawTotal / snapshot.pages.length) * 100),
        byReason: { 'frontmatter-unsupported': stats.rawFrontmatter, 'markdown-unsupported': stats.rawMarkdown, 'not-text': stats.rawNotText },
      },
      nullOmissions: stats.nullOmissions,
      skipped: { symlinks: stats.skippedSymlinks, submodules: stats.skippedSubmodules, other: stats.skippedOther, invalidPaths: stats.skippedInvalidPaths },
      oversize: stats.skippedOversize,
      outLinkCaps: stats.outLinkCaps,
      excerptsAtCap,
      links: { targets, internalResolutionPct: internal === 0 ? null : round2((targets.page / internal) * 100) },
      missingShapes,
      ambiguousCandidates,
      backlinks: { edges, pagesWithInbound: inbound.size, orphanPages: snapshot.pages.length - inbound.size },
    },
    topicCandidates: topicLabels.size + directories.size,
  };
}

interface Run {
  /** Responses the host replaced with `internal/internal` plus responses that fail contract validation. */
  contractFailures: number;
}

/** The value of an ok result (counting contract failures), or null for a failure (tallied by error code). */
function settle<T>(run: Run, result: WikiResult<T>, valid: (value: T) => boolean, tally?: ErrorTally): T | null {
  if (result.ok) {
    if (!valid(result.value)) run.contractFailures++;
    return result.value;
  }
  if (tally !== undefined) tally[result.error.code]++;
  if (result.error.code === 'internal') run.contractFailures++;
  return null;
}

async function timed<T>(work: () => Promise<T>): Promise<{ readonly value: T; readonly ms: number }> {
  const start = performance.now();
  const value = await work();
  return { value, ms: round2(performance.now() - start) };
}

function spread(values: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] ?? 0 };
}

/** A report with every figure zero and the state as observed: the whole report for a source that could not be pinned or built. */
export function zeroReport(namespace: WikiNamespace, state: NamespaceReport['state'], refreshMs: number, gitProcesses: number, contractFailures: number): NamespaceReport {
  return {
    namespace,
    ref: 'configured',
    state,
    pages: 0,
    raw: { total: 0, ratePct: 0, byReason: zeros(RAW_REASONS) },
    nullOmissions: 0,
    skipped: { symlinks: 0, submodules: 0, other: 0, invalidPaths: 0 },
    oversize: 0,
    outLinkCaps: 0,
    excerptsAtCap: 0,
    links: { targets: zeros(LINK_KINDS), internalResolutionPct: null },
    missingShapes: zeros(MISSING_SHAPES),
    ambiguousCandidates: zeros(AMBIGUOUS_BUCKETS),
    topics: { count: 0, candidates: 0, capped: false, truncatedPageLists: 0 },
    backlinks: { edges: 0, pagesWithInbound: 0, orphanPages: 0 },
    sample: {
      pages: 0,
      getPage: { ok: 0, parsed: 0, rawByReason: zeros(RAW_REASONS), failures: zeros(ERROR_CODES) },
      getBacklinks: { ok: 0, withBacklinks: 0, total: 0, truncated: 0, failures: zeros(ERROR_CODES) },
      resolveAlias: { ok: 0, resolved: 0, resolvedToSelf: 0, ambiguous: 0, missing: 0, failures: zeros(ERROR_CODES) },
      mismatches: { raw: 0, title: 0, byteLength: 0, outLinks: 0 },
    },
    search: { queries: [] },
    timing: {
      refreshMs,
      listSourcesMs: 0,
      indexStatusMs: 0,
      listTopicsMs: 0,
      getPageMs: spread([]),
      getBacklinksMs: spread([]),
      resolveAliasMs: spread([]),
    },
    gitProcesses: { refresh: gitProcesses, sampling: 0 },
    snapshotBytes: 0,
    contractFailures,
  };
}

/**
 * Build one namespace from its configured bare repository and exercise every WikiService method.
 * Nothing is written anywhere: the index store is in memory and the Git adapter is read-only.
 */
export async function collectNamespace(profile: SourceProfile, queries: readonly string[]): Promise<NamespaceReport> {
  const { namespace } = profile;
  const run: Run = { contractFailures: 0 };
  let gitProcesses = 0;
  const source = createNodeGitObjectSource(profile, {
    exec: (file, args, options, callback) => {
      gitProcesses++;
      return execFile(file, args, options, callback);
    },
  });
  const store = createMemoryIndexStore();
  const host = createWikiHost({ profiles: [profile], sources: { [namespace]: source }, store, clock: { now: () => Date.now() } });
  const { service } = host;

  const refreshed = await timed(() => host.refresh());
  const refreshProcesses = gitProcesses;
  const refreshMs = refreshed.ms;
  const status = await timed(() => service.indexStatus());
  const own = settle(run, status.value, (value) => validateIndexStatus(value).ok)?.namespaces.find((entry) => entry.namespace === namespace);
  if (own === undefined || own.state === 'unavailable') {
    return zeroReport(namespace, own?.state ?? 'unavailable', refreshMs, refreshProcesses, run.contractFailures);
  }

  // The snapshot the host just stored (one entry per namespace): its bytes, and the counts only it holds.
  const stored = [...store.entries].find(([key]) => key.startsWith(`${namespace}/`));
  const snapshot =
    stored === undefined
      ? null
      : parseSnapshot(JSON.parse(stored[1]) as unknown, { namespace, commit: stored[0].slice(namespace.length + 1), profileKey: profileIndexKey(profile) });
  if (stored === undefined || snapshot === null) run.contractFailures++;
  const snapshotBytes = stored === undefined ? 0 : Buffer.byteLength(stored[1]);
  const summary = snapshot === null ? null : summarizeSnapshot(snapshot, profile);
  const pages = snapshot?.pages ?? [];
  const base = zeroReport(namespace, own.state, refreshMs, refreshProcesses, 0);

  const sources = await timed(() => service.listSources());
  settle(run, sources.value, (value) => value.every((entry) => validateSourceDescriptor(entry).ok));

  const topicList = await timed(() => service.listTopics({ namespace }));
  const topics = settle(run, topicList.value, (value) => validateTopicList(value).ok);

  const getPageFailures = zeros(ERROR_CODES);
  const backlinkFailures = zeros(ERROR_CODES);
  const aliasFailures = zeros(ERROR_CODES);
  const sample = everyNth(pages, MAX_SAMPLE);
  const getPageMs: number[] = [];
  const getBacklinksMs: number[] = [];
  const resolveAliasMs: number[] = [];
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const page = { ok: 0, parsed: 0, rawByReason: zeros(RAW_REASONS), failures: getPageFailures };
  const backlinks = { ok: 0, withBacklinks: 0, total: 0, truncated: 0, failures: backlinkFailures };
  const alias = { ok: 0, resolved: 0, resolvedToSelf: 0, ambiguous: 0, missing: 0, failures: aliasFailures };
  const mismatches = { raw: 0, title: 0, byteLength: 0, outLinks: 0 };

  for (const entry of sample) {
    const key = { namespace, path: entry.path };
    const live = await timed(() => service.getPage({ key }));
    getPageMs.push(live.ms);
    const value = settle(run, live.value, (result) => validatePage(result).ok, getPageFailures);
    if (value !== null) {
      page.ok++;
      const reason: RawReason | null = value.content.state === 'raw' ? value.content.reason : null;
      if (reason === null) page.parsed++;
      else page.rawByReason[reason]++;
      const indexed = byPath.get(entry.path);
      if (indexed !== undefined) {
        if (indexed.raw !== reason) mismatches.raw++;
        if (indexed.title !== value.title) mismatches.title++;
        if (indexed.byteLength !== value.byteLength) mismatches.byteLength++;
        if (Math.min(indexed.links.length, MAX_OUT_LINKS) !== value.outLinks.length) mismatches.outLinks++;
      }
    }

    const inbound = await timed(() => service.getBacklinks({ key }));
    getBacklinksMs.push(inbound.ms);
    const found = settle(run, inbound.value, (result) => validateBacklinkResult(result).ok, backlinkFailures);
    if (found !== null) {
      backlinks.ok++;
      backlinks.total += found.total;
      if (found.total > 0) backlinks.withBacklinks++;
      if (found.truncated) backlinks.truncated++;
    }

    // The page's own title is the sampled name; it is only ever sent to the service, never reported.
    const named = await timed(() => service.resolveAlias({ namespace, alias: entry.title }));
    resolveAliasMs.push(named.ms);
    const resolution = settle(run, named.value, (result) => validateAliasResolution(result).ok, aliasFailures);
    if (resolution !== null) {
      alias.ok++;
      if (resolution.status === 'resolved') {
        alias.resolved++;
        if (resolution.target.path === entry.path) alias.resolvedToSelf++;
      } else if (resolution.status === 'ambiguous') alias.ambiguous++;
      else alias.missing++;
    }
  }

  const searches: NamespaceReport['search']['queries'] = [];
  for (const query of queries) {
    const found = await timed(() => service.search({ query, namespaces: [namespace] }));
    const result = settle(run, found.value, (value) => validateSearchResult(value).ok);
    searches.push({ ok: result !== null, ms: found.ms, hits: result?.totalHits ?? 0, truncated: result?.truncated ?? false });
  }

  const candidates = summary?.topicCandidates ?? 0;
  const count = topics?.topics.length ?? 0;
  return {
    ...base,
    ...summary?.figures,
    pages: snapshot === null ? own.pageCount : pages.length,
    topics: {
      count,
      candidates,
      capped: candidates > count,
      truncatedPageLists: topics?.topics.filter((topic) => topic.pageCount > topic.pages.length).length ?? 0,
    },
    sample: { pages: sample.length, getPage: page, getBacklinks: backlinks, resolveAlias: alias, mismatches },
    search: { queries: searches },
    timing: {
      refreshMs,
      listSourcesMs: sources.ms,
      indexStatusMs: status.ms,
      listTopicsMs: topicList.ms,
      getPageMs: spread(getPageMs),
      getBacklinksMs: spread(getBacklinksMs),
      resolveAliasMs: spread(resolveAliasMs),
    },
    gitProcesses: { refresh: refreshProcesses, sampling: gitProcesses - refreshProcesses },
    snapshotBytes,
    contractFailures: run.contractFailures,
  };
}

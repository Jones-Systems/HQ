// Snapshot builder: list the pinned tree, read each page blob (bounded), analyse it, resolve links
// namespace-wide and produce the serialisable snapshot. Read-only: nothing here writes to a source.

import { MAX_OUT_LINKS, MAX_PAGE_BLOB_BYTES, validatePagePath } from '../../contract/src/index.ts';
import { analyzePage, resolveTargets, type PageAnalysis } from './analyze.ts';
import type { GitObjectSource, Pin } from './ports.ts';
import { profileIndexKey, type SourceProfile } from './profile.ts';
import { buildAliasMap, type PageDirectory } from './resolver.ts';
import { INDEX_SCHEMA_ID, MAX_EXCERPT_UNITS, type IndexSnapshot, type SnapshotPage, type SnapshotStats } from './snapshot.ts';
import { cleanLabel, compareUnits, tokenize } from './text.ts';

export type BuildOutcome =
  | { readonly ok: true; readonly snapshot: IndexSnapshot }
  | { readonly ok: false; readonly reason: 'unavailable' };

export interface BuildArguments {
  readonly profile: SourceProfile;
  readonly source: GitObjectSource;
  readonly pin: Pin;
  /** ISO-8601 UTC time recorded as `indexedAt`. */
  readonly indexedAt: string;
  /** Maximum concurrent blob reads (default 4). */
  readonly concurrency?: number;
}

interface Candidate {
  readonly path: string;
  readonly oid: string;
  readonly size: number | null;
}

interface Analysed {
  readonly candidate: Candidate;
  readonly analysis: PageAnalysis;
}

const REGULAR_FILE_MODES = new Set(['100644', '100755']);

function hasPageExtension(name: string, extensions: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.length > ext.length && lower.endsWith(ext));
}

async function mapPool<T, R>(items: readonly T[], width: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(width, items.length)) }, worker));
  return results;
}

function countTerms(analysis: PageAnalysis): { terms: [string, number, number][]; titleLength: number; bodyLength: number } {
  const table = new Map<string, [number, number]>();
  const titleTokens = tokenize(analysis.titleText);
  const bodyTokens = tokenize(analysis.bodyText);
  for (const token of titleTokens) {
    const entry = table.get(token);
    if (entry === undefined) table.set(token, [1, 0]);
    else entry[0]++;
  }
  for (const token of bodyTokens) {
    const entry = table.get(token);
    if (entry === undefined) table.set(token, [0, 1]);
    else entry[1]++;
  }
  const terms = [...table.entries()].sort((a, b) => compareUnits(a[0], b[0])).map(([term, tf]): [string, number, number] => [term, tf[0], tf[1]]);
  return { terms, titleLength: titleTokens.length, bodyLength: bodyTokens.length };
}

/** Build the snapshot of one namespace at the pinned commit. Any source failure aborts the build. */
export async function buildSnapshot(args: BuildArguments): Promise<BuildOutcome> {
  const { profile, source, pin } = args;
  const listing = await source.listTree(pin.commit);
  if (!listing.ok) return { ok: false, reason: 'unavailable' };

  let symlinks = listing.value.skipped.symlinks;
  let submodules = listing.value.skipped.submodules;
  let other = listing.value.skipped.other;
  const invalidPaths = listing.value.skipped.invalidPaths;
  let invalidKeys = 0;
  let oversize = 0;
  let underRoot = 0;
  const prefix = profile.rootPrefix === '' ? '' : `${profile.rootPrefix}/`;
  const candidates: Candidate[] = [];

  for (const entry of listing.value.entries) {
    if (!REGULAR_FILE_MODES.has(entry.mode)) {
      if (entry.mode === '120000') symlinks++;
      else if (entry.mode === '160000') submodules++;
      else other++;
      continue;
    }
    if (prefix !== '' && !entry.path.startsWith(prefix)) continue;
    underRoot++;
    const relative = entry.path.slice(prefix.length);
    if (!hasPageExtension(relative, profile.pageExtensions)) continue;
    if (!validatePagePath(relative).ok) {
      invalidKeys++;
      continue;
    }
    if (entry.size !== null && entry.size > MAX_PAGE_BLOB_BYTES) {
      oversize++;
      continue;
    }
    candidates.push({ path: relative, oid: entry.oid, size: entry.size });
  }
  // A configured root with nothing beneath it is a binding mismatch, not an empty wiki.
  if (prefix !== '' && underRoot === 0) return { ok: false, reason: 'unavailable' };
  candidates.sort((a, b) => compareUnits(a.path, b.path));

  let failed = false;
  const analysed = await mapPool(candidates, args.concurrency ?? 4, async (candidate): Promise<Analysed | null> => {
    if (failed) return null;
    const blob = await source.readBlob(candidate.oid, MAX_PAGE_BLOB_BYTES);
    if (!blob.ok) {
      if (blob.reason === 'too-large') {
        oversize++;
        return null;
      }
      failed = true;
      return null;
    }
    // Drop the heavy draft tree: the index only needs names, links and text.
    return { candidate, analysis: { ...analyzePage(candidate.path, blob.value, profile), draft: null, rawText: null } };
  });
  if (failed) return { ok: false, reason: 'unavailable' };

  const pages = analysed.filter((a): a is Analysed => a !== null);
  const directory: PageDirectory = {
    namespace: profile.namespace,
    paths: new Set(pages.map((p) => p.candidate.path)),
    extensions: profile.pageExtensions,
    aliases: buildAliasMap(pages.map((p) => ({ path: p.candidate.path, names: p.analysis.names }))),
  };

  let rawFrontmatter = 0;
  let rawMarkdown = 0;
  let rawNotText = 0;
  let nullOmissions = 0;
  let outLinkCaps = 0;
  const snapshotPages: SnapshotPage[] = pages.map(({ candidate, analysis }) => {
    const links = resolveTargets(analysis, directory, candidate.path);
    if (links.length > MAX_OUT_LINKS) outLinkCaps++;
    nullOmissions += analysis.nullOmissions;
    if (analysis.rawReason === 'frontmatter-unsupported') rawFrontmatter++;
    else if (analysis.rawReason === 'markdown-unsupported') rawMarkdown++;
    else if (analysis.rawReason === 'not-text') rawNotText++;
    const counted = countTerms(analysis);
    return {
      path: candidate.path,
      oid: candidate.oid,
      byteLength: analysis.byteLength,
      title: analysis.title,
      names: analysis.names,
      topics: analysis.topics,
      links,
      excerpt: cleanLabel(analysis.bodyText, MAX_EXCERPT_UNITS),
      raw: analysis.rawReason,
      terms: counted.terms,
      titleLength: counted.titleLength,
      bodyLength: counted.bodyLength,
    };
  });

  const stats: SnapshotStats = {
    pages: snapshotPages.length,
    rawFrontmatter,
    rawMarkdown,
    rawNotText,
    nullOmissions,
    skippedSymlinks: symlinks,
    skippedSubmodules: submodules,
    skippedOther: other,
    skippedInvalidPaths: invalidPaths + invalidKeys,
    skippedOversize: oversize,
    outLinkCaps,
  };
  return {
    ok: true,
    snapshot: {
      schema: INDEX_SCHEMA_ID,
      namespace: profile.namespace,
      commit: pin.commit,
      ref: pin.ref,
      commitTime: pin.commitTime,
      indexedAt: args.indexedAt,
      profileKey: profileIndexKey(profile),
      stats,
      pages: snapshotPages,
    },
  };
}

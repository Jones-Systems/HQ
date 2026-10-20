// In-memory query structures of one namespace's snapshot: path table, alias map, BM25 postings,
// backlinks and topics. All ordering is deterministic (UTF-16 code-unit order, no locale).

import {
  MAX_RESULTS,
  MAX_SNIPPET_LENGTH,
  MAX_TOPICS,
  pageKeyId,
  type PageKey,
  type SearchHit,
  type Topic,
  type TopicList,
  type WikiNamespace,
} from '../../contract/src/index.ts';
import type { TopicMode } from './profile.ts';
import { buildAliasMap, type PageDirectory } from './resolver.ts';
import type { IndexSnapshot, SnapshotPage } from './snapshot.ts';
import { cleanLabel, compareUnits, fnv64Hex, normalizeAlias, slugify, truncateUnits } from './text.ts';

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const TITLE_WEIGHT = 2;

export interface IndexedPage extends SnapshotPage {
  readonly ordinal: number;
  readonly id: string;
}

interface Posting {
  readonly doc: number;
  /** Weighted term frequency: body + TITLE_WEIGHT * title. */
  readonly tf: number;
}

export interface NamespaceIndex {
  readonly namespace: WikiNamespace;
  readonly snapshot: IndexSnapshot;
  readonly pages: readonly IndexedPage[];
  readonly byPath: ReadonlyMap<string, IndexedPage>;
  readonly directory: PageDirectory;
  readonly postings: ReadonlyMap<string, readonly Posting[]>;
  /** Weighted token length per document. */
  readonly docLengths: readonly number[];
  readonly totalLength: number;
  /** Target path -> source pages (sorted by title, then key). */
  readonly backlinks: ReadonlyMap<string, readonly IndexedPage[]>;
  readonly topics: TopicList;
}

function compareTitleThenKey(a: IndexedPage, b: IndexedPage): number {
  return compareUnits(a.title, b.title) || compareUnits(a.id, b.id);
}

export function pageKey(namespace: WikiNamespace, path: string): PageKey {
  return { namespace, path };
}

// ---- topics ----

interface TopicDraft {
  readonly key: string;
  readonly label: string;
  readonly parentKey: string | null;
  readonly depth: number;
  readonly members: IndexedPage[];
}

function topicIds(drafts: readonly TopicDraft[], prefix: string): Map<string, string> {
  const slugs = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const draft of drafts) {
    const slug = slugify(draft.key.replace(/\//g, ' '), 100);
    slugs.set(draft.key, slug);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const ids = new Map<string, string>();
  for (const draft of drafts) {
    const slug = slugs.get(draft.key) as string;
    const unique = slug !== '' && counts.get(slug) === 1;
    ids.set(draft.key, unique ? `${prefix}${slug}` : `${prefix}${slug}~${fnv64Hex(draft.key).slice(0, 8)}`);
  }
  return ids;
}

function fieldTopicDrafts(pages: readonly IndexedPage[]): TopicDraft[] {
  const groups = new Map<string, { label: string; members: IndexedPage[] }>();
  for (const page of pages) {
    for (const label of page.topics) {
      const key = normalizeAlias(label);
      if (key === '') continue;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, { label, members: [page] });
      else {
        if (compareUnits(label, group.label) < 0) group.label = label;
        if (!group.members.includes(page)) group.members.push(page);
      }
    }
  }
  return [...groups.entries()].map(([key, g]) => ({ key, label: g.label, parentKey: null, depth: 0, members: g.members }));
}

function directoryTopicDrafts(pages: readonly IndexedPage[]): TopicDraft[] {
  const drafts = new Map<string, TopicDraft>();
  for (const page of pages) {
    const segments = page.path.split('/').slice(0, -1);
    for (let depth = 0; depth < segments.length; depth++) {
      const key = segments.slice(0, depth + 1).join('/');
      let draft = drafts.get(key);
      if (draft === undefined) {
        draft = { key, label: cleanLabel(segments[depth] as string) || key, parentKey: depth === 0 ? null : segments.slice(0, depth).join('/'), depth, members: [] };
        drafts.set(key, draft);
      }
      if (depth === segments.length - 1) draft.members.push(page);
    }
  }
  return [...drafts.values()];
}

function buildTopics(namespace: WikiNamespace, pages: readonly IndexedPage[], mode: TopicMode): TopicList {
  if (mode === 'none') return { namespace, topics: [] };
  const all = mode === 'field' ? fieldTopicDrafts(pages) : directoryTopicDrafts(pages);
  // Keep at most MAX_TOPICS; shallower and larger topics win, so a kept child always has its parent.
  const kept = [...all]
    .sort((a, b) => a.depth - b.depth || b.members.length - a.members.length || compareUnits(a.label, b.label) || compareUnits(a.key, b.key))
    .slice(0, MAX_TOPICS);
  const ids = topicIds(kept, mode === 'field' ? 'f-' : 'd-');
  const topics: Topic[] = kept.map((draft) => ({
    id: ids.get(draft.key) as string,
    label: draft.label,
    parentId: draft.parentKey === null ? null : (ids.get(draft.parentKey) ?? null),
    pageCount: draft.members.length,
    pages: [...draft.members].sort(compareTitleThenKey).slice(0, MAX_RESULTS).map((p) => pageKey(namespace, p.path)),
  }));
  topics.sort((a, b) => compareUnits(a.label, b.label) || compareUnits(a.id, b.id));
  return { namespace, topics };
}

// ---- construction ----

export function createNamespaceIndex(snapshot: IndexSnapshot, topicMode: TopicMode, extensions: readonly string[]): NamespaceIndex {
  const namespace = snapshot.namespace;
  const pages: IndexedPage[] = snapshot.pages.map((page, ordinal) => ({ ...page, ordinal, id: pageKeyId(pageKey(namespace, page.path)) }));
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const directory: PageDirectory = {
    namespace,
    paths: new Set(byPath.keys()),
    extensions,
    aliases: buildAliasMap(pages.map((page) => ({ path: page.path, names: page.names }))),
  };

  const postings = new Map<string, Posting[]>();
  const docLengths: number[] = [];
  let totalLength = 0;
  for (const page of pages) {
    const length = page.bodyLength + TITLE_WEIGHT * page.titleLength;
    docLengths.push(length);
    totalLength += length;
    for (const [term, titleTf, bodyTf] of page.terms) {
      const list = postings.get(term);
      const posting = { doc: page.ordinal, tf: bodyTf + TITLE_WEIGHT * titleTf };
      if (list === undefined) postings.set(term, [posting]);
      else list.push(posting);
    }
  }

  const backlinkSets = new Map<string, Set<IndexedPage>>();
  for (const page of pages) {
    for (const target of page.links) {
      if (target.kind !== 'page' || target.key.namespace !== namespace || target.key.path === page.path) continue;
      if (!byPath.has(target.key.path)) continue;
      const set = backlinkSets.get(target.key.path);
      if (set === undefined) backlinkSets.set(target.key.path, new Set([page]));
      else set.add(page);
    }
  }
  const backlinks = new Map<string, readonly IndexedPage[]>();
  for (const [path, set] of backlinkSets) backlinks.set(path, [...set].sort(compareTitleThenKey));

  return { namespace, snapshot, pages, byPath, directory, postings, docLengths, totalLength, backlinks, topics: buildTopics(namespace, pages, topicMode) };
}

// ---- search ----

export interface RankedHit {
  readonly index: NamespaceIndex;
  readonly page: IndexedPage;
  readonly score: number;
}

/**
 * BM25 (k1 = 1.2, b = 0.75, title weight 2) over the union of the given namespace indexes.
 * Statistics are taken over exactly the indexes searched, so a repository filter changes only the
 * candidate set, never the formula. Ties order by `pageKeyId` in code-unit order.
 */
export function rank(indexes: readonly NamespaceIndex[], terms: readonly string[]): RankedHit[] {
  let docs = 0;
  let length = 0;
  for (const index of indexes) {
    docs += index.pages.length;
    length += index.totalLength;
  }
  if (docs === 0 || terms.length === 0) return [];
  const average = length / docs || 1;
  const scores = new Map<IndexedPage, number>();
  for (const term of terms) {
    let df = 0;
    for (const index of indexes) df += index.postings.get(term)?.length ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (docs - df + 0.5) / (df + 0.5));
    for (const index of indexes) {
      for (const posting of index.postings.get(term) ?? []) {
        const dl = index.docLengths[posting.doc] as number;
        const part = (idf * (posting.tf * (BM25_K1 + 1))) / (posting.tf + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / average));
        const page = index.pages[posting.doc] as IndexedPage;
        scores.set(page, (scores.get(page) ?? 0) + part);
      }
    }
  }
  const owner = new Map<IndexedPage, NamespaceIndex>();
  for (const index of indexes) for (const page of index.pages) if (scores.has(page)) owner.set(page, index);
  return [...scores.entries()]
    .map(([page, score]) => ({ index: owner.get(page) as NamespaceIndex, page, score }))
    .sort((a, b) => b.score - a.score || compareUnits(a.page.id, b.page.id));
}

const TOKEN_G = /[\p{L}\p{N}]+/gu;

/** Excerpt window around the first query term, at most MAX_SNIPPET_LENGTH units. */
export function makeSnippet(excerpt: string, terms: ReadonlySet<string>): string {
  if (excerpt === '') return '';
  let at = 0;
  for (const match of excerpt.matchAll(TOKEN_G)) {
    if (terms.has(match[0].normalize('NFC').toLowerCase())) {
      at = match.index;
      break;
    }
  }
  let start = Math.max(0, at - 60);
  if (start > 0) {
    const space = excerpt.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  const low = excerpt.charCodeAt(start);
  if (low >= 0xdc00 && low <= 0xdfff) start++;
  return truncateUnits(excerpt.slice(start), MAX_SNIPPET_LENGTH).trim();
}

export function toSearchHit(hit: RankedHit, terms: ReadonlySet<string>): SearchHit {
  return {
    key: pageKey(hit.index.namespace, hit.page.path),
    title: hit.page.title,
    score: hit.score,
    snippet: makeSnippet(hit.page.excerpt, terms),
  };
}

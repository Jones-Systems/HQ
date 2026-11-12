// Builds the topic tree from `parentId`. The contract proves each parent exists and is not the topic itself,
// but does not reject longer cycles; those topics are surfaced as roots so nothing is dropped and nothing loops.

import { pageKeyId, type PageKey, type Topic } from '../../contract/src/index.ts';
import { pageName } from './format.ts';

export interface TopicNode {
  readonly topic: Topic;
  readonly children: readonly TopicNode[];
}

export function buildTopicTree(topics: readonly Topic[]): TopicNode[] {
  const ids = new Set(topics.map((topic) => topic.id));
  const childrenOf = new Map<string, Topic[]>();
  for (const topic of topics) {
    if (topic.parentId === null || !ids.has(topic.parentId)) continue;
    const siblings = childrenOf.get(topic.parentId);
    if (siblings === undefined) childrenOf.set(topic.parentId, [topic]);
    else siblings.push(topic);
  }
  const visited = new Set<string>();
  const build = (topic: Topic): TopicNode => {
    visited.add(topic.id);
    const children: TopicNode[] = [];
    for (const child of childrenOf.get(topic.id) ?? []) if (!visited.has(child.id)) children.push(build(child));
    return { topic, children };
  };
  const roots: TopicNode[] = [];
  for (const topic of topics) {
    if ((topic.parentId === null || !ids.has(topic.parentId)) && !visited.has(topic.id)) roots.push(build(topic));
  }
  for (const topic of topics) if (!visited.has(topic.id)) roots.push(build(topic));
  return roots;
}

// ---- filtering ----

/** A topic as shown: possibly with fewer pages and children than the topic has, when a filter is active. */
export interface ShownTopic {
  readonly topic: Topic;
  readonly children: readonly ShownTopic[];
  /** The filter matched this topic's label. */
  readonly labelMatch: boolean;
  /** Previewed pages to list: all of them, or with a filter only those whose name matched (all when the label matched). */
  readonly pages: readonly PageKey[];
  /** Ids (`pageKeyId`) of the listed pages whose name matched the filter. */
  readonly pageMatches: ReadonlySet<string>;
}

/** Lowercase, whitespace-split words of a filter; empty when it is blank. */
export function filterWords(query: string): readonly string[] {
  return query.toLowerCase().split(/\s+/u).filter((word) => word.length > 0);
}

const matchesAll = (text: string, words: readonly string[]): boolean => {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
};

const NO_MATCHES: ReadonlySet<string> = new Set();

/** Uses the provider's aligned title when present; older providers retain path-derived labels. */
export function topicPageLabel(topic: Topic, key: PageKey): string {
  const index = topic.pages.findIndex((page) => pageKeyId(page) === pageKeyId(key));
  return topic.pageTitles?.[index] ?? pageName(key.path);
}

/**
 * The tree to show for `query`. A blank filter shows everything. Otherwise a topic stays when its label matches, when
 * one of its previewed pages' names or folders match, or when a descendant stays, so a match never loses its ancestors.
 * Every word of the filter must appear (in the label, or in a page's name and folder).
 */
export function showTopics(roots: readonly TopicNode[], query: string): readonly ShownTopic[] {
  const words = filterWords(query);
  if (words.length === 0) {
    const all = (nodes: readonly TopicNode[]): ShownTopic[] =>
      nodes.map((node) => ({ topic: node.topic, children: all(node.children), labelMatch: false, pages: node.topic.pages, pageMatches: NO_MATCHES }));
    return all(roots);
  }
  const narrow = (nodes: readonly TopicNode[]): ShownTopic[] => {
    const kept: ShownTopic[] = [];
    for (const node of nodes) {
      const labelMatch = matchesAll(node.topic.label, words);
      const matched = new Set<string>();
      for (const key of node.topic.pages) if (matchesAll(`${topicPageLabel(node.topic, key)} ${key.path}`, words)) matched.add(pageKeyId(key));
      const children = narrow(node.children);
      if (!labelMatch && matched.size === 0 && children.length === 0) continue;
      kept.push({
        topic: node.topic,
        children,
        labelMatch,
        pages: labelMatch ? node.topic.pages : node.topic.pages.filter((key) => matched.has(pageKeyId(key))),
        pageMatches: matched,
      });
    }
    return kept;
  };
  return narrow(roots);
}

export function countShown(nodes: readonly ShownTopic[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countShown(node.children), 0);
}

export interface TextPiece {
  readonly text: string;
  readonly match: boolean;
}

/** `text` split so the filter words are marked (case-insensitive, overlapping words merged). Text is never altered. */
export function markPieces(text: string, words: readonly string[]): readonly TextPiece[] {
  if (words.length === 0 || text.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  // Case mapping that changes the length (a few scripts) would misplace the marks, so such text stays unmarked.
  if (lower.length !== text.length) return [{ text, match: false }];
  const spans: [number, number][] = [];
  for (const word of words) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(word, from);
      if (at < 0) break;
      spans.push([at, at + word.length]);
      from = at + word.length;
    }
  }
  if (spans.length === 0) return [{ text, match: false }];
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  const pieces: TextPiece[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) pieces.push({ text: text.slice(cursor, start), match: false });
    pieces.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), match: false });
  return pieces;
}

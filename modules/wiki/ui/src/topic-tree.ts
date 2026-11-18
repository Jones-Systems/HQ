// Builds the topic tree from `parentId`. The contract proves each parent exists and is not the topic itself,
// but does not reject longer cycles; those topics are surfaced as roots so nothing is dropped and nothing loops.

import type { Topic } from '../../contract/src/index.ts';

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

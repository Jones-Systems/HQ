// Public surface of the Wiki core (host side). The renderer never imports this module: it consumes
// the contract's WikiService through an injected port. Only `node-git-source.ts` touches node:*.

export type { Clock, GitObjectSource, IndexStore, Pin, SkippedEntries, SourceFailureReason, SourceResult, TreeEntry, TreeListing } from './ports.ts';

export type { FieldMappings, SourceProfile, TopicMode } from './profile.ts';
export { DEFAULT_FIELD_MAPPINGS, INDEX_RULES_VERSION, TOPIC_MODES, profileIndexKey, validateSourceProfile } from './profile.ts';

export type { IndexSnapshot, SnapshotExpectation, SnapshotPage, SnapshotStats } from './snapshot.ts';
export { INDEX_SCHEMA_ID, MAX_EXCERPT_UNITS, parseSnapshot } from './snapshot.ts';

export type { MemoryIndexStore } from './memory-store.ts';
export { createMemoryIndexStore, snapshotStoreKey } from './memory-store.ts';

export type { WikiHost, WikiHostOptions } from './host.ts';
export { createWikiHost } from './host.ts';

export type { GitExec, GitExecCallback, GitExecError, GitExecOptions, NodeGitOptions } from './node-git-source.ts';
export { createNodeGitObjectSource, parseLsTree } from './node-git-source.ts';

export type { FrontmatterResult } from './frontmatter.ts';
export { parseFrontmatter } from './frontmatter.ts';

export type { DraftBlock, DraftDocument, DraftInline, LinkRef, RawLink } from './draft.ts';
export { collectLinks, documentText, resolveDocument } from './draft.ts';
export type { MarkdownParse } from './markdown.ts';
export { parseMarkdown, scanLinks } from './markdown.ts';

export type { PageAnalysis } from './analyze.ts';
export { analyzePage, buildPage } from './analyze.ts';

export type { PageDirectory } from './resolver.ts';
export { resolveLink, resolveName } from './resolver.ts';

export { BM25_B, BM25_K1, TITLE_WEIGHT, createNamespaceIndex } from './namespace-index.ts';
export type { NamespaceIndex } from './namespace-index.ts';
export { buildSnapshot } from './build.ts';

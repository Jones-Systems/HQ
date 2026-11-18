// Public surface of the Wiki contract (hq.wiki.source/v1). Standalone: no runtime dependencies.

export type {
  InvalidInputReason,
  ServiceErrorReason,
  WikiError,
  WikiErrorCode,
  WikiErrorReason,
  WikiResult,
} from './result.ts';
export { INVALID_INPUT_REASONS, SERVICE_ERROR_REASONS, failWith, invalid, ok, serviceError } from './result.ts';

export {
  MAX_ALIAS_LENGTH,
  MAX_AST_DEPTH,
  MAX_AST_NODES,
  MAX_DESTINATION_LENGTH,
  MAX_FIELD_LIST_ITEMS,
  MAX_FIELD_NAME_LENGTH,
  MAX_FIELD_VALUE_LENGTH,
  MAX_FIELDS,
  MAX_LABEL_LENGTH,
  MAX_OUT_LINKS,
  MAX_PAGE_BLOB_BYTES,
  MAX_PATH_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  MAX_SEGMENT_LENGTH,
  MAX_SNIPPET_LENGTH,
  MAX_TABLE_COLUMNS,
  MAX_TOPIC_ID_LENGTH,
  MAX_TOPICS,
  MAX_URL_LENGTH,
  clampQuery,
  clampResultLimit,
  validatePageBlobSize,
  validatePageText,
  validateQuery,
  validateResultLimit,
} from './limits.ts';

export type { WikiNamespace } from './namespace.ts';
export { NAMESPACES, SOURCE_SCHEMA_ID, isNamespace, validateNamespace } from './namespace.ts';

export type { PageKey } from './page-key.ts';
export {
  PAGE_KEY_ADAPTER_RULES,
  makePageKey,
  pageKeyEquals,
  pageKeyId,
  validatePageKey,
  validatePagePath,
} from './page-key.ts';

export type {
  ContentFreshness,
  ContentFreshnessState,
  GraphFreshness,
  GraphFreshnessState,
  SourceDescriptor,
  SourceFreshness,
} from './source.ts';
export { CONTENT_FRESHNESS_STATES, GRAPH_FRESHNESS_STATES, validateSourceDescriptor } from './source.ts';

export type {
  BlockNode,
  EmphasisNode,
  FenceNode,
  HeadingNode,
  InlineCodeNode,
  InlineNode,
  LinkNode,
  LinkTarget,
  ListItemNode,
  ListNode,
  MarkdownDocument,
  ParagraphNode,
  QuoteNode,
  TableAlign,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextNode,
} from './ast.ts';
export {
  BLOCK_NODE_TYPES,
  INLINE_NODE_TYPES,
  SAFE_URL_SCHEMES,
  STRUCTURAL_NODE_TYPES,
  validateExternalUrl,
  validateLinkTarget,
  validateMarkdownDocument,
} from './ast.ts';

export type { FieldScalar, FieldValue, OutLink, Page, PageContent, PageField, RawReason } from './page.ts';
export { RAW_REASONS, validatePage } from './page.ts';

export type {
  AliasResolution,
  BacklinkEntry,
  BacklinkResult,
  IndexState,
  IndexStatus,
  NamespaceIndexStatus,
  SearchHit,
  SearchResult,
  Topic,
  TopicList,
} from './records.ts';
export {
  INDEX_STATES,
  validateAliasResolution,
  validateBacklinkResult,
  validateIndexStatus,
  validateSearchResult,
  validateTopicList,
} from './records.ts';

export type {
  GetBacklinksRequest,
  GetPageRequest,
  ListTopicsRequest,
  ResolveAliasRequest,
  ResolvedBacklinksRequest,
  ResolvedSearchRequest,
  SearchRequest,
  WikiService,
  WikiServiceMethodName,
} from './service.ts';
export {
  FORBIDDEN_REQUEST_KEYS,
  WIKI_SERVICE_METHODS,
  validateGetBacklinksRequest,
  validateGetPageRequest,
  validateListTopicsRequest,
  validateResolveAliasRequest,
  validateSearchRequest,
} from './service.ts';

export type { Destination } from './destination.ts';
export { formatDestination, parseDestination } from './destination.ts';

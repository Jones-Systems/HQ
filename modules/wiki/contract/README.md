# Wiki contract (`hq.wiki.source/v1`)

Standalone TypeScript types, validators and the closed `WikiService` interface for the HQ Wiki.
Task `task.wiki-contract.001` (interface `iface.wiki.001`). This directory is the entire write cone:
no adapters, no Git or filesystem access, no indexing, no Markdown or frontmatter parser, no UI,
no React/Electron, no root/navigation/preload seam, and no runtime dependencies.

Completion of this slice is not acceptance. The Wiki continuity owner decides contract acceptance.

## What it defines

| Area | Exports (from `src/index.ts`) |
| --- | --- |
| Schema and namespaces | `SOURCE_SCHEMA_ID` (`hq.wiki.source/v1`), `NAMESPACES` (`bl`, `appdev`), `WikiNamespace`, `isNamespace`, `validateNamespace` |
| Page keys | `PageKey`, `validatePageKey`, `validatePagePath`, `makePageKey`, `pageKeyId`, `pageKeyEquals`, `PAGE_KEY_ADAPTER_RULES` |
| Sources and freshness | `SourceDescriptor`, `SourceFreshness`, `GraphFreshness`, `ContentFreshness`, `validateSourceDescriptor` |
| Safe AST | `MarkdownDocument`, `BlockNode`, `InlineNode`, `LinkTarget` (+ node interfaces), `validateMarkdownDocument`, `validateLinkTarget`, `validateExternalUrl` |
| Pages | `Page`, `PageContent` (`parsed` \| `raw`), `PageField`, `OutLink`, `RawReason`, `validatePage` |
| Records | `AliasResolution`, `SearchHit`, `SearchResult`, `BacklinkResult`, `Topic`, `TopicList`, `IndexStatus` and their `validate*` functions |
| Service | `WikiService`, `WIKI_SERVICE_METHODS`, request types and `validateSearchRequest`, `validateGetPageRequest`, `validateResolveAliasRequest`, `validateGetBacklinksRequest`, `validateListTopicsRequest`, `FORBIDDEN_REQUEST_KEYS` |
| Limits | `MAX_QUERY_LENGTH`, `MAX_RESULTS`, `MAX_PAGE_BLOB_BYTES`, `MAX_BACKLINK_VIA`, `MAX_BACKLINK_EXCERPT_LENGTH`, `validateQuery`, `clampQuery`, `validateResultLimit`, `clampResultLimit`, `validatePageBlobSize`, `validatePageText` (+ structural bounds) |
| Destinations | `Destination`, `formatDestination`, `parseDestination` |
| Results | `WikiResult<T>`, `WikiError` (`code`, `reason`, `message`, `path`) |

## Decisions worth reviewing

- **Closed service.** `WikiService` has exactly `listSources`, `search`, `getPage`, `resolveAlias`,
  `getBacklinks`, `listTopics`, `indexStatus`. A compile-time `Equal<keyof WikiService, …>` guard in
  `src/service.ts` and a runtime key list (`WIKI_SERVICE_METHODS`) pin the set. Request types carry
  logical keys and queries only; the request validators reject unknown properties and give
  `root/ref/url/path/argv/cwd/…` (case-insensitive) their own `forbidden-capability` reason.
- **Limits.** Query ≤ 256 **code points** (not UTF-16 units); results/hits/backlinks/topic previews
  ≤ 50 (validators reject 51, clamps bound to 50); page blob ≤ **2 MiB = 2,097,152 bytes**.
  The plan says "2 MB". The binary reading is chosen because blob sizes are byte counts and it is the
  larger reading, so an adapter enforcing the decimal 2,000,000 is merely stricter and stays
  compatible. The owner can tighten the constant.
- **Page keys.** Relative, `/`-separated, normal segments only. Rejected: empty, over-long,
  NUL/control characters, lone surrogates, backslash, leading `/`, `.`/`..` segments, empty segments,
  a first segment that is a drive form (`C:`) or scheme-like (`javascript:`, `http:`, `file:`…).
  Comparison is byte-exact. Symlinks are an adapter concern; the rule is stated in
  `PAGE_KEY_ADAPTER_RULES` (symlink, submodule and non-blob tree entries are absent, never followed).
- **Freshness.** `graph` (is the index built from the pinned commit?) and `content` (is the pinned
  commit current against the remote?) are separate axes. Remote freshness may be `unknown`, which
  carries no check time. A `current` graph must be indexed from the descriptor's own commit.
- **Safe AST.** Node set: document; heading, paragraph, list/listItem, fence, quote,
  table/tableRow/tableCell; text, emphasis (`strong` flag), inlineCode, link. There is no image or HTML
  node. HTML and unsafe-scheme links exist only as `text` values, which renderers show inertly. The
  validator is closed (unknown node types and properties are rejected, images/HTML get distinct
  reasons), enforces node placement, rectangular tables, non-nesting links and bounded depth (64) and
  size (200,000 nodes). Link targets are `page` (a `PageKey`), `ambiguous`, `missing` (dangling) or
  `external` (absolute `http`, `https`, `mailto` only). The Markdown parser belongs to core.
- **Destinations.** `page/<namespace>/<encoded path>` (each segment `encodeURIComponent`-encoded,
  joined by `/`), `search?q=<encoded query>`, `topics/<namespace>`. Parsing is strict and canonical: a
  string parses only if re-formatting the result reproduces it, so each destination has one spelling
  and encoded traversal fails. Scheme-like, absolute, backslash, control and malformed forms fail.
- **Namespace separation.** Aliases, keys, hits, backlinks and topics are namespace-scoped; same-title
  records in `bl` and `appdev` have different `pageKeyId`s and never merge. Topic and alias lists
  reject cross-namespace members.

## Additive revision: backlink provenance and titled topic previews

A backward-compatible revision of this contract. The schema id stays `hq.wiki.source/v1`, the seven
`WikiService` methods and every request type are unchanged, and every old payload still validates.

**What.** Three optional members:

| Member | On | Meaning |
| --- | --- | --- |
| `via?: readonly string[]` | `BacklinkEntry` | How the source page links to the target: its distinct origins, each the literal `body` (a Markdown or wiki link in the page body) or a frontmatter relationship field name exactly as the source profile configures it. |
| `excerpt?: string` | `BacklinkEntry` | Inert plain text of the block that holds the source's first body link to the target. |
| `pageTitles?: readonly string[]` | `Topic` | The display titles of `pages`, in the same order. |

**Why.** The Wiki UI flow assessment (WF-4 and WF-7) found that a backlink gave only a title and a path, with
no hint of how the page is mentioned, and that a topic preview carried page keys only, so the UI showed file
paths. Real corpora link mostly through typed frontmatter relationship fields, so "linked via a field" is the
most useful context. The topic-preview gap is the deferred P4 "topic previews carry keys only" in the Wiki
evidence record.

**Compatibility.**

- Consumers must treat all three members as optional. A host without this revision omits them, and a current
  host omits `via` when the origin is unknown (for example data from an older stored snapshot) and `excerpt`
  when the only links are frontmatter fields or no excerpt can be derived. Do not infer anything from absence.
- The validators stay closed: `checkBacklinkResult` and `checkTopicList` accept exactly these members and still
  reject every other property. Every earlier invariant is unchanged (duplicate sources and topics, the
  `total`/`truncated` and `pageCount` consistency rules, the 50-result and 500-topic caps).
- A present member is never `undefined` or `null`, and never empty where emptiness would mean "unknown": `via`
  is omitted rather than sent as `[]`, and `excerpt` is omitted rather than sent as `""`.
- No existing export changes meaning. The page field-name rule is now also used for `via` (`checkFieldName`, an
  internal helper); the two new limits are exported.

**Limits and rules.**

- `via`: 1..`MAX_BACKLINK_VIA` (8) entries. Each follows the page field-name rule (at most 64 characters, a plain
  identifier, not `__proto__`, `constructor` or `prototype`; `body` satisfies it). Entries are strictly
  ascending in UTF-16 code-unit order, so uppercase sorts before lowercase. Failures: not an array
  `wrong-type`, empty `empty`, over 8 `too-large`, a bad name `invalid-format`, a repeat `duplicate`, disorder
  `inconsistent`.
- `excerpt`: at most `MAX_BACKLINK_EXCERPT_LENGTH` (160) **UTF-16 code units**, checked like a label: non-empty,
  single line, no NUL or other control character, no lone surrogate. It is shown verbatim and is never
  interpreted as Markdown, so `<b>` or `[x](y)` inside it is plain text.
- `pageTitles`: the same length as `pages` (`inconsistent` otherwise; at most 50 because `pages` is), each a valid
  label of at most 256 characters. Titles may repeat. A topic whose `pages` is empty has an empty `pageTitles`.
- A relationship field that is itself named `body` cannot be told apart from a body link in `via`. The contract
  does not forbid that profile name.

## Checks

Fixture/synthetic data only. Run from the repository root, serially, after a fresh CPU admission
reading (`collect_work_capacity.py --format admission`).

```
node --test modules/wiki/contract/test/*.test.ts
npx tsc -p modules/wiki/contract/tsconfig.json --noEmit
```

Results on the candidate: 73 tests, 73 pass, 0 fail, 0 skipped; `tsc` exit 0. Mutation sanity check:
temporarily adding an eighth method to `WikiService` makes `tsc` fail in `service.ts` and the test
file (restored afterwards). Telemetry before the check batches: CPU 18.75% used / 34.44 GiB RAM available, then (final candidate)
CPU 18.09% used / 33.92 GiB RAM available; admission allowed (threshold 85%). An earlier exploratory
typecheck ran on a reading taken minutes before (CPU 34.15%, 37.71 GiB).

Results after the additive revision above: 75 tests, 75 pass, 0 fail, 0 skipped; `tsc` exit 0.

These checks prove the contract types, validators and interface only. They do not show core, UI,
IPC/preload, an adapter, or installed-app behaviour. The plan's `wiki-contract` check group is a
planning projection, not an adopted catalog entry, and "no CI configured" is not green CI.

## Not covered / for the seam owner

- This module has no `package.json`; root workspaces, root `tsconfig.json` and `vitest.config.ts`
  (which list `modules/social` and `modules/work` only) do not include it, so `npm run typecheck`
  and `npm test` at the root do not run these files. Wiring is a root/shared-owner decision.
- Types are JSON-serialisable (no classes, `Map`s or `undefined` values) so the root can later
  promote them into `@hq/contracts` and carry them over closed IPC; that promotion is not done here.
- Validators check structure and local consistency. Authority checks (source pin, remote/root/ref
  binding, symlink and size enforcement against real blobs) belong to the adapter.

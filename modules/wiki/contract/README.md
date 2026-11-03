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
| Limits | `MAX_QUERY_LENGTH`, `MAX_RESULTS`, `MAX_PAGE_BLOB_BYTES`, `validateQuery`, `clampQuery`, `validateResultLimit`, `clampResultLimit`, `validatePageBlobSize`, `validatePageText` (+ structural bounds) |
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

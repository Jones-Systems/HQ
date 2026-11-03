# Wiki private-source validation tool (`WK-PV`)

Owner-run tool for `spec.hq-expansion#task.wiki-private-validation.001`. It builds each configured Wiki
namespace from a **local bare repository** with the real core (`createNodeGitObjectSource` +
`createWikiHost` + an in-memory index store), exercises all seven `WikiService` methods and prints
**aggregates only**: counts, mismatch categories, rates, timings and sizes. It is built and tested with
synthetic data only; the owner runs it against private sources. Nothing it prints may leave the owner's
machine unless it is a number or one of the fixed words listed below.

## Run it

```sh
node modules/wiki/core/scripts/validate-sources.ts --config <file> [--namespace bl|appdev] [--queries <file>] [--json]
```

Use the CI-pinned Node (24.19.0; any Node >= 22.18 strips the types). Keep both files outside this repository.

| Option | Meaning |
| --- | --- |
| `--config <file>` | **Required.** `{ "version": 1, "sources": [<SourceProfile>, ...] }`: the shape of the app's `userData/wiki/config.json`. Each profile is checked with `validateSourceProfile`; unknown keys, a duplicate namespace and an empty list are rejected. |
| `--namespace bl\|appdev` | Validate only that namespace (it must be in the config). |
| `--queries <file>` | Optional. `{ "version": 1, "queries": ["...", ...] }`, at most 100 queries of the contract's query rules. Choose queries that carry nothing private. Omitted: search timing is skipped. |
| `--json` | Print the full JSON report. Without it, a short table (one row per measurement, one column per namespace; rows that are zero everywhere are omitted). |

Both files are read like the app's imported profile: not a symlink, a regular file (checked before it is
opened, so a FIFO cannot block), opened with `O_NOFOLLOW`, at most **256 KiB**.

| Exit | Meaning |
| --- | --- |
| 0 | Every namespace was built and measured. |
| 1 | An unexpected failure inside the tool. One fixed line, no stack. |
| 2 | Invalid arguments or input file. One fixed line on stderr, nothing on stdout. |
| 3 | At least one source is unavailable (missing directory, wrong remote or ref, empty root, Git failure). The aggregates of the other namespaces are still printed. |

## What is measured, per namespace

`state`; `pages`; `raw` (total, rate %, by reason `frontmatter-unsupported` / `markdown-unsupported` /
`not-text`); `nullOmissions`; `skipped` (symlinks, submodules, other, invalid paths); `oversize` (blobs
over the contract's 2 MiB cap); `outLinkCaps` (pages with more unique targets than `Page.outLinks`
holds); `excerptsAtCap` (pages whose search excerpt is full).

- **Links** (unique targets per page, summed over the index): `targets` by kind `page` / `missing` /
  `ambiguous` / `external`, and `internalResolutionPct` = `page / (page + missing + ambiguous)`; ambiguous
  counts as unresolved. `null` when there is no internal link.
- **`missingShapes`**: unresolved targets by the *shape of their label*: `md-path-not-found` (ends with a
  configured page extension), `non-page-extension`, `path-like`, `slug-like`, `title-like`, `other`. A
  heuristic over the label text; the label itself is discarded.
- **`ambiguousCandidates`**: histogram of candidate counts (`2`, `3`, `4`, `5-9`, `10-24`, `25-49`, `cap` = the contract's 50).
- **`topics`**: `count` served, `candidates` before the contract's cap of 500, `capped`, and
  `truncatedPageLists` (topics with more pages than the 50 a topic lists).
- **`backlinks`**: `edges` and `pagesWithInbound` over the whole index, `orphanPages`.
- **`sample`**: every Nth page (N = ceil(pages / 200), so at most 200, starting at the first page in path
  order) is read with `getPage`, `getBacklinks` and `resolveAlias` (by its title). Reported: ok / parsed /
  raw-by-reason / failures-by-error-code, backlink totals, alias outcomes (`resolvedToSelf`), and
  `mismatches` between the live parse and the index (`raw`, `title`, `byteLength`, `outLinks`).
- **`search.queries`**: one entry per query index: `ok`, `ms`, `hits` (total), `truncated`.
- **`timing`**: `refreshMs`, `listSourcesMs`, `indexStatusMs`, `listTopicsMs` and `p50` / `p95` / `max` of
  `getPage`, `getBacklinks` and `resolveAlias` (milliseconds, nearest rank).
- **`gitProcesses`**: Git processes the adapter started, during `refresh` and while `sampling`.
- **`snapshotBytes`**: size of the serialised `hq.wiki.index/v1` snapshot the in-memory store holds.
- **`contractFailures`**: service responses the host replaced with `internal/internal` plus responses that
  fail contract validation when re-checked here.

At report level: `reportVersion` (this tool's layout), `indexRulesVersion` (the core's parsing rules),
`sourcesUnavailable` and `peakRssBytes` (peak resident set size of the tool process; Git child processes
are not included).

## Privacy invariant

The report never contains a path, title, alias, field name or value, topic label, commit message,
repository URL, `gitDir`, query text, ref name or commit id. The ref is reported only as the word
`configured`; commit ids are never reported.

It is enforced structurally, not by scrubbing:

- `report.ts` declares a **closed schema**: the only keys, finite non-negative numbers, booleans, `null` and a
  few fixed enumerations (`bl`, `appdev`, `configured`, the four index states). `renderJson` and
  `renderTable` check the finished report against it and refuse to print anything else. The collector reads
  page data only to count it or to pass it to a classifier that returns an enumeration member.
- Every message is a fixed string. An input failure prints a fixed code, at most a source/query position
  and a contract reason code (`unknown-property`, ...); never the file path, a key, a value or an error's
  message. The entry file installs handlers so an unexpected failure prints one fixed line, never a stack.
- The tests (`test/`) check this against synthetic sources: every path, title, alias, field, topic label, ref,
  commit and object id, remote, `gitDir`, query and config path is collected through the real host and searched
  for in stdout and stderr of both modes and of the error paths; the JSON keys are pinned; the table rows are
  checked against the JSON.

## Read-only

Nothing is written: the index store is the core's in-memory store, there is no cache, `userData` or temp
file, and the Git adapter only runs `rev-parse`, `config --get`, `show -s`, `ls-tree` and `cat-file`. The
tests run the tool under `node --permission` with no write grant and compare `git rev-parse`, `ls-tree`
and a byte fingerprint of the sources and of the whole scratch tree before and after.

## Tests

```sh
node --test modules/wiki/core/scripts/test/*.test.ts   # these tests
npm test --workspace @hq/wiki                          # all Wiki suites, including these
```

Synthetic bare repositories are built in task-owned scratch under the home directory (never `/tmp`), with
the same helpers as the core tests, and are removed on success, failure and cancellation.

| File | Covers |
| --- | --- |
| `classify.test.ts`, `report.test.ts` | shape classifiers, percentiles, sampling; the closed schema refuses anything else |
| `input.test.ts` | file reading rules (symlink, FIFO, directory, 256 KiB cap), config and query shape, every argument and exit-2 path |
| `validate-sources.test.ts` | child-process runs: expected aggregates for the app's synthetic corpus and for a second repository that exercises every counter; privacy; unavailable sources; read-only |
| `static.test.ts` | no write, network, shell or error-text echo anywhere in the tool; output only through the renderers |

## Interpretations

- **Search** is timed once per query per namespace, with the repository filter set to that namespace, on a
  freshly built index (no warm-up). The corpus statistics are therefore those of one namespace.
- **Alias sampling** resolves each sampled page's own title, so `resolvedToSelf` below `resolved`, or any
  `ambiguous`, shows title collisions inside a namespace.
- **`mismatches`** compare the index with a second parse of the same blob. They should be zero; they exist to
  catch a drift between `getPage` and the index.
- `topics.candidates` replays the core's grouping (normalised labels in `field` mode, directory prefixes in
  `directory` mode) so that `capped` is exact rather than "count equals the cap".
- Timings are single wall-clock measurements on the owner's machine. Compare runs on the same machine only.

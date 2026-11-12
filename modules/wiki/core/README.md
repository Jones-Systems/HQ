# Wiki core (`hq.wiki.source/v1` host side)

The host-side implementation behind the accepted `WikiService` contract. Task `task.wiki-core.001`
(interface `iface.wiki.001`). This directory is the entire write cone: `src/`, `test/`,
`tsconfig.json` and this README. `scripts/` is reserved and does not exist. The contract
(`../contract`) is imported through `../../contract/src/index.ts` and is never edited. There is no UI,
no React or Electron, no IPC/preload/root seam, no catalog or lockfile change and no new dependency.

Completion of this slice is not acceptance. The Wiki continuity owner decides acceptance.

## What it is

Committed Git objects of a configured bare repository go in; a validated, read-only `WikiService`
comes out. Nothing is ever fetched, pulled, written or executed from the source.

```text
GitObjectSource (port)  ──►  buildSnapshot  ──►  IndexStore (port)   ──►  createWikiHost  ──►  WikiService
 resolvePin/listTree/        parse, analyse,      hq.wiki.index/v1        per-namespace          7 closed methods,
 readBlob                    resolve links        snapshot per commit     state machine          every response contract-validated
```

- **Ports** (`ports.ts`): `GitObjectSource`, `IndexStore`, `Clock`. Failures are data
  (`unavailable | not-found | too-large`), never thrown.
- **Pure modules** import no `node:*` and are usable with a synthetic in-memory source. Only
  `node-git-source.ts` touches `node:child_process` and `node:fs/promises`.
- **Host** (`createWikiHost({ profiles, sources, store, clock })`) returns `{ service, refresh }`.
  `refresh(namespace?)` is host-only: it is not on `WikiService` and the renderer never receives it.
  Concurrent refreshes of a namespace coalesce. Before the first refresh a namespace is
  `unavailable`/`index-unavailable`; a source that disappears after a successful build is `stale` and
  keeps serving the last index. Content freshness is always `unknown` (no network is allowed).
- **Service methods** never throw and never leak messages: an unexpected failure becomes
  `internal/internal`.

## Modules

| Module | Role |
| --- | --- |
| `profile.ts` | `SourceProfile` validation (absolute `gitDir`, plain branch label, no embedded-credential remote, generic field-mapping defaults, `INDEX_RULES_VERSION`) |
| `frontmatter.ts` | Bounded front-matter subset; anything else is `unsupported` (page becomes raw `frontmatter-unsupported`) |
| `markdown-block.ts`, `markdown-inline.ts`, `markdown.ts`, `draft.ts` | CommonMark-lite parser into a context-free draft tree, then resolved into the contract's safe AST; flat link scan for raw pages; the block text each body link sits in (for backlink excerpts) |
| `resolver.ts`, `analyze.ts` | Wiki-link and path-link resolution, title/names/topics/relationships, `Page` construction, link provenance (`via`, excerpt) per target page |
| `build.ts`, `snapshot.ts`, `memory-store.ts` | Tree walk, snapshot build, strict snapshot re-validation (including link origins), in-memory store |
| `namespace-index.ts` | BM25, alias map, backlinks with provenance, topics with page titles, snippets |
| `host.ts` | `createWikiHost` |
| `node-git-source.ts` | Fixed-argv bounded Git adapter |

## Decisions and interpretations

Accepted contract decisions are preserved as written, with no repairs: the 2 MiB blob cap is
**imported** (`MAX_PAGE_BLOB_BYTES`, no second definition); queries count code points; null front-matter
fields and null list items are omitted, never coerced, and never force a raw page; the existing
structural bounds apply; excluded constructs (images, HTML, footnotes, `~~`, task markers, rejected
links) stay verbatim inert text; a URL containing a single quote is never rewritten.

Interpretations made where the plan was silent:

- **Links.** A rejected, anchor-only (`#x`), empty or `//host` destination stays the original source
  text (no out-link, no rewriting). Query and fragment are dropped from relative destinations, then the
  path is percent-decoded and resolved lexically; an escape above the namespace root is `missing`.
  Wiki links resolve by exact path (with the profile's extensions), then by the namespace-scoped alias
  map (title, alias fields, file stem; NFC, lowercase, whitespace-collapsed). Ambiguity is sorted and
  capped at 50. Targets never cross namespaces.
- **Search.** BM25 (k1 1.2, b 0.75, title weight 2 over title + aliases + stem), Unicode
  letter/number tokens, lowercase NFC. Corpus statistics are computed over the union of the searched
  namespaces. Ties break by `pageKeyId` in code-unit order. Snippets come from a stored excerpt of at
  most 4096 UTF-16 units.
- **Root check.** A namespace is available only if the `gitDir` is a real directory, the bare-repository
  and `remote.origin.url` checks pass, the branch resolves, and regular entries exist beneath
  `rootPrefix`.
- **Tree listing.** `listTree` returns `{ entries, skipped }`; symlinks, submodules and other non-regular
  modes are skipped and counted, and the core filters defensively by mode again.
- **Out-links.** The index keeps every unique link target; `Page.outLinks` is deduplicated by target and
  capped at 1000.
- **Topics.** `field` mode: `f-<slug>`; `directory` mode: `d-<slug>` hierarchy counting direct
  members only; collisions get a `~hash8` suffix; capped at 500, larger and shallower first. Each topic's
  preview carries `pageTitles` (the contract's additive member) in the order of `pages` (title, then key);
  it is always present in core output and is an empty list for a topic with no direct member pages.
- **Backlink provenance** (the contract's additive `via` and `excerpt`). Each snapshot page keeps
  `linkOrigins`: one entry `{ path, via, excerpt }` per unique target page other than itself, sorted by
  target path, so memory is bounded by the unique page links and the excerpt cap. Ambiguous, missing and
  external targets and self links create none, as before.
  - `via` is the distinct origins of the source's links to that target: `body` for any Markdown, path or
    wiki link in the body, and the relationship field name exactly as the profile configures it for a link
    read from frontmatter. Sorted by code unit, at most 8; if more would apply, `body` is kept and the other
    slots go to the first field names in order. A relationship field literally named `body` reports the same
    origin as a body link, but never supplies the excerpt.
  - `excerpt` is the flattened text (links contribute their label, code its text, no destinations) of the
    innermost heading, paragraph or table row (cells joined by a space) that holds the **first body link** in
    document order. List items count through their paragraphs, quotes through theirs. It is cleaned like a
    label: control characters become separators, whitespace collapses, lone surrogates drop, and it is cut to
    160 UTF-16 units without splitting a surrogate pair. It starts at the beginning of the block, so a long
    block can be cut before the link. It is absent when the only links are fields or the first body link's
    block has no text (a later link does not stand in).
  - **Raw pages** keep deriving links. Their body links get `via: ['body']` and an excerpt by the same rule,
    taken from the paragraph, not from the raw source line (which would still carry Markdown syntax). When
    only the frontmatter was unsupported or the AST failed validation, the structured parse's blocks are used;
    when a structural bound was exceeded, the flat link scan supplies each paragraph's flattened text. Raw
    pages with unsupported frontmatter have no fields and so no field origins; `not-text` pages have no links.
- **Snapshots** (`hq.wiki.index/v1`) are keyed by namespace and commit and carry a `profileKey`. They are
  untrusted on read: exact keys, sorted unique pages, valid paths and link targets are re-checked, and a
  corrupt or stale snapshot triggers a rebuild. `stats` are aggregate counters only. The rules version
  (`INDEX_RULES_VERSION`, part of the profile key) is **2**: a snapshot written by version 1 has another key
  and no `linkOrigins`, so it is rejected and rebuilt on the next refresh. The desktop persists these
  snapshots under `wiki/index-v1`: this is a once-per-store upgrade cost for each configured namespace,
  provided the version-2 snapshot is successfully written and its commit/profile remain unchanged.
  A failed store write, changed commit/profile or invalid snapshot can require another rebuild; an
  in-memory-only store rebuilds after restart. This is not a source-corpus migration or an eager rebuild
  of every stored commit. `linkOrigins` is re-validated strictly: it must match
  the page's own `page` link targets exactly (self excluded, none missing, none extra), sorted by path with no
  repeats; each `via` has 1..8 field-name-valid entries, strictly ascending; each excerpt is null or a
  single-line label of at most 160 units. The same corpus gives a byte-identical snapshot.
  **Historical synthetic size measurements** (retained from `0a5f819`; not rerun for recovery).
  `linkOrigins` cost about 180–200 bytes of serialised snapshot per unique (source, target) page
  pair (the target path again, `via`, and an excerpt of up to 160 units; a block that links several targets
  repeats its excerpt for each). On the two checked-in synthetic fixture corpora the snapshots grew from 7,256
  to 8,339 bytes (+14.9%, 9 pages, 6 pairs) and from 3,753 to 4,664 bytes (+24.3%, 5 pages, 5 pairs). On
  generated corpora of 500 and 5,000 pages (about 6.6 pairs per page, a 20-word vocabulary so the term tables are
  tiny) they grew from 962,424 to 1,622,159 bytes (+68.6%) and from 9,699,912 to 16,419,598 bytes (+69.3%).
  These generated corpora had tiny term tables; the relative overhead depends on corpus shape.
  These figures do not establish a bound or a measurement for private corpora or this recovery head.
- **Hostile input.** Block containers nest at most 24 deep (overflow degrades the page to raw
  `markdown-unsupported`); inline scanning has step, destination, delimiter-run and emphasis-depth
  budgets, reference lookups skip bracket text longer than any definition label (1998 code units),
  trailing line spaces are held back instead of rescanned, and ATX closing hashes are stripped by a
  right-to-left scan, so pathological inputs stay linear and bounded. Non-UTF-8 or NUL content is raw `not-text`.
- **Barrel.** `src/index.ts` includes the Node adapter; the renderer must not import core.

## Git adapter

`createNodeGitObjectSource(profile, options)` starts every Git process with `shell: false`, `windowsHide`,
`cwd` = the real git dir and a minimal environment (no user/system config, no prompts, no optional locks, no
replace objects, no lazy fetch). Every call is prefixed
`--git-dir=<realpath> --no-replace-objects --literal-pathspecs -c core.fsmonitor=false` and is exactly one of:

- `rev-parse --is-bare-repository`
- `config --get remote.origin.url`
- `rev-parse --verify --end-of-options refs/heads/<ref>^{commit}`
- `show -s --no-show-signature --format=%ct --end-of-options <commit>` (so a repository's
  `log.showSignature` cannot start its `gpg.program`)
- `ls-tree -r -z -l --full-tree <commit>`
- `cat-file --batch`

The first five run once each through `execFile` (`encoding: 'buffer'`, `killSignal: 'SIGKILL'`, a per-command
timeout and `maxBuffer`, behind a small concurrency semaphore, default 4). Blobs are read through **one
persistent `cat-file --batch` child per source** (`spawn` with piped stdin and stdout, stderr ignored), so a
refresh of N pages starts five processes plus one, not N + 5. That child is started lazily; its stdin only ever
receives a regex-validated 40/64-hex object id and a line feed. One request is in flight at a time and requests are
answered strictly in arrival order. The reply header is checked against the requested id; a `missing` reply is
`not-found`; a non-blob or a header larger than `min(maxBytes, MAX_PAGE_BLOB_BYTES)` is refused (`not-found` /
`too-large`) from the header alone and the child is killed, so such a body is never buffered (buffered output is
bounded by that limit plus one header). A framing error, unexpected exit, stream error or the per-read timeout
(`blobTimeoutMs`, default 30 s, counted from the write) kills the child and fails only that read as `unavailable`; the
next read gets a fresh child. The real path of the git directory is resolved for every read, and a child is never
reused for a different real path. The child gets end of input after `batchIdleMs` (default 1.5 s) without a read and
is killed if it ignores that, and `close()` kills it at once; a source is `unavailable` after `close()`, and no
process outlives the last read or `close()`.

Commit and object ids are regex-validated before spawning. The execution seams are injectable (`GitExec` for the
one-shot commands, `GitSpawn` for the batch child) so tests can assert the exact argv, options and everything
written to stdin. `GitSpawn` and `NodeGitObjectSource` (a `GitObjectSource` plus `close()`) are exported from
`node-git-source.ts`; the barrel was left unchanged.

## Checks

```sh
node --test modules/wiki/core/test/*.test.ts
node_modules/.bin/tsc -p modules/wiki/core/tsconfig.json --noEmit   # installed locked binary
```

Tests run on `node:test` with Node's native type stripping (no build step). Synthetic bare repositories
and fake Git binaries live in task-owned scratch under the home directory (never `/tmp` or the OS temp
dir); `test/scratch.ts` removes exactly what the process created on success, failure and
SIGINT/SIGTERM, and `scratch.test.ts` proves it. `static.test.ts` asserts the boundaries (no `node:*` in
pure modules, no `shell`, network, fetch/pull, writes, React/Electron, a second blob cap or host paths).

Actual runner coverage and telemetry are recorded in the task report, not here.

## Not covered

CI, the UI, the shell/root seam, IPC/preload, validation against private corpora and the installed app
are outside this slice and unverified here. All tests use synthetic repositories and in-memory sources.

## Deferred findings (non-blocking, unrepaired)

- **P2, root seam:** shell destinations cap at 512 characters while Wiki can represent 16,384-character
  destinations. A seam owner decision; nothing is repaired here.
- **P3, snapshot re-validation:** `parseSnapshot` checks `commitTime`/`indexedAt` with a loose
  pattern and `ref` only as a label, so a corrupt stored snapshot (for example `2024-02-30`) passes,
  then fails descriptor validation on every `indexStatus`/`listSources` and is never rebuilt while the
  commit is unchanged. Only reachable through a corrupted `IndexStore`; unrepaired here.
- **P3, contract:** omitting null front-matter fields loses key presence. A lossless contract revision is
  deferred; core follows the accepted omit-not-coerce decision.
- **P4, backlink excerpt window:** the excerpt starts at the start of the block, not around the link, so a
  block longer than 160 units can be cut before the link. Windowing around the link is a possible follow-up.
- **P4, `body` field name:** a relationship field named `body` cannot be told apart from a body link in `via`.
  Core neither rejects nor renames such a profile.
- **P4, documents outside this slice:** the Wiki evidence record and the UI README still describe topic
  previews as keys only; they were not edited here.

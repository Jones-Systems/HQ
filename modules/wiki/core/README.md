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
| `markdown-block.ts`, `markdown-inline.ts`, `markdown.ts`, `draft.ts` | CommonMark-lite parser into a context-free draft tree, then resolved into the contract's safe AST; flat link scan for raw pages |
| `resolver.ts`, `analyze.ts` | Wiki-link and path-link resolution, title/names/topics/relationships, `Page` construction |
| `build.ts`, `snapshot.ts`, `memory-store.ts` | Tree walk, snapshot build, strict snapshot re-validation, in-memory store |
| `namespace-index.ts` | BM25, alias map, backlinks, topics, snippets |
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
  members only; collisions get a `~hash8` suffix; capped at 500, larger and shallower first.
- **Snapshots** (`hq.wiki.index/v1`) are keyed by namespace and commit and carry a `profileKey`. They are
  untrusted on read: exact keys, sorted unique pages, valid paths and link targets are re-checked, and a
  corrupt or stale snapshot triggers a rebuild. `stats` are aggregate counters only.
- **Hostile input.** Block containers nest at most 24 deep (overflow degrades the page to raw
  `markdown-unsupported`); inline scanning has step, destination, delimiter-run and emphasis-depth
  budgets, so pathological inputs stay linear and bounded. Non-UTF-8 or NUL content is raw `not-text`.
- **Barrel.** `src/index.ts` includes the Node adapter; the renderer must not import core.

## Git adapter

`createNodeGitObjectSource(profile, options)` uses `execFile` with `shell: false`, `encoding: 'buffer'`,
`killSignal: 'SIGKILL'`, a per-command timeout and `maxBuffer`, `cwd` = the real git dir, a small
concurrency semaphore (default 4) and a minimal environment (no user/system config, no prompts, no
optional locks, no replace objects, no lazy fetch). Every call is prefixed
`--git-dir=<realpath> --no-replace-objects --literal-pathspecs -c core.fsmonitor=false` and is exactly one of:

- `rev-parse --is-bare-repository`
- `config --get remote.origin.url`
- `rev-parse --verify --end-of-options refs/heads/<ref>^{commit}`
- `show -s --format=%ct --end-of-options <commit>`
- `ls-tree -r -z -l --full-tree <commit>`
- `cat-file blob <oid>`

Commit and object ids are regex-validated before spawning; blobs above `MAX_PAGE_BLOB_BYTES` are
reported `too-large` without being read in full. The exec function is injectable (`GitExec`) so tests can
assert the exact argv and environment.

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
- **P3, contract:** omitting null front-matter fields loses key presence. A lossless contract revision is
  deferred; core follows the accepted omit-not-coerce decision.

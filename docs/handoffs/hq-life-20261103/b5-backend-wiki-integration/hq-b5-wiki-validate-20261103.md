# Handoff: B5-W3 Wiki private-source validation tool

Lane B5 (HQ backend: Wiki backend, shared contracts, integration). Builder: Claude Sonnet 5.5.
Written 2026-11-03 when the owner paused all lanes. No PR is open and none was requested before review.

## Where it stands

| Item | Value |
| --- | --- |
| Branch | `work/hq-b5-wiki-validate-20261103` |
| Worktree | `work-hq-b5-wiki-validate-20261103` (the T3-bound worktree of this branch; I am its sole Git owner) |
| Base | `work/hq-foundation` at `0cd50abc974320771cc21145dc8a8fd58a3eb8b1` |
| Code head before this handoff commit | `352df74abde09f5467a05f8542ff6c129358ca76` |
| Commits | `6295bc1` tool; `b0f7722` tests and CI wiring; `352df74` WIP, README example (docs only); then this handoff |

**Done** (implemented, committed, checked at `b0f7722`; `352df74` only adds a README example):

- `modules/wiki/core/scripts/validate-sources.ts` plus `cli.ts`, `collect.ts`, `config-file.ts`, `report.ts`,
  `classify.ts` and `README.md`: the owner-run, aggregates-only tool from the task, with every output field the task
  lists, the exit codes 0/2/3 (and 1 for an unexpected internal failure), `--config`, `--namespace`, `--queries`
  and `--json`.
- Tests in `modules/wiki/core/scripts/test/` (`classify`, `report`, `input`, `validate-sources`, `static`,
  plus `support.ts`), synthetic data only.
- `modules/wiki/package.json` `test` script gained `core/scripts/test/*.test.ts` (the four original globs are
  unchanged); `modules/wiki/core/tsconfig.json` now includes `scripts`; `modules/wiki/core/README.md` has a
  one-sentence pointer (it previously said `scripts/` "does not exist").

**In progress:** nothing mid-edit. The last step, re-running the static tests after the README example edit, was
aborted by the pause. **Not started:** any run against real sources (the lead does that separately), a PR, CI.

## Checks (Node v24.19.0, serial, after a fresh CPU admission sample)

| Command | Result | CPU sample |
| --- | --- | --- |
| `node --test modules/wiki/core/scripts/test/*.test.ts` | 129 tests, 129 pass, 0 fail, 0 skipped | 67.52% (final run) |
| `node --test modules/wiki/core/test/*.test.ts` | 216 pass, 0 fail, 0 skipped | 65.29% |
| `npm test --workspace @hq/wiki` | 635 pass, 0 fail, 0 skipped (506 existing + 129 new) | 34.62% |
| `node_modules/.bin/tsc -p modules/wiki/core/tsconfig.json --noEmit` | exit 0 (12 `core/scripts` files are in the program) | 77.49% |
| `npm run typecheck` | all five steps ran with no diagnostics; I read the output, I did not capture the exit code | 73.48% |

Not re-run after `352df74`: `scripts/test/static.test.ts` (its public-safety test reads `scripts/README.md`) and
`app/test/static.test.ts`. I grepped the README for host paths and IPv4-like strings by hand and found none.

Mutation checks, run in a throwaway copy outside the repository: leaking the ref (`main`) into the report is
caught by 8 tests; leaking a source path into the unavailable-source message, and adding a file write, are caught by 9
(static boundary tests, the unavailable-source privacy tests, and the `node --permission` no-write run).

**Process deviations to disclose.** Two exploratory tool runs (single short child processes against synthetic
fixtures, no test suite) started above the 85% limit: one at a sample of 97.39% and one at 85.8%, both because of how I
chained commands. After that every command went through a wrapper that refuses to run above 85%. Refusals happened
about ten times (samples of roughly 89 to 97%) and I waited and retried. The first full run of the scripts suite
(one failing test, see below) was admitted but I did not capture its sample.

## Design decisions and why

- **Closed-schema output is the privacy mechanism** (`report.ts`). The report type is derived from a schema of declared
  keys, finite non-negative numbers, booleans, `null` and a few fixed enums (`bl`, `appdev`, `configured`, the four
  index states). `renderJson` and `renderTable` check the finished report against it and throw if anything else is
  present, so a leak fails every run instead of depending on scrubbing. The ref is always the word `configured`; commit
  ids are never reported.
- **Fixed messages only.** Input failures print a fixed code, an optional position number and an optional contract
  reason code from the contract's closed list; never a path, key, value or `error.message`. The entry file installs
  `uncaughtException`/`unhandledRejection` handlers that print one fixed line. `static.test.ts` pins this (no `.message`,
  `.stack`, `console`; stdout/stderr written only in the entry file).
- **Counts come from the stored snapshot, behaviour from the service.** After `host.refresh()` the tool reads the
  snapshot the in-memory store holds (re-validated with `parseSnapshot`) for link kinds, shapes, backlink edges, topic
  candidates and byte size; it drives the seven `WikiService` methods for sampling and timing. One host per namespace,
  so a failing source never affects another.
- **Git process count** is measured by wrapping the adapter's injectable `exec` seam. Expected value for a source is
  `5 + pages` during refresh (four `resolvePin` commands, one `ls-tree`, one `cat-file` per page) and one per sampled page
  afterwards; tests assert this against Git's own listing.
- **File reading** follows `importedProfile` (lstat, no symlink, regular file, bounded read, 256 KiB) and adds the
  regular-file check before opening (so a FIFO cannot block) and `O_NOFOLLOW`/`O_NONBLOCK` on the open.
- **Sampling:** every Nth page in path order with N = ceil(pages / 200); `resolveAlias` is called with each sampled
  page's own title. `topics.candidates` replays the core's grouping so `capped` is exact. `contractFailures` counts
  `internal/internal` responses plus responses that fail contract re-validation here.
- **Table mode omits rows that are zero for every namespace** (the task asked for a short table; `--json` lists all).
- **Search** is timed once per query per namespace with that namespace as the repository filter, cold.
- **Missing-target shape names:** I kept the task's `md-path-not-found` although it means "ends with any configured
  page extension".
- **Tests:** the expected figures are derived by hand from the fixture text and from Git (page counts, process counts),
  not copied from tool output; the page-count/hand-derived numbers all matched on first run. A second synthetic
  repository (`support.ts` `buildShapeRepo`) exercises every counter: both ambiguity buckets, all six shapes, the three
  raw reasons, five null omissions, oversize, symlink and submodule skips, the out-link cap, a full excerpt, a topic
  cap (544 candidates), sampling above 200 pages. Pinned JSON key list, fixed string leaves, table rows checked against
  the JSON, and a substring search of stdout/stderr for every private-looking string (collected through the real host)
  in both modes and on the error paths (bad config, invalid profile, unavailable source, symlinked or oversized
  config, invalid query).
- **Read-only proof:** `git rev-parse`/`ls-tree` and a byte fingerprint of the source repos and of the whole scratch
  tree compared before and after, and a run under `node --permission` with no write grant.

## Findings (none blocks the candidate; severities are mine)

- **P3, pre-existing CI gap (not mine to repair):** root `npm run typecheck` runs `modules/wiki/tsconfig.json`, which
  covers only `app/`. `modules/wiki/core/tsconfig.json` (core `src`, `test`, and now `scripts`) is not typechecked in CI.
  Only the explicit `tsc -p modules/wiki/core/tsconfig.json --noEmit` covers it.
- **P3, CI time:** the new suite is about 15 to 40 s wall (it builds a 219-page repository and runs the tool on it about
  20 times). The required job has a 6-minute timeout and a sub-two-minute feedback target; the lead should compare the
  queue-inclusive Foundation time before and after on a PR run. Reducing `BULK_PAGES` further is not possible below ~200
  without losing the "more than 200 pages" sampling case.
- **P3, `peakRssBytes`** is the tool process only; Git child processes are not included. Documented in the README.
- **P4, shape heuristics:** `missingShapes` judges the label text only, so `Node.js` counts as `non-page-extension` and
  `Read/Write Policy` as `title-like`. Documented as a heuristic.
- **P4, platform assumptions in tests:** the FIFO test needs `mkfifo` (POSIX); the permission-model test needs
  `node --permission --allow-child-process` (verified on 24.19.0 only).
- **Defect found and fixed during the work:** my first privacy test failed on `.md` because the table row label
  `missingShapes.md-path-not-found` contains it. It was a false positive in the test, not a leak; page extensions are
  no longer collected as private strings.

## What is left, in priority order

1. **Re-verify the head.** Gate on a CPU sample under 85%, then run
   `node --test modules/wiki/core/scripts/test/static.test.ts modules/wiki/app/test/static.test.ts` (README hygiene after
   `352df74`). If you want a clean record at the final head, re-run the five checks above.
2. **Lead review of the diff** (`git diff 0cd50abc974320771cc21145dc8a8fd58a3eb8b1..HEAD`), focusing on
   `report.ts` (schema), `collect.ts` (what is read from page data), `config-file.ts` and `test/static.test.ts`.
3. **Independent read of the privacy claims:** try to make the tool print something data-derived (add a key, add a
   string to a report field, echo an error) and confirm `report.test.ts`, `validate-sources.test.ts` and `static.test.ts`
   fail. My own mutation checks are listed above.
4. **Open the PR** against `work/hq-foundation` (lead's decision) and confirm the Foundation check time.
5. **Owner run against private sources** (lead, separately), with the command in the README. Config and queries files
   stay outside the repository; publish only the printed aggregates.
6. Optional: speed up `buildShapeRepo` (one `git hash-object` per file; a single `git fast-import` would cut a few
   seconds) and add a root-level typecheck for `core/tsconfig.json` (needs the root owner).

## Open questions and risks

- Should search be timed across both namespaces together (as the app searches by default) in addition to per
  namespace? I chose per namespace; the combined case would need a second host.
- Is `exit 1` for an unexpected internal error acceptable alongside the specified 0/2/3? The task said "never a stack
  trace" but did not name a code.
- Unverified: Windows, Node 22.18, any real corpus, large-corpus memory and time (the snapshot JSON and parsed index
  are both resident), and a CI run. The tool has only seen synthetic repositories of up to 219 pages.
- The privacy guarantee covers what the tool prints. It does not constrain what the owner copies from the config or
  queries files, or from Git itself.

## Exists only outside the commits

- Nothing of value. Uncommitted work: none after this handoff commit. Throwaway scratch (a synthetic exploration
  repository, config files, a mutation-test copy of `modules/wiki`, and an admission log) lived under the OS temp
  directory and was removed after this handoff was pushed; none of it is needed.
- Test scratch from the suites lives in task-owned directories under the home directory and is removed by the
  helpers on exit.
- `node_modules` in the worktree came from `npm ci --ignore-scripts` and is ignored by Git.

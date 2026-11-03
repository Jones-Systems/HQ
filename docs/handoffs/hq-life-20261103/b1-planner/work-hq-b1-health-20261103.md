# Handoff: B1-H typed Planner health and failure reasons (paused)

Paused by an owner request relayed by the lead, 2026-11-03. Work stopped mid-task; nothing was dispatched, no PR was
opened or touched.

- Repository: Jones-Systems/HQ
- Branch: `work/hq-b1-health-20261103`, created from `work/hq-backend-planner-20261103` at `7818059f75739837a042c0fe6636d1d953ce676f`
- Worktree: `/home/malcolmjones/.t3/worktrees/HQ/work-hq-b1-health-20261103`
- Code head: `40501581cb330d1d9f7501e498e0ce1a8d4bb04e` (`WIP: typed Planner health and unavailable reasons (B1-H), paused by owner request`). A second commit adds only this file; its SHA is the branch head reported with the thread reply.
- Brief: `/tmp/hq-b1-briefs/b1-h.md` (sha256 `9b1ca276…1842e5`) and `common.md` (sha256 `32831be6…eecbd`); both hashes verified before starting.

## Where each task stands

| Task | State |
| --- | --- |
| 1. Wire: `decodeVersion` returns `api` and `retention`; `decodeSnapshot` sets `Snapshot.api` | **Done**, committed, unit tested |
| 2. Failure reasons on every `unavailable` the adapter produces | **Done**, committed, unit tested |
| 3. G7: replay 400 for a baseline newer than the store is `replay_indeterminate/store_changed` | **Done**, committed, unit tested, mutation-checked |
| 4. `probePlanner` in `live/health.ts`, exported from `live/index.ts`, `PlannerLive.health()` | **Done**, committed, unit tested |
| 5. Settings: `plannerHealthStatus` and Check connection via `probePlanner` | **Code done and committed; not tested, not typechecked after the change** |
| Test: `plannerHealthStatus` for every status | **Not started** (the edit was interrupted and did not apply) |
| Test: DataSources check path with a fake `work` transport | **Not started** (file `apps/desktop/src/settings/DataSources.test.tsx` does not exist) |
| Test: real-Planner `apps/desktop/src/planner-health.integration.test.ts` | **Not started** |

## What changed (files, all in the code commit)

- `modules/work/live/wire.ts`: `decodeVersion` returns `Version` (`stateVersion`, `features`, `api: number | null`, `retention: {max, evictedThroughVersion} | null`). `decodeSnapshot` adds `api` only when the body carries one (the key is absent otherwise).
- `modules/work/live/adapter.ts`: reasons on every `unavailable`; `store_changed` detection (`baselineAhead`); `PlannerLive.health()`.
- `modules/work/live/health.ts` (new): `probePlanner(transport, now)`.
- `modules/work/live/index.ts`: exports `probePlanner`.
- `apps/desktop/src/services/data-source-status.ts`: `plannerHealthStatus(health)`.
- `apps/desktop/src/settings/DataSources.tsx`: Work's check calls `probePlanner(window.hqServices.work)`; timeout and generation guard untouched; Social's check unchanged. With no Work transport in the window the result is `Unreachable`, as before.
- Tests: `modules/work/live/test/adapter.test.ts` (updated and extended), `transcript.test.ts` (one assertion), new `wire.test.ts` and `health.test.ts`.

## Decisions and why

Behaviour the brief fixed is implemented as written. Where it was silent or two lines pulled apart, I took the conservative reading:

1. **Replay lookups answered with any non-2xx other than 403/421 (`refused`), 5xx (`server_error`), 409 `replay_indeterminate`, 422 `request_id_reused` or the new 400 `store_changed` are `unknown`, not `unavailable`.** Brief task 2 says to keep `unavailable` only for transport loss, 403/421 and 5xx; task 3 says a 400 that is not a newer baseline keeps "today's mapping", which for a lookup was `unavailable`. I followed task 2 for the lookup 400 as well. `unknown` is safe in the store: `recoveryFailure` treats it as "still unknown" and keeps the entry; returning `invalid` or `not_found` for a lookup would make the store drop the unconfirmed write. For a resend the 400 still maps through `writeFailure` (`invalid`, ID freed), which is today's mapping.
2. **A malformed 2xx replay body to a lookup stays `unavailable`, now with reason `incompatible`.** Today's mapping plus the required reason. A malformed 2xx to a resend stays `unknown`.
3. **Reads:** any transport failure (`unavailable` or `unknown` kind, or a thrown or malformed bridge answer) is `unreachable`. `not_found` is kept only for `item` and `history` 404s; a 404 on `state` or `version` is `incompatible` (this is the "another web server at that address" case). Other statuses and malformed bodies on `item`/`history` are also `incompatible`; the brief named only `state`/`version`.
4. **Decoders:** only an absent `api` or `request_retention` means "none". An explicit JSON `null` is malformed, following how `features` is already decoded (`null` is malformed there). `api` must be an integer >= 1; retention `max` and `evicted_through_version` must be non-negative integers (same test as `state_version`). A malformed `api` on `GET /api/state` also makes the snapshot malformed (consistency with the version route; the brief only spelled this out for version). `decodeSnapshot` does not look at `request_retention`.
5. **`store_changed` detection** does one `GET /api/version` after a replay 400 and compares with the entry's recorded `sentAfterVersion`; equal is not "below". It does not call `observe`, and a failed or malformed version read falls back to the ordinary mapping. The ledger entry is not forgotten, and `applyAuthorized` stays cleared, so an apply still needs a fresh `not_applied` check.
6. **`probePlanner`:** `ready` iff both `requests.replay` and `hq-references-v1` are advertised; `no_batch` alone leaves it `ready` with `limits: ['no_batch']`. `httpStatus` is present whenever a status was received (including a 2xx with a malformed body) and omitted otherwise. A transport that throws or answers outside the `ServiceResponse` shape is `unreachable`, because Settings passes the raw `window.hqServices.work` rather than a `bridgeTransport`-wrapped one. `checkedAt` is taken after the answer.
7. **Settings text** follows the brief exactly. A `limited` health with an empty `limits` list (cannot occur from `probePlanner`) reads `Reachable · limited`.

## Findings

- **Possible defect, not fixed (outside the brief):** the adapter's `observedVersion` only ever rises (`Math.max` in `observe`). After a store swap that lowers the Planner's version, a *new* write records a `sentAfterVersion` above the store's version; if its answer is then lost, its Check gets a 400 and is reported `store_changed` although the write was sent after the swap. Fixing it changes the ledger baseline rule, so it needs a lead decision.
- **Base moved:** the local ref `origin/work/hq-backend-planner-20261103` is at `273f8cd`, two documentation-only commits ahead of the `7818059` base this branch was created from (spec refinements, `docs/design/work/adapter-boundary.md`, `services/README.md`). I did not fetch or merge. None of it touches files I edited; the lead may merge forward when integrating.
- **Layout not checked:** Settings texts are longer now (for example `Refused · start the Planner with --allowed-host for this address`). `Connections.tsx` shows the text in the rail row (`title` and `aria-label` carry it in full); `apps/desktop/src/Connections.tsx` and the CSS are outside my edit boundary. Nobody has looked at how the row wraps.
- The first `git push` was rejected by GitHub with `(failed)` and no reason; the second push of the same commit succeeded. I did not investigate the first failure.

## Checks run (all before the Settings edits; none after)

CPU was sampled (`collect_work_capacity.py --format admission`) before `npm ci` (76.04%) and before the typecheck (71.43%). I did **not** re-sample before each later Vitest run, which the common rules ask for.

- `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund`: added 162 packages.
- `npm run typecheck`: clean (exit 0) on the adapter, wire, health and live-test changes. **Not re-run after `data-source-status.ts` and `DataSources.tsx` changed.**
- `node_modules/.bin/vitest run --maxWorkers=4 modules/work/live`: 6 files, **282 passed, 0 failed, 0 skipped** (last run, 15:18 local). Earlier runs: 12 expected failures after the behaviour change (reasons and `api: 2` in snapshots), 177 passed after updating those assertions, 203 passed after the adapter tests were added.
- Mutation check: with the `store_changed` line disabled, 3 adapter tests failed (lookup, apply and "not a newer baseline"); the file was restored and the scratch copy removed.
- **Not run:** `apps/desktop/src/settings`, `apps/desktop/src/services`, `live-services.integration.test.tsx`, any root-wide Vitest, Planner Python/Node suites, CLI suite.

## What is left, in priority order

1. Verify the committed Settings code: sample capacity, `npm run typecheck`, then `node_modules/.bin/vitest run --maxWorkers=4 modules/work apps/desktop/src/settings apps/desktop/src/services apps/desktop/src/live-services.integration.test.tsx`. Existing `Connections.test.tsx`/`ServiceSettings.test.tsx` call `work.call` with a bare `{ ok: true, status: 200, body: {} }`, which is now a *malformed* version body (`Not a compatible Planner`); check whether any existing assertion depends on the old `Reachable` text for Work and update it with the reason in the commit message.
2. `data-source-status.test.ts`: add `plannerHealthStatus` cases for every status (ready with API 2, 3 and null; limited with each limit and combinations in order and with an empty list; refused, unreachable, server_error, incompatible; unreachable equals `checkedServiceStatus(false)`; `worstSource` keeps a refused one).
3. New `apps/desktop/src/settings/DataSources.test.tsx` (happy-dom, as `.test.tsx` files run there): render `DataSourcesProvider` with `Connections`, a fake `window.hqServices` whose `work.call` is a spy; click `Recheck Work: Set up · not checked`. Assert for ready, no-api, no-replay, 421, 403, `{ok:false}`, thrown bridge, 503, 404 and malformed-body answers the displayed text and tone, and that `work.call.mock.calls` equals `[['version', {}]]` with `social.call` untouched. Add: unconfigured Work probes nothing; a missing `work` transport shows `Unreachable`; a 10 s timeout with fake timers ignores a late first answer and does not unlock a newer check (copy the pattern in `Connections.test.tsx`).
4. New `apps/desktop/src/planner-health.integration.test.ts` (Node environment, `.test.ts`): a local start/stop function that spawns `python3 -m planning --data <tmp>/planning.sqlite3 --host 127.0.0.1 --port 0` with `cwd: 'services/planner'` and reads the URL from stdout (`/http:\/\/127\.0\.0\.1:\d+\//`), scratch from `mkdtemp(join(tmpdir(), 'hq-b1-health-'))`, stopped with SIGTERM and awaited, directory removed with `fs.rm` in `finally`. Do not create `apps/desktop/src/test/planner.ts` (another builder owns it). Three cases through `createServices(stubConfig, sendHttp)` from `../electron/services` and `probePlanner(services.work)`: ready with API 2 against the started Planner; refused (HTTP 421) by starting a second Planner with `--host 127.0.0.2` and pointing the stub `ServiceConfig` at `http://127.0.0.2:<port>`; unreachable by binding a `net` server on port 0, closing it and using that port. Follow the `bridge()` stub in `live-services.integration.test.tsx`.
5. Re-run the brief's commands (`npm run typecheck`, then Vitest on the listed paths plus the new file), record counts, commit and push.

## Open questions and risks

- Lead: is `unknown` the right result for a lookup answered with an unexpected status, including the 400 that is not a newer baseline (decision 1)? The alternative is `unavailable` with `incompatible`, which drives the store offline.
- Lead: should the monotonic `observedVersion` be revisited (see Findings)?
- Lead: confirm `null` for `api`/`request_retention` should be malformed, and that a malformed `api` should reject a snapshot (decision 4).
- Risk: the Settings change has no test coverage until items 2–3 land, and existing desktop tests may assume the old two-state Work check.

## Exists only uncommitted or only in this thread

Nothing uncommitted remains in the worktree. Two edits were interrupted by the pause and **never applied**: the `plannerHealthStatus` tests in `data-source-status.test.ts` and `DataSources.test.tsx`. Their intended content is described in items 2 and 3 above; the drafts exist only in this thread's history. No Planner process was started and no scratch directories exist (the mutation check's temporary directory was removed).

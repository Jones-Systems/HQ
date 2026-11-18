# Lane B1 handoff: Planner service and Work live connection (paused 2026-11-03)

Lane B1 owns the Planner service (`services/planner`), its agent CLI (`tools/hq-cli`), the Work store and live
adapter (`modules/work/core`, `modules/work/live`) and the desktop connection (`apps/desktop/electron` bridge and the
Settings connection check). Work stopped at the owner's pause request. This file records where everything stands so
another lead can resume. The design and contract are in the assessment
[`spec.hq-backend-planner-assessment-20261103`](../../engineering-specs/backend-assessment-planner-20261103.md); read it
first.

## Where it stands

| Part | State |
| --- | --- |
| Assessment: inventory, gaps G1–G11, PR triage, B1 design, test plan | **Done, pushed.** `7818059`, refined in `0cf2bcb`. |
| Port contract additions (`modules/work/core/port.ts`) | **Done.** Additive: unavailable reasons, `PlannerHealth`, `PlannerLimit`, `store_changed`, `Snapshot.api`, intent export/adopt. |
| Stale docs (G8): `services/README.md`, adapter boundary GW-1/GW-7 | **Done.** `273f8cd`. |
| Device storage for Work and restart-safe intents (B1-Q2) | **Done, reviewed, merged into the lane** (`9be7d2b`). |
| Planner, CLI and pinned vectors accept Wiki HQ references (B1-W, for lane B5) | **Done on its own branch, all checks pass.** PR not opened. |
| HQR pull requests #80–#102: re-verification, successors, composite (B1-T) | **Mostly done.** Every PR verified; three successors pushed; composite built. Its final full check run was cut off by a host hang. PRs not opened. |
| Store offline queue, connection state and durability hub (B1-Q1) | **Code and tests pushed, not reviewed.** Cancelled at the pause (no reply). |
| Typed health, failure reasons, G7, Settings check (B1-H) | **WIP.** Adapter side done and unit-tested; Settings side written but untested. |
| Real-Planner end-to-end suite and G9 (B1-E) | **WIP.** Written and typechecked; never run. |
| Desktop wiring of durability (`apps/desktop/src/services/domains.tsx`) | **Not started.** Needs B1-Q1 merged. |
| Independent Sonnet review, PR #186 ready, other PRs, watches | **Not started.** |

## Branches, worktrees, heads

All worktrees are under `~/.t3/worktrees/HQ/`, named like the branch with `/` replaced by `-`.

| Branch | Base | Head | Pushed | Handoff |
| --- | --- | --- | --- | --- |
| `work/hq-backend-planner-20261103` (lane) | `work/hq-foundation` `0cd50ab` | this handoff's commit | yes | this file |
| `work/hq-b1-work-local-20261103` (B1-Q2) | lane `7818059` | `87280cb` | yes; merged into the lane | [below](#b1-q2-device-storage-done) |
| `work/hq-planner-wiki-references-20261103` (B1-W) | foundation `0cd50ab` | `26b4928` | yes | [below](#b1-w-wiki-references-done) |
| `work/hq-planner-hqr-composite-20261103` (B1-T) | foundation `0cd50ab` | `441009f` | yes (the lead pushed it at the pause) | [below](#b1-t-hqr-pull-requests) |
| `work/hq-hqr-a5-client-core-successor-20261103` (B1-T) | #93 head + foundation | `e0490ae` | yes | [below](#b1-t-hqr-pull-requests) |
| `work/hq-hqr-a10-docs-successor-20261103` (B1-T) | #83 head + foundation | `e84a1c2` | yes | [below](#b1-t-hqr-pull-requests) |
| `work/hq-hqr-a4-captures-successor-20261103` (B1-T, **held**) | #85 head + foundation | `3b924cb` | yes | [below](#b1-t-hqr-pull-requests) |
| `work/hq-b1-offline-queue-core-20261103` (B1-Q1) | lane `7818059` | `0406757` | yes | [below](#b1-q1-offline-queue-core-unreviewed) |
| `work/hq-b1-health-20261103` (B1-H) | lane `7818059` | `d372516` (code `4050158`) | yes | [b1-planner/work-hq-b1-health-20261103.md](b1-planner/work-hq-b1-health-20261103.md) on its branch |
| `work/hq-b1-e2e-20261103` (B1-E) | lane `7818059` | `87dff10` (code `7b98a27`) | yes | [b1-planner/work-hq-b1-e2e-20261103.md](b1-planner/work-hq-b1-e2e-20261103.md) on its branch |

Open pull requests: **#186** (draft), `work/hq-backend-planner-20261103` → `work/hq-foundation`, linked to the lane
thread, not watched. No other B1 PR is open. The original HQR PRs are untouched: their refs stay frozen, and repairs
are successor branches.

Lane commits on top of `work/hq-foundation`:

1. `7818059` Assessment, plus the additive port contract.
2. `0cf2bcb` Contract refinements: compare-and-swap rules, the queued outcome, connection semantics, Settings health
   texts, the work-local binding, and finding G11.
3. `273f8cd` G8: corrects `services/README.md` and adapter-boundary GW-1 and GW-7.
4. `9be7d2b` Merge of B1-Q2 (`2d694f8`, `48f484f`, `87280cb`).
5. This handoff, the builder briefs (`b1-planner/briefs/`) and B1-T's raw verification log (`b1-planner/evidence/`).

Lane checks on `9be7d2b`:
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `vitest run --maxWorkers=4 modules/work/live apps/desktop/electron packages/contracts`: 43 files, 672 passed.
  Five emitted-bundle tests need `npm run build` first; without it they fail with missing `dist-electron` files.
- Planner and CLI suites were not run on the lane branch, which does not change `services/**` or `tools/**`.

## Builders

Each ran as a T3 delegated task on `claudeAgent` / `claude-sonnet-5-5` / effort `xhigh`, in its own worktree, from the
briefs in [b1-planner/briefs/](b1-planner/briefs/) (`common.md` applies to all). Task client request IDs:
`hq-b1-{t,h,q1,q2,e,w}-20261103-1`. Their full reports are in the B1 lead thread.

### B1-Q2: device storage (done)

- **Adapter:** `PlannerRecovery.exportIntent` and `adoptIntent`, with validation in `modules/work/live/intent.ts`.
  Adoption accepts only an intent in exactly the form the adapter records. It sends nothing, authorizes no Apply, and
  is idempotent and limited.
- **Contracts:** `WorkLocal*` types and `HqServices.workLocal?`.
- **Main:** `apps/desktop/electron/work-local.ts` keeps one document per Work origin under
  `<userData>/work-local/<sha256>.json`.
  - Directory 0700, file 0600.
  - Atomic write: temporary file, fsync, rename, directory fsync.
  - Revision compare-and-swap, a per-process opaque `binding` per origin, and a 16 MiB cap.
  - Refusals carry a kind only.
- **Wiring:** channel `hq:svc:work-local` (`CHANNELS.workLocal`), `preload.cts` exposes `workLocal`, and the
  renderer side is `modules/work/live/durable.ts` (`isWorkLocalBridge`, `workLocalPersistence`).
- **Builder checks:** 28 single-defect mutations, 26 killed and 2 equivalent. Vitest 672 passed; build exit 0.
- **Follow-ups (not done):**
  - `before-quit` does not wait for an in-flight work-local save. The write is atomic, so at worst the last change is
    lost.
  - A failed directory fsync after the rename answers `unavailable` although the new document is in place, so later
    saves conflict until a reload.

### B1-W: Wiki references (done)

Lane B5 asked for this. B1 took it because the change spans the Planner, the CLI, Work's pinned vectors and the spec.

- **Change:**
  - The Planner's `_HQ_DOMAINS` gains `wiki`, for both the target and the return destination.
  - A `domain-wiki` vector is added.
  - The CLI's `referenceDomain` gains `wiki`.
  - Work's copy of `reference-vectors.json`, `SHA256SUMS`, `SUMS_SHA256` and `PROVENANCE.md` are re-pinned.
  - `spec.hq-agent-cli` line 229 now follows `DOMAIN_IDS`.
- **Commits:** `3ca226e`, `4a24139`, `875fa92`, `26b4928`.
- **Checks:**
  - Planner: Python 76 OK, Node 30 pass, `generate.py --check` OK (27 exchanges).
  - CLI with `HQ_CLI_E2E=1`: 86 pass.
  - Typecheck exit 0; Vitest `modules/work/live` + `packages/contracts` 186 passed.
  - Negative controls fail as they should.
- **Conflict check:**
  - Merges cleanly with #89, #80 and #85, singly and all three together (Python 100 OK, Node 30, CLI 86).
  - In the combined tree, Work's upstream drift test fails because of #85 alone. Its held re-pin `3b924cb` fixes that,
    but conflicts with B1-W's Work pin in `contract.test.ts` (`SUMS_SHA256`) and `PROVENANCE.md`. Whichever lands
    second re-pins against the merged upstream `SHA256SUMS`, which will carry the new vectors line and 42 exchanges.
- **Leftovers:**
  - The local branch `tmp/hq-b1-w-merge-89` (`74bd3ef`) remains in its worktree; dcg blocked deleting it.
  - `docs/planning-evidence/hq-agent-cli/projection.json` still records the spec's old SHA-256 (open question).
- **Owed:** send lane B5 the PR link when it opens.

### B1-T: HQR pull requests

Raw per-check log: [b1-planner/evidence/hqr-verify-summary-20261103.txt](b1-planner/evidence/hqr-verify-summary-20261103.txt).
Each original head was merged `--no-ff` onto foundation `0cd50ab` in a local `verify/pr-N-20261103` branch; every
merge was clean. The checks are the Planner Python and Node suites, `generate.py --check`, the CLI with
`HQ_CLI_E2E=1`, and Vitest on `modules/work/live` plus the real-Planner shell test (foundation baseline: 72 / 29 / OK /
85 / 175).

| PR | Head | Python | Node | gen | CLI | Work | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #80 | `6dd4694` | 72 OK | 29 | OK (27 + SHA256SUMS) | 85 | 175 | Land-ready |
| #81 | `307a228` | 81 OK | 29 | OK | 85 | 175 | Land-ready |
| #84 | `6530b5e` | 84 OK | 29 | OK | 85 | 175 | Land-ready |
| #89 | `89098b2` | 96 OK | 29 | OK | 85 | 175 | Land-ready |
| #94 | `f9648bb` | 74 OK | 29 | OK | 87 pass + 3 todo | 175 | Land-ready |
| #82 | `e72ce52` | 72 OK | 29 | OK | 93 | 175 | Land-ready |
| #86 | `330c0e8` | 72 OK | 29 | OK | 93 | 175 | Land-ready |
| #102 | `31f8661` | 72 OK | 41 | OK | 85 | 175 | Land-ready |
| #93 | `7a4213d` | 72 OK | 45 | OK | 85 | 175 | **Needs fixes** (breaks the pinned-upstream byte equality) → successor `e0490ae` |
| #83 | `4bcae77` | 72 OK | 29 | OK | 85 | 175 | **Needs refresh** → successor `e84a1c2` |
| #85 | `b3597e9` | — | — | — | — | — | **Held for owner acceptance** → successor `3b924cb` |
| #161, #162 | — | — | — | — | — | — | Not Planner or Work; composed by #179 |

Successors:
- **`e0490ae` (#93):**
  - Restores `public/js/{ordering,dates,model}.js` to their pinned bytes. `projectBoardMove` now passes
    `place: 'bottom'` instead of relying on #93's changed `projectMove` default.
  - Adds `tests/upstream_equality.test.mjs`.
  - Checks: Node 50, Python 72 OK, gen OK, CLI 85.
- **`e84a1c2` (#83):** documentation only. It corrects claims that are now false (hosted CI exists) and applies the doc
  deltas the HQR PRs requested. The `services/README.md` Work-adapter sentence is untouched; the lane fixed it.
- **`3b924cb` (#85, held):**
  - Re-pins Work's contract copies to 42 exchanges and extends `transcript.test.ts` to 28–42.
  - Before the re-pin, Work fails 1 test (the drift test). After it, Work passes 198 and gen verifies 42 exchanges.

Composite `441009f`:
- **Merge order:** ordered `--no-ff` merges of #80, #81, #84, #89, #94, #82, #86, `e0490ae`, #102 and `e84a1c2`. All
  were clean.
- **Todo cases:** `441009f` enables #94's three `todo` CLI regressions now that #89 is in.
  - All three pass, by the builder's commit message.
  - Two of them, the DST gap and the lone surrogate, fail on #94 alone, so they are real regressions.
- **Before `441009f`:** Python 119 OK, Node 62, gen OK, CLI 103 pass + 3 todo.
- **Full required-check run at `441009f`, interrupted:**
  - `npm run build`: exit 0.
  - Root Vitest: 1 failed, 1872 passed. The failure is `apps/desktop/electron/catalog-host.test.ts` "preserves K3
    partial completeness at 500 entries", which timed out at 5142 ms against a 5000 ms limit under host load. It is
    unrelated to the Planner. Re-run it on an idle host.
  - `npm test --workspace @hq/wiki`: 506 pass.
  - Acceptance + `tools/storage`: hung for 38 minutes on the host umask problem (see Findings).
  - The Planner, CLI and Work steps after it never ran on `441009f`.
- **Cancellation:** the builder was blocked waiting on that hung run, so neither the pause nor the umask warning reached
  it. It was cancelled after the 10-minute window. Its worktree was clean.
- **Local-only branches:** `verify/pr-*-20261103` remain in its worktree, deliberately unpushed.

### B1-Q1: offline queue core (unreviewed)

- **Commits:**
  - `3db0e25`: `store.ts` +598 and the new `durability.ts`.
  - `6a24f1c`: the tests `queue.test.ts`, `queue-flush.test.ts`, `durability.test.ts` and `queue-support.ts`.
  - `0406757`: a confirmed queued write never stays `sending`.
- **Claimed scope:** per the commit messages, the full brief, and "with the queue off nothing changes: the existing suite
  passes unmodified".
- **When paused:** it was waiting on a background mutation run and never saw the pause message. It was cancelled after
  the 10-minute window.
- **Unverified:** there is no handoff file and no final report, so its test results are unknown. The lead has neither
  reviewed nor run it. Its worktree was clean at cancellation.

### B1-H and B1-E (paused WIP, own handoffs)

- **B1-H** ([handoff](b1-planner/work-hq-b1-health-20261103.md) on `work/hq-b1-health-20261103`):
  - Done and unit-tested: wire `api` and `retention`; reasons on every `unavailable`; G7 `store_changed` (one version
    read after a replay 400); `probePlanner` and `PlannerLive.health()`. Live suite: 282 passed.
  - Not done: the Settings change is committed but untested and not typechecked. The `plannerHealthStatus` tests, a
    `DataSources` check-path test and `planner-health.integration.test.ts` are unwritten.
  - Its handoff lists the next steps and three decisions for the lead to confirm.
- **B1-E** ([handoff](b1-planner/work-hq-b1-e2e-20261103.md) on `work/hq-b1-e2e-20261103`):
  - Written: the helper `apps/desktop/src/test/planner.ts` (OS-temp scratch, same-port restart); `live-services`
    switched to it (G9); 16 real-Planner scenarios in `work-live.integration.test.ts`.
  - Only typecheck has run; no scenario has executed.
  - It was cancelled after pushing its handoff, because it was blocked on a permission prompt.

## Decisions and why

- **The contract changes are additive only.** F2 rebuilds the Work views against the existing store fields. B1 adds
  fields, outcomes and methods and never changes the meaning of existing ones. The contract lives in the assessment
  ("Store contract additions"). F2 was told it consumes them after merging the lane.
- **Offline queue:**
  - Creates are never queued: offline captures stay explicit HQ drafts (P-5).
  - A queued write answers `failed` / `unavailable` with `queued.queueId`, so old callers stay correct.
  - Writes are sent behind a three-way compare and swap, so a change made elsewhere is never silently overwritten.
  - An entry is saved as `sending` before its send, and after a restart a `sending` entry becomes unconfirmed. A write
    that may have landed is never re-sent automatically.
- **Durability goes through a core registry** (`registerWorkDurability(port, persistence)`). F2 owns
  `modules/work/nav/session.ts`, which therefore stays unchanged; the desktop registers persistence for the live port.
- **One device document per Planner address, with a binding token (G11).** Main resolves the Work address on every
  call. A session that loaded one address's document therefore cannot write into another's after a settings change.
- **HQR repairs are successors, not pushes to original refs.** Original PR refs are frozen. The composite keeps every
  original head as an ancestor, so each original PR can close as merged through it.
- **B1 took B5's Wiki-reference fix.** A Planner-only change would have made the CLI reject items carrying Wiki
  references.
- **Pause handling:** builders that did not answer within 10 minutes were cancelled. The lead pushed B1-T's unpushed
  composite branch and recorded the state of every builder here.

## Findings (beyond G1–G11 in the assessment)

1. **The host umask (0002) breaks the `tools/storage` tests:** they fail or hang. Lane B4 is fixing this separately.
   Run that command as `(umask 0022; timeout 600 node --test --test-concurrency=1 …)` and compare against plain
   foundation. A bare `node --test` in `tools/hq-cli` hangs on a helper file; use `npm test`.
2. **The catalog-host 500-entry test is load-sensitive** (5.1 s against a 5 s limit). Re-run it before treating it as a
   regression.
3. **The adapter's observed version only rises** (from B1-H). After a store swap, a new write's baseline sits above the
   new store's version, so its Check reports `store_changed` even though the write was sent after the swap. This needs
   a decision on the baseline rule.
4. **A Work store that is swapped to an older state is never adopted** (from B1-E, by reading only). `refresh()`
   ignores a snapshot with a lower `stateVersion`, so the board keeps items that no longer exist. Test it, then fix with
   the `store_changed` design.
5. **The B1-Q2 follow-ups:** the `before-quit` drain, and the directory-fsync answer.
6. **#85 and B1-W re-pin the same Work files.** The PR that lands second re-pins.
7. **`projection.json` records a stale spec hash** after B1-W's amendment of line 229.
8. **F2's flow assessment pauses writes while offline,** but the store queues them. F2 was asked to treat
   `queued` as "kept, not rolled back". There has been no reply yet.
9. **Shared enrollment is unavailable:** `.agents/shared-guidance.md` is absent. Local agreements were followed.

## What is left, in priority order

1. **Review and merge B1-Q1 into the lane.**
   - Read `store.ts` and `durability.ts` against the brief and the assessment.
   - Run `npm run typecheck` and `node_modules/.bin/vitest run --maxWorkers=4 modules/work`.
   - Confirm that core `WorkPersistence` and live `WorkLocalPersistence` match structurally.
2. **Wire durability in `apps/desktop/src/services/domains.tsx` `chooseWork()`,** then test it through
   `live-services.integration.test.tsx`. Call `registerWorkDurability` before `setWorkSessionPort`:
   ```ts
   const planner = createPlannerLive(bridgeTransport(services!.work));
   if (isWorkLocalBridge(services!.workLocal)) registerWorkDurability(planner.port, workLocalPersistence(services!.workLocal));
   setWorkSessionPort(planner.port, { example: false, recovery: planner.recovery });
   ```
3. **Finish B1-H** (its handoff items 1–5) and merge it. Expect small conflicts with B1-Q2 in
   `modules/work/live/adapter.ts`, `index.ts` and `adapter.test.ts`. Switch its health integration test to B1-E's
   helper.
4. **Run and finish B1-E** (its handoff items 1–4) and merge it. Then add phase 2 against the real Planner:
   - queued edits flushed after reconnect, with and without conflicts;
   - unconfirmed and queued writes surviving a simulated restart (two stores over one work-local directory);
   - the Settings health probe;
   - `store_changed`.
5. **Finish B1-T's checks.** Re-run them on `441009f` on an idle host: the acceptance/storage command under
   `umask 0022`, the catalog-host test, then the Planner, CLI and Work steps. Then:
   - open the composite PR against `work/hq-foundation`, with the merge order and the per-PR evidence above;
   - comment on each original HQR PR naming its successor;
   - open the #85 successor PR marked **HOLD**.
6. **Open B1-W's PR against `work/hq-foundation`,** send the link to lane B5, and note the re-pin overlap with #85.
7. **Finish the lane:**
   - update `services/README.md`, the assessment and adapter-boundary GW-2 to the final state;
   - get an independent Sonnet review of the lane diff, fix P0/P1 and record P2–P4;
   - mark #186 ready; link and watch every B1 PR, and unwatch at green;
   - tell F2 when the store code is on the lane.
8. **Get owner decisions:** G11 (pin the Work address per renderer load, or keep it live), finding 3 (baseline rule),
   finding 7 (`projection.json`), B1-H's decisions 1 and 4, and F2's offline write behaviour.

## Open questions and risks

- Until B1-Q1 is reviewed, the queue's correctness rests on the builder's unreported tests.
- **Merge conflicts:** expect conflicts at integration where B1-H and B1-Q2 both touch `adapter.ts`, and where
  `3b924cb` (#85) and B1-W both touch the Work pin files.
- **CI runtime:** the full root Vitest run, plus B1-E's 16 Planner starts, must stay inside the 6-minute CI job. That is
  unmeasured.
- **Merges are held:** the integration owner holds every merge. No B1 branch has been merged into `work/hq-foundation`.

## Exists only outside Git, or only in threads

- **Builder threads:** the full reports for B1-Q2, B1-W and B1-H are in the B1 lead thread. B1-T and B1-Q1 left no
  final report; their state above comes from Git and B1-T's scratch log.
- **Scratch on `/tmp` (tmpfs, lost on reboot):**
  - `/tmp/hq-b1-t-iUbAqZ/` holds B1-T's per-check logs; the summary is copied to `b1-planner/evidence/`.
  - `/tmp/hq-b1-briefs/` holds the original briefs, copied to `b1-planner/briefs/` with the home path shortened to `~`.
- **Local-only branches** to delete when convenient (dcg needs a person for branch deletion):
  - `verify/pr-{80,81,82,83,84,86,89,93,94,102}-20261103` in the composite worktree;
  - `tmp/hq-b1-w-merge-89` in the B1-W worktree.
- **Cross-lane messages:**
  - F2: store contract and offline-behaviour question; awaiting their alignment.
  - B5: B1 owns the Wiki-reference fix; the PR link is owed.
  - B4: #94 belongs to the B1 composite; host umask warning.
  - Each is summarized above.

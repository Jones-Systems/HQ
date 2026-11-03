# Work runtime evidence: the live Planner port

Authority effect: none. This is lane-local continuity and evidence for the Work runtime builder: the live Planner port, replay-safe recovery and production Planner selection. Checks listed here are local runs, not CI. Nothing here proves a real bridge, service, Electron or persistence; see [What remains unverified](#what-remains-unverified).

## Binding

| Item | Value |
| --- | --- |
| Lane | Work runtime builder, successor to the accepted Social+Work assembly. Claude Opus 5.5 (`claude-opus-5-5`), high effort, fast mode off, no descendants |
| Repository | `Jones-Systems/HQ` (checked as `origin` before any write) |
| Worktree and branch | `/home/malcolmjones/.t3/worktrees/HQ/t3-6668c4c0`, `t3/work-live-planner-runtime`; sole Git owner |
| Start HEAD | `562986d1852d7b4ef101ff6d4c9340c3751c727a`, status clean at start |
| PR base | `t3/social-work-domain-assembly` at `562986d1852d7b4ef101ff6d4c9340c3751c727a` (read with `git ls-remote` before the push; no fetch) |
| Contract source | `services/planner/contract/` at `523104b` (identical blobs at `67594ade`), read as local Git objects only |

**Guidance.** HQ `AGENTS.md` and `CLAUDE.md` were followed. `.agents/shared-guidance.md` is absent on this base, so shared enrollment is **unavailable**; nothing was installed.

**Network.** No fetch. The only network write is this branch's own fast-forward push, plus opening its PR.

## Writer cone

The original cone:

- `modules/work/live/**`
- `modules/work/core/port.ts`, `store.ts`, `fixtures/adapter.ts`, `fixtures/faults.ts`, `index.ts`
- `modules/work/core/test/conformance.test.ts`, `port-conformance.ts`, `store.test.ts`, `hook.test.tsx`
- `modules/work/nav/session.ts` and the new `modules/work/nav/test/live-selection.test.tsx`
- `docs/evidence/hq-social-work/work-runtime/**`

`fixtures/faults.ts` was not changed.

### Custody extension (recorded exactly)

The extension added exactly two board paths:

- `modules/work/board/SyncStatus.tsx`;
- **only** the recovery-control assertions in `modules/work/board/test/board.test.tsx`, or a new `modules/work/board/test/recovery.test.tsx`.

It allowed no other board changes, no CSS and no scope expansion. It kept the separation between Check (lookup) and an explicit Apply (resend), with no new generic execution surface. If the existing retry action remains as the explicit Apply, it must be clearly labelled and enabled only by a safe lookup result. An indeterminate result or a missing baseline must stay held, asking for a read-back. A minimal conditional recovery-state field in the owned core store is allowed.

**How it was used:**

- `SyncStatus.tsx` now:
  - maps Check to lookup;
  - shows `Apply: save it now` only when `store.canApply(id)`, which is true only after a lookup answered `not_applied`;
  - shows reason-specific held copy for an indeterminate result.
- In `board.test.tsx`, only the existing "Check now" test was changed, to the new recovery assertions. Every other assertion is unchanged.
- The new `recovery.test.tsx` covers four cases:
  - Check confirms by lookup;
  - Apply appears only after `not_applied` and saves once;
  - an indeterminate result offers no Apply;
  - the retired re-send wording never appears.

## What was built

All paths are under `modules/work/`.

| Path | What it does |
| --- | --- |
| `live/transport.ts` | The narrow structural transport, `PlannerTransport.call(route, params)`, with the closed route list: `state`, `version`, `item`, `history`, `create`, `patch`, `move`, `archive`, `restore`, `reviewed`, `settings`, plus `replay`. Calls carry typed params, and the main process owns encoding. `ServiceResponse` is `{ok:true, status, body, replayed}` for any received HTTP response, and `{ok:false, kind:'unavailable'\|'unknown'}` for transport failure only. `bridgeTransport` turns a thrown or malformed bridge answer into `unknown`. |
| `live/wire.ts` | Fail-closed decoders for every route. Canonical, key-ordered params; derived date fields are stripped. HQ references are gated on `hq-references-v1` through the unchanged `parseReference`. |
| `live/adapter.ts` | `createPlannerLive(transport)` returns `{port, recovery, ledger}`. The aliases `createPlannerLivePort` and `createLivePlanner` refer to it. It covers native name mapping, the error mapping, the replay ledger, move read-back and the recovery sidecar. |
| `core/port.ts` | Adds `WriteResult.stale`, the `replay_indeterminate` recovery error with its reasons (`no_intent`, `no_baseline`, `evicted`, `unsupported`), and the `PlannerRecovery` sidecar (`check`, `apply`, `release`). It also adds `REPLAY_FEATURE = 'requests.replay'`. `PlannerError` is unchanged, so views and board actions keep compiling exhaustively. |
| `core/store.ts` | Removes the automatic replay in `poll()`. Adds the conditional `recovery` field on unconfirmed entries (`not_applied` or `indeterminate` with a reason), `checkUnconfirmed`, `canApply` and `refreshDue`. Apply (`retryUnconfirmed`) is refused unless a lookup proved `not_applied`. |
| `core/fixtures/adapter.ts` | Gives the fixture Planner the service's replay route: an eviction floor, request fingerprints, and `control.replay(...)`. |
| `nav/session.ts` | Production selection, described below. |

**Error mapping.**

- `state_version` maps to `stateVersion`, `server_time` to `observedAt`, and `features` defaults to `[]`. The `X-Replayed` header maps to `replayed`.
- 400 is `invalid`, with field errors mapped from `errors`.
- 409 is a revision or order conflict.
- 422 `request_id_reused` is a stable defect.
- 404 is `not_found`.
- 403 and 421 have no effect.
- For a write, a 5xx, a redirect, a lost answer or a malformed answer is `unknown`, keeping its requestId.
- For a read, any non-2xx other than 404 is `unavailable`.

## Replay safety

- **Before the first send.** The adapter records a deep-frozen typed intent and its `sentAfterVersion` baseline. The baseline is the last observed version, or a version read made first. Without a baseline nothing is sent.
- **Refused locally:**
  - a malformed entity ID (`^[A-Za-z0-9_-]{6,40}$`) or request ID (`^[A-Za-z0-9-]{8,64}$`);
  - a reused request ID with a different body.
- **No automatic retry.** An `unknown` write stays unresolved until an explicit Check (lookup), or an explicit Apply (resend) after a lookup proved `not_applied`. The adapter itself enforces this; see [Explicit Apply authorization](#explicit-apply-authorization).
- **Lost recovery answers.** A lookup whose answer is lost is `unavailable`; a resend whose answer is lost is `unknown`.
- **The baseline never moves.** `sentAfterVersion` is never raised after the fact, and the recorded intent is never mutated; both are proved in `live/test/adapter.test.ts`.
- **No guessing by title.** A found record is never matched to an intent by its title.
- **Sending nothing.** Without the `requests.replay` feature, a recorded intent or a baseline, recovery sends nothing and reports `replay_indeterminate` (`unsupported`, `no_intent` or `no_baseline`).
- **Bounded ledger.** At most 200 unresolved and 2000 settled intents. Unresolved intents are never forgotten: at capacity a new write is refused locally. Evicted settled IDs move to a retired set, so a reuse fails closed instead of sending a duplicate. The retired set holds IDs only.
- **Two fixture semantics.** The fixture tests separate the backend's ordinary duplicate-on-eviction (`service` conformance semantics) from the replay-aware port's `replay_indeterminate` (`replay-aware` semantics). Both run one conformance suite, `core/test/port-conformance.ts`.

### Design's settled contract

Design's settled contract replaced the earlier `bodyJson` proposal. This lane follows it:

1. **Typed calls.** Calls are `WorkMutationCall = {route, params}` with an ID and a requestId. The main process is the sole encoder.
2. **The replay route.** Replay is `{mode, requestId, original, sentAfterVersion?}`, with no `X-Request-Id` header.
3. **Check and Apply.** Check is lookup only; a separate explicit Apply may resend. There is no automatic replay. Every replay is gated on `requests.replay`.
4. **Validation.** Entity and request ID patterns are validated as above. There is no batch route.
5. **Golden mapping.** Exchanges 19 and 23 are pinned. A test proves that neither the intent nor the baseline is mutated. Recovery is a sidecar interface.

The encoder in `live/test/support.ts` is the reference encoding: the transcript tests prove that it reproduces the recorded bytes. It is not the production encoder, which the main process owns.

## Production selection

`nav/session.ts` decides the Planner as follows:

- **Bridge present** (`window.hqServices.work`): the live Planner, chosen once.
- **Bridge absent:** the labelled fictional example.
- **Unconfigured, unreachable or answering 503:** the live Planner shows "Planner service unreachable", and never falls back to the example.
- **The seam:** `setWorkSessionPort` stays ahead of the bridge, so tests and the shell can override the choice.

Records live in the service. UI state stays in memory and is labelled.

## Contract copies and integrity

`live/test/contract/` holds byte-identical copies of `exchanges/01–27.json`, `reference-vectors.json` and `SHA256SUMS` from `523104b`. Every blob was checked identical at `67594ade`, and `sha256sum -c` passed. `PROVENANCE.md` there lists each blob and size.

`contract.test.ts` checks:

- the SHA-256 of `SHA256SUMS`: `dafe2da70363b4db60b9bc5d5466a6c77097369f896fbbb7c1ac56f1c5c7733b`;
- every file's SHA-256, Git blob and size;
- the shared reference vectors against `normalizeFields`.

**Upstream drift.** `services/planner/contract/` is absent in this checkout, so the drift check reports **unavailable** and is skipped, not passed. If that directory is present, the test fails on any byte drift.

`transcript.test.ts` is a strict transcript. It checks each call's route, method, path, exact body bytes and request-ID header, and each recorded status, body and `X-Replayed` answer, covering:

- exchanges 01–14, 17, 19–26;
- that batch, import and export routes are unreachable.

## Checks

All checks ran serially in this worktree. Each run started after a fresh reading from the Linux telemetry skill (`collect_work_capacity.py --format admission`), and every reading was below the 85% CPU admission line. `npm ci` left the lockfile unchanged.

| Time (local) | CPU before the run | Check | Result |
| --- | --- | --- | --- |
| 09:45:06 | 31.95% | `npx vitest run` (full suite) | 52 files; 930 passed, 1 skipped (the upstream drift check, `unavailable`) |
| 09:45:21 | 31.56% | `npx vitest run modules/work` | 28 files; 573 passed, 1 skipped (the same check) |
| 09:45:29 | 31.23% | `npm run typecheck` | exit 0 |
| 09:45:33 | 28.89% | `npm run build` | exit 0 (the existing chunk-size warning only) |

These are the runs for PR #51 at `bb42ee9` on 2026-10-20. About 39 GiB of RAM was available for each; one fully used core is 6.25% of capacity, and the serial test ceiling was 1.

**Canonical alignment successor, final candidate (2026-10-20):**

| Time (local) | CPU before the run | Check | Result |
| --- | --- | --- | --- |
| 09:53:29 | 29.32% | `npx vitest run` (full suite) | 53 files; 932 passed, 1 skipped (the upstream drift check, `unavailable`) |
| 09:53:38 | 17.81% | `npx vitest run modules/work` | 29 files; 575 passed, 1 skipped (the same check) |
| 09:53:42 | 8.15% | `npm run typecheck` (includes `canonical-shape.test.ts`) | exit 0 |
| 09:53:44 | 11.63% | `npm run build` | exit 0 (the existing chunk-size warning only) |

About 40–41 GiB of RAM was available for each run.

**Explicit Apply authorization successor, final candidate (2026-10-20).** These ran once, deduplicated: the full suite includes the Work tests.

| Time (local) | CPU before the run | Check | Result |
| --- | --- | --- | --- |
| 09:59:37 | 29.56% | `npx vitest run` (full suite) | 53 files; 938 passed, 1 skipped (the upstream drift check, `unavailable`) |
| 09:59:46 | 24.69% | `npm run typecheck` | exit 0 |
| 09:59:48 | 41.72% | `npm run build` | exit 0 (the existing chunk-size warning only) |

While iterating, `npx vitest run modules/work/live` gave 4 files: 168 passed, 1 skipped (09:59:11, CPU 21.84%). The five new regressions were also run against the previous adapter from `ecd5486`, at 09:59:19 (CPU 18.93%). All five failed there.

## Dispositions

- **No second task store.** The live port feeds the existing `createWorkStore`.
- **`replay_indeterminate` stays outside `PlannerError`.** `plannerErrorOf` maps it to `unknown` for existing consumers; recovery callers see the precise reason.
- **Readback failures keep the confirmation.** A confirmed write whose move read-back fails keeps that confirmation. It returns `{changed:[item], stale:true}`, and the store sets `refreshDue` and refreshes.
- **Typed params now mirror the frozen shared boundary.** In PR #51 at `bb42ee9` they were a local proposal: `move` carried a nested `anchor` object, and fields, patches and settings used Work's domain types. The successor commit aligns them; see [Canonical boundary alignment](#canonical-boundary-alignment).

## Canonical boundary alignment

Design froze the shared `packages/contracts/src/services.ts` at local commit `dccb4987b83ef77ffbd714bd2d58c3801e664fc7` (parent `db71081`, blob `d55672ef20a3f763c52c257b350a86bbc0cdcfd8`). It was read as a Git object only. Nothing was merged, copied or republished, and no shared file was written.

It showed a concrete incompatibility in this lane's transport: `move` was `{…, status: Status, anchor: Anchor}`. The canonical shape is `{requestId, id, revision, status: string, after_id?, before_id?, place?: 'top'|'bottom'}`, with flat anchor fields.

**What changed:**

- **`live/transport.ts`** mirrors the canonical boundary exactly:
  - `WorkServiceParams`, `WorkMutationCall`, `WorkServiceTransport`, `ServiceResponse<B>` (with `replayed` required), `WorkServiceRoute`, `WorkMutationRoute` and `WORK_SERVICE_ROUTES`, with the same `readonly` modifiers;
  - `fields`, `patch` and `settings` cross as `Readonly<Record<string, unknown>>`;
  - the earlier local names remain as aliases.
- **`live/adapter.ts`:**
  - the move builder sends the flat anchor fields;
  - domain typing and validation stay inside the adapter, which hands the bridge plain records.

  So the normal call, the immutable ledger `original.params` and the replay `original` all carry the canonical shape.
- **`live/test/support.ts`:**
  - the reference encoder reads the flat fields;
  - the fixture transport translates a flat move back into the fixture Planner's own call record.
- **`live/test/adapter.test.ts`** has a new test, covering all three anchor kinds:
  - the move is sent flat;
  - the lost move's frozen intent and its replay original are the same flat params, encoded to `{"revision":N,"status":"active","place":"top"}`.
- **`live/test/canonical-shape.test.ts`** is new. It is a synthetic compile-time binding of every route's params, the mutation call, the response and the transport call to the canonical shape. It is stated independently, not copied, and `npm run typecheck` fails on drift.

**Unchanged:**

- no automatic resend;
- Check as lookup, and Apply as an explicit resend only after `not_applied`;
- the original baseline;
- the recorded byte identity, since transcript exchanges 09 and 10 still pass byte for byte.

**Out-of-repo check.** In a temporary directory outside the repository (since deleted), the local types were compared with the frozen object. The comparison covered every route's params, `WorkMutationCall`, `ServiceResponse` and `ServiceResponse<string>`, both route unions, `WorkServiceTransport` and `WORK_SERVICE_ROUTES`. All were mutually identical. A negative control confirmed that the old nested-anchor shape is rejected.

Identity with the shared file itself, on the combined base, remains integration work.

## Explicit Apply authorization

This closes a replay-contract gap that remained at `ecd5486`. It is part of the settled boundary: a separate explicit Apply, and no ordinary resubmit of an unknown write. It is not a severity-based repair.

At `ecd5486` there were two holes:

- In `live/adapter.ts`, `write()` answered a repeated ordinary port call for an already recorded intent with `replay('resend')`.
- `recovery.apply` resent with no proof, held by the adapter, of a prior `not_applied` Check. Only the store's own UI path guarded this.

**Now:**

- **A repeated ordinary call never sends a mutation.** The same intent under the same request ID sends nothing while unresolved, and fails as `unknown` (held) with its requestId. Once settled, it is answered by a read-only lookup of the recorded response. A different body under that ID is still `request_id_reused`, refused locally.
- **Apply needs this adapter's own Check.** Each unresolved ledger entry carries `applyAuthorized`. Only this adapter's own lookup answering `not_applied` sets it. Every lookup clears it before sending, and every resend consumes it before sending. So:
  - an Apply with no such Check sends nothing and fails as `unknown`;
  - an uncertain Apply (lost or malformed answer) needs a new `not_applied` Check before another Apply;
  - a failed, unavailable or indeterminate Check withdraws the authorization;
  - an Apply on a settled intent is a read-only lookup, never a second resend.
- **Unchanged:**
  - the feature gate, the recorded intent and baseline, the request-ID rules and the eviction proof;
  - the service still rechecks every replay against its own record, and stays authoritative;
  - the store is unchanged: it already returns an `unknown` Apply to Unconfirmed, needing a new Check.

**Regressions.** They are in `live/test/adapter.test.ts`, under "explicit Apply needs this adapter's own not_applied Check". Each one failed against the `ecd5486` adapter:

1. A dropped create, repeated as the same ordinary call, makes zero extra transport calls.
2. A direct Apply before any Check sends nothing.
3. A `not_applied` Check, then an explicit Apply, saves the write once. Repeating it by Apply or by the ordinary call gives read-only lookups.
4. An uncertain Apply needs a new Check before any further Apply.
5. A failed or indeterminate Check after `not_applied` withdraws the authorization.

**Other updated tests:**

- Four existing tests now take a Check before their Apply, or expect no send: the "dropped write", "evicted", "lost recovery answers" and "refused resend" cases.
- The transcript's 20–22 case now shows that no Apply is sent before the Check, and that a repeat after `applied_now` is a lookup.
- A new transcript case maps golden exchange 22 to an authorized Apply that the service answers as already applied. Its request bytes are still checked strictly.

## Deferred findings (out of cone, original severity)

- **Medium, `modules/work/views/PlanningViews.tsx`.**
  - `UNKNOWN_TEXT` says the write "will be checked by re-sending the same request", which is no longer true.
  - Its "Re-send same request" button shows for every `awaiting_decision` entry. The store now refuses that action unless a lookup proved `not_applied`, so it is safe but mislabelled.
  - Minimal fix, for the views owner: correct the copy, and gate the button on `store.canApply`.
- **Low, board and views.** No "Not connected" settings action exists; Design owns it.
- **Low, shared contract.** The local transport now mirrors the frozen `services.ts` at `dccb498`, as checked out of repo and bound in `canonical-shape.test.ts`. Identity on the combined base is still integration work.
- **Low, adapter.** The retired-ID set grows for the life of the session. It holds IDs only.

## What remains unverified

- A real `window.hqServices.work` bridge, the Electron main-process encoder, and a running Planner service.
- Persistence across restarts.
- Byte drift against an upstream `services/planner/contract/` in a checkout that has it.

All of the evidence here is unit tests and component tests against synthetic fixtures.

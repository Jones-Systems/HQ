# Engineering Spec — Jones Code client launch (U1)

<!-- codex-section:begin id="spec.jones-client-launch#ctx.artifact-header.001" -->
Artifact Type: `engineering-spec`

Artifact ID: `spec.jones-client-launch`

Purpose: One source task in Jones-Systems/Jones-Code. It adds an idempotent, client-callable thread launch with an authoritative lookup and a no-effect fence, so HQ can later offer new-thread handoffs.

Governing artifact: `spec.hq-integration-parallel-execution`

Specification owner: HQ integration root (T1)

Integration owner: HQ integration root (T1), as the coordinator of the Jones Code source PR

Consumers: Jones Code source builder; compiler; verifier; HQ Design connector and T2 (follow-on seam only)

Authority effect: none
<!-- codex-section:end id="spec.jones-client-launch#ctx.artifact-header.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ctx.project-summary.001" -->
## Project Summary

**Outcome:** Jones Code `t3_thread_launch` accepts an optional `clientRequestId`. With it, launch is exactly-once by key and canonical request. Two new tools follow a lost response: `t3_thread_launch_lookup` (read-only) and `t3_thread_launch_fence` (turns "absent" into an authoritative no-effect). Unkeyed launch is unchanged.

**Cross-repository binding.** This plan is published in HQ at `docs/engineering-specs/jones-client-launch.md` because Jones Code's rules keep plans and research notes out of that repository.

- Its single task **targets Jones-Systems/Jones-Code**. Every path in the task's read and write scopes, target hints and check commands is relative to the Jones Code repository root at the base below, **not** to HQ.
- There is no plan file inside Jones Code, and none should be created.
- Compiling this plan in HQ proves only plan readiness. It does not prove Jones Code behaviour, an installed build, or native adoption.

**Finish line:** a merged Jones Code PR with green checks and direct readback of the merge. Installation and native consent are separate gates, outside this task (`#ctx.gates-and-hq-seam.001`).

**Base:** `https://github.com/Jones-Systems/Jones-Code` at `main` = `fa7c6c013811db33d128422027697dbaa1517b60`, or a successor read back at launch.
<!-- codex-section:end id="spec.jones-client-launch#ctx.project-summary.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#req.idempotent-launch.001" -->
## Idempotent Launch Requirement

A client caller — an OAuth MCP client without a T3 thread — or a thread caller can launch a top-level thread with a `clientRequestId`:

- The same key and the same canonical request produce one thread, one initial message and at most one live preparation, however often the call is retried.
- The same key with a different canonical request is `request_conflict`, and that call has no effect.
- Unkeyed launch behaves exactly as before.
<!-- codex-section:end id="spec.jones-client-launch#req.idempotent-launch.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#req.effect-truth.001" -->
## Effect Truth Requirement

After a lost or unknown response, a caller can learn the truth by key:

- `launched`, with the thread, the bound run and the true initial-message and preparation states;
- `no_effect`, authoritatively, from a rejection or a fence;
- `absent`, which is never treated as proof.

A partly run preparation is reported as `unknown_effect` and is never rescheduled automatically. A replay never widens the caller's current authority.
<!-- codex-section:end id="spec.jones-client-launch#req.effect-truth.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#req.repository-boundary.001" -->
## Repository Boundary Requirement

The change follows the current Jones Code rules:

- Jones logic and tests live in Jones-owned modules, behind small typed hooks in upstream files.
- Persistence uses one `jones_`-prefixed table, created by the next free Jones migration, with no foreign key to upstream tables.
- The boundary inventory is updated, and `check-boundary.ts --strict` passes.
- Upstream test behavior and assertions stay unchanged; only the four declared fixture updates in W21 are permitted. The two McpToolAccess test files remain unedited and pass.
- No new event or command type, no upstream schema change, and no new Layer construction. The W22 `ws.ts` export re-exports the existing Layer value with a checked type and constructs nothing (`#ctx.change-surface.001`).
<!-- codex-section:end id="spec.jones-client-launch#req.repository-boundary.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ac.source-candidate.001" -->
## Source Candidate Acceptance

At one exact head of the task branch:

- Acceptance cases T1–T16 (`#ctx.test-plan.001`) pass.
- The final focused union in `#ctx.test-plan.001` passes, including lint, the two package typechecks and `check-boundary.ts --strict`.
- The diff touches only the 27 paths of the writer cone (`#ctx.change-surface.001`).

Any skipped or unavailable check is reported as such, never as a pass.
<!-- codex-section:end id="spec.jones-client-launch#ac.source-candidate.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ac.source-delivery.001" -->
## Source Delivery Acceptance

- One non-draft PR against Jones Code `main`, with green required checks at its exact head.
- Merged with a merge commit under the Jones Code standing delivery contract.
- Read back directly: merge commit, PR state, and ancestry of the accepted head.

No PR review bots, force pushes, rebases or squashes.
<!-- codex-section:end id="spec.jones-client-launch#ac.source-delivery.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ctx.source-binding.001" -->
## Source Binding And Diff Implications

| Item | Exact value |
| --- | --- |
| Target repository | `https://github.com/Jones-Systems/Jones-Code` |
| Base | `main` = `fa7c6c013811db33d128422027697dbaa1517b60` (merge of #417) |
| Earlier framing | `76fb3dc2bfc4d05b6681ec93de7abab18fb79356`, an ancestor 21 commits behind the base; historical only |
| Open PRs at binding | #404 (CI precheck) and #394 (update recovery); neither touches a path or migration ID in this cone |

| Path at base | Change since earlier framing | Implication |
| --- | --- | --- |
| `apps/server/src/orchestration-v2/ThreadLaunchService.ts` | +36/−6: app-owned delegated-child setup (`observeExistingSetup`, `isAppOwnedDelegatedChild`) | Replay and reservation logic unchanged; lines moved. `scheduledLaunches` 306, `reservePreparation` 2012, `releasePreparation` 2024, launch receipt 2345, `:initial-message` 2461, `runIsPreparing` 2523, `shouldSchedule` 2600, `ownsPreparation` 2613, progress receipts 1352/1601/2584. |
| `apps/server/src/orchestration-v2/Orchestrator.ts` | +231/−21 (queued-steer batch and others) | Receipt semantics unchanged. Rejected-receipt replay 12553; mode-limit rethrow 12792; `commitRejectedCommand` 12796; committed rejection raises `PreviouslyRejected` at 12907. |
| `apps/server/src/mcp/toolkits/project/tools.ts` | `t3_thread_launch` description text | The hook applies to the new text. Tool 104, success 134, toolkit 154. |
| `packages/contracts/src/orchestratorMcp.ts` | `DelegatedTaskWorkspaceFields`; send mode `separate_turn` | `OrchestratorMcpClientRequestId` at 48 (unexported); failure enum 651–670. |
| `apps/server/src/mcp/OrchestratorMcpService.ts` | Jones `DelegatedTaskWorkspace` hook | Not on this path. It is the precedent for hook style: a module under `apps/server/src/jones/mcp/<feature>/`, called with `// Jones hook:` comments and explicit dependencies. |
| `scripts/jones/boundary/**` | Active churn from #409–#417 | Expect conflicts. See `#ctx.stop-recovery-delivery.001`. |
| Unchanged | `mcp/toolkits/project/handlers.ts`, `mcp/McpToolAccess.ts`, `mcp/threadAccess.ts`, `mcp/McpHttpServer.ts`, `orchestration-v2/EventSink.ts`, `CommandReceiptStore.ts`, `runtimeLayer.ts`, `apps/server/src/auth/**`, `apps/server/src/jones/persistence/**`, the MCP server doc, `AGENTS.md`, contributor and development guidance | Their cited lines still hold: `EventSink.ts:1684` `insertIfAbsent`; `threadAccess.ts:52–60` `readCaller`; `McpToolAccess.ts:75–193`; `project/handlers.ts:58/60/175`. |

Facts at the base:

- **Migration ID.** The highest Jones migration is `111`; IDs 7–99 are reserved for foreign histories, so **`112` is free**. `JonesTablePresence.ts` has no table enum.
- **Services.** `CommandReceiptStoreV2`, `EventSinkV2` and `SqlClient` are already in the server context (`runtimeLayer.layer` and `layerProduction`). The project toolkit registers from that context (`McpHttpServer.ts:809`), so only the tools' `dependencies` arrays change.
- **Boundary classes.** `project/handlers.ts` is pristine upstream, so editing it creates a new `hook` inventory entry. `project/tools.ts`, `ThreadLaunchService.ts` and `orchestratorMcp.ts` are already `accepted-shared`; `packages/contracts/src/index.ts` is a `hook`.
- **`ws.ts`.** `apps/server/src/ws.ts` is a `hook` in the inventory, declared in the `runtime-stop` fragment's `hookPaths`. Its bytes are unchanged from the base through the head bound for the W22 repair: SHA-256 `ddd1cd32b676824ba986c8fd56111f6f517385951b471d36f2ddd7664757cd38`, 3,409 lines. Of the W22 type-import targets, `environment/NativeStoreAuthority.ts` is `jones-owned`; the others are upstream or `accepted-shared`.
<!-- codex-section:end id="spec.jones-client-launch#ctx.source-binding.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ctx.target-rules.001" -->
## Target Repository Rules

From Jones Code `AGENTS.md` and `docs/operations/{contributor-guidance,development}.md` at the base:

- **Discipline.** A dedicated non-main branch in an isolated linked worktree with one Git owner. Stop on unowned changes. Focused checks only. Never commit plans or notes. No PR review bots. A source change does not update an installed app.
- **Extraction.** Server code in `apps/server/src/jones/`, wire schemas in `packages/contracts/src/jones/`, and Jones tests beside Jones code. Upstream files get small typed hooks only.
- **Boundary accounting.** A fragment plus `inventory.json`, `features.json` and `checks.json`; then `node scripts/jones/check-boundary.ts --strict`, without weakening its checks.
- **Database boundary.**
  - `jones_` names, created only through the Jones loader;
  - no foreign keys to upstream tables, no upstream payload fields, no scans on upstream per-command paths;
  - released migrations are never renumbered or deleted;
  - update checks block a candidate older than its database.
- **Toolchain.** Node `^24.13.1`; `pnpm@11.10.0` through `vp`; Bun optional. `vp i` is an ordinary dependency install inside the task worktree.
- **Checks.** `vp test run <files>`, `vp lint <files>`, `vp run --filter <package> typecheck` (tsc-rs). Tests run in Node with `@effect/vitest`. Never `vp check`, `vp run -r test` or `vp run -r typecheck`.
- **Async testing.** Use typed receipts and worker drains, never sleeps.
<!-- codex-section:end id="spec.jones-client-launch#ctx.target-rules.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#iface.mcp-tools.001" -->
## Closed MCP Interface

All changes are additive; unkeyed `t3_thread_launch` is unchanged.

### `t3_thread_launch` (existing; moves to `McpToolAccess.startsOrContinuesThreads`, `#iface.access-hook.001`)

- **Input** adds `clientRequestId?: OrchestratorMcpClientRequestId` (trimmed, 1..256).
- **When keyed**, these return `invalid_request` with no effect:
  - `scratch` set;
  - a non-empty `attachments`;
  - a client caller without `projectId`;
  - `workspaceStrategy.type === "worktree"` without a non-empty `message`.
- **Success** adds optional `replayed: boolean`, `requestDigest: Sha256Hex`, `initialMessage: InitialMessageState`, `preparation: PreparationState`.
- **Description:** a keyed identical retry replays; a different request is `request_conflict`; use lookup or fence after a lost response. "No retry key" now applies only without `clientRequestId`.

### `t3_thread_launch_lookup` (new; `McpToolAccess.reads`, `Tool.Readonly`)

Input `{ clientRequestId }`; success `ClientLaunchLookup`:

```ts
{
  clientRequestId: string,
  state: "launched" | "no_effect" | "absent",
  basis: "receipt" | "fence" | "rejection" | "none",
  threadId: ThreadId | null,
  requestDigest: Sha256Hex | null,
  claimed: boolean,
  threadDeleted: boolean,
  initialMessage: InitialMessageState,
  runId: RunId | null,
  runStatus: OrchestrationV2RunStatus | null,
  preparation: PreparationState,
  workspace: { type, branch, worktreePath } | null,
  reason: string | null
}
```

The state enums:

```ts
InitialMessageState = "not_requested" | "accepted" | "rejected" | "pending" | "unknown"
PreparationState    = "not_applicable" | "left_preparation" | "in_progress" | "unscheduled" | "unknown_effect"
```

### `t3_thread_launch_fence` (new; `McpToolAccess.writesWithCapability`)

Input `{ clientRequestId }`. Success is `ClientLaunchLookup` with `state` in `{"launched", "no_effect"}`.

### Failure codes

Add `"request_conflict"` and `"launch_fenced"` to `OrchestratorMcpFailure.code`. Fallback if adding literals is refused: `invalid_request` with the stable prefixes `request_conflict:` and `launch_fenced:`.

### Schema location

- New schemas go in `packages/contracts/src/jones/clientLaunch.ts`, exported by one `export *` line in `packages/contracts/src/index.ts`.
- `orchestratorMcp.ts` changes only by exporting `OrchestratorMcpClientRequestId` and adding the two literals.
- Tool definitions stay in `project/tools.ts`.
<!-- codex-section:end id="spec.jones-client-launch#iface.mcp-tools.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#iface.identity-claim.001" -->
## Identity, Canonical Request And Claim Table

**IDs.** `h = sha256hex("jones-mcp-launch\0v1\0" + scope.requestNamespace + "\0" + clientRequestId)`. Then:

- `commandId = "mcp-launch:v1:" + h`;
- `threadId = ThreadId.make(commandId)`;
- `messageId = MessageId.make(commandId)`;
- the initial message uses `${commandId}:initial-message`, assigned by `ThreadLaunchService`.

No raw namespace or session text appears in any ID or output.

**Canonical request** (v1; RFC 8785 JCS; `requestDigest = sha256hex`):

```text
{v:1, op:"thread-launch", projectId:<resolved>, title:<trimmed>,
 modelSelection|null, runtimeMode|null, interactionMode|null,          // as requested
 workspaceStrategy: {type:"root"}
                  | {type:"worktree",baseRef|null,branch|null,startFromOrigin:bool}
                  | {type:"existing_worktree",worktreePath,branch|null},
 message|null}
```

Defaults are excluded. Reuse an existing exported JCS helper if one exists; otherwise implement RFC 8785 in `ClientLaunchIdentity.ts`, with golden vectors.

**Migration `112_JonesClientLaunchRequests.ts`**, registered as `[112, "ClientLaunchRequests", JonesMigration0112]`:

```sql
CREATE TABLE jones_mcp_client_launch_requests (
  command_id        TEXT PRIMARY KEY NOT NULL,
  thread_id         TEXT NOT NULL,
  request_digest    TEXT NOT NULL,
  request_version   INTEGER NOT NULL,
  message_requested INTEGER NOT NULL CHECK (message_requested IN (0, 1)),
  recorded_at       TEXT NOT NULL
);
-- jones_mcp_client_launch_requests_no_update / _no_delete / _no_replace triggers
```

How this fits the database boundary:

- Rows are keyed by the upstream launch command ID, with no foreign key.
- A claim is written only by a keyed launch, in its own transaction, after reading that no receipt exists, and before dispatch.
- A missing receipt is read as absent.
- The fence writes an upstream receipt only through `EventSinkV2.commitRejectedCommand`, never through Jones SQL.
- The only queries are primary-key lookups on the three new paths.
<!-- codex-section:end id="spec.jones-client-launch#iface.identity-claim.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#iface.access-hook.001" -->
## Access Hook In McpToolAccess

**Why the existing API cannot compose the semantics.** These facts are from `apps/server/src/mcp/McpToolAccess.ts` at the base:

- **Wrappers run first and are sealed.** A tool's handler can be built only through the module's private `declare` (34–73). A `Declaration` hides its handler, so a handler cannot run code before its wrapper, and other code cannot wrap a declaration.
- **`startsThreads` (174–194) runs, in order:**
  1. `writingCaller` (89–92): `refuseReadOnlyClient`, `loadCaller`, `assertLiveCaller`, with no `orchestration` check;
  2. `resolveRuntimeMode` and `resolveInteractionMode` on the requested modes;
  3. only then the handler.

  A keyed handler therefore cannot run `readCaller()` before mode resolution, as `#iface.semantics.001` requires. A credential without `orchestration` that also asks for broader modes would get `*_escalation_denied` instead of `capability_denied` (T14).
- **No guard for continuing.** `startsThreads` provides no `DispatchModeLimit` and no refusal mapping. The guard exists only inside `writesThreads` (127–158), whose `escalationDenied` (160–167) is private. `writesThreads` needs target thread IDs before the handler runs. A keyed launch learns that it is continuing an existing thread only after its receipt read, so `writesThreads` cannot be used either.
- **Rejected workaround.** Passing `{}` as the `startsThreads` mode selector for keyed calls, and redoing resolution and the guard in Jones code, would move a write tool's mode check out of the module that declares tool access. It is not used.

**The hook.** This is one additive export, marked `// Jones hook: spec.jones-client-launch`. It is the only change to the file.

```ts
export interface ThreadStartGate {
  /** startsThreads' mode resolution (its lines 184–191), deferred to the handler. */
  readonly start: Effect.Effect<StartedModes, OrchestratorMcpFailure>;
  /** writesThreads' target check and dispatch guard, for continuing an existing launch. */
  readonly continueWithin: <A, E, R>(
    target: { readonly runtimeMode: RuntimeMode; readonly interactionMode: ProviderInteractionMode },
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | OrchestratorMcpFailure, R>;
}

export const startsOrContinuesThreads = <P, A, E, R>(
  modes: (params: P) => {
    readonly runtimeMode?: RuntimeMode | undefined;
    readonly interactionMode?: ProviderInteractionMode | undefined;
  },
  handle: (params: P, gate: ThreadStartGate) => Effect.Effect<A, E, R>,
) => declare(/* params => writingCaller, then handle(params, gate built from caller.limits) */);
```

**Rules for the hook:**

- **Wrapper.** It runs `writingCaller` exactly as `startsThreads` does, then calls the handler with a gate built from that caller's `limits`.
- **`start`.** It runs the same `resolveRuntimeMode`/`resolveInteractionMode` sequence on `modes(params)` as `startsThreads` lines 184–191.
- **`continueWithin`.** It runs `assertTargetWithinLimits(limits, target)`, then the effect under `Effect.provideService(DispatchModeLimit, { ...limits, refused })`. A recorded refusal is mapped through the existing private `escalationDenied`, the same sequence as `writesThreads` lines 140–156.
- **Unchanged.** `startsThreads` (also used by `schedule_task`), `writesThreads`, every other builder, `Declaration`, `HandlersLayer` and `toLayer` stay as they are. There is no new Layer, no other export, and no access bypass.
- **One user.** Only `t3_thread_launch` in `project/handlers.ts` moves from `startsThreads` to `startsOrContinuesThreads`, keeping its selector `(input) => input`.
  - The unkeyed branch yields `gate.start` before anything else, then runs today's body unchanged. Its failure order is therefore exactly today's: wrapper, mode resolution, then the handler's `readCaller()`.
  - The keyed branch yields `readCaller()`, then `gate.start`, and dispatches a continuation only inside `gate.continueWithin`.
- **Boundary.** `McpToolAccess.ts` is not in the boundary inventory at the base, so it is pristine upstream. It becomes a `hook` entry and is listed with W16 as a hook in the W18 fragment.
<!-- codex-section:end id="spec.jones-client-launch#iface.access-hook.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#iface.semantics.001" -->
## Authorization, Effect And Unknown Semantics

**Gates.** An `McpToolAccess` wrapper always runs before its handler, and a handler cannot run first. Each tool therefore runs its wrapper and then, as the handler's first step, `readCaller()`, the only `orchestration`-capability check. Only then does it delegate to `ClientLaunchService`.

| Tool | Wrapper | Handler order |
| --- | --- | --- |
| `t3_thread_launch` | `startsOrContinuesThreads` (`#iface.access-hook.001`) | unkeyed: `gate.start`, then the existing body unchanged; keyed: `readCaller()`, then `gate.start`, then the steps below |
| `t3_thread_launch_lookup` | `reads` | `readCaller()`, then lookup |
| `t3_thread_launch_fence` | `writesWithCapability` | `readCaller()`, then fence |

No wrapper reads launch state. So for a caller without `orchestration`, every tool fails `capability_denied` before any receipt, claim or thread read and before any write. The only reads before that point are the wrapper's own load of the calling thread's shell, the same as for every existing write tool.

**Keyed launch:**

1. `readCaller()`, then `gate.start`: the requested modes are resolved against the caller's current limits, as `startsThreads` does. A refusal means this call had no effect. Then compute the IDs and digest, and read the receipt for `commandId`.
2. **`rejected`:** return `launch_fenced`, with no writes.
3. **`accepted`:**
   1. The claim row must exist with an equal digest; otherwise `request_conflict`.
   2. Skip the base-ref, worktree and default-resolution preflight.
   3. Compute states for the **bound run**: `runs.find(r => r.userMessageId === messageId)`.
   4. A continuation is needed only for `initialMessage: "pending"`, or for `accepted` with `preparation: "unscheduled"`.
   5. Continue only inside `gate.continueWithin(recordedThreadModes, …)`:
      - `assertTargetWithinLimits(currentLimits, recordedThreadModes)`; a refusal is `*_escalation_denied` with zero dispatch;
      - then run under the `DispatchModeLimit` guard, which maps a mid-dispatch refusal to `*_escalation_denied`, as `writesThreads` does.
   6. Continue through `ThreadLaunchService.launch` with the same IDs, the recorded model and modes, and `holdPreparationAfterProgress: true` (see **Keyed preparation hold**). It replays the message by receipt, recomputes `runIsPreparing`/`shouldSchedule`, and schedules only through `reservePreparation`, at most once, and never after an accepted progress receipt.
   7. Return with `replayed: true`.
4. **Absent:** run the existing preflight. Insert-or-compare the claim, recording `message_requested`; a differing digest is `request_conflict`. Then launch, also with `holdPreparationAfterProgress: true`.

**Preparation states** (bound run only, using the new `ThreadLaunchService.preparationActive(commandId)`):

| State | Condition |
| --- | --- |
| `not_applicable` | no bound run |
| `left_preparation` | the run is not `preparing` |
| `in_progress` | `preparing` and active |
| `unscheduled` | `preparing`, not active, and no accepted `${commandId}:progress:worktree` or `:progress:setup` receipt |
| `unknown_effect` | `preparing`, not active, and a progress receipt exists. Never rescheduled automatically; explicit preparation retry stays an owner action. |

**Keyed preparation hold.** The lookup that chose `unscheduled` holds no reservation, so its answer can be stale when the retry reaches `launch`. In between, another retry can:

1. reserve preparation;
2. record a progress receipt and start the external step;
3. fail;
4. fail to persist `prepared-run.fail`;
5. release the reservation.

The run is then still `preparing`, nothing is active, and a progress receipt is accepted. A second unlocked lookup has the same gap. So the decision is made inside `ThreadLaunchService.launch`, while the caller owns the reservation:

1. `ThreadLaunchInput` gains one optional server-owned field, `holdPreparationAfterProgress?: true`, marked `// Jones hook:`. Public launch schemas do not decode it. Only `ClientLaunchService` sets it, on every keyed `launch` call.
2. In the existing owned section, take the case where `reservePreparation` has returned ownership and the existing `preparationStillRequired` re-read finds the bound run still `preparing`. There, when the flag is set and `runId !== null`, read the `${commandId}:progress:worktree` and `${commandId}:progress:setup` receipts with the service's existing `readReceipt`.
3. If either receipt is `accepted`, call `releasePreparation(commandId)` and do not call `schedulePreparation`. `launch` then returns its ordinary result, and the keyed caller's final lookup reports `unknown_effect`.
4. Otherwise schedule exactly as today. If a receipt read fails, the existing `onError` releases the reservation and nothing is scheduled. The keyed caller reports this as unknown (`orchestration_error`).

Why this is enough:

- The reservation is the existing exclusive in-process scheduling ownership.
- Each progress receipt is dispatched and awaited before its external step: the worktree receipt before any Git or worktree work, the setup receipt before the setup script.
- An owner releases only after its preparation fiber has ended.

So any earlier owner that could have started an external step has an accepted progress receipt before a later retry can own the reservation. An earlier owner that stopped before any progress receipt had no external effect, so scheduling again stays correct. The hold reuses the lookup's own progress-receipt rule and adds no new effect class.

**Unchanged.**

- **Callers without the flag:** every unkeyed and legacy caller, `prepareRun` and `retryPreparation`. They behave exactly as before, including the legacy-only progress refusal.
- **The service interface:** unchanged, so W21's launch-service fixture needs no new member.
- **Nothing new:** no Layer, mutex, retry, schema, migration, event or command type.

**Lookup:**

| Receipt | Result |
| --- | --- |
| accepted | `launched`/`receipt`, plus the bound-run states and workspace |
| rejected | `no_effect`/`fence` or `rejection` |
| none | `absent`/`none`, with `claimed` and the claim's message flag (`unknown` without a claim). Not authoritative. |

**Fence:**

1. If the receipt is accepted, return `launched`; if rejected, return `no_effect`.
2. If absent, call `EventSinkV2.commitRejectedCommand(...)` (receipt only).
3. Re-read the receipt and return what it says.

Atomicity is `insertIfAbsent` on the receipt primary key (`EventSink.ts:1684`); a later create fails `PreviouslyRejected`.

**Outcomes:**

| Outcome | Meaning |
| --- | --- |
| Success | launched |
| `invalid_request`, `capability_denied`, `*_escalation_denied`, `request_conflict`, `launch_fenced` | this call had no effect |
| `orchestration_error`, timeout, reset after write, malformed response | **unknown**: look up; if `absent`, either retry identically or fence |
| `pending` / `unscheduled` | an identical retry reconciles it |
| `rejected` / `unknown_effect` / `threadDeleted` | held; never relaunch under that key |

**Never:** a second thread per key; a second live preparation; automatic rescheduling after a progress receipt, including by a retry whose lookup was stale; replay of unrelated commands; reads of credentials, session stores or private data.
<!-- codex-section:end id="spec.jones-client-launch#iface.semantics.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ctx.change-surface.001" -->
## Exact Change Surface And Ownership

The writer cone is **22 entries covering 27 physical paths** (W19 names three files; W21 names four fixture files). All paths are relative to the Jones Code repository root. Anything outside the cone needs a T1 rebind.

| # | Path | Class after change | Content |
| --- | --- | --- | --- |
| W1 | `packages/contracts/src/jones/clientLaunch.ts` (new) | jones-owned | schemas in `#iface.mcp-tools.001` |
| W2 | `packages/contracts/src/jones/clientLaunch.test.ts` (new) | jones-owned | decode/encode, closed literals |
| W3 | `packages/contracts/src/index.ts` | hook | one `export *` line |
| W4 | `packages/contracts/src/orchestratorMcp.ts` | accepted-shared | export the request-ID schema; two failure literals |
| W5 | `apps/server/src/jones/persistence/Migrations/112_JonesClientLaunchRequests.ts` (new) | jones-owned | DDL and triggers |
| W6 | `apps/server/src/jones/persistence/Migrations/112_JonesClientLaunchRequests.test.ts` (new) | jones-owned | T8 |
| W7 | `apps/server/src/jones/persistence/JonesMigrations.ts` | jones-owned | import and entry 112 |
| W8 | `apps/server/src/jones/mcp/clientLaunch/ClientLaunchIdentity.ts` (new) | jones-owned | IDs, JCS, digest |
| W9 | `apps/server/src/jones/mcp/clientLaunch/ClientLaunchIdentity.test.ts` (new) | jones-owned | T9 |
| W10 | `apps/server/src/jones/mcp/clientLaunch/ClientLaunchService.ts` (new) | jones-owned | launch, lookup, fence, states, claim SQL |
| W11 | `apps/server/src/jones/mcp/clientLaunch/ClientLaunchService.test.ts` (new) | jones-owned | T1, T2, T4–T7, T12, T13, T15 (keyed-retry side) |
| W12 | `apps/server/src/jones/mcp/clientLaunch/ClientLaunchHandlers.test.ts` (new) | jones-owned | T3, T10, T11, T14 through `McpToolAccess.HandlersLayer.layer(ProjectHandlers.layer)`; the upstream handler assertions are unchanged, with only the W21 additive service fixture update |
| W13 | `apps/server/src/orchestration-v2/ThreadLaunchService.ts` | accepted-shared | `// Jones hook:` read-only `preparationActive(commandId)` over `scheduledLaunches.commands`, and the keyed-only `holdPreparationAfterProgress` input field with its accepted-progress check inside the owned reservation section (`#iface.semantics.001`); no behaviour change when the field is absent |
| W14 | `apps/server/src/jones/orchestration/ThreadLaunchService.jones.test.ts` | existing Jones test | accessor during a live reservation, after release, and on a fresh layer; T15 service cases for the keyed hold |
| W15 | `apps/server/src/mcp/toolkits/project/tools.ts` | accepted-shared | input and output fields; two tools in `ProjectToolkit`; `dependencies` add `CommandReceiptStoreV2`, `EventSinkV2`, `SqlClient` |
| W16 | `apps/server/src/mcp/toolkits/project/handlers.ts` | **becomes hook** | `// Jones hook:` `t3_thread_launch` on `startsOrContinuesThreads`; keyed branch, lookup and fence handlers each call `readCaller()` first in the handler; the unkeyed branch yields `gate.start`, then today's body unchanged |
| W17 | `docs/orchestration-v2/orchestrator-mcp-server.md` | becomes accepted-shared | retry key, lookup and fence; idempotency bullets |
| W18 | `scripts/jones/boundary/fragments/client-launch.json` (new) | policy | owned paths, hooks W16 and W20, allowed imports, including the one W22 type-import edge `apps/server/src/ws.ts` → `apps/server/src/environment/NativeStoreAuthority.ts` |
| W19 | `scripts/jones/boundary/inventory.json`, `scripts/jones/boundary/features.json`, `scripts/jones/boundary/checks.json` | policy | accounting only, including `hook` for W16 and W20; in `checks.json`, add `apps/server/src/ws.ts` to the `hq-jones-client-launch` lint command; preserve every other entry |
| W20 | `apps/server/src/mcp/McpToolAccess.ts` | **becomes hook** | one additive `// Jones hook:` export `startsOrContinuesThreads` with `ThreadStartGate` (`#iface.access-hook.001`); no other line changes |
| W21 | `apps/server/src/jones/persistence/UpstreamIsolation.test.ts`, `apps/server/src/mcp/toolkits/project/handlers.test.ts`, `apps/server/src/mcp/toolkits/worktree/registration.test.ts`, `apps/server/src/orchestration-v2/ThreadLaunchService.test.ts` | narrow test fixtures | Add migration 112 to the exact expected Jones migration list; provide the newly required typed synthetic receipt/event/SQL services to toolkit fixtures; forward the existing preparationActive accessor in the launch-service fixture. Preserve all existing assertions and cases; no runtime source or server.ts change. |
| W22 | `apps/server/src/ws.ts` | hook (class unchanged; declared by the existing `runtime-stop` fragment) | type-only checked export of the existing WebSocket Layer value (**W22 checked `ws.ts` export** below); no runtime change |

**Hidden ownership: none.**

- Only W21 additive test-fixture wiring and the migration-112 expected-list update are permitted. No assertion relaxation, skips, timeouts, test deletion or other upstream test behavior change.
- No new Layer construction and no `server.ts` edit. W22 renames the existing `Layer.unwrap(...)` binding to a private `layerWs` and exports the same value as `layer`. Nothing new is built, provided or composed.
- No edits to `Orchestrator.ts`, `EventSink.ts` or `CommandReceiptStore.ts`.
- No change to any existing `McpToolAccess` builder, including `startsThreads`, which `schedule_task` also uses.
- In `ThreadLaunchService.ts`, nothing beyond W13: no change to the service interface, `prepareRun`, `retryPreparation`, `schedulePreparation`, `failPreparedRun`, `reservePreparation` or `releasePreparation`, and no behaviour change when `holdPreparationAfterProgress` is absent. The F2 hold adds no path: it stays in W13, W11 and W14.
- No change to Scratch folder allocation (`folderForThread`); F3 stays deferred (`#ctx.stop-recovery-delivery.001`).
- No new event or command type, upstream schema change or generated file.
- No index or worktree operation outside the builder's own worktree.

**W22 checked `ws.ts` export.**

- **Cause.** `server.ts` imports `layer` from `ws.ts`. Across that import, the inferred requirements of the exported `Layer.unwrap(...)` value widen. The unchanged server typecheck then reports eight TS377030 requirements-channel errors in `server.ts`; at the head bound for the repair they are at (722,7), (752,8), (784,7), (1112,11), (1112,42), (1119,11), (1120,7) and (1128,12). The local, unexported Layer keeps its full requirements.
- **Form.**
  - Keep the original initializer, unannotated, as a private `const layerWs = Layer.unwrap(...)`.
  - Export the same value with `export const layer: Layer.Layer<never, never, WsLayerServices> = layerWs;`.
  - `WsLayerServices` is the complete union of the original layer's requirements:
    - eight ordinary services: `HttpRouter.HttpRouter`, `NativeStoreAuthority`, `PreviewAutomationBroker`, `PullRequestReviewGuideService`, `PullRequestService`, `ServerBrowser`, `ServerSelfUpdate` and `SqlClient`;
    - `HttpRouter.Request.From<"Requires", …>` over 78 request services;
    - `HttpRouter.Request<"Error", ConfigError>`.
  - Eleven `import type` lines supply the names not already imported.
- **Qualification recorded by the diagnosis.**
  - The interface equals the original unannotated layer's requirements in both directions, and every one of the 87 one-member omissions is rejected, naming exactly that member.
  - With the form applied and no instrumentation, the unchanged typecheck command ran both scopes with no cache hit and reported no diagnostic.
  - Emitted JavaScript differs only by the binding name and the re-export; once that is normalized, it is byte-identical.
  - A focused check with the installed Effect showed the same Layer identity, lazy build, memoization, request capture and one finalization.
  - This is diagnosis evidence. Acceptance is T16 at the task head.
- **Rejected forms.** Annotating the initializer itself, which gave three TS2589 depth errors. The `effectDiscard`/`router.add` form, which left all eight errors in place.
- **Invariants.**
  - No change to the initializer, any runtime import, statement order, provider or handler, schema, wire key or state path.
  - No cast, `@ts-` suppression, `any`/`unknown` erasure, narrowed service subset, compiler or config change.
  - No `server.ts` edit; its explicit `runServer` signature stays as is.
  - Nothing is constructed, provided or composed anew, so the no-new-Layer rule holds.
- **Reference.** Applied to `ws.ts` with SHA-256 `ddd1cd32b676824ba986c8fd56111f6f517385951b471d36f2ddd7664757cd38`, the reference patch (SHA-256 `ee40456bee3ea511db1a8f0b3d559357a10398acb46c26befb6935f168f84a4e`; 107 lines added, 1 removed) yields SHA-256 `ca07f1b3edd65fc59a6f897480cac2492963a538899b0910958ec0911b0c4fed`. If the `ws.ts` bytes differ when the builder applies it, stop and ask T1; do not re-derive the interface.
- **Boundary.**
  - `environment/NativeStoreAuthority.ts` is `jones-owned`, and `check-boundary.ts` checks type-only imports too. So W18 lists exactly one new allowed edge, from `apps/server/src/ws.ts` to `apps/server/src/environment/NativeStoreAuthority.ts`.
  - The other ten type-import targets are upstream or `accepted-shared` and need no edge.
  - `ws.ts` stays a `hook` declared by `runtime-stop`. Listing it again in the `client-launch` `hookPaths` would fail as an overlapping hook.
  - No ownership claim and no other policy entry changes.
<!-- codex-section:end id="spec.jones-client-launch#ctx.change-surface.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ctx.test-plan.001" -->
## Test Plan

All cases use synthetic namespaces and keys, in-memory SQLite (`NodeSqliteClient.layer({filename: ":memory:"})`), and typed receipts or drains.

| ID | File | Pass condition |
| --- | --- | --- |
| T1 | W11 | same key and payload twice: one `thread.create` receipt, one thread, one initial message; second call `replayed: true` |
| T2 | W11 | same key, any canonical field changed: `request_conflict`; no new receipt or events |
| T3 | W12 | keyed + `scratch`/attachments, or `worktree` without `message`: `invalid_request`; read-only client: `capability_denied`; mode above the ceiling: denied; client without `projectId`: refused; a preflight refusal leaves no claim |
| T4 | W11 | an accepted launch replays after its base ref is deleted and after the project default model changes |
| T5 | W11 | lookup `absent`, `absent+claimed`, `launched` (message accepted or pending), `threadDeleted`, and `no_effect`/`rejection` |
| T6 | W11 | fence absent → `no_effect`, then launch `launch_fenced` with zero events; fence after launch → `launched`; concurrent fence and launch produce one consistent winner |
| T7 | W11 | fault after the claim but before dispatch: retry launches; fault after `thread.create` but before the message: `pending`, then exactly one message |
| T8 | W6 | the table exists; `message_requested` accepts only 0 and 1; update, delete and re-insert refused; no foreign key |
| T9 | W9 | no raw namespace in IDs or outputs; golden digests; key length bounds |
| T10 | W12 + upstream handler and `McpToolAccess` tests | unkeyed launch unchanged, including failure order (read-only client, missing or inactive calling thread, broader requested modes, then missing `orchestration`); upstream tests, including `McpToolAccess.test.ts` and `McpToolAccess.race.test.ts`, pass with only W21 fixture updates; the two McpToolAccess files stay untouched |
| T11 | W12 | a narrower caller where a continuation is needed: `*_escalation_denied`, zero dispatch; a replay with no continuation is read-only; modes raised mid-dispatch are refused through `gate.continueWithin`, with nothing committed |
| T12 | W11 + W14 | message accepted, crash before scheduling: `unscheduled`, and the retry schedules once; active: `in_progress`; progress receipt and not active: `unknown_effect`, with no `launch` call; two concurrent retries schedule once |
| T13 | W11 | `not_requested` vs `pending`; `rejected` with reason; `unknown` without a claim; a later unrelated run never changes `runId`/`runStatus` |
| T14 | W12 | no `orchestration` capability: `capability_denied` from all three tools before any receipt, claim or thread read, including a keyed launch that also requests broader modes; read-only: launch and fence refused, lookup allowed |
| T15 | W11 + W14 | **Stale keyed retry (F2).** W11, deterministic and without sleeps: (1) a keyed `worktree` launch faults after its message is accepted and before scheduling, leaving `unscheduled`; (2) retry A runs to its continuation and is held by a `Deferred` barrier in its `ThreadLaunchService.launch` wrapper, after its `unscheduled` lookup and before the real `launch`; (3) while A is held, insert an accepted `${commandId}:progress:worktree` receipt, with the run still `preparing` and no reservation. That is the state another retry's failed preparation leaves when `prepared-run.fail` cannot be persisted; (4) release A. Pass: A's request carries `holdPreparationAfterProgress: true`; A returns `replayed: true` with `unknown_effect`; `createWorktree` and setup call counts do not increase across the barrier; `preparationActive` is false. Without the hold this case schedules preparation again, so it fails before the fix. W14, service cases on a real layer: with the flag and an accepted progress receipt, nothing is scheduled and the reservation is released; with the flag and no progress receipt, preparation is scheduled once; with the flag while another owner holds the reservation, there is no second scheduling; without the flag, behaviour is as today, including scheduling after a progress receipt on the non-legacy path. |
| T16 | W22 (+ W18, W19) | **Checked `ws.ts` export.** (1) The unchanged `vp run --filter @t3tools/contracts --filter t3 --concurrency-limit 1 typecheck` executes both scopes, so a cache hit is not evidence, and reports no diagnostic. The eight TS377030 errors in `server.ts` are gone, and there is no TS2589. (2) `vp lint apps/server/src/ws.ts` and `check-boundary.ts --strict` pass, the latter with the one W18 edge. (3) The `ws.ts` diff is exactly the reference form: eleven `import type` lines, the `WsLayerServices` alias, the `layerWs` binding and one exported line. Every other byte, including the `Layer.unwrap` initializer, is unchanged. An instrumented run is not a pass. |

**Stage checkpoints.** Each is a coherent commit.

| Stage | Paths | Checks |
| --- | --- | --- |
| S1 contracts | W1–W4 | `vp test run packages/contracts/src/jones/clientLaunch.test.ts packages/contracts/src/orchestratorMcp.test.ts --maxWorkers=1`; `vp run --filter @t3tools/contracts typecheck` |
| S2 persistence | W5–W7 | `vp test run apps/server/src/jones/persistence/Migrations/112_JonesClientLaunchRequests.test.ts apps/server/src/jones/persistence/UpstreamIsolation.test.ts apps/server/src/jones/persistence/ForeignHistoryCompatibility.test.ts --maxWorkers=1 --no-file-parallelism` |
| S3 service | W8–W11, W13–W14 | `vp test run apps/server/src/jones/mcp/clientLaunch/ClientLaunchIdentity.test.ts apps/server/src/jones/mcp/clientLaunch/ClientLaunchService.test.ts apps/server/src/jones/orchestration/ThreadLaunchService.jones.test.ts apps/server/src/orchestration-v2/ThreadLaunchService.test.ts --maxWorkers=1 --no-file-parallelism` |
| S4 MCP hooks and `ws.ts` | W12, W15–W16, W20–W22 | `vp test run apps/server/src/jones/mcp/clientLaunch/ClientLaunchHandlers.test.ts apps/server/src/mcp/toolkits/project/handlers.test.ts apps/server/src/mcp/toolkits/worktree/registration.test.ts apps/server/src/mcp/McpToolAccess.test.ts apps/server/src/mcp/McpToolAccess.race.test.ts --maxWorkers=1 --no-file-parallelism`; for W22, `vp run --filter @t3tools/contracts --filter t3 --concurrency-limit 1 typecheck` (T16) |
| S5 final | W17–W19 | the final union below |

**Final candidate union** (serial, after a CPU admission sample):

```sh
vp test run packages/contracts/src/jones/clientLaunch.test.ts packages/contracts/src/orchestratorMcp.test.ts apps/server/src/jones/persistence/Migrations/112_JonesClientLaunchRequests.test.ts apps/server/src/jones/persistence/UpstreamIsolation.test.ts apps/server/src/jones/persistence/ForeignHistoryCompatibility.test.ts apps/server/src/jones/mcp/clientLaunch/ClientLaunchIdentity.test.ts apps/server/src/jones/mcp/clientLaunch/ClientLaunchService.test.ts apps/server/src/jones/mcp/clientLaunch/ClientLaunchHandlers.test.ts apps/server/src/jones/orchestration/ThreadLaunchService.jones.test.ts apps/server/src/orchestration-v2/ThreadLaunchService.test.ts apps/server/src/mcp/toolkits/project/handlers.test.ts apps/server/src/mcp/toolkits/worktree/registration.test.ts apps/server/src/mcp/McpToolAccess.test.ts apps/server/src/mcp/McpToolAccess.race.test.ts --maxWorkers=1 --no-file-parallelism
vp lint <each changed .ts file in W1–W16 and W20–W22>
vp run --filter @t3tools/contracts --filter t3 --concurrency-limit 1 typecheck
node scripts/jones/check-boundary.ts --strict
```
<!-- codex-section:end id="spec.jones-client-launch#ctx.test-plan.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ctx.stop-recovery-delivery.001" -->
## Stop, Recovery And Delivery

**Stop on:**

- a stale base or unowned change;
- a needed path outside the cone;
- a needed change to `Orchestrator.ts`, `EventSink.ts`, event or command types, or upstream schema;
- migration 112 taken by another PR;
- an unknown prior effect.

Ask T1 for a rebind instead of widening scope.

**Moving `main`.** If `main` moves, or boundary files conflict, merge the new `main` into the task branch with an ordinary merge commit. Keep every other feature's inventory, feature and check entries. No rebase, force push or history rewrite.

**Delivery.** One non-draft PR against `main` under the Jones Code standing delivery contract. Keep exact-head checks green; merge with a merge commit; read back. Record P2–P4 findings without implementing them.

**Deferred finding F3** (P2, from the source PR's first correctness review). For an existing Scratch project, managed folder allocation can run before the create/fence winner is persisted. Its original blocking effect stands: it violates complete no-effect reporting for keyed launches that target the existing Scratch project, and it can leave duplicate or unbound folders. This task does not repair it and does not narrow the Scratch contract. The F2 change does not touch Scratch allocation. Report F3 with the other deferred findings, with its severity and blocking claim unchanged.

**Return:** branch, head, PR URL, per-stage checks run or skipped, and deferred findings.
<!-- codex-section:end id="spec.jones-client-launch#ctx.stop-recovery-delivery.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ctx.rollback.001" -->
## Rollback

**Source, before any installed build has run migration 112:** an ordinary revert PR of the merge commit.

**Source, after 112 has run anywhere:** 112 is released history and must never be renumbered or deleted. Repair forward:

- keep W5–W7 (the table becomes inert);
- disable or remove the keyed paths;
- leave unkeyed launch untouched.

**Installed:** owner-controlled, through the existing Jones update path. Update checks block a build older than its database, so after 112 has run, installed rollback is a forward build, not a downgrade.
<!-- codex-section:end id="spec.jones-client-launch#ctx.rollback.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ctx.gates-and-hq-seam.001" -->
## Gates And HQ Seam

**Gates.** No permission flow is designed here.

- **G1. Source:** the PR merged, with readback. This is this task's finish line.
- **G2. Install:** an installed Jones Code build that contains the merge, adopted through the existing owner-controlled Jones update path. Consequential and owner-reserved; not authorized by a source merge.
- **G3. Native consent:** the owner's native Jones Code OAuth approval for the HQ MCP client at a chosen access level. It is the same consent gate as the existing-thread receiver, and it recurs every 30 days.

**HQ follow-on, source.** It **does not wait** for G1–G3. Construction may start now against synthetic ports and wire stubs that follow `#iface.mcp-tools.001` and `#iface.semantics.001`. It is a T2-owned, main-only `TransportPort` for `transport: "jones-code"`, mode `new-thread`:

- **Send:** keyed `t3_thread_launch` with `clientRequestId` = HQ attempt ID and `message` = the HQ receiver handoff text. Success → `accepted`, with receipt `jcl1:<threadId>`; the definite-failure codes → `rejected`; anything else → unknown.
- **Lookup:** `launched` → `found`; `no_effect` → `no-effect` (authoritative); `absent` → `not-found`.
- **Fence:** a write. It needs an explicit, owner-initiated "resolve unknown" action in the Design connector contract, because reconciliation is lookup-only today. That small addition is owned by the Design connector section with T2; it is never automatic.
- **Session limit (R1):** unknowns must be reconciled before the 30-day OAuth session expires.

**HQ follow-on, native activation.** Only enabling real new-thread sends needs G1, G2 and G3, plus live qualification. Until then the destination stays visibly "Not qualified".

**Note for the existing-thread adapter.** Current `main` adds `separate_turn` to `t3_thread_send`. The CL-5 adapter chooses between it and `queue` at its own rebind.
<!-- codex-section:end id="spec.jones-client-launch#ctx.gates-and-hq-seam.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#ctx.operator-interaction-inventory.001" -->
## Operator Interaction Inventory

| Interaction | Who | When | Covered here |
| --- | --- | --- | --- |
| Dependency install (`vp i`) in the task worktree | builder | before the first check | yes, as an ordinary task-local install |
| Jones Code build install and adoption (G2) | owner, through the existing update path | after G1 | no |
| Native OAuth approval for the HQ client (G3) | owner, in Jones Code | before HQ native activation | no |

No sudo, credential, private-state or production effect is part of this task.
<!-- codex-section:end id="spec.jones-client-launch#ctx.operator-interaction-inventory.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#plan.implementation.001" -->
```json
{
  "schema_version": 1,
  "default_context_refs": [
    "spec.jones-client-launch#ctx.project-summary.001",
    "spec.jones-client-launch#ctx.change-surface.001",
    "spec.jones-client-launch#ctx.stop-recovery-delivery.001"
  ],
  "deferred_findings_sink_ref": null,
  "artifact_path_hints": {
    "spec.jones-client-launch": "docs/engineering-specs/jones-client-launch.md"
  },
  "launch_policy": "start_all_currently_launchable_with_rolling_capacity_refill",
  "machine_block_source_rendering": "deterministic_two_space_json",
  "runtime_rendering": "canonical_compact_json",
  "fan_in_owner": "lane-t1",
  "additional_final_check_groups": [],
  "delivery_boundary": "One non-draft Jones-Systems/Jones-Code PR against main, merged with a merge commit and read back. This HQ plan grants no Jones Code install, native OAuth consent, release or deployment."
}
```
<!-- codex-section:end id="spec.jones-client-launch#plan.implementation.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#task.client-launch.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "jones-source-builder",
  "objective": "Target repository Jones-Systems/Jones-Code (not HQ), base main fa7c6c013811db33d128422027697dbaa1517b60 or a successor read back at launch; every path in this task is relative to the Jones Code root. In one isolated non-main Jones Code task worktree, implement the keyed idempotent t3_thread_launch, t3_thread_launch_lookup and t3_thread_launch_fence exactly as specified in the interface and semantics sections, in stages S1-S5 with one coherent commit each, then publish one non-draft PR against Jones Code main and qualify, merge and read it back under the Jones Code standing delivery contract. Write no plan or note file inside Jones Code.",
  "context_refs": [
    "spec.jones-client-launch#ctx.source-binding.001",
    "spec.jones-client-launch#ctx.target-rules.001",
    "spec.jones-client-launch#iface.mcp-tools.001",
    "spec.jones-client-launch#iface.identity-claim.001",
    "spec.jones-client-launch#iface.access-hook.001",
    "spec.jones-client-launch#iface.semantics.001",
    "spec.jones-client-launch#ctx.test-plan.001",
    "spec.jones-client-launch#ctx.rollback.001",
    "spec.jones-client-launch#ctx.gates-and-hq-seam.001",
    "spec.jones-client-launch#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "package.json",
    "packages/contracts/",
    "apps/server/src/",
    "scripts/jones/"
  ],
  "write_scope": [
    "packages/contracts/src/jones/clientLaunch.ts",
    "packages/contracts/src/jones/clientLaunch.test.ts",
    "packages/contracts/src/index.ts",
    "packages/contracts/src/orchestratorMcp.ts",
    "apps/server/src/jones/persistence/Migrations/112_JonesClientLaunchRequests.ts",
    "apps/server/src/jones/persistence/Migrations/112_JonesClientLaunchRequests.test.ts",
    "apps/server/src/jones/persistence/JonesMigrations.ts",
    "apps/server/src/jones/mcp/clientLaunch/ClientLaunchIdentity.ts",
    "apps/server/src/jones/mcp/clientLaunch/ClientLaunchIdentity.test.ts",
    "apps/server/src/jones/mcp/clientLaunch/ClientLaunchService.ts",
    "apps/server/src/jones/mcp/clientLaunch/ClientLaunchService.test.ts",
    "apps/server/src/jones/mcp/clientLaunch/ClientLaunchHandlers.test.ts",
    "apps/server/src/orchestration-v2/ThreadLaunchService.ts",
    "apps/server/src/jones/orchestration/ThreadLaunchService.jones.test.ts",
    "apps/server/src/mcp/toolkits/project/tools.ts",
    "apps/server/src/mcp/toolkits/project/handlers.ts",
    "docs/orchestration-v2/orchestrator-mcp-server.md",
    "scripts/jones/boundary/fragments/client-launch.json",
    "scripts/jones/boundary/inventory.json",
    "scripts/jones/boundary/features.json",
    "scripts/jones/boundary/checks.json",
    "apps/server/src/mcp/McpToolAccess.ts",
    "apps/server/src/jones/persistence/UpstreamIsolation.test.ts",
    "apps/server/src/mcp/toolkits/project/handlers.test.ts",
    "apps/server/src/mcp/toolkits/worktree/registration.test.ts",
    "apps/server/src/orchestration-v2/ThreadLaunchService.test.ts",
    "apps/server/src/ws.ts"
  ],
  "requires": [
    "spec.jones-client-launch#req.idempotent-launch.001",
    "spec.jones-client-launch#req.effect-truth.001",
    "spec.jones-client-launch#req.repository-boundary.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.jones-client-launch#ac.source-candidate.001",
    "spec.jones-client-launch#ac.source-delivery.001"
  ],
  "test_refs": [
    "spec.jones-client-launch#test.client-launch.001"
  ],
  "affected_check_groups": [
    "hq-jones-client-launch"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Jones Code only: one dedicated non-main branch in an isolated linked worktree with one Git owner; never the primary checkout.",
    "Write only the 27 cone paths; in McpToolAccess.ts only the additive startsOrContinuesThreads hook; in ThreadLaunchService.ts only the read-only preparationActive accessor and the keyed-only holdPreparationAfterProgress hold; in ws.ts only the W22 type-only imports, the WsLayerServices alias, the private layerWs binding and the same-value checked export; only W21 additive test-fixture wiring and migration expected-list update without assertion relaxation; no other upstream test edit, Orchestrator.ts, EventSink.ts, CommandReceiptStore.ts, event or command type, upstream schema or new Layer construction.",
    "Migration 112 only, jones_-prefixed, no foreign key to upstream; never renumber or delete a released migration.",
    "Focused checks only; never vp check, vp run -r test or vp run -r typecheck; CPU admission before each check batch.",
    "Merge the new main with an ordinary merge commit when main moves; no rebase, force push, squash or history rewrite.",
    "No PR review bots, credentials, live OAuth, session stores, installed-app update, sudo or deployment effect.",
    "F3 (P2, Scratch folder allocation before the create/fence winner) stays deferred with its original severity and blocking claim: no Scratch allocation change and no narrowed Scratch contract.",
    "W22 adds no cast, suppression, any/unknown erasure, narrowed service subset, compiler or config change and no server.ts edit; the direct initializer annotation and the effectDiscard form are rejected."
  ],
  "stop_conditions": [
    "Stale base, unexpected or unowned change, or an unknown prior effect.",
    "A needed path outside the 27-path cone or a needed change to an excluded upstream surface; request a T1 rebind.",
    "Migration 112 is taken on main by another change.",
    "The keyed preparation hold cannot be made inside the W13 owned reservation section without changing unkeyed behaviour or the service interface; request a T1 rebind.",
    "ws.ts bytes differ from SHA-256 ddd1cd32b676824ba986c8fd56111f6f517385951b471d36f2ddd7664757cd38 when W22 is applied, or the unchanged typecheck still reports a diagnostic with the W22 form; request a T1 rebind instead of re-deriving the interface."
  ]
}
```
<!-- codex-section:end id="spec.jones-client-launch#task.client-launch.001" -->

<!-- codex-section:begin id="spec.jones-client-launch#test.client-launch.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.jones-client-launch#req.idempotent-launch.001",
    "spec.jones-client-launch#req.effect-truth.001",
    "spec.jones-client-launch#req.repository-boundary.001"
  ],
  "scenario": "In the Jones Code task worktree, with synthetic namespaces and keys, in-memory SQLite and typed receipts, cases T1-T16 exercise keyed replay, conflict, lookup, fence, fault windows, bound-run states, the stale-retry preparation hold, the checked ws.ts export and authorization; the unkeyed path and upstream test behavior stay unchanged, with only W21 additive fixture updates.",
  "evidence": {
    "predicate": "At one exact Jones Code head the final focused union passes: the listed vp test run files, vp lint of every changed .ts file, the contracts and server typechecks, and check-boundary.ts --strict.",
    "invalid": "A second thread, message or live preparation per key; automatic rescheduling after a progress receipt, including by a retry whose lookup was stale; a replay that widens authority; a ws.ts export that uses a cast, suppression or type erasure, or a cache-hit or instrumented typecheck reported as a pass; an upstream test edit beyond the W21 additive fixture updates; or a skipped check reported as a pass.",
    "unknown": "The Jones Code toolchain (Node ^24.13.1, pnpm 11.10.0 via vp) cannot run on the check host, or CPU admission holds; record the exact check as not run."
  },
  "environment": [
    "Jones-Systems/Jones-Code task worktree at the task head (not HQ)",
    "Node ^24.13.1 with pnpm 11.10.0 via vp"
  ],
  "obligation_owner_task": "spec.jones-client-launch#task.client-launch.001",
  "evidence_executor_task": "spec.jones-client-launch#task.client-launch.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "packages/contracts/src/jones/",
    "apps/server/src/jones/mcp/clientLaunch/",
    "apps/server/src/jones/persistence/Migrations/",
    "apps/server/src/jones/orchestration/",
    "apps/server/src/mcp/toolkits/project/",
    "apps/server/src/mcp/",
    "apps/server/src/ws.ts"
  ],
  "affected_check_groups": [
    "hq-jones-client-launch"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.jones-client-launch#test.client-launch.001" -->

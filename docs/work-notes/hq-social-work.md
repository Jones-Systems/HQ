# Work Note — HQ Social and Work planning

<!-- codex-section:begin id="worknote.hq-social-work#ctx.artifact-header.001" -->
Artifact Type: `work-note`

Artifact ID: `worknote.hq-social-work`

Purpose: Continuity for the HQ Social/Work implementation plan: evidence, validation record, decisions pending and next responsible actor.

Governing artifact: `spec.hq-social-work`

Continuity owner: HQ Social/Work planner lane (T1); launch and integration custody stay with the HQ root coordinator

Consumers: HQ root coordinator, Social/Work/UI lanes, reviewers

Authority effect: none
<!-- codex-section:end id="worknote.hq-social-work#ctx.artifact-header.001" -->

## Outcome

<!-- codex-section:begin id="worknote.hq-social-work#ctx.outcome.001" -->
Planning delivered on branch `work/hq-social-work-plan`:

- the public-safe shared foundation copy, `docs/design/hq-shared-foundation.md`;
- the implementation plan, `docs/engineering-specs/hq-social-work.md`;
- this note;
- the plan tooling, `docs/work-notes/hq-social-work-tools/`.

The plan's revision 3 (2026-10-20) adds:

- the D-4 cross-domain reference plan (`req.references.001`, `iface.references.001`, `iface.service-reference-extensions.001`, six tasks);
- the Operator Interaction Inventory;
- the R0 binding record and RF-2 delta (`ctx.foundation-binding-record.001`);
- the D-1 import record (`ctx.d1-import.001`);
- the T2, T3 and T4 design bindings (`ctx.visual-system-binding.001`, `ctx.social-design-reconciliation.001`, `ctx.work-design-binding.001`);
- the check-catalog proposal, rewritten as an additive delta in the Codex V3 trusted-group schema.

The plan has 23 tasks and 23 Test Intents. They were parsed and wave-compiled by the real Codex V3 helpers at the committed revision.

R0 (`task.bind-foundation.001`) is complete: a read-only binding with no rebind (`docs/evidence/hq-social-work/foundation/r0-binding.md`).

R1 (`task.workspace-skeleton.001`) is complete at `cfdab378e28940662ddb6e731264afca164a1957`, on a normal merge of the foundation `35f9a3e` (`ff5ad79`). Fresh `npm ci`, typecheck, 30 tests in 6 files, and build all pass, with 0 vulnerabilities (`docs/evidence/hq-social-work/integration/r1-workspace-skeleton.md`).

No module feature code was written by T1.

**Revision 4 (2026-10-20, integration phase)** consumes the advisory integration-planner result, the root's supervision record and the root's corrections. It adds:

- the accepted lane bindings and topology (`ctx.integration-bindings.001`);
- native child containment (`ctx.child-launch-containment.001`);
- the integration stages, Design-owned inputs, custody, verification semantics, no adopted merge order and the shared-boundary unknowns (`ctx.integration-stages.001`);
- the expanded `ac.work-domain.001`, the Social+Work assembly (`ac.sw-assembly.001`) and the gated joint tasks: root checks, assembly, Electron smoke and CI.

The plan now has 27 tasks and 27 Test Intents. It was validated at `7468e8844c2455e52afc5ddabf8d434454972caa` (`docs/evidence/hq-social-work/integration/integration-plan-validation.md`).
<!-- codex-section:end id="worknote.hq-social-work#ctx.outcome.001" -->

## Current State And Evidence

<!-- codex-section:begin id="worknote.hq-social-work#ctx.evidence.001" -->
**Guidance adopted (owner-directed, 2026-10-20).**

- Codex V3 root guidance: `Jones-Systems/Codex-V3`, `AGENTS.md` at `4beb491c44551b6e4207adcc7459c4b11407bcbc`, blob `3402719bc3a09e7e08ed113425d7137818eda25c`, 30,716 bytes, SHA-256 `1238a90adbf10ea8f2359f90ed0c7bf99fc1121589dcde5b99881fd247e87ce6`. All 444 lines were read.
- HQ `AGENTS.md` was read at both `33dfe44` and the guidance-only `35f9a3e`. At `35f9a3e`, `AGENTS.md`, `CLAUDE.md` and `docs/shared-agent-guidance.md` route startup to `.agents/shared-guidance.md`. That file is **absent** in this checkout, so shared enrollment is reported unavailable, and the local agreements plus the Codex V3 read above apply.
- Triggered workflows loaded:
  - parallel-project-plan and its handoffs reference;
  - build-implementation-plan;
  - specification-artifacts template (header, Work Note, Engineering Spec);
  - research-first hidden-impact screen;
  - Linux telemetry admission;
  - register-thread and the thread-registration route;
  - model-selection precedence (Claude Frontier);
  - operate-t3-threads (send rules);
  - frontend-home pointer.

**Material conflicts, resolved in favor of the stricter task rules.**

1. **Delegation.** The Codex V3 delegation default conflicts with this task's no-descendants rule.
2. **Delivery.** The Codex V3 delivery default (non-draft PR, then merge) conflicts with the held merge.
3. **Model routing.** Claude Frontier routing is overridden by the explicit owner instruction `claude-opus-5-5`/high.
4. **Native IDs vs public repository.** Codex V3 asks contributors to record native IDs, but this repository is public. Public artifacts carry only T-labels and roles; native identities go to the root through native messages.

**Sources.** Every source was read-only, with no live data. The table is in `spec.hq-social-work#ctx.research-decision-basis.001`. These revision-3 inputs were read at immutable commits and are recorded in their spec sections:

- T0 `35f9a3e`;
- the D-1 files at Codex-V3 `4beb491c`;
- T2 `f3c1daff`, T3 `8f91f6b2` and T4 `1bb550de`;
- Design PR #4's catalog at `fa244847`.

**Contributors.**

- T1 planner, `claude-opus-5-5`/high.
- One read-only Explore sub-agent that inventoried the Manual Planner source. Its model is per its agent definition and was not separately observed. It completed and mutated nothing. It was launched before T1 noticed the no-descendant restriction. That is a deviation from the capsule; its result was reused and nothing else was delegated.

**Telemetry before the helper batches.** Linux admission: CPU 7.21% used, 45.92 GiB available, one full core is 6.25% of capacity, batch ceiling 10, one serial test process. Load average was rechecked before each compile batch. The helper runs are single-process Python with no test or install.

**Helper validation record (revision 3).**

- Spec commit `fb884229aea8afd5ad9b4ed8d93cd08644043ef2`, spec blob `66688efcce330a8a66d8020f447626ed0d3f283b`, file SHA-256 `1a18acbe44480ff95a629bf8b0d700ac41c621e74d00198f6ad803531ad825c8`.
- Intermediate commits `3a9035c4` (references) and `2a72f5a2` (T2) also parsed and compiled.
- `codex_v3.sections_cli check`: valid.
- `parse_engineering_spec_plan` parsed 23 tasks and 23 intents.
- **Catalog binding:** a **projection** of the proposed additive delta in `spec.hq-social-work#ctx.check-catalog.001`. The manifest is SHA-256 `7ed3bfcbdb954543e30d419cef46f37c8d8ba6c1530df1c16be7eb930b6019cb`, with five groups: `hq-foundation`, `hq-ui`, `shell-integration`, `social-module`, `work-module`. It is **not** HQ's `tests/check-groups.toml`. That file is owned by the Design plan (PR #4) and is not transferred to T1. Affected-check claims stay held until its owner merges the delta.
- **Context bound.** Every task's resolved context is within the compiler's default 32 KiB bound; the largest is `work-core`, at 32,023 bytes. The foundation binding record moved from the default context to the root tasks so that `social-references` and `work-references` fit. `context_sizes.py` reports this.
- `compile_ready_wave` was iterated with labeled **projection fixtures**: synthetic accepted results and, in the second projection, fixture-satisfied activation evidence. These are not project evidence. Model requests were `claude-opus-5-5`/high under `claude_frontier`. Every round compiled capsule and assignment drafts with no writer collision.

| Round | Explicit predicates unbound | All predicates fixture-satisfied |
| --- | --- | --- |
| 1 | bind-foundation | bind-foundation |
| 2 | workspace-skeleton | workspace-skeleton |
| 3 | social-core, ui-kit, work-core | adds reference-contract, service-bridge |
| 4 | social-content, social-workbench, work-board, work-views | adds reference-shell, reference-ui, social-live-adapter, work-live-adapter |
| 5 | social-domain, work-domain | adds shell-chrome |
| 6 | domain-integration | adds social-references, work-references |
| 7 | — | reference-integration |
| 8 | — | campaign-verification |
| Unreleased | reference-contract, reference-shell, reference-ui, social-references, work-references, reference-integration, service-bridge, shell-chrome, social-live-adapter, work-live-adapter, campaign-verification | none |

Draft counts matched the ready sets in every round. With predicates unbound, `campaign-verification` is unreleased because it depends on `reference-integration`. The campaign is therefore not verifiable until the reference contract's custody arrives. That is a truthful gate, not a defect.

**Helper validation record (revision 4).** The record is in `docs/evidence/hq-social-work/integration/integration-plan-validation.md`.

- `parse_engineering_spec_plan` parsed 27 tasks and 27 intents at `7468e88`.
- Every context is ≤ 32 KiB.
- The actual round, using the ten root-accepted results, releases exactly `work-domain`. Its capsule SHA is `071dbea0…`.
- Both from-actual projections compile with no writer collision, and the activated one releases everything by round 5.
- The from-scratch activated counterfactual stops in round 3 with `reference_bound_exceeded`. That wave cannot occur, because three of its five tasks are accepted.

**Thread registration.** Request `hq-t1-social-work-plan-20261020-r1` returned `registration_unavailable` with `effect: none`. This is nonfatal, and it was not retried. The identity arguments are withheld from this public note.

**Scratch.** All helper scripts now live in `docs/work-notes/hq-social-work-tools/`. They read the catalog projection from the committed spec, and they write no scratch. The earlier task-owned `/tmp` scratch directory was removed after the move.
<!-- codex-section:end id="worknote.hq-social-work#ctx.evidence.001" -->

## Next Action

<!-- codex-section:begin id="worknote.hq-social-work#ctx.next-action.001" -->
**Owner execution direction (relayed by the root, 2026-10-20).** The owner explicitly authorizes proceeding through the Work domain to a usable, published Social+Work integration branch, in Claude Frontier mode. This supersedes only T1's earlier docs-only finish and no-descendants restriction. T1 is the HQ-native mechanical launch parent and bounded fan-in owner for **exactly two** fresh implementation children. Every new worker runs `claudeAgent` / `claude-opus-5-5` / `high` / `fastMode: false`. Both launch via `delegate_task` (role implementation, async, worktree isolation) from T1's committed, published plan head.

1. **A: `task.work-domain.001`.** Request ID `hq-work-domain-impl-20261020-r1`.
   - It merges exactly `3ca74d7479283d8ac7acf7c363bd262f34578ed4` into its own branch.
   - Scope is exactly `modules/work/index.tsx`, `modules/work/nav/**`, `modules/work/skeleton.test.ts` and `docs/evidence/hq-social-work/work-domain/**`.
   - Behavior follows `ac.work-domain.001`.
   - It publishes a non-draft PR against `work/hq-work-board` and does not advance the board, planner or plan branches.
2. **B: `task.domain-integration.001`.** Request ID `hq-sw-assembly-impl-20261020-r1`.
   - It launches **only after** T1 has inspected A's published candidate and accepted it.
   - It merges exactly `9735b741e94baad83d9f7dc5f3bb8ce9c3778b2d` and A's accepted head.
   - Its authored paths are the new `apps/desktop/src/social-work.integration.test.tsx`, `docs/evidence/hq-social-work/integration/social-work/**`, and `apps/desktop/src/modules.tsx` only if needed.
   - It proves `ac.sw-assembly.001` and publishes one non-draft PR against `work/hq-social-work-plan`.

**Constraints on both children:**

- no other children, reviewers or top-level threads;
- children have no descendants and never write in T1's checkout;
- no PR merge, bots, timers, PR monitors, Design messaging or joint Design integration;
- App, styles, contracts, storage, IPC and catalog stay held;
- launches are admitted by fresh telemetry: none at CPU ≥ 90% or RAM ≤ 3 GiB, and tests only below 85% CPU, serially.

Fan-in: completion is not acceptance. T1 inspects scope, ancestry, evidence, checks and cleanliness. Its acceptance is bounded fixture/source acceptance, not independent review or green CI. A material blocker goes once to the root; T1 makes no P2–P4 fixes.

**Execution log.**

- Revision 4 was published at plan head `72854ab6a7c78306dbf078d9b5db7412e4a13ab9`; its spec blob `aabcf8a1` is the validated one.
- Thread registration request `hq-t1-social-work-plan-20261020-r4` returned `registration_unavailable` (`endpoint_unavailable`), with `effect: none`. It was not retried.
- **A launched** on 2026-10-20 at 04:23Z.
  - Route: `delegate_task` (implementation, async, worktree), request `hq-work-domain-impl-20261020-r1`, target `claudeAgent` / `claude-opus-5-5` / `high` / `fastMode: false`.
  - Admission telemetry: CPU 19.50%, 44.23 GiB available.
  - Before any write, the child read back its binding: a separate native HQ worktree on its own branch at `72854ab`, clean. Its capsule is the compiled `071dbea0…`.
  - Native identities went to the root by native message only.
- B is not launched.

**Owner direction delta (relayed by the root, 2026-10-20).** The Social/Work stack is to sit on top of the Local Design Hub stack, with all our content made compatible on the Design shared base, not merely handed off in documentation.

- **A and B continue unchanged** under their exact scopes, so the usable source candidate is still produced. Child A keeps its model and worktree.
- **Read-only scout.** The root is launching one read-only Design-parent scout.
- **Before any Design-parent integration or PR retarget,** T1 consumes the scout's exact Design assembly branch, head and ownership evidence, and extends this same progressive spec. There is no second plan.
- **Preferred shape:** one additive joint continuation based on the verified Design assembly parent, containing our accepted assembly.
  - Published branch chains are recorded separately from native GitHub stack membership.
  - Existing PR refs and history stay intact, and merges stay held.
  - No mass rebase, force push or retarget.
  - No overlapping Design, App, styles, config, contracts or catalog writes.
- **Limits.** A future source child C needs an exact plan, base and ownership release from the root; the current allowance stays A+B. No Wiki work now.

**Prerequisite observed by T1 (read-only, 2026-10-20).**

- No published Design assembly parent exists yet. Origin has `work/hq-design-plan` at `fa244847` but no `work/hq-design-integration*` branch, and no open PR has such a head.
- A local Design integration checkout exists. It is unpublished, so it is not a usable parent.

**Revision 5 (2026-10-20): the Design-first scout is consumed.** The root's read-only scout result (SHA-256 `2bd169a8…`) is encoded at `7ab7f2e5517dcfee2334548e0a27d78f1921d5e7`, spec blob `d38be0f9`, and validated with the real helpers (`docs/evidence/hq-social-work/integration/integration-plan-validation.md`).

- **Joint continuation.** It is one additive branch at the exact accepted, published Design head D, with a normal merge of the accepted Social+Work head S. Its PR is based on the Design branch that contains D. All prior PR refs are preserved, with no rebase, force push or mass retarget.
- **Unbound activation bindings:** D, S, Design wiring, root-file custody (with a `vite.config.ts` decision) and C's release. No Design assembly parent is published; the local head is not a parent.
- **No native GitHub stacks exist.** `PullRequest.stack` is null on all 24 open PRs, so every chain is a base-branch chain.
- **Ownership.** Future C is the proposed sole writer of the six R0 root paths, plus `apps/desktop/src/joint.integration.test.tsx` and the joint evidence. `vite.config.ts` is unassigned. App, styles, contracts and IPC stay held. No workflow custody is implied: Design owns its workflows and the check catalog. B's new test stays an immutable dependency.
- **Root interpretations.** The hold is on PR merge, not on publishing an authorized, scoped PR. Design's predecessor PRs need not merge before stacked work. The Design coordinator is not contacted, and cross-owner proposals go to issue #1 only.
- **Unchanged:** A→B, and the child allowance of A+B. No C checkout and no C source edit.

**T1 (now):** fan in A, then launch B, fan in B, keep PR #3 current, and hold after B's published candidate.

**Root coordinator:** decide the remaining shared gates:
  - the catalog delta merge, with Design;
  - reference contract and `App.tsx` custody;
  - contracts/IPC custody for the bridge;
  - a named UI owner for the shell chrome;
  - the G-3 storage member;
  - the font provenance check.
<!-- codex-section:end id="worknote.hq-social-work#ctx.next-action.001" -->

## Blocker Or Decision

<!-- codex-section:begin id="worknote.hq-social-work#ctx.blocker-decision.001" -->
**Owner decisions received (2026-10-20):**

- D-1: approved for three checked files;
- D-2: source bridge next, with custody still required;
- D-3: deferred;
- D-4: core reference plan now.

All four are recorded in `spec.hq-social-work#ctx.research-decision-basis.001`.

**Remaining gates:**

- `tests/check-groups.toml` is Design-owned. Only the additive delta is proposed. Affected-check validation stays a projection until the delta merges.
- `App.tsx` and `styles.css` are released by T0 but unassigned. Shell chrome and the reference shell wait for a named owner.
- Shared contracts, preload, main and the bridge are outside every current transfer.
- Live data, service schema changes and deployment are held behind `ctx.operator-interaction-inventory.001`.
- Merge is held.

**Root decisions still open:**

- name the UI-state storage port (G-3);
- accept or amend `iface.references.001` and `iface.service-bridge.001`;
- the font OFL provenance check.
<!-- codex-section:end id="worknote.hq-social-work#ctx.blocker-decision.001" -->

## Deferred findings

<!-- codex-section:begin id="worknote.hq-social-work#ctx.deferred-findings.001" -->
- **Codex V3 planning helpers, P3 tooling inconsistency.** Against source `4beb491c44551b6e4207adcc7459c4b11407bcbc`, `specification_plan._scope_paths` accepts a trailing `/` on write-scope literals. But `wave_compiler._reject_writer_collisions` passes the raw literal to `portable_collision_key`, which rejects a trailing `/`. The result is `ValueError` at compile time. This plan works around it with slash-free directory literals. Not fixed here: it is outside this writer cone, and P2–P4 findings are not implemented without owner direction.
- **Codex V3 planning helpers, P4 context bound.** Against `4beb491c…`, `compile_ready_wave` enforces a default 32 KiB resolved-context bound per task, which includes default context. This plan fits by moving the foundation binding record out of the default context. Recorded only.
- **Codex V3 planning helpers, P4 wave aggregate bound.** Against `4beb491c…`, `compile_ready_wave` resolves one combined section request per wave under `ResolutionLimits.max_selected_bytes` (64 KiB by default). A from-scratch, all-predicates-satisfied round 3 of this plan therefore stops with `reference_bound_exceeded` at 66,117 bytes, even though every task is within its own 32 KiB bound. Live-path waves fit. Recorded only.
- **Codex V3 planning helpers, P4 ergonomics.** `compile_ready_wave` requires model requests that exactly cover the ready set, so the caller must supply an expected ready set for the compiler to confirm. This matches the helper's own conformance tests. Recorded only.
<!-- codex-section:end id="worknote.hq-social-work#ctx.deferred-findings.001" -->

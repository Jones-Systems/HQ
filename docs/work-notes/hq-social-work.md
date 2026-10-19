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
- the implementation plan, `docs/engineering-specs/hq-social-work.md`, whose 17 tasks and 17 Test Intents were parsed and wave-compiled by the real Codex V3 helpers;
- this note.

The plan proposes five implementation lanes (UI, SOC-C, SOC-W, WRK-P, WRK-B) plus root-owned serialized shared tasks. Implementation is **not** runnable yet: it waits for the root-accepted T0 baseline (`ac.foundation-baseline.001`). The plan is already bound to T0's published candidate `work/hq-foundation` `33dfe44d6786b40ac8a5dcb5442d85c20da38c67` (draft PR #2), which was read back after the first plan push. No code, root file, contract, Design document or other lane's file was changed. No lane was launched.
<!-- codex-section:end id="worknote.hq-social-work#ctx.outcome.001" -->

## Current State And Evidence

<!-- codex-section:begin id="worknote.hq-social-work#ctx.evidence.001" -->
**Guidance adopted (owner-directed, 2026-10-20).**

- Codex V3 root guidance: `Jones-Systems/Codex-V3`, `AGENTS.md` at `4beb491c44551b6e4207adcc7459c4b11407bcbc`, blob `3402719bc3a09e7e08ed113425d7137818eda25c`, 30,716 bytes, SHA-256 `1238a90adbf10ea8f2359f90ed0c7bf99fc1121589dcde5b99881fd247e87ce6`. All 444 lines were read.
- HQ target `AGENTS.md` was read.
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
2. **Delivery.** The Codex V3 delivery default (non-draft PR, then merge) conflicts with the held merge. The PR is a draft checkpoint until the plan is published.
3. **Model routing.** Claude Frontier routing is overridden by the explicit owner instruction `claude-opus-5-5`/high.
4. **Native IDs vs public repository.** Codex V3 asks contributors to record native IDs, but this repository is public. Public artifacts carry only T-labels and roles; native identities go to the root through native messages.

**Sources.** Every source was read-only, with no live data. The table is in `spec.hq-social-work#ctx.research-decision-basis.001`.

**Contributors.**

- T1 planner, `claude-opus-5-5`/high.
- One read-only Explore sub-agent that inventoried the Manual Planner source. Its model is per its agent definition and was not separately observed. It completed and mutated nothing. It was launched before T1 noticed the no-descendant restriction. That is a deviation from the capsule; its result was reused and nothing else was delegated.

**Telemetry before the helper batches.** Linux admission: CPU 7.21% used, 45.92 GiB available, one full core is 6.25% of capacity, batch ceiling 10, one serial test process. Load average was rechecked before each compile batch.

**Helper validation record.**

- Spec commit `6e1b904f8a202ba15c986f413503fe151f0ba0a0`, spec blob `855da7633318a982a5759d5ef2babd005c365f28`. This revision is bound to the T0 candidate. Earlier runs at `041d868…` and `cdf6eaa…`, made before the T0 path binding, gave the same ready sets.
- `parse_engineering_spec_plan` parsed 17 tasks and 17 intents.
- Catalog binding: proposed manifest bytes from `spec.hq-social-work#ctx.check-catalog.001`, SHA-256 `02323e45f1c92c8a7c31478099d463fe3e1927f5b4db84fa960e4cacd95873b0`, nine groups. This manifest is **not** present in HQ (gap G-4).
- `compile_ready_wave` was iterated with labeled **projection fixtures**: synthetic accepted results and, in the second projection, fixture-satisfied activation evidence. These are not project evidence. Model requests were `claude-opus-5-5`/high under `claude_frontier`.
- Every round compiled capsule and assignment drafts with no writer collision:

| Round | Explicit predicates unbound | All predicates fixture-satisfied |
| --- | --- | --- |
| 1 | bind-foundation | bind-foundation |
| 2 | workspace-skeleton | service-bridge, workspace-skeleton |
| 3 | social-core, ui-kit, work-core | same |
| 4 | social-content, social-workbench, work-board, work-views | adds shell-chrome, social-live-adapter, work-live-adapter |
| 5 | social-domain, work-domain | same |
| 6 | domain-integration | same |
| 7 | campaign-verification | same |
| Unreleased | service-bridge, shell-chrome, social-live-adapter, work-live-adapter | none |

The draft counts per round matched the ready sets: 1, 1, 3, 4, 2, 1, 1 in the unbound projection and 1, 2, 3, 7, 2, 1, 1 in the satisfied one. Lane capacity serializes same-lane tasks within a round. In round 4, social-live-adapter follows social-content in SOC-C, and work-live-adapter follows work-views in WRK-P.

**Thread registration.** Request `hq-t1-social-work-plan-20261020-r1`, expected revision 0, plan bytes SHA-256 `685c7ce11299251a13e820f4a3c9420062552b8d808ac6cb53a2df55f17a366a` at spec commit `041d868…`. The result was `registration_unavailable`, `effect: none`, `endpoint_unavailable`. This is nonfatal. No enrollment or repair was attempted. The identity arguments are withheld from this public note.

**Mockup lanes.** T2 (`work/hq-visual-system`), T3 (`work/hq-social-design`) and T4 (`work/hq-work-design`) had no published commits at plan time. Their dependency points are in `spec.hq-social-work#ctx.task-plan.001`.
<!-- codex-section:end id="worknote.hq-social-work#ctx.evidence.001" -->

## Next Action

<!-- codex-section:begin id="worknote.hq-social-work#ctx.next-action.001" -->
**Root coordinator:**

1. Accept the T0 baseline and run `task.bind-foundation.001`. Publish any path or name rebind as a plan delta.
2. Run `task.workspace-skeleton.001`.
3. Launch UI, SOC-C and WRK-P on the skeleton commit. Launch SOC-W and WRK-B at the same time to do their ready-now preparation; their first gate is the sibling core commit. Use the capsules in `spec.hq-social-work#ctx.lane-capsules.001`, each carrying the mandatory preflight.
4. Put D-1 through D-4 to the owner.

**T1:** apply root-requested plan deltas as new commits on this branch. Otherwise idle until fan-in accounting is requested.
<!-- codex-section:end id="worknote.hq-social-work#ctx.next-action.001" -->

## Blocker Or Decision

<!-- codex-section:begin id="worknote.hq-social-work#ctx.blocker-decision.001" -->
- **Implementation gate.** T0 code is published as candidate `33dfe44` but unaccepted (G-1). Literal paths and contract names are bound to that candidate and are confirmed only at acceptance. No compiler-validated runnable implementation is claimed for module code.
- **T0 facts with plan impact:**
  - modules are remounted on every domain switch;
  - `ModulePort` has no storage (G-3);
  - the vitest include covers `*.test.ts` only, with no DOM environment;
  - workspaces and `tsconfig` includes are explicit lists, so the skeleton task must edit them;
  - CSP `connect-src 'none'` forces live access through the bridge.
- **Owner decisions** (defaults allow progress):
  - D-1: selected-file import of the Planner's pure logic;
  - D-2: the live service bridge;
  - D-3: Planner schema extensions for editable lists, boards and labels;
  - D-4: cross-domain references stored on cards.
- **Root decisions:**
  - adopt the proposed check catalog (G-4);
  - accept or amend `iface.service-bridge.001`;
  - name the UI-state storage port (G-3);
  - transfer shell-chrome custody (`ac.custody-transfer.001`).
<!-- codex-section:end id="worknote.hq-social-work#ctx.blocker-decision.001" -->

## Deferred findings

<!-- codex-section:begin id="worknote.hq-social-work#ctx.deferred-findings.001" -->
- **Codex V3 planning helpers, P3 tooling inconsistency.** Against source `4beb491c44551b6e4207adcc7459c4b11407bcbc`, `specification_plan._scope_paths` accepts a trailing `/` on write-scope literals. But `wave_compiler._reject_writer_collisions` passes the raw literal to `portable_collision_key`, which rejects a trailing `/`. The result is `ValueError` at compile time. This plan works around it with slash-free directory literals. Not fixed here: it is outside this writer cone, and P2–P4 findings are not implemented without owner direction.
- **Codex V3 planning helpers, P4 ergonomics.** `compile_ready_wave` requires model requests that exactly cover the ready set, so the caller must supply an expected ready set for the compiler to confirm. This matches the helper's own conformance tests. Recorded only.
<!-- codex-section:end id="worknote.hq-social-work#ctx.deferred-findings.001" -->

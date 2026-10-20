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

R0 (`task.bind-foundation.001`) is complete as a read-only binding. R1 (`task.workspace-skeleton.001`) is assigned to T1 and is next. No module feature code was written, and no lane was launched.
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

**Thread registration.** Request `hq-t1-social-work-plan-20261020-r1` returned `registration_unavailable` with `effect: none`. This is nonfatal, and it was not retried. The identity arguments are withheld from this public note.

**Scratch.** All helper scripts now live in `docs/work-notes/hq-social-work-tools/`. They read the catalog projection from the committed spec, and they write no scratch. The earlier task-owned `/tmp` scratch directory was removed after the move.
<!-- codex-section:end id="worknote.hq-social-work#ctx.evidence.001" -->

## Next Action

<!-- codex-section:begin id="worknote.hq-social-work#ctx.next-action.001" -->
**T1 (assigned):**

1. **R1, `task.workspace-skeleton.001`.**
   - Merge `35f9a3e` normally into this branch.
   - Edit only the released paths plus the new workspace stubs.
   - Take fresh telemetry admission.
   - Run `npm install`, `npm run typecheck`, `npm test` and `npm run build`.
   - Publish, then send the root the exact passing commit and the per-dependent gates.
2. Post the additive catalog delta and the content-scheme pin requirement on coordination issue #1.

**Root coordinator:**

- At R1 readiness, launch UI, SOC-C, SOC-W, WRK-P and WRK-B from the capsules in `spec.hq-social-work#ctx.lane-capsules.001`.
- Decide the remaining shared gates:
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
- **Codex V3 planning helpers, P4 ergonomics.** `compile_ready_wave` requires model requests that exactly cover the ready set, so the caller must supply an expected ready set for the compiler to confirm. This matches the helper's own conformance tests. Recorded only.
<!-- codex-section:end id="worknote.hq-social-work#ctx.deferred-findings.001" -->

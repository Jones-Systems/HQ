# Engineering Spec — HQ integration parallel execution

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.artifact-header.001" -->
Artifact Type: `engineering-spec`

Artifact ID: `spec.hq-integration-parallel-execution`

Purpose: Divide the remaining HQ integration into scoped concurrent lanes that end in one working, merged desktop app.

Governing artifact: `spec.hq-bootstrap`

Specification owner: HQ integration root (T1)

Integration owner: HQ integration root (T1)

Consumers: T1 through T7 lanes, compiler, verifier

Authority effect: none
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.artifact-header.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.project-summary.001" -->
## Project Summary

**Outcome:** one HQ Electron app on `main` in which Design, Social, Work and Wiki are mounted, use real local service paths, persist and replay state across restart, and round-trip cross-domain references. The app is verified at one exact head and installed on the owner's laptop through a proved route, or the exact platform gap is recorded.

**Finish line:** `work/hq-foundation` holds every landed slice. Final acceptance passes on that exact head, and T1 merges #2 into `main` last with readback. Accepting source alone does not deliver it.

**Amends, does not replace:** `spec.hq-bootstrap`, `spec.hq-design`, `spec.hq-social-work` and `spec.hq-expansion` keep their requirements and acceptance. This amendment adds lane ownership, the shared transport contract, and landing order. It is the only shared plan; lanes do not write duplicate project plans.

**Lanes:**

| Lane | Owner | Outcome |
| --- | --- | --- |
| T1 | Integration root | Continuity, shared-ref landings, main sync, #2 delivery |
| T2 | Existing Design coordinator | C (#49), and the already-active F2 shared bridge as sole shared writer; then live wiring and Wiki mount |
| T3 | Existing Social builder | Social live adapter (#48), module-only |
| T4 | Existing Work runtime builder | Work live runtime and replay, module-only |
| T5 | — | CLI stack #46 is merged and closed; no lane is launched |
| T6 | Wiki builder (new root delegate in place of the unavailable Missing-concepts start) | Wiki module assembly, module-only |
| T7 | Acceptance builder/verifier | Electron acceptance harness, install route, final acceptance |

**Scope boundary, not goal reduction:** the owner's full goal stays in force. Every requirement and protected gate in the existing specs remains a completion obligation. These new lane tasks leave out only items the existing specs already defer explicitly or hold behind their own protected gates: Design component-execution qualification, privacy-safe export, real receiver dispatch and private corpus connection. Those items keep their owners and gates. Signing, notarization, release and deployment were never authorized.

While any required feature is held, final reports say exactly that. They never call the app "working" or "complete".
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.project-summary.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.source-integration.001" -->
## Source Integration Requirement

Every slice lands on `work/hq-foundation` with an ordinary merge commit at an exact head, after green exact-head checks. Every original PR ends actually merged; all except #2 already are. #2 is the only path to `main` and merges last.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.source-integration.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.domain-runtime.001" -->
## Domain Runtime Requirement

The shell mounts Design, Social, Work and Wiki. Each domain restores its own destination and state, and domain switches, card moves and reference navigation never launch work.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.domain-runtime.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.service-transport.001" -->
## Service Transport Requirement

Social and Work use real local service paths through closed, typed main-process routes that follow `iface.service-response.001`. Status is truthful: available, unavailable, unknown or replayed. Labelled synthetic services remain the default for tests.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.service-transport.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.wiki-mount.001" -->
## Wiki Mount Requirement

Wiki appears fourth in the rail and reads committed Git objects through the host port in `iface.wiki-host-ipc.001`, following `spec.hq-expansion#req.wiki.001`. Tests use synthetic corpora only.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.wiki-mount.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.acceptance.001" -->
## Acceptance Requirement

A real Electron run proves the integrated behavior on the final head. Laptop installation uses only an owner-authorized route.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.acceptance.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.source-landing.001" -->
## Source Landing Acceptance

For each landing, readback shows the target ref at the expected merge commit, the PR merged at its exact head, and ancestry containing that head. Nothing is forced, rebased or deleted.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.source-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.module-candidates.001" -->
## Module Candidate Acceptance

A module or C candidate is a published non-draft PR against `work/hq-foundation`. Its diff stays inside the lane's literal write scope, its named tests pass, its exact-head hosted checks are green, and its evidence labels synthetic data as synthetic.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.module-candidates.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.shared-runtime.001" -->
## Shared Runtime Acceptance

Root typecheck, test and build cover every domain, including Wiki. Electron security tests pass. Live paths behave as `iface.service-response.001` requires, and tokens never reach the renderer.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.shared-runtime.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.working-app.001" -->
## Working App Acceptance

Every requested Design, Social, Work and Wiki function in the existing specs is closed, or explicitly reported as held with its gate. On one exact head, the following pass:
- `npm ci`, typecheck, test and build;
- the Wiki Node tests;
- the CLI and Planner tests;
- the Electron harness: four-domain round trip, restart persistence and replay, reference round trips, and truthful unavailable/unknown states.

The final candidate is installed and launched on the laptop through the proved route, or the exact gap is recorded. A gap is never reported as a pass.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.working-app.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.main-delivery.001" -->
## Main Delivery Acceptance

`main` contains the accepted #2 head through a merge commit, #2 is merged, and the original-PR disposition audit is complete.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.main-delivery.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.research-decision-basis.001" -->
## Research And Decision Basis

No new broad research. This amendment reuses the accepted merge strategy: CLI as the only native stack, merge commits, ancestry auto-marking, and #2 last. It also reuses the existing published HQ specs and current native GitHub reads.

**Landed (read back 2026-10-20). All original PRs except #2 are actually merged:**
- CLI stack #46 (#40, #42, #43, #44, #47) merged; `main` = `bc8202a9731d51922c7cddde91f6ada0074adc1d`.
- Design aggregate #41 and Design plan #4 merged into foundation.
- Social/Work assembly #36 merged.
- Wiki #34, #38 and #39 merged into the Social/Work plan, and #3 merged into foundation; `work/hq-foundation` = `11a6839e9acdae0f74cd493eaa0316340f1543f1`.

**Open:**
- C #49 at `6f2eddfd87453b6f21ac90c8d7d1fcafb9e02961`, now based on foundation `11a6839`. Its implementation is accepted, and the existing C writer is normalizing it by an ordinary merge.
- F2 shared bridge: active under the Design owner on an isolated successor of the accepted C implementation and F1. It is not yet published.
- Social live #48 at the corrected head `d9359d3b9df67e09b66a122224b54489548f7d2f` (the failed-read fix), awaiting Social acceptance.
- #2 (draft).
- Issue #45: Work Planner connection.

**Decisions:**
- One sole shared writer (T2) serializes root config, contracts, IPC, main and preload through C → bridge → live wiring → Wiki mount.
- Module lanes write only module paths.
- T1 alone lands PRs on shared refs.
- `main` is merged into foundation so tests can run the real Planner from the feature base.
- The acceptance harness adds no npm dependency, so it never touches the lockfile.

**Unknowns:**
- Laptop install route and platform.
- The HQ-specific Electron harness. The host has Xvfb, bubblewrap, user namespaces and fonts, but the Jones Code harness rejects HQ's layout.
- The CI Node version for Wiki (needs ≥22.18; the `engines` field says ≥22.12).
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.research-decision-basis.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.change-surface.001" -->
## Exact Change Surface And Ownership

Only one writer owns a path at a time. Each task block's `write_scope` gives its literal paths.

- **T2 (one shared owner, serialized):** root manifests, scripts and lockfile, `tsconfig.json`, `tsconfig.design-host.json`, `vitest.config.ts`, `.github/workflows/foundation.yml`, `apps/desktop/**` (including the Design host compatibility layer and ServiceSettings), `packages/contracts/**`.
  - C also owns the two agreed registry tests under `modules/social/nav/test/` and `modules/work/nav/test/`.
  - C normalization and F2 may run in parallel only because one Design owner serializes their overlapping root files.
  - The later Wiki root configuration goes through the same owner.
  - T2 reconciles F2's actual path list against this cone. Any path outside it, such as under `modules/design/`, needs a T1 rebind.
- **T3:** `modules/social/live/**`, `modules/social/index.tsx`, `modules/social/nav/workspace.ts`, `modules/social/nav/test/source.test.tsx`, `docs/evidence/hq-social-work/social-runtime/**`.
- **T4:** `modules/work/{live,core}/**`, `modules/work/index.tsx`, `modules/work/nav/session.ts`, `docs/evidence/hq-social-work/work-runtime/**`.
- **T6:** `modules/wiki/**`, `docs/evidence/hq-wiki/**`.
- **T7:** `tests/acceptance/**`, `docs/evidence/hq-integration/acceptance/**`.
- **T1:** shared refs and PR bases, `docs/engineering-specs/hq-integration-parallel-execution.md`, and the `tests/check-groups.toml` catalog amendment.

A needed edit outside a lane's scope goes to T1 as a rebind request; lanes never edit across scopes silently. Module lanes do not edit `packages/contracts`. They declare structurally identical module-local transport types, and T2 proves those types are assignable to the canonical one.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.change-surface.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.contracts.001" -->
## Interface Contracts

Two shared contracts govern concurrent lanes: `iface.service-response.001`, owned by T2 in `packages/contracts` and consumed by T3, T4 and T7; and `iface.wiki-host-ipc.001`, owned by T2 in main/preload and consumed by T6 and T7. Changing either needs a T1 rebind of every consumer.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.contracts.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.service-response.001" -->
## Service Response Contract

```ts
type ServiceResponse<B> =
  | { ok: true; status: number; body: B; replayed: boolean }
  | { ok: false; kind: 'unavailable' | 'unknown' };
```

- `ok: true` is transport-only. It covers every received HTTP response, including 4xx and 5xx, and adapters branch on `status`. An empty body is `null`. A missing `replayed` is `false`.
- A failed read is `unavailable`. A malformed or lost mutation is `unknown`. A Work 5xx write is `unknown` and keeps the caller request ID for reconciliation by replay.
- Never retry an unknown write or `submitRun`. Never fall back from live to fixture.
- Routes are closed and typed. Configuration and tokens exist only in main.
- After a 403, refresh at most once, and only when the response matches the exact Social token-rejection predicate.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.service-response.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.wiki-host-ipc.001" -->
## Wiki Host IPC Contract

The renderer gets exactly the seven `WikiService` methods from the merged Wiki contract:
- `listSources`
- `search`
- `getPage`
- `resolveAlias`
- `getBacklinks`
- `listTopics`
- `indexStatus`

Each returns `WikiResult`. `refresh` and home migration are host-only in main over `modules/wiki/core`. Requests are validated by the contract guards, and there is no arbitrary path, filesystem or shell access. CSS ships as an external file under the existing CSP.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.wiki-host-ipc.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.test-plan.001" -->
## Test Plan

Each task names its Test Intent and check groups.

New groups for the `tests/check-groups.toml` amendment:
- `hq-root-build`
- `hq-cli-planner`
- `hq-social-live`
- `hq-work-runtime`
- `hq-wiki-module`
- `hq-shared-bridge`
- `hq-electron-acceptance`
- `hq-source-readback` (native readback only)

Rules:
- Run the exact behavior test while editing.
- At a candidate, run the lane's groups plus `hq-root-build` whenever shared files changed.
- The final union runs once on the final head.
- Take a fresh CPU admission sample before each test run, under the host's admission policy.
- Hosted checks attach only through `foundation.yml` and `design-sections.yml`. Report absent checks as absent, never as green.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.test-plan.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001" -->
## Operator Interaction Inventory

| Phase | Owner action | Executing route | Boundary and readback |
| --- | --- | --- | --- |
| Build, test, publication, landings, #2 merge | None; covered by the owner's in-scope merge authority | Ordinary user, isolated HQ worktrees, GitHub | Exact-head checks; ref/PR/ancestry readback; no sudo |
| Electron acceptance on the check host | None | Ordinary user, owned temporary profile | Stops with a recorded gap if no display exists; no package installation |
| Laptop install and launch | None if the proved route is already authorized | Existing owner-authorized capability found by `install-route` | Unsigned local build only; any elevation, signing or credential need stops with a disclosed gap |
| Private corpus connection | Owner configures sources in the app later | Read-only corpus port | Outside this campaign's tests; never published |
| Recovery | None | Forward revert on a feature branch | No force, rewind, cleanup or deletion; unknown effects are reconciled first |
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t1.001" -->
## T1 Integration Root

T1 is the continuity owner and the only mutator of shared refs and PR bases.

Work ready now:
- `main-sync`;
- retarget #48 to `work/hq-foundation` (#49 is already retargeted);
- create the coordination issue and publish its bootstrap.

Then land each candidate as it qualifies, in completion order: `shell-landing`, `bridge-landing` (only after #49), `social-landing`, `work-landing`, `wiki-landing`, `harness-landing`. Merge #2 last.

T1 never waits for unrelated lanes. Each landing is one serialized operation on `work/hq-foundation`.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t1.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t2.001" -->
## T2 Shared Writer

The existing Design coordinator owns this lane. C's implementation is accepted, so F2 continues in parallel with #49 normalization and landing.

- **Ready now:** C normalization and repairs, and F2 implementation. F2 is already active on its isolated C+F1 successor and is not rescheduled.
- **Landing gate:** only F2's integration (`bridge-landing`) waits for #49 to land. Live wiring and the Wiki mount follow F2's landing.
- **Ordering:** live wiring precedes the Wiki mount because they share files. If Wiki lands first, T1 may swap the order by amendment.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t2.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t3.001" -->
## T3 Social Live

The existing Social builder finishes #48 now, starting with the failed-read-is-unavailable contract fix. The work is module-only. Integration with the real transport comes later through T2's live wiring.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t3.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t4.001" -->
## T4 Work Runtime

The existing Work runtime builder works now on module-local code and tests, using the Planner wire fixtures. Live tests against a real Planner service use foundation after `main-sync`.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t4.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t6.001" -->
## T6 Wiki Assembly

T6 is ready now from foundation, which already contains the Wiki contract, core and UI. It is module-only: the assembly and the synthetic-corpus tests. T2 mounts Wiki later.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t6.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t7.001" -->
## T7 Acceptance

T7 is ready now: build an HQ-specific native harness against the #49 head, and run the read-only `install-route` research. The host provides Xvfb, bubblewrap, user namespaces and fonts. The Jones Code harness rejects HQ's layout; HQ's layout is not changed to suit it. The harness stays separate from Design production code and tests. Final acceptance waits for everything to land.

The harness owns its scratch profile and processes. It removes exactly those on success, failure and cancellation, after preserving the evidence it needs.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t7.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.task-plan.001" -->
## Parallelization And Task Plan

| Task | Lane | Depends on |
| --- | --- | --- |
| `main-sync` | T1 | — |
| `joint-shell` | T2 | — |
| `social-live` | T3 | — |
| `work-runtime` | T4 | — |
| `wiki-assembly` | T6 | — |
| `acceptance-harness` | T7 | — |
| `install-route` | T7 | — |
| `shell-landing` | T1 | `joint-shell` |
| `social-landing` | T1 | `social-live` |
| `work-landing` | T1 | `work-runtime` |
| `wiki-landing` | T1 | `wiki-assembly` |
| `harness-landing` | T1 | `acceptance-harness` |
| `shared-bridge` | T2 | `joint-shell` (accepted implementation; already active) |
| `bridge-landing` | T1 | `shared-bridge`, `shell-landing` |
| `live-wiring` | T2 | `bridge-landing`, `social-landing`, `work-landing`, `main-sync` |
| `wiki-mount` | T2 | `live-wiring`, `wiki-landing` |
| `final-acceptance` | T7 | `wiki-mount`, `harness-landing`, `install-route` |
| `main-delivery` | T1 | `final-acceptance` |

**Initially ready (seven):** `main-sync`, `joint-shell`, `social-live`, `work-runtime`, `wiki-assembly`, `acceptance-harness`, `install-route`. Their write scopes are disjoint.

**Accepted state today:** `joint-shell`'s implementation is accepted, so `shared-bridge` is in flight now. The compiler projection still lists `joint-shell` as initially ready until its accepted result is fed back.

**Model hints (claude_frontier):**
- **T6 Wiki assembly:** builds with native `claude-sonnet-5-5`/high under the task-scoped override for the three extensions, kept in `spec.hq-expansion#ctx.project-summary.001` (HQ `work/hq-foundation` `11a6839e9acdae0f74cd493eaa0316340f1543f1`). The typed helper has no Sonnet entry, so compiler capsules carry a labelled placeholder that proves nothing about the model.
- **New T7 harness:** Astra/medium. The old Design-section Opus builder instruction is not extended to new builders. Retrieval, verification mechanics and research use Sol/medium. Verification judgment uses Astra/high where it applies. In-flight Design and Social assignments keep their existing tuples.

**Release:** there is no wave barrier. Each landing releases as soon as its own candidate qualifies. The shared-writer chain is deliberately serial.

**Coordination channel:** one HQ issue, "HQ integration campaign coordination", created by T1. It holds:
- lane registration;
- source identities;
- claimed scopes;
- readiness;
- the landing queue;
- rebind requests.

Every lane reads and comments on the issue directly. No lane relays status through the owner.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.task-plan.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.stop-recovery-delivery.001" -->
## Stop, Recovery, And Delivery Boundaries

**Stop the affected effect only** on:
- a stale head or base;
- an overlapping writer;
- an unexpected change;
- an unknown effect;
- contract drift;
- failed checks;
- an unresolved P0 or P1.

**Recovery:** reconcile before any retry. Repair forward by revert; never force, rewind or delete.

**Review:** zero independent reviewers by default. One focused lens is allowed only where it is materially useful, and never a bot. Record P2–P4 findings with their original severity and report them after delivery.

**Delivery:** lanes publish non-draft PRs against `work/hq-foundation` and own repairs through green exact-head checks. T1 lands them and merges #2 last. A lane's finish line is the readback of its landed PR, not "source written".
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.stop-recovery-delivery.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#plan.implementation.001" -->
```json
{
  "schema_version": 1,
  "default_context_refs": [
    "spec.hq-integration-parallel-execution#ctx.project-summary.001",
    "spec.hq-integration-parallel-execution#ctx.change-surface.001",
    "spec.hq-integration-parallel-execution#ctx.stop-recovery-delivery.001"
  ],
  "deferred_findings_sink_ref": null,
  "artifact_path_hints": {
    "spec.hq-integration-parallel-execution": "docs/engineering-specs/hq-integration-parallel-execution.md"
  },
  "launch_policy": "start_all_currently_launchable_with_rolling_capacity_refill",
  "machine_block_source_rendering": "deterministic_two_space_json",
  "runtime_rendering": "canonical_compact_json",
  "fan_in_owner": "lane-t1",
  "additional_final_check_groups": [
    "hq-root-build",
    "hq-cli-planner",
    "hq-electron-acceptance"
  ],
  "delivery_boundary": "Lanes publish module or shared-writer PRs against work/hq-foundation; T1 alone lands them and merges #2 into main after final acceptance on the same head. No release, signing, deployment or credentials."
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#plan.implementation.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.main-sync.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 makes work/hq-foundation contain main (CLI stack and Planner service, exact bc8202a9731d51922c7cddde91f6ada0074adc1d or its current successor) through an ordinary merge commit, so the feature base carries tools/hq-cli and services/planner for live Work and acceptance tests. Landing the plan PR satisfies this when that PR already carries main. Read back the foundation ref and ancestry of main.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "tools/hq-cli/",
    "services/planner/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.main-sync.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.joint-shell.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Joint shell C, PR #49 (published head 6f2eddfd87453b6f21ac90c8d7d1fcafb9e02961, now based on work/hq-foundation 11a6839e9acdae0f74cd493eaa0316340f1543f1): mount Design next to Social and Work. The implementation is already accepted. The existing C writer normalizes it with an ordinary merge of foundation into the C branch and repairs only qualification failures. Keep the agreed seven shared paths, the bounded App.tsx/styles.css fill layout and leave-flush, and the two registry heading assertions. Do not expand C into bridge, services, IPC, contracts, Electron main/preload, Wiki or storage work.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.ts",
    "apps/desktop/package.json",
    "apps/desktop/src/modules.tsx",
    "apps/desktop/src/social-work.integration.test.tsx",
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/styles.css",
    "modules/social/nav/test/registry.test.tsx",
    "modules/work/nav/test/registry.test.tsx"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.domain-runtime.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.joint-shell.001"
  ],
  "affected_check_groups": [
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.joint-shell.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.shell-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 lands C: with #49 based on work/hq-foundation, confirm its diff is only the shell work, require green exact-head foundation and design-sections checks, merge with --match-head-commit and read back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.joint-shell.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.shell-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.social-live.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t3",
  "objective": "Finish the Social live runtime adapter, PR #48 (corrected head d9359d3b9df67e09b66a122224b54489548f7d2f, awaiting Social acceptance), as module-only code over the closed transport in iface.service-response.001. Apply the pending contract fix: a failed read is unavailable, a malformed or lost mutation is unknown, submitRun is never retried, one refresh only on the exact Social token-rejection 403 predicate, and never fall back from live to fixture. Prove it with contract tests over a wire stub. T1 retargets #48 to work/hq-foundation.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t3.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/social/live",
    "modules/social/index.tsx",
    "modules/social/nav/workspace.ts",
    "modules/social/nav/test/source.test.tsx",
    "docs/evidence/hq-social-work/social-runtime"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.social-live.001"
  ],
  "affected_check_groups": [
    "hq-social-live"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.social-live.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.social-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 retargets #48 to work/hq-foundation, verifies a module-only diff and green exact-head checks, merges and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/social/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.social-live.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.social-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-runtime.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t4",
  "objective": "Build the live Work runtime and replay adapter in modules/work: Planner reads and writes over the closed transport in iface.service-response.001, using the Planner references, receipts and published wire fixtures from the merged CLI stack. Every write carries a caller request ID. A 5xx write is unknown and keeps that ID for reconciliation by replay; replayed:true is an idempotent replay. Never retry an unknown write or fall back from live to fixture. Restoration survives restart through the Work session. This addresses HQ issue #45. Publish one module-only PR against work/hq-foundation.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t4.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/work/live",
    "modules/work/core",
    "modules/work/index.tsx",
    "modules/work/nav/session.ts",
    "docs/evidence/hq-social-work/work-runtime"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.work-runtime.001"
  ],
  "affected_check_groups": [
    "hq-work-runtime"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-runtime.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the Work runtime PR is module-only with green exact-head checks, merges it into work/hq-foundation and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/work/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.work-runtime.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiki-assembly.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t6",
  "objective": "From work/hq-foundation (which contains the Wiki contract, core and UI), assemble Wiki as a mountable module without touching root or shared files. Add a domain descriptor and Component, a renderer client over the seven-method host port in iface.wiki-host-ipc.001, file-based CSS that works under the app CSP, module workspace and tsconfig files, and a synthetic committed-Git corpus fixture with end-to-end module tests. Keep Node test-runner tests out of Vitest discovery and record the Node >=22.18 requirement for T2. Never read a private corpus. Publish one module-only PR.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t6.001",
    "spec.hq-integration-parallel-execution#iface.wiki-host-ipc.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/wiki",
    "docs/evidence/hq-wiki"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.wiki-mount.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.wiki-assembly.001"
  ],
  "affected_check_groups": [
    "hq-wiki-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.wiki-assembly.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiki-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the Wiki assembly PR is module-only with green exact-head and local Wiki checks, merges it into work/hq-foundation and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/wiki/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.wiki-assembly.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.wiki-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.shared-bridge.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Shared bridge F2, already active under the Design owner on an isolated successor of the accepted C implementation and its F1 parent; it is not restarted or rebased. The Design owner is the sole writer of shared services, IPC, contracts, main, preload, environment, root scripts and config, including the new tsconfig.design-host.json, the Design host compatibility layer and ServiceSettings. Add the canonical ServiceResponse type and closed typed routes to packages/contracts; main-only configuration and tokens; preload methods over closed routes, with no generic filesystem, shell or URL IPC; renderer transport clients; and main/preload adapters for durable Design storage. Add assignability tests against the module-local transport types. Keep Electron security invariants, and keep the CSP unchanged unless T1 accepts a rebind.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.design-host.json",
    "apps/desktop",
    "packages/contracts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.joint-shell.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.shared-bridge.001"
  ],
  "affected_check_groups": [
    "hq-shared-bridge",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.shared-bridge.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.bridge-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 integrates F2 only after #49 has landed. It retargets or normalizes the F2 PR onto work/hq-foundation by ordinary merge, verifies the diff is only bridge work, requires green exact-head checks, merges with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/",
    "packages/contracts/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.shared-bridge.001",
    "spec.hq-integration-parallel-execution#task.shell-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.bridge-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.live-wiring.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Wire the landed Social live and Work runtime adapters to the bridge transports in the shell, with real local services opt-in and synthetic services by default. Add a shell integration test proving the live path, unavailable/unknown truthfulness, no unknown-write retry and no live-to-fixture fallback. Exercise Work against a disposable local Planner service from services/planner.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "apps/desktop/src/modules.tsx",
    "apps/desktop/src/services",
    "apps/desktop/electron",
    "apps/desktop/src/live-services.integration.test.tsx"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.bridge-landing.001",
    "spec.hq-integration-parallel-execution#task.social-landing.001",
    "spec.hq-integration-parallel-execution#task.work-landing.001",
    "spec.hq-integration-parallel-execution#task.main-sync.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.live-wiring.001"
  ],
  "affected_check_groups": [
    "hq-shared-bridge",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.live-wiring.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiki-mount.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Mount Wiki fourth in the rail after Work. Add domain ID wiki to shared contracts; the seven-method preload/IPC with host-only refresh and home migration in main over modules/wiki/core; workspace, TypeScript and Vitest discovery including modules/wiki; a Node test-runner step for Wiki Node tests; the Node >=22.18 engine/CI decision; and external CSS under the existing CSP. Prove a synthetic Git-corpus round trip through the real shell.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.wiki-host-ipc.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.ts",
    ".github/workflows/foundation.yml",
    "apps/desktop/package.json",
    "apps/desktop/vite.config.ts",
    "apps/desktop/src/modules.tsx",
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/styles.css",
    "apps/desktop/src/environment.d.ts",
    "apps/desktop/electron",
    "packages/contracts",
    "apps/desktop/src/wiki.integration.test.tsx"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.wiki-mount.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.live-wiring.001",
    "spec.hq-integration-parallel-execution#task.wiki-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.wiki-mount.001"
  ],
  "affected_check_groups": [
    "hq-wiki-module",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.wiki-mount.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.acceptance-harness.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t7",
  "objective": "Build a dependency-free Electron acceptance harness under tests/acceptance. It launches the built app with an owned temporary profile and drives it over the Chrome DevTools Protocol using Node's built-in WebSocket. Cover the Design/Social/Work/Wiki round trip, state persistence and replay across restart, domain-reference round trips and truthful unavailable/unknown states over synthetic services. Each run cleans up its profile and processes on success, failure and cancellation. Add no npm dependency or script; run with node. The host has Xvfb, bubblewrap, user namespaces and fonts, but the Jones Code harness rejects HQ's layout, so build an HQ-specific native harness and do not alter HQ's layout to suit that runner. Stay separate from Design production code and tests. Develop now against the #49 head, and use Wiki and live paths as they land.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "tests/acceptance",
    "docs/evidence/hq-integration/acceptance"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.working-app.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.acceptance-harness.001"
  ],
  "affected_check_groups": [
    "hq-electron-acceptance"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.acceptance-harness.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.harness-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the test-only harness PR, merges it into work/hq-foundation and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "tests/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.acceptance-harness.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.harness-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.install-route.001" -->
```json
{
  "schema_version": 1,
  "kind": "research",
  "profile_role": "researcher",
  "accountable_owner": "lane-t7",
  "objective": "Read-only: identify the owner-authorized route for building, installing and launching the final candidate on the owner's laptop. Cover the platform, an available packaging command or its absence, and display availability for the Electron harness on the build host. Do not install, change privileges or configuration, sign, or access credentials. If no proved route exists, return the exact platform gap.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "docs/",
    "package.json",
    "apps/desktop/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.working-app.001"
  ],
  "test_refs": [],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "Any host effect, elevation, signing or credential access would be needed."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.install-route.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.final-acceptance.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "On the exact final work/hq-foundation head (equal to the #2 head), run npm ci, typecheck, test and build, the Wiki Node tests, CLI and Planner tests, and the Electron acceptance harness. Then follow the install route: install and launch the final candidate on the laptop, or record the exact gap. Report every failure, skip and gap.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.wiki-mount.001",
    "spec.hq-integration-parallel-execution#task.harness-landing.001",
    "spec.hq-integration-parallel-execution#task.install-route.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-integration-parallel-execution#task.install-route.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.working-app.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.final-acceptance.001"
  ],
  "affected_check_groups": [
    "hq-root-build",
    "hq-cli-planner",
    "hq-electron-acceptance"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "Head moved during the run; restart on the new exact head."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.final-acceptance.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.main-delivery.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 marks #2 ready and requires green exact-head foundation and design-sections checks plus accepted final-acceptance evidence for that same head. It then merges #2 into main with --merge --match-head-commit, and reads back main, the merge commit and #2. All other original PRs are already merged; the audit confirms each actual merged state.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.final-acceptance.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-integration-parallel-execution#task.final-acceptance.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.main-delivery.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.main-delivery.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.main-delivery.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.source-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "scenario": "Each T1 landing reads back the target ref OID, the PR merged state and merge commit, and ancestry of the exact head.",
  "evidence": {
    "predicate": "Native GitHub readback matches the expected postcondition.",
    "invalid": "A ref moved unexpectedly, a PR is unmerged, or ancestry is missing.",
    "unknown": "The response was lost or partial; reconcile before any retry."
  },
  "environment": [
    "GitHub API readback"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.shell-landing.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.shell-landing.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/engineering-specs/"
  ],
  "affected_check_groups": [
    "hq-source-readback"
  ],
  "required_at": "integration"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.source-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.joint-shell.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.domain-runtime.001"
  ],
  "scenario": "Design mounts and fills the workspace; Design→Social→Work→Design restores each domain; leaving Design flushes chrome state; Social/Work assertions are unchanged.",
  "evidence": {
    "predicate": "Root typecheck, tests and build plus design-sections pass at the exact head.",
    "invalid": "Any Social/Work execution, write, restoration or undo assertion is weakened.",
    "unknown": "Hosted checks are absent or stale for the head."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.joint-shell.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.joint-shell.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/src/"
  ],
  "affected_check_groups": [
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.joint-shell.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.social-live.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "scenario": "A wire stub returns 2xx, 4xx, 5xx, an empty body, malformed responses and a lost response; one exact token-rejection 403 triggers a single refresh.",
  "evidence": {
    "predicate": "Every received HTTP response is ok:true with its status; failed reads are unavailable, malformed or lost mutations unknown; submitRun is never retried; nothing falls back to fixtures.",
    "invalid": "A retry of an unknown mutation, a fixture fallback, or a token in renderer state.",
    "unknown": "The stub cannot represent the case."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.social-live.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.social-live.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/social/live/"
  ],
  "affected_check_groups": [
    "hq-social-live"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.social-live.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.work-runtime.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "scenario": "Planner wire fixtures drive reads and writes; a 5xx write yields unknown with the caller request ID; replay reconciles it; restart restores the Work session.",
  "evidence": {
    "predicate": "Module tests pass with zero duplicate writes and truthful unknown/replayed status.",
    "invalid": "Any automatic retry of an unknown write or fixture fallback.",
    "unknown": "The Planner fixture is missing for the case."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.work-runtime.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.work-runtime.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/work/live/"
  ],
  "affected_check_groups": [
    "hq-work-runtime"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.work-runtime.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.wiki-assembly.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.wiki-mount.001"
  ],
  "scenario": "A synthetic committed-Git corpus is indexed through core and rendered through the assembled module over the seven-method port.",
  "evidence": {
    "predicate": "Contract, core, UI and assembly tests pass; CSS is an external file; no private corpus is read.",
    "invalid": "Inline styles that need a CSP change, arbitrary path access, or a private corpus read.",
    "unknown": "Node >=22.18 is unavailable for the Node tests."
  },
  "environment": [
    "Node >=22.18 test runner and Vitest DOM"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.wiki-assembly.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.wiki-assembly.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/wiki/"
  ],
  "affected_check_groups": [
    "hq-wiki-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.wiki-assembly.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.shared-bridge.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "scenario": "Closed routes cross preload into main; config and tokens stay in main; Design durable storage persists through main/preload.",
  "evidence": {
    "predicate": "Root checks and Electron security tests pass; module transport types are assignable to the canonical type.",
    "invalid": "Generic filesystem, shell or URL IPC, a token reaching the renderer, or a CSP change without rebind.",
    "unknown": "Electron cannot run on the check host."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.shared-bridge.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.shared-bridge.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/electron/",
    "packages/contracts/"
  ],
  "affected_check_groups": [
    "hq-shared-bridge"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.shared-bridge.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.live-wiring.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "scenario": "The shell drives Social through a wire stub and Work through a disposable local Planner service.",
  "evidence": {
    "predicate": "Integration tests pass with truthful status and no duplicate or fallback effects.",
    "invalid": "Live and fixture data are mixed or unlabelled.",
    "unknown": "The local Planner service cannot start."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only",
    "Python 3 for the disposable Planner service"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.live-wiring.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.live-wiring.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/src/"
  ],
  "affected_check_groups": [
    "hq-shared-bridge"
  ],
  "required_at": "integration-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.live-wiring.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.wiki-mount.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.wiki-mount.001"
  ],
  "scenario": "Wiki appears fourth in the rail; search, page, backlinks and topics work over IPC against a synthetic corpus; refresh is host-only.",
  "evidence": {
    "predicate": "Root checks include modules/wiki and pass; Wiki Node tests pass in CI.",
    "invalid": "The renderer can trigger refresh or arbitrary paths, or Wiki tests are silently excluded.",
    "unknown": "CI Node version cannot be raised."
  },
  "environment": [
    "Node >=22.18"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.wiki-mount.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.wiki-mount.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/",
    "modules/wiki/"
  ],
  "affected_check_groups": [
    "hq-wiki-module",
    "hq-root-build"
  ],
  "required_at": "integration-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.wiki-mount.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.acceptance-harness.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "scenario": "The harness launches the built app, completes domain round trips and restart persistence, and cleans its profile on every exit path.",
  "evidence": {
    "predicate": "The harness passes against the current candidate, with a self-test for cleanup.",
    "invalid": "A leaked profile or process, or a pass recorded without a real Electron launch.",
    "unknown": "No display is available on the host; record it as a platform gap."
  },
  "environment": [
    "Built app on the check host"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.acceptance-harness.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.acceptance-harness.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "tests/acceptance/"
  ],
  "affected_check_groups": [
    "hq-electron-acceptance"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.acceptance-harness.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.final-acceptance.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "scenario": "The full matrix runs on the exact final foundation head, followed by laptop install and launch through the proved route.",
  "evidence": {
    "predicate": "Every listed check passes at one head; installation evidence or an exact gap is recorded.",
    "invalid": "Mixed heads, an omitted check, or a gap reported as a pass.",
    "unknown": "The install route is unavailable."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only",
    "owner laptop through the proved route"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.final-acceptance.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.final-acceptance.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "tests/acceptance/",
    "tools/hq-cli/",
    "services/planner/"
  ],
  "affected_check_groups": [
    "hq-root-build",
    "hq-cli-planner",
    "hq-electron-acceptance"
  ],
  "required_at": "candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.final-acceptance.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.main-delivery.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "scenario": "#2 merges into main at the exact accepted head.",
  "evidence": {
    "predicate": "Main contains the #2 head; #2 is merged; every original PR reads back as actually merged.",
    "invalid": "Main moved to an unaccepted head, or an original PR's disposition is wrong.",
    "unknown": "The merge response was lost; read back before any action."
  },
  "environment": [
    "GitHub API readback"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.main-delivery.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.main-delivery.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-source-readback"
  ],
  "required_at": "integration"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.main-delivery.001" -->

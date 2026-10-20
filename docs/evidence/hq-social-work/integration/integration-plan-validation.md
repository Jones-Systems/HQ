# Plan revision 4 validation (integration phase)

Authority effect: none. This records the real Codex V3 helper runs over plan revision 4. It is planning evidence, not acceptance of any candidate.

## Identities

| Item | Value |
| --- | --- |
| Validated plan commit | `7468e8844c2455e52afc5ddabf8d434454972caa` on `work/hq-social-work-plan` (first revision-4 commit `57830e0371ca22985e17e34356a31103bf280132`, then the root's four corrections) |
| Spec blob | `aabcf8a1a5c829b7b1cbee2ed208b73b5102308b` |
| Spec file SHA-256 | `aa5ddf5784a43934edf4405bfe9ccd7d50b125a7e6f4488fb682e671322504e1` |
| Helper source | `Jones-Systems/Codex-V3` `src/` at `4beb491c44551b6e4207adcc7459c4b11407bcbc` (read-only; not edited) |
| Catalog binding | Projection of `spec.hq-social-work#ctx.check-catalog.001`, manifest SHA-256 `7ed3bfcbdb954543e30d419cef46f37c8d8ba6c1530df1c16be7eb930b6019cb`, groups `hq-foundation`, `hq-ui`, `shell-integration`, `social-module`, `work-module`. **Not** HQ's Design-owned `tests/check-groups.toml`. |
| Model requests | `claude-opus-5-5` / `high` under `claude_frontier`, scope `workstream:hq-social-work` |
| Scripts | `docs/work-notes/hq-social-work-tools/{gen,validate,rounds,context_sizes}.py` at the validated commit (T1-owned, planning-only) |

**Telemetry.** Linux admission was taken before the helper batches: CPU 13.75% used with 44.32 GiB available, and again CPU 21.38% used with 45.19 GiB available. Batch ceiling 10, one serial test process. The helper runs are single-process Python with no test, install or build.

## Parse and section checks

- `codex_v3.sections_cli check`: the spec and Work Note are valid.
- `parse_engineering_spec_plan`: 27 tasks and 27 Test Intents. The revision-3 plan had 23 of each; the four new tasks are `joint-root-checks`, `joint-assembly`, `joint-electron-smoke` and `joint-ci`.
- **Context bound.** `context_sizes.py` and the compiler agree that every task's resolved context is within the default 32 KiB (32,768-byte) bound. The tightest are `work-core` at 32,766, `work-domain` at 32,237 and `work-references` at 31,552. To fit, informational prose moved out of shared sections: the "Consumers" list now sits outside any section, and writer-map rows were shortened. `domain-integration` carries only `ctx.integration-bindings.001` as extra context. The full spec stays mandatory reading through the preflight.

## Actual round (root-accepted results)

`rounds.py <checkout> 7468e88 held actual` feeds `compile_ready_wave` the ten real results. Each is transcribed from the root's acceptance records, with `changed_paths` computed by `git diff --name-only` filtered to the task's own `write_scope`. Result refs are `root-acceptance:<task>@<commit>`.

| Task | Commit | Diff base | In-scope changed paths |
| --- | --- | --- | --- |
| bind-foundation (verification) | `35f9a3e` | — | — |
| workspace-skeleton | `cfdab378` | `ff5ad79` | 18 |
| ui-kit | `935dedf` | R1 | 48 |
| social-core | `83dafc5` | R1 | 12 |
| social-content | `5f5df2a` | R1 | 46 |
| social-workbench | `bffd433` | R1 | 43 |
| social-domain | `9735b74` | R1 | 19 |
| work-core | `a8c791a` | R1 | 24 |
| work-views | `8a3261d` | R1 | 49 |
| work-board | `3ca74d7` | R1 | 58 |

**Ready set: exactly `{work-domain}`.** That is one capsule draft and one assignment draft, with no writer collision. The rendered size is 48,677 bytes.

| Capsule | Context bytes | Capsule JSON bytes | `capsule_sha256` |
| --- | --- | --- | --- |
| `task.work-domain.001` | 32,237 | 47,944 | `071dbea01ce16ea4b96a71d839c2d742a31ee4dfb7a1cd1c6f158b2d5c50dad4` |

These accepted results are fixture/source acceptances with author-reported checks. Feeding them to the compiler does not make them native, live, integrated or CI-green acceptances.

## Projections (labelled fixtures after the actual round)

Rounds after the actual round use synthetic `projection-fixture-<n>` results. In the activated mode they also use fixture-satisfied activation evidence. They are not project evidence. Every compiled round produced draft counts equal to its ready set, with **no writer collision**.

### From actual, explicit predicates unbound

| Round | Ready | Rendered bytes |
| --- | --- | --- |
| 1 (actual) | work-domain | 48,677 |
| 2 | domain-integration (context 30,367, capsule `3d935de43099817703607d7664731c1d7328f86679c4a925e2df3ea93964402d`) | 47,840 |

Unreleased: every explicit-activation task, plus `campaign-verification`, which keeps its `reference-integration` dependency. That is a truthful gate, not a defect.

### From actual, all explicit predicates fixture-satisfied

| Round | Ready | Rendered bytes |
| --- | --- | --- |
| 1 | reference-contract, service-bridge, work-domain | 118,230 |
| 2 | domain-integration, reference-shell, reference-ui, social-live-adapter, work-live-adapter | 209,360 |
| 3 | joint-root-checks, shell-chrome, social-references, work-references | 163,745 |
| 4 | joint-assembly, joint-ci, reference-integration | 117,204 |
| 5 | campaign-verification, joint-electron-smoke | 70,796 |

Unreleased: none. Joint tasks wait on the Social+Work assembly. `campaign-verification` still waits on both `domain-integration` and `reference-integration`.

### From scratch (counterfactual; for capsule coverage of completed tasks)

- **Unbound:** the rounds are bind-foundation; workspace-skeleton; social-core, ui-kit, work-core; social-content, social-workbench, work-board, work-views; social-domain, work-domain; domain-integration. All of them compile.
- **Fixture-satisfied:** rounds 1–2 compile. Round 3 would release social-core, ui-kit, work-core, reference-contract and service-bridge together. It returns the typed stop `reference_bound_exceeded` ("aggregate selected content exceeds max_selected_bytes") because the union of distinct sections is 66,117 bytes against the default 64 KiB wave aggregate limit.
  - This wave cannot occur: three of those five tasks are already accepted.
  - The largest live-path wave, round 2 of the from-actual activated projection, has a union of about 54.8 KiB and compiles.
  - Recorded as a P4 helper observation in the Work Note; not fixed.

**Same capsule digest across modes.** The `work-domain` capsule SHA is identical in the from-actual and from-scratch runs. The JSON byte count differs (47,944 vs 47,716) because the selected dependency inputs carry real rather than fixture values.

## Semantics checked in the encoding

- The Work-domain write scope is exactly `modules/work/index.tsx`, `modules/work/nav`, `modules/work/skeleton.test.ts` and `docs/evidence/hq-social-work/work-domain`.
- The assembly write scope is exactly:
  - `apps/desktop/src/social-work.integration.test.tsx`, a new file and a root test-file custody assignment. It is absent on the plan head, `9735b74`, `3ca74d7` and every fetched ref. The `dom` Vitest project and the root `tsconfig.json` include already discover it;
  - `apps/desktop/src/modules.tsx`, only if needed;
  - `docs/evidence/hq-social-work/integration/social-work`.

  The assembly reads `modules/social`, `modules/work`, `packages/hq-ui` and the lane evidence.
- Navigation, domain and page switches make zero writes and zero execution. Explicit card, date and horizon moves make only their single intended planning mutation (and explicit Undo), with zero execution.
- The Work import boundary applies to HQ workspaces (`@hq/contracts`, `@hq/ui`). React and runtime imports stay allowed.
- Joint root checks, joint assembly and CI are explicit-activation tasks (`ac.joint-integration-gate.001`, `ac.ci-adoption.001`). No PR merge order is adopted.

## Revision 5 (joint continuation on the Design parent)

**Input.** The root's read-only Design-first stack scout result (2026-10-20, SHA-256 `2bd169a8da0b99a9b722e4dfb731f8a73286eee5146b94dc6f8ecc07131422bb`), as inspected by the root:

- committed Design (`33dfe44..bb908fd`) and Social/Work paths are disjoint;
- no trial merge was run and there is no runtime-compatibility proof;
- `PullRequest.stack` is null on all 24 open PRs;
- no Design assembly parent is published or accepted (`bb908fd` is local only).

**What changed.**

- `ac.joint-integration-gate.001` now lists five explicit, unbound activation bindings: D, S, Design wiring, root-file custody (including a `vite.config.ts` decision) and C's release.
- The joint tasks are one additive continuation. It starts at D, normally merges S, and opens a PR against the Design branch that contains D. No rebase, force push or mass retarget.
- Root discovery evidence is an inventory of unique Node, DOM and section files and their actual configs.
- `apps/desktop/vite.config.ts` is named as unassigned.
- No workflow custody is implied.
- B's test stays an immutable dependency.
- `task.joint-root-checks.001` adds `apps/desktop/package.json`, completing the six R0 root paths. `task.joint-assembly.001` adds the new `apps/desktop/src/joint.integration.test.tsx`.

**Identities.** Commit `7ab7f2e5517dcfee2334548e0a27d78f1921d5e7`, spec blob `d38be0f9789363877497fb129e246436c0fca50a`, file SHA-256 `7684925b5bc22ae2495306f5cb23a75445506bc1c122b224eac302a7812cdff0`. Same catalog projection (`7ed3bfcb…`) and model requests as above. Telemetry was CPU 29.02% used, 41.33 GiB available, ceiling 10.

**Results.**

- `sections_cli check`: valid. `parse_engineering_spec_plan`: 27 tasks and 27 intents.
- Every context is ≤ 32 KiB. The largest are `work-core` at 32,663, `work-domain` at 32,134 and `joint-assembly` at 30,706.

| Projection | Rounds (ready sets) | Collisions |
| --- | --- | --- |
| Actual, unbound | 1: work-domain (context 32,134); 2: domain-integration (30,264). Joint, reference, bridge, chrome and campaign tasks unreleased. | none |
| Actual, fixture-satisfied | 1: reference-contract, service-bridge, work-domain; 2: domain-integration, reference-shell, reference-ui, social-live-adapter, work-live-adapter; 3: joint-root-checks (`9fc45d1c…`), shell-chrome, social-references, work-references; 4: joint-assembly (`56dcf7f0…`), joint-ci (`0bc294d1…`), reference-integration; 5: campaign-verification, joint-electron-smoke | none |
| From scratch, unbound | the same six rounds as revision 4 | none |
| From scratch, fixture-satisfied | rounds 1–2, then the same typed `reference_bound_exceeded` counterfactual stop at round 3 | — |

**What `capsule_sha256` covers.** The `work-domain` and `domain-integration` capsule digests are unchanged (`071dbea0…`, `3d935de4…`) because their task blocks are unchanged. The digest covers the capsule body. The resolved context bytes differ (the writer map changed), and those are carried in the capsule draft's resolved-context records. Child A was compiled and launched at `72854ab` and keeps that binding. B will compile at the plan head current at its launch.

# HQ test right-sizing and CI efficiency

Artifact Type: engineering-spec
Artifact ID: spec.hq-test-right-sizing-ci
Purpose: Record the bounded test/CI design, delivered successors and remaining integration prerequisites.
Decision owner: M Jones
Consumers: HQ contributors and integration owner
Authority effect: none

## Source populations and ownership

Main at `bc8202a9731d51922c7cddde91f6ada0074adc1d` contains the dependency-free
Planner and CLI. Foundation at `b7b8c29dbc0feb73787b98bf926a90c3edfb21ea`
contains the application and shared CI. Native/package successors #135/#138 and
#141/#142 remain independently owned. This design follows
[HQ#50](https://github.com/Jones-Systems/HQ/issues/50); it neither adopts their
open changes nor releases foundation PR #2's integration hold.

## Fast check placement

The owner resolved shared-path assignment through scoped successor authority on October 24. PR #151 updates the existing
`.github/workflows/cli-planner.yml` identity and existing two check names:

- `CLI Node tests and synthetic Planner E2E`: run the entire CLI discovery with
  `HQ_CLI_E2E=1`, including the actual disposable Planner service.
- `Planner contract, Python and Node tests`: run full Python discovery and
  Node client discovery. Python discovery already regenerates and compares the
  real HTTP exchanges, so omit the duplicate standalone capture command.

Neither job requires root Node dependencies or a Python dependency install.
Keep the already supported Node/Python versions and explicit serial test
processes. Preserve concurrency cancellation and full test discovery. Use a
six-minute job timeout to leave margin below the 6m30s budget. Path selection
must include both source trees, contract fixtures, the workflow and governing
instructions; global/unknown changes retain full discovery. A skipped path
must not claim a passing execution.

PR #151 declares these fast checks and the Foundation/Design families required in foundation's AGENTS.md. Full discovery across all PR paths/bases is the conservative placement; main-push duplicate runs are removed. Foundation builds once, runs Vitest against that same output, and includes existing portable acceptance/storage cases. Future foundation integration must retain the declared contract. Every other native/nightly/label/package check is advisory for ordinary
source merges; package/release/install claims still require their corresponding
qualification. No branch-protection or ruleset changes are made.

Use #145's existing Design batching result. Do not create a second batching
implementation or combine its unmerged source into this work implicitly.

## Implemented native tier

PR #156 uses four existing implemented journeys with direct state-owner readback:

| Journey | Distinct native protection |
| --- | --- |
| Launch, domain navigation, restart | Real preload/IPC, isolation/CSP and persisted appearance/domain. |
| Work capture and uncertain-write recovery | Real synthetic Planner commits once despite response loss; explicit lookup, no automatic replay. |
| Work restart without replay | Confirmed item/version survives actual Planner/Electron restart; no post-restart mutations. |
| Gallery enrollment and last good | Main-owned exact-byte/digest state, retained snapshot across restart/failure and removal without corpus deletion. |

The initial five-journey proposal included Social saves/references, Wiki references and live preview. Those native scenarios are not implemented on the authorized source base, so they remain explicit release obligations. Mounting their domains does not certify them. No new product behavior is added to manufacture a pass.

Run the four-journey tier nightly or by explicit label/dispatch on Linux. PR CI does not automatically consume macOS runners. Keep detailed failure matrices in cheaper tests and distinct-host checks on the manual release checklist unless transport is the changed claim. Missing prerequisites and any observed failure return nonzero; do not retry to green.

The twelve original reserved rows and source-specific HQ-07/HQ-09/HQ-09H obligations remain visible. Routine success means exactly its named subset. Full acceptance cannot pass a missing, held or unimplemented row; selected mode still executes the held HQ-07 edge. All current process ownership, environment isolation, build identity, first-failure evidence, cleanup and peer-survival protection remain.

The unused scripted mutation/replay simulator and its three helper tests are removed with that implementation. Read-only shell fixtures reject mutations/unknown routes; actual Work journeys use the real owned Planner. The complete acceptance JavaScript inventory shrinks by 70 lines after adding the final review's zero-passive-mutation oracle; production modules excluding tests shrink by 52 lines. No framework or dependency is added. The observed clean Linux candidate passed all four journeys in 4.970 seconds; see the work note for exact revision and build identity. Schedules activate only after eventual default-branch promotion.

## Package disposition

PR #155 demotes routine desktop packaging to advisory nightly, relevant-path PRs with the ci/package label, explicit dispatch, or the existing release-tag route. Ordinary main pushes skip packaging. The existing explicitly enabled canonical-main push exception remains reachable for the separately gated signed-release graph; no activation or release authority is changed. Keep
both architectures only where release support requires them. Preserve resource
admission, process-inventory completeness, signing and release trust boundaries.
Do not repair by loosening readiness, adding retries or suppressing cleanup
failure. Existing source repairs and remaining blockers belong to #141/#142.

## Verification and report

Run one serial local test process after each fresh telemetry admission. Use
the baseline commands in the work note; no macOS job is needed for the isolated
CLI test addition. Removal PRs identify the remaining behavior protection and
remain separate from additions, CI changes and production changes. The final
bulk review uses the owner's requested Astra/xhigh when validation, permissions,
durable data or shipped regressions are affected; apply its restore list.

Report main and integration test populations separately, cases versus repeated
assertions, job execution minutes versus billed minutes, and true push-to-green
versus workflow-created completion proxies. An unmerged or unexecuted proposal
is not an after measurement. Required checks, merges, native runs and installed
qualification each need their own exact source/readback evidence.

## Scoped integration boundary

M Jones authorized scoped integration successors and their qualified merges on October 24. The delivery targets the relevant source bases for #2/#94/#82/#86/#135/#138/#141/#142; merging this workstream's PRs may advance those source branches. Existing PRs are preserved, with no direct push, merge or closure of them. Foundation-to-main, release, signing, deployment and installation holds remain. #145's Design batching source is not adopted or modified.

This design and the [work note](../work-notes/test-right-sizing-and-ci-efficiency.md) describe separate source populations and measured outcomes. A qualified successor merge does not assemble or install the whole application.

## Portable fixture regression follow-through

The newly required portable tier exposed an incidental 100 ms shared lifecycle fixture budget on foundation `34d73a0`. PR #159 separates ordinary lifecycle setup, which inherits production's existing 5,000 ms budget, from explicit 100 ms deadline/contender contexts. Keep all original deadline, ownership, retention and cleanup assertions; no production or workflow change is required. A controlled delayed-sync regression must fail with the old shared context and pass in complete portable discovery with the repaired context. The work note records the exact failure and qualification separately from the earlier delivery sample. This repair does not advance foundation to main or lift any application/release/cleanup hold.

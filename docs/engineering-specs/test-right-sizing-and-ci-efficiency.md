# HQ test right-sizing and CI efficiency

Artifact Type: engineering-spec
Artifact ID: spec.hq-test-right-sizing-ci
Purpose: Define the bounded test/CI changes and expose integration prerequisites.
Decision owner: M Jones
Consumers: HQ contributors and integration owner
Authority effect: none

## Source populations and ownership

Main at `bc8202a9731d51922c7cddde91f6ada0074adc1d` contains the dependency-free
Planner and CLI. Foundation at `b7b8c29dbc0feb73787b98bf926a90c3edfb21ea`
contains the application and shared CI. Native/package successors #135/#138 and
#141/#142 remain independently owned. This proposal follows
[HQ#50](https://github.com/Jones-Systems/HQ/issues/50); it neither adopts their
open changes nor releases foundation PR #2's integration hold.

## Main check proposal

After the shared-path assignment is resolved, use the existing
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

Declare those fast checks required in the repository's agent instructions once
the workflow is actually present. Future foundation integration must retain its
fast foundation and Design checks under the integration owner's existing
contract. Every other native/nightly/label/package check is advisory for ordinary
source merges; package/release/install claims still require their corresponding
qualification. No branch-protection or ruleset changes are proposed.

Use #145's existing Design batching result. Do not create a second batching
implementation or combine its unmerged source into this work implicitly.

## Native tier proposal

Use five routine journeys, with direct state-owner readback and persistence:

| Journey | Distinct native protection |
| --- | --- |
| Launch, domain navigation, restart | Real preload/IPC, persisted preferences and no unsolicited work launch. |
| Work capture and uncertain-write recovery | Actual synthetic Planner, durable receipt/readback and no duplicate or automatic replay. |
| Social save and reference navigation | Truthful unavailable/unknown outcomes; navigation never dispatches work. |
| Design project enrollment and preview | Source ownership, last-good state, containment and persistence. |
| Wiki committed corpus and references | Synthetic Git corpus, provenance, owner readback and truthful unavailable state. |

Run native qualification nightly or explicitly by label/dispatch from the
integration-owned source base. Ordinary pull requests must not automatically
consume macOS packaging runners. Keep detailed failure matrices in cheaper
tests and distinct-host checks on the manual release checklist unless transport
is the changed claim. A journey qualifies with one actual target-host passing
run; record subsequent first-attempt failures without retrying to green.

Foundation's acceptance aggregator has twelve reserved rows. A routine
five-journey cap does not erase them or turn a partial checkpoint into final
acceptance. Preserve unresolved product obligations and release holds explicitly.
Shrink the raw CDP harness only after tracing which selected journeys require
each helper; keep process ownership, failure evidence and cleanup guarantees.

## Package disposition

Demote routine desktop packaging/native smoke to advisory, nightly or explicit
label/dispatch, with justified path filters if any PR trigger remains. Keep
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

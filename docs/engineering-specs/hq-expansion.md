# Engineering Spec — HQ request lifecycle, Wiki and inspiration

<!-- codex-section:begin id="spec.hq-expansion#ctx.artifact-header.001" -->
Artifact Type: `engineering-spec`

Artifact ID: `spec.hq-expansion`

Purpose: Extend the existing HQ application with a complete request review loop, connected inspiration and a searchable Wiki.

Governing artifact: `spec.hq-design`

Specification owner: HQ expansion coordinator

Integration owner: Existing Design and Social/Work integration owners

Consumers: Opus planners, Sonnet builders, domain integration owners and verifiers

Authority effect: none
<!-- codex-section:end id="spec.hq-expansion#ctx.artifact-header.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.project-summary.001" -->
## Project Summary

Extend the existing Electron application and its current PRs. Preserve Design, Social and Work; add Wiki fourth. The owner wants a smooth request → explicit send → queued/running → returned work → accept/reject/revise loop, searchable linked knowledge across BusinessLessons and App-Development, and project-specific inspiration from app/website studies. Domain changes, card movement, search and reference navigation never execute work. Public HQ source uses synthetic fixtures; local knowledge and reference corpora remain outside the public repository.

Implementation is independently authorized by the owner's request for plans, builds and PRs. Planning mechanics supply no authority. Claude Frontier is task-scoped, with the explicit owner override Opus 5.5/high for planning and Sonnet 5.5/high for builders. This progressive revision closes the ready Design deltas; Wiki's source/architecture research is still being resolved and its builder tasks will be added before release.
<!-- codex-section:end id="spec.hq-expansion#ctx.project-summary.001" -->

<!-- codex-section:begin id="spec.hq-expansion#req.requests.001" -->
## Request Requirements

Compose existing requests PR17 and connector PR12. Persist per-packet handoff status and candidate inbox; distinguish submitting/unknown/queued/held/running/returned/failed/cancelled. Show pinned host/model and freshness without fallback. Add reject while preserving accept/revise/defer. Support owner-reported returned artifacts, explicitly labelled and unable to make native observation claims. Mount Requests and Runs; navigation never sends. Preserve immutable packet digests, pre-send durability, duplicate fences, unknown-effect reconciliation, and revision lineage. Poll/readback must have no access to send.

A fake-backed complete loop is source evidence, not a live Jones Code qualification. Real result transport, host catalog and new-thread launch remain required product capabilities, each qualified separately against its receiver contract and the existing S1/HQD-11b/U1 gates. Do not mark those delivered because a fixture succeeds.
<!-- codex-section:end id="spec.hq-expansion#req.requests.001" -->

<!-- codex-section:begin id="spec.hq-expansion#req.inspiration.001" -->
## Inspiration Requirements

Extend the existing reference library (PR6), taste (PR10), discovery (PR14) and imports (PR16). Keep project pins to exact immutable captures. Add website/page/section/element and app/flow/screen hierarchies, capture lineage, explicit availability, provenance and rights. Export/adopt immutable local reference packets for project requests. Existing privately held studies and app references are intended local inputs; no private source code or corpus bytes enter public HQ.

Treat REA as an optional producer identity, not a mandatory third-party dependency. The earlier element-breakdown pipeline belongs to the existing creative-reference work. No new scraping, paid acquisition, provider calls or third-party code import is in scope.
<!-- codex-section:end id="spec.hq-expansion#req.inspiration.001" -->

<!-- codex-section:begin id="spec.hq-expansion#req.wiki.001" -->
## Wiki Requirements

Add Wiki fourth in the main rail after Work. Search and read BusinessLessons plus the resolved App-Development research corpus. Support linked topics/records, source provenance, backlinks, repository filters, history and read-only graph-aware navigation. Consume original records without assuming Obsidian migration. Distinguish graph snapshot freshness from content freshness. Do not write either source repository, execute embedded content, follow arbitrary filesystem paths or publish corpus content. The exact read/index/IPC architecture is pending the dedicated Opus source plan.
<!-- codex-section:end id="spec.hq-expansion#req.wiki.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ac.requests.001" -->
## Request Acceptance

At an exact candidate revision, a labelled synthetic end-to-end test and rendered flow prove freeze → confirm → queued → running → returned → accept/reject/revise, with restart recovery. Reject creates no draft or execution. Owner-reported data cannot claim observed/native verification. Unknown receipts cannot be resent. Cross-section canonical digests agree. Navigation and readback produce zero sends. Host/model variance is shown. Native runtime, real receiver and installation evidence are reported separately.
<!-- codex-section:end id="spec.hq-expansion#ac.requests.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ac.inspiration.001" -->
## Inspiration Acceptance

A synthetic website tree and app-flow-screen tree can be imported idempotently, browsed, pinned to a project and exported as an immutable packet. Re-capture preserves old pins and ratings. Element anchors bind exact capture digests. Present, no-image, blob-missing, source-unavailable and missing-at-source remain distinct. Unknown rights cannot become permitted. Restricted/private assets never enter publishable output; exclusions are listed. Future schemas open without writes.
<!-- codex-section:end id="spec.hq-expansion#ac.inspiration.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ac.integration.001" -->
## Integration Release Predicate

The existing integration owners have accepted the exact dependencies and named one writer for the selected composition/shared-shell paths on the common Design-plus-Social/Work base. This is a release predicate, not a grant or a claim that integration has happened.
<!-- codex-section:end id="spec.hq-expansion#ac.integration.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.research-decision-basis.001" -->
## Research And Decision Basis

Source audit: requests PR17 at 2438d6ff96a84141e12e30bab2d28d042aa80d01 and connector PR12 at 29f8c871664370976919cae64698cfce218f8dd6 already implement durable freezes, confirmation, outbox fencing and strict result-evidence validation, but are not connected. Requests currently supports accept/revise/defer, no reject. There is no returned-work inbox, no root type mapping and no combined lifecycle display. The preview passes a null dispatch slot. Add section-level extensions and compose through root adapters; do not create another queue.

References PR6 at 3cedea45527652a04133aa4e7e3148b88314be7c has flat sources, tags, collections, project use and rights-aware export. Taste PR10 at be265a1453cc8d3d5e4137de036b9ae61d64d4a0 already accepts reference subjects. Discovery PR14 at 889d43b5263773b718ea56523b288fdb6167d97c owns lazy previews. Imports PR16 at 0bd1bc77ad59d954424369e4c55a918cb61d79af currently targets view versions, not reference packets. Extend T8 with a separate graph document rather than migrate the existing library shape.

Opus planning contributions: request lifecycle audit and inspiration/REA audit; separate Wiki source research remains active. Facts above are exact source observations; recommendations below are planning decisions. Consumer-impact coverage is partial: selected section source and tests at those heads were inspected; real receiver contracts, installed app, private producer extractability and combined-shell qualification remain outside that evidence.

Caller view: Requests consumes narrow status/return ports; connector owns dispatch/evidence invariants; the composition layer maps their types and digests. References owns the graph and packet validator; storage/preview/taste/request consumers use existing injected ports. Root/contract edits stay with designated shared owners.
<!-- codex-section:end id="spec.hq-expansion#ctx.research-decision-basis.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.change-surface.001" -->
## Exact Change Surface And Ownership

Each builder is the sole Git owner of a separate native HQ worktree. Requests: modules/design/requests/**. Connector: modules/design/connector/**. Inspiration graph then packets: modules/design/references/** in one sequential lane. Each cone includes its own tests and README. Existing heads remain unchanged; publish child PRs against their verified section branches.

The existing Design integration owner retains composition, section registration and storage adapters. The Social/Work owner coordinates Wiki's minimal shared registry/contracts seam with Design on their common accepted base. This plan branch owns only docs/engineering-specs/hq-expansion.md and docs/planning-evidence/hq-expansion/. No builder edits root manifests, locks, contracts, desktop packaging or another cone without a new exact assignment.
<!-- codex-section:end id="spec.hq-expansion#ctx.change-surface.001" -->

<!-- codex-section:begin id="spec.hq-expansion#iface.requests.001" -->
## Request Interface Contracts

Connector owns a pure dispatchLifecycle(record,evidence) projection and evidence list/subscription/readback. Requests defines local HandoffStatus/Returns ports; composition maps them without cross-section imports. Candidate version may be absent; show artifacts and provenance without inventing a comparable version. Owner-reported returns are write-once and cannot assert observed or owner-judged claims. Existing v1 inputs remain valid; all new enum/shape changes receive compatibility tests. Freeze body/digest canonicalization is checked with golden vectors. Send remains explicit, single-use, destination-bound and durable before transport. Manual handoff history cannot silently bypass a send/route-switch fence.
<!-- codex-section:end id="spec.hq-expansion#iface.requests.001" -->

<!-- codex-section:begin id="spec.hq-expansion#iface.inspiration.001" -->
## Inspiration Interface Contracts

Keep hq.design.references/v1 compatible. Add hq.design.reference-graph/v1 with stable subject identities, immutable capture references and exact-digest section/element anchors. Titles never define identity. Derive stable node IDs from canonical identity. Graph/captures/packets live in workspace storage, not disposable cache. Add hq.design.reference-packet/v1, strict closed-shape validation, digest checks and idempotent adoption. Preserve distinct source rights vocabularies through an explicit conservative mapping. ReferenceBundle exposes capture IDs, packet digest and rights summary; root maps it to existing request evidence until the shared owner accepts an additive reference kind. No arbitrary scripts, remote fetches or third-party executable markup are imported.
<!-- codex-section:end id="spec.hq-expansion#iface.inspiration.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.test-plan.001" -->
## Test Plan

Run named section checks serially after fresh admission. Requests: node tests under modules/design/requests/test, its Vitest config and section TypeScript. Connector: node tests under modules/design/connector/test and section TypeScript. References: its node tests, Vitest config and TypeScript. At composition run their deduplicated union, current preview checks, root typecheck/build and full discovered tests if impact remains unknown. Capture real changed-flow Browser evidence with synthetic content and exact source/build correspondence; report Electron/macOS/live limitations. Existing catalog group names are used; group execution support is verified in each candidate rather than assumed from catalog presence.
<!-- codex-section:end id="spec.hq-expansion#ctx.test-plan.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.operator-interaction-inventory.001" -->
## Operator Interaction Inventory

| Phase | Owner action | Executing route | Boundary and readback |
| --- | --- | --- | --- |
| Planning/build/tests/publication | None beyond current source/PR request | Ordinary UID, native HQ child worktree, scoped Git/GitHub | Exact base, owner, paths, checks, PR readback; no sudo |
| Local private corpus connection | Select configured source capabilities in the app | Narrow read-only corpus/packet port | No corpus mutation or public upload; no arbitrary filesystem IPC |
| Real dispatch/catalog/result qualification | Preserve existing receiver qualification gates | Existing Jones Code capability after exact source contract/readback | No live send from tests; unknown effects reconcile before retry |
| Merge/install/deployment/signing/credentials | Not included | Existing authorized owner route only | Source candidates do not prove operational installation |
| Recovery | None for bounded local edits | Preserve original PR heads and reversible child branches | Stop on unknown effects, unowned changes or lost rollback; no cleanup/deletion |

<!-- codex-section:end id="spec.hq-expansion#ctx.operator-interaction-inventory.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.task-plan.001" -->
## Parallelization And Task Plan

Ready independent section tasks: requests-lifecycle, connector-lifecycle and reference-graph. Reference-packets follows accepted reference-graph in the same writer cone. Composition follows all four and the explicit integration release predicate. Wiki tasks will be added after their exact source plan, before any Wiki implementation. No wave barrier: release currently ready tasks after compiler validation and native source/ownership preflight; accept results in completion order.

Native builder tuple is exactly claude-sonnet-5-5/high from the live T3 catalog. The currently bound typed model helper lacks Sonnet; any graph/compiler capsule projection using a supported placeholder is explicitly a planning fixture and never a native launch/model proof. Actual native launches retain the owner-selected Sonnet tuple and returned task IDs.
<!-- codex-section:end id="spec.hq-expansion#ctx.task-plan.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.stop-recovery-delivery.001" -->
## Stop, Recovery, And Delivery Boundaries

Stop affected mutation on stale source identity, overlapping writer cones, unexpected changes, unknown prior effects, incompatible contracts or unqualified real services. Preserve existing private-source/publication and merge/install holds. Worktree isolation must be native HQ-bound; a prompt changing directories is not a binding. Use existing HQ coordinators for isolated builders. Publish non-draft coherent source candidates against exact accepted section parents, link every owned PR, read back heads/bases and report checks truthfully. No reviewer bots, force push, branch deletion, worktree cleanup, deployment or credentials. Record deferred minor findings without implementing unrelated scope. Do not claim the full real loop or corpus integration delivered from fixtures alone.
<!-- codex-section:end id="spec.hq-expansion#ctx.stop-recovery-delivery.001" -->

<!-- codex-section:begin id="spec.hq-expansion#plan.implementation.001" -->
```json
{
  "schema_version": 1,
  "default_context_refs": [
    "spec.hq-expansion#ctx.project-summary.001",
    "spec.hq-expansion#ctx.change-surface.001",
    "spec.hq-expansion#ctx.stop-recovery-delivery.001"
  ],
  "deferred_findings_sink_ref": null,
  "artifact_path_hints": {
    "spec.hq-expansion": "docs/engineering-specs/hq-expansion.md"
  },
  "launch_policy": "start_all_currently_launchable_with_rolling_capacity_refill",
  "machine_block_source_rendering": "deterministic_two_space_json",
  "runtime_rendering": "canonical_compact_json",
  "fan_in_owner": "hq-expansion-coordinator",
  "additional_final_check_groups": [],
  "delivery_boundary": "Publish additive candidates; hold merge/install/live operations for existing owners."
}
```
<!-- codex-section:end id="spec.hq-expansion#plan.implementation.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.requests-lifecycle.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-requests-lifecycle",
  "objective": "Extend reject, returned inbox, status ports, owner-reported returns and navigation-only intents.",
  "context_refs": [
    "spec.hq-expansion#iface.requests.001",
    "spec.hq-expansion#ctx.test-plan.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/",
    "packages/"
  ],
  "write_scope": [
    "modules/design/requests"
  ],
  "requires": [
    "spec.hq-expansion#req.requests.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.requests.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.requests-lifecycle.001"
  ],
  "affected_check_groups": [
    "design-requests"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Sonnet5.5/high native builder; exact HQ worktree and sole Git owner.",
    "Own cone only; no live dispatch, private corpus publication or root edits.",
    "Publish scoped child PR; preserve merge/install holds."
  ],
  "stop_conditions": [
    "Unknown effects, incompatible source contract, overlapping ownership or stale base."
  ]
}
```
<!-- codex-section:end id="spec.hq-expansion#task.requests-lifecycle.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.requests-lifecycle.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.requests.001"
  ],
  "scenario": "At an exact candidate revision, a labelled synthetic end-to-end test and rendered flow prove freeze → confirm → queued → running → returned → accept/reject/revise, with restart recovery. Reject creates no draft or execution. Owner-reported data cannot claim observed/native verification. Unknown receipts cannot be resent. Cross-section canonical digests agree. Navigation and readback produce zero sends. Host/model variance is shown. Native runtime, real receiver and installation evidence are reported separately.",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.requests-lifecycle.001",
  "evidence_executor_task": "spec.hq-expansion#task.requests-lifecycle.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/requests"
  ],
  "affected_check_groups": [
    "design-requests"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.requests-lifecycle.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.connector-lifecycle.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-connector-lifecycle",
  "objective": "Add lifecycle projection, evidence list/subscription/readback, pinned route display and manual-route fence.",
  "context_refs": [
    "spec.hq-expansion#iface.requests.001",
    "spec.hq-expansion#ctx.test-plan.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/",
    "packages/"
  ],
  "write_scope": [
    "modules/design/connector"
  ],
  "requires": [
    "spec.hq-expansion#req.requests.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.requests.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.connector-lifecycle.001"
  ],
  "affected_check_groups": [
    "design-connector"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Sonnet5.5/high native builder; exact HQ worktree and sole Git owner.",
    "Own cone only; no live dispatch, private corpus publication or root edits.",
    "Publish scoped child PR; preserve merge/install holds."
  ],
  "stop_conditions": [
    "Unknown effects, incompatible source contract, overlapping ownership or stale base."
  ]
}
```
<!-- codex-section:end id="spec.hq-expansion#task.connector-lifecycle.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.connector-lifecycle.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.requests.001"
  ],
  "scenario": "At an exact candidate revision, a labelled synthetic end-to-end test and rendered flow prove freeze → confirm → queued → running → returned → accept/reject/revise, with restart recovery. Reject creates no draft or execution. Owner-reported data cannot claim observed/native verification. Unknown receipts cannot be resent. Cross-section canonical digests agree. Navigation and readback produce zero sends. Host/model variance is shown. Native runtime, real receiver and installation evidence are reported separately.",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.connector-lifecycle.001",
  "evidence_executor_task": "spec.hq-expansion#task.connector-lifecycle.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/connector"
  ],
  "affected_check_groups": [
    "design-connector"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.connector-lifecycle.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.reference-graph.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-reference-graph",
  "objective": "Add additive subject graph, capture lineage, availability, conservative rights and provenance.",
  "context_refs": [
    "spec.hq-expansion#iface.inspiration.001",
    "spec.hq-expansion#ctx.test-plan.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/",
    "packages/"
  ],
  "write_scope": [
    "modules/design/references"
  ],
  "requires": [
    "spec.hq-expansion#req.inspiration.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.inspiration.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.reference-graph.001"
  ],
  "affected_check_groups": [
    "design-references"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Sonnet5.5/high native builder; exact HQ worktree and sole Git owner.",
    "Own cone only; no live dispatch, private corpus publication or root edits.",
    "Publish scoped child PR; preserve merge/install holds."
  ],
  "stop_conditions": [
    "Unknown effects, incompatible source contract, overlapping ownership or stale base."
  ]
}
```
<!-- codex-section:end id="spec.hq-expansion#task.reference-graph.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.reference-graph.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.inspiration.001"
  ],
  "scenario": "A synthetic website tree and app-flow-screen tree can be imported idempotently, browsed, pinned to a project and exported as an immutable packet. Re-capture preserves old pins and ratings. Element anchors bind exact capture digests. Present, no-image, blob-missing, source-unavailable and missing-at-source remain distinct. Unknown rights cannot become permitted. Restricted/private assets never enter publishable output; exclusions are listed. Future schemas open without writes.",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.reference-graph.001",
  "evidence_executor_task": "spec.hq-expansion#task.reference-graph.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/references"
  ],
  "affected_check_groups": [
    "design-references"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.reference-graph.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.reference-packets.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-reference-packets",
  "objective": "Validate, adopt and export immutable synthetic/local reference packets and reference bundles.",
  "context_refs": [
    "spec.hq-expansion#iface.inspiration.001",
    "spec.hq-expansion#ctx.test-plan.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/",
    "packages/"
  ],
  "write_scope": [
    "modules/design/references"
  ],
  "requires": [
    "spec.hq-expansion#req.inspiration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-expansion#task.reference-graph.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.inspiration.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.reference-packets.001"
  ],
  "affected_check_groups": [
    "design-references"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Sonnet5.5/high native builder; exact HQ worktree and sole Git owner.",
    "Own cone only; no live dispatch, private corpus publication or root edits.",
    "Publish scoped child PR; preserve merge/install holds."
  ],
  "stop_conditions": [
    "Unknown effects, incompatible source contract, overlapping ownership or stale base."
  ]
}
```
<!-- codex-section:end id="spec.hq-expansion#task.reference-packets.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.reference-packets.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.inspiration.001"
  ],
  "scenario": "A synthetic website tree and app-flow-screen tree can be imported idempotently, browsed, pinned to a project and exported as an immutable packet. Re-capture preserves old pins and ratings. Element anchors bind exact capture digests. Present, no-image, blob-missing, source-unavailable and missing-at-source remain distinct. Unknown rights cannot become permitted. Restricted/private assets never enter publishable output; exclusions are listed. Future schemas open without writes.",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.reference-packets.001",
  "evidence_executor_task": "spec.hq-expansion#task.reference-packets.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/references"
  ],
  "affected_check_groups": [
    "design-references"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.reference-packets.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.request-composition.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "design-integration-owner",
  "objective": "Existing integration owner composes Requests/Runs, storage and result/reference mappings; verifies complete synthetic loop.",
  "context_refs": [
    "spec.hq-expansion#iface.requests.001",
    "spec.hq-expansion#ctx.test-plan.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/",
    "packages/"
  ],
  "write_scope": [
    "modules/design/preview",
    "modules/design/requests/design-module.ts",
    "modules/design/connector/design-module.ts"
  ],
  "requires": [
    "spec.hq-expansion#req.requests.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-expansion#task.requests-lifecycle.001",
    "spec.hq-expansion#task.connector-lifecycle.001",
    "spec.hq-expansion#task.reference-packets.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-expansion#ac.integration.001"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.requests.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.request-composition.001"
  ],
  "affected_check_groups": [
    "design-requests",
    "design-connector",
    "design-references",
    "design-ui"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Sonnet5.5/high native builder; exact HQ worktree and sole Git owner.",
    "Own cone only; no live dispatch, private corpus publication or root edits.",
    "Publish scoped child PR; preserve merge/install holds."
  ],
  "stop_conditions": [
    "Unknown effects, incompatible source contract, overlapping ownership or stale base."
  ]
}
```
<!-- codex-section:end id="spec.hq-expansion#task.request-composition.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.request-composition.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.requests.001"
  ],
  "scenario": "At an exact candidate revision, a labelled synthetic end-to-end test and rendered flow prove freeze → confirm → queued → running → returned → accept/reject/revise, with restart recovery. Reject creates no draft or execution. Owner-reported data cannot claim observed/native verification. Unknown receipts cannot be resent. Cross-section canonical digests agree. Navigation and readback produce zero sends. Host/model variance is shown. Native runtime, real receiver and installation evidence are reported separately.",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.request-composition.001",
  "evidence_executor_task": "spec.hq-expansion#task.request-composition.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/preview",
    "modules/design/requests/design-module.ts",
    "modules/design/connector/design-module.ts"
  ],
  "affected_check_groups": [
    "design-requests",
    "design-connector",
    "design-references",
    "design-ui"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.request-composition.001" -->


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

Implementation is independently authorized by the owner's request for plans, builds and PRs. Planning mechanics supply no authority. Claude Frontier is task-scoped, with the explicit owner override Opus 5.5/high for planning and Sonnet 5.5/high for builders. This revision encodes completed Opus plans for all three extensions. Wiki starts with a contract, then parallel core/UI cones; root integration stays serialized.
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

Add Wiki fourth in the main rail after Work. Search and read BusinessLessons plus the resolved App-Development research corpus. Support linked topics/records, source provenance, backlinks, repository filters, history and read-only graph-aware navigation. Consume original records without assuming Obsidian migration. Distinguish graph snapshot freshness from content freshness. Do not write either source repository, execute embedded content, follow arbitrary filesystem paths or publish corpus content. Read committed Git objects through fixed-argv Node calls, a safe Markdown AST, lexical search and backlinks. Original Markdown stays canonical. Obsidian is optional; no migration or embedded runtime is required.
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

Opus planning contributions: request lifecycle audit and inspiration/REA audit; Wiki research is complete: BusinessLessons typed links and App-Development Markdown topics are the canonical input. Graphify structural snapshot freshness stays separate from source semantic links. Karpathy’s source-plus-Wiki pattern does not require embedding Obsidian (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Facts above are exact source observations; recommendations below are planning decisions. Consumer-impact coverage is partial: selected section source and tests at those heads were inspected; real receiver contracts, installed app, private producer extractability and combined-shell qualification remain outside that evidence.

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

Run named section checks serially after fresh admission. Requests: node tests under modules/design/requests/test, its Vitest config and section TypeScript. Connector: node tests under modules/design/connector/test and section TypeScript. References: its node tests, Vitest config and TypeScript. At composition run their deduplicated union, current preview checks, root typecheck/build and full discovered tests if impact remains unknown. Capture real changed-flow Browser evidence with synthetic content and exact source/build correspondence; report Electron/macOS/live limitations. Design catalog groups are preserved. Proposed Wiki groups are loaded from the committed docs/planning-evidence/hq-expansion/check-groups.projection.toml for PROJECTION validation only; source catalog revision/hash are recorded alongside it. Canonical group adoption stays with Design. Group presence never proves execution support.
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

Ready independent section tasks: requests-lifecycle, connector-lifecycle and reference-graph. Reference-packets follows accepted reference-graph in the same writer cone. Composition follows all four and the explicit integration release predicate. Wiki-contract is independently ready; core/UI follow its accepted commit in disjoint cones. Private validation follows core, shared integration follows both plus the common-base release predicate. Reference-producer follows reference-packets sequentially. No wave barrier: release currently ready tasks after compiler validation and native source/ownership preflight; accept results in completion order.

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


<!-- codex-section:begin id="spec.hq-expansion#iface.wiki.001" -->
## Wiki Contract And Core

WK-C owns modules/wiki/contract/. Define hq.wiki.source/v1; namespaces bl/appdev; PageKey(namespace, relative path); aliases; SourceDescriptor with ref, commit, commitTime, indexedAt and freshness; Page with safe AST, fields, outLinks and parsed/raw state; backlinks, hits and topics. WikiService exposes exactly listSources, search, getPage, resolveAlias, getBacklinks, listTopics and indexStatus. Validate logical keys; renderer supplies no roots, refs, URLs or argv. Cap queries at 256 characters, results at 50, page blobs at the accepted contract MAX_PAGE_BLOB_BYTES (2 MiB). Destinations use page/<namespace>/<encoded path>, search?q= and topics/<namespace>; scheme-like forms fail shell validation.

WK-CORE owns modules/wiki/core/. Pure GitObjectSource listTree/readBlob port; Node adapter uses execFile with fixed Git argv, configured bare directories, no shell/fetch, bounded blobs/timeouts and exact remote/root/ref checks. Generic frontmatter parser accepts bounded scalar/list grammar; reject duplicates and fall back to readable raw on unsupported syntax. Private prefix/relationship tables stay in external runtime profiles. Safe Markdown AST includes headings, paragraphs, lists, fences, quotes, tables, emphasis and links; HTML and unsafe schemes stay inert; no images. Ignore links inside code. Resolve relative links/aliases, preserve ambiguity and missing targets. Deterministic BM25/backlinks serialize by namespace and commit outside sources. No new dependencies, React or Electron in core.

WK-UI owns modules/wiki/ui/. Consume only the contract and injected navigation/appearance/WikiService ports. Use createElement for home, search, reader, backlinks, topic tree, repository filter, history and disambiguation. Show source commit/ref/indexed time; remote freshness may be unknown. Navigation/search never execute work.

WK-PV follows core in owned external storage, independent of existing dirty checkouts. Pin sources and private profiles locally. Compare parser/link results against current source schema; review any oracle code before bounded execution. Report only aggregate counts, mismatch categories, fallback rate, timing and size publicly. Content/IDs/names/screenshots remain private. Scratch is task-owned outside /tmp, removed on success/failure/cancellation.

Root later promotes types into @hq/contracts, adds Wiki/navigation migration preserving existing destinations, mounts views, adds frozen closed preload/IPC through electron/wiki-host.ts, and uses worker indexing plus userData cache. Installed-app source configuration is a separate effect.
<!-- codex-section:end id="spec.hq-expansion#iface.wiki.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ac.wiki.001" -->
## Wiki Acceptance

Synthetic sources prove cross-repository search/filtering, linked pages/topics, backlinks, history, ambiguity and dangling-target handling. Namespaces keep same-title records distinct. Malformed frontmatter stays readable; code links are ignored; HTML and unsafe schemes are inert. Reject traversal, absolute paths, symlinks, NULs, oversized blobs and source binding mismatches. Source trees remain unchanged. Render changed flows with synthetic data. Report real-source aggregate validation separately from fixtures and installed-app readiness.
<!-- codex-section:end id="spec.hq-expansion#ac.wiki.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.wiki-checks.001" -->
## Wiki Bases And Checks

Sonnet 5.5/high builders use the conditional launch-only contract-parent route in ctx.wiki-launch.001. Both must begin at accepted PR34 commit 76a1dbc6dd8ed1eb56400fbb9e18bc4e621038a9 and retain their generated native branches. Their PR base is published t3/50386c27 at that same commit. A child from the advanced T1 planning branch would inherit unrelated docs, so that route is held. No branch switch, reset, rebase, force push or retarget is an allowed workaround.

After fresh admission run serially node --test modules/wiki/contract/test/*.test.ts and npx tsc -p modules/wiki/contract/tsconfig.json --noEmit for contract changes only; author already reports these passing on PR34. CORE and UI run the corresponding section commands in their capsules. Use the locked local TypeScript binary when installed and verify its version; npx must not install a missing compiler implicitly. CORE tests own and remove synthetic bare repositories, under task-owned storage outside /tmp. Private-source validation has a separate release after CORE and runs outside CI. Integration runs the deduplicated union, root typecheck/build, navigation migration/preload membership checks and rendered synthetic browse/search. No test fetches content or sends work.
<!-- codex-section:end id="spec.hq-expansion#ctx.wiki-checks.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.reference-producer.001" -->
## Local Inspiration Producer

The owner selected existing local app/study sources. After packets, the same sequential reference lane implements a clean-room Node-only producer in modules/design/references/producer/. No private files are selected or copied. First publish producer/FORMATS.md with public-safe field names/version discriminators and hand-authored examples, no real values/names/IDs/paths. This assigns this bounded legacy adapter, formerly under HQD-12b, to the reference producer cone.

V1 reads immutable gallery releases (resolve current pointer once), versioned study/run/annotation JSON, images/frames and structured observation/geometry facts. Exclude mutable acquisition trees, captured HTML/JS/CSS, network, taste ratings/notes. Taste captures follow later after exact format research. REA is optional recorded producer provenance only.

Source descriptors/rights bindings live in external local config. Check schemas, release/catalog or study/receipt digests, realpath containment, regular files and byte caps; allow only the declared pointer hop. Abort with no output on generation changes or unknown versions. Validate deterministic packets through the accepted reader. Preserve private/non-redistributable rights and availability. Output to an owned external store; reject any Git-worktree ancestor, including linked worktrees with a .git file. Unknown rights never become permitted. Public real-source smoke evidence is aggregate counts/digests/tallies only.

Tests cover deterministic packets, generation changes, future schemas, traversal/symlinks, hash-invalid/missing blobs, partial receipts, rights/export exclusions and Git-output rejection. Run node --test --test-concurrency=1 modules/design/references/producer/test/*.test.ts and npx tsc -p modules/design/references/producer/tsconfig.json --noEmit, plus reference checks. No src/ui imports may reach producer; no network module imports. Root exposes configured source IDs, never paths.
<!-- codex-section:end id="spec.hq-expansion#ctx.reference-producer.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.wiki-contract.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-wiki-contract",
  "objective": "Freeze WikiService, safe AST and validated logical destinations.",
  "context_refs": [
    "spec.hq-expansion#iface.wiki.001",
    "spec.hq-expansion#ctx.test-plan.001"
  ],
  "read_scope": [
    "docs/",
    "modules/",
    "packages/"
  ],
  "write_scope": [
    "modules/wiki/contract"
  ],
  "requires": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.wiki.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.wiki-contract.001"
  ],
  "affected_check_groups": [
    "wiki-contract"
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
<!-- codex-section:end id="spec.hq-expansion#task.wiki-contract.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.wiki-contract.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "scenario": "Freeze WikiService, safe AST and validated logical destinations.; prove invariants/commands in spec.hq-expansion#iface.wiki.001",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.wiki-contract.001",
  "evidence_executor_task": "spec.hq-expansion#task.wiki-contract.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/wiki/contract"
  ],
  "affected_check_groups": [
    "wiki-contract"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.wiki-contract.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.wiki-core.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-wiki-core",
  "objective": "Build committed-source reader, parser, safe AST, index, aliases and backlinks.",
  "context_refs": [
    "spec.hq-expansion#iface.wiki.001",
    "spec.hq-expansion#ctx.wiki-contract-disposition.001",
    "spec.hq-expansion#ctx.wiki-launch.001",
    "spec.hq-expansion#ctx.wiki-core-capsule.001"
  ],
  "read_scope": [
    "docs/",
    "modules/",
    "packages/"
  ],
  "write_scope": [
    "modules/wiki/core/src",
    "modules/wiki/core/test",
    "modules/wiki/core/tsconfig.json",
    "modules/wiki/core/README.md"
  ],
  "requires": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-expansion#task.wiki-contract.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.wiki.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.wiki-core.001"
  ],
  "affected_check_groups": [
    "wiki-core"
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
<!-- codex-section:end id="spec.hq-expansion#task.wiki-core.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.wiki-core.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "scenario": "Prove the exact behavior, checks, caps, null projection, safe parsing and source-unchanged invariants in spec.hq-expansion#ctx.wiki-core-capsule.001",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.wiki-core.001",
  "evidence_executor_task": "spec.hq-expansion#task.wiki-core.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/wiki/core"
  ],
  "affected_check_groups": [
    "wiki-core"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.wiki-core.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.wiki-ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-wiki-ui",
  "objective": "Build browse/search/reader/topics/backlinks/history/disambiguation against the contract.",
  "context_refs": [
    "spec.hq-expansion#iface.wiki.001",
    "spec.hq-expansion#ctx.wiki-contract-disposition.001",
    "spec.hq-expansion#ctx.wiki-launch.001",
    "spec.hq-expansion#ctx.wiki-ui-capsule.001"
  ],
  "read_scope": [
    "docs/",
    "modules/",
    "packages/"
  ],
  "write_scope": [
    "modules/wiki/ui"
  ],
  "requires": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-expansion#task.wiki-contract.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.wiki.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.wiki-ui.001"
  ],
  "affected_check_groups": [
    "wiki-ui"
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
<!-- codex-section:end id="spec.hq-expansion#task.wiki-ui.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.wiki-ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "scenario": "Prove the view, history, safety, request-only and changed-flow Browser obligations in spec.hq-expansion#ctx.wiki-ui-capsule.001",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.wiki-ui.001",
  "evidence_executor_task": "spec.hq-expansion#task.wiki-ui.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/wiki/ui"
  ],
  "affected_check_groups": [
    "wiki-ui"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.wiki-ui.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.wiki-private-validation.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-wiki-private-validation",
  "objective": "Validate private sources in owned external storage; publish aggregates only.",
  "context_refs": [
    "spec.hq-expansion#iface.wiki.001",
    "spec.hq-expansion#ctx.test-plan.001"
  ],
  "read_scope": [
    "docs/",
    "modules/",
    "packages/"
  ],
  "write_scope": [
    "modules/wiki/core/scripts"
  ],
  "requires": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-expansion#task.wiki-core.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.wiki.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.wiki-private-validation.001"
  ],
  "affected_check_groups": [
    "wiki-core"
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
    "Publish scoped child PR; preserve merge/install holds.",
    "Separate root release after CORE acceptance; report null omissions/raw/truncation/cap aggregates, no private content."
  ],
  "stop_conditions": [
    "Unknown effects, incompatible source contract, overlapping ownership or stale base."
  ]
}
```
<!-- codex-section:end id="spec.hq-expansion#task.wiki-private-validation.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.wiki-private-validation.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "scenario": "Validate private sources in owned external storage; publish aggregates only.; prove invariants/commands in spec.hq-expansion#iface.wiki.001",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.wiki-private-validation.001",
  "evidence_executor_task": "spec.hq-expansion#task.wiki-private-validation.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/wiki/core/scripts"
  ],
  "affected_check_groups": [
    "wiki-core"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.wiki-private-validation.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.wiki-integration.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-wiki-integration",
  "objective": "Named shared owner mounts Wiki and closed IPC on common accepted base; serialize exact files before release.",
  "context_refs": [
    "spec.hq-expansion#ctx.wiki-checks.001",
    "spec.hq-expansion#ctx.test-plan.001"
  ],
  "read_scope": [
    "docs/",
    "modules/",
    "packages/"
  ],
  "write_scope": [
    "packages/contracts",
    "apps/desktop",
    "tests/check-groups.toml"
  ],
  "requires": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-expansion#task.wiki-ui.001",
    "spec.hq-expansion#task.wiki-private-validation.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-expansion#ac.integration.001"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.wiki.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.wiki-integration.001"
  ],
  "affected_check_groups": [
    "wiki-contract",
    "wiki-core",
    "wiki-ui"
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
    "Publish scoped child PR; preserve merge/install holds.",
    "P2 destination-length and P3 null-presence findings remain deferred; no repair without explicit owner direction. Packaging, preload seven-method membership and host-only refresh require exact shared-owner assignment."
  ],
  "stop_conditions": [
    "Unknown effects, incompatible source contract, overlapping ownership or stale base."
  ]
}
```
<!-- codex-section:end id="spec.hq-expansion#task.wiki-integration.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.wiki-integration.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.wiki.001"
  ],
  "scenario": "Named shared owner mounts Wiki and closed IPC on common accepted base; serialize exact files before release.; prove invariants/commands in spec.hq-expansion#ctx.wiki-checks.001",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.wiki-integration.001",
  "evidence_executor_task": "spec.hq-expansion#task.wiki-integration.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "packages/contracts",
    "apps/desktop",
    "tests/check-groups.toml"
  ],
  "affected_check_groups": [
    "wiki-contract",
    "wiki-core",
    "wiki-ui"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.wiki-integration.001" -->

<!-- codex-section:begin id="spec.hq-expansion#task.reference-producer.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-reference-producer",
  "objective": "Publish format note and clean-room local gallery/study packet adapters with aggregate smoke evidence.",
  "context_refs": [
    "spec.hq-expansion#ctx.reference-producer.001",
    "spec.hq-expansion#ctx.test-plan.001"
  ],
  "read_scope": [
    "docs/",
    "modules/",
    "packages/"
  ],
  "write_scope": [
    "modules/design/references/producer"
  ],
  "requires": [
    "spec.hq-expansion#req.inspiration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-expansion#task.reference-packets.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-expansion#ac.inspiration.001"
  ],
  "test_refs": [
    "spec.hq-expansion#test.reference-producer.001"
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
<!-- codex-section:end id="spec.hq-expansion#task.reference-producer.001" -->

<!-- codex-section:begin id="spec.hq-expansion#test.reference-producer.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-expansion#req.inspiration.001"
  ],
  "scenario": "Publish format note and clean-room local gallery/study packet adapters with aggregate smoke evidence.; prove invariants/commands in spec.hq-expansion#ctx.reference-producer.001",
  "evidence": {
    "predicate": "Named meaningful behavior checks pass at exact candidate revision.",
    "invalid": "A named invariant fails or fixture evidence is labelled live.",
    "unknown": "Required real adapter, runtime or source capability is unqualified."
  },
  "environment": [
    "Supported Node/TypeScript section runtime; synthetic records; actual Browser where available"
  ],
  "obligation_owner_task": "spec.hq-expansion#task.reference-producer.001",
  "evidence_executor_task": "spec.hq-expansion#task.reference-producer.001",
  "acceptance_owner": "hq-expansion-coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/references/producer"
  ],
  "affected_check_groups": [
    "design-references"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-expansion#test.reference-producer.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.wiki-contract-disposition.001" -->
## Wiki Contract Disposition

The Wiki continuity owner accepts PR34 at 76a1dbc6dd8ed1eb56400fbb9e18bc4e621038a9 as the CORE/UI dependency, following Opus 5.5/high source reconciliation. Its 22 changed files are confined to modules/wiki/contract/. Source inspection confirms the seven closed read methods, logical request validators, provenance, safe AST and destination helpers. The author's 73 Node tests, TypeScript pass and eighth-method mutation check are reported evidence, not a coordinator rerun. No CI, source integration, installed-app or private-corpus acceptance is inferred.

Compatible interpretations: import MAX_PAGE_BLOB_BYTES (2 MiB = 2,097,152 bytes), never define a second cap. Queries count Unicode code points; UI uses clampQuery rather than HTML maxLength. Existing structural bounds apply to all projections. Thematic breaks, task markers, footnotes, strikethrough, HTML, images and unsafe/rejected links remain verbatim inert text rather than making an otherwise supported page raw. A single-quote URL is not rewritten into a different URL.

Null-valued frontmatter fields and null list items are deliberately omitted from Page.fields, never coerced to false or empty text, and never force a raw page. Other unrepresentable frontmatter falls back to raw instead of silently losing values. Record type remains an ordinary field. UI maps bl to BusinessLessons and appdev to App Development. History is in-session navigation history, not a new service method. home or an unparseable destination selects home; invalid forms also show an inert notice. Refresh belongs only to the host, outside WikiService.

Deferred findings, preserving original severities: P2 non-blocking root seam — shell destinations cap at 512 characters while Wiki can represent 16,384, so long destinations may not persist or navigate through the mounted shell. No root cap or alternate persistence repair is authorized. UI implements its already-required in-session history; mounted-shell acceptance remains separate and must disclose this limitation. P3 non-blocking contract — omitted null fields lose key presence; a lossless contract revision is deferred. Neither finding blocks these bounded source candidates or authorizes repairs. Private validation later reports null omissions, raw pages, truncations and caps as aggregates.
<!-- codex-section:end id="spec.hq-expansion#ctx.wiki-contract-disposition.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.wiki-launch.001" -->
## Conditional CORE And UI Launch Capsule

This plan supplies no launch authority. After the coordinating root accepts these exact published capsules and separately releases CORE/UI, T1 may invoke the supported post-completion follow-up lifecycle on its own completed WK-C child as a launch-only parent. Capture the fresh follow-up task ID. Parent remains source/Git unchanged at 76a1dbc6dd8ed1eb56400fbb9e18bc4e621038a9; native branch t3/wiki-contract-implementation and published PR34 branch t3/50386c27 already point there.

The bounded follow-up overrides the original no-descendants rule only to mechanically launch exactly two named isolated implementation children: lane-wiki-core and lane-wiki-ui, each claude-sonnet-5-5/high. It performs no planning, source edits, Git changes or repairs, and permits no further descendants. T1 retains orchestration, approval and fan-in; the Wiki continuity owner retains feature and contract acceptance.

Before each dispatch capture fresh receiver-native lifecycle, catalog, account and capacity evidence. Preserve the existing account, effort, runtime and holds. Unsupported or unknown nested-route effects hold that exact action with no workaround, replacement or blind retry. Retain every task/child/worktree/branch/start-head receipt. Healthy live work is never duplicated.

Both children start at the unchanged accepted contract commit, so no dependency merge is needed. Each keeps its native generated checkout/branch and is its sole Git owner. Publish one non-draft merge-held PR against t3/50386c27, recording base commit 76a1dbc6dd8ed1eb56400fbb9e18bc4e621038a9. Before push/PR verify start HEAD, unchanged remote base and git diff --name-only 76a1dbc...HEAD; after creation verify the complete PR file list is inside the assigned literal cone. Stop on variance, unexpected/unowned changes, incompatible contract, unknown effect or required out-of-scope access. No branch switch, force, reset, rebase, retarget or deletion.

Both report summary, exact evidence/produced refs, original-severity deferred findings, native IDs/bindings, commits, checks, PR/base and full-diff readback. No real/private sources, root/shared seam, merge, install, live send or corpus configuration release is included.
<!-- codex-section:end id="spec.hq-expansion#ctx.wiki-launch.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.wiki-core-capsule.001" -->
## CORE Implementation Capsule

Task task.wiki-core.001, lane-wiki-core, Sonnet 5.5/high. Writes only modules/wiki/core/src/, test/, tsconfig.json and README.md. modules/wiki/core/scripts/ is reserved for separately released private validation. Read the accepted contract via ../../contract/src/index.ts. No contract/root/lock/config/catalog/shared-contract/IPC/preload edits, package.json or new dependencies. No React/Electron. Pure modules import no node:*; only the Node adapter and tests may. Erasable TypeScript. Synthetic sources only.

Exports: GitObjectSource with resolvePin() returning ref/commit/commitTime after binding checks, listTree(commit) returning path/mode/oid/size and readBlob(oid,maxBytes); IndexStore read/write(namespace,commit,snapshot); validateSourceProfile for a data-only external descriptor (namespace, gitDir, expected remote, ref, root prefix, page extensions, field mappings and topic mode); createNodeGitObjectSource(profile); createWikiHost({profiles,sources,store,clock}) returning {service:WikiService,refresh(namespace?)}. Refresh is host-only. Use contract SearchRequest.query and WikiResult return values exactly, not a parallel service shape.

Node Git adapter: fixed execFile argv, shell:false, --git-dir pointing at configured realpath, --no-replace-objects, --literal-pathspecs and -c core.fsmonitor=false. Allow only bare-status read, fixed remote.origin.url lookup, verified refs/heads/<ref> commit resolution with --end-of-options, show -s --format=%ct normalized to UTC, ls-tree -r -z -l --full-tree and cat-file blob for validated hex OIDs. Use a minimal environment, disabled system/global configuration, terminal prompting and optional locks; timeout, bounded maxBuffer and binary output. No fetch/pull/-C/worktree/source writes. Binding/non-bare/root/ref mismatch or timeout returns unavailable/source-unavailable. Skip/count symlinks, submodules and invalid UTF-8 paths. Oversized blobs are not indexed; getPage returns not-found.

Frontmatter begins at byte zero after an optional BOM; delimit with --- and close with --- or .... Support scalar fields, block/flow lists, comments, quoted values with bounded escapes, decimal numbers and true/false. yes/no remain strings. Null/~/empty fields and null list items follow the explicit omission disposition. Duplicate/invalid keys, nested maps, anchors/tags, block scalars, multiline plain values, unclosed fences and structural overflows yield frontmatter-unsupported raw text. Raw pages still derive body links/backlinks.

Markdown supports ATX/setext headings, paragraphs, nested ordered/bullet lists, fenced/indented code, quotes, GFM tables, emphasis/strong, inline code, Markdown/autolinks/reference links and generic [[target|label]]. Use the accepted safe AST; excluded constructs remain verbatim text. Ignore links in code. Tables beyond 64 columns become plain paragraph text. Validate the final AST; invalid/depth/node-overflow content falls back to markdown-unsupported raw. Undecodable/NUL blobs become not-text raw with replacement characters, never executable content.

Relative links discard query/fragment, percent-decode and resolve lexically within the namespace root. Root-relative Markdown links resolve within that configured namespace, never the host filesystem. Escapes/failed decoding are missing targets; anchor-only links are text. Only http/https/mailto passing validateExternalUrl become external records; rejected links remain original text with no out-link. Alias/relationship resolution stays namespace-scoped: one match page, multiple ambiguous sorted/capped at 50, none missing. Page.outLinks deduplicates/caps at 1000 while the index retains all discovered links. Read field relationships from profiles; never hard-code private source tables.

Titles prefer the configured field, then H1, then file stem. Labels collapse whitespace, drop controls, remain nonempty and truncate without breaking surrogate pairs. BM25 uses k1=1.2,b=0.75,title weight2, Unicode letter/number tokens, lowercase+NFC; ties use pageKeyId code-unit order. Snippets cap at 512. Alias normalization is NFC/lowercase/whitespace collapse; path identity remains exact. Backlinks use resolved page targets sorted by title/key. Deterministic topic IDs have no slash and fit 128 characters; max500 topics and 50-page previews. Content freshness is unknown/null; graph freshness is current only for the pinned indexed commit. Snapshot hq.wiki.index/v1 is keyed by namespace/commit through IndexStore; corrupt/stale snapshots rebuild.

Validate every request and response with the accepted contract. Not found => not-found/not-found; Git/source issue => unavailable/source-unavailable; no index => unavailable/index-unavailable; other failures => internal/internal. Tests cover namespace collisions, traversal/absolute/NUL/oversize input, source-binding mismatches, null projection, malformed/duplicate frontmatter, code/HTML/unsafe/single-quote links, ambiguity/dangling links, deterministic rank, snapshot round-trip and unchanged source trees. Synthetic bare repositories use fixed-date Git plumbing, isolated config and task-owned scratch outside /tmp with exact cleanup on success/failure/cancellation. Static checks forbid network/source mutation, shell:true, exec and child_process outside the adapter.

After fresh admission run serially node --test modules/wiki/core/test/*.test.ts and npx tsc -p modules/wiki/core/tsconfig.json --noEmit (use installed locked binary; no implicit install). Report actual test-file/runner coverage. No Browser evidence is required for this non-UI cone. Publish/read back only the assigned cone under the shared launch rules.
<!-- codex-section:end id="spec.hq-expansion#ctx.wiki-core-capsule.001" -->

<!-- codex-section:begin id="spec.hq-expansion#ctx.wiki-ui-capsule.001" -->
## UI Implementation Capsule

Task task.wiki-ui.001, lane-wiki-ui, Sonnet 5.5/high. Writes only modules/wiki/ui/**. Read the accepted contract only; no core, @hq/contracts or @hq/ui imports. No contract/root/lock/config/catalog/package/IPC/preload changes or dependencies. Production uses no node:*, Electron, fetch or real sources. Use .ts and React.createElement. Existing hoisted react/react-dom and happy-dom support tests; record packaging obligations for the held integration owner.

Export createWikiView(service:WikiService), returning a component with destination:string, appearance:light|dark and navigate(string):void props. Use contract destination helpers only. home or failed parsing shows home; invalid destinations add an inert notice. Implement the requested in-session history and re-sync with changed destination props. Calls to navigate request shell persistence; the known long-destination persistence gap remains deferred, with no root cap or alternate persistence repair.

Views: home with listSources/indexStatus, namespace display map, ref/commit/commitTime/indexedAt, index freshness and remote-freshness unknown; search with clampQuery, namespace filters, hits/snippets/total/truncated indication; reader with namespace/path/commit provenance, ordinary fields, parsed AST or verbatim raw pre plus raw reason; out-links/backlinks, topic parentId tree/count/previews, in-session history and ambiguity/disambiguation. Add loading/errors for each code and sequence guards discarding stale async responses.

Render all text through React children. No dangerouslySetInnerHTML, innerHTML, executable markup, href-based destinations or window.open. Page links are buttons invoking navigation; external URLs remain non-clickable text; missing links remain inert visibly missing labels. CSS classes use wiki- and data-appearance, support both themes without modifying captured content.

Tests use a synthetic in-memory WikiService with validator-valid fixtures and happy-dom. Cover every view/filter/history/ambiguity/missing target, raw content, script-looking text without script elements, seven-method-only calls, stale-response guards and zero work execution from navigation. Static checks forbid production execution/network/unsafe-render APIs and cross-cone imports. After fresh admission run node --test modules/wiki/ui/test/*.test.ts and npx tsc -p modules/wiki/ui/tsconfig.json --noEmit serially, with the installed locked compiler and no implicit install.

Provide a cone-local Vite harness on explicit loopback and synthetic fixtures. Follow the available capture-ui-evidence workflow and product-native collaborative Browser route. Capture light/dark home, search/filter, parsed/raw reader, backlinks, topics and disambiguation at the exact candidate build; verify only local-server network activity and that external text cannot navigate. Temporary harness serving ends with verification. Retain screenshots under the task evidence directory outside /tmp. If root changes would be required, report the Browser gap rather than widening scope; DOM evidence still runs. This proves the isolated view, not mounted shell/Electron/installed acceptance.
<!-- codex-section:end id="spec.hq-expansion#ctx.wiki-ui-capsule.001" -->

# HQ Design execution campaign

<!-- codex-section:begin id="spec.hq-design#ctx.artifact-header.001" -->
Artifact Type: `engineering-spec`

Artifact ID: `spec.hq-design`

Purpose: Implement independently testable Design sections and integrate a useful local desktop loop.

Governing artifact: `prd.hq-design`

Specification owner: T1 Design coordinator

Integration owner: T1, coordinated with HQ shell product owner

Consumers: Design builders, designers and integration owner

Authority effect: none
<!-- codex-section:end id="spec.hq-design#ctx.artifact-header.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.project-summary.001" -->
## Outcome

One HQ Electron app, laptop-piloted, with Design projects across enrolled sources visible through a fast cached catalog. Projects contain multiple views and immutable versions. Canvas is normal; galleries, comparisons, annotations and frozen requests preserve their source identities. This campaign implements 14 independent sections plus cumulative integration. It does not claim remote capability merely from a fake transport, or a Mac installation from a Linux build. Social/Work remain independently owned. The initial bootstrap is separately governed by hq-bootstrap.md.
<!-- codex-section:end id="spec.hq-design#ctx.project-summary.001" -->

<!-- codex-section:begin id="spec.hq-design#req.requirements.001" -->
## Requirements

Implement the full product requirements in ../prds/design.md within each assigned section. Preserve draft/privacy boundaries, immutable evidence, separate Pick/Cite, stable letters/Revisit, general/project taste separation, native-versus-browser provenance, unknown-effect fencing, and shared shell ownership. Owner specifically selects Electron, public HQ, Opus/high section builders, and laptop-visible projects from multiple devices. No mandatory two-way sync. Every component is independently tested before composition.
<!-- codex-section:end id="spec.hq-design#req.requirements.001" -->

<!-- codex-section:begin id="spec.hq-design#ac.acceptance.001" -->
## Acceptance

Each lane meets its named behavioral checks with actual evidence and exposes an adapter-friendly entry point. Cumulative I1: create/switch project and views, arrange and compare two versions, Pick/Cite, save/reopen draft, freeze/export packet. I2 composes references/imports/components/flows/taste. I3 proves labelled-fake dispatch, authoritative unknown fencing and returned-candidate comparison; real existing-thread sends require receiver qualification and new threads require an idempotent external launch/lookup contract. I4 demonstrates warm-cache catalog/navigation without network dependency and bounded lazy content loading. No section alone counts as finished parity.
<!-- codex-section:end id="spec.hq-design#ac.acceptance.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.research-decision-basis.001" -->
## Evidence and decisions

The prior recovered feature research and Opus planning established these product semantics. Initial source is a clean public implementation, not a bulk private-source import. Exact selected-file origin/license/publication review precedes any future copying. This campaign uses public contracts, synthetic fixtures and primary upstream documentation. Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security .

HQ shared foundation v0.3 is accepted at SHA256 a0d4e6789b2549ce9cb828f02babfca5c3a11238d9f832c7c9040c89e8e33271. Its semantics are reflected here without publishing private runtime locators. One whole-HQ host; explicit Light/Dark/System; captures retain their colors; domain switches restore state and never submit. T0 is implementing npm/React/TypeScript/Vite, not a competing package manager or plugin runtime.

Caller paths are shell-to-Design ModulePort, Design-to-section injected ports, and typed desktop adapters only after qualification. The readonly bootstrap DesktopPort grants no filesystem/dispatch. Source discovery and external execution are separate authorities. Impact coverage is partial: all assigned public section cones and their documented ports are covered; installed Mac runtime, private format compatibility, external endpoints and cross-host authorization remain unqualified. Shared interfaces and persisted formats require strict validation, version checks, non-destructive migration and exact context preservation.
<!-- codex-section:end id="spec.hq-design#ctx.research-decision-basis.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.change-surface.001" -->
## Ownership and integration

T1 owns this shared plan and public coordination issue https://github.com/Jones-Systems/HQ/issues/1 . T0 owns initial root manifests/config/lock, apps/desktop/ and packages/contracts/ until an exact handoff. Each lane owns only its literal cone below, including tests/docs. One native-bound isolated worktree and Git owner per lane. No cross-section imports, root lock/config edits or shared registry changes by section lanes. No duplicate global project/task registry. Propose shared types on the issue; T1 promotes them mechanically with the contract owner. Interfaces below are the required interfaces for independent first deliverables; local contract.ts plus labelled fakes explicitly satisfy the bootstrap hold. Root composes sections through injected slots. Source discovery, project content, editable workspace, cache, journals and execution receipts keep separate owners.
<!-- codex-section:end id="spec.hq-design#ctx.change-surface.001" -->

<!-- codex-section:begin id="spec.hq-design#iface.contracts.001" -->
## Minimal interface baseline

Use plain erasable TypeScript. A branded ID is `string & { readonly __kind: K }`; constructors validate nonempty bounded identifiers. K identifies ProjectId, ViewId, VersionId, AnnotationId, PacketId etc. Stable identifiers never derive from display titles. Shared JSON is RFC 8785 JCS with SHA-256; reject unsupported/non-finite values, keep authoring and wire digests distinct, and test golden vectors. Root promotes one implementation rather than leaving several divergent production hash functions.

`SourceAnchor` has `versionId`, `route`, `state`, `viewport:{w,h,dpr}`, `scroll:{x,y}`, `captureDigest`, and `target` as a discriminated union: `{kind:'element',path,rect,textHash?}`, `{kind:'text',quote,prefix,suffix,rects}`, `{kind:'region',rect}`, or `{kind:'ink',points}`. Rect is `{x,y,width,height}` in explicit source CSS pixels; original capture bytes and DPR are preserved. `AnnotationRef` is `{id,letter,anchor,note,kind}` with kind pick/cite/ink/box/arrow/label. `ClaimLevel` is agent-reported/observed/owner-judged. No implicit rebinding to latest.

StoragePort offers namespaced documents, immutable blobs and append-only events through an injected adapter. Baseline atomicity is per document: temp, fsync, rename, directory fsync. Multi-document transactions need a durable manifest and crash recovery tests; never infer atomicity from sequential renames. Request freeze is one atomic record containing packet and draft-consumed marker, preserving recovery/provenance. Source data is untouched; future schemas open read-only or reject without writes. Failed migrations retain snapshots; no automatic journal truncation.

Local section ports can include persistence, clock, preview, clipboard and destination adapters with explicitly labelled fakes. Root alone wires typed capabilities after validation. No generic invoke/service IPC, automatic main-service discovery or credentials in renderer. Sandbox previews without Node or application preload access. Source discovery catalogs retain stable source/repository/project identity, revision/freshness and per-source failures; the laptop workspace is independent of source catalog snapshots. Cached navigation makes no blocking network request. Fetch selected previews/assets with deduplication, cancellation and bounds. Real enrollment, native access and host execution remain separately qualified.

Shell ModulePort and ReferenceEnvelope come from @hq/contracts when T0 publishes its exact commit. ReferenceEnvelope retains version/domain/project/kind/entityId, title, return destination, optional sourceRevision/workspaceId even for an unresolved target. A missing target is not a permission grant. Component lanes do not create shell providers or a second project registry. Framework-free first deliverables use matching local contract.ts ports; React composition follows the published baseline.

<!-- codex-section:end id="spec.hq-design#iface.contracts.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.test-plan.001" -->
## Checks and evidence

Before the foundation is available, each lane writes Node 24 tests in its own cone using built-in `node --test` and erasable TypeScript (no enums, namespaces or parameter properties; explicit .ts imports and import type). Typecheck with pinned TypeScript 7.0.2; do not create module package manifests/locks to run tests. A local tsconfig is allowed. After baseline intake, use its actual npm scripts and add framework/UI checks without changing root dependencies. Root tsconfig must allow .ts imports under noEmit/bundler resolution. Node geometry/reducer tests do not prove rendered layout or native capture.

Take fresh capacity evidence before tests; one serial heavy process on this host. Coordinate a single host test lease in the issue, release it on completion/failure, and do useful source work while occupied. There is no CI initially: report unavailable, never green. Store fault injection covers each write stage; connector negative tests cover identity mismatch, double-click, restart, unknown and reconciliation-zero-send. Browser geometry and Electron isolation/capture need actual runtime evidence after typed preview integration. Future private compatibility and real endpoints remain explicitly unverified.

<!-- codex-section:end id="spec.hq-design#ctx.test-plan.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.task-plan.001" -->
## Rolling execution

Launch every independent first-deliverable lane in admission batches. Initial priority: store, discovery, UI, requests, annotations, projects, compare, canvas, connector, then taste/imports/references/components/flows. This is launch order, not a completion barrier. Each lane first delivers framework-free models/ports/state/geometry with fakes, then React views when T0 lands. No lane needs another section to start. The dependencies listed below gate composition only; root resolves them through adapters rather than copying state. No automated reviewer lanes are added merely for a count. T1 integrates accepted results in rolling order and performs affected checks on the union.
<!-- codex-section:end id="spec.hq-design#ctx.task-plan.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.operator-interaction-inventory.001" -->
## Operator interaction inventory

Source implementation/public repository publication is owner-authorized; no new owner action for those effects. Normal local navigation/cache/draft startup needs no terminal/password. Real remote source enrollment, Jones authentication/receiver qualification, host/model launch, OS installation/signing/notarization, services and migrations are not claimed or activated by this campaign. Root prepares exact routes and readback before requesting any missing consequential authorization; no sudo covered. Unknown effects stop retry. Window lifetime does not own remote jobs. No long-lived scratch in /tmp; task workspaces own exact scratch cleanup on success/failure/cancellation.
<!-- codex-section:end id="spec.hq-design#ctx.operator-interaction-inventory.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.stop-recovery-delivery.001" -->
## Delivery and remaining gates

Publish component branches and non-draft PRs against work/hq-design-plan, link to native thread and record exact head/check evidence on issue #1. Do not merge until integration owner agrees; do not target main with duplicated seed/plan commits. T1 alone revises common plan. No private data/source bulk copy, deployment, signing, release, credential changes, history rewrite or cleanup authority. Preserve unrelated changes and reconcile unknown prior effects before retry.

Readiness is local first-deliverable readiness, not full runtime parity. Real preview/capture/Pick-Cite requires S2 evidence; receiver/receipt requires S1; legacy format adapters require public-safe format notes and selected-file publication decisions; production new-thread launch requires authoritative idempotency/lookup; Mac acceptance requires actual device build. New taste rating controls may be built/rendered; automatic guidance activation and legacy journal reuse remain off. T1 carries these follow-on obligations, not falsely accepted task results. Source integration is distinct from installed availability.
<!-- codex-section:end id="spec.hq-design#ctx.stop-recovery-delivery.001" -->

<!-- codex-section:begin id="spec.hq-design#iface.source-catalog.001" -->
## Laptop source catalog contract

`hq.design.source-catalog/v1` keeps `HostId` and `RootId` opaque. RepoIdentity is ordered evidence `{normalizedRemote?,rootCommit?,localOnly}`. SourceProjectId is SHA-256 of JCS `{hostId,rootId,relativePath}`. CatalogSnapshot is `{hostId,generation,complete,observedAt,entries}`. Entry identity is `{sourceProjectId,hostId,repoIdentity,relativePath}` with `{displayName,revision?,metadata,previews}`. PreviewRef is `{digest,mediaType,bytes,w?,h?}`. Freshness is `{status,lastSuccessAt,generation}`, status fresh/stale/offline/timeout/error/partial/missing-at-source. WorkspaceSourceLink is `{projectId,sourceProjectId,linkedAt,observedRevision}` and is explicit; matching titles/remotes never merges records.

Discovery adapters only expose `listSnapshot(hostId,signal)` and `readPreview(ref,signal)`; no execution, cloning or writes. Discovery reachability and execution eligibility share HostId only. Failed or partial refresh never removes entries. Only a newer complete snapshot can positively mark omitted entries missing-at-source; workspace links survive. A changed host identity fingerprint is held as conflict. A late response updates the visible view only when its context/generation is still current.

Storage namespaces: `workspace` is authoritative, editable and backed up. `cache` is bounded, evictable and excluded from bundles/exports/backups. Corrupt cache rebuild never alters workspace. Evidence adoption promotes a digest into workspace before cache eviction. Shared preview fetches coalesce by digest; caller cancellation aborts transport only after every subscriber cancels. Enforce per-host/global concurrency, per-item bytes, total-cache budget and visible-tile priority. Real enrollment/endpoint access remains qualified separately.

Projects renders editable workspace projects and read-only source entries with host/freshness badges; linking requires explicit action. Store owns both namespaces, imports excludes cache, connector remains execution-only. Root proves the cumulative no-network-wait project switch. Warm cache with never-resolving adapters must render immediately; fake-clock multi-host timeouts yield useful partial data; 500 entries/24 visible request only bounded visible/prefetch items; duplicate digests fetch once; rapid A/B/C context changes apply C only; failures preserve stale/offline content. These amend the corresponding lane contracts and tests below.
<!-- codex-section:end id="spec.hq-design#iface.source-catalog.001" -->

<!-- codex-section:begin id="spec.hq-design#plan.implementation.001" -->
```json
{
  "schema_version": 1,
  "default_context_refs": [
    "spec.hq-design#iface.source-catalog.001",
    "spec.hq-design#ctx.project-summary.001",
    "spec.hq-design#iface.contracts.001",
    "spec.hq-design#ctx.test-plan.001",
    "spec.hq-design#ctx.stop-recovery-delivery.001"
  ],
  "deferred_findings_sink_ref": null,
  "artifact_path_hints": {
    "spec.hq-design": "docs/engineering-specs/design.md"
  },
  "launch_policy": "start_all_currently_launchable_with_rolling_capacity_refill",
  "machine_block_source_rendering": "deterministic_two_space_json",
  "runtime_rendering": "canonical_compact_json",
  "fan_in_owner": "coordinator",
  "additional_final_check_groups": [],
  "delivery_boundary": "Publish owned candidates; hold merge for cross-owner integration; no release or installation."
}
```
<!-- codex-section:end id="spec.hq-design#plan.implementation.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.projects.001" -->
## T2 projects

Writer: `modules/design/projects/` only.

**Project content:** views (several per project), versions per view, thumbnails, gallery grid with filters and collapse, project switcher. Keyed by HQ `ProjectId`, with a local provisional registry adapter labelled as such.

Behavioral acceptance: Switching project A→B→A restores selection, filters and scroll. Switching never changes or submits drafts (spy on the StoragePort shows zero writes to draft namespaces). Adding a version keeps earlier versions immutable. Gallery renders 500 synthetic projects with lazy thumbnails, measured (no budget is promised).

Integration dependency: Shared project registry from the HQ foundation (root adapter).

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.projects.001" -->

<!-- codex-section:begin id="spec.hq-design#task.projects.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "**Project content:** views (several per project), versions per view, thumbnails, gallery grid with filters and collapse, project switcher. Keyed by HQ `ProjectId`, with a local provisional registry adapter labelled as such.",
  "context_refs": [
    "spec.hq-design#ctx.projects.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/projects/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/projects/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.projects.001"
  ],
  "affected_check_groups": [
    "design-projects"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.projects.001" -->

<!-- codex-section:begin id="spec.hq-design#test.projects.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "Switching project A→B→A restores selection, filters and scroll. Switching never changes or submits drafts (spy on the StoragePort shows zero writes to draft namespaces). Adding a version keeps earlier versions immutable. Gallery renders 500 synthetic projects with lazy thumbnails, measured (no budget is promised).",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.projects.001",
  "evidence_executor_task": "spec.hq-design#task.projects.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/projects/"
  ],
  "affected_check_groups": [
    "design-projects"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.projects.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.canvas.001" -->
## T3 canvas

Writer: `modules/design/canvas/` only.

**Infinite canvas:** pan and zoom (wheel, trackpad, keyboard), artboards, selection and multi-select, arrange, snap, and an inspector of useful properties. Items come from registered `CanvasItemProvider`s.

Behavioral acceptance: Moving an item changes only the arrangement record, never the version or source bytes. Zoom keeps the point under the cursor fixed (browser-mode geometry). Keyboard pan and focus work. Undo/redo of arrangement. Arrangement round-trips through StoragePort unchanged.

Integration dependency: Providers from HQD-09 and HQD-10, and project views from HQD-01, wired by root.

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.canvas.001" -->

<!-- codex-section:begin id="spec.hq-design#task.canvas.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t3",
  "objective": "**Infinite canvas:** pan and zoom (wheel, trackpad, keyboard), artboards, selection and multi-select, arrange, snap, and an inspector of useful properties. Items come from registered `CanvasItemProvider`s.",
  "context_refs": [
    "spec.hq-design#ctx.canvas.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/canvas/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/canvas/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.canvas.001"
  ],
  "affected_check_groups": [
    "design-canvas"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.canvas.001" -->

<!-- codex-section:begin id="spec.hq-design#test.canvas.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "Moving an item changes only the arrangement record, never the version or source bytes. Zoom keeps the point under the cursor fixed (browser-mode geometry). Keyboard pan and focus work. Undo/redo of arrangement. Arrangement round-trips through StoragePort unchanged.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.canvas.001",
  "evidence_executor_task": "spec.hq-design#task.canvas.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/canvas/"
  ],
  "affected_check_groups": [
    "design-canvas"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.canvas.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.compare.001" -->
## T4 compare

Writer: `modules/design/compare/` only.

**Side-by-side comparison** of N versions or views at once. Each panel sizes independently, with an optional synced scroll. Device/viewport presets. Uses `PreviewCapability` (fake) and static captures.

Behavioral acceptance: Resizing panel 1 leaves the widths of panels 2..N unchanged. Synced scroll maps by ratio, and turning it off unlinks the panels. A static capture and a live preview are labelled differently. Choosing a version is bound to `VersionId`, not "latest".

Integration dependency: Real preview from root's S2 work. Overlays from HQD-04.

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.compare.001" -->

<!-- codex-section:begin id="spec.hq-design#task.compare.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t4",
  "objective": "**Side-by-side comparison** of N versions or views at once. Each panel sizes independently, with an optional synced scroll. Device/viewport presets. Uses `PreviewCapability` (fake) and static captures.",
  "context_refs": [
    "spec.hq-design#ctx.compare.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/compare/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/compare/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.compare.001"
  ],
  "affected_check_groups": [
    "design-compare"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.compare.001" -->

<!-- codex-section:begin id="spec.hq-design#test.compare.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "Resizing panel 1 leaves the widths of panels 2..N unchanged. Synced scroll maps by ratio, and turning it off unlinks the panels. A static capture and a live preview are labelled differently. Choosing a version is bound to `VersionId`, not \"latest\".",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.compare.001",
  "evidence_executor_task": "spec.hq-design#task.compare.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/compare/"
  ],
  "affected_check_groups": [
    "design-compare"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.compare.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.annotations.001" -->
## T5 annotations

Writer: `modules/design/annotations/` only.

**Annotations:** Pick element and Cite selected text as separate controls, plus ink, box, arrow, label, eraser, undo/redo, stable reference letters, Revisit, Copy export. Includes `src/preview-agent/`, a pure DOM script that root bundles into the preview preload.

Behavioral acceptance: Pick never produces a text citation and Cite never produces an element pick. Letters stay stable after deleting B (A, C stay A, C, and the next new one is D, unless the spec decides otherwise). Anchors survive a re-render at a different `dpr` and scroll (browser mode). Undo/redo is symmetric for every tool. Copy export contains the letters, quotes and notes but no local paths.

Integration dependency: Root injects the agent and checks geometry in Electron (S2).

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.annotations.001" -->

<!-- codex-section:begin id="spec.hq-design#task.annotations.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t5",
  "objective": "**Annotations:** Pick element and Cite selected text as separate controls, plus ink, box, arrow, label, eraser, undo/redo, stable reference letters, Revisit, Copy export. Includes `src/preview-agent/`, a pure DOM script that root bundles into the preview preload.",
  "context_refs": [
    "spec.hq-design#ctx.annotations.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/annotations/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/annotations/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.annotations.001"
  ],
  "affected_check_groups": [
    "design-annotations"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.annotations.001" -->

<!-- codex-section:begin id="spec.hq-design#test.annotations.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "Pick never produces a text citation and Cite never produces an element pick. Letters stay stable after deleting B (A, C stay A, C, and the next new one is D, unless the spec decides otherwise). Anchors survive a re-render at a different `dpr` and scroll (browser mode). Undo/redo is symmetric for every tool. Copy export contains the letters, quotes and notes but no local paths.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.annotations.001",
  "evidence_executor_task": "spec.hq-design#task.annotations.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/annotations/"
  ],
  "affected_check_groups": [
    "design-annotations"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.annotations.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.requests.001" -->
## T6 requests

Writer: `modules/design/requests/` only.

**Request lifecycle:** draft, then clarify, then freeze, then review.
• Drafts autosave and are privacy-labelled.
• Attachments are explicitly selected.
• Freeze produces an immutable `hq.design.decision-packet/v1` (digest, lineage, supersedes).
• Review screen for the returned candidate: claim levels, before/after through the compare slot, accept / revise / defer as appended events.

Behavioral acceptance: Restart mid-edit: the draft comes back byte-identical (fake StoragePort with crash injection). Freeze is atomic, saving the packet and clearing the draft. A later edit creates a new linked packet and leaves the old one unchanged. Privacy/export output contains no unsent drafts and no unselected images. Freezing never triggers dispatch (connector spy shows zero calls). Revise creates a linked new draft and keeps the original evidence.

Integration dependency: Evidence from HQD-11. Annotation refs from HQD-04 (types only).

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.

Amendment: atomic freeze uses one record for packet plus draft-consumed marker; preserve recoverable draft history and create a linked editable continuation.
<!-- codex-section:end id="spec.hq-design#ctx.requests.001" -->

<!-- codex-section:begin id="spec.hq-design#task.requests.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t6",
  "objective": "**Request lifecycle:** draft, then clarify, then freeze, then review.\n• Drafts autosave and are privacy-labelled.\n• Attachments are explicitly selected.\n• Freeze produces an immutable `hq.design.decision-packet/v1` (digest, lineage, supersedes).\n• Review screen for the returned candidate: claim levels, before/after through the compare slot, accept / revise / defer as appended events.",
  "context_refs": [
    "spec.hq-design#ctx.requests.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/requests/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/requests/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.requests.001"
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
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.requests.001" -->

<!-- codex-section:begin id="spec.hq-design#test.requests.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "Restart mid-edit: the draft comes back byte-identical (fake StoragePort with crash injection). Freeze is atomic, saving the packet and clearing the draft. A later edit creates a new linked packet and leaves the old one unchanged. Privacy/export output contains no unsent drafts and no unselected images. Freezing never triggers dispatch (connector spy shows zero calls). Revise creates a linked new draft and keeps the original evidence.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.requests.001",
  "evidence_executor_task": "spec.hq-design#task.requests.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/requests/"
  ],
  "affected_check_groups": [
    "design-requests"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.requests.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.taste.001" -->
## T7 taste

Writer: `modules/design/taste/` only.

**Taste, clean-room.**
• Main side: an append-only JSONL journal with a hash chain, fsync before acknowledging, single-writer lock, `clientEventId` idempotency, conflict on a changed payload, and a fail-closed state after a partial write.
• General and project scopes kept separate. Liking kept separate from descriptive judgments. Overall and per-aspect ratings, re-ratings that supersede, notes, counterevidence, sample-limit labels, profile export.
• UI ships behind a flag that is off.

Behavioral acceptance: A tampered link fails validation with no truncation. Replaying the same `clientEventId` with the same payload is a no-op, and with a different payload is a conflict. A partial write puts the journal in the fail-closed state. Project ratings never feed the general profile unless the user explicitly chooses to. A profile from fewer than N ratings shows its sample-limit label. Imported examples never count as owner judgments.

Integration dependency: Owner disposition C1 before the UI is switched on. Differential conformance against the old engine only after the public-safety approval or an owner decision.

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.

Amendment: build/render new HQ rating controls for owner acceptance; automatic guidance activation and legacy journal reuse remain off. This supersedes the original blanket UI-off wording above.
<!-- codex-section:end id="spec.hq-design#ctx.taste.001" -->

<!-- codex-section:begin id="spec.hq-design#task.taste.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t7",
  "objective": "**Taste, clean-room.**\n• Main side: an append-only JSONL journal with a hash chain, fsync before acknowledging, single-writer lock, `clientEventId` idempotency, conflict on a changed payload, and a fail-closed state after a partial write.\n• General and project scopes kept separate. Liking kept separate from descriptive judgments. Overall and per-aspect ratings, re-ratings that supersede, notes, counterevidence, sample-limit labels, profile export.\n• UI ships behind a flag that is off.",
  "context_refs": [
    "spec.hq-design#ctx.taste.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/taste/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/taste/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.taste.001"
  ],
  "affected_check_groups": [
    "design-taste"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.taste.001" -->

<!-- codex-section:begin id="spec.hq-design#test.taste.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "A tampered link fails validation with no truncation. Replaying the same `clientEventId` with the same payload is a no-op, and with a different payload is a conflict. A partial write puts the journal in the fail-closed state. Project ratings never feed the general profile unless the user explicitly chooses to. A profile from fewer than N ratings shows its sample-limit label. Imported examples never count as owner judgments.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.taste.001",
  "evidence_executor_task": "spec.hq-design#task.taste.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/taste/"
  ],
  "affected_check_groups": [
    "design-taste"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.taste.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.references.001" -->
## T8 references

Writer: `modules/design/references/` only.

**Reference library** for websites and native apps: collections, stable IDs, provenance (source URL or app, capture time, kind = screenshot / recording / web prototype / native), rights or permitted-asset flags, search and tags, "use in project" links.

Behavioral acceptance: Re-importing the same reference keeps its ID. A screenshot is never labelled native execution. An asset without a permitted flag is excluded from any export marked publishable. Deleting a collection tombstones and never deletes the referenced blobs.

Integration dependency: References imported by HQD-12.

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.references.001" -->

<!-- codex-section:begin id="spec.hq-design#task.references.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "**Reference library** for websites and native apps: collections, stable IDs, provenance (source URL or app, capture time, kind = screenshot / recording / web prototype / native), rights or permitted-asset flags, search and tags, \"use in project\" links.",
  "context_refs": [
    "spec.hq-design#ctx.references.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/references/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/references/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.references.001"
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
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.references.001" -->

<!-- codex-section:begin id="spec.hq-design#test.references.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "Re-importing the same reference keeps its ID. A screenshot is never labelled native execution. An asset without a permitted flag is excluded from any export marked publishable. Deleting a collection tombstones and never deletes the referenced blobs.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.references.001",
  "evidence_executor_task": "spec.hq-design#task.references.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/references/"
  ],
  "affected_check_groups": [
    "design-references"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.references.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.store.001" -->
## T9 store

Writer: `packages/design-store/` only.

**Durable `StoragePort` implementation** (Node only): atomic temp-file, fsync and rename; append-only events with projections; content-addressed blobs; a snapshot before each migration and automatic restore if it fails. File-based for now; SQLite decided after S2.

Behavioral acceptance: Kill during commit (fault injection) leaves either the old state or the new state, never a mix. A blob with a mismatched digest is rejected. A failed migration restores the snapshot exactly. A store with an unknown future schema opens read-only and is not modified.

Integration dependency: Root wires it to main and IPC.

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.store.001" -->

<!-- codex-section:begin id="spec.hq-design#task.store.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t9",
  "objective": "**Durable `StoragePort` implementation** (Node only): atomic temp-file, fsync and rename; append-only events with projections; content-addressed blobs; a snapshot before each migration and automatic restore if it fails. File-based for now; SQLite decided after S2.",
  "context_refs": [
    "spec.hq-design#ctx.store.001"
  ],
  "read_scope": [
    "docs/",
    "packages/design-store/",
    "packages/contracts/"
  ],
  "write_scope": [
    "packages/design-store/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.store.001"
  ],
  "affected_check_groups": [
    "design-store"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.store.001" -->

<!-- codex-section:begin id="spec.hq-design#test.store.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "Kill during commit (fault injection) leaves either the old state or the new state, never a mix. A blob with a mismatched digest is rejected. A failed migration restores the snapshot exactly. A store with an unknown future schema opens read-only and is not modified.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.store.001",
  "evidence_executor_task": "spec.hq-design#task.store.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "packages/design-store/"
  ],
  "affected_check_groups": [
    "design-store"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.store.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.components.001" -->
## T10 components

Writer: `modules/design/components/` only.

**Components and motion:** runnable component sandbox (sandboxed iframe, srcdoc, no Node), props and variants panel, design tokens and design-system grouping, motion study player (timeline, easing parameters, scrub, replay). Supplies a `CanvasItemProvider`.

Behavioral acceptance: A sandboxed component cannot reach `window.parent` or the APIs exposed by preload. Changing a variant does not change the stored source. Motion scrub is deterministic for a given time `t`. A sample product built from a component has no import of review or annotation code (removability scan).

Integration dependency: Placement on the canvas through HQD-02.

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.components.001" -->

<!-- codex-section:begin id="spec.hq-design#task.components.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t10",
  "objective": "**Components and motion:** runnable component sandbox (sandboxed iframe, srcdoc, no Node), props and variants panel, design tokens and design-system grouping, motion study player (timeline, easing parameters, scrub, replay). Supplies a `CanvasItemProvider`.",
  "context_refs": [
    "spec.hq-design#ctx.components.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/components/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/components/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.components.001"
  ],
  "affected_check_groups": [
    "design-components"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.components.001" -->

<!-- codex-section:begin id="spec.hq-design#test.components.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "A sandboxed component cannot reach `window.parent` or the APIs exposed by preload. Changing a variant does not change the stored source. Motion scrub is deterministic for a given time `t`. A sample product built from a component has no import of review or annotation code (removability scan).",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.components.001",
  "evidence_executor_task": "spec.hq-design#task.components.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/components/"
  ],
  "affected_check_groups": [
    "design-components"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.components.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.flows.001" -->
## T11 flows

Writer: `modules/design/flows/` only.

**Clickable prototypes:** screens, hotspots and transitions, declared routes and states, flow map view, prototype player. Supplies a `CanvasItemProvider`.

Behavioral acceptance: A hotspot goes to the declared target. A broken target is reported, not silently dropped. The flow map and the player agree on every edge. Each player step is labelled as a web approximation and never as native evidence.

Integration dependency: Canvas embedding through HQD-02.

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.flows.001" -->

<!-- codex-section:begin id="spec.hq-design#task.flows.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t11",
  "objective": "**Clickable prototypes:** screens, hotspots and transitions, declared routes and states, flow map view, prototype player. Supplies a `CanvasItemProvider`.",
  "context_refs": [
    "spec.hq-design#ctx.flows.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/flows/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/flows/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.flows.001"
  ],
  "affected_check_groups": [
    "design-flows"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.flows.001" -->

<!-- codex-section:begin id="spec.hq-design#test.flows.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "A hotspot goes to the declared target. A broken target is reported, not silently dropped. The flow map and the player agree on every edge. Each player step is labelled as a web approximation and never as native evidence.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.flows.001",
  "evidence_executor_task": "spec.hq-design#task.flows.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/flows/"
  ],
  "affected_check_groups": [
    "design-flows"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.flows.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.connector.001" -->
## T12 connector

Writer: `modules/design/connector/` only.

**Destination, dispatch and evidence:**
• Destination model `hq.design.host-catalog/v1` (endpoint, mode, identity, freshness, status).
• Dispatch state machine `dispatch/v1` and an outbox, read-only reconciliation, and intake of returned evidence `result-evidence/v1`.
• Transport is a port with a labelled fake receiver; the UI shows "not qualified" for real Jones.
• New-thread controls are disabled and show the reason.

Behavioral acceptance: `submitting` is persisted before any transport call. A double click or a restart produces exactly one handoff. A fault-injected unknown is never sent again, and no new attempt is allowed. Reconciliation makes zero transport sends. A new attempt only follows an authoritative no-effect result plus fresh confirmation. An identity mismatch blocks sending. No host or model fallback. Evidence whose packet digest does not match is rejected.

Integration dependency: S1 and a public-safe statement of the wire contract before a real adapter (follow-on HQD-11b). U1 before new threads.

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.connector.001" -->

<!-- codex-section:begin id="spec.hq-design#task.connector.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t12",
  "objective": "**Destination, dispatch and evidence:**\n• Destination model `hq.design.host-catalog/v1` (endpoint, mode, identity, freshness, status).\n• Dispatch state machine `dispatch/v1` and an outbox, read-only reconciliation, and intake of returned evidence `result-evidence/v1`.\n• Transport is a port with a labelled fake receiver; the UI shows \"not qualified\" for real Jones.\n• New-thread controls are disabled and show the reason.",
  "context_refs": [
    "spec.hq-design#ctx.connector.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/connector/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/connector/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.connector.001"
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
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.connector.001" -->

<!-- codex-section:begin id="spec.hq-design#test.connector.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "`submitting` is persisted before any transport call. A double click or a restart produces exactly one handoff. A fault-injected unknown is never sent again, and no new attempt is allowed. Reconciliation makes zero transport sends. A new attempt only follows an authoritative no-effect result plus fresh confirmation. An identity mismatch blocks sending. No host or model fallback. Evidence whose packet digest does not match is rejected.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.connector.001",
  "evidence_executor_task": "spec.hq-design#task.connector.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/connector/"
  ],
  "affected_check_groups": [
    "design-connector"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.connector.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.imports.001" -->
## T13 imports

Writer: `modules/design/imports/` only.

**Import and export:** an `hq.design.import/v1` framework (source kind and version, digest, mapping version, counts, conflicts). Imports permitted design files (PNG, recordings, HTML bundles, URLs) as View versions with provenance and rights. An `hq.design.bundle/v1` backup and restore across StoragePort namespaces. A private draft-backup kind that is chosen separately.

Behavioral acceptance: Repeating the same import changes nothing. A changed source for an owner-edited record produces a conflict, never an overwrite. Undo tombstones only untouched records. An unsupported future version is rejected with no writes. Bundle round-trip is lossless. A publishable export excludes drafts.

Integration dependency: S3 public-safe format notes before legacy-format adapters (follow-on HQD-12b).

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.imports.001" -->

<!-- codex-section:begin id="spec.hq-design#task.imports.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t13",
  "objective": "**Import and export:** an `hq.design.import/v1` framework (source kind and version, digest, mapping version, counts, conflicts). Imports permitted design files (PNG, recordings, HTML bundles, URLs) as View versions with provenance and rights. An `hq.design.bundle/v1` backup and restore across StoragePort namespaces. A private draft-backup kind that is chosen separately.",
  "context_refs": [
    "spec.hq-design#ctx.imports.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/imports/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/imports/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.imports.001"
  ],
  "affected_check_groups": [
    "design-imports"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.imports.001" -->

<!-- codex-section:begin id="spec.hq-design#test.imports.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "Repeating the same import changes nothing. A changed source for an owner-edited record produces a conflict, never an overwrite. Undo tombstones only untouched records. An unsupported future version is rejected with no writes. Bundle round-trip is lossless. A publishable export excludes drafts.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.imports.001",
  "evidence_executor_task": "spec.hq-design#task.imports.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/imports/"
  ],
  "affected_check_groups": [
    "design-imports"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.imports.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.ui.001" -->
## T14 ui

Writer: `modules/design/ui/` only.

**Design's own chrome:** module registry (the renderer glob), sub-navigation (Projects, Resources, Review, Requests, Runs), resizable workspace panels, keyboard and focus model, command palette, theme tokens taken from `ShellContextPort`, state kept across domain switches (keep-alive plus serialize/restore), and the `DesignDomain` descriptor handed to the HQ shell.

Behavioral acceptance: A stub module added under `modules/design/*` appears with no registry edit. Switching Design→Social→Design with the shell fake restores the draft, canvas viewport and selection. Dark tokens recolor the chrome but never captures or previews (pixel and DOM style assertions). Every navigation target is reachable by keyboard. Switching project context requires an explicit action.

Integration dependency: HQ shell adapter (root together with HQ shell owner).

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.ui.001" -->

<!-- codex-section:begin id="spec.hq-design#task.ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t14",
  "objective": "**Design's own chrome:** module registry (the renderer glob), sub-navigation (Projects, Resources, Review, Requests, Runs), resizable workspace panels, keyboard and focus model, command palette, theme tokens taken from `ShellContextPort`, state kept across domain switches (keep-alive plus serialize/restore), and the `DesignDomain` descriptor handed to the HQ shell.",
  "context_refs": [
    "spec.hq-design#ctx.ui.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/ui/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/ui/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.ui.001"
  ],
  "affected_check_groups": [
    "design-ui"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.ui.001" -->

<!-- codex-section:begin id="spec.hq-design#test.ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "A stub module added under `modules/design/*` appears with no registry edit. Switching Design→Social→Design with the shell fake restores the draft, canvas viewport and selection. Dark tokens recolor the chrome but never captures or previews (pixel and DOM style assertions). Every navigation target is reachable by keyboard. Switching project context requires an explicit action.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.ui.001",
  "evidence_executor_task": "spec.hq-design#task.ui.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/ui/"
  ],
  "affected_check_groups": [
    "design-ui"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.ui.001" -->

<!-- codex-section:begin id="spec.hq-design#ctx.discovery.001" -->
## T15 discovery

Writer: `modules/design/discovery/` only.

Laptop-led remote project catalog and local cache: stable source identity, cached metadata first paint, background bounded refresh, on-demand preview/assets, stale/offline state, explicit source enrollment and labelled source adapters. The laptop owns editable Design workspace; no two-way sync is required.

Behavioral acceptance: Warm-cache catalog renders without waiting for network. Partial source failure preserves cached records with freshness and per-source error. Stable host/repository/project identities never merge by title. Context changes ignore stale in-flight results and cancel work. Concurrent requests for the same digest coalesce; preview fetching is bounded and lazy. Cold source refresh has timeout and returns partial results.

Integration dependency: Projects consumes catalog snapshots; durable store persists cache separately from editable Design records. Real remote source access waits for a qualified source adapter/enrollment; execution remains connector-owned.

Apply the common interface/testing/delivery clauses. Local models/ports/fakes can begin immediately; T0 integration is a later phase.
<!-- codex-section:end id="spec.hq-design#ctx.discovery.001" -->

<!-- codex-section:begin id="spec.hq-design#task.discovery.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t15",
  "objective": "Laptop-led remote project catalog and local cache: stable source identity, cached metadata first paint, background bounded refresh, on-demand preview/assets, stale/offline state, explicit source enrollment and labelled source adapters. The laptop owns editable Design workspace; no two-way sync is required.",
  "context_refs": [
    "spec.hq-design#ctx.discovery.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/discovery/",
    "packages/contracts/"
  ],
  "write_scope": [
    "modules/design/discovery/"
  ],
  "requires": [
    "spec.hq-design#req.requirements.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-design#ac.acceptance.001"
  ],
  "test_refs": [
    "spec.hq-design#test.discovery.001"
  ],
  "affected_check_groups": [
    "design-discovery"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own cone only; separate native worktree; single Git owner.",
    "No private source/data publication or real external dispatch.",
    "No root configuration, dependency lock, or cross-section edits."
  ],
  "stop_conditions": [
    "Unknown prior effect, overlapping ownership or incompatible shared contract."
  ]
}
```
<!-- codex-section:end id="spec.hq-design#task.discovery.001" -->

<!-- codex-section:begin id="spec.hq-design#test.discovery.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-design#req.requirements.001"
  ],
  "scenario": "Warm-cache catalog renders without waiting for network. Partial source failure preserves cached records with freshness and per-source error. Stable host/repository/project identities never merge by title. Context changes ignore stale in-flight results and cancel work. Concurrent requests for the same digest coalesce; preview fetching is bounded and lazy. Cold source refresh has timeout and returns partial results.",
  "evidence": {
    "predicate": "Named behavior checks pass at exact candidate revision.",
    "invalid": "Any named invariant fails or fake evidence is labelled real.",
    "unknown": "The required runtime or adapter is unqualified."
  },
  "environment": [
    "Node 24 synthetic fixtures; actual UI runtime only where available"
  ],
  "obligation_owner_task": "spec.hq-design#task.discovery.001",
  "evidence_executor_task": "spec.hq-design#task.discovery.001",
  "acceptance_owner": "coordinator",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/discovery/"
  ],
  "affected_check_groups": [
    "design-discovery"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-design#test.discovery.001" -->


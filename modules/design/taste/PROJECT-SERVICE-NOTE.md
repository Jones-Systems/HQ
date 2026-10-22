# Project-bound Taste contribution

Artifact Type: work-note
Artifact ID: work-note.hq-taste-project-service
Purpose: Hand off the module-only durable Taste contribution and its integration gates.
Decision owner: M Jones
Consumers: HQ composition, shared desktop storage, and integration owners
Authority effect: none

## Scope and source evidence

HQ-D1 starts at `3b5b636a672627f103334b2b7a0ea588e4bbf384` on
`work/hq-completion-design-services-20261022`. The assigned implementation
agent is the sole Git owner of that isolated worktree. Writes stay in
`modules/design/taste/**`, excluding `preview/**`. No descendants, execution
checks, installs, previews, publication, activation or shared-file changes.
This is a source-only handoff; the integration owner runs checks centrally.

Current-source research: `contract.ts`, `journal.ts`, `service.ts`,
`profile.ts`, `app/storage/backing.ts`, `app/compose/bridged-workspace.ts`,
`app/compose/views/TasteView.tsx`, and the desktop `design-host.ts` routes.
The relevant campaign references are
`spec.hq-integration-parallel-execution#ctx.change-surface.001`,
`#iface.service-response.001`, `#ctx.lane-t8.001`, and
`#task.design-storage-engine.001`; the bootstrap remains unchanged.
The locally delivered `.agents/shared-guidance.md` bridge is absent. The
available Graphify catalog has no selected HQ graph, so current source is the
basis. Taste is not covered by the partial UI map. Private frontend guidance
was not accessed under this capsule's protected-data restriction; the local
UI change is limited to state isolation and unavailable/read-only behavior.

## Contribution and retained semantics

`createProjectTasteContribution({ documents, projectId, sha256, clock,
sampleThreshold? })` returns `{ projectId, client: TasteClientPort }`.
`ProjectId` is the existing Taste brand, supplied by the caller. There is no
project ID allocation, registry choice, synthetic seed, selection listener,
module-global client, or raw filesystem dependency. Both public entries export
the factory and its local types. Construction performs no I/O.

The sole authoritative document is `design/taste/journal.v1`, with value
`{ schema: 'hq.design.taste-journal/v1', jsonl: string }`. It preserves the
existing hash-chain/event encoding and service/profile rules. It does not
copy ratings into a second profile store or mirror the legacy file journal.
There is no automatic migration or legacy reuse. The document is shared
across scopes because the existing journal owns general taste and explicit
project promotion together. Project isolation is enforced at the immutable
client binding, not by independently persisted per-project profile stores.

Each operation reads and verifies the canonical document anew. Missing is
empty; failed reads and invalid envelopes are unavailable. Corrupt JSONL
returns a read-only verified prefix and refuses append/export without repair.
Each accepted command extends the prefix with one existing-format record and
uses atomic document revision comparison. A resolved put must mean durable
storage. Conflicts/lost acknowledgements return `sync-failed`, never success;
there is no automatic retry. Explicit replay after readback/reopen uses the
same event ID and preserves duplicate/conflict behavior.

Raw assessments/history, notes, examples and contribution controls include
only general scope and the bound project. Foreign snapshot/export/command
requests are rejected, and event-ID collisions cannot return another
project's record. Notes/counterevidence cannot target an assessment in another
scope. General profiles retain the established explicit promotion semantics,
including opted-in project notes. Journal heads/counts describe the shared
authoritative chain; they are not represented as project-local counts.
Liking 1–5 remains separate from descriptive aspect ratings; re-ratings,
notes, counterevidence, import provenance and profile export semantics remain.

TastePanel resets drafts, outcomes, exports and pending snapshot ownership
when the project, subject or client changes; changing general/project scope
also resets unsaved scope-specific editors/exports. Failed refreshes hide
the old snapshot. Corrupt/closed journals disable export as well as rating.
Failed write/sync acknowledgements are displayed as unknown, retaining the
same command for an explicit retry instead of claiming that nothing saved.
The demo and production composition mount are unchanged.

## Exact shared integration needs

1. Inject the existing authoritative `WorkspaceDocuments` view. The local
   `TasteDocumentPort` needs only `kind: 'workspace'`, `namespace: 'workspace'`,
   `getDocument(key)` and `putDocument(key, value, { expectedRevision })`.
   A compile-time test records structural compatibility. Read failures must
   reject, and puts must preserve durable atomic CAS semantics. No new shared
   storage implementation is needed.
2. The desktop owner must permit the exact Taste document key for `doc.get`
   and `doc.put` in `apps/desktop/electron/design-host.ts`. Its current
   `DOCUMENT_ROOTS` excludes Taste. Do not route around this gate using another
   section's root. A broad namespace or import enablement is unnecessary.
3. Composition must replace the fake `tasteEnv` binding with an explicitly
   selected-project contribution, passing the current branded `ProjectId`
   and actual selected subject to TastePanel. When either is absent, present
   the appropriate selection/empty state; never supply preview constants.
   Do not relabel a failed read as an empty project or fall back to fixtures.
4. Root must add `"modules/design/taste/**/*.test.tsx"` to the `tests` array
   of `[groups.design-taste]` in `tests/check-groups.toml`. Existing TS globs
   already include `test/project-service.test.ts`; the new UI file is
   `test/ui/TastePanel.binding.test.tsx`. This also restores catalog membership
   for the existing `test/ui/TastePanel.test.tsx`. The existing workflow row
   already covers both runners; no workflow change is needed.

This first adapter uses a CAS document containing the full canonical ledger.
Read/append work grows with journal length, and the desktop's current JSON
value cap is 2,000,000 bytes (about 1.91 MiB), including envelope/JSON escaping.
At that cap writes fail without truncation; no compaction or alternate store
is created. Host restart durability, mounting, limit behavior and real desktop
journeys still need integration evidence. No separate renderer/project
authorization boundary is claimed for the underlying workspace capability.

## Designed checks, all unrun

New node checks cover no-write construction/navigation, adapter reopen,
ratings/history/notes/counterevidence, liking versus description, explicit
promotion and revocation, foreign scopes/IDs, corruption, failed reads,
failed writes/lost acknowledgements, concurrent CAS and caller mutation.
New TSX checks cover stale asynchronous loads, project/client/scope changes,
draft/export isolation, failed refreshes and read-only exports. Fixtures are
synthetic and memory-only; DOM cleanup is owned by each test file.

After root's resource admission, run serially from the repository root:

```sh
node --test modules/design/taste/test/project-service.test.ts
node --test modules/design/taste/test/*.test.ts
./node_modules/.bin/vitest run --config modules/design/taste/vitest.config.ts
./node_modules/.bin/tsc -p modules/design/taste/tsconfig.json --noEmit
```

Root also owns composed type/behavior checks after mounting, real store
restart evidence and UI verification. No test, typecheck, build, browser,
preview or server was executed by this capsule. Ordinary source/diff review
does not prove passing behavior. No active commit hooks were present at
preflight; hooks must remain enabled when committing. Publication and delivery
belong to the integration owner.

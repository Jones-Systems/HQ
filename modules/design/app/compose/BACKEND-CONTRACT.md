# Design backend contract for views

Owner: lane B3 (Design backend). Readers: lanes rebuilding Design views (F4 core, F5 sources).
Status: stable from 2026-11-03. Changes are additive. A breaking change gets a new name and a note here.

This page covers what a Design view can rely on when it calls the backend: how failures arrive, how to show
them, and how to learn that a project's content changed. Section ports stay where they are documented today
(for example `projects/src/contract.ts`, `imports/src/contract.ts`). This contract sits on top of them.

## 1. Typed failures (`errors.ts`)

Every Design backend call either resolves or rejects with an error that `classifyDesignError(error, context)`
maps to a `DesignFailure`. Views never parse error messages.

```ts
const result = await attemptDesign(() => projects.rename(id, title), {
  section: 'projects', operation: 'projects.rename', action: 'rename the project', write: true,
});
if (!result.ok) show(designFeedback(result.failure));
```

- `section` is one of `DESIGN_SECTIONS`.
- `operation` is `<section>.<verb>`. It is stable and appears in the toast meta line.
- `action` is a lowercase imperative phrase. It fills the message template.
- `write: true` marks an operation that writes. A lost or unrecognised failure during a write is `unknown`
  (it may have happened). During a read it is `unavailable` (reading changes nothing).

`toDesignOperationError` wraps any rejection as a `DesignOperationError` (an `Error` that is also a
`DesignFailure`, with the original as `cause`) for code that must keep throwing.
`classifyDesignError` passes an existing `DesignFailure` through unchanged.

| kind | outcome | recovery | tone | meaning |
| --- | --- | --- | --- | --- |
| `conflict` | no effect | reload | danger | Another window or writer changed it first. |
| `invalid` | no effect | none | danger | The backend refused the input. |
| `read-only` | no effect | none | warning | Saved by a newer HQ. It opens read-only. |
| `unavailable` | no effect | retry | danger | Storage could not be reached. Nothing changed. |
| `disabled` | no effect | none | info | The feature is off in this build. |
| `not-found` | no effect | reload | warning | It no longer exists. |
| `too-large` | no effect | none | danger | Over a storage or preview limit. |
| `cancelled` | no effect | none | info | The user or an abort signal stopped it. |
| `stale` | no effect | choose again | warning | The selection changed in the meantime. |
| `corrupt` | no effect | none | danger | Stored data is damaged. HQ does not repair it. |
| `unknown` | unknown effect | check | unknown | HQ could not confirm the result. |

Rules for views:

- Keep the current screen and the user's input. Show the failure as a toast, an inline notice beside the
  control, or both.
- Offer exactly the `action` that `designFeedback` returns. `Retry` appears only when repeating cannot
  duplicate an effect. An `unknown` outcome offers `Check` (read back, then decide), never a blind retry.
- `persistent: true` (danger, unknown) stays until dismissed. Other notices may auto-dismiss.
- Show `meta` (`operation` or `operation · reason`) in the mono provenance line. It is not user prose.

### Mapping to the shared feedback primitives

`designFeedback(failure)` returns `{ tone, title, description?, meta, inline, action?, persistent }`.

- Toasts (`@hq/ui`): pass `tone`, `title`, `description` directly. The shared tones include `unknown`.
- Inline state: `inline` is `failed` or `unknown`, matching the `failed` / `unknown` states of the inline
  status indicators.
- A view kit whose tone set lacks `unknown` shows it as `warning` and keeps the `unknown` inline state.

### Section errors

Section error classes set a stable `name`, so classification survives bundling and needs no section imports.
New section errors must set `this.name` and either be added to `classifyDesignError` with a test case in
`test/errors.test.ts`, or be thrown as `DesignOperationError` directly.

| name | kind |
| --- | --- |
| `StoreError` with `code: 'conflict'` (bridge), `StorageConflictError`, `CanvasWriteConflictError`, `FreezeConflictError`, `ProposalConflictError`, `IntegrityError` with `reason: 'exists'` | conflict |
| `ContentError`, `VersionMutationError`, `InvalidIdError`, `ValidationError`, `CanonicalJsonError`, `CanonicalizationError`, `NonCanonicalBytesError`, storage scope errors | invalid |
| `ReadOnlyContentError`, `ReadOnlyRequestError`, `UnsupportedSchemaError`, `reason: 'unsupported-stored-schema'` | read-only |
| `TasteConflictError` | conflict |
| `TasteInvalidInputError` | invalid |
| `TasteReadOnlyError` (reason `unsupported-stored-schema` or `store-read-only`) | read-only |
| `TasteJournalFaultError` (reason is the journal's fail-closed reason) | corrupt |
| `TasteUnavailableError`, `SourceUnavailableError` | unavailable |
| `PreviewError` with `reason: 'too-large'` | too-large |
| `AbortError`, `PreviewError` with `reason: 'aborted'` | cancelled |
| `StaleDraftError`, `TasteProjectBindingError` (reason `project-binding`) | stale |
| `reason: 'corrupt-stored-record'`, `IntegrityError` with `reason: 'mismatch'` | corrupt |
| `OutcomeUnknownError` | unknown |

## 2. Bridge envelopes (`bridge-documents.ts`)

The desktop host answers every `hq:svc:design` call with exactly one of:

- `{ ok: true, value }`
- `{ ok: false, kind }` where `kind` is `conflict`, `invalid`, `read-only`, `unavailable` or `unknown`
- `{ ok: false, kind, reason }` where `reason` is one of `DESIGN_BRIDGE_REASONS` (today only `disabled`)

`bridgeResultValue` turns a refusal into `DesignBridgeConflictError` (name `StoreError`, `code: 'conflict'`)
or `DesignBridgeError(kind, reason)`. A `disabled` refusal is a definite no-effect even on a write route, so
it classifies as `disabled`, not `unknown`. Any other shape, an unknown reason, or a transport rejection is
`unknown` on write routes and `unavailable` on read routes.

## 2a. Taste (`taste.*`)

Source: `taste/src/project-service.ts`, `compose/taste-failures.ts`.

`createProjectTasteContribution` returns a client bound to one project. `reportTasteFailures(client, report)` wraps it
for a view: each rejection is classified with the context below, passed to `report` as `designFeedback`, then
rethrown unchanged. A success reports `null` for that operation, which clears its notice.

| operation | client call | `write` | action text |
| --- | --- | --- | --- |
| `taste.load` | `snapshot` | no | `load your taste ratings` |
| `taste.save` | `submit` (ratings, notes, counterevidence, project contribution) | yes | `save to your taste journal` |
| `taste.export` | `exportProfile` | no | `export your taste profile` |

What rejects, and how it classifies:

| situation | error | kind |
| --- | --- | --- |
| Client bound to another project (`snapshot`, `exportProfile`) | `TasteProjectBindingError` | stale (`project-binding`) |
| Journal unreadable, or its stored envelope is malformed | `TasteUnavailableError` | unavailable |
| Stored schema is a later `hq.design.taste-journal/vN` (N > 1), on read and on write | `TasteReadOnlyError` | read-only (`unsupported-stored-schema`) |
| Journal verified with a fault, on export | `TasteJournalFaultError` | corrupt (the fail-closed reason) |
| Save lost the revision compare-and-set (host `conflict`) | `TasteConflictError` | conflict |
| Host refused the save as invalid, read-only or unavailable | `TasteInvalidInputError`, `TasteReadOnlyError` (`store-read-only`), `TasteUnavailableError` | invalid, read-only, unavailable |
| Export options malformed, or an ID that is not a valid identifier | `TasteInvalidInputError` | invalid |

A save whose outcome is unknown (transport lost, no typed refusal) does not reject. It resolves
`{ status: 'fail-closed', reason: 'sync-failed' }`, which `TastePanel` shows as unconfirmed with an idempotent Retry of
the same `clientEventId`. Domain refusals (`stale-supersede`, `already-rated`, `project-mismatch`, ...) also resolve
as `rejected` results that the panel explains. Neither goes through `reportTasteFailures`. A journal that verified
with a fault resolves a snapshot with `journal.state: 'fail-closed'` (read-only, verified prefix kept), which the
panel also shows.

### Subject identity

Version IDs are unique only inside their project (deterministic `capture-<digest>` and imported IDs repeat), so a
Design version is rated under a project-qualified subject. `projectVersionSubject(projectId, versionId, label)` gives
`{ id: 'pv1:<project length>:<project><version>', kind: 'version', label, versionId }`, and a view passes that
subject to `TastePanel`. A bound client also qualifies a plain version subject on write, and refuses a subject
qualified for another project (`project-mismatch`).

Journals saved before qualification stay readable and are never rewritten:

- Project-scope entries are attributed to their project. The bound client presents their version subjects
  qualified, so a rating made earlier is found, and can be re-rated, from the same version.
- General-scope entries with a plain version ID name no project and cannot be attributed. They are kept and counted
  in general taste, and match no project's version, so they never merge with another project's rating.

## 3. Project content events (`content-events.ts`)

Both workspace kinds (`bridged` and the labelled in-memory `fake`) expose `workspace.contentEvents`, one
`ProjectContentEvents` per composition:

- `subscribe(projectId, listener)` returns an idempotent unsubscribe.
- `revision(projectId)` is a per-project counter that starts at 0. Use it as a cache key when a view
  memoises project content.
- `notify(projectId)` is for writers. It carries no data and never writes or dispatches.

Writers notify after a durable project-content write succeeds, and also after an unknown outcome, so readers
re-read instead of trusting a cache. Today live capture acceptance (`interactive-workspace.ts`) notifies.
Further producers (Imports linking, Projects edits) notify as they land, and are listed here when they do.

A listener that throws is isolated. Other listeners still run.

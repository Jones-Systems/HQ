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
- `write` is required. A lost or unrecognised failure during a write (`write: true`) is `unknown`, because it
  may have happened. During a read (`write: false`) it is `unavailable`, because reading changes nothing.
  An abort during a write is `unknown` too; only an aborted read is `cancelled`.

`toDesignOperationError` wraps any rejection as a `DesignOperationError` (an `Error` that is also a
`DesignFailure`, with the original as `cause`) for code that must keep throwing.
`classifyDesignError` passes a well-formed `DesignFailure` through unchanged. Well-formed means that only
`unknown` carries an unknown effect, and that an unknown effect only offers `check`. Anything else that
claims a possible effect is classified as `unknown`.

| kind | outcome | recovery | tone | meaning |
| --- | --- | --- | --- | --- |
| `conflict` | no effect | reload | danger | Another window or writer changed it first. |
| `invalid` | no effect | none | danger | The backend refused the input. |
| `read-only` | no effect | none | warning | It opens read-only here, for example because a newer HQ saved it. |
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
  `designFeedback` enforces this even for a hand-built failure.
- `persistent: true` (danger, unknown) stays until dismissed. Other notices may auto-dismiss.
- Show `meta` (`operation` or `operation · reason`) in the mono provenance line. It is not user prose.

### Mapping to the shared feedback primitives

`designFeedback(failure)` returns `{ id, tone, title, description?, meta, inline, status, action?, persistent }`.

- Toasts (`@hq/ui`): pass `id`, `tone`, `title` and `description` directly. The shared tones include `unknown`.
  A toast with the same `id` replaces the earlier one. A storage outage uses `design.storage.unavailable` in
  every section, so five sections failing at once show one toast. Every other failure uses
  `design.<operation>.<kind>`.
- Inline state: `inline` is `failed` or `unknown`, matching the `failed` / `unknown` states of the inline
  status indicators. `status` is the word beside the control.
- A view kit whose tone set lacks `unknown` shows it as `warning` and keeps the `unknown` inline state.

The words match the rest of HQ. An unconfirmed write reads "not confirmed yet", offers **Check** and is marked
**Unconfirmed**, as in Work. A storage outage is **Unavailable**, as in the shell's service status.

| kind | status word |
| --- | --- |
| `conflict` | Changed elsewhere |
| `invalid` | Refused |
| `read-only` | Read-only |
| `unavailable` | Unavailable |
| `disabled` | Off in this build |
| `not-found` | Missing |
| `too-large` | Too large |
| `cancelled` | Stopped |
| `stale` | Out of date |
| `corrupt` | Damaged |
| `unknown` | Unconfirmed |

### Section errors

Section error classes set a stable `name`, so classification survives bundling and needs no section imports.
New section errors must set `this.name` and either be added to `classifyDesignError` with a test case in
`test/errors.test.ts`, or be thrown as `DesignOperationError` directly.

| name | kind |
| --- | --- |
| `StoreError` with `code: 'conflict'` (bridge), `StorageConflictError`, `CanvasWriteConflictError`, `FreezeConflictError`, `IntegrityError` with `reason: 'exists'` | conflict |
| `ContentError`, `VersionMutationError`, `InvalidIdError`, `ValidationError`, `CanonicalJsonError`, `CanonicalizationError`, `NonCanonicalBytesError`, `DispatchTransitionError`, `NamespaceClassError`, `OutboxRecordError`, storage scope errors | invalid |
| `SendBlockedError`, `FreezeBlockedError` (reason `blocked`; the description is the store's own reasons), `ExportProjectionError` (reason `blocked`) | invalid |
| `ReadOnlyContentError`, `ReadOnlyRequestError` | read-only |
| `UnsupportedSchemaError` (reason `unsupported-schema`), `reason: 'unsupported-stored-schema'`: saved by a newer HQ | read-only |
| `ExportDisabledError`, `DesignBridgeError` with `reason: 'disabled'` | disabled |
| `TasteUnavailableError` | unavailable |
| `SourceUnavailableError` (reason `source-offline`: the source, not storage, is unreachable) | unavailable |
| `PreviewError` with `reason: 'too-large'` | too-large |
| `PreviewError` with `reason: 'aborted'`, `AbortError` during a read | cancelled |
| `StaleDraftError`, `TasteProjectBindingError` (reason `project-binding`) | stale |
| `reason: 'corrupt-stored-record'`, `IntegrityError` with `reason: 'mismatch'` | corrupt |
| `OutcomeUnknownError`, `AbortError` during a write | unknown |

`DesignBridgeError` is also recognised by its name, in case a second bundle chunk carries its own copy of
the class.

## 2. Bridge envelopes (`bridge-documents.ts`)

The desktop host answers every `hq:svc:design` call with exactly one of:

- `{ ok: true, value }`
- `{ ok: false, kind }` where `kind` is `conflict`, `invalid`, `read-only`, `unavailable` or `unknown`
- `{ ok: false, kind: 'unavailable', reason }` where `reason` is one of `DESIGN_BRIDGE_REASONS` (today only
  `disabled`)

`bridgeResultValue` turns a refusal into `DesignBridgeConflictError` (name `StoreError`, `code: 'conflict'`)
or `DesignBridgeError(kind, reason)`. A `disabled` refusal is a definite no-effect even on a write route, so
it classifies as `disabled`, not `unknown`. These are `unknown` on write routes and `unavailable` on read
routes:

- any other shape;
- an unknown reason;
- a reason paired with any kind other than `unavailable`;
- a transport rejection.

## 3. Project content events (`content-events.ts`)

Both workspace kinds (`bridged` and the labelled in-memory `fake`) expose `workspace.contentEvents`, one
`ProjectContentEvents` per composition:

- `subscribe(projectId, listener)` returns an idempotent unsubscribe. Each call is its own subscription,
  even for the same function.
- `revision(projectId)` is a per-project counter that starts at 0. Use it as a cache key when a view
  memoises project content.
- `notify(projectId)` is for writers. It carries no data and never writes or dispatches.

Writers notify after any attempt to write project content, whether it succeeded, failed or has an unknown
outcome. Readers then re-read instead of trusting a cache; a spurious notification only costs one re-read.
Today live capture acceptance (`interactive-workspace.ts`) notifies. Further producers (Imports linking,
Projects edits) notify as they land, and are listed here when they do.

A listener that throws, or returns a promise that rejects, is isolated. Other listeners still run. A listener
removed during a notification is not called afterwards.

The shell's reference reads (`designReferenceReads`, used by search and reference pickers) do not cache.
Each read loads the stored content again.

## 4. Destinations for deep links

A Design destination is `<nav>/<section>`, for example `requests/imports`. The section ids are stable. The
`nav` placement comes from each section's `design-module.ts` and is provisional until the owner reviews it,
so shared surfaces should build destinations from the descriptor (`nav`, `id`) rather than hard-code them.

| Section | Destination today |
| --- | --- |
| Projects | `projects/projects` |
| Discovery | `projects/discovery` |
| References | `resources/references` |
| Components | `resources/components` |
| Flows | `resources/flows` |
| Canvas | `review/canvas` |
| Compare | `review/compare` |
| Annotations | `review/annotations` |
| Taste | `review/taste` |
| Requests | `requests/requests` |
| Imports | `requests/imports` |
| Runs | `runs/connector` |

## 5. Capabilities in this build

*Planned with the Imports workstream.* A read-only host query will report which Design features this build has
enabled: Imports storage, the file picker and export, plus the held ones (generation sources, the component
runner). Shared surfaces such as the palette can then hide or label commands that would only fail with
`disabled`. Until it lands, a `disabled` failure is the signal.

## 6. Current project

Until the owner-held project identity cutover (HQR-1 / D3), Design keeps its own project list. The shell's
context does not choose a Design project, and the project opened in Design scopes only Design's sections.
Shared surfaces should not promise cross-module project scoping for Design yet.

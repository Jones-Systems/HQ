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
| `TasteUnavailableError`, `SourceUnavailableError` | unavailable |
| `PreviewError` with `reason: 'too-large'` | too-large |
| `AbortError`, `PreviewError` with `reason: 'aborted'` | cancelled |
| `StaleDraftError`, `TasteProjectBindingError` (reason `project-binding`) | stale |
| `reason: 'corrupt-stored-record'`, `IntegrityError` with `reason: 'mismatch'` | corrupt |
| `OutcomeUnknownError` | unknown |

### Operation names

Operations are stable. Imports on the durable env (`imports-env.ts`) report these. The imports reducer, controller
and views read `failure.operation` and `failure.kind`, never the message.

| operation | write | what failed |
| --- | --- | --- |
| `imports.pick` | no | Choosing files with the system picker, or turning them into an import source. |
| `imports.plan` | no | Reserved for views that wrap planning. The storage layer reports its reads as `imports.read`. |
| `imports.read` | no | Reading records, history, conflicts or blobs while planning, listing or checking. |
| `imports.apply` | yes | The atomic commit that applies an import. |
| `imports.undo` | yes | The atomic commit that undoes an import. |
| `imports.resolve` | yes | The atomic commit that takes the incoming file or keeps the current one. |
| `imports.edit` | yes | The atomic commit that saves an owner edit of an imported record. |
| `imports.export` | no | Backup or export. Always `disabled` in this build (section 4). |

A commit is named by the event it appends to the `imports` stream: `import.applied` is `imports.apply`,
`import.undone` is `imports.undo`, `conflict.resolved` is `imports.resolve`. A batch with no event is an owner
edit, `imports.edit`.

## 2. Bridge envelopes (`bridge-documents.ts`)

The desktop host answers every `hq:svc:design` call with exactly one of:

- `{ ok: true, value }`
- `{ ok: false, kind }` where `kind` is `conflict`, `invalid`, `read-only`, `unavailable` or `unknown`
- `{ ok: false, kind, reason }` where `reason` is one of `DESIGN_BRIDGE_REASONS` (today only `disabled`)

`bridgeResultValue` turns a refusal into `DesignBridgeConflictError` (name `StoreError`, `code: 'conflict'`)
or `DesignBridgeError(kind, reason)`. A `disabled` refusal is a definite no-effect even on a write route, so
it classifies as `disabled`, not `unknown`. Any other shape, an unknown reason, or a transport rejection is
`unknown` on write routes and `unavailable` on read routes.

## 3. Project content events (`content-events.ts`)

Both workspace kinds (`bridged` and the labelled in-memory `fake`) expose `workspace.contentEvents`, one
`ProjectContentEvents` per composition:

- `subscribe(projectId, listener)` returns an idempotent unsubscribe.
- `revision(projectId)` is a per-project counter that starts at 0. Use it as a cache key when a view
  memoises project content.
- `notify(projectId)` is for writers. It carries no data and never writes or dispatches.

Writers notify after a durable project-content write succeeds, and also after an unknown outcome, so readers
re-read instead of trusting a cache. Producers today:

| producer | notifies |
| --- | --- |
| Live capture acceptance (`interactive-workspace.ts`) | After the accepted capture is stored, and after an unknown outcome. |
| Imports linking (`imports-content-link.ts`, section 4) | After an imports commit that linked versions succeeds, and after an unknown outcome of that commit. |

Further producers (Projects edits) notify as they land, and are listed here when they do.

A listener that throws is isolated. Other listeners still run.

## 4. Imports on the durable store (`imports-env.ts`)

In a bridged workspace, `workspace.importsFor(project)` returns the durable Imports env. It is on by default.
In the in-memory fake workspace it stays the labelled synthetic env. Bridged mode never shows synthetic data.

| piece | contract |
| --- | --- |
| Storage | `imports-storage.ts` adapts the importer's `StoragePort` to the bridge. Keys `imports/...` map to `design/imports/...`. The stream `imports` maps to `design/imports`. Revisions are decimal strings in the importer and numbers on the wire. Each write is one atomic `import.commit`. |
| Reads | `design/imports/{records,versions,manifests,conflicts,undo}/` are readable with `doc.get` and `doc.list`. `doc.put` refuses them: they change only through `import.commit`. Blobs are checked with `blob.has`, so planning does not list the whole blob store. |
| Picking | `capabilities.pickSource` calls `import.pick`. The system dialog says the files are imported as the owner's own work, and that wording is the explicit rights statement: `rights: { basis: 'owned', holder: 'Owner' }`. A canceled dialog resolves `null`. A refused pick rejects as a typed failure with the picker's reason, for example `invalid-png`, `file-too-large` or `file-changed` (`stale`). |
| Identity | One stable source ID (`src-local-png-files`) per project. Item keys are the normalized file names, so the same file is the same item every time: choosing identical files changes nothing and writes nothing. A changed file under the same name is an update. An owner-edited record whose source changed is a conflict. Two files with the same name, or a name that cannot be a key, are `invalid`. |
| Conflicts | A write that lost a race throws `StorageConflictError`, which classifies as `conflict`. Nothing was written. A plan that went stale before it was applied is the same `conflict`. |
| Unknown outcome | A commit whose reply was lost is `unknown` (it may have landed). Views offer `Check`, which re-reads history, never a blind retry. |
| Disabled | A host that does not accept imports answers `{ ok: false, kind: 'unavailable', reason: 'disabled' }`. That is `disabled` with outcome no effect, on every Imports operation. |
| Backup and export | Not available in this build. `saveBundle` is undefined and the storage port's bundle reads (`listBlobs`, `listStreams`, and `listDocuments` of the whole store) fail with `disabled`, reason `disabled`, message "Backup and export are not available in this build". Nothing is read into a bundle and nothing is written. The host's `export.*` routes stay disabled. A backup draft over the durable store therefore stays empty and is never saved. |

### Imports linking into project content

Importing a PNG makes it a project version, so Projects, Gallery, Compare and Annotations see it.

- Each live image record becomes one view (`screen`) and one version in the project's content document. The
  version has `origin: 'imported'`, the label `Imported <name>`, a capture binding of route `imported/<name>`,
  the image size at device pixel ratio 1 and the PNG digest, and a `thumbnail` PreviewRef at the PNG blob.
  View and version IDs derive from the import record, so the same record always maps to the same IDs.
- The content document is written in the same atomic `import.commit` as the Imports records and the journal
  event. Either all of it lands or none. The write is append-only and checked with `assertAppendOnly`.
- It is idempotent. A record already linked is skipped, so retrying an apply, or taking the incoming file after
  a conflict, never duplicates a version. A conflicted record is not linked until the owner takes the incoming
  file.
- Versions are never removed. **Undo leaves the imported versions in place.** It only marks the import undone in
  the Imports history. Removing a version needs a separate Projects action.
- Only PNG items link. An image larger than 2 MiB is imported and linked without a thumbnail, because the
  thumbnail port caps previews at 2 MiB.
- A project whose content is read-only (saved by a newer HQ) cannot be linked: the commit fails as `read-only`
  before anything is written.
- After the commit succeeds, and after an unknown outcome, the adapter calls `contentEvents.notify(projectId)` for
  each linked project. A conflict or a refusal writes nothing and does not notify.
- A commit is capped at 64 MiB of canonical bytes by the host. A batch over the cap fails as `too-large` with
  reason `import-total`, before anything is sent.

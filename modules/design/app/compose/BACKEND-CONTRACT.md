# Design backend contract for views

Owner: lane B3 (Design backend). Readers: lanes rebuilding Design views (F4 core, F5 sources).
Status: stable from 2026-11-03. Changes are additive. A breaking change gets a new name and a note here.

This page covers what a Design view can rely on when it calls the backend: how failures arrive, how to show
them, how to learn that a project's content changed, and how to keep a view current. Section ports stay where
they are documented today (for example `projects/src/contract.ts`, `imports/src/contract.ts`). This contract
sits on top of them.

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

### Operation names

Operations are stable. Imports on the durable env (`imports-env.ts`) report these. The Imports controller keeps
what was thrown on `state.cause`. A view classifies that to read `failure.operation` and `failure.kind`, never the
message (section 12 shows how).

| operation | write | what failed |
| --- | --- | --- |
| `imports.pick` | no | Choosing files with the system picker, or turning them into an import source. |
| `imports.plan` | no | Reserved for views that wrap planning. The storage layer reports its reads as `imports.read`. |
| `imports.read` | no | Reading records, history, conflicts or blobs while planning, listing or checking. |
| `imports.apply` | yes | The atomic commit that applies an import. |
| `imports.undo` | yes | The atomic commit that undoes an import. |
| `imports.resolve` | yes | The atomic commit that takes the incoming file or keeps the current one. |
| `imports.edit` | yes | The atomic commit that saves an owner edit of an imported record. |
| `imports.export` | no | Backup or export. Always `disabled` in this build (section 12). |

A commit is named by the event it appends to the `imports` stream: `import.applied` is `imports.apply`,
`import.undone` is `imports.undo`, `conflict.resolved` is `imports.resolve`. A batch with no event is an owner
edit, `imports.edit`.

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
- `subscribeAll(listener)` hears every project's changes and is told which project changed. It follows the
  same rules as `subscribe`. The Projects controller uses it, because its gallery shows every project.
- `revision(projectId)` is a per-project counter that starts at 0. Use it as a cache key when a view
  memoises project content; the accessors in §7 do.
- `notify(projectId)` is for writers. It carries no data and never writes or dispatches.

Writers notify after any attempt to write project content, whether it succeeded, failed or has an unknown
outcome. Readers then re-read instead of trusting a cache; a spurious notification only costs one re-read.
Who notifies today:

| writer | when |
| --- | --- |
| live capture acceptance (`interactive-workspace.ts`) | after any attempt to save the version, including a failed save. A stale capture is refused before saving and does not notify |
| adding a screen to the saved interactive flow | after any attempt to save the flow, including a failed save |
| Projects edits (`onContentChange` port of the Projects controller, wired in `bridged-workspace.ts`) | after any attempt to edit, including a refused or failed one |
| Imports linking (`imports-content-link.ts`) | after an imports commit that carries linked versions is sent, whatever the outcome (section 12) |

A writer that does not notify is not seen until something else does. The fake workspace's fixtures never
change, so its revision stays 0 unless a test notifies.

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

## 7. Fresh content in views

The bridged accessors used to be memoised for the whole session. Now each follows the project's content:

| accessor | returns | after a change to that project |
| --- | --- | --- |
| `contentFor(project, read?)` | `{ repository, content, thumbnails, ... }` snapshot | a new snapshot (new promise) |
| `annotationSessionFor(project, read?)` | annotation session (§8) | a new session; one annotation controller per version is kept, so unsaved marks survive |
| `flowsFor(project, read?)` | the project's saved flows | a new list (new promise) |
| `compareFor(project)` | the `CompareController` | the same controller. It re-reads the version lists its pickers show (`refreshVersions()`); pinned panels and an unsaved layout are untouched |
| `tasteFor(project)` | the Taste client | the same client (it holds the journal's retry state) |
| `projectsFor(project)` | the `ProjectsController` | the same controller. It re-reads the open project and every project it already showed (`refreshContent(id)`); selection, filters and scroll stay |
| `canvasFor(project)` | the canvas environment | the same environment. The project-versions provider refreshes, so the registry lists new versions |

Only the project that changed is affected. Another project's change reads nothing. While nothing changes an
accessor returns the same promise, so React `use()` does not loop. A failed build is cached for the revision
too, and the next change retries it (§10).

`read` is `{ revision?, selection? }`. `selection` picks one of several values (§8). `revision` is what the
view is showing, from the hook below. A request for an older revision is answered with the newest value that
already resolved, so a refresh in the background never puts a mounted view back into its loading state.

### `useProjectContentRevision` (`content-revision.ts`)

```tsx
const revision = useProjectContentRevision(workspace, context.id);
const { content } = use(workspace.contentFor(context, { revision }));
```

- It re-renders the view when that project's content changes, and not for other projects.
- The returned revision is deferred (`useDeferredValue`). The new content renders in the background and the
  screen keeps the old content until it is ready. A live preview beside the content therefore stays put.
- Leaving out `{ revision }` is correct but shows the loading state while it reloads.
- Views that read only `compareFor`, `tasteFor`, `projectsFor` or `canvasFor` need no hook: those objects
  update themselves and the view already subscribes to them.
- Works in both workspaces. The fake accepts and ignores `read`.

## 8. Annotation version selection

```tsx
const session = use(workspace.annotationSessionFor(context, { revision, selection: versionId }));
// session: { target: { version, frame, thumbnailUrl, captureUrl }, controller, choices, selection } | null
```

- `selection` is an explicit version id. Leave it out for the default.
- Default: the newest version that has a stored capture image, else the newest version that names a capture
  by digest. This is a screen default only. It never says which version is current, based on which, or what a
  mark belongs to. Marks always carry the exact version id, and `basedOn` is never followed.
- `choices` lists the versions that can be annotated (they name a capture), newest first, for a picker.
- `target.captureUrl` is the stored capture as a `data:` URL, read by exact digest, re-hashed and checked to be
  a PNG. It is `null` when the bytes are not stored on this device. `target.thumbnailUrl` is `null` here.
- `target.frame.captureDigest` is never empty. A version without a capture digest is not offered, because an
  annotation anchor requires one. `null` means no version can be annotated.
- `frame.route` is the path and search, `frame.state` the hash, like a live frame.
- An unknown id rejects as `not-found`; a version without a capture rejects as `invalid` (reason `no-capture`).

## 9. Captured-version thumbnails

A live capture saved by `acceptCapture` gets a Projects `thumbnail` (so Projects and Gallery show it) only
when its stored PNG qualifies:

- the bytes are stored under the capture digest and hash to it;
- they are a PNG (signature and header checked; `w` and `h` come from the header);
- they are at most `DEFAULT_LIMITS.maxThumbnailBytes` (2 MiB) and the media type is in
  `THUMBNAIL_MEDIA_TYPES`.

The host's `CaptureRecord` has no byte size, so the size is read from the stored bytes
(`capture-thumbnail.ts`). If the size is unknown, the bytes are missing, or they are too large, the version is
saved without a thumbnail. One is never faked. A version that already exists keeps its fields, as versions are
immutable. Resolution goes through `thumbnail-port.ts`, which reads the same blob by the same digest.

## 10. Operation names added by the durable accessors

Every operation here except `captures.accept` is a read (`write: false`), so an unrecognised failure is
`unavailable` with Retry, never `unknown`. `captures.accept` is a write (`write: true`).

| operation | section | rejects from | typical failures |
| --- | --- | --- | --- |
| `projects.load` | projects | `contentFor`, and anything that waits on it | `unavailable`; `read-only` (newer format, reason `unsupported-stored-schema`); `corrupt` (reason `invalid-content`) |
| `flows.load` | flows | `flowsFor` | `unavailable` |
| `compare.load` | compare | `compareFor` | `read-only`; `corrupt` (reason `wrong-project` or `invalid-comparison`); `unavailable` |
| `taste.load` | taste | `tasteFor` | `invalid` (reason `project-id`) |
| `annotations.open` | annotations | `annotationSessionFor` | `not-found` (reason `version`); `invalid` (reason `no-capture`). A content load failure keeps `projects.load` |
| `captures.accept` | captures | live capture and pick events | `stale` (the page changed), `unavailable`, `conflict`, `read-only`, `invalid`, `unknown` |

Each rejection is a `DesignOperationError` with the original as `cause`. A failed accessor stays failed for
that revision, so a suspended view does not re-read in a loop. To retry after a `reload` or `retry` action,
call `workspace.contentEvents.notify(project.id)`: it only marks the content as possibly changed, and the next
read rebuilds.

`captures.accept` is not a promise the view awaits. `workspace.interactive.snapshot()` carries `failure`
(a `DesignFailure`, or null) beside the `error` sentence, and clears both together. An `unknown` failure also
sets `held`: further preview actions wait until the owner reopens, and none is retried blindly.

## 11. Compare and the capture receipts

`compare-catalog.ts` re-reads the project repository on every `listViews`, `listVersions` and `getVersion`
call, so it never goes stale; the Compare controller's own cached lists are refreshed as in §7. It still
returns `captures: []`. Project content does not keep the provenance, time and extent that a static capture
needs, and full-extent capture with its HQR-2 receipts is owner-held. Nothing here fabricates a capture
receipt. A digest or a thumbnail alone is not one.

## 12. Imports on the durable store (`imports-env.ts`)

In a bridged workspace, `workspace.importsFor(project)` returns the durable Imports env. It is on by default.
In the in-memory fake workspace it stays the labelled synthetic env. Bridged mode never shows synthetic data.

| piece | contract |
| --- | --- |
| Storage | `imports-storage.ts` adapts the importer's `StoragePort` to the bridge. Keys `imports/...` map to `design/imports/...`. The stream `imports` maps to `design/imports`. Revisions are decimal strings in the importer and numbers on the wire. Each write is one atomic `import.commit`. |
| Reads | `design/imports/{records,versions,manifests,conflicts,undo}/` are readable with `doc.get` and `doc.list`. `doc.put` refuses them: they change only through `import.commit`. Blobs are checked with `blob.has`, so planning does not list the whole blob store. |
| Picking | `capabilities.pickSource` calls `import.pick`. The system dialog says "Only choose files you made. HQ records you as their owner.", and that wording is the explicit rights statement for `rights: { basis: 'owned', holder: 'Owner' }`. `pickSource` records `owned` only. The other bases (`licensed`, `permission`, `public-domain`) need a choice in the Imports UI before a file is picked, which is F5's lane; until then a file that is licensed rather than made by the owner must not be imported here. The panel's introductory sentence ("files you have the rights to use") is the panel's own and is not changed by this lane. A canceled dialog resolves `null`. A refused pick rejects as a typed failure with the picker's reason, for example `invalid-png`, `file-too-large` or `file-changed` (`stale`). |
| Identity | One stable source ID (`src-local-png-files`) per project. Item keys are the normalized file names, so the same file is the same item every time: choosing identical files changes nothing and writes nothing. A changed file under the same name is an update. An owner-edited record whose source changed is a conflict. Two files with the same name, or a name that cannot be a key, are `invalid`. |
| Conflicts | A write that lost a race throws `StorageConflictError`, which classifies as `conflict`. Nothing was written. A plan that went stale before it was applied is the same `conflict`. |
| Unknown outcome | A commit whose reply was lost is `unknown` (it may have landed). Views offer `Check`, which re-reads history, never a blind retry. |
| Disabled | A host that does not accept imports answers `{ ok: false, kind: 'unavailable', reason: 'disabled' }`. That is `disabled` with outcome no effect, on every Imports operation. |
| Backup and export | Not available in this build. `saveBundle` is undefined and the storage port's bundle reads (`listBlobs`, `listStreams`, and `listDocuments` of the whole store) fail with `disabled`, reason `disabled`, message "Backup and export are not available in this build". Nothing is read into a bundle and nothing is written. The host's `export.*` routes stay disabled. A backup draft over the durable store therefore stays empty and is never saved. |

### How a view gets the typed failure

The Imports controller's state (`ImportsState`) carries two fields for a failure:

- `message` is the sentence the panel shows. When what was thrown has a string `description`, as every typed
  failure does, `message` is `<message>. <description>`, so the panel says what was kept. A trailing period on
  the message is not doubled.
- `cause` is what was thrown, as thrown. It is `null` unless `status` is `error`, and it is cleared whenever
  `message` is replaced, so it never outlives its sentence.

The Imports module reads `description` by duck typing and never imports `compose`. A view does the typing:

```ts
const state = controller.getState();
if (state.status === 'error') {
  const feedback = designFeedback(classifyDesignError(state.cause, IMPORTS_CONTEXTS.read));
  // feedback.meta, .status, .action (Retry, Reload or Check), .persistent
}
```

Every Imports rejection is a `DesignOperationError`, and it keeps its own operation, kind and reason. The context
passed in only matters for a rejection that is not typed, which reads as `unavailable` with Retry.

| what happened | `kind` | `meta` | `action` |
| --- | --- | --- | --- |
| A refused pick, for example `invalid-png` | `invalid` | `imports.pick · invalid-png` | none |
| An apply that lost a race, or whose plan went stale | `conflict` | `imports.apply` | Reload |
| An apply whose reply was lost (it may have landed) | `unknown` | `imports.apply` | Check, and the notice stays |
| A read that could not reach storage | `unavailable` | `imports.read` | Retry |
| Backup or export | `disabled` | `imports.export · disabled` | none |

A plan the importer refuses (for example a newer format) is not an error: `status` is `rejected`, `message` is the
importer's own sentence and there is no `cause`.

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
- After the commit is sent, whatever the outcome (it landed, it lost a race or was refused, or its reply was
  lost), the adapter calls `contentEvents.notify(projectId)` for each linked project. Nothing is notified when
  the batch fails before it is sent, for example a read-only project or a batch over the size cap.
- A commit is capped at 64 MiB of canonical bytes by the host. A batch over the cap fails as `too-large` with
  reason `import-total`, before anything is sent.

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
- `subscribeAll(listener)` hears every project's changes and is told which project changed. The Projects
  controller uses it, because its gallery shows every project.
- `revision(projectId)` is a per-project counter that starts at 0. It is the cache key of the accessors in §4.
- `notify(projectId)` is for writers. It carries no data and never writes or dispatches.

Writers notify after a durable project-content write succeeds, and also after a failed write whose outcome may
be unknown, so readers re-read instead of trusting a cache. A write refused before anything was sent does not
notify. A listener that throws is isolated. Other listeners still run.

Who notifies today:

| writer | when |
| --- | --- |
| live capture acceptance (`interactive-workspace.ts`) | after the version is saved, and after a failed save (not for a stale capture, which is refused before saving) |
| adding a screen to the saved interactive flow | after the flow is saved, and after a failed save |
| Projects edits (`onContentChange` port of the Projects controller, wired in `bridged-workspace.ts`) | after each edit, and after a failed one; not after a refusal (conflict or read-only) |
| Imports linking | when it lands (it calls `contentEvents.notify`; this table lists it then) |

A writer that does not notify is not seen until something else does. The fake workspace's fixtures never
change, so its revision stays 0 unless a test notifies.

## 4. Fresh content in views

The bridged accessors used to be memoised for the whole session. Now each follows the project's content:

| accessor | returns | after a change to that project |
| --- | --- | --- |
| `contentFor(project, read?)` | `{ repository, content, thumbnails, ... }` snapshot | a new snapshot (new promise) |
| `annotationSessionFor(project, read?)` | annotation session (§5) | a new session; one annotation controller per version is kept, so unsaved marks survive |
| `flowsFor(project, read?)` | the project's saved flows | a new list (new promise) |
| `compareFor(project)` | the `CompareController` | the same controller. It re-reads the version lists its pickers show (`refreshVersions()`); pinned panels and an unsaved layout are untouched |
| `tasteFor(project)` | the Taste client | the same client (it holds the journal's retry state) |
| `projectsFor(project)` | the `ProjectsController` | the same controller. It re-reads the open project and every project it already showed (`refreshContent(id)`); selection, filters and scroll stay |
| `canvasFor(project)` | the canvas environment | the same environment. The project-versions provider refreshes, so the registry lists new versions |

Only the project that changed is affected. Another project's change reads nothing. While nothing changes an
accessor returns the same promise, so React `use()` does not loop. A failed build is cached for the revision
too, and the next change retries it (§7).

`read` is `{ revision?, selection? }`. `selection` picks one of several values (§5). `revision` is what the
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

## 5. Annotation version selection

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

## 6. Captured-version thumbnails

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

## 7. Operation names added by the durable accessors

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

## 8. Compare and the capture receipts

`compare-catalog.ts` re-reads the project repository on every `listViews`, `listVersions` and `getVersion`
call, so it never goes stale; the Compare controller's own cached lists are refreshed as in §4. It still
returns `captures: []`. Project content does not keep the provenance, time and extent that a static capture
needs, and full-extent capture with its HQR-2 receipts is owner-held. Nothing here fabricates a capture
receipt. A digest or a thumbnail alone is not one.

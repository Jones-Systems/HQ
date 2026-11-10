# HQ Design — imports (T13 / HQD-12)

Owner: lane T13. Writer cone: `modules/design/imports/` only.
Task `spec.hq-design#task.imports.001`; checks `#test.imports.001` (group `design-imports`).

## What it provides

- **`hq.design.import/v1` framework** (`src/importer.ts`, `src/mappers.ts`). An import
  manifest records the source kind and version, source ID, JCS/SHA-256 source digest,
  mapping ID and version, per-item actions, counts (`items/created/updated/unchanged/conflicts`)
  and conflicts. Source formats register a `SourceMapper` (kind, supported versions,
  mapping version). Legacy-format adapters (HQD-12b) plug in here once S3 public-safe
  format notes exist; none are included.
- **Permitted design files as View versions.** The built-in `hq.files` v1 mapper accepts
  PNG (signature and IHDR dimensions), MP4/WebM recordings (container signature), HTML
  bundles (safe relative paths, allowlisted media types, HTML entry) and http(s) URLs
  (no embedded credentials). URLs are not fetched. Each item needs explicit rights
  (`owned`, `licensed` with a license, `permission`, `public-domain`); there is no
  "unknown" basis. Every version keeps provenance (source kind/version/ID, item key and
  digest, mapping, import ID/time, optional original name/author/capture time).
- **`hq.design.bundle/v1` backup and restore** (`src/bundle.ts`) across StoragePort
  namespaces. `backup` carries every workspace-class namespace. `export` is publishable:
  no drafts and only blobs its documents reference. `draft-backup` is the separately chosen
  private kind: draft namespaces only, needs `confirmPrivate: true` to create and
  `allowDrafts: true` to restore. Cache namespaces are never bundled. Every bundle reports
  what it included and omitted, and why.
- **Imports surface** (`src/ImportsPanel.ts`, `src/controller.ts`, `src/imports.css`):
  preview → apply, history with undo, conflict resolution, and backup/export choices.
  File picking and saving are injected capabilities. Without them the panel says they are
  unavailable.

## Behaviour guarantees (tested)

| Acceptance | Mechanism |
| --- | --- |
| Repeating the same import changes nothing | Deterministic IDs from source keys and content. A plan where every item is unchanged makes no commit (the store snapshot stays byte-identical). |
| Changed source on an owner-edited record → conflict, never overwrite | A record is owner-edited when its digest differs from the digest the importer last wrote. The record is left untouched and a conflict document keeps the incoming version as unbound evidence. Re-running is idempotent. Resolution (`keep-current` / `take-incoming`) is explicit. |
| Undo tombstones only untouched records | Undo reverts only records still exactly as that import left them: created records are tombstoned, updates restore the prior value. Owner-edited or later-changed records are kept and reported. Versions and blobs are never removed. |
| Unsupported future version rejected with no writes | The source kind and version are checked before anything is read or written. Newer stored record, manifest and bundle schemas are rejected without writes. |
| Bundle round-trip is lossless | backup → serialize → parse → restore into an empty store → backup gives identical bytes. Restore is additive: it skips identical content and aborts the whole restore, with no writes, on any differing content. |
| Publishable export excludes drafts | `export` omits draft namespaces and unreferenced attachments. |

All writes for one operation go through a single `StoragePort.commit` (atomic batch with
compare-and-swap). A stale plan or an injected commit failure leaves the store unchanged.

## Ports (section-local `src/contract.ts`)

`StoragePort` (namespaced documents, immutable content-addressed blobs, append-only events,
atomic `commit` with expected revisions/sequences, no delete), `ClockPort`, `DigestPort`
(defaults to WebCrypto, which exists in Node 24, browsers and Electron renderers).
Namespace classes are `workspace | draft | cache`. `FakeStoragePort` is a labelled
**FAKE** in-memory adapter for tests only. It is not durable and proves nothing about the real store.

Import documents live in the workspace namespace under `imports/records/`,
`imports/versions/`, `imports/manifests/`, `imports/conflicts/` and `imports/undo/`, with
the event stream `imports`. Root adapts imported view versions into project content (T2).
This section creates no project registry.

## Running checks

Framework-free tests (Node 24, no install):

```sh
node --test --test-concurrency=1 modules/design/imports/test/jcs.test.ts \
  modules/design/imports/test/importer.test.ts modules/design/imports/test/bundle.test.ts \
  modules/design/imports/test/controller.test.ts
```

The rendered-markup test needs the root dependencies installed (`npm ci`):

```sh
node --test modules/design/imports/test/panel.test.ts
```

Typecheck with the pinned compiler: `npx tsc -p modules/design/imports/tsconfig.json`
(TypeScript 7.0.2 from the root lockfile).

The panel test renders through the real React runtime (`react-dom/server`). It proves
markup, labels and disabled states only. It is not evidence of layout, Electron behaviour
or the desktop picker/save capabilities.

## Not covered here

The real durable store (T9), desktop file picker/save capabilities, the legacy-format
adapters (HQD-12b, which need S3 format notes and selected-file publication decisions),
and root composition into projects/canvas are all unqualified in this section.

# Design app storage seam (HQD-INT-STORE)

Narrow, namespace-bound adapters between the Design sections and the T9 file store
(`packages/design-store`). Local, unpublished source; no production IPC or preload hosting.

## Layout

| File | Runtime | Purpose |
| --- | --- | --- |
| `index.ts` | renderer-safe | The only seam COMPOSE imports: ports, types, pure helpers. |
| `backing.ts` | renderer-safe | Workspace and cache views over a T9 `StoragePort`. |
| `requests.ts` | renderer-safe | T6 `StoragePort` adapter (create-only freeze). |
| `outbox.ts` | renderer-safe | T12 `OutboxStorePort` adapter (revision CAS). |
| `canvas.ts` | renderer-safe | T3 `CanvasStoragePort` adapter (one-shot read token → real CAS). |
| `projects.ts`, `components.ts`, `flows.ts`, `compare.ts`, `annotations.ts` | renderer-safe | Section document adapters over `WorkspaceDocuments`. |
| `section-documents.ts` | renderer-safe | Fixed section roots and scope validation. |
| `export.ts` | renderer-safe | Privacy-projected request export, bound to the v1 packet at requests PR33. **Disabled by default.** |
| `canonical.ts` | renderer-safe | Pure RFC 8785 serializer. |
| `node.ts` | Node only | Opens the T9 store and binds the adapters. Never import it from the renderer. |
| `proposal/imports-txn.ts` | pure, not exported | **UNACCEPTED** T13 transaction proposal (conformance scaffolding). |

`test/renderer-safe.test.ts` proves statically that `index.ts` reaches no `node:*`, `electron`, bare
package or T9 implementation file; the only store edge is an erased `import type` of
`contract.ts`.

## Namespaces and deletion

`bindWorkspace` accepts only an authoritative namespace and `bindCache` only an evictable one. A
workspace view is a frozen object built by listing properties, so `deleteBlob`, `deleteDocument`,
`adoptBlob` and the general `commit` do not exist on it or on any adapter built from it (tests
check the runtime surface, not just types). `deleteBlob` exists only on the cache view. This keeps
the no-deletion/retention hold: nothing here decides or implements retention.

## Adapters

- **Requests (T6).** `createDocument` is write-once (`expectedRevision: null`); it answers
  `exists-identical` only for byte-equal canonical bytes, so a retry after an unknown outcome
  reconciles, and it never replaces a document. Bytes must be canonical JSON and keys stay under
  `design/requests/`. Review events use `eventId` as `clientEventId`, so a retried append is a no-op.
- **Outbox (T12).** One document per dispatch under `design/connector/outbox/`. `put` is a real
  revision compare-and-swap; a conflict returns the current record. No delete. The returned
  `current` and `get` records are parsed by an optional connector-supplied `parse`.
- **Canvas (T3).** T3's own check is advisory. Each `readDocument` leaves a one-shot token with the
  revision it saw; `writeDocument` consumes it and writes with that revision, or is refused.
- **Streams.** T9 gained `listStreams` (sorted, optional prefix). A hashed journal file name cannot
  be mapped back to an id, so an authoritative namespace fails closed instead of omitting it.

## Section documents (HQD-F1)

`WorkspaceDocuments` selects only `kind`, `namespace`, `getDocument`, `putDocument` and
`listDocuments`. The five factories require a workspace view bound to `workspace` and return
frozen objects with exactly their lane port members. They expose no removal, blob, event,
health or transaction capability. The renderer index exports these adapters; `node.ts` and
`DesignStorage` do not wire them.

- Projects: null on absent; string revisions over T9 numeric revisions. Null expected revision
  is create-only; canonical positive safe-integer strings perform CAS. Malformed revisions and
  T9 conflicts throw the projects lane's actual `StorageConflictError`.
- Components and flows: undefined on absent; unconditional overwrite. Flows carries
  `DEVICE_STORAGE_LABEL` (`Saved on this device`). Their `listKeys` strips the fixed root.
- Compare: null on absent; unconditional overwrite of the exact `{format, text}` envelope
  using `TEXT_FORMAT`. Text survives byte-for-byte; malformed envelopes fail.
- Annotations: null on absent; unconditional overwrite keyed by `document.versionId`;
  `adapter` is `real`.

The fixed roots are `design/projects/`, `design/components/`, `design/flows/`,
`design/compare/` and `design/annotations/`. Mapping always prepends the root to the complete
lane key, including an existing lane prefix. No path normalization occurs. Empty document
keys, leading slashes, `..` segments, controls, lone surrogates, invalid T9 lengths/trailing
whitespace and other section/reserved root keys fail before store access. An empty listing
prefix lists the adapter's whole root. JSON values go directly to T9's validator; unsupported
members are not silently serialized away. Canvas retains its existing root and read-token CAS.

## Export (disabled)

`createRequestsExport(reader, { enabled })` is disabled unless `enabled === true`; the Node wiring
never enables it. A T6 freeze record also holds the consumed draft and the continuation draft, so
namespace membership is not enough: the projection copies `schema`, `packet` and `consumed` only,
never reads `draft` documents, exports only attachments selected into a packet, omits and counts
keys it does not know, and refuses the whole export on any record that is not the pinned v1 shape.
Pin: requests head `fb392cf5fa99ab5656df8b22b4a316b05153d5b5` (PR99's fixes on PR33 `896a726d`; packet, freeze and review schemas unchanged since PR17 `2438d6ff`) (`export.test.ts` also fails if the
requests source changes). Wiring for an extension adapter waits for its accepted delta.

PR33 inputs (same port, new documents): candidates and review events go through allow-lists of
their v1 keys. A return carrying `provenance` (host/model; connector or owner-reported) or a null
`candidateVersionId` is not the v1 shape and is omitted whole and counted, as are reviews that
point at an omitted return. `sends/` and `handoff/` documents (destination label, pinned/actual
host and model, connector detail) are classified, never read, and counted as labelled omitted
stores. `reject` is accepted as a decision under the unchanged review schema. Note: a frozen
packet still carries its own `destination` (id and label) as v1 content, so that label is part of
the exported packet; the send and handoff copies are not.

## T13 transactions (unaccepted proposal)

Document CAS alone does **not** establish atomicity across T13's documents, blobs and events, and
T9's manifest covers documents only. `proposal/imports-txn.ts` sketches: stage content-addressed
blobs; publish one manifest holding the document puts, blob-visibility records and an event-intent
journal; replay the events with `clientEventId = <txn>:<index>`. The tests crash it at every
filesystem call and require an all-or-nothing result *after recovery*. They also show what the
proposal does not give: between the commit point and the replay the raw store shows documents
without their events (eventual, not atomic, visibility); staged orphan blobs and applied
intents are never deleted; and a crash that tears an event append leaves that journal fail-closed
in T9, so replay stays blocked until the owner runs T9's explicit `repairTornTail`.

## Not claimed

Cross-record durability, power-loss or `F_FULLFSYNC` behaviour, retention or deletion policy,
production IPC/preload hosting, production enablement, and acceptance of the T13 proposal.

## Checks

```sh
node_modules/.bin/tsc -p modules/design/app/storage/tsconfig.json
node --test --test-concurrency=1 modules/design/app/storage/test/*.test.ts
```

Tests use synthetic temp stores under `os.tmpdir()` and assert the directories are gone.

## Disabled manifest-visible engine (K1)

`node.ts` adds `transactions: DesignTransactions` and `exportBundle: DesignExportPort`.
`transactions.workspace` is the gated host facade. Bind every participating host operation
and renderer adapter to that same facade; the original `workspace` member remains a raw
compatibility view outside the atomicity contract. Recovery initializes before this new
surface is returned. Production constructors never enable import, repair or export.

The new `createImportsStorage(transactions)` maps imports lane keys `imports/...` to
`design/imports/...`, and its `imports` stream to `design/imports`. It preserves the lane's
port and conflict class. The new protocol retains applied intents, quarantines torn streams
only on explicit repair, refuses corrupt streams and leaves an uncertain live manifest
scope blocked until reopen. Diagnostics reports orphan bytes/counts and pending/blocked
intents. Legacy hashed streams return `unavailable` / `stream-enumeration`.

Blobs written through the gated facade acquire visibility metadata. Raw legacy blob writes
remain accessible through the original APIs; they are not implicitly adopted into the new
manifest-visible surface. This prevents staged orphans becoming visible merely because an
existing document mentions their digest. There is no retention or deletion capability.

Renderer additions are `WorkspaceRecords`, `createReferencesStorage`, `createEvidenceStore`
and `createDiscoveryCacheStore`. References retain mediaType in AssetRef records, use
string/numeric CAS, and expose no blob deletion. Evidence is create-only, with dispatch-prefix
listing and global evidence-ID reconciliation. The discovery factory returns only
namespace/readDocument/writeDocument for the exact catalog key; it is not the full preview
cache port. Existing outbox signatures already match the connector; mutual assignability
is now checked without casts.

`exportBundle.preview(exportedAt)` returns only the omission report; `.build(exportedAt)`
returns deterministic bundle/v1 bytes plus that report. Both return disabled in production.
Per-section recursive allow-lists exclude unknown content. Requests use the existing v1
projection, whose public legacy enable option remains unchanged. Detailed omissions stay
outside bundle/v1 because its parser rejects unknown fields. Native dialogs belong to r3.

See HQD-K1-engineering-spec.md for protocol, interfaces and limitations, and
HQD-K1-work-note.md for verification. No host route or feature is enabled by these additions.

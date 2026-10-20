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
| `export.ts` | renderer-safe | Privacy-projected request export, bound to PR17 v1. **Disabled by default.** |
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

## Export (disabled)

`createRequestsExport(reader, { enabled })` is disabled unless `enabled === true`; the Node wiring
never enables it. A T6 freeze record also holds the consumed draft and the continuation draft, so
namespace membership is not enough: the projection copies `schema`, `packet` and `consumed` only,
never reads `draft` documents, exports only attachments selected into a packet, omits and counts
keys it does not know, and refuses the whole export on any record that is not the pinned v1 shape.
Pin: requests head `2438d6ff96a84141e12e30bab2d28d042aa80d01` (`export.test.ts` also fails if the
requests source changes). Wiring for an extension adapter waits for its accepted delta.

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
production IPC/preload hosting, the connector evidence store, and acceptance of the T13 proposal.

## Checks

```sh
node_modules/.bin/tsc -p modules/design/app/storage/tsconfig.json
node --test --test-concurrency=1 modules/design/app/storage/test/*.test.ts
```

Tests use synthetic temp stores under `os.tmpdir()` and assert the directories are gone.

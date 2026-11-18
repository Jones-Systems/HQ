# Manifest-visible Design imports

Artifact Type: engineering-spec
Artifact ID: spec.hq-design-storage-engine
Purpose: Qualify the disabled Design storage engine and renderer adapters.
Decision owner: Design integration coordinator
Consumers: Design host successor and section composition
Authority effect: none

## Binding

Implementation follows `spec.hq-integration-parallel-execution` at
`c49c3c4e25bc634deeaa3ed29df927d76cbb82fb`, sections `task.design-storage-engine.001`,
`test.design-storage-engine.001`, `ctx.lane-t8.001`, `req.design-closure.001` and
`ac.design-closure.001`. Direct source inspection and the accepted preflight
settle this bounded implementation; no external service or new architecture is needed.

## Interfaces

Renderer exports add WorkspaceRecords, createReferencesStorage(WorkspaceRecords),
createEvidenceStore(WorkspaceDocuments), and createDiscoveryCacheStore(CacheBacking).
The latter returns only namespace/readDocument/writeDocument, structurally the
catalog-only Pick of discovery's port. It cannot satisfy the full preview-blob port.
References preserve mediaType in each AssetRef and map canonical string revisions
onto numeric CAS. Evidence is create-only; append reconciliation is serialized for
adapters sharing a backing. Its dispatch listing uses an exact prefix and its global
ID lookup searches the evidence root. All records stay under fixed Design roots.

Node exports add DesignStorage.transactions and DesignStorage.exportBundle.
Existing workspace/cache members and constructors keep their signatures and behavior.
The host successor must route every participating operation through
transactions.workspace. That facade is additive; raw workspace access is outside
its atomicity guarantee. The host must keep one runtime for one T9 writer lock.

The engine hashes a copied canonical operation array, with blob bytes represented
as base64, into a 64-character transaction ID. Limits are 10,000 operations, 16 MiB
per blob and 64 MiB for the complete canonical operation array (including base64).
All validation and CAS/stream checks precede writes. Blob metadata and one complete
intent join document puts in the same manifest. The intent records affected keys,
blob identities, stream bases, payloads and payload digests. Replay verifies the
already-written suffix, appends with deterministic client IDs, and CASes applied.

The writer-fair gate admits document/blob/event operations as shared and transactions,
recovery, repair and export as exclusive. Internal calls never reacquire the gate.
An uncertain live manifest failure retains the overlay and requires reopen, without
retry. Reopen performs T9 document recovery before engine replay. Torn streams stay
blocked; only explicit repair quarantines and truncates them. Corrupt streams are
never repaired. Legacy proposal intents retain their separate unaccepted protocol.

No engine capability deletes authoritative data. Staged orphans have no visibility
metadata and are counted. Raw legacy blob writes do not acquire visibility metadata;
the existing raw APIs retain their behavior, while the new facade requires metadata. Diagnostics also reports T9 directoryFsync health, not power-loss safety.
Long keys that T9 would hash are rejected at import validation. Legacy unenumerable
streams make export/diagnostics unavailable with reason stream-enumeration.

## Export and enablement

Exports use explicit recursive per-section field projections; unknown records and
streams are counted, not copied wholesale. Requests use the unchanged v1 projection.
The output is the existing strict imports bundle/v1 shape with a separate omission
report. A caller-supplied timestamp fixes deterministic output. Save-dialog wiring
belongs to the host. No export operation writes storage or opens a dialog.

TRANSACTION_STATUS remains accepted:false/state:disabled; EXPORT_STATUS remains
disabled. Production construction never passes engine enablement. Only synthetic
fixtures call internal constructors with enablement; no production module imports
the fixtures and neither renderer nor node public exports exposes those constructors.
The legacy createRequestsExport enabled option is intentionally preserved.

## Verification and limits

Tests inject process termination at every filesystem call actually reached during
commit, including reads, with clean and torn writes. Reopen observations use the
gated facade; blocked scopes are unavailable until explicit repair. Tests separately
prove quarantine byte preservation, corrupt refusal, byte-equal preflight rejection,
concurrent put ordering, idempotence, privacy, omission counts, and bundle restoration.
These tests make no power-loss or raw-directory atomicity claim.

Frozen boundaries: packages/design-store, lane contracts, F1 signatures, compose,
host IPC and root configuration. Follow-ups remain with their owners: discovery's
catalog consumer narrowing and a persistent index for legacy hashed stream names.
No deployment, installation, real dispatch or enablement is included.

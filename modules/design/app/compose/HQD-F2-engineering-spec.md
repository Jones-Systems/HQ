# HQD-F2 Design document bridge

Artifact Type: engineering-spec
Artifact ID: spec.hqd-f2-compose
Decision: the supplied B4 design and round-two boundary clarification.
Base: `2886846745f08ff3a28e878d218902a10eba9234`.
Scope: compose and the production app entry. F1, contracts, section implementations and workflows are frozen.

## Boundary and selection

The production entry observes the optional desktop Design transport once. A structurally usable
transport selects a document-backed workspace; absence selects the original labelled fake workspace.
Creating either workspace performs no document operation. React context supplies the selected workspace
without changing shell-facing export signatures or section descriptors.

Wire documents are untrusted. A single function validates the exact metadata shape, workspace and key,
positive safe revision, digest grammar, timestamp string and JSON value before asserting store brands.
The compile-time proof derives the document from WorkspaceDocuments and compares its unbranded metadata
and JSON value to the wire contract. It imports no store implementation.

Conflicts reuse F1's structural StoreError/conflict signal. Explicit bridge failure kinds remain distinct.
Rejected calls and malformed responses become unavailable on reads and unknown on writes. There are no
client retries or fake fallbacks. List results must be dense string arrays inside the requested prefix.

Six sections use F1 ports. Empty stores remain empty; navigation never seeds documents. Missing thumbnail,
capture and preview capabilities stay unavailable. Discovery, taste and imports retain their existing fakes.
Section loading errors remain local. Canvas reports source-provider failures without blocking its own
arrangement storage. Requests, connector and references remain unmounted.

## Evidence basis and acceptance

The owner supplied the settled design. Direct inspection of the wire contract, F1 adapters and conflict
checks, store identifier grammar, and section controllers supplies the bounded source evidence needed
for this implementation; no external product or architecture decision is introduced.

Focused synthetic tests cover wire validation, revisions, conflict translation through both F1 adapters,
selection, read failure isolation, no-write navigation and controller persistence across reconstruction.
The renderer analyzer admits only the F1 index as an external storage entry and walks its transitive graph.
Its fixtures cover allowed entry, direct-adapter rejection, Node escape and store-implementation escape.
Required validation is the workflow inventory, app/storage typechecks and tests, plus root typecheck,
tests and build. Installed-app behavior and a real desktop bridge are separate, unclaimed evidence.

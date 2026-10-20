# HQD-F1 section document adapters

Task: add renderer-safe per-section document adapters over the existing T9 storage seam.
Base: `c84f0739763902f7c47d1afb8d822f9edcc56560`.
Implementation: `e693121c05b54b17bfb3e2f0b900e22b33484855`.
Writer/Git owner: HQD-F1; exclusive scope `modules/design/app/storage/**`.
Publication, integration and installed-app claims: none.

## Decisions and evidence

The supplied task settles the adapter design. Direct source inspection of T9's contract,
identifier validation, JSON validator and document writer, plus all five lane contracts,
fakes and persistence tests, supplies the bounded research basis.

Factories, interfaces, key roots, errors and absent/overwrite semantics are documented in
README.md. Type-level mutual-assignability tests bind the local ports to the lane contracts.
Projects imports the actual lane conflict class. Annotation document/version imports are
type-only. The renderer graph check includes these pure dependencies and continues to exclude
Node globals, bare packages and every T9 implementation file.

Synthetic real-store tests prove scope rejection before backing access; exact surfaces; key
length limits; list prefix confinement and root stripping; strict JSON rejection without
creating/replacing a record; projects create-only/CAS conflicts; compare text/envelope behavior;
and unconditional puts for all four revision-free ports. Tests remove each owned temporary
store in finally blocks and assert its directory is gone.

Canvas changed only its input type/import from WorkspaceBacking to WorkspaceDocuments.
Its implementation and tests are otherwise unchanged. No compose or Node wiring changes.

## Checks

Admission samples measured aggregate CPU used over two seconds, load averages, processor
count and MemAvailable. All samples had 16 available logical processors.

| Batch | CPU used | Available GiB | Load 1/5/15 min |
| --- | ---: | ---: | --- |
| Dependency installation | 35.50% | 38.79 | 8.9263 / 6.6465 / 5.2666 |
| Focused seam checks | 30.51% | 40.24 | 5.3447 / 5.9585 / 5.2354 |
| Required check union | 26.64% | 40.70 | 5.3135 / 5.8682 / 5.2505 |

Dependency installation used npm ci in this checkout; manifests and lockfile unchanged.
Both test batches ran serially while holding the shared HQ checks lock.

| Check | Exit | Passed tests |
| --- | ---: | ---: |
| Focused storage typecheck | 0 | — |
| Focused section/namespaces/renderer tests | 0 | 33 |
| Storage typecheck | 0 | — |
| Storage node:test | 0 | 97 |
| T9 typecheck | 0 | — |
| T9 node:test | 0 | 58 |
| App typecheck | 0 | — |
| Compose node:test | 0 | 123 |
| Canvas typecheck | 0 | — |
| Canvas node:test | 0 | 43 |
| Canvas Vitest | 0 | 5 |

No failed, skipped, cancelled or todo tests. The required union has 326 passing tests.
Only documentation changed after that union ran. No independent review was requested or
performed. The single SEAM notice for the implementation commit was accepted with delivery
`started` and status `starting`; that does not establish parent consumption or integration.

## Limits

No production wiring, IPC, preload, deployment, export extension, retention, deletion,
blob/event capability, push, pull request or fan-in. No unresolved lane choices.
An empty listing prefix is supported, matching the two listing fakes; empty document keys
are rejected. Keys already bearing their own lane prefix still receive the fixed adapter
root, as the supplied mapping requires.

# B3 Design real-host end-to-end matrix (W6): handoff

Status: **paused by the owner mid-work.** The matrix is built and green. The error-name audit, typechecking and the wider test runs are not done.

## Branch and head

| | |
|---|---|
| Branch | `work/hq-b3-design-e2e-20261103` |
| Worktree | `~/.t3/worktrees/HQ/work-hq-b3-design-e2e-20261103` |
| Base | `work/hq-b3-design-errors-20261103`, head `3917ee9abae3b76c7e1fb5a60f05c22bb2c6dd47` (PR #179's composed source plus B3's typed-error contract) |
| WIP commit | `c1fc58ce5c8dedadcb271ed5eb3558cd900e553f` (the matrix files) |
| Handoff commit | This file's commit, the branch head. The exact SHA is in the thread reply that accompanied this push. |

Nothing is uncommitted. No PR is open. No PR is watched.

## Goal

Prove with automated tests that every Design section's durable path works through the real desktop Design host and the real file store, not fakes. Fix any defects the matrix reveals, minimally and with a regression test. Check that composition errors carry stable `name`s so classification survives bundling.

## What exists

All of it is new files. No production source has been edited.

| File | Purpose |
|---|---|
| `apps/desktop/test-support/design-e2e/harness.ts` | Reusable harness. `withDesignE2E(run, options?)` builds a real `createDesignHost(open)` over a real store in a `TMPDIR=/tmp` temp dir. It adds an in-process transport that mimics the preload `hq:svc:design` IPC (`structuredClone` of params and results, same route/params shape), the real `createBridgeWorkspaceDocuments`, and `createDesignWorkspace`. It mimics the main-process dispatch (`jonesCode.*` unavailable, `catalog.*` through the real catalog host, everything else to the Design host). `reopen({readOnly?})` closes and reopens the host over the same store. The `finally` block closes everything and throws if the temp dir still exists. |
| `apps/desktop/test-support/design-e2e/fixtures.ts` | Synthetic fixtures: a real 1x1 PNG, its digest and preview ref, a shell project, a minimal valid flow. |
| `apps/desktop/test-support/design-e2e/requests-fixtures.ts` | Synthetic Requests fixtures: source, annotation, evidence, returned candidate. |
| `apps/desktop/electron/design-host.e2e.sections.test.ts` | 15 tests: one real user flow per section, with durability across host `close()` and reopen. |
| `apps/desktop/electron/design-host.e2e.failures.test.ts` | 27 tests: the failure classes, asserted through `classifyDesignError`. |

Harness transport helpers: `calls` (recorded route, params, result and outcome), `dropRequest(matcher)`, `loseReply(matcher)` and `gate(matcher)` (returns `{reached, release}` to interleave two windows). A matcher is a route name or `(route, params) => boolean`.

## Result so far

Last run, before the pause:

```
bash /tmp/hq-b3-e2e/cpu-ok.sh && TMPDIR=/tmp timeout 300 node_modules/.bin/vitest run apps/desktop/electron/design-host.e2e.failures.test.ts apps/desktop/electron/design-host.e2e.sections.test.ts
Test Files  2 passed (2)
     Tests  42 passed (42)   (3.41 s, CPU 79% busy at start)
```

### Section matrix (what the tests prove)

| Section | Operation proved through the real host and store | Result |
|---|---|---|
| Projects | Create project through the registry; add and rename a view; append a version with a thumbnail (`blob.put`, then read through `contentFor(...).thumbnails.readThumbnail`); all survive close and reopen. Versions are append-only and ordered. | pass |
| Components | Library revisions 1 and 2, variants, design system, motion study, membership across reopen; stored revision checked. | pass |
| Flows | Save, overwrite (stored rev 2 at `design/flows/design/flows/flow-checkout`), list and load per project after reopen. | pass |
| Compare | `createCompareStorage` save (rev 1); composed `compareFor` loads it after reopen; resize then save gives rev 2. Two windows: last write wins. | pass (see finding 2) |
| Annotations | Box mark with a note saved and loaded after reopen; another version is empty. | pass |
| Canvas | `saveArrangement` through the read token; reload after reopen; second save gives rev 2. | pass |
| References | `library.importReference` stores the PNG through `blob.put`, rev 2, bytes readable after reopen, observed-again is unchanged. Graph `adoptFlatLibrary` persists. | pass |
| Requests | Create, edit, freeze, two reviews, reopen: packets, reviews, candidates and `listRequests` intact. Review events seq 1 and 2. Idempotent `appendEvent` by `clientEventId`. | pass |
| Connector | Real `createOutbox` (labelled fake receiver and clock) over `closure.outboxStore`: submit accepted at rev 2; stale and null `put` are conflicts; `intakeEvidence` flags a duplicate; reopen lists both. | pass |
| Discovery cache | Clear on open is `cache.put` rev 1; `writeDocument` gives rev 2; `cache.get`; reopen. Exact key only. | pass |
| Taste journal | Exact `TASTE_JOURNAL_KEY`: create-only, CAS update, reopen. Simple roundtrip only, as scoped. | pass |
| Imports | **Not tested, by instruction** (another builder owns it). | not covered |

### Failure classes covered

| Class | How it is provoked | Result |
|---|---|---|
| `conflict` (5) | Raw create-only and stale revision; Projects `StorageConflictError` via a gate; Components `IntegrityError` with `reason: 'exists'` via a gate on `doc.get`; Canvas `CanvasWriteConflictError` via a gate on `doc.put`; References library reload-retry. | pass |
| `invalid` (4) | Oversize value, event and cache; blob over the 16 MiB cap rejected in the bridge before sending, and in the host (exactly 16 MiB accepted); keys outside the roots (the store is not even opened); section scope errors raised before any send. | pass |
| `disabled` (8) | `export.preview`, `export.save`, `import.status`, `storage.diagnostics`, `import.repair`, `import.pick`, `import.commit`: `reason: 'disabled'` survives the bridge, kind `disabled`, outcome `no-effect`, meta `<op> · disabled`. | pass |
| `unavailable` (2) | Read and write after `close()`; a composed Projects read after close. Nothing is written. | pass |
| `unknown` (5) | `doc.put` reply lost, then read-back and retry conflicts; request dropped; `blob.put` and `event.append` lost then retry reconciles; Requests `createDocument` lost then `exists-identical`; unrecognised error is `unknown` for writes and `unavailable` for reads. | pass |
| `read-only` and damaged (3) | Read-only store through `reopen({readOnly: true})`; future-schema project content stays untouched (`ReadOnlyContentError`); invalid flow save refused before any write. | pass |
| `too-large` | **Cannot be produced.** See finding 1. | documented |

## Defects found

**None in production code so far.** All failures during development were wrong assumptions in the tests, each fixed in the test (see "Test-side corrections" below).

## Findings

1. **No storage path returns `too-large`.** Oversize values, events, cache values and blobs all come back as `invalid`; the bridge pre-checks blobs and sends nothing. `too-large` is reachable only from `PreviewError`. The failures test header comment records this. Decide whether the brief's "`invalid` or `too-large`, whichever the host returns" is satisfied as documented, or whether the host should return a distinct kind.
2. **Compare has no CAS in its adapter.** It overwrites unconditionally by design. CAS exists only at store level through `doc.put expectedRevision`. The brief's "Compare: save and load with CAS" does not match the adapter. The test asserts last-write-wins and says so.
3. **Projects has no rename-project or archive-project operation in this base.** The registry offers `list` and `create` only. Rename is covered for views. Project rename and archive could not be tested because they do not exist.
4. **Built-in validation errors classify as `unknown` for writes.** Components, Flows and Discovery throw plain `TypeError` or `RangeError` for invalid input. An invalid flow save is refused with no write, yet the user sees "result not confirmed". Recommend named errors in those lanes, classified `invalid`.
5. `compose/bridged-workspace.ts` `contentFor` throws a generic `Error` for read-only or invalid content, which classifies as `unavailable`. That file belongs to the content-caching builder. Left alone.
6. A References second-window import is not rejected. The library reloads and retries once, so both references are kept at rev 2. This is correct behaviour, not a defect.
7. `listDocuments('design/connector/')` is `invalid`. The host allows only the two connector roots (`outbox/` and `evidence/`). This is host design.
8. Tests use the **source** store (`openDesignStorage` loaded through vite). Production loads the emitted `node.js` through `openEmittedDesignStore`. Emitted-store parity is covered by the existing `design-host.test.ts`, which needs `npm run build:electron`.

## Decisions and why

- **In-process transport instead of Electron IPC.** It exercises the same route, params shape and `structuredClone` boundary without launching Electron. It lets tests drop requests, lose replies and gate calls deterministically.
- **Tests live in `apps/desktop/electron/`.** Root vitest already runs `apps/desktop/**/*.test.ts` in the node project, and `tests/check-groups.toml` already globs `apps/desktop/electron/**/*.test.ts`. So the Foundation job runs them and **no CI wiring is needed**. `.github/workflows/design-sections.yml` inventory rows and `HQD_EXPECTED_ROWS=20` stay unchanged. The `modules/design/app` row runs `compose/test/*.test.ts` under `node --test` and cannot import `design-host.ts`, which uses `.js` specifiers.
- **Source store, not emitted.** Avoids a build step in the test. Parity is left to the existing emitted-store test.
- **Temp dirs.** Every run uses `mkdtemp` under `/tmp` and the harness fails the test if the directory survives.
- **Taste kept to a roundtrip.** Another builder adds the Taste-specific real-host test.
- **Scoped out:** Imports, content caching and captures in `bridged-workspace.ts` and `interactive-workspace.ts`, Taste internals, `compose/views/*.tsx` and section `ui/` folders (F4 and F5).

## Test-side corrections made along the way (for context)

Flat workspace has no `.bridged.projectsFor` (added a `bridged` assertion and a type); annotation draw returns `applied`; References graph uses `subjects` and `captures`; cache revision after clear plus write is 2, not 3; the "invalid flow" fixture had to use `platform: 'toaster'`; the second-window References import merges rather than refuses.

## What is left, in priority order

1. **Typecheck the new files.** Nothing has been typechecked. `apps/desktop/test-support/` is probably not covered by `apps/desktop/tsconfig.electron.json` or `tsconfig.design-host.json`. Check which includes the new `*.test.ts` files and the harness. If none does, add `apps/desktop/test-support/tsconfig.json` mirroring `modules/design/app/tsconfig.json` and include the harness, fixtures and both test files. Run `node_modules/.bin/tsc -p <that>`. Expect to tidy some `as never` and `as unknown` casts and a duplicate import from `projects/src/content.ts` in the failures test.
2. **Error-name audit.** These internal classes have no stable `name`. None is yet confirmed reachable from a composed user operation, so confirm that first:
   - `modules/design/discovery/src/discovery.ts:69-70`: `class Timeout`, `class Cancelled` (bare `extends Error {}`). Proposed names `DiscoveryTimeoutError` and `DiscoveryCancelledError`. Classify timeout as `unavailable` and cancelled as `cancelled`.
   - `modules/design/canvas/src/codec.ts:33`: `class Invalid extends Error {}`. Proposed `CanvasDocumentInvalidError`, classify `invalid`.
   - `modules/design/references/src/persist.ts:22`: exported `class Invalid` with a `path` field. Proposed `ReferenceDocumentInvalidError`, classify `invalid`.
   - `modules/design/app/compose/reference-reads.ts:16`: `class ReadOnlyObservation extends Error {}`. Keep the name, set it explicitly, classify `read-only`.
   - Already named and fine: Components `IntegrityError`, Discovery `SourceUnavailableError` and `PreviewError`, References `CanonicalizationError`, both `CanonicalJsonError` classes.
   - **Before renaming**, grep for any code that matches on `error.name`, `error.constructor.name` or `instanceof` for these classes. The grep for usages was started and not completed.
   - Then add the classification lines to `classifyDesignError` in `modules/design/app/compose/errors.ts` (the `named(...)` lines near the end) and cases to `modules/design/app/compose/test/errors.test.ts` (`node:test`). Keep it additive.
   - Optional: a source-scan guard test (for example `compose/test/error-names.test.ts`) requiring every `Error` subclass under `modules/design/**` to set a name, excluding `modules/design/imports`.
3. **Event-stream status probe (unfinished).** I was comparing the store's `EventStreamRead.status` (`ok`, `torn-tail`, `corrupt`; see `packages/design-store/src/contract.ts`) with the `EventRead.status` the bridge and `packages/contracts/src/design-records.ts` accept, to see whether a torn or corrupt stream reaches the UI as a typed failure. No conclusion yet. If a mismatch exists, it is a candidate defect and needs a regression test.
4. **Run the wider checks**, one serial process at a time, each after a CPU sample:
   - `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts`
   - `node_modules/.bin/tsc -p modules/design/app/tsconfig.json` and any section tsconfig touched
   - `node_modules/.bin/tsc -p apps/desktop/tsconfig.electron.json` and `-p apps/desktop/tsconfig.design-host.json`
   - `npm run build:electron`, then the existing `apps/desktop/electron/design-host*.test.ts` alongside the new files, to confirm they coexist and leave no temp dirs
   - the full desktop vitest run
5. **Update `modules/design/app/compose/BACKEND-CONTRACT.md`** additively: any new error names, and the finding that storage oversize is `invalid`.
6. **Final report to the lead** with the changes by file, the section matrix above, defects fixed, exact commands and counts, and anything uncertain. End with `branch work/hq-b3-design-e2e-20261103, head <full SHA>`.

## Open questions and risks

- Should `too-large` be reachable from storage oversize (finding 1), or is `invalid` the intended answer?
- Compare "with CAS" (finding 2) and project rename and archive (finding 3): the lead should confirm these are out of scope for this base, or point to the branch that adds them.
- Findings 4 and 5 need owners in other lanes (Components, Flows, Discovery; content caching).
- The harness installs `globalThis.window = { hqServices: { design: transport } }` for the discovery path and restores it on close. A test that bypasses `withDesignE2E` could leak it. All current tests use the wrapper.
- Typecheck has never run on the new files, so there may be type errors the vitest transform hid.
- CPU discipline: one run started at about 89% busy before I added the gate. Use the gate below before every test run.

## Only outside the repo, or only in the thread

- Everything in the repo is committed and pushed.
- A scratch script `/tmp/hq-b3-e2e/cpu-ok.sh` exists on the original machine only. It loops up to 36 times: sample `top -bn2 -d1 | grep Cpu | tail -1`, compute busy percent as 100 minus idle, exit 0 when busy is under 85, otherwise sleep 5 s; exit 1 after about three minutes. Recreate it, or just sample CPU by hand before each run.
- The detailed record of the Design host, bridge and adapter reading (route lists, caps, root list) lives only in the earlier conversation transcript on that machine. The facts that matter are in the sections above. Re-read `design-host.ts`, `bridge-documents.ts`, `closure-workspace.ts` and `bridged-workspace.ts` if you need more.

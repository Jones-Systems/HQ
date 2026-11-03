# HQ B3 W2 handoff: Imports on the durable Design store

Written 2026-11-03 at an owner pause. Work stopped cleanly: nothing is uncommitted, no test was running.

## 1. Where it stands

- Branch: `work/hq-b3-design-imports-20261103`
- Worktree: `~/.t3/worktrees/HQ/work-hq-b3-design-imports-20261103`
- Code head before this handoff commit: `807346e6e6e66540a2da465390da9b59d3aae3a2`
- The pushed head after the handoff commit is the tip of the branch on `origin`. The thread reply that carried this
  text names it. `git rev-parse origin/work/hq-b3-design-imports-20261103` shows it.
- Lineage: base 3917ee9, then a merge of W1 (`work/hq-b3-design-errors-20261103` at 1fe0c16), then a merge of W3
  (`work/hq-b3-design-content-20261103` at 8377551), then three review-fix commits.
- Lead opens PRs. This lane opened none and watches none.

### Done

Goal W2: Imports work end to end against the real local store, on by default.

- Production opens the store with imports enabled and injects a native picker. Export stays disabled.
- `design/imports/` documents are readable through `doc.get` and `doc.list`. They are written only by the atomic
  `import.commit`. `doc.put` still refuses them.
- The renderer storage adapter maps the importer's storage port onto the bridge (keys, stream, decimal-string
  revisions, one atomic commit per write). It is wrapped so every rejection is a typed `DesignOperationError`.
- The durable `pickSource` builds an `hq.files` v1 source with `basis: 'owned'`.
- Imported PNGs link into project content in the same atomic commit: a view and a version per record, with a
  thumbnail. Readers are notified after every sent commit. Undo leaves the versions in place.
- `ImportsView.tsx` is wired minimally. No markup, layout or style change.
- Review fixes after the lead's first review:
  - P2: the Imports controller keeps what was thrown on `state.cause` and joins a description onto `message`.
  - P3: the dialog wording now matches the `owned` basis.
  - P4: the stale `enabled-candidate.ts` comment is fixed.
- Contract text is in `modules/design/app/compose/BACKEND-CONTRACT.md`: the `imports.*` operations in section 1,
  and section 12 for the durable env, the typed-failure path and the linking rules.

Commits on this branch, newest first:

| commit | what |
| --- | --- |
| 807346e | Carry typed Imports failures to the view (P2, plus the contract text for P2 and P3) |
| ad9590e | Match the picker wording to the owned rights basis (P3) |
| b346c7b | Correct the enabled-candidate comment (P4) |
| 3db7504 | Merge the content lane (W3 at 8377551) |
| faaccf5 | Merge the reviewed W1 contract (1fe0c16) |
| 9187046 | Test Imports end to end over the real host and store |
| 279a07b | Run Imports on the durable Design store in the bridged workspace |
| e5b3d0d | Enable Imports in the desktop host with the native picker |
| 5483ee1 | Add optional `hasBlob` to the imports storage port |

### In progress

Only the re-merge of W3's fix round (section 2). Nothing else is half done.

### Not started

- Anything in section 6 below the re-merge.

## 2. Pending: re-merge W3's fix round

The lead said W3 was getting a fix round, including a `workspace.retry` call and a few smaller items, and that they
would say when it landed. That message has not arrived. During the pause one read-only `git fetch` showed the W3
branch tip at `43c987d` ("Retry failed per-project builds and fix review items on W3"). It is not merged here.
Confirm with the lead that 43c987d is the final fix round before merging.

Next steps:

1. Take a CPU reading (`top -bn2 -d1 | grep Cpu | tail -1`). Run no tests at 85% or more.
2. `git fetch origin work/hq-b3-design-content-20261103`, then
   `git merge origin/work/hq-b3-design-content-20261103`. Use a merge, not a rebase.
3. Expect conflicts only in `compose/bridged-workspace.ts` and `compose/BACKEND-CONTRACT.md`.
   - `bridged-workspace.ts`: `importsFor` stays this lane's. Keep W3's caches, contexts, subscriptions and the new
     retry.
   - `BACKEND-CONTRACT.md`: W3 owns the section 3 producer table, and the Imports row reads "after an imports commit
     that carries linked versions is sent, whatever the outcome (section 12)". If W3 added sections after its 11,
     renumber the Imports section after them and update every "section 12" reference. The references are in the
     contract and in the header comments of `imports-storage.ts`, `imports-env.ts`, `imports-content-link.ts` and
     `imports-pick.ts`.
4. Check whether W3's `workspace.retry` and its `designFeedback` actions need an Imports counterpart. Section 12
   already says how a view gets the failure: `designFeedback(classifyDesignError(state.cause, IMPORTS_CONTEXTS.read))`.
   If W3's retry is meant to be called for Imports failures, say so in section 12 and make sure a conflict, unknown
   or unavailable Imports failure maps onto it. A blind retry must never follow an `unknown` outcome.
5. Re-run the checks in section 8 and push with no force.

## 3. Decisions and why

- **Atomic link in the same commit.** Project content is written inside the `import.commit` batch, not by a second
  call. Either everything lands or nothing does, and a crash cannot leave a record without its version. The host
  keeps its single transaction and its caps.
- **Host key split.** The imports roots are readable (`doc.get`, `doc.list`) and writable only by `import.commit`.
  `doc.put` keeps refusing them, so no renderer path can bypass the import journal.
- **Faithful, then typed.** `createImportsBridgeStorage` is a faithful port: it throws bridge errors and the
  importer's `StorageConflictError`. `typeImportsStorage` wraps every method into a typed `DesignOperationError`.
  This keeps the importer's own conflict handling intact and still gives views typed failures.
- **Notify after any sent attempt.** The adapter notifies each linked project after the commit is sent, whatever the
  outcome, as the reviewed W1 contract requires. Nothing is notified if the batch fails before it is sent.
- **Reads are `imports.read`, not `imports.plan`.** The storage layer cannot tell planning reads from other reads.
  `imports.plan` stays reserved for a view that wraps planning.
- **`owned` only.** The dialog says "Only choose files you made. HQ records you as their owner." That is the explicit
  statement behind `rights: { basis: 'owned', holder: 'Owner' }`. The other bases need a UI choice (F5).
- **Stable identity.** One source ID per project (`src-local-png-files`). Item keys are the normalized file names.
  Re-importing identical files is a no-op with no commit. A changed file is an update. An owner-edited record whose
  source changed is a conflict.
- **No transport in `workspace.ts` or `index.ts`.** The workspace finds its transport through a `WeakMap` set in
  `createBridgeWorkspaceDocuments` (`bridgeTransportFor`). That avoided changing public signatures.
- **Project content key without `sectionKey`.** `imports-env.ts` builds the key from `PROJECTS_KEY_ROOT` and
  `contentKey`. An existing guard allows compose to import only `storage/index.ts`, which does not export
  `sectionKey`. The host re-checks every key against its own roots.
- **Controller change is additive.** `ImportsState` gained `cause`. `ImportsPanel.ts` and `imports.css` are
  untouched. The panel already shows `message`, so the full sentence reaches it with no panel change.
- **Duck typing across the module boundary.** The Imports module reads `description` by structure and never imports
  `compose`.
- **Production default tests.** Two tests keep their assertions. The default store (no opt-in) still stays
  disabled, and `main.ts` opts in explicitly. One was retitled, and one new test builds the production host from the
  emitted modules.

## 4. Findings

- Backup and export cannot work over the bridge. The bridge has no route to list blobs or streams. `saveBundle` is
  undefined, the whole-store reads fail as `disabled`, and the draft backup is an empty in-memory bundle that is
  never saved or written.
- The host canonical-bytes cap is 64 MiB and the picker's raw cap is 64 MiB, so a batch can exceed the cap once
  encoded. The adapter fails it as `too-large` (reason `import-total`) before sending anything.
- The compatibility guard (`tools/updater/packaging/compatibility.cjs`) fails on the unmodified base:
  - four unregistered files this lane never touched: `apps/desktop/scripts/build-browser-preview.mjs`,
    `apps/desktop/src/PresentationShell.tsx`, `apps/desktop/src/preview/environment.ts`,
    `apps/desktop/src/preview/mount.tsx`;
  - four drifted registry entries: `sources-catalog`, `design-store-compare`, `service-config`, `renderer-storage`.
  The branch fails identically. This lane adds nothing to either list. `design-host.ts` and `enabled-candidate.ts`
  are roots of `design-store-compare`, which already drifted on the base.
- The storage import-edge scan (`modules/design/app/storage/test/enabled-candidate.test.ts`) walks `apps/`. It fails
  while `apps/desktop/dist-electron` exists, because the emitted host files import the enabled store. Run the storage
  suite before `npm run build:electron`, or with the build output moved away.
- Tests that read `apps/desktop/dist-electron` (eight of them, including the opener-default tests) fail until
  `npm run build:electron` has run. `npm test` runs it first.
- `catalog-host.test.ts` ("preserves K3 partial completeness at 500 entries") has a 5 s timeout that fails when the
  machine is busy. It passed alone, and in the last full run at low load. This lane does not touch `catalog-host`.
- The `social-work.integration` dom tests time out at 5 s when three dom files run in parallel and pass alone.
- The `ImportsPanel.ts` intro sentence says "Bring in design files you have the rights to use". That is inconsistent
  with recording `owned`. It is a panel line, and this lane may not edit the panel.

## 5. Last verified state (at 807346e, before the pause)

All serial, with a CPU reading first and `TMPDIR=/tmp`.

| check | result |
| --- | --- |
| `node --test --test-concurrency=1 modules/design/imports/test/*.test.ts` | 42 pass |
| `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts` | 323 pass |
| `vitest run --config vitest.config.ts` in `modules/design/app` | 20 pass (2 files) |
| `node --test --test-concurrency=1 modules/design/app/storage/test/*.test.ts` (before the emit) | 119 pass |
| `npm run build:electron`, then `vitest run --project node apps/desktop/electron` | 448 pass (50 files) |
| tsc: imports, app, electron, design-host, root, and the four new desktop test files | clean |

Not re-run after the W3 merge: the dom integration tests (`social-work`, `preview-navigation`, `references`). Before
that merge they were 25 of 27 in a parallel run, and 14 of 14 for `social-work` alone.

## 6. What is left, in priority order

1. **Re-merge W3's fix round** (section 2), then re-run the section 8 checks and push. This is the only task owed
   on this lane.
2. **Lead review and PR.** The lead opens the PR. Be ready to answer review comments on the typed-failure path
   (section 12 of the contract) and the atomic link.
3. **Re-run the dom integration tests** (`social-work`, `preview-navigation`, `references`) singly after the merge.
4. **Registry refresh** (packaging owner, not this lane): a reviewed
   `node tools/updater/packaging/compatibility.cjs --refresh-reviewed-registry`. It cannot pass until the four
   unregistered files are registered or explained.
5. **F5 follow-ups** (the Imports view lane, outside this branch):
   - a rights-basis choice before picking, so `licensed`, `permission` and `public-domain` can be recorded;
   - the panel's intro sentence;
   - showing `designFeedback(classifyDesignError(state.cause, IMPORTS_CONTEXTS.read))` as a toast with Retry, Reload
     or Check, and wiring W3's retry.
6. **Real backup and export** (later, needs a host route that lists blobs and streams, then a `saveBundle`). Until
   then the empty draft backup stays and section 12 says so.
7. **Thumbnails over 2 MiB** (later): needs a downscale step. Today those images are imported and linked without a
   thumbnail, because the thumbnail port caps previews at 2 MiB.
8. **`imports.plan`** is reserved and unused. Decide whether a view should wrap planning to emit it.

## 7. Open questions and risks

- Is 43c987d the final W3 fix round, and does it change `contentFor`, `contentEvents` or the retry contract in a way
  that touches the Imports link?
- Empty draft backup over the bridge: the controller reports "Bundle prepared. Saving to disk is unavailable in this
  build." and a `draft-backup` over the durable store is an empty bundle. It is safe (nothing is saved or written) but
  could look like a working backup. Section 12 documents it.
- No thumbnail for images over 2 MiB: the version still imports and links, but Projects and Gallery show no preview.
- `catalog-host` timeout under load and the dom integration timeouts are load-sensitive. Do not read a single
  failure of either as a regression. Re-run the file alone.
- The compatibility guard failing on the base is not caused by this lane, but it blocks any release gate that runs
  it. A reviewed refresh by the packaging owner is the way out.
- `enabled-candidate.ts` and `design-host.ts` are in a registered root. Any further edit there moves the digest of an
  already drifted entry. That does not add a failure, but it will need the refresh.
- Rights: until the F5 choice exists, a file that is licensed rather than made by the owner must not be imported
  through this path. The dialog says so, but nothing enforces it.
- The linked version's capture binding is `imported/<name>` at device pixel ratio 1, bound by the PNG digest. If
  Annotations or Compare ever need real capture receipts for imports, that is a different contract.

## 8. How to verify (for whoever resumes)

Take a CPU reading first and do not run at 85% or more. Run one serial process at a time, with `TMPDIR=/tmp`.

1. `node --test --test-concurrency=1 modules/design/imports/test/*.test.ts`
2. `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts`
3. In `modules/design/app`: `../../../node_modules/.bin/vitest run --config vitest.config.ts`
4. `node --test --test-concurrency=1 modules/design/app/storage/test/*.test.ts` (before step 5)
5. `npm run build:electron`, then `node_modules/.bin/vitest run --project node apps/desktop/electron`
6. `tsc -p` for `modules/design/imports`, `modules/design/app`, `apps/desktop/tsconfig.electron.json` and
   `apps/desktop/tsconfig.design-host.json`, and `tsc --noEmit` at the root. The desktop tests are excluded from
   those configs, so typecheck `design-imports.e2e.test.ts`, `import-pick-wiring.test.ts`,
   `design-host.imports.test.ts` and `design-host.candidate.test.ts` with a scratch tsconfig outside the repo.
7. Move `apps/desktop/dist-electron` out of the worktree when you are done, so step 4 stays clean.

## 9. What exists only outside the branch

- **Uncommitted work:** none. `git status` was clean at the pause.
- **Two build-output copies in `/tmp`**, both gitignored `apps/desktop/dist-electron` output that this lane built and
  moved out of the worktree:
  - `/tmp/b3-dist-electron-artifact` (built before the first W1 merge)
  - `/tmp/b3-dist-electron-artifact-2` (built at 807346e)
  They are disposable: `npm run build:electron` recreates them. The shell hook here blocks `rm -rf`, so a person
  needs to delete them. The worktree has no `dist-electron` now, so the emitted-build tests will fail until it is
  rebuilt.
- **Nothing else.** Scratch tsconfig and drift-check files in `/tmp` were deleted after use. The exact test counts
  above are recorded here, and the commit messages carry the rest of the reasoning.

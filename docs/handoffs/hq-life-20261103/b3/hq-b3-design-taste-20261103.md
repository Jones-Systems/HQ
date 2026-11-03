# Handoff: B3 W4 "correct durable Taste" (paused)

Lane B3 (HQ Design backend), workstream W4. Written when the owner paused the lane on 2026-11-03.
Public repository: this note holds no private data, and every fixture named here is synthetic.

## Where it stands

| Item | State |
| --- | --- |
| 1. Project-qualified Taste subjects (fix for the deferred #168 P2) | Done, lead-reviewed, no P0 to P2 findings |
| 2. Typed Taste errors, classification, minimal inline notice, contract rows | Done, lead-reviewed |
| 3. Real-host durability, compare-and-set and refused-key proof | Done, lead-reviewed |
| W1 contract merge (`work/hq-b3-design-errors-20261103` at 1fe0c16) | Done, merged (not rebased) |
| Lead review round 1 (P3 full journal, two P4 items) | Done and pushed |
| Pull request | Not opened by me. The lead opens it. |
| Anything else | Not started (see "What is left") |

Nothing is uncommitted. The last checks all passed (counts below).

## Branch and head

- Branch: `work/hq-b3-design-taste-20261103` (pushed, never force-pushed)
- Worktree: `~/.t3/worktrees/HQ/work-hq-b3-design-taste-20261103`
- Last code head before this note: `ba821977202ac93d31cfdc3636de067b73ec252a`. This handoff is committed on top as a `WIP: handoff` commit; use the branch tip for the current SHA.
- Commits on the branch, oldest first:
  - `93d1bb7` Qualify Taste version subjects per project and type Taste failures
  - `f89bf4d` Prove the Taste journal through the real design host
  - `554a712` Merge the revised Design failure contract into the Taste branch
  - `ba82197` Report a full Taste journal as too large, not refused

## What was built (by file)

- `modules/design/taste/src/contract.ts`: `qualifySubjectId`, `parseQualifiedSubjectId`, `isSubjectIdentifier`, `projectVersionSubject`. The qualified ID is `pv1:<project length>:<project><version>`, at most 328 characters (plain IDs stay at 160).
- `modules/design/taste/src/events.ts`, `profile.ts`, `service.ts`: `subjectKey(scope, subject)` is the single identity used by rating slots, the supersede precondition and the distinct-subject count.
- `modules/design/taste/src/errors.ts` (new): `TasteUnavailableError`, `TasteJournalFaultError`, `TasteProjectBindingError`, `TasteConflictError`, `TasteReadOnlyError`, `TasteInvalidInputError`, `TasteJournalFullError`. Each sets a stable `name`.
- `modules/design/taste/src/project-service.ts`: project binding and qualification of plain version subjects on write, legacy presentation on read, newer-schema detection, `definitePutFailure`, `MAX_JOURNAL_DOCUMENT_BYTES`.
- `modules/design/app/compose/errors.ts`: the Taste names are mapped in `classifyDesignError`.
- `modules/design/app/compose/taste-failures.ts` (new): `TASTE_OPERATIONS` and `reportTasteFailures`.
- `modules/design/app/compose/views/TasteView.tsx`: a minimal inline notice built from `designFeedback`. No restyle.
- `modules/design/app/compose/BACKEND-CONTRACT.md`: Taste names merged into the section 1 error table (one row per kind), and a new section 2a (operations, rejection table, wording rules, subject identity).
- `modules/design/taste/README.md`, `PROJECT-SERVICE-NOTE.md`: schema and versioning rules, subject identity, legacy journals.
- Tests: `taste/test/{subject-identity,project-service.subjects,project-service.errors}.test.ts`, `taste/test/document-port.ts`, `taste/test/ui/TastePanel.subjects.test.tsx`, `compose/test/{errors,taste-failures}.test.ts`, `compose/test/taste-view.test.tsx`, and `apps/desktop/electron/design-host.taste.test.ts`.

## Decisions and why

**Subject qualification.** Version IDs are unique only inside a project. Deterministic `capture-<digest>` IDs and imported IDs repeat across projects, so general taste merged the ratings of different projects' versions. A version is now rated under a project-qualified subject ID. The length prefix makes the pair unambiguous, so two different (project, version) pairs never share an ID. `TasteSubject.versionId` keeps the plain ID. The bound client qualifies plain version subjects on write and rejects a subject qualified for another project (`project-mismatch`). Rating slots and the distinct-subject count use one function, so they cannot disagree.

**Legacy journals.** Nothing is rewritten, and neither the schema (`hq.design.taste-journal/v1`) nor the record version (`v: 1`) changed. Old entries are interpreted, not migrated:
- Project-scope entries with a plain version ID are attributed to their project and shown under the qualified ID, so the earlier rating is found and can be re-rated.
- General-scope entries with a plain version ID name no project and cannot be attributed. They stay as stored, count as their own subject in general taste, and match no project's version, so they never merge with another project's rating.
- Other subject kinds (reference, component, flow, other) are unchanged because they are shared across projects.

I chose interpretation over rewriting because the journal is hash-chained and append-only, and a rewrite would break the chain and the "never repaired, never rewritten" rule. A build older than qualification reads a journal holding qualified IDs normally, except that an ID over 160 characters makes that build fail closed (read-only, nothing lost).

**Typed put refusals.** A put that rejects with proof that nothing was written now rejects typed: lost compare-and-set (`TasteConflictError`), read-only store (`TasteReadOnlyError` reason `store-read-only`), refused request (`TasteInvalidInputError`), closed store (`TasteUnavailableError`), full journal (`TasteJournalFullError`). Any other rejection is a lost acknowledgement, so the append still resolves `{status: 'fail-closed', reason: 'sync-failed'}` and is reconciled by replaying the same `clientEventId`. This keeps the rule that an unconfirmed write offers Check and never a blind retry. A later `hq.design.taste-journal/vN` schema is read-only on every path (read, save, export) with reason `unsupported-stored-schema`. That is the only reason that triggers the "saved by a newer version of HQ" sentence.

**Full-journal detection.** The store reports `too-large` for an oversized document, but the desktop host answers an oversized `doc.put` with a bare bridge `invalid`, so the renderer cannot see the reason. The client therefore reads a bridge `invalid` as "full" when the document it just sent is over `MAX_JOURNAL_DOCUMENT_BYTES` (2,000,000, the host's `DESIGN_VALUE_CAP`). It only ever sends well-formed documents, so over the cap means size. The host test pins the two numbers together. This is a client-side inference, not a protocol fact (see risks).

**Notice versus panel.** The inline notice reports the definite outcome ("nothing was saved"). The F5-owned `TastePanel` keeps its conservative message and its idempotent Retry. I did not edit the panel, per the lane rules and the lead's review.

## Findings so far

- The original defect (P2 from the #168 review) was real: promoted projects reusing a version ID shared one rating slot and one subject count. It is fixed and covered by node, vitest and real-host tests. A mutation check (neutralising `subjectKey`) failed 6 subject tests.
- The host reports an oversized journal as plain `invalid`, which would have shown a full journal as "Refused". Fixed by the size inference above. A mutation check (disabling it) failed the real-host test and the port-level test.
- The lead's review at `554a712` found no P0 to P2. It found one P3 (full journal read as "Refused"), fixed in `ba82197`, and two P4 items (merge Taste rows into the existing kind rows, and a sentence about the conservative panel), both fixed.
- The W1 contract changed after my first push. The merge fallout was small: `write` is now required on `DesignFailureContext`, so `taste.load` and `taste.export` pass `write: false`, and wording, toast id and status assertions changed.

## Checks (last run, all passing)

CPU was under 85% before each run. One serial process, `TMPDIR=/tmp`, `umask 0022`.

| Command | Result |
| --- | --- |
| `node --test --test-concurrency=1 'modules/design/taste/test/*.test.ts'` | 72 pass |
| `node_modules/.bin/vitest run --config modules/design/taste/vitest.config.ts` | 14 pass |
| `node --test --test-concurrency=1 'modules/design/app/compose/test/*.test.ts'` | 243 pass |
| `node_modules/.bin/vitest run --config modules/design/app/vitest.config.ts` | 13 pass |
| `node_modules/.bin/vitest run apps/desktop/electron/design-host.taste.test.ts` | 10 pass |
| `node --test --test-concurrency=1 'modules/design/preview/test/*.test.ts'` | 9 pass (last run at `554a712`) |
| `tsc -p` for taste, app, preview, `apps/desktop/tsconfig.electron.json`, `tsconfig.design-host.json` | no errors |
| root `tsc --noEmit` | no errors (last run at `554a712`) |

Not run: `design-host.test.ts` and `candidate.test.ts` (one needs `dist-electron`). Preview tests and root `tsc --noEmit` were not re-run after `ba82197`, which touched no preview files.

Disclosed lapse: I ran two test runs early on (the initial baseline and one compose run) while CPU was at or above 85%. I wrote a gate script afterwards and used it for every later run.

## What is left, in priority order

1. **Open the pull request (lead).** Base is `main`; W1 is already merged in at 1fe0c16. If `work/hq-b3-design-errors-20261103` moves again, merge it into this branch (merge, not rebase) and fix fallout in `compose/errors.ts`, `taste-failures.ts`, the host test constants and the wording assertions.
2. **Run the two skipped suites** on a machine where `dist-electron` is built: `design-host.test.ts` and `candidate.test.ts`. Also re-run the preview node tests and root `tsc --noEmit` at the final head.
3. **Ask the F5 owner about `TastePanel` wording.** After a typed rejection the panel still says the save "may or may not have reached the journal". Options: let the panel show the definite outcome when it is given one, or have `TasteView` hide the panel's own message when a typed notice is showing. Today both appear, which is safe but redundant.
4. **Ask the host owner for a size reason on the bridge.** Add a reason (for example `too-large`) to `DESIGN_BRIDGE_REASONS` and have `design-host.ts` return it. Then delete the size inference in `definitePutFailure`. `design-host.ts` and `bridge-documents.ts` were outside my allowed files.
5. **Decide what to do about the single-document journal** (see risks): shard, compact or archive, or warn before it is full.
6. **Optional: a typed read-only for record `v` above 1.** Today a record with `v > 1` fails the journal closed as `invalid-record`. A typed read-only would match the schema-level rule.

## Open questions and risks

- **Legacy general-scope entries.** They cannot be claimed by a project, and re-rating the same version counts as a second subject. This is correct (nothing records the origin) but may surprise the owner. Question for the owner: is an explicit "claim this old rating for project X" action wanted, and if so it must append a new event, never rewrite?
- **One document, 2,000,000 bytes.** The whole journal is one workspace document. A full journal stops all saving until something is done, and exports still work. Notes of 4,000 characters reach the cap after roughly 450 records, and ratings take far longer, but there is no compaction or rotation. Each save also rewrites the whole document.
- **Full-journal detection is an inference.** If the host cap changes, if the host starts refusing a well-formed document as invalid for another reason, or if the cap measure differs from the host's, the notice could be wrong in either direction. The host test pins the constant to `DESIGN_VALUE_CAP`, but a cap change in the host without the test running would drift.
- **Conservative panel wording** (item 3 above): redundant messaging, not a correctness problem. Retry is idempotent.
- **Notes and counterevidence** carry their `subjectId` as passed; they are not qualified.
- **`reportTasteFailures` only reports rejections.** Resolved `rejected` and `fail-closed` results stay with the panel.
- **Replay of a pre-upgrade unacknowledged plain-subject command** would resolve `conflict`, because the stored payload would now differ. This is practically unreachable.

## Only in this thread, or outside the repository

- Nothing is uncommitted, and no work exists only in the thread.
- Scratch helpers lived in `/tmp` and are not in the repository. If you need them again: a CPU gate (sample with `top -bn2 -d1 | grep Cpu | tail -1`, run tests only when under 85% busy) and an ad hoc `tsconfig` that extends `apps/desktop/tsconfig.electron.json` and adds `apps/desktop/electron/design-host.taste.test.ts` so the real-host test is typechecked.
- Working rules from the brief that still apply to this branch: no private data in the public repo, synthetic fixtures only, no force-push, literal paths in git commands, commit messages written to a file and passed with `git commit -F`, tests serial under `TMPDIR=/tmp` and `umask 0022`, and no edits to `compose/bridged-workspace.ts` caching, the Imports files, `design-host.ts`, `main.ts`, `taste/src/ui/` or `taste/design-module.ts`.

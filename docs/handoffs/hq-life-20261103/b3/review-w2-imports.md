# Independent review of W2 (Imports), paused

The lead copied this verbatim from the reviewer's reply at the owner pause. The reviewer was review-only and has no branch.

- **Delegated task:** "B3 W2 independent review", a child of the B3 lead thread, run on Claude Sonnet 5.5 at effort xhigh.
- **Reviewed:** `807346e` on `work/hq-b3-design-imports-20261103`, against W3 at `8377551`.
- **Brief:** [`drafts/review-brief-w2-imports.md`](drafts/review-brief-w2-imports.md).
- **Worktree:** `~/.t3/worktrees/HQ/t3-5e8b453b`, detached at `807346e`.
- **State:** incomplete, from code reading only, with no test runs. The lead has not triaged these findings yet. W2 still has to merge W3's fix round, so re-check each line reference against the new head.

---

# Handoff: W2 Imports review, paused

**Head reviewed:** `807346e6e6e66540a2da465390da9b59d3aae3a2` on `work/hq-b3-design-imports-20261103`. The diff base was `8377551d71a48a3d2b12661e0a60b317977c2630`.

The review is incomplete. Everything below comes from reading code, and I ran no tests. I made no commits, pushes or tracked-file edits. The worktree is now on a detached HEAD at 807346e. It was on `t3/5e8b453b` at W1 `1fe0c16`.

## Covered (code read only)

- **Host:** `design-host.ts`, `design-host-production.ts`, `import-pick-wiring.ts`, the `main.ts` wiring and `import-picker.ts`.
- **Renderer adapters:** `imports-storage.ts`, `imports-content-link.ts`, `imports-pick.ts`, `imports-env.ts`, plus the `bridged-workspace.ts` and `bridge-documents.ts` diffs.
- **Imports section:** the `controller.ts`, `contract.ts` and `importer.ts` diffs.
- **Supporting code:** `errors.ts` (classifier), `content-events.ts`, `repository.ts`, `storage/transactions.ts`, `storage/enabled-candidate.ts`, `storage/node.ts`, and the §12 docs diff.
- **Governance:** the `ac.import-export-enablement.001` text and `task.import-export-qualification.001`.

## Not covered

- **Tests:** none of the test files, including the `design-host.candidate.test.ts`, `selection.test.ts`, `imports-storage.test.ts` and `imports-env.test.ts` assertion changes. I can't say whether those changes are justified or whether the e2e proves its claims.
- **`main.ts` close handlers:** I did not check whether the main window's `close` event can be prevented. If it can, the pick would settle as canceled while the window and native dialog stay open.
- **`bridgeResultValue`:** I did not read its mapping, so I can't confirm that a host `unavailable` on `import.commit` is classified as definite no-effect rather than unknown.
- **`design-export.ts`:** I did not confirm that `exportBundle` reports `disabled` when the store opens with `imports: 'enabled'`. The production-host comment claims it does.
- **Other unread code:**
  - `ImportsPanel.ts`
  - the `DEFAULT_LIMITS.maxThumbnailBytes` value and its boundary
  - the design-store `documentKey` rules (`.` or empty segments, normalization)
  - the T8 task `task.import-export-enablement.001`
- **Public-repo safety:** scanned only in the parts I read.

## Findings so far

None is a P0–P2, and none is confirmed by running anything.

**1. P3 — `design-host.ts:75` (cap asymmetry), against `:91` and `:154`**
- **Defect:** `import.commit` does not enforce the per-document `DESIGN_VALUE_CAP` (2,000,000 bytes). `doc.put` does, and `doc.get` refuses to return a larger document.
- **Scenario:** each import's content link appends views and versions to one project content document. If that document passes 2 MB, `doc.get` answers `unavailable` and the project cannot be read, while `import.commit` kept accepting it. My rough estimate is about 1 KB per version, so a few thousand images; I have not measured this.
- **Fix:** check the per-document cap in `validImportOps`, and have the content link refuse to grow a document past the cap.
- **Status:** not finished verifying; the sizing is an estimate.

**2. P3 — `imports-content-link.ts:80-83`**
- **Defect:** `plan` refuses the batch whenever the project's content is unsupported or invalid, even when the batch needs no content write.
- **Scenario:** a project with newer-schema content. The owner edits an imported record's title or notes, or undoes an `updated` import, and the commit throws `ReadOnlyContentError`. The edit batch contains only record puts, and every version is already linked, so it never needed the content document.
- **Fix:** load and refuse only when a version actually has to be added. Otherwise skip the content operation.
- **Status:** read from code; not run.

**3. P3 — `design-host.ts:49`, with `:136-138` and `:191-194`**
- **Defect:** `event.append` accepts the `design/imports` stream, so imports state can be appended to outside `import.commit`. The code is unchanged from the base, but it matters once imports are enabled and §12 says imports "change only through `import.commit`".
- **Scenario:** a renderer calls `event.append {stream:'design/imports', payload:{…}}`. This adds events outside the commit, and a stale `expectedSeq` then makes the owner's next import fail with a conflict. The importer only counts events (`importer.ts:258`), so impact is limited.
- **Fix:** refuse `event.append` to `design/imports`. Keep `event.read`. Or document the exception in §12.
- **Status:** read from code; whether the base tests pin this is unchecked.

**4. P4 — `design-host.ts:75`**
- **Defect:** `import.commit` accepts any `DOCUMENT_ROOTS` key, but the stated intent is imports roots plus `design/projects/` only. The base already had this.
- **Scenario:** a batch atomically writes `design/requests/…`, `design/connector/outbox/…` or `design/flows/…`. That is no more authority than `doc.put` has, but it also skips the doc.put value cap.
- **Fix:** allow only `design/projects/` and the imports roots in commit puts.

**5. P4 — `design-host.ts:157-159`**
- **Defect:** `import.pick` runs before the store is opened or checked as accepting imports. Any renderer call opens the native dialog on the main window.
- **Scenario:** the store fails to open or is not accepted, the owner chooses files, and the later commit fails.
- **Fix:** check `getStore()` and `status.accepted` before showing the dialog.

**6. P4 — `imports-content-link.ts:82-83`, and `errors.ts` (`ReadOnlyContentError` branch)**
- **Defect:** damaged content (`status: 'invalid'`) throws `ReadOnlyContentError`, which classifies as `read-only`. `bridged-workspace.ts` `unusableContent` classifies the same state as `corrupt`.
- **Scenario:** a link into damaged content tells the owner "open read-only, nothing changed" instead of "damaged".
- **Fix:** map the `invalid` status to a corrupt failure in the link.

**7. P4 — `BACKEND-CONTRACT.md` §12, "Unknown outcome"**
- **Defect:** §12 says "Views offer `Check`". The `ImportsView.tsx` diff never reads `state.cause` or calls `designFeedback`.
- **Scenario:** a lost reply shows the sentence "Check before trying again" with no Check control. A retry re-plans and is a no-op, so harm is limited.
- **Status:** not verified; I did not read `ImportsPanel.ts`.

**8. P4 — `design-host.ts:207` (maps code `conflict` to a no-effect `conflict`), against `transactions.ts:149`, `:152`, `:219` and `:262`**
- **Defect:** a `conflict` raised by `replay()` after `commitPuts` has landed is reported as a no-effect `conflict`.
- **Scenario:** retrying a batch whose earlier attempt left a committed intent with a diverged event suffix. The documents landed, but the owner sees "nothing was written".
- **Status:** the engine is pre-existing and the trigger is rare. Not verified.

## Governance answer

I am not judging whether the predicate is satisfied.

- **Predicate:** `ac.import-export-enablement.001` gates import and export together. It requires the crash, CAS and privacy suites to pass at one exact head, with T1 accepting that evidence for that head.
- **Scope:** W2 enables imports only, so it is a strict subset of what the predicate gates. It is not the "one-constant commit" the spec describes for T8 (spec lines 884 and 1033). It adds a production host, the picker and wiring, the content link, new readable key roots, and a commit path that carries project content.
- **Qualification head:** the qualification task targets a `work/hq-foundation` head after K1, r3 and CL1b land. Evidence bound to an earlier head does not cover the code W2 adds. I did not read the T8 task.
- **Newly reachable once `status.accepted` is true:**
  - `import.commit`, an atomic batch within the allowed roots.
  - `import.repair`, which mutates storage by quarantining a torn tail and replaying the intent. Any renderer request with a 64-hex `txnId` can call it, and `storage.diagnostics` lists pending and blocked `txnId`s.
  - `storage.diagnostics`, which exposes blocked intent keys, streams and reasons, orphan blob counts and sizes, and directory-fsync health.
  - `import.status`.
  - Startup `recover()` replay on a real profile, since the store now opens in enabled mode.
  - `event.append` to the `design/imports` stream (finding 3).
- **Not confirmed:** that export reports `disabled` in the enabled store (`design-export.ts` not read).

## Verified OK (by reading, not running)

- **Document keys:**
  - `doc.put` cannot write `design/imports/...`. Its `DOCUMENT_ROOTS` has no such root, and the bare roots and empty suffixes are refused as document keys.
  - `doc.get` and `doc.list` read the five roots. The `design/imports/` listing root is accepted only as an exact prefix.
  - All keys reject `..` segments, control characters, lone surrogates, untrimmed values and anything over 256 characters.
  - Commit puts still require `expectedRevision`, and commit events still require `expectedSeq`.
- **Notify-after-sent:** planning errors, the read-only refusal and the size-cap refusal all throw before the `try/finally` in `imports-storage.ts:200-219`, so nothing is notified for an unsent batch. A transport failure during the send becomes `DesignBridgeError('unknown')`.
- **Content-link CAS:**
  - `expectedRevision` is `loaded.revision`, a decimal string or null, matching the wire check.
  - The engine compares it at commit (`transactions.ts:232`). A concurrent Projects edit then surfaces as a typed `conflict`.
  - `repository.load` reads fresh each time.
- **Append-only and idempotent:**
  - A version already in content is skipped, and `assertAppendOnly` is applied.
  - Tombstoned records are skipped.
  - A conflict's incoming version is linked only once the owner takes it.
- **Source identity:**
  - Record IDs hash `{projectId, sourceId, itemKey}`.
  - Names are NFC-normalized and trimmed, and duplicates are rejected after normalization.
  - Update versus conflict follows the importer's `writtenDigest` check (`importer.ts:336-339`).
- **Picker:**
  - Paths come only from the native dialog.
  - Opening uses `O_NOFOLLOW`, `O_NONBLOCK` and a descriptor `fstat`, plus an EOF probe and size caps.
  - Symlinked intermediate directories are followed, which is the user-chosen path.
- **Wiring:**
  - One dialog at a time, and late answers are dropped.
  - Listeners are removed when the pick settles.
  - I found no unhandled-rejection path.
  - The production host calls `cancelPending()` before `host.close()`, within the same tick.
- **Typed failures:** `cause` is set in `fail` and cleared when `message` is replaced without a cause. `describeFailure` does not double the trailing period.

## Commands run

- `top -bn2 -d1 | grep Cpu | tail -1` gave 13.3 us, 7.7 sy and 78.3 id, about 22% busy.
- `git fetch origin work/hq-b3-design-imports-20261103 work/hq-b3-design-content-20261103` and `git checkout --detach 807346e6…` both succeeded.
- Read-only `git diff` and `git log`.
- No tests, `npm ci` or build were run, so none of the suites in the brief has a result.

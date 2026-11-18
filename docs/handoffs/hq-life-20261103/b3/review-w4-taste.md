# Independent review of W4 (Taste), paused

The lead copied this verbatim from the reviewer's reply at the owner pause. The reviewer was review-only and has no branch.

- **Delegated task:** "B3 W4 independent review", a child of the B3 lead thread, run on Claude Sonnet 5.5 at effort xhigh.
- **Reviewed:** `ba82197` on `work/hq-b3-design-taste-20261103`, against W1 at `1fe0c16`.
- **Brief:** [`drafts/review-brief-w4-taste.md`](drafts/review-brief-w4-taste.md).
- **Worktree:** `~/.t3/worktrees/HQ/t3-b03983a0`, detached at `ba82197`. It holds an untracked `node_modules` from `npm ci`.
- **State:** incomplete, from code reading only, with no test runs. The lead has not triaged these findings yet. Read `TastePanel` first: findings 1–3 depend on it.

---

# Handoff: W4 review paused, no confirmed defects, several unverified leads

## Head reviewed
- Head: `ba821977202ac93d31cfdc3636de067b73ec252a` on `work/hq-b3-design-taste-20261103`, checked out detached in my worktree.
- Base: `1fe0c166a34a235eef8e2df318ee9ad4f3b60566`.
- I edited no tracked files and did not commit or push.
- `.agents/shared-guidance.md` is absent in this checkout, so shared enrollment is unavailable. I followed the local `AGENTS.md` only.

## What I covered
- **Taste source diff, read in full:** `contract.ts`, `errors.ts`, `events.ts`, `profile.ts`, `project-service.ts`, `service.ts`, and the `index.ts`/`main.ts` exports.
- **Compose source diff, read in full:** `compose/errors.ts` hunks, `taste-failures.ts` and `TasteView.tsx`.
- **Put-failure path, followed end to end:** the `doc.put` path in `design-host.ts` (validation, cap check, error mapping), `bridge-documents.ts`, and `putDocument`/`assertWritable`/`checkItemSize` in `packages/design-store/src/generation-store.ts`.
- **Real-host test:** `apps/desktop/electron/design-host.taste.test.ts`, read in full.

## What I did not get to
- **Tests:** none of the other new or changed tests. That covers `taste/test/*` (including `subject-identity`, `project-service.subjects`, `project-service.errors`, `TastePanel.subjects`) and `compose/test/*` (`errors`, `taste-failures`, `taste-view`). I did not diff them against the base for weakened assertions, so there is no tautology check.
- **Docs:** `BACKEND-CONTRACT.md` §1/§2a, the Taste README and `PROJECT-SERVICE-NOTE.md`. I did not compare them to the code, and I did not check the feedback ids and wording against §1.
- **`TastePanel` and its view-model:** I did not read them. This is the main gap behind findings 1–3.
- **Surrounding `classifyDesignError` code:** I read only the changed hunks, not the `named()` helper or the branches before them. I could not check precedence against an earlier `TypeError` or `instanceof` branch.
- **Older build reading qualified IDs:** I did not read `journal.ts`'s handling of an unparsable event.
- **Public-repo safety scan:** not done. The host test I read contains nothing private.

## Findings so far
None is confirmed as P0–P2. Line numbers are approximate, taken from diff hunk offsets. Everything below is from reading code; I ran no tests.

1. **P2 if confirmed, otherwise P3 (unverified): recovery actions remount the panel.**
   - **Where:** `compose/views/TasteView.tsx`, `recover()` (~l.65) and `<Fragment key={reads}>` (~l.80).
   - **Defect:** `retry`, `reload` and `check` bump `reads`, which remounts `TastePanel`.
   - **Scenario:** a save fails with a lost acknowledgement (`unknown`). The user clicks the notice's Retry. If the panel keeps its draft input or pending command (the `clientEventId` used for idempotent replay) in local state, that state is discarded. A re-entered note then gets a new event ID, so a write that did land is duplicated. A rating would be caught by `already-rated`. This contradicts the comment that "the panel keeps … the user's input".
   - **Fix:** for save failures, don't remount. Let the panel's own retry handle it, or lift the draft and pending command out of the remounted subtree.
   - **To confirm:** read `TastePanel` and its tests.

2. **P3 (plausible, not exercised): stale notices after the version changes.**
   - **Where:** `TasteView.tsx`, the `<select onChange>` (~l.71).
   - **Defect:** changing the version only calls `setSelection`. It does not clear `notices`.
   - **Scenario:** a save to version 1 fails with a `conflict` notice. The user picks version 2. The notice stays visible, with its Reload action, until a later `save` succeeds. A `load` notice clears on the next successful load.
   - **Fix:** clear `notices` when the selected version changes, or key them by subject.

3. **P3 (unverified): notes and counterevidence are not qualified or presented the way assessments are.**
   - **Where:** `project-service.ts`, `bindSubjects` (~l.100–120) and `present` (~l.210).
   - **Defect:** `bindSubjects` never qualifies a plain `subjectId` on `note.added` or `counterevidence.added`. It only rejects another project's qualified ID. `present` maps assessments and examples but not notes.
   - **Scenario:** a legacy project-scope note with plain `subjectId: "v1"` does not match the now-qualified subject `pv1:…`. If the panel or view-model matches notes by `subjectId === subject.id`, the legacy note disappears from that version's panel. A plain `subjectId` written by a non-UI caller does the same.
   - **Fix:** present legacy project-scope note subject IDs qualified, or match by `subjectKey`.
   - **To confirm:** how `TastePanel` and its view-model filter notes.

4. **P4: a plain ID that looks qualified is read as qualified, regardless of kind.**
   - **Where:** `project-service.ts`, `bindSubjects` (~l.110–112); `contract.ts` `parseQualifiedSubjectId`; `events.ts` `subjectKey`.
   - **Defect:** any ID matching `pv1:<n>:<n chars><rest>` is treated as already qualified.
   - **Scenario 1:** project "a" has a plain version ID `pv1:1:ab` (a legacy or direct-API ID). It is stored as is, and now collides with version `b` of project "a".
   - **Scenario 2:** a client bound to project "x" is refused with `project-mismatch` for a plain version, or for a `reference`, whose ID is `pv1:1:ab`.
   - **Scope:** the UI path is safe. `projectVersionSubject("a", "pv1:1:ab")` gives `pv1:1:apv1:1:ab`, which parses correctly.
   - **Fix:** only treat an ID as qualified when the caller says so, or reject plain version IDs that parse as qualified.

5. **P4 (unverified): a late rejection from a replaced client can set a notice after the reset.**
   - **Where:** `TasteView.tsx`, the `useMemo` reporter and the `selection.client !== client` branch.
   - **Defect:** the reporter closes over `setNotices` but not over which client it belongs to.
   - **Scenario:** a save on the old client is still in flight when the adapter is replaced. The reset clears the notices, then the old rejection arrives and shows a stale notice.
   - **Fix:** drop reports whose wrapper is no longer the current one.

6. **P4 (unverified): an older build may mark the journal faulted when it meets a long qualified ID.**
   - **Where:** `contract.ts` / `events.ts`, `parseSubject`.
   - **Defect:** an older build validates `subject.id` with `isIdentifier`, which allows at most 160 characters. A qualified ID can be up to 328.
   - **Scenario:** a project ID and version ID totalling more than about 150 characters produce a qualified ID that older code rejects. Whether that marks the whole journal fail-closed depends on `journal.ts`, which I did not read.
   - **Fix:** document the downgrade limit, or cap `qualifySubjectId` output at the old limit.

## Verified OK, from code reading only
- **Qualified-ID parsing:**
  - The ID format is injective. The length is 1–3 digits with no leading zero, then a colon, so the parse is deterministic. A `:` inside a project or version ID cannot shift the split.
  - `MAX_QUALIFIED_SUBJECT_ID_LENGTH` (328) equals the true maximum, 4 + 3 + 1 + 160 + 160. The 1–3 digit range covers `MAX_ID_LENGTH` 160.
  - `qualifySubjectId` and `parseQualifiedSubjectId` round-trip, and the length arithmetic is consistent.
- **Legacy ratings:**
  - A legacy project-scope plain version rating is found and re-rated. `present` shows it qualified and `subjectKey` maps both forms to the same slot, so the supersede chain works. No path rewrites stored bytes.
  - Legacy general-scope plain IDs keep their plain key, so they never merge with a qualified one.
- **Use of `subjectKey`:** `currentAssessment` (the supersede precondition), `buildProfile` (the distinct-subject count) and slot comparison all go through it.
- **Event types:** `assessment.recorded` and `example.imported` are qualified on write. `note.added` and `counterevidence.added` are checked for a foreign project. `project-contribution.set` is bound by `allowsEvent`. Note and counterevidence qualification is the open question in finding 3.
- **Typed put failures are definite no-effect against the real host.**
  - Every typed host refusal for `doc.put` (`conflict`, `read-only`, `closed`, `invalid-argument`, `too-large`, and the pre-store `invalid`) comes from `checkExpected`, `assertWritable`, `assertOpen`, `checkItemSize` or host validation. All of these run before `writeAtomic`.
  - After `writeAtomic` the store does nothing that can throw, because `recordCacheWrite` is a no-op for non-evictable namespaces.
  - A transport rejection or a malformed reply becomes `DesignBridgeError('unknown')`, and the bridge validates a `doc.put` reply with kind `'unknown'`. Neither is typed, so both still resolve as `fail-closed` / `sync-failed`.
  - The bridge does not retry.
- **Full-journal size rule:** the host measures `Buffer.byteLength(JSON.stringify(value)) > 2_000_000` on `{schema, jsonl}`. The client measures `TextEncoder.encode(JSON.stringify(document)).byteLength > MAX_JOURNAL_DOCUMENT_BYTES`. These are the same string and the same cap. The host test pins `MAX_JOURNAL_DOCUMENT_BYTES === DESIGN_VALUE_CAP`. I saw `maxItemBytes` set only on the `cache` namespace, so I found no smaller workspace cap.
- **Newer schema:** `isNewerSchema` runs before envelope validation in `DocumentJournal.read`, and `run()` rethrows `TasteReadOnlyError`. So snapshot, submit and export all throw `TasteReadOnlyError`.
- **Export of a faulted journal:** it throws `TasteJournalFaultError`. Classification is by exact name, so the subclass relationship to `TasteUnavailableError` does not change the result.
- **TasteView hook order:** `useState` ×3 and `useMemo` all precede the early returns, so the hook order is fine.
- **Host test:** the cases I read look meaningful. The oversized case pads at the port, so a small journal is correctly reported as invalid rather than full.
- **Gap in that test:** it does not exercise a put-time `unavailable` through the host. I did not check whether `project-service.errors.test.ts` covers it.

## Tests run
- **None.** I ran no test, vitest or `tsc` command.
- **Setup only:**
  - `top -bn2 -d1 | grep Cpu | tail -1` showed 21.3% user and 70.6% idle.
  - `ELECTRON_SKIP_BINARY_DOWNLOAD=1 TMPDIR=/tmp npm ci --no-audit --no-fund` exited 0 (162 packages), with its log at `/tmp/b3w4-npmci.log`.
  - This created an untracked `node_modules` in the worktree.

To resume, read `TastePanel` and its view-model first, since findings 1, 2 and 3 all depend on it. Then compare the docs against the code, read the remaining tests, and run the listed commands serially under `TMPDIR=/tmp`.

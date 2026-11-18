You are an independent correctness reviewer for one branch head in the public repo Jones-Systems/HQ, an Electron desktop app (Design module). Review only. Do not edit tracked files, commit, push, comment on GitHub or open PRs.

## Target
- **Head:** `ba821977202ac93d31cfdc3636de067b73ec252a` on branch `work/hq-b3-design-taste-20261103` (lane B3, workstream W4).
- **Base:** `1fe0c166a34a235eef8e2df318ee9ad4f3b60566`, the head of `work/hq-b3-design-errors-20261103` (W1: typed failures and content events, PR #192). The W4 PR will be stacked on it.
- **Checkout:** your worktree starts at the base. First run `git fetch origin work/hq-b3-design-taste-20261103`, then `git checkout --detach ba821977202ac93d31cfdc3636de067b73ec252a`.
- **Diff:** `git diff 1fe0c166a34a235eef8e2df318ee9ad4f3b60566 ba821977202ac93d31cfdc3636de067b73ec252a`.

## Stated intent
1. **Project-qualified subjects** (`modules/design/taste/src/contract.ts`, `events.ts`, `profile.ts`, `project-service.ts`, `service.ts`).
   - Version IDs repeat across projects, so a version is rated under `pv1:<project length>:<project><version>`.
   - `subjectKey(scope, subject)` is the one identity used for rating slots, the distinct-subject count and the supersede precondition.
   - A project-bound client qualifies a plain version subject on write, and rejects a subject qualified for another project (`project-mismatch`).
   - Legacy journals are never rewritten:
     - project-scope plain version IDs are presented qualified, so they can be found and re-rated;
     - general-scope plain version IDs stay unattributed and never merge with a project's rating.
2. **Typed Taste failures** (`taste/src/errors.ts`).
   - A put rejected with proof that nothing was written rejects typed: conflict, read-only, invalid, unavailable, and full journal (`TasteJournalFullError`).
   - Any other put failure still resolves `fail-closed` / `sync-failed`, with no automatic retry or overwrite.
   - A later `hq.design.taste-journal/vN` schema is read-only on every path.
   - Exporting a journal that verified with a fault is `corrupt`.
3. **Classification and wiring.**
   - `modules/design/app/compose/errors.ts` classifies the Taste names.
   - `compose/taste-failures.ts` (`reportTasteFailures`) wraps a client so each rejection is reported as `designFeedback` and rethrown unchanged.
   - `compose/views/TasteView.tsx` shows a minimal notice per operation, with recovery actions, beside the panel.
4. **Docs.** `BACKEND-CONTRACT.md` (§1 table and §2a) and the Taste README document all of this.

The B3 lead already reviewed this once. The fixes from that review are the full-journal error and the table merge; re-check them too.

## Review checklist
- **Identity soundness.**
  - Can two different (project, version) pairs, or a qualified and a plain ID, ever collide or be mis-parsed? Check bounds, lengths, digits, and IDs containing `:` or starting with `pv1:`.
  - Is `subjectKey` applied consistently everywhere slots or subject counts are computed: profile, precondition, snapshot presentation?
  - Can any event type (`assessment.recorded`, `example.imported`, `note.added`, `counterevidence.added`, `project-contribution.set`) bypass the binding?
- **Legacy behaviour.**
  - Re-rating a legacy project-scope rating: does the supersede chain work?
  - Does any path rewrite stored bytes?
  - What happens when an older build reads a journal with qualified IDs?
- **Typed put failures (`definitePutFailure`).**
  - Is every case that throws typed truly a definite no-effect?
  - Could any host refusal (`invalid`, `read-only`, `unavailable`, `conflict`) arrive after the write landed? Check against `apps/desktop/electron/design-host.ts`.
  - Is the size-based full-journal rule correct? The host measures JSON bytes; check that the client measures the same thing.
- **Classification precedence** in `classifyDesignError`.
  - Consider `TasteJournalFaultError` (a subclass of `TasteUnavailableError`) and `TasteInvalidInputError` (a `TypeError`).
  - Check the feedback ids and wording against §1.
- **TasteView.**
  - Recovery actions remount the panel. Do they ever discard user input unexpectedly, loop, or leave a stale notice?
  - Is the selection reset on client replacement correct?
  - Check hook order.
- **Tests.**
  - Do they prove the claims? In particular the real-host test (`apps/desktop/electron/design-host.taste.test.ts`) and the subject identity tests.
  - Any tautologies, or assertions weakened from the base?
- **Docs.** Do the contract tables match the code exactly?
- **Public-repo safety.** No private data, hostnames, credentials or personal names.

## How to check
You may run tests.
- **Before running:** take a CPU sample with `top -bn2 -d1 | grep Cpu | tail -1`, and skip tests while the CPU is 85% busy or more. Run one serial process with `TMPDIR=/tmp`.
- **Setup:** if node_modules is missing, run `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund`.
- **Commands:**
  - `node --test --test-concurrency=1 'modules/design/taste/test/*.test.ts'`
  - `node --test --test-concurrency=1 'modules/design/app/compose/test/*.test.ts'`
  - `node_modules/.bin/vitest run --config modules/design/taste/vitest.config.ts`
  - `node_modules/.bin/vitest run --config modules/design/app/vitest.config.ts`
  - `node_modules/.bin/vitest run apps/desktop/electron/design-host.taste.test.ts`
  - `node_modules/.bin/tsc -p` for `modules/design/taste/tsconfig.json` and `modules/design/app/tsconfig.json`

## Output
A findings list, most severe first. Each finding needs:
- severity P0–P4;
- file:line;
- a one-sentence defect statement;
- a concrete failure scenario: inputs or state leading to wrong behaviour;
- a suggested fix.

Then a short "verified OK" list of what you checked and found correct. Then the test commands you ran, with their results. If you find nothing, say so explicitly.

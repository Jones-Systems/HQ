You are an independent correctness and security reviewer for one branch head in the public repo Jones-Systems/HQ, an Electron desktop app (Design module). Review only. Do not edit tracked files, commit, push, comment on GitHub or open PRs.

## Target
- **Head:** `807346e6e6e66540a2da465390da9b59d3aae3a2` on branch `work/hq-b3-design-imports-20261103` (lane B3, workstream W2).
- **Base:** `8377551d71a48a3d2b12661e0a60b317977c2630`, the head of `work/hq-b3-design-content-20261103` (W3: content freshness). The W2 PR will be stacked on W3, which is stacked on W1 (`1fe0c166a34a235eef8e2df318ee9ad4f3b60566`, typed failures, PR #192).
- **Checkout:** your worktree starts at W1. First run `git fetch origin work/hq-b3-design-imports-20261103 work/hq-b3-design-content-20261103`, then `git checkout --detach 807346e6e6e66540a2da465390da9b59d3aae3a2`.
- **Diff to review:** `git diff 8377551d71a48a3d2b12661e0a60b317977c2630 807346e6e6e66540a2da465390da9b59d3aae3a2`. This is W2's work plus its merge of W3. W2's own commits are `git log --first-parent 1fe0c166a34a235eef8e2df318ee9ad4f3b60566..807346e6e6e66540a2da465390da9b59d3aae3a2`.

## Stated intent
W2 makes Design Imports work end to end against the real local store, and enables it in the application.

1. **Host** (`apps/desktop/electron/design-host.ts`).
   - `design/imports/{records,versions,manifests,conflicts,undo}/` are readable through `doc.get` and `doc.list`.
   - `doc.put` refuses them; they change only through the atomic `import.commit`.
   - `import.commit` may also carry project content documents (`design/projects/...`) in the same batch.
2. **Production host.**
   - `design-host-production.ts` opens the enabled store (`imports: 'enabled'`) with the native picker injected. Export stays disabled.
   - Closing settles a pending pick as canceled before the store closes.
   - `main.ts` uses it.
   - `import-pick-wiring.ts`:
     - one dialog at a time;
     - the dialog is bound to the main window and settles as canceled when the window closes;
     - late dialog answers are ignored;
     - the dialog wording is the owner's rights statement.
3. **Renderer adapters** (`modules/design/app/compose/`).
   - `imports-storage.ts` maps the importer's `StoragePort` to the bridge. It is faithful first, and a typed wrapper then makes every rejection a `DesignOperationError`.
   - `imports-pick.ts` makes picked PNGs a stable `hq.files` source with rights basis `owned`.
   - `imports-content-link.ts` links imported PNG versions into project content inside the same atomic commit. The link is append-only and idempotent, and it notifies content events after any sent attempt.
   - `imports-env.ts` and `bridged-workspace.ts` give the bridged workspace a durable `importsFor`.
4. **Imports section.**
   - `imports/src/contract.ts` and `importer.ts` add an optional `hasBlob`.
   - `imports/src/controller.ts` keeps the rejection as `cause` and makes `message` the full sentence.
5. **Docs.** `BACKEND-CONTRACT.md` §12 documents the contract.

## Governance context
Import and export enablement is governed by `ac.import-export-enablement.001` in `docs/engineering-specs/hq-integration-parallel-execution.md`. Read that section and `task.import-export-qualification.001`. Tell us whether this PR's enablement scope matches what that predicate covers, and what else becomes reachable once imports are enabled (for example `import.repair`, `storage.diagnostics`). Do not judge whether the predicate is satisfied; the integration owner decides that.

## Review checklist
- **Authority and containment.**
  - Can any renderer request write `design/imports/...` outside `import.commit`, or write outside the allowed roots?
  - Check key validation edge cases: prefixes, `..`, unicode, length, and the `design/imports/` listing root.
  - Can `import.commit` be used to write any key `doc.put` could not?
  - Can the picker read a path the user did not choose (symlinks, races)? Check against `apps/desktop/electron/import-picker.ts`.
- **Atomicity and outcomes.**
  - Is every refusal that is reported as a definite no-effect truly one?
  - Is a lost reply reported as unknown?
  - Is the notify-after-sent rule correct, and is nothing notified for a batch that was never sent?
- **Content link.**
  - Append-only and idempotent: can a retry or a resolve duplicate a version?
  - Is the CAS on project content correct (`expectedRevision`), and what happens on a concurrent Projects edit?
  - A read-only (newer schema) project must be refused before anything is sent.
  - Check the thumbnail cap.
- **Source identity.**
  - Is the stable source ID plus normalized-name item keys sound?
  - Check duplicate names, NFC, and an update versus a conflict after an owner edit.
- **Window and dialog lifecycle.** Check close ordering, multiple windows, a host close during a pick, and unhandled rejections.
- **Typed failures.** Does `cause` reach the view? Do the classifications match §12?
- **Tests.**
  - Do the e2e (`apps/desktop/electron/design-imports.e2e.test.ts`), host, wiring and adapter tests prove the claims?
  - Are the assertions that changed from the base justified by an intended behaviour change? Check `selection.test.ts`, `design-host.candidate.test.ts`, `imports-storage.test.ts` and `imports-env.test.ts`.
- **Docs.** Does §12 match the code?
- **Public-repo safety.** No private data, hostnames, credentials or personal names.

## How to check
You may run tests.
- **Before running:** take a CPU sample with `top -bn2 -d1 | grep Cpu | tail -1`, and skip tests while the CPU is 85% busy or more. Run one serial process with `TMPDIR=/tmp`.
- **Setup:** if node_modules is missing, run `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund`.
- **Commands:**
  - `node --test --test-concurrency=1 'modules/design/imports/test/*.test.ts'`
  - `node --test --test-concurrency=1 'modules/design/app/compose/test/*.test.ts'`
  - `node_modules/.bin/vitest run --config modules/design/app/vitest.config.ts`
  - `npm run build:electron`, then `node_modules/.bin/vitest run apps/desktop/electron/design-imports.e2e.test.ts apps/desktop/electron/design-host.imports.test.ts apps/desktop/electron/import-pick-wiring.test.ts apps/desktop/electron/design-host.candidate.test.ts`
  - The storage suite (`node --test --test-concurrency=1 'modules/design/app/storage/test/*.test.ts'`) fails its import-edge scan while `apps/desktop/dist-electron` exists. Run it before building, or move the build output to a fresh `/tmp` directory first.

## Output
A findings list, most severe first. Each finding needs:
- severity P0–P4;
- file:line;
- a one-sentence defect statement;
- a concrete failure scenario: inputs or state leading to wrong behaviour;
- a suggested fix.

Then a short "verified OK" list of what you checked and found correct. Then the test commands you ran, with their results. If you find nothing, say so explicitly.

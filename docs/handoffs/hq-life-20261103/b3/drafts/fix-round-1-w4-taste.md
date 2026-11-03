Lead review of W4 (Taste) at 554a712. No P0, P1 or P2 findings. The subject qualification, legacy presentation, typed put refusals and real-host test are right. Please fix these on the same branch, then re-run your checks.

1. P3: a full journal reads as "Refused". In `taste/src/project-service.ts` `definitePutFailure`, `code === 'too-large'` becomes `TasteInvalidInputError`. The notice therefore says the input was refused (status "Refused") when the journal hit the store's size cap.
   - Add a typed error for this case, for example `TasteJournalFullError`, with a stable `name`. It is a definite no-effect.
   - Classify it as `too-large` in `compose/errors.ts`, with a plain description such as "Your taste journal is full, so nothing was saved."
   - Keep `invalid-argument` as `invalid`.
   - Update the §2a table, `taste-failures.test.ts` and the `CASES` table in `errors.test.ts`. Add a real-host case only if the cap is cheap to reach; a port-level test is enough otherwise.
2. P4: keep the §1 "Section errors" table to one row per kind. Merge the four Taste rows you appended into the existing kind rows. For example, add `TasteConflictError` to the conflict row and `TasteJournalFaultError` (the journal's fail-closed reason) to the corrupt row. Leave §2a where it is: it merges cleanly with W3.
3. P4: wording. After a definite conflict the panel says the save "may or may not have reached the journal", while your notice says nothing was saved. Leave the panel's wording; it is conservative and its Retry is idempotent. Add one sentence to §2a saying the panel stays conservative and the notice carries the definite outcome.

Before you run tests, take fresh telemetry: no tests at 85% CPU or more, one serial process, `TMPDIR=/tmp`. Run taste node and vitest, compose node, app vitest, the host Taste test and app tsc. Report:
- the head SHA;
- test counts;
- anything you could not run.

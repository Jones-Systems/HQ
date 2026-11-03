## Summary

Lane B3, workstream W4: **Taste ratings are scoped to the exact project version, and Taste failures are typed.** This fixes the general-scope collision deferred from #168 (P2). Stacked on W1 (#192).

- **Project-qualified version subjects.** Version IDs are unique only inside their project: deterministic `capture-<digest>` IDs and imported IDs repeat. A Design version is now rated under `pv1:<project length>:<project><version>` (`qualifySubjectId`, `projectVersionSubject`). Two projects that reuse a version ID no longer share a rating slot or a distinct-subject count.
- **One identity function.** `subjectKey(scope, subject)` drives rating slots, the distinct-subject count and the supersede precondition.
- **Legacy journals are never rewritten.** The schema and record versions are unchanged.
  - Project-scope plain version IDs are shown under the qualified ID, so an earlier rating is found and can be re-rated.
  - General-scope plain version IDs name no project. They stay unattributed and never merge with any project's rating.
- **Typed failures** (`taste/src/errors.ts`).
  - A save refused with proof that nothing was written rejects typed: conflict (lost compare-and-set), read-only, invalid, unavailable, and **full journal** (`TasteJournalFullError`, kind `too-large`).
  - A save whose outcome is unknown still resolves `fail-closed` / `sync-failed` and is reconciled by an idempotent replay. Nothing is retried or overwritten automatically.
  - A journal saved by a newer HQ (`hq.design.taste-journal/vN`, N > 1) is read-only on every path.
  - Exporting a journal that verified with a fault is `corrupt`.
- **Composition.**
  - `classifyDesignError` knows the Taste names.
  - `compose/taste-failures.ts` (`reportTasteFailures`) reports each rejection as `designFeedback` and rethrows it unchanged.
  - `TasteView` shows a minimal unstyled notice beside the panel, with Retry, Reload or Choose again. F5 restyles it with `InlineNotice`.
- **Contract.** `BACKEND-CONTRACT.md` §1 table and new §2a (operations `taste.load`, `taste.save` and `taste.export`, the rejection table and subject identity). The Taste README covers the schema and legacy rules.

## Tests

Each suite ran serially at under 85% CPU, with `TMPDIR=/tmp`.

| Check | Result |
| --- | --- |
| `node --test 'modules/design/taste/test/*.test.ts'` | 72 pass |
| `vitest --config modules/design/taste/vitest.config.ts` | 14 pass |
| `node --test 'modules/design/app/compose/test/*.test.ts'` | 243 pass |
| `vitest --config modules/design/app/vitest.config.ts` | 13 pass |
| `vitest apps/desktop/electron/design-host.taste.test.ts` | 10 pass |
| `tsc -p` taste, app, preview, electron, design-host, root | clean |

`design-host.taste.test.ts` drives the real `createDesignHost` over a real file store in a temp directory. Its transport structured-clones every request and reply, as Electron IPC does. It covers:
- durability across close and reopen;
- idempotent replay;
- two projects that reuse a version ID;
- a lost compare-and-set;
- a newer-schema journal and a read-only store;
- a full journal at the real 2,000,000-byte cap;
- a damaged journal;
- the project binding.

Mutation checks confirmed the tests catch regressions. Neutralising `subjectKey` failed 6 tests, and dropping the put-failure mapping failed 3 host tests.

## Review

- **Lead review:** no P0, P1 or P2 findings. Fixed: a full journal read as "Refused" (P3, now `too-large`), and the error-table layout (P4).
- **Independent review:** REVIEW_RESULT

## Known limits

- **The journal is one document capped at 2,000,000 bytes.** When it is full, saves are refused with "Your taste journal is full, so nothing was saved." Rotation or segmentation is future work.
- **Legacy general-scope ratings of a version can't be attributed.** Re-rating that version counts as a second subject.
- **The panel's wording stays conservative after a typed rejection.** `TastePanel` is F5's. The notice carries the definite outcome.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

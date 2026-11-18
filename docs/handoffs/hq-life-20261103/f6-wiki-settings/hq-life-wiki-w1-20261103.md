# Handoff: F6 builder W1 (Wiki chrome, search, home, history), 2026-11-03

Authority effect: none. **The W1 builder never wrote this handoff.** Its process was killed (out of memory) while the
owner's pause request was being delivered. The lane F6 lead wrote this file from the worktree state: the file list,
the header comments and a typecheck. It records only what can be observed.

## Where it stands

- **Branch.** `work/hq-life-wiki-w1-20261103`, base `work/hq-life-wiki-settings-20261103` @ `d2711c7`. Worktree:
  `~/.t3/worktrees/HQ/work-hq-life-wiki-w1-20261103`.
- **Head.** `6e2c14f`, a single "WIP:" commit made by the lead so the on-disk work is not lost, plus the commit that
  carries this file. The builder itself made no commits and pushed nothing.
- **Size.** 11 changed files (+2002 / −535) and 9 new files (about 1355 lines).
- **Checks.**
  - `npx tsc -p modules/wiki/tsconfig.json --noEmit`: clean on this state.
  - The Wiki test suite (`cd modules/wiki && npm test`) was **not run** on this state. The builder's own last run is
    unknown, and some tests may fail.
- **Screenshots.** None. `modules/wiki/ui/evidence/after-20261103/w1/` does not exist.
- **Context.** The host was heavily overloaded around the kill: 15-minute load average 43.9 on 16 cores. That probably
  explains the out-of-memory kill. Check host load before resuming.

## What exists (from file headers)

| File | Purpose |
| --- | --- |
| `ui/src/view.ts` (changed) | Root layout with sidebar, top bar and scroll content, keyboard handling, and the base runtime wiring kept |
| `ui/src/view-topbar.ts` (new) | Back/Forward, breadcrumb, search field, history button; Browse button for the narrow sidebar overlay |
| `ui/src/view-sidebar.ts` (new) | Home, repositories with state, recent pages, overall status |
| `ui/src/view-combobox.ts` (new) | ARIA 1.2 search combobox: debounced suggestions ("Go to …", hits, "Search all pages"); never requests invalid or empty text |
| `ui/src/view-history.ts` (new) | History popover: newest first, kind icons, current entry marked, arrow/Enter/Escape |
| `ui/src/chrome.ts` (new) | Shared chrome helpers: re-render on session titles, entry labels, breadcrumb, outage toasts, keyboard helpers |
| `ui/src/search-data.ts` (new) | Search plumbing for the combobox and the results page: validity, debouncing, cached search and alias lookups, match marking |
| `ui/src/status.ts` (new) | One repository-status reading shared by the sidebar, the footer chip and Home |
| `ui/src/view-search.ts`, `view-home.ts` (changed) | Results page and Home redesign |
| `ui/src/wiki-chrome.css`, `wiki-search.css`, `wiki-home.css`, `app/src/wiki-domain.css` (changed) | Styles for the above |
| `ui/test/chrome.ts` (new) | Test selectors and helpers for the chrome, plus a fake clock for the debounces |
| `ui/test/combobox.test.ts` (new) | 8 tests: debounce; option order and ARIA; keys; pointer choice; invalid submit; live results with replace-not-push; Enter commit and Back; arrow-key focus moves |
| `ui/test/navigation.test.ts`, `search.test.ts`, `home.test.ts`, `surface.test.ts` (changed) | Selector updates for the new chrome. **Unreviewed**: each changed assertion must be checked against the never-weaken rule |

## What's left, in priority order

1. **Run the suite and fix failures.** Run `cd modules/wiki && npm test` after a CPU sample. Diagnose each failure
   before changing a test.
2. **Review the test edits.** Diff `navigation`, `search`, `home` and `surface` against `d2711c7` and confirm that no
   behavioural assertion was weakened or dropped. History order changed to newest first by design; the test must
   still assert the order, `aria-current` and jumping.
3. **Check the design checklist.** Go through `modules/wiki/ui/design-20261103.md` (Layout, Sidebar, Top bar, Home,
   Search results, Feedback, Motion, Keyboard, Accessibility). Likely gaps, since none are confirmed:
   - the not-connected Home state (X4);
   - the outage toast once per episode;
   - scroll restore on Back/Forward;
   - `/` and Alt+arrow shortcuts;
   - the narrow-width overlay.
4. **Capture evidence.** Take the screenshots listed in the W1 brief with the lane harness on port 5252, as described
   in the lane handoff. Commit them to `modules/wiki/ui/evidence/after-20261103/w1/` with a README.
5. **Push and hand to the lead** for review and integration with W2.

## Open questions and risks

- **Unknown intent.** The builder's intent for any half-finished piece is unknown. Read each new file fully before
  continuing.
- **Untested state.** The state is untested, so expect failing tests in `navigation`, `search`, `home` and `surface`.

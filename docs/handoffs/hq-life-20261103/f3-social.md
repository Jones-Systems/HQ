# Lane F3 handoff: HQ Social views (paused 2026-11-03)

## Scope and pause

Lane F3 rebuilds the HQ Social views in `modules/social`. B2 owns the backend; F1 owns the shell and `@hq/ui`.

The goal is that the core flow runs without dead ends: add sources → run a workbench → review results → compose in the Library → plan on the Calendar → check Run history. The views should match or beat the mockups in `docs/design/social/screenshots/`.

Work paused on the owner's request.

- **Team:** the lead was Opus 5.5 at max effort, acting as design lead and integrator. Four builders ran as T3 delegated tasks, each Sonnet 5.5 at extra-high effort in its own worktree.
- **Builders at the pause:** all four had finished. None was stopped mid-run.
- **Not done:** nothing is merged into `work/hq-foundation` or `main`, and no PR is open.

## Where it stands

**Done, on the lane branch:**

- **Flow assessment.** See [`docs/design/social/flow-assessment-20261103.md`](../../design/social/flow-assessment-20261103.md). It ranks 14 findings and records what F7 routed to F3 and the shared asks to F1, F7 and B2. The status of each finding is below.
- **Shared frame (lead):**
  - The page header carries a sync pill. Its panel holds the example note, the delivered limits and *Check again*.
  - One bar under the title covers trouble: "Offline · last synced … · changes paused" or "Not refreshed · showing data from …".
  - A failed first load stays inside the frame, with *Try again* and *Open Social settings*.
  - The brand picker reads *Brands unavailable* when the workspace fails.
  - Below 1000 px the sidebar becomes an icon rail.
  - A new section starts scrolled to the top. Focus lands on the page heading when a page change removes the focused control.
  - The example workspace is seeded in the shell's own project (X5).
- **V1:** Overview, the Sources import desk, Channels & accounts. See [v1-overview](f3-social/v1-overview.md).
- **V2:** Workbench master–detail, run stepper, results, *Start draft* into the Library, and example runs that finish. See [v2-workbench](f3-social/v2-workbench.md).
- **V3:** Library list and filters, the composer with live channel preview and save bar, the narrow layout (X6) and the *Advanced* disclosure (X13). See [v3-library](f3-social/v3-library.md).
- **V4:** Calendar (views, chips, drag with Undo, tray, compact narrow month) and the Run history timeline with a receipt side panel. See [v4-calendar-runs](f3-social/v4-calendar-runs.md).
- **Lead integration fixes:**
  - `2ea095f`: a save toast appears only when the editor has closed.
  - `9f069ca`: dead `content.css` rules removed.
  - `a397707`: the month grid is one Tab stop, moved with the arrow keys.
  - `cbcf1b8`: a narrow receipt takes the full width.

**In progress at the pause:**

1. **The integrated head is not fully verified.** `f95f743` is V2's tested head `e4d2861` plus the lead's `a397707` and `cbcf1b8`. Each of those two passed its own tests (calendar 49 passed; Run history 32 passed). The full suite and typecheck have not run on `f95f743`.
2. **`d2b61aa` is WIP and untested.**
   - The receipt keeps one copy control: the Run ID row.
   - After an unknown outcome the form button reads "Run <tool>…", not "Run again…", and the dialog action reads "Create another run".
   - It updates `progress.test.tsx`, `run-history.test.tsx` and `workbench.test.tsx` to match.
3. **After captures and the PR.** The capture scenarios are written and dry-run; they are in [`f3-social/scratch/scenarios/`](f3-social/scratch/scenarios/). Nothing is captured from the integrated head yet, and no PR exists.

**Not started:**

- the `?` shortcut sheet (finding 14; N, Ctrl/⌘+Enter and Ctrl/⌘+S exist);
- a quiet read-only refresh of Social on window focus (on F1's later list);
- *Run again* for runs started in this window (see the decisions).

## Branches, worktrees, SHAs and PRs

All worktrees live under `~/.t3/worktrees/HQ/`, and every worktree is clean. Every branch is pushed, and no branch has a PR.

| Branch | Worktree | Head | State |
| --- | --- | --- | --- |
| `work/hq-life-social-20261103` (lane) | `work-hq-life-social-20261103` | this handoff commit, on `d2b61aa` | All builders merged; WIP on top. |
| `work/hq-life-social-20261103-v1-overview` | `work-hq-life-social-20261103-v1-overview` | `21d196d` | Merged into the lane at `f56e21d`. |
| `work/hq-life-social-20261103-v2-workbench` | `work-hq-life-social-20261103-v2-workbench` | `e4d2861` | Merged into the lane at `f95f743`. |
| `work/hq-life-social-20261103-v3-library` | `work-hq-life-social-20261103-v3-library` | `fb4c2de` | Merged into the lane at `a836337`. |
| `work/hq-life-social-20261103-v4-calendar-runs` | `work-hq-life-social-20261103-v4-calendar-runs` | `9841162` | Merged into the lane at `f93523e`. |

The lane is built on F1's primitives at `284393d`. `origin/work/hq-foundation` was `0cd50ab` when the lane started.

## Decisions and why

1. **One page frame, no stacked notices** (finding 5). Every page repeated three status notices, which pushed content down about 120 px. Limits and the example note moved into the sync pill's panel. This follows F1's rule: StateView only when nothing has loaded; later failures go inline plus a toast.
2. **Only offline says "paused".** A stale snapshot is "Not refreshed"; nothing about it is paused. The lead's first copy claimed a pause for stale data and was corrected.
3. **The example workspace lives in the shell's project** (X5), so sample links read as this project's. The reference providers still read only live services, so example links show as unavailable until F7 adds example-mode providers.
4. **No "Run again with same input".**
   - The service doesn't return what a run was given, and the session doesn't keep it either (V2 confirmed).
   - A receipt offers *Open <tool> workbench*, and a new run is always a fresh, explicit Run.
   - The durable fix is B2's run input provenance (assessment, shared ask 2).
5. **An unknown outcome never invites a rerun.** The tool's Run still works after a confirmation, but its wording no longer says "again" (WIP `d2b61aa`).
6. **Save feedback sits where the user acts.**
   - The save bar shows *Saved vN · time* in a polite status region.
   - The `@hq/ui` toast viewport, which sits bottom right, covered the bar's buttons, so the save toast now appears only when the editor closed before its save finished.
   - Archive and restore from a row keep an inline notice with Undo.
7. **Narrow layouts adapt their content and never switch views.**
   - Calendar month chips go compact through a container query.
   - The Library list and composer take turns below 780 px.
   - The Run history receipt becomes a peek, at full width below 34rem.
8. **Keyboard:**
   - the month grid is a single Tab stop moved with the arrow keys;
   - focus lands on the new page's heading when a page change removes the focused control;
   - N starts a new draft outside text fields;
   - Ctrl/⌘+Enter runs the current tool.
9. **Success toasts last 8 s.** This is the lane brief's rule; F1's default is 4 s. Calendar moves, Sources hand-offs and copy confirmations use 8 s.
10. **Changed and archived links stay openable** (V1's question). Both still resolve to a record.
11. **Merges only, never rebases**, for builder branches and lane updates. Builders merged the lane head before their final tests.

## Flow-assessment findings and status

| # | Finding | Status |
| --- | --- | --- |
| 1 | Example runs never finish | Built (V2) |
| 2 | Seeded results don't render | Built (V2) |
| 3 | "Add sources" has no page | Built as an import desk (V1). The saved-source registry stays *Proposed* until B2 ships one. |
| 4 | Results don't flow into composing | Built (V2 + V3), tested end to end |
| 5 | Status noise above every page | Built (frame) |
| 6 | Full-screen error states | Built (frame; F7 X4) |
| 7 | Workbench hides the work | Built (V2) |
| 8 | Library is a form, not a composer | Built (V3) |
| 9 | Calendar has no "now" | Built (V4) |
| 10 | Run history reads as a log | Built (V4). *Run again* became *Open <tool> workbench* (decision 4). |
| 11 | Overview has no point of view | Built (V1) |
| 12 | Channels repeats itself | Built (V1) |
| 13 | Sidebar is flat | Built (frame) |
| 14 | Shortcuts are thin | Partly: N and Ctrl/⌘+Enter. No `?` sheet. |
| F7 X4 / X5 / X6 / X13 | Cross-app findings routed to F3 | Built. X5's Work item is pending: see what's left, item 6. |

## What's left, in priority order

1. **Verify the lane head.** In the lane worktree, under `umask 0022`, with a CPU sample below 85% before each command and one process at a time, run:

   ```text
   npx vitest run modules/social
   npx vitest run apps/desktop/src/social-work.integration.test.tsx apps/desktop/src/preview/composition.test.tsx
   npm run typecheck
   ```

   If anything fails in the files that `d2b61aa` touched, fix it or revert that commit. Its intent is described in decisions 4–5 and in its commit message.
2. **Walk the whole flow in the dev preview** in light and dark, at 760 px and with reduced motion: Overview → Sources (*Use fictional example*) → open in a workbench → Run → *Start draft* → Library *Save draft* → plan on the Calendar → Run history receipt.
3. **Take the after captures** from the integrated head with the saved scenarios (see the last section). Commit a curated before/after set under `docs/design/social/flow-assessment-20261103/`, following the repo's `docs/**` evidence convention, and update the assessment with the final status.
4. **Open the PR** from `work/hq-life-social-20261103` into `work/hq-foundation`.
   - The body should cover the top findings, what was built, the checks and the before/after table. A draft is in [`f3-social/scratch/pr-body.md`](f3-social/scratch/pr-body.md).
   - End the body with the Claude Code line.
   - Link and watch the PR.
   - Tell lane F7, which asked to review it.
   - Do not merge; that waits for the integration owner.
5. **Small follow-ups from builder reports:**
   - hide the toolbar *Undo* while the Undo toast shows;
   - consider a warning tone for the save-conflict notice;
   - the `?` shortcut sheet.
6. **Cross-lane work, not F3's to build:**
   - **B1:** the Work example item `ex-cupping-hour` with its link back to Social draft `d0000000000000000000000000000002`. F2 confirmed the IDs before pausing; see F2's handoff.
   - **F7:** example-mode reference providers, so sample links open on first launch.
   - **F1:**
     - a chip render prop for `TimeGrid`;
     - InlineNotice `label`/`dismissLabel`;
     - the toast viewport covering bottom action bars;
     - aligning the 8 s and 4 s success toasts.
   - **B2:**
     - adopt `portErrorNotice` from `work/hq-backend-social-desktop-20261103` (`93af03f`) once it reaches the foundation;
     - run input provenance for *Run again*;
     - a source registry;
     - draft states and per-channel variants;
     - brand profile fields.

## Open questions and owner decisions

- **X8 (owner):** should switching the shell project re-scope Social and Work references? F7 and F1 flagged it. Social currently follows the shell's project for its example seed only.
- **Run again for runs started in this window.** It would need `runTool` to keep the submitted input, which is small and additive. The alternative is to wait for B2's provenance so the behaviour is the same in every window. The lane chose to wait.
- **Changed and archived links:** are they openable, as built, or only *available* ones?
- **Success toasts:** 8 s (lane rule) or F1's 4 s default.
- **Toast position:** bottom right covers sticky action bars (the Library save bar). This is F1's call.

## Not in the repo: threads and /tmp

**Threads.** Each builder's full report is in its T3 thread; IDs are in the builder handoffs.

**The lane lead's thread** holds the review history: screenshot comparisons against the mockups and the fix-round briefs.

**Copied into the repo** at [`f3-social/scratch/`](f3-social/scratch/), because `/tmp` on the build host is RAM-backed:

- **Before captures:** [`scratch/before/`](f3-social/scratch/before/) holds 18 PNGs at 1280 × 800, light and dark, all pages, taken from the lane base in the desktop preview with Liberation Sans.
- **Capture tool:** [`scratch/cdp-capture.mjs`](f3-social/scratch/cdp-capture.mjs), run as `FONT=host node cdp-capture.mjs <scenario.mjs> <outDir>`. It is a headless Chromium driver over CDP; each scenario sets `url`, `width`/`height` and `shots`, and each shot sets `theme`, `reducedMotion` and steps. PR #191 (headless dev-preview launcher and capture) may replace it.
- **Dev server config:** [`scratch/vite.preview-dev.config.mjs`](f3-social/scratch/vite.preview-dev.config.mjs), run as `HQ_ROOT=<worktree> HQ_PORT=5310 npx vite --config …`. It serves the desktop browser preview with `strictPort`.
- **Scenarios:** [`scratch/scenarios/`](f3-social/scratch/scenarios/) has `before.scenario.mjs` and the after captures' `after-1280.scenario.mjs` and `after-760.scenario.mjs`. The after scenarios hide the preview harness's own overlay.
- **PR body draft:** [`scratch/pr-body.md`](f3-social/scratch/pr-body.md).

**Left in `/tmp/hq-f3-scratch/` and expected to be lost.** None of it was over the size limit; these were left out because they are superseded or regenerable:

- builder captures `v1/after*`, `v2/after`, `v3/after` and `v4/after*`, and their scenario files. They are superseded once the after captures are taken from the integrated head; each builder handoff lists what they showed.
- lead captures `lead/after/` (frame at 760) and `lead/dry760*/` (a dry run of the integrated head);
- `BRIEF-COMMON.md`, the builder brief (honesty copy rules, motion tokens, ports and CPU rule). Its rules are restated in the [flow assessment](../../design/social/flow-assessment-20261103.md).

**Servers and tabs.** No F3 dev servers are running, and no preview tabs are open.

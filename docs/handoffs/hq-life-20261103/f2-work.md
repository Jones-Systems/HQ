# Handoff: lane F2, the HQ Work module (views alive and flowing)

Date: 3 November 2026. Author: the F2 lead (Claude Opus 5.5, max effort). Authority effect: none.

Paused at the owner's request, relayed by the HQ coordinator at 14:50 UTC. No PR is open. Nothing was merged into `work/hq-foundation` or `main`, and nothing was deployed or installed.

## Status

- **Done.** The Work flow assessment is written. The lead-owned Work foundation is on the lane branch, pushed, with typecheck and the Work and shared-UI tests passing. The foundation covers the theme, one chip family, kind and status marks, motion extras, the shared Done control, the stylesheet split and the Plan week route stub.
- **In progress (paused early).** Five builder slices, each on its own sub-branch. They ran about 20 minutes before the pause, so expect early WIP. Their handoffs are linked [below](#builder-slices).
- **Not started.**
  - Reviewing builder screenshots against the mockups, and the fix rounds.
  - Integrating the slices into the lane branch.
  - Running the desktop shell and real-Planner tests on F2 changes.
  - Adopting B1's store additions.
  - The PR against `work/hq-foundation` with before and after screenshots.

## Branches and commits

| What | Branch | Head | Notes |
| --- | --- | --- | --- |
| Lane branch | `work/hq-life-work-20261103` | see the last commit on the branch (this handoff) | Worktree `~/.t3/worktrees/HQ/work-hq-life-work-20261103`, clean. Pushed. |
| Base | `work/hq-foundation` | `0cd50ab` | The lane branch starts here. |
| F1 merge | `work/hq-life-system-20261103` | `284393d` | Merged as `5a75dd5`. F1's shared `@hq/ui` motion and feedback primitives, plus F1's global font fix. |
| Foundation | lane branch | `14f5c96` | Assessment, theme, motion extras, CSS split, chip unification, Plan week stub. |
| Done control | lane branch | `18e6502` | `DoneButton` and the `data-hq-motion="reduce"` override. Builders branched from here. |
| Offline rule | lane branch | `40e0ef0` | Assessment aligned with B1's offline queue. |

Related work in other lanes, read only by F2:

- **B1** (Planner backend): `work/hq-backend-planner-20261103`, draft PR #186, assessment `docs/engineering-specs/backend-assessment-planner-20261103.md`.
- **F7** (cross-app flows): draft PR #185, `docs/design/hq-cross-app-flow-assessment-20261103.md`.
- **F1** (shared visual system): `work/hq-life-system-20261103`.

## Builder slices

Each builder is a T3 delegated task (Claude Sonnet 5.5, effort xhigh) in its own worktree, branched from the lane branch at `18e6502`. All five got the pause instruction at 14:50 UTC. Each was asked to commit its WIP, push, write a handoff on its branch at the path below, and reply with that handoff.

| Slice | Branch | Handoff on that branch | State at pause |
| --- | --- | --- | --- |
| A · Board | `work/hq-life-work-20261103-board` | `docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-board.md` | pending reply |
| B · List and detail | `work/hq-life-work-20261103-list-detail` | `docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-list-detail.md` | pending reply |
| C · Calendar and timeline | `work/hq-life-work-20261103-calendar-timeline` | `docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-calendar-timeline.md` | pending reply |
| D · Plan week and review | `work/hq-life-work-20261103-plan-review` | `docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-plan-review.md` | pending reply |
| E · Frame, capture, Glance, feedback | `work/hq-life-work-20261103-frame` | `docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-frame.md` | pending reply |

- **Shared brief.** All builders received the same shared brief, copied here as [`f2-work/builder-brief-common.md`](f2-work/builder-brief-common.md). It covers rules, cross-slice contracts, host etiquette, preview tooling, screenshot requirements and the report format.
- **Slice briefs.** Each slice brief (cone, mockups, deliverables, tests) is the first message of that builder's thread. The cones match the "Build slices" table in the assessment.
- **Follow-up notes.** These arrived mid-run:
  - Shell-test hooks, to the board, list/detail, calendar/timeline and frame builders ([Findings](#findings-beyond-the-assessment), item 1).
  - B1 forward-compatibility for the sync indicator, to the frame builder.
  - The offline-kept outcome wording, to the frame builder.

## Decisions, and why

1. **Assessment first.** The findings and decisions are in [`docs/design/work/flow-assessment-20261103.md`](../../design/work/flow-assessment-20261103.md): cross-cutting X-1 to X-8, capture C-1 to C-3, triage T-1 to T-3, plan the week P-1 and P-2, do D-1 to D-3, review R-1 and R-2. It also covers the feedback table, the invariants and the build slices. Severity S1 items:
   - X-1, monospace text. Fixed globally by F1.
   - X-2, about 190 px of chrome above every page.
   - P-1, no home for weekly planning.
2. **Plan week is a new date-based board** at destination `board/week`. It writes only existing date fields, so it needs no Planner schema change. A drop on a day adds or reschedules a day-precision Target. A drop on "This week" gives a week-precision Target. A drop back on the backlog removes only the planning date.
   - The editable Weekly plan lists (D-3) stay Proposed, and By date stays read-only.
   - The route, nav item, view id `week` and a stub view are wired on the lane branch. Slice D builds the view.
   - **Needs owner acceptance**: it is a new surface.
3. **One Work theme**, lead-owned, in `modules/work/theme/`. Board and view chips used to disagree, and so did their status hues (X-7). The theme gives:
   - one palette with light-dark() values (status, why, date kind, each with a soft fill);
   - a type scale, radii and shadows;
   - one `.wk-chip` family and the `.wk-dot` status shapes;
   - line-icon kind marks in place of the square marks, which read as checkboxes (X-6);
   - `PageHeader` and `SegmentedNav`.
4. **Motion reuses F1.** `@hq/ui` provides Presence, `useListMotion`, PageTransition, the tokens and reduced motion. Work adds only `flyTo` (the capture flight), `flash`, `tiltFor` and `settleGhost`, in `modules/work/motion/`. An earlier Work-local FLIP and exit-ghost implementation was dropped in favour of F1's.
5. **The views stylesheet was split** into `views-base.css` plus one file per view, and feedback styles moved beside their components. This gives each builder a disjoint file cone. Tests that read CSS now point at the theme.
6. **A shared `DoneButton`** (D-1) gives the board, Plan week, Glance and List one identical complete control. It makes one move per activation, pointer-down never reaches a drag handler, and it is instant under reduced motion.
7. **The offline rule is aligned with B1.** In live mode with device durability, a write that finds the Planner unavailable is kept on the device and sent on reconnect. A `failed` + `unavailable` outcome that carries `queued` reads as kept, never as a rollback. Creates are never queued: offline capture stays an HQ draft.
8. **Cross-slice contracts** are recorded in the shared brief:
   - capture-landing target attributes;
   - Done semantics;
   - a stable `board/feedback.ts` API;
   - stable `views/moves.ts` signatures;
   - keyboard scoping: global `N` and `1`–`7`, Alt+arrows with preventDefault (F7's global Back yields to it), and scoped triage keys.
9. **Scope boundaries held.**
   - No edits to `modules/work/core`, `modules/work/live`, `services/**`, `packages/**` or the shell.
   - F2 did not restyle the global shell, which is F1's.

## Findings beyond the assessment

1. **Desktop shell tests pin Work names and hooks.** These are in `apps/desktop/src` (`social-work.integration.test.tsx`, `references.integration.test.tsx`, `preview/composition.test.tsx`, `live-services.integration.test.tsx`), which F2 cannot edit. Any redesign must keep:
   - nav: `navigation` "Work", with buttons named exactly by label and `aria-current`;
   - filters: `group` "Filter planning", always rendered, with a native select "Kind" and an input "Search";
   - capture: `form` "Quick capture" with the textbox "Capture to Inbox";
   - unconfirmed state: the visible text "1 unconfirmed" and a "Check now" button;
   - layout hooks: `.wv[data-view]` and `.wd-scroll`;
   - board: a level-2 heading "Status board", and cards that are an `article` named by title with `data-card-id`, focusable, with Alt+ArrowLeft moving them;
   - detail: the textbox "Card title", with save-on-leave;
   - List: title buttons named exactly by the title;
   - Calendar: chips named `<title>, …`, with Alt+ArrowRight moving the date;
   - Timeline: rows labelled `<title>, horizon …`, with Alt+ArrowDown moving the horizon;
   - Undo: a toast button named exactly "Undo".
2. **B1's store contract additions are fixed but not yet on any F2 base:** `connection`, `queued`, `durable`, the offline and queued save states, and `flushQueued` / `resolveQueued` / `discardQueued`. The UI indicator table is in B1's assessment. B1 will message when its branch carries the store code.
3. **F7 routed four findings to Work.**
   - **X5:** one sample card should pair with a sample Social draft. This needs B1's fixtures in `modules/work/core/fixtures/examples.ts` and F3's Social sample data, so it is cross-lane. The frame builder was asked to investigate only.
   - **X6:** the narrow detail squeezes the board. Slice E handles the layout overlay, and slice B makes the panel fluid.
   - **X13:** raw reference JSON and IDs are exposed. Slice B moves them behind an Advanced disclosure.
   - **X15:** after recovery, capture keeps showing "Planner unreachable". Slice E handles it.
4. **Calendar "Schedule".** A scripted walk could not find a `Schedule` button by role and name after switching to Calendar. Slice C was asked to make the Schedule path discoverable.
5. **Host load.** Setting up five parallel worktrees pushed the load average to about 18 on 16 cores. Builders were told to wait while the 1-minute load is above 13 and to run vitest serially.

## Checks run

- `npx tsc --noEmit -p .` passed at `14f5c96` and `18e6502`.
- `npx vitest run modules/work packages/hq-ui --no-file-parallelism`: 47 files, 818 tests passed, after the Plan week wiring.
- The theme, motion and contrast subset passed at `18e6502`: 3 files, 37 tests.
- At the base `0cd50ab`, before F2's changes:
  - `modules/work`, `packages/hq-ui` and `apps/desktop/src/live-services.integration.test.tsx` passed: 48 files, 822 tests.
  - The full `npm run build` passed.
- **Not run on F2's changes:** the `apps/desktop/src` shell tests, including the real disposable Planner test in `live-services.integration.test.tsx`, and `npm run build`. They were deferred because of host load. The foundation added a "Plan week" nav item, and the shell tests iterate the nav items, so run them first.

## What's left, in priority order

1. **Collect the builder WIP.** Read each slice handoff and branch, and review its screenshots against the mockups (`docs/design/work/mockups/evidence/01–13`) and the assessment. Then finish each slice: start a new delegated round with the original slice brief from the builder's thread, the shared brief, and that builder's handoff.
2. **Verify the foundation.** Run `npx vitest run apps/desktop/src --no-file-parallelism` and `npm run build` on `40e0ef0` or later, and fix anything the Plan week nav item or the chip changes broke.
3. **Integrate** into the lane branch in this order:
   - E (frame and feedback API) first, then A, B, C and D;
   - expect small overlaps in `views/test/views.test.tsx` (D's `VIEW_PROOF` entries, E's host cases);
   - re-run tsc, `vitest modules/work packages/hq-ui apps/desktop/src` serially, and `npm run build`.
4. **Adopt B1's store additions** once B1's branch carries them. Merge, then add the queued outcome ("Kept on this device · sends when the Planner is back"), "N changes queued on this device" with Send now, the conflict and rejection notices, and the offline reasons. Put all of it in slice E's single outcome-to-words mapping and indicator mapping.
5. **Run a real-Planner pass.** Use the live-services integration test, plus a manual pass if possible, against a disposable local Planner on loopback.
6. **Capture evidence.** Before: rebuild the browser preview at `0cd50ab`, or use the scratch shots. After: 1440×900 light and dark and 760×600 for every view and key state. Commit them under a docs evidence folder (synthetic data only).
7. **Open the PR** against `work/hq-foundation` with before and after screenshots, then link and watch it. F7 asked to review it.
8. **Coordinate F7-X5** (the sample card paired with a Social draft) with B1 and F3.

## Open questions and risks

- **Owner decisions:**
  - Plan week as a new board.
  - Nav order, with Views first and Glance on top.
  - Number keys 1–7 for views.
- **Shell-test constraints.** These names and hooks limit how far the top bar and filters can be compacted. For example, the filter selects must stay rendered inline.
- **Offline semantics.** Until B1's store lands, offline writes pause; with it, they are kept and queued. The UI copy has to switch cleanly.
- **Parallel builders on one machine.** Five builders sharing the host can push CPU high. Prefer two or three at a time on resume.

## Exists only outside the repo

- **Scratch under `/tmp/hq-f2/`, which is ephemeral:**
  - `before/*.png`: 1440×900 light captures before F2 of the board, by-date, list, calendar, timeline, review, archive, glance, board-detail and capture-dialog views.
  - `before-preview/`: the pre-F2 preview bundle.
  - `lead/found/*.png`: foundation captures, light and dark.
  - `briefs/common.md`: copied into this folder.
  - `tools/preview-build.sh`: builds `apps/desktop/vite.browser-preview.config.ts` for any worktree into a folder.
  - `tools/shot.mjs`: a small Playwright-core capture script that runs a JSON plan of clicks, keys, drags and shots.
  - The builders' `/tmp/hq-f2/<slice>/` folders.
  - Everything here is reproducible from git: the before state is `0cd50ab`.
- **No servers left running.** The lead preview server on 127.0.0.1 was stopped. A 10-minute fallback timer for builder replies is the only background job.
- **Threads.** The builder threads hold the slice briefs and the mid-run notes. This lead thread holds the full reasoning.

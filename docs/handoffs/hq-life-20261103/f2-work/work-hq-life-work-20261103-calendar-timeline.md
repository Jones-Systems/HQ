# Handoff: F2 slice C (Calendar and timeline), paused 3 November 2026

Artifact Type: `handoff`

Lane: HQ lane F2, builder C. Base `work/hq-life-work-20261103` @ `18e6502`.

Branch: `work/hq-life-work-20261103-calendar-timeline`. Work head: `a737095` ("WIP: Calendar and Timeline to mockup level…"). A second commit adds this file. Both are pushed to origin.

Worktree: the sibling of the lead's worktree, named like the branch, in the same worktrees folder.

## One-paragraph state

All source for the slice is written and the typecheck passed on it. **No test has been run since the changes, and nothing has been seen in a browser.** I ran `npx tsc --noEmit -p .` once, before I edited the two existing test files, and it was clean. I did not run vitest, the desktop integration test, the preview build or any screenshot. I wrote no new test files. Treat every behaviour below as "implemented, unverified".

## By finding ID

| ID | Status | What exists |
| --- | --- | --- |
| X-8 titles | Built, unverified | Calendar: `PageHeader` whose title is the period ("November 2026"; week "Oct 18 – 24, 2026", or "Oct 28 – Nov 3, 2026" across a month; day "Wednesday, Oct 21, 2026"), from the new `periodTitle` in `time-grid.ts`. Meta keeps the honesty line about coarse dates. Timeline: `PageHeader` "Timeline" with the range as meta. |
| X-4 view switches and range changes | Built, unverified | `calendar-motion.ts`: `slideIn` slides the content from the direction of travel (later or deeper is from the end side). It runs in a layout effect on the `.wv-cal-main` stage when mode or range changes. The header never remounts, so focus stays on the pressed control. Timeline: the range slides each `.wv-tl-plane` (ticks, today line, marks) while the borders and sticky labels stay put. `useListMotion` makes rows glide between lanes. All of it goes through `animateElement`, so there is no animation call under reduced motion. |
| P-2 tray | Built, unverified | Three labelled groups. "This week's focus" holds undated, non-inbox items with horizon Now. "Next" holds the other undated, non-inbox items. "Inbox captures" is collapsed by default, with a count, a disclosure button (`aria-expanded`) and a "Sort in Review" link shown only when `env.navigate` exists. The grouping is `trayGroups` in `moves.ts`. |
| Schedule path | Built, unverified | The tray button is named `Schedule “<title>”` (the old long suffix is gone). Its menu offers the four kinds plus **Pick another day…**, which opens a dialog with a native `<input type="date">` defaulting to the shown target day, a kind chip group and a Schedule button. Enter in the date field confirms. This is the keyboard path to pick a day. The menu is `align="end"` so it is not clipped at the sidebar edge. |
| Flow 3, calendar drag landing | Built, unverified | Drag state is data attributes, so there are no re-renders mid-drag: `data-wk-dragging` on the root (set one tick after dragstart, so the drag image is unchanged) and `data-over` on the zone under the pointer (month cell, agenda day, time column, all-day row, tray). CSS outlines every valid day and fills the hovered one. After a write, the chip is found in its destination day (rAF polling, up to 12 frames) and `settleInto` flashes it (`hq-flash`) and glides it from the drop point with the spring. The toast with Undo still comes from `env.run`. A refused drop (same day, null patch, or a write that fails) shakes the chip once via `shake`. Kind, time, zone and note are kept because the existing patches are reused. Coarse chips are dashed (`.is-coarse`) and show the named period. |
| Month grid | Built, unverified | Uppercase weekday header; muted outside-month and past days; today is an accent disc with `aria-current="date"`; chips use the date-kind soft fill, hue icon and left bar; overdue is danger-tinted with a visible "!" in month cells (the word is in the accessible name). The "+" add button shows on hover or focus-within, and always on `hover: none`. "+N more" opens the Day view for that date: 3 slots, so 2 chips plus the more button when there are more than 3 dates. |
| Week and Day | Built, unverified | The shared `@hq/ui` TimeGrid already has the hour rail, now-line and all-day row, and I cannot edit it. I tag each event holder with `data-dk` and `data-ds` in a layout effect so CSS can give it the kind's hue, and I put the kind word in the event subtitle ("Event · America/New_York"). |
| Header controls | Built, unverified | A "‹ Today ›" group (`wk-seg` classes on a `role=group`, labels `Previous month` and so on). A `SegmentedNav` named "Calendar view" with **four** items: Month, Week, Day, Agenda. Date-kind toggles are `wk-chip` buttons with `DateKindIcon` and the plural word; pressed is the filled `wk-chip--<kind>`. |
| Timeline lanes | Built, unverified | Lane titles are sticky-left bands. Row labels are sticky-left. The frame scrolls horizontally, and below 960 px the label and date columns narrow. Quarter lines come from one CSSOM `--wv-grid` gradient built from the same percentages as the ticks, so they stay aligned. A solid accent today line runs through every row, with a "Today" pill in the header. Marks keep their shapes and `role=img` labels. Bands are dashed and tinted. A footer key and the keyboard hint are new. A dragged row lights the lanes, and a drop flashes the row. A same-lane drop is refused: it announces "Same horizon" and shakes the row. |
| `moves.ts` | Done (additive) | Added `trayGroups` and the `TrayGroupId` type. No existing signature changed. |

Not started: new test files, a `moves.test.ts` addition for `trayGroups`, `periodTitle` unit tests, the preview build, every screenshot, the final report.

## Existing tests I edited (not yet run, so I do not know they pass)

- `test/calendar-timeline.test.tsx`
  - `showCalendarView` now clicks the item in the "Calendar view" nav instead of cycling a button.
  - The tray Schedule test expands "Inbox captures" first, because "Sort the old postcards" is an inbox item. It uses the new name `Schedule “Sort the old postcards”` and expects the menu `['Target (default)', 'Deadline', 'Start', 'Event', 'Pick another day…']`.
  - The Agenda `pressed` check is now `aria-current="page"`.
  - The "Calendar layout" group of 2 buttons is now the nav of `['Month','Week','Day','Agenda']`.
- `test/calendar-polish.test.tsx`
  - `selectView` and a new `currentView()` use the nav.
  - The `Calendar view: X.` button assertions became `currentView()` checks.
  - "cycles grid modes and returns from separate Agenda" is replaced by "switches layouts from the segmented nav, keeps the shown day through Agenda, and never writes". The old "returns to the last grid mode" semantics no longer exist.
  - This file is not in the cone list, but it asserts the control I was told to replace. Please confirm the edit is acceptable.
- Not edited and expected to keep passing: `views.test.tsx`, `presentation-polish.test.tsx`, `harness.tsx`. They query `Next month`, `Agenda` (clicked twice; the second click is now a no-op), `Targets`, `Show done & dropped`, `Earlier`, `Today`, `Later`, the range status, `.wv-tl-tick`, `.wv-tl-edge`, `.wv-tl-band` and `.wv-tl-date-text`. I kept all of those names and hooks.

## Decisions and why

- **Agenda is a fourth segment**, not a separate toggle. At 760 px the app defaults to Agenda, so it has to be discoverable. It also removes `lastGridMode`/cycle state. If the lead wants exactly three segments plus a toggle, the change is small, in `Calendar.tsx` `MODES` and `selectMode`.
- **A `SegmentedNav` for views** (`aria-current`, as briefed). Range navigation reuses the `wk-seg` classes on a `div role=group` because those are not "current page" semantics.
- **Straight apostrophe in "This week's focus"**, to match the brief's literal text. The rest of the codebase uses curly quotes, so swap it if preferred.
- **The Inbox group stays mounted but `hidden`** when collapsed, so drag state and the existing drag tests keep working. The open state is remembered in memory (`calendar.tray.inbox`).
- **The Schedule trigger name drops "on <day>: choose a date kind".** The day is in the tray hint and the picker dialog.
- **Drag highlight uses data attributes**, not React state, so a drag never re-renders the grid and cannot abort the browser's drag.
- **Landing is found by destination day** with a short rAF poll, because the store projects the write optimistically. A write that fails is rolled back by the store and the chip shakes.
- **`+N more` opens the Day view.** This replaces the in-place expand and its "Show fewer" toggle. No test used it.
- **`@hq/ui` TimeGrid cannot take kind classes.** The DOM-tag approach in `TimeGrid.tsx` works because React never sets `data-dk`/`data-ds`, so it never clears them. A shared change (a `kind` or `className` slot on `CalendarGridEvent`) would be cleaner, if lane F1 will take it.
- **A new file `views/calendar-motion.ts`** (`slideIn`, `settleInto`, `shake`) is outside the named cone. Timeline imports it too. The lead may prefer to promote `slideIn` and `shake` into `modules/work/motion`.
- **Timeline help text moved to a footer** below the frame, with a key for the marks. The page meta carries only the range and a short line.
- **No inline styles.** Positions and colours use CSSOM custom properties (`useCssVars`) or WAAPI.

## Findings, risks and checks

- **No `node_modules` in this worktree** (the `frame` and `plan-review` worktrees were also missing it when I looked). I did not run an install. I made `node_modules/` a real folder of per-entry symlinks to the lead's worktree `node_modules`, and re-linked `@hq/*` as relative symlinks into this worktree, so workspace packages resolve to this tree. The folder is gitignored and not pushed. If it is gone, recreate it the same way, or run the normal setup.
- **Typecheck:** `npx tsc --noEmit -p .` was clean on the source (before the test edits).
- **Not run:** `npx vitest run modules/work/views --no-file-parallelism`, `npx vitest run modules/work --no-file-parallelism`, `npx vitest run apps/desktop/src/social-work.integration.test.tsx --no-file-parallelism`, the preview build, any capture. The host load was 13–68 for most of the session, which is why I did not start them.
- **Contracts kept by construction.** A dated chip's button name still starts with `<title>, `. The Alt+Arrow handler is on the chip in capture phase. The timeline row's element still has the label `<title>, horizon …`, with the same Alt+ArrowUp/Down and `M` handling. The desktop integration test depends on all of this.
- **Likely places a first test run fails:**
  - heading queries with `name: /November/` (the title is now a span inside the `PageHeader` h2);
  - `getByRole('button', { name: 'Targets' })`, now an icon plus a word;
  - the Schedule and Inbox expand flow;
  - the `calendar-polish` focus-the-title test, which expects `document.activeElement` to be `.wv-cal-title` (it is the span);
  - `getByLabelText(/^… horizon /)` in the timeline tests, which expects exactly one match.
- **CSS to check in a browser:**
  - `overflow-x: clip` with `overflow-clip-margin` on `.wv-cal-main` could clip focus rings at the edge;
  - `.wv-cal-side` no longer has `overflow: hidden`, so check narrow widths for overflow;
  - the Timeline `--wv-grid` multi-layer background in the `background` shorthand;
  - the sticky label's `background: inherit` over row hover;
  - the header's "Today" pill against the tick text;
  - forced-colors rules (drafted, not seen).
- **Known gaps:** no drop badge naming the effect (Plan week owns that idea). The in-memory `useRemembered` state does not persist across reloads. The Week and Day hue/word approach cannot colour the shared grid's resize handle by state.

## What's left, in priority order

1. Check load (`cat /proc/loadavg`, under 13), then run `npx vitest run modules/work/views --no-file-parallelism`. Fix failures in my source first. Edit a test only for a legitimate structure change, and list it.
2. Add the tests the brief names, as `test/calendar-flow.test.tsx`, `test/timeline-flow.test.tsx` and an addition to `moves.test.ts` (leave the theme-contrast test alone):
   - the Month/Week/Day/Agenda nav sets `aria-current`;
   - range navigation keeps focus on the pressed button (Next month, Week);
   - the tray groups into focus, Next and Inbox (add one undated item with horizon Now; the fixtures have none), with the Inbox collapsed, the count, the Review link calling `navigate({ view: 'review' })`, and a drop target on the groups;
   - `Schedule “<title>”`: its name, and the keyboard path (Enter, End, Enter, set the day with `fireEvent.change`, pick Deadline, Schedule gives one patch);
   - reduced motion makes no animation calls (set `data-hq-motion="reduce"` and define an `animate` spy on `HTMLElement.prototype`), with an unreduced control that does call it, and slide direction by the sign of `translateX`;
   - a drop on a day writes one patch with Undo, with `data-wk-dragging` and `data-over` set and cleared, and `hq-flash` on the landed chip;
   - a refused (same-day) drop writes nothing and shakes once (a 6-keyframe `translateX` call on the chip);
   - `+N more` opens the Day view (add 4 dated items on one day);
   - `trayGroups` and `periodTitle` units;
   - Timeline: header and range, Earlier and Later slide the planes, lane highlight and drop with Undo, a same-lane drop shakes.
3. `npx tsc --noEmit -p .`.
4. Build and look. Check load first.
   - `bash /tmp/hq-f2/tools/preview-build.sh <worktree> /tmp/hq-f2/calendar-timeline/preview`
   - `python3 -m http.server 4303 --bind 127.0.0.1 --directory /tmp/hq-f2/calendar-timeline/preview`
   - Capture with `node /tmp/hq-f2/tools/shot.mjs <plan.json>` from `/tmp` (format at the top of that script; example plan `/tmp/hq-f2/before/plan-light.json`). Save to `/tmp/hq-f2/calendar-timeline/after/<view>-<width>-<scheme>.png`.
   - Shots: Month, Week, Day and Timeline at 1440×900 light and dark, and at 760×600 light; mid-drag over a day cell; the drop end state; the tray groups; a mid-transition frame if one can be caught. Compare with evidence 09 and 10 and `/tmp/hq-f2/before/calendar-1440-light.png` and `timeline-1440-light.png`. Stop the server afterwards.
5. Fix what the shots show (the CSS risks above).
6. Run `npx vitest run modules/work --no-file-parallelism` once, and the desktop integration test, then push and write the short report in the brief's format.

## Open questions for the lead

1. Is Agenda as a fourth segment acceptable?
2. May I keep `calendar-motion.ts` (new file, outside the cone), or should `slideIn` and `shake` move into `modules/work/motion`?
3. Is the `calendar-polish.test.tsx` edit acceptable?
4. Would F1 add a kind or class slot to the shared `TimeGrid` event, so the data-attribute tagging can go?
5. Straight or curly apostrophe in "This week's focus"?

## What exists only outside this branch

- Nothing is uncommitted. The worktree was clean after the WIP commit.
- `/tmp/hq-f2/calendar-timeline/` is empty: no preview build and no screenshots were made. I started no server.
- The gitignored `node_modules/` symlink folder in the worktree (see above).
- Reasoning behind the decisions above exists only in the thread; the decisions section is its summary.

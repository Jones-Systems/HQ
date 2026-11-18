# F3-V4 handoff: Calendar and Run history timeline

Part of [lane F3](../f3-social.md). The builder finished before the pause, so the lane lead wrote this summary from its report and branch.

| | |
| --- | --- |
| Branch | `work/hq-life-social-20261103-v4-calendar-runs` |
| Worktree | `~/.t3/worktrees/HQ/work-hq-life-social-20261103-v4-calendar-runs` (clean) |
| Head | `9841162`, pushed |
| In the lane | yes, merged at `f93523e` |
| PR | none |
| State | **Done.** Accepted after two review rounds. The lead made two fixes afterwards (`a397707`, `cbcf1b8`). |

## What it built

Findings 9 and 10 of the [flow assessment](../../../design/social/flow-assessment-20261103.md).

- **Calendar**:
  - month, week, day and agenda views;
  - *Today*, plus "Next planned" when the visible month is empty;
  - chips with a channel colour bar and badge;
  - drag with lift and a drop highlight;
  - an Undo toast, plus a toolbar *Undo*;
  - a keyboard move dialog;
  - the *No date yet* tray, which also clears a date when you drop on it.
- **Calendar at narrow widths:** the calendar region is a container. Below 40rem, month chips become one line: a colour bar and the title with an ellipsis, with the channel and time in the tooltip and accessible name. There is no sideways scroll, and the view never switches on resize.
- **Calendar inside the frame:** a second "Moves are paused" bar is hidden, because the frame's offline bar already says so. Disabled chips give their reason.
- **Run history:**
  - a day-grouped timeline with status icons, active runs that pulse, and inline failure reasons;
  - a receipt side panel that becomes a peek over a scrim at narrow widths;
  - in the receipt: a one-row header with a Close icon, a full-width Run ID with *Copy*, and the error shown once;
  - *Open <tool> workbench* instead of *Run again with same input*, because the service doesn't keep run input.
- **Outside its folder:** small additive edits to V2's `RunReceipt.tsx` (`headerEnd`, `RunIdFact`, no repeated error line), plus the new `RunId.tsx` and `run-id.css`.

## Checks it reported (on `9841162`)

- `vitest run modules/social`: 797 passed.
- Desktop social integration plus composition: 22 passed.
- `npm run typecheck`: clean.

## Lead changes after the merge

- **`a397707`:** the month grid was 42 separate Tab stops. It is now one: arrow keys move by day and by week, Home and End go to the week's ends, and Enter or Space opens the week. Tested: calendar tests, 49 passed.
- **`cbcf1b8`:** at 760 px the receipt peek left a 10 px strip of clipped list rows. Below 34rem the receipt now takes the full width. Tested: Run history tests, 32 passed.

## Open points

- The toolbar *Undo* stays visible while the Undo toast is up, because the existing tests require it. It could hide until the toast leaves.
- Compact chips use a container style query (`@container … style(--cal-compact: 1)`). It works in current Chromium; other engines fall back to the two-row chips.
- The week and day time grid is F1's `TimeGrid`. A chip render prop for it is an F1/kit follow-up.

## Evidence (not committed; `/tmp` on the build host)

- `/tmp/hq-f3-scratch/v4/after3/` has 48 captures from round 2: calendar and runs at 1280 and 760, light and dark, offline in the frame, a reduced-motion drop and the desktop shell.
- Round 1 captures: `/tmp/hq-f3-scratch/v4/after/`.
- Scenarios: `/tmp/hq-f3-scratch/v4/s7-round2.scenario.mjs`, `s8-desktop-round2.scenario.mjs` and `run-round2.sh`.

## Thread

- **Title:** "F3-V4 Social Calendar and Run history timeline".

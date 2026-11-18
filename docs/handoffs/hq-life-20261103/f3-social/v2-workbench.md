# F3-V2 handoff: Workbench, run stepper, results, Start draft

Part of [lane F3](../f3-social.md). The builder finished before the pause, so the lane lead wrote this summary from its report and branch.

| | |
| --- | --- |
| Branch | `work/hq-life-social-20261103-v2-workbench` |
| Worktree | `~/.t3/worktrees/HQ/work-hq-life-social-20261103-v2-workbench` (clean) |
| Head | `e4d2861`, pushed |
| In the lane | yes, merged at `f95f743`; the lead's WIP fixes follow in `d2b61aa` |
| PR | none |
| State | **Done.** Accepted. Two integration points are in the lead's untested WIP (see below). |

## What it built

Findings 1, 2, 4 and 7 of the [flow assessment](../../../design/social/flow-assessment-20261103.md).

- **Example runs finish.**
  - `createWorkbenchFixture({ simulateExampleRuns })` is opt-in, and the lead's `createExampleWorkspace` turns it on. Live mode is unchanged.
  - Example runs step through queued → running → succeeded, about 1.1 s per step, with fictional outputs labelled *Example data*.
  - Runs on the user's own input stay queued. They say "No Social service is set up, so this run waits here. Nothing was sent." and offer *Set up Social service*, which dispatches `hq-open-settings`.
- **Seeded succeeded runs** now carry real result shapes, so they render.
- ***Start draft*** opens the Library composer, prefilled with the result and its run citation, at `library/new`.
  - It never overwrites unsaved text; the user chooses between the unsaved draft and the result.
  - The receipt reads "Draft started · Open in Library" or "Draft saved · Open".
  - `nav/test/start-draft.test.tsx` checks it end to end against V3's composer.
- **Workbench layout:**
  - master–detail, with a tool rail grouped by category; the rail becomes a strip at 900 px or narrower;
  - an animated run stepper;
  - count-up summary tiles and a results table whose rows stream in;
  - eight-character receipt IDs;
  - Ctrl/⌘+Enter runs the current tool;
  - an unknown outcome stays *Unknown*, with "possible matches" that only read.
- **Outside its folder, small and additive:**
  - `core/fixture.ts`: `advanceRuns(outcome?, runId?)`;
  - `nav/workspace.ts`: the opt-in, disposal of a replaced fixture, and the reworded `EXAMPLE_WORKSPACE_NOTE`;
  - `nav/preview/main.tsx`: 11 evidence views.

## Checks it reported (on `e4d2861`)

- `vitest run modules/social`: 858 passed (30 files).
- `social-work.integration.test.tsx` plus `composition.test.tsx`: 22 passed.
- `npm run typecheck`: clean.

## Raised by the builder, and what the lead did

| Point | Lead action |
| --- | --- |
| The shared receipt had two copy controls: V2's short-ID pill and V4's Run ID row. | **WIP `d2b61aa`, untested.** The eyebrow shows the short ID as text. V4's Run ID row is the only Copy, with V2's selection fallback and the 8 s toast. |
| The form's button read "Run again…" after an unknown outcome. | **WIP `d2b61aa`, untested.** It now reads "Run <tool>…" and still asks first. The dialog action is "Create another run". |
| Session state doesn't remember a run's exact input. | Not built. Receipts offer *Open <tool> workbench*. See the lane handoff. |
| Success toasts last 8 s; F1's default is 4 s. | This is the lane brief's rule. It's an open question for F1 alignment. |
| The stepper pulse and count-up are CSS-only and not asserted in happy-dom. | Known gap. They were checked by eye in Chromium. |

## Evidence (not committed; `/tmp` on the build host)

- Captures: `/tmp/hq-f3-scratch/v2/after/`. This includes `dev-results-*` from the real preview, the `seq-0…4` stepper sequence, `workbench-unknown-*`, `workbench-validation-*`, `workbench-import-error-*` and the 760 × 560 variants.

## Thread

- **Title:** "F3-V2 Social Workbench, run progress, results, Start draft".

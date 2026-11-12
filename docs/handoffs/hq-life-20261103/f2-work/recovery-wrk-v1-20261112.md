# WRK-V1 recovery source checkpoint

Authority effect: none. Source implementation only, not behavior qualification.

Branch: `work/hq-recovery-work-views-20261112`.
Code checkpoint: `aebe02ddea6540364430db6b58bef88cd7eb6c08`. This receipt is a subsequent documentation commit.
Base shell: `367cfb2159b85927bd04720c57d809e0970640ed`.
Accepted amendment read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.
Frontend guidance main resolved/read at
`b59d310cae8472ae8ed42d4d8562d08c362379d8`; no private source imported.
The local shared-guidance bridge is absent; no enrollment was attempted.

## Retained composition

Ordinary merges retain F2 `47260bf`, frame `22a6866`, board `428c38a`
and list/detail `c88f158`. Each merge-tree preflight was conflict-free.
Calculated trees in that order: `89f1980b8e29394cefd3bf42acd3e5937ab81ee7`,
`a2719439aeb85e620a438dd3678313c28596ae5e`,
`dce085bbf1fdaeff3164d0963e2d033aa0aa982c`,
`d5da053dead0223ec337f5c09b9d2e59e4c8c8ad`.
Incoming path inventories were inspected before each merge. Retained Work
assessment/handoffs accompany those merges. No off-cone source reconciliation
was needed. Current shell/shared primitives retain their exact base bytes;
the older PageTransition implementation was not restored.
All new merges/commits use explicit public Codex identity per command.
The queue candidate is not merged or edited.

## Completed source

Mounted compact capture, filters, status/example marker, counted/icon navigation,
one toast bridge and narrow detail dialog. Number keys yield to typing, modals
and scoped React handlers. Navigation uses the current shared transition helper.
The detail dialog reuses shared focus containment, Escape, scrim and return focus.
Retained board drag/cancel/drop/Done and list/detail interaction source is composed.
Glance Now gains Done through one move and the existing Undo path with list motion.
Capture uses chip menus, keyboard hints and confirmed Inbox landing. Failed saves
retain input; unknown results offer Check, never automatic retry. Stale unreachable
capture feedback clears on recovery. The date Add action remains visible, guarded
and explained before a day is chosen. Existing 12px gutters, responsive filters,
reduced-motion preferences and forced-colors selection are retained in source.

SHL's exact Alt+Left/Right reservation proposal is applied in StatusBoard's
`onCardKey` immediately after the target/currentTarget guard. An Inbox-edge
regression test is authored. No shell edit is needed for that proposal.

## Static evidence

- `git diff --check` against base and authored checkpoint: pass.
- Four retained ancestors: pass (`git merge-base --is-ancestor`).
- Relative import target existence and conflict-marker scans over changed TS/TSX: pass.
- Byte comparison of packages, desktop, root manifests/lockfile, Work core/live,
  export/references and `views/moves.ts` against the shell base: identical.
- No TypeScript parser is available in this checkout; syntax parsing and semantic
  typechecking are unrun. Import scans do not establish syntax or type correctness.
- No builds, tests, installs, servers, browser/native launches, captures, export,
  gallery completion, private data, activation, PRs or protected-branch merges.

Regression source covers Glance move/Undo, number-key typing exclusion, narrow
modal close and the card-edge chord. Two old toolbar-collapse assertions now
check always-visible filters and persistence, per the accepted compact frame.
Toast text assertions in toolbar-polish scope the visible list separately from
its shared live announcement. No test was executed, skipped or claimed passing.
Other retained tests may need source-compatible selector updates under diagnosis;
none were removed merely to obtain a passing result.

## Exact next-owner handoffs

WRK-V2 starts from this clean published branch, after its source head is supplied.
Own calendar/Timeline, Plan week at `board/week`, Review/Archive completion and
triage. Those existing files were inherited, not redesigned here. Keep all exported
`views/moves.ts` APIs. Number-key arbitration now observes scoped handlers after
React bubbling; verify triage number keys do not navigate. Queue wording and
adapter composition wait for the parent's independently reviewed disposition.
Do not infer that this checkpoint integrates durability/health UI.

SHL: the requested edge-card reservation is applied; no further desktop hunk is
requested by WRK-V1. Preserve pinned Work nav/filter/capture/card/detail names,
`Check now`, Undo, `.wv[data-view]` and `.wd-scroll`. Queue registration and
example cross-link seed hunks remain with WRK-Q/SHL and their existing grants.
No core/live hunk is requested by this capsule.

Serial verifier: after explicit heavy-slot release and admission, qualify the
assembled head with typecheck, Work/shared-UI tests, desktop shell/reference/live
integration tests and required root checks under the accepted serial order.
Exercise capture confirmed/failure/unknown/recovery, no duplicate writes, Undo
once, board drag/cancel/refusal/narrow tabs and edge shortcuts, list/detail edits,
narrow modal focus and return, navigation/scroll persistence, light/dark/system,
reduced motion, 200% text and gutters at both scroll endpoints. Preserve test
oracles; diagnose retained selector assumptions before changing them. Board's
retained implementation lacks vertical edge auto-scroll during drag; evaluate
that limitation without claiming this checkpoint qualifies long-column use.
Layout, accessibility, native journeys, fidelity and gallery/export are unverified.
A later actual presentation export owns gallery completion; no fake screenshots.
Recorded P2–P4 findings retain their previous dispositions.

## Literal paths changed from the shell base

Status letters are Git's added/modified/deleted classification. This includes
retained ancestry changes, not just newly authored edits. The receipt itself is
an additional added path: `docs/handoffs/hq-life-20261103/f2-work/recovery-wrk-v1-20261112.md`.

```text
A	docs/design/work/flow-assessment-20261103.md
A	docs/handoffs/hq-life-20261103/f2-work.md
A	docs/handoffs/hq-life-20261103/f2-work/builder-brief-common.md
A	docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-board.md
A	docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-frame.md
A	docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-list-detail.md
M	docs/ui-map/work.md
A	modules/work/board/BoardCard.tsx
A	modules/work/board/BoardColumn.tsx
A	modules/work/board/BoardSkeleton.tsx
A	modules/work/board/KeyboardHint.tsx
M	modules/work/board/StatusBoard.tsx
A	modules/work/board/StatusTabs.tsx
M	modules/work/board/SyncStatus.tsx
M	modules/work/board/WorkToasts.tsx
M	modules/work/board/board.css
M	modules/work/board/drag.ts
A	modules/work/board/feedback.css
M	modules/work/board/feedback.ts
A	modules/work/board/icons.tsx
M	modules/work/board/index.ts
M	modules/work/board/moves.ts
M	modules/work/board/parts.tsx
A	modules/work/board/test/board-alive.test.tsx
A	modules/work/board/test/layout.test.ts
A	modules/work/board/useBoardDrag.ts
M	modules/work/capture/DraftsPanel.tsx
M	modules/work/capture/QuickCapture.tsx
M	modules/work/capture/index.ts
A	modules/work/capture/landing.ts
M	modules/work/detail/CardDetail.tsx
M	modules/work/detail/Checklist.tsx
A	modules/work/detail/ChipPicker.tsx
M	modules/work/detail/DateEditor.tsx
M	modules/work/detail/HqLinks.tsx
M	modules/work/detail/References.tsx
A	modules/work/detail/StatusPills.tsx
M	modules/work/detail/detail.css
A	modules/work/detail/exiting.tsx
M	modules/work/detail/index.ts
A	modules/work/motion/index.ts
A	modules/work/motion/motion.css
A	modules/work/motion/motion.ts
A	modules/work/motion/test/motion.test.ts
A	modules/work/nav/DetailSheet.tsx
M	modules/work/nav/ToolbarCapture.tsx
A	modules/work/nav/TopBar.tsx
M	modules/work/nav/WorkDomain.tsx
A	modules/work/nav/WorkNav.tsx
A	modules/work/nav/icons.tsx
A	modules/work/nav/keys.ts
M	modules/work/nav/nav.css
M	modules/work/nav/routes.ts
M	modules/work/nav/test/domain.test.tsx
A	modules/work/nav/test/frame-recovery.test.tsx
M	modules/work/nav/test/routes.test.ts
M	modules/work/nav/test/toolbar-polish.test.tsx
A	modules/work/nav/useWidth.ts
A	modules/work/theme/DoneButton.tsx
A	modules/work/theme/PageHeader.tsx
A	modules/work/theme/icons.tsx
A	modules/work/theme/index.ts
A	modules/work/theme/test/done-button.test.tsx
A	modules/work/theme/work-theme.css
M	modules/work/views/Archive.tsx
M	modules/work/views/ByDate.tsx
M	modules/work/views/Calendar.tsx
M	modules/work/views/Glance.tsx
M	modules/work/views/ListView.tsx
A	modules/work/views/PlanWeek.tsx
M	modules/work/views/PlanningViews.tsx
M	modules/work/views/Review.tsx
M	modules/work/views/TimeGrid.tsx
M	modules/work/views/Timeline.tsx
A	modules/work/views/by-date.css
A	modules/work/views/calendar.css
M	modules/work/views/env.tsx
A	modules/work/views/frame.css
A	modules/work/views/glance.css
M	modules/work/views/index.ts
A	modules/work/views/list.css
M	modules/work/views/meta.ts
M	modules/work/views/parts.tsx
A	modules/work/views/plan-week.css
A	modules/work/views/review.css
M	modules/work/views/test/by-date.test.tsx
M	modules/work/views/test/moves.test.ts
M	modules/work/views/test/views.test.tsx
A	modules/work/views/timeline.css
A	modules/work/views/views-base.css
D	modules/work/views/work-views.css
```

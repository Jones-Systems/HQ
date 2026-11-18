# WRK-V2 recovery source checkpoint

Authority effect: none. Source implementation only; behavior is unverified.

Branch: `work/hq-recovery-work-remaining-views-20261112`.
Implementation checkpoint: `d5953d8390882f00ca52b9882e660308ecad43f2`.
Base WRK-V1: `85d681b20bd1b61ca0868bca3bcd1b9bf699e3a6`.
Accepted recovery amendment: `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.
Frontend-Development main resolved/read at
`b59d310cae8472ae8ed42d4d8562d08c362379d8`.
No private source imported. Local shared-guidance bridge absent; no enrollment.
Implementation-role fallback uses the assigned builder cone; no child agents.

## Retained ancestry and source

Calendar `01b681e2c4e6eddb8c68d89c55592d913500bf0e` is retained by
ordinary merge `3030bf2`. Its preflight merge-tree was conflict-free:
`317c65f08027cda828919972e11b2489e50a16ee`. The incoming inventory was only
the Calendar/Timeline view files, helpers, tests and its unchanged handoff.
Plan/Review design `e062238da26073837e37c90280b4e04138fcc4c5` is retained
by ordinary merge `e5e901e`; its only incoming path was the unchanged handoff.
Its conflict-free preflight tree was `e43f398310dc2d7090cabc371c1c040bb0927579`.
Every merge and commit uses explicit public Codex identity per command.
The reviewed queue candidate `bf30a4d7bd7b3b871e2ef0976495206b89e1c617`
was read for state/API only, never merged or edited.

Calendar retains Month/Week/Day/Agenda, grouped tray, date picker, time grid,
date moves and drop/refusal source. Timeline retains range controls, horizon
lanes, keyboard/menu/drop and refusal. Both guard edits pending reconciliation.
Unknown/queued outcomes do not receive an additional failed-write shake.
Existing moves exports remain; only retained additive tray grouping is added.

Plan week now renders backlog groups, seven day columns and the ISO week lane.
Sunday-start plans map to the ISO week containing their Monday. All operations
are one dates patch, keeping other entries, status and horizon. Pinning and
week conversion are named; week conversion clears time/end/zone together.
Backlog removes only the represented entry. Date-kind menus, P, Alt+arrows,
Done/Undo, mouse threshold/touch hold, drag preview badge, cancellation, edge
scrolling, landing/refusal feedback and narrow stacking are implemented source.
The outer frame continues to own the accepted 12px gutters.

Review now includes prompt/session counts, scoped Inbox reason/horizon/status
keys, progress, focus transfer and read-only last-seven-day counts. Keys yield
to typing and modifiers; handled keys stop before global navigation. Rows exit
through Presence with inert departed content. Archive uses the same exits and
keeps Restore/Undo. Queue labels consume the optional reviewed state shape:
queued, sending, conflict, rejected, held and Unconfirmed remain distinct.
No replay path or intent-ID mutation is added.

## Static evidence and unrun qualification

- `git diff --check` and staged diff check: pass.
- Relative import existence, conflict-marker and allowed-path scans: pass.
- WRK-V1, retained Calendar and Plan/Review ancestor checks: pass.
- Protected paths byte-identical to WRK-V1: desktop, packages, Work board,
  capture, detail, nav, core/live, root package/lock and workflows.
- No TypeScript parser available at inspected local dependency paths; syntax
  parsing and semantic typechecking are unrun. Import scans do not prove either.
- New regression source covers ISO-week mapping, precision/clock/date
  preservation, keyboard plan/Undo and triage key ownership. It was not run.
  Existing Calendar test changes are retained with their implementation;
  view-proof assertions follow the accepted range labels and real Plan week.
- No build, test, install, server, app/browser/native launch, capture, export,
  private data, activation, PR or foundation/main merge was performed.
  The originating baseline launch remains unknown and was not replayed.

Serial verifier must qualify the assembled head after its own admission:
typecheck, full Work/shared UI and shell integration checks, required root
checks, then admitted runtime/native journeys. Check multi-date cards, week
boundaries across years and both week starts, same-day/same-lane refusals,
mouse/touch cancellation and edge scrolling, keyboard focus after movement,
Unknown Check without replay, queue held/conflict states, Restore/Undo once,
triage typing/global-key arbitration, enlarged text and both gutter endpoints.
Reduced motion, light/dark/system, narrow/intermediate widths, layout fidelity,
accessibility, native persistence and gallery/export remain unverified. Gallery
completion belongs to a later actual presentation export, not source images.
Recorded P2–P4 findings retain their dispositions.

## Exact shared-owner requests

SHL: no desktop or shared-primitive hunk requested. Preserve existing route
mapping and nav order, Plan week at `board/week`, scoped key arbitration,
`.wv[data-view]`, `.wd-scroll`, Check now and Undo hooks.
Core/parent: compose the independently reviewed queue checkpoint in its owned
step. No core/live API addition or source hunk requested by WRK-V2. Keep queue
notices and recovery controls with their existing owner; unknown writes use
Check only on these views. Preserve immutable intent IDs. This checkpoint does
not claim queue/core or installed-app integration.

## Literal changed paths from WRK-V1

Includes retained ancestry and newly authored source. This receipt is an
additional task-owned documentation path.

```text
A	docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-calendar-timeline.md
A	docs/handoffs/hq-life-20261103/f2-work/work-hq-life-work-20261103-plan-review.md
M	docs/ui-map/work.md
M	modules/work/views/Archive.tsx
M	modules/work/views/Calendar.tsx
M	modules/work/views/PlanWeek.tsx
A	modules/work/views/RetainedRows.tsx
M	modules/work/views/Review.tsx
M	modules/work/views/TimeGrid.tsx
M	modules/work/views/Timeline.tsx
A	modules/work/views/calendar-motion.ts
M	modules/work/views/calendar.css
M	modules/work/views/env.tsx
M	modules/work/views/moves.ts
A	modules/work/views/plan-week-drag.ts
A	modules/work/views/plan-week-model.ts
M	modules/work/views/plan-week.css
M	modules/work/views/review.css
M	modules/work/views/test/calendar-polish.test.tsx
M	modules/work/views/test/calendar-timeline.test.tsx
A	modules/work/views/test/plan-week-recovery.test.tsx
M	modules/work/views/test/views.test.tsx
M	modules/work/views/time-grid.ts
M	modules/work/views/timeline.css
```

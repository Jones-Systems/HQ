# HQ Work flow assessment, 3 November 2026

Artifact Type: `design-assessment`

Artifact ID: `assessment.hq-work-flows-20261103`

Purpose: Evaluate the built Work module's main user flows (capture → triage → plan the week → do → review) for function and usability against the mockups and best-in-class planners, then fix the design decisions the rebuild follows.

Governing artifact: `brief.hq-work-design` ([hq-work-design.md](hq-work-design.md)); shared motion and feedback: `brief.hq-motion-feedback` (`docs/design/hq-visual-system/motion-and-feedback.md`, lane F1)

Decision owner: M Jones

Consumers: lane F2 (Work presentation) and its builders; lane B1 (Planner service and live adapter); the HQ root coordinator

Authority effect: none

## Method and evidence

- **Source:** `work/hq-foundation` at `0cd50ab`, plus F1's shared primitives (`work/hq-life-system-20261103` at `284393d`).
- **What was walked:** the synthetic browser preview of the full shell (`apps/desktop/preview`, fictional Work fixtures, no network) at 1440×900, light theme, driven by script. The flows were capture from the toolbar, sort in Review, the By date board, Calendar scheduling, card detail, List, Timeline and Archive.
- **Compared against:** the Work mockup (`mockups/work-hq.html` and its evidence 01–13) and the Design area, which is the visual bar.
- **Not walked here:** the Electron app, the real Planner service and touch hardware. Lane B1 owns real-service behaviour. Its existing live adapter and main-process bridge pass `apps/desktop/src/live-services.integration.test.tsx`.

Severity: **S1** blocks or misleads a core flow; **S2** costs real effort or confidence every day; **S3** polish.

## Cross-cutting findings

| ID | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| X-1 | S1 | **Text renders monospace on Linux.** The shared sans stack ended in `system-ui, sans-serif`, and this host's fontconfig maps both to Liberation Mono. Every Work capture looked like a wireframe. | `fc-match system-ui` → LiberationMono. Fixed globally by F1 (concrete faces first). |
| X-2 | S1 | **About 190 px of chrome sits above every page.** Each page repeats an example-data banner, a full-width capture row with a hint line, a labelled filter row, a project-scope note and, on the board, a three-line keyboard paragraph. The board starts below the middle of the viewport, and only 3½ of 7 columns fit at 1440 px. | Before: `board-1440-light.png` |
| X-3 | S2 | **Two feedback systems.** The board uses `WorkToasts` and `SyncBanners`; planning views use their own toast and stacked banners. Offline, unconfirmed, conflict and notice states stack as full-width banners that push content down. With no snapshot, a failed load replaces the page with `StateView`. | `PlanningViews.tsx`, `board/SyncStatus.tsx` |
| X-4 | S2 | **No motion anywhere.** Cards jump when they move, columns snap, the detail panel pops in, views switch with no transition, captures appear off-screen, and resolved Review prompts vanish. The UI feels static, and the user can lose track of where something went. | All views |
| X-5 | S2 | **Navigation gives little orientation.** It has no icons, no counts and no number-key shortcuts (the mockup shows 1–7). Boards sit above Views, so Glance (the daily start) is buried. | Before: nav |
| X-6 | S2 | **Kind marks look like checkboxes.** In List, Glance and Review, the chore and project marks are square glyphs at the leading edge of each row, where a completion checkbox would be. They do nothing when clicked. | Before: `list-1440-light.png` |
| X-7 | S3 | **Two chip styles and two status palettes.** Board chips (bordered pills) and view chips (soft fills) disagree. The board's status hues also differed from the views' (Done used the accent, Dropped used danger red). | `board.css`, `work-views.css` (unified now in `theme/work-theme.css`) |
| X-8 | S3 | **Page titles are inconsistent.** List and Review have no visible title. The board has a small heading. Calendar uses a month heading. | Before captures |

## Flow 1 — Capture

**Today:**

- A full-width input on every page. Enter saves to the top of Inbox.
- The date suggestion works: "tomorrow" offers Target · Wed Nov 4 and adds nothing unless accepted.
- `N` opens the dialog. Offline captures become device drafts.
- A toast confirms with Undo.

**Findings:**

- C-1 (S2): On any page except the board, the capture lands somewhere the user can't see. The toast is the only confirmation, and nothing ties it to the place the item went (contrast Things 3's item flying into Inbox, or Todoist's added-task highlight).
- C-2 (S2): The capture row and its hint line cost two rows on every page, even while the user isn't capturing.
- C-3 (S3): The dialog is plain. Status and date are native selects. It has no Shift+Enter "save & add another" hint and no visible keyboard affordance.

**Decision:**

- Keep capture one keystroke away on every page, but make it **compact**: a single field in the Work top bar with an `N` hint. It expands on focus, and its honesty line ("Saves a planning record only; nothing starts.") moves to its description and the dialog footer.
- On save, a labelled token **flies into the Inbox**: the Inbox column on the board, otherwise the Status board item in the nav. The target flashes, and the new card rises into place. The date suggestion stays opt-in.
- Give the dialog a scale-in, chip pickers for status and date kind, and visible ⏎ / ⇧⏎ hints.

## Flow 2 — Triage (sort the Inbox)

**Today:** Review → Sort the Inbox lists each capture with Need/Want/Exploring and Now/Soon/Later/Someday toggles plus **Move to…**. The board allows drag from Inbox or Alt+→.

**Findings:**

- T-1 (S2): One item takes three separate actions (why, horizon, status). Nothing shows progress, and a sorted item stays in the list until its status changes. Nobody can tell when the inbox is "done".
- T-2 (S2): There is no keyboard path through the queue. The Linear and Superhuman pattern is j/k to move, a key per choice, then the next item.
- T-3 (S3): The Need/Want/… toggles look like plain text until pressed.

**Decision:** Review's Sort the Inbox becomes a focused triage queue:

- Each row shows its chosen why and horizon as filled chips, plus a **Move to** row of status buttons. Next is the default target, and the status words are the board's.
- Moving an item out of Inbox animates it out of the queue (Presence collapse).
- A progress line reads "2 of 5 sorted this session".
- Keyboard: ↑/↓ moves between rows. The first letters of the choices are hinted. Enter opens the card.
- Every write stays one store call with Undo. Nothing is batched behind the user's back.

## Flow 3 — Plan the week

**Today:**

- No surface is built for weekly planning.
- By date (Today / This week / Later / Undated) is read-only by design. Changing a group means opening each card's date editor.
- Calendar has an Unscheduled tray with **Schedule** and drag-to-day, in Month, Week or Day.
- The mockup's **Weekly plan** (owner-editable lists) is Proposed and needs Planner schema decision D-3, so the route shows "Proposed — not available".

**Findings:**

- P-1 (S1): The owner's weekly-planning ritual (Sunsama's "plan your week") has no home. A user must cross Calendar's Week view, the detail panel and By date to place a week of work.
- P-2 (S2): The Calendar tray mixes Inbox captures with planned Next work. It doesn't say which items are already this week's focus (horizon Now).

**Decision:**

- Add **Plan week**, a new board that writes only existing date fields, so it needs no schema change. Its header reads "Week of Nov 2 – 8" with ‹ This week ›.
- **Layout:** a backlog column on the left (Overdue deadlines, Now, Next, Active, Considering; Inbox collapsed with a link to Review), then one column per day following the Planner's `week_start`, then a "This week, no day" lane.
- **Dropping on a day:**
  - An item with no date that week gains a day-precision **Target**. A kind menu can switch it to Start, Deadline or Event.
  - A dated chip is moved, keeping its kind, time, zone and note (`rescheduleDatePatch`).
  - The drop badge names the effect ("Set Target · Tue Nov 4", "Move Deadline to Thu").
- **Dropping elsewhere:** on "This week" the item gains a week-precision Target. Dropping back on the backlog removes only the date the item was planned by.
- Every drop is one patch with Undo. Status, horizon and other dates are untouched. Precision never changes silently: pinning a week-of target to a day is named in the badge.
- The today column is emphasised and past days are muted. Per-day counts show the shape of the week.
- **Weekly plan (D-3)** stays Proposed. Its route keeps its honest unavailable state and links to Plan week. By date stays read-only.

## Flow 4 — Do

**Today:**

- The board moves cards Next → Active → Done by drag, menu or Alt+→.
- Glance shows Now and the next 21 days.
- The detail panel holds the checklist ("Next steps"), notes with autosave, dates and links.

**Findings:**

- D-1 (S2): Completing is indirect. Done is the sixth board column and off-screen at 1440 px, and Glance and List have no complete control. The square kind marks (X-6) invite a click that does nothing.
- D-2 (S2): Drag has no physics. The ghost is static, nothing lifts, neighbours jump to make room, and the drop snaps. Feedback on success is a toast only.
- D-3 (S2): The detail panel pops in at a fixed 360 px. Its title input clips, and fields are a grid of native selects. Save state sits in the header with little visibility. A notes conflict uses a full-width banner.

**Decision:**

- **Complete on hover/focus:** board, Plan week, Glance and List rows get a real **Done** control, a round check that animates. It is one `move` to Done, place top, with Undo. Kind marks become distinct non-checkbox icons.
- **Drag physics:**
  - Lift on pick-up: scale, shadow and a tilt that follows velocity.
  - Neighbours glide apart with shared list motion across all columns.
  - The drop settles with the shared spring and the landed card flashes.
  - Escape cancels and the card flies back.
  - Collapsed columns and narrow status tabs still accept drops.
- **Columns** are 288 px with compact headers. A horizontal-scroll affordance shows hidden columns, and Done and Dropped get count pills on their collapsed rail.
- **Detail panel:**
  - It slides in from the end.
  - The title is a large inline-editable field and status is an animated pill row.
  - Fields are compact chip pickers with a Menu, not native selects.
  - The panel header shows a `StatusIndicator` with Saving…, Saved and Changed elsewhere.
  - A conflict becomes an `InlineNotice` with Keep mine / Use theirs.
  - Checklist rows animate in and out, and checking one strikes it through smoothly.

## Flow 5 — Review

**Today:** Gentle prompts in six groups (sort Inbox, overdue deadlines, passed targets, active but quiet, horizon/date disagree, no why). Each has one-tap actions.

**Findings:**

- R-1 (S2): A resolved prompt disappears instantly. The list shifts under the cursor and the next item lands where the last one was without warning.
- R-2 (S3): The page has no sense of a finished review: no counts in the header, no "all clear" moment and no record of what got done this week.

**Decision:**

- The header gains a summary: "6 prompts · 3 resolved this session".
- Groups that become empty collapse with an "All clear" line.
- Resolved rows leave through Presence, and the rest glide up (shared list motion).
- A **This week** strip shows items finished, captured and dropped in the last seven days, read from item status and timestamps. It writes nothing.

## Feedback and states (all flows)

Work adopts F1's shared primitives:

| Situation | Work behaviour |
| --- | --- |
| Move, edit, capture | Visible change in place, plus an Undo toast through `useToast`, with meta "Planning change only · no run started". An Undo runs at most once: Ctrl/⌘+Z dismisses its toast. The core undo stack outlives the toast. |
| Saving | `StatusIndicator` in the Work top bar shows Saving…, Saved · 10:42 or Unconfirmed · Check. Cards show their own Saving… or Unconfirmed badge. |
| Write failed or refused | Roll back in place and `toast.error` saying what was kept. A refused move shakes the card once. |
| Unknown outcome | `toast.unknown` with **Check**, never a blind retry, plus the card's Unconfirmed badge. |
| Offline with a snapshot | Top-bar `StatusIndicator tone="danger" label="Offline"`. The content stays readable and writes pause. Captures become drafts with a compact bar. |
| Conflict | `InlineNotice` on the affected surface (detail notes, card). No stacked page banners. |
| First load, nothing cached | `StateView`, unchanged. Loading uses `Skeleton` shaped like the board or list. |

## Invariants kept

Moving a card never starts work: the port has no execution member, and toasts say so. Planner semantics are unchanged:

- No date is invented.
- Coarse precision stays visible.
- Status changes from detail or List go through `move`.
- Field undo is compare-and-swap.
- By date stays read-only.

Weekly plan lists and HQ cross-links stay **Proposed**. Store, adapter and service code (`modules/work/core`, `modules/work/live`, `services/planner`) belongs to lane B1. F2 uses the store API as it is.

## Build slices

Each builder takes one slice. Each slice owns disjoint files, so they can merge cleanly.

| Slice | Scope |
| --- | --- |
| **A · Board** | `board/**` except the feedback files and `board/parts.tsx`; `views/ByDate.tsx`, `views/by-date.css`. Cards, chips, drag physics, column reflow and collapse, Done control, narrow tabs, the capture landing. |
| **B · List and detail** | `views/ListView.tsx`, `views/list.css`, `detail/**`. Table, inline menus, row motion, complete control, detail slide-in, field pickers, notes and conflict, checklist. |
| **C · Calendar and timeline** | `views/Calendar.tsx`, `views/TimeGrid.tsx`, `views/time-grid.ts`, `views/moves.ts`, `views/calendar.css`, `views/Timeline.tsx`, `views/timeline.css`. Mockup-level calendar and timeline, view-switch transitions, drag landing. |
| **D · Plan week and review** | `views/PlanWeek.tsx` and `views/plan-week.css` (the lead wired the `board/week` route and a stub), plus `views/Review.tsx`, `views/Archive.tsx`, `views/review.css`. Plan week, triage queue, review summary and exits. |
| **E · Frame, capture, Glance, feedback** | `nav/**`, `capture/**`, `board/feedback.ts`, `board/feedback.css`, `board/SyncStatus.tsx`, `board/WorkToasts.tsx`, `views/PlanningViews.tsx`, `views/Glance.tsx`, `views/glance.css`, `views/env.tsx`, `views/meta.ts`. Compact top bar, nav, page transitions, capture flight, unified feedback, Glance. |

Shared pieces are owned by the lead: `theme/**`, `motion/**`, `board/parts.tsx`, `views/parts.tsx`, `views/views-base.css`, `views/index.ts` and this document. A builder that needs a shared change asks the lead, or keeps the piece local to its own files.

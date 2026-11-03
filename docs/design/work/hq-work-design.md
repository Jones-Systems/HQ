# HQ Work design

Artifact Type: `design-spec`

Artifact ID: `brief.hq-work-design`

Purpose: Define how HQ's Work domain presents the existing Manual Planner, with an interactive mockup as the reference for builders.

Governing artifact: `docs/engineering-specs/hq-bootstrap.md`; `spec.hq-social-work` (`req.work-core.001`, `req.work-views.001`, `iface.work-port.001`)

Decision owner: M Jones

Consumers: the Social/Work implementation planner (T1), Work lanes WRK-P and WRK-B, the HQ root coordinator

Authority effect: none

## Outcome

Work is HQ's planning domain. It shows the owner's existing Manual Planner
records, using the Planner's own fields, rules and service. HQ adds a desktop
shell, a cleaner board, keyboard-first movement and links to the other HQ
domains. It does not add a second task store, rename persisted fields or
migrate data. **Moving a card never starts work.**

The reference mockup is [`mockups/work-hq.html`](mockups/work-hq.html). It is
one self-contained HTML file with fictional records and a fixture adapter that
behaves like the Planner service. See [mockup evidence](mockup-evidence.md) for
how to open it and what was checked.

Related documents:

- [Planner behavior inventory](planner-behavior-inventory.md): what the Planner
  does today, cited to source.
- [Adapter boundary](adapter-boundary.md): the proposed module boundary,
  adapter surface and questions for T1.
- [Work note](work-note.md): lane continuity, guidance adoption and source
  identities.

## What is current and what is proposed

| Capability | Status in this design |
| --- | --- |
| Seven-status board, ordering, drag, keyboard and menu movement, undo | Current Planner behavior, restyled |
| Quick capture to Inbox, offline device drafts | Current Planner behavior |
| Card detail: fields, dates, checklist, notes, links, history, archive | Current Planner behavior |
| Glance, List, Calendar, Timeline, Review, Archive | Current Planner views |
| **By date** board (Today / This week / Later / Undated) | New HQ view over existing dates. Read-only, with no schema change. Matches T1's RV-5 Lists default. |
| **Weekly plan** board with owner-editable lists | **Proposed.** Needs a Planner schema change (owner decision D-3). Marked "Proposed" everywhere it appears. |
| **Linked across HQ** (Design annotation, Jones request, Social draft) | **Proposed.** Needs the reference decision D-4. Marked "Proposed". |
| Capture date suggestion ("tomorrow" → Target) | New HQ affordance. It only offers; nothing is added until the user accepts. |
| Export | Current Planner export. In phase 1, HQ points to the Planner's own tools. |
| Import and restore | Stays in the Planner's own tools in phase 1. |

## Information architecture

The **HQ rail** is shell-owned: Design, Social, Work, plus the appearance
control (Light / Dark / System). Work never reads the OS theme itself; it uses
`ModulePort.appearance`.

The **Work navigation** has two groups:

- **Views:** Glance `1`, Board `2`, List `3`, Calendar `4`, Timeline `5`,
  Review `6`, Archive `7`. The number keys match the Planner.
- **Boards:** Status board, By date, Weekly plan (Proposed).

The **top bar** holds:

- **Project chip.** The chip shows the HQ project context, which comes from the
  shell. Planner items have no project, so a quiet note says *"Planner items
  aren't project-scoped · showing all planning"*. Work never filters by `area`
  as if it were a project and never switches project silently. See question
  Q-2.
- **Search** (`/`), **Undo**, and **New** (`N`).

At narrow widths the views collapse to a select in the top bar, and the board
switches to status tabs.

## Status board

- **Columns.** Seven status columns in Planner order: Inbox, Considering, Next,
  Active, On hold, Done, Dropped. Inbox is styled as a dock, with a
  **Capture to Inbox** composer and the caption *"Status · captured, not yet
  sorted"*. Every column can collapse; a collapsed column still accepts drops.
  Dropped starts collapsed.
- **Card anatomy.** From top to bottom:
  - kind icon, title and a `⋯` menu button;
  - chips: Why (Need / Want / Exploring), Horizon, the primary date and High
    priority;
  - badges: notes, checklist progress, link count, "N linked" (Proposed) and
    area.

  A left accent bar carries Why. Every chip has a text label, so no meaning
  depends on color.
- **Date chip encoding.** Coarse dates (week, month, quarter, year) have a
  dashed outline, so the precision stays visible. Dates the user set are never
  shown as more precise than they are. An overdue deadline reads
  "Overdue · Oct 17" in the danger role. A passed target reads "Target passed".
- **Pending state.** A card being saved shows **Saving…**. If the response is
  lost, it shows **Unconfirmed** until the same request ID is answered. On
  rejection the card rolls back and a toast explains why.
- **Inline add.** "Add a card" opens a composer at the **top** of the column
  and says so ("Adds to the top"). Planner create always places new items at
  the top, so this avoids a hidden create-then-move pair.

## Movement and undo

Drag, keyboard and menu all produce the **same** `move` call. The call carries
a status and an anchor (`after_id`, `before_id` or `place: top/bottom`)
computed from visible neighbors. The server applies it to the full stored
order, so filtered-out cards keep their relative order.

| Input | Behavior |
| --- | --- |
| Drag | Mouse threshold 5 px; touch hold 320 ms. A placeholder shows the landing spot. The drag badge names the effect: "Reorder", "Move to Active" or "Place in Today". Escape cancels. |
| Keyboard | Arrow keys move focus. Alt+←/→ changes status, landing at the top of the target. Alt+↑/↓ reorders. `M` opens the move menu. Enter opens the card. Focus stays on the moved card, and a live region announces the result. |
| Menu | Every status (the current one disabled) plus Move up, Move down, Move to top and Move to bottom. |
| Narrow | Drop a card on a status tab to move it to the top of that status. |

**Undo.** Each move or edit offers **Undo** in its toast and on Ctrl/⌘+Z. The
shortcut is ignored while typing. Undo stack rules:

- The stack holds 40 entries.
- It lives in a module-level store, so it survives HQ domain switches. T0
  remounts modules on every switch.
- An entry runs at most once. Ctrl/⌘+Z dismisses that entry's toast so a stale
  Undo button cannot replay it.

How each action is undone:

- **Move.** Undo restores the previous neighbor anchor. If the board changed so
  the anchor no longer exists (`order_conflict`), the card returns to the top
  and the toast says so.
- **Status change from the detail panel or List.** These go through `move`,
  not `patch`, so undo restores the card's exact place. A Planner patch would
  put it at the top of the column (see inventory observation 2).
- **Field edit.** Undo is compare-and-swap. If the field still holds the value
  this action wrote, undo restores the old value. If someone changed it since,
  undo writes nothing and says *"Not undone: … was changed again since; the
  newer value was kept."* This deliberately differs from the Planner's own
  client (inventory observation 1).
- **Create.** Undo archives the new item. Archive is reversible, and the
  Planner never hard-deletes user items.

## Quick capture

`N` or **New** opens the capture dialog:

- **Title.** Required.
- **Status.** Defaults to Inbox.
- **Optional date.** A kind plus a day value.

**Enter** saves. **Shift+Enter** saves and keeps the dialog open for the next
item. When the title contains a date-like word, a suggestion appears: *"'tomorrow'
looks like a date. Add Target · Wed Oct 21? The title stays as typed."* Nothing
is added unless **Add date** is pressed. No date is ever invented. The footer
reads *"Saves a planning record only. Nothing starts."*

If the Planner service is unreachable, capture saves a **device draft**. The
draft is labelled as not yet in the Planner and is sent with **Send drafts**.

## Card detail

The detail panel slides in from the right, or fills the screen when narrow. It
contains:

- **Title.** Inline editable.
- **Status pills.** These route through `move`.
- **Fields.** Why, Horizon, Kind, Priority, and Area, which is free text and
  shown as a label.
- **Dates.** Each shows its kind, precision, value and optional time with zone,
  plus relative text ("in 3 days", "this period"). Precision is never silently
  changed.
- **Next steps.** A checklist with progress, add-step, and Alt+↑/↓ reorder.
- **Notes.** Autosave 1,200 ms after typing stops (the Planner's value), with
  a flush on blur. The panel header shows Saving…, Saved or Changed elsewhere.
  The builder uses the `@hq/ui` SaveIndicator, whose fuller set (saved time,
  not saved, offline, unknown) follows T1's RS-3.
- **Conflict.** If a note was changed elsewhere, a banner offers
  **Keep mine** or **Use theirs**. The user's text is never discarded silently.
  If a *different* field changed, the edit is re-applied automatically, as in
  the Planner.
- **Links.** Static links (URL, document, repository and so on) that open
  externally and cannot start anything.
- **Linked across HQ · Proposed.** See below.
- **History** and **Archive.** Archive is not Done.

## Linked across HQ (Proposed)

Design annotations and Jones requests are **different things** and stay
visually and semantically distinct.

| Link | Owner | What the card shows | Follow action |
| --- | --- | --- | --- |
| Design annotation | Design | Title, project, **source revision** and a captured thumbnail. The thumbnail keeps its own colors in light and dark themes. | Navigates to the annotation in Design. Following never starts work. |
| Jones request | Jones | Title and an **observed** status with its check time, for example *"Observed: Running · checked 6 min ago"*. It notes that status is owned by Jones and that **this card's status is unaffected**. | Opens the request record. Opening it never re-sends. |
| Unavailable target, for example a Social draft | The source domain | A readable title and provenance with an "Unavailable" tag. Nothing was copied. | None until resolvable. |

A request's state never changes a card's status, and a card's status never
changes a request. Storing these links on Planner items waits for decision
D-4. The [adapter boundary](adapter-boundary.md) describes the options.

## Today, This week, Later

The owner wants a Today / This Week / Later way of planning. Planner `horizon`
(Now / Soon / Later / Someday) is **not** relabelled to provide it. The design
offers two separate things:

1. **By date (phase 1, no schema change).** A read-only board that groups open
   items by their own dates:
   - **Today:** a day date today, or an overdue deadline.
   - **This week:** a day or week date later this week.
   - **Later:** a later date, or a month, quarter or year period.
   - **Undated:** no date ahead.

   Each group shows its rule. Dragging is off, and a banner explains that a
   card moves between groups by changing its date in the card. The move menu
   offers status moves only. Done and Dropped are hidden. This is T1's RV-5
   "Lists" view.
2. **Weekly plan (Proposed, D-3).** A custom board with owner-editable lists
   (Today / This Week / Later, renamable). Cards are placed and reordered by
   drag, with undo. **Placement is separate from status, horizon and dates**:
   a card keeps all three, and they stay visible on it. A dashed banner states
   that this needs a Planner schema change and that nothing is renamed or
   migrated. Multiple boards follow the same model.

## Other views

- **Glance.** A greeting line with counts, a status strip that links into the
  board, and panels for Now, Next 21 days (overdue first), Inbox and Recently
  changed. The Planner's "Worth a look" panel is not mocked (see the gaps in
  the [mockup evidence](mockup-evidence.md)).
- **List.** Every live item in status and position order. Inline Status
  (through `move`) and Horizon (through a patch), plus Why, next date and area.
- **Calendar.** A month grid with day chips, week-precision items in a band
  across the week row, and month or quarter periods as a band. It has an
  **Unscheduled** tray and an **Outside this month** list. It is honest about
  precision: a month-precision target never appears on a single day.
- **Timeline.** Eight quarters with horizon lanes (Now / Soon / Later /
  Someday / No horizon). Markers show day dates, bands show coarse periods, and
  a bar spans start to target. Labels sit after the item's last date.
- **Review.** *"Gentle prompts. Nothing changes until you choose an action."*
  The groups are Sort Inbox, Overdue deadlines, Passed targets, Active but quiet
  (no change for `stale_days`), Horizon and date disagree, and No "why" yet.
  Each item has one-tap actions.
- **Archive.** Archived items with **Restore**.
- **Data & settings.** Export through the Planner. Import and restore stay in
  the Planner's own tools in phase 1. It also shows the Planner preferences
  (display zone, week start, quiet-after days), which the Planner service
  stores.

## Appearance

Light and dark are both first-class. Work uses HQ's semantic roles for
surfaces, text, borders, accent, focus and states. It adds module-local roles
`--work-st-<status>` and `--work-dk-<datekind>`, each with light and dark
values. Captured content, such as a Design thumbnail, is never filtered or
recolored. The mockup's `appearance` parameter and rail control demonstrate
Light, Dark and System.

## Narrow layout (below 760 px)

- The rail narrows. The Work navigation becomes a view select in the top bar,
  and search moves to a second row.
- The status board shows one column at a time with **status tabs** above it.
  Each tab shows its count and accepts drops.
- By date and Weekly plan stack their groups vertically.
- The detail panel becomes full screen.
- Touch drag needs a 320 ms hold, so scrolling still works.

## States

The mockup demonstrates these states:

- **Saving and confirmation:** Saving…, Saved, and Unconfirmed (lost response,
  re-sent with the same request ID).
- **Offline:** a banner reading *"Planner service unreachable · changes
  paused"*, a connection footer, and capture that becomes device drafts.
- **Drafts:** a banner with **Send drafts**.
- **Conflict:** the notes banner offering Keep mine / Use theirs, and toasts
  for `revision_conflict` and `order_conflict`.
- **Empty:** per-column hints and "No matches here" under search.

The builder adds empty, loading and error states with the `@hq/ui` StateView
component.

## Acceptance checks for builders

These are the design-level checks. T1's `ac.work-*` criteria stay
authoritative.

1. Drag, Alt+arrow and menu moves of the same card produce identical `move`
   requests, and undo restores the exact neighbor anchor.
2. A status change from the detail pills or the List select is a `move`, and
   its undo restores position.
3. A field undo after a concurrent change to the same field writes nothing and
   says so.
4. Capture with "tomorrow" in the title creates an item with no date unless the
   suggestion was accepted, and the title is unchanged.
5. The By date board never writes: drag is inert, and the move menu has no
   reorder items.
6. Nothing in Work increments an execution counter. The port has no execution
   method, and a test asserts the port surface.
7. Every chip and status is readable without color, and focus is visible in
   both themes.
8. At 420 px wide, every board mode shows its cards, and status-tab drops work.

## Open questions for the owner

| ID | Question | Recommendation |
| --- | --- | --- |
| Q-1 | Should Work's `home` destination be Board (T1's choice) or Glance (the Planner's landing view)? | Board. The owner's request centers on the board, and Glance is one key away. |
| Q-2 | Should a Work view be scoped to the HQ project? | Not in phase 1. Planner items have no project. Later, offer an explicit, labelled per-device filter preset (for example area = "Studio") rather than an implied mapping. A real `project_id` needs a schema change. |
| Q-3 | Should "This week" use ISO weeks (T1) or the Planner's `week_start` setting? | Honor `week_start`, so By date agrees with the Planner's Calendar. |
| Q-4 | Approve D-3 (editable lists and multiple boards) after By date has been used? | Yes, if By date leaves a real gap. The schema sketch is in the adapter boundary. |
| Q-5 | Approve D-4 (storing HQ references on Planner items)? | Yes, as a new reference kind in Planner schema v2, decided with the reference-envelope owner. |

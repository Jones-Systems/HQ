# F2 builder D (Plan week and review) handoff

Lane F2, slice D. Paused by the owner's stop order before any production code was written.

- Branch: `work/hq-life-work-20261103-plan-review`
- Worktree: `/home/malcolmjones/.t3/worktrees/HQ/work-hq-life-work-20261103-plan-review`
- Base: `work/hq-life-work-20261103` @ `18e6502`. Source files are unchanged from the base. The only commit on the branch is this handoff.
- Scratch folder `/tmp/hq-f2/plan-review/`: nothing was written there. No preview was built, no server was started, and no screenshots exist.

## Where things stand, by finding ID

| ID | Status |
| --- | --- |
| P-1 Plan week board | Not started. `PlanWeek.tsx` is still the lead's stub. Design is settled (below). |
| D-1 `DoneButton` on Plan week cards | Not started. |
| T-1, T-2, T-3 Triage queue | Not started. Design is settled. |
| R-1 Review row exits | Not started. |
| R-2 Review summary, All clear, This week strip | Not started. |
| Archive (`PageHeader`, mockup-grade rows, Restore with Presence exit) | Not started. |
| Tests, screenshots, `VIEW_PROOF` update | Not started. |

I did no builds, no `tsc` and no vitest. Host load stayed at 31–48 against the brief's limit of 13, and I was still in the reading and design phase. **No check results exist for this branch.**

The pause landed while I was reading `modules/work/core/store.ts` lines ~160–215 and ~340–420. I had not yet confirmed how the store's optimistic projection handles a new `dates` entry that has no id. The first thing to verify is that a drop on a day shows the card in its new place immediately.

## What I read, so the next builder need not

Read: `common.md`, the flow assessment (Flows 2, 3 and 5), the F1 motion doc, the theme and motion extras, `views/*` (`env`, `parts`, `moves`, `PlanningViews`, `Review`, `Archive`, `Calendar` write paths, `views-base.css`, fixtures, harness, `views.test.tsx`, `presentation-polish.test.tsx`), the board's `drag.ts` and `StatusBoard.tsx`, the `@hq/ui` `Presence`, `useListMotion` and `Menu`, core `planning.ts`, `types.ts`, `validation.ts` and `dates.js`, and mockups 04, 11 and 13 and the before shots of Review and Archive.

## Facts found that shape the build

1. **Week-precision values are ISO weeks** (`YYYY-Www`, Monday to Sunday; see `periodBounds` and `isoWeekOf` in `dates.js`). With `week_start: 'sun'`, Plan week runs Sun–Sat and does not line up with an ISO week.
   - Decision: the "This week, no day" lane's value is `isoWeekOf(addDays(weekFirstDay, week_start === 'sun' ? 1 : 0))`. That is the ISO week containing the plan week's Monday.
   - A week-precision entry belongs to the plan week whose Monday it starts on, and each ISO week maps to exactly one plan week.
2. **`moves.ts` cannot do two of the drops.**
   - `rescheduleDatePatch` returns null for any non-day date.
   - `datesPatch` is not exported.
   - There is no kind-change patch, no week-to-day pin and no day-to-week patch.
   - Build these locally in `plan-week-model.ts` with `stripDerived` from `../core`, the same way `moves.ts` does.
   - Use `addDatePatch`, `rescheduleDatePatch` and `removeDatePatch` for the three cases they cover. Do not edit `moves.ts`.
   - Time fields are valid only on day precision (`validation.ts`), so a day-to-week conversion must clear `time`, `end_time` and `tz` together.
3. **Existing tests constrain Review.** These must keep passing, because only the `VIEW_PROOF` entries in `views.test.tsx` may change.
   - Sections are `region`s named by their titles: "Sort the Inbox", "Overdue deadlines", "Active but quiet" and so on.
   - Why toggles sit in a `group` named `Why for <title>`, with buttons whose accessible name is exactly `Need`, `Want` or `Exploring`. Keyboard hint chips must therefore be `aria-hidden`, with `aria-keyshortcuts` on the button.
   - "Mark done" is a button inside the Overdue region and moves to Done with `{ place: 'top' }`.
   - "Still active" calls `markReviewed`.
   - The "Days before an active item counts as quiet" spinbutton saves on Enter.
   - With `items: []`, `getByText('All clear')` must find exactly one element, and its closest `[data-state]` must be `empty` (a `StateView`). A group's "All clear" line must therefore appear only for groups that were non-empty earlier in the session.
   - `VIEW_PROOF.review` may change. Keep "Gentle prompts. Nothing changes until you choose an action." as a quiet footer line.
4. **Archive test.** It expects `Done · archived` text, a `Restore` button, `findByText('Archive is empty')` after restore, then Undo that writes `setArchived` true again. `Presence` in happy-dom exits on `animationend` or a 320 ms fallback, which fits inside `findBy`'s 1 s timeout.
5. **Shared Menu.** `@hq/ui` `Menu` takes `items` with `checked` (radio), and it takes `trigger` and `triggerLabel`. Its list is absolutely positioned. It has no submenus.
6. **`position: fixed` and containment.** A `container-type` or `contain: layout` ancestor becomes the containing block for fixed descendants. Render the drag ghost through a portal to `document.body` with class `wk-overlay`. The theme defines its variables on `.work-ui, .wv, .wk-overlay`. Then container queries on `.wv-week` are safe.
7. **Fixtures** (`views/fixtures.ts`): today is Wed 2026-10-21, so the Sun-start week is Oct 18–24.
   - `ex-shed-paint`: Deadline Sat Oct 24.
   - `ex-library`: Event today 10:30.
   - `ex-choir`: Event Fri 18:00.
   - `ex-seed-tray`: overdue Deadline Mon Oct 19, status Next.
   - `ex-bread`: week Target two weeks out.
   - `ex-postcards` and `ex-library`: Inbox.
   - `ex-bike`: On hold.
   - `ex-kite`: Done. `ex-pond`: Dropped.
   - `ex-old-recipes`: archived.
8. **Cone problem.** Review has no extra file slot: only `Review.tsx`, `Archive.tsx` and `review.css` are allowed, so triage logic lives in `Review.tsx`. New test files are allowed only as `views/test/plan-week*.test.tsx`. I planned `views/test/review-triage.test.tsx` and `views/test/archive.test.tsx` for the Review and Archive cases, which is slightly outside the literal cone. See the open questions.
9. **Shell quirk.** The Bash tool's working directory drifts between calls. Use absolute paths or a `cd` prefix on every command.

## Design decisions made (nothing coded yet)

### Plan week

**Model** (`plan-week-model.ts`, pure and unit-testable). Planned function and type names (not yet written):
- `planBoard(items, settings, today, offset)` returns `{ start, end, weekValue, days[], dayCards, weekCards, backlog groups, inbox, planned }`.
- Each day carries `{ iso, short, label, today, past, count }`.
- `planDrop(card, zone, board)` returns `{ patch, badge, message, announce, effect } | null`.
- `kindChange(card, kind)` handles the kind menu.
- `keyTarget(card, direction)` handles Alt+←/→.

**Card identity.**
- A card is an (item, date entry) pair. An item with two dates that week shows two cards, and a drop moves only the date its card represents.
- Backlog cards have no entry.
- Motion key is `item.id` when the item has exactly one card on the board, else `${item.id}~${entry.id}`. This lets a backlog-to-day move glide across columns with the same key.

**Day columns and lane.**
- Day columns hold day-precision entries of live, open items within the week. Done and Dropped items do not appear.
- Overdue open deadlines are excluded from day columns and always surface in the backlog's "Overdue deadlines" group, until the item has another card placed that week.
- The "This week, no day" lane holds week-precision entries equal to `weekValue`.
- Apply `matchesFilters` with `env.filters`.

**Backlog groups.**
- An item with any card on the board is not in the backlog.
- Otherwise its group is, in priority order: Overdue deadlines, then Now (horizon `now`, status in considering, next or active), then Next, Active and Considering by status.
- Inbox is a separate collapsed disclosure showing its count and a link that calls `env.navigate?.({ view: 'review' })`. Expanded, its cards are draggable.
- On hold, Done, Dropped and archived items are excluded.

**Drop rules** (one patch each; status, horizon and other dates are never touched):

| From | To a day | To "This week, no day" | To backlog |
| --- | --- | --- | --- |
| Backlog card | `addDatePatch(item, 'target', day)`, badge `Set Target · Tue Nov 4` | New week-precision Target, badge `Set Target · this week` | No change |
| Day card | `rescheduleDatePatch`, badge `Move Deadline to Thu`; same day is no change | Same entry becomes week precision and clears time, end_time and tz, badge `Move Target to this week, no day`. This is a deliberate precision change, named in the badge and undoable. | `removeDatePatch` of that entry only, badge `Remove Target · back to backlog` |
| Week card | Pin: same entry becomes day precision, kind kept, badge `Pin Target to Tue Nov 4` | No change | `removeDatePatch` |

- Past days stay droppable but muted. Muted past days are a style, not a refusal.
- Kind menu: shown on placed cards, a radio `Menu` (Target, Start, Deadline, Event) that changes only that card's entry. It is revealed on hover or focus-within and stays in the tab order.

**Keyboard.**
- `P` opens the card's "Plan for…" `Menu` (the days, "This week, no day", "Back to backlog"), the same way the board's `M` clicks its menu trigger.
- Alt+←/→ always calls `preventDefault`.
  - On a day card it moves to the adjacent day only. At either end it announces and does nothing, and the menu handles Backlog and week.
  - On a backlog card, Alt+→ plans onto today if it is in the shown week, else the first day.
  - On a week card, Alt+→ pins to today or the first day.
- Refocus the moved card after the move by `[data-plan-item=<itemId>]` (preferring the same entry id), as the board does with `data-card-id`.
- Announce every move through `env.announce`.

**Header.**
- `PageHeader` title "Plan week" with `titleId="wv-week-title"`.
- Meta is `Week of Nov 2 – 8` plus the planned count. Use `Oct 26 – Nov 1` across months, and add a year only when the week's end year is not today's.
- Actions are ‹ / This week / ›. The week offset is remembered with `useRemembered('week.offset', 0)`.

**Drag.**
- A local controller in `plan-week-drag.ts`, copying the board's thresholds (5 px for a mouse, 320 ms hold for touch). Do not import `board/drag.ts`.
- Ghost portalled to body, positioned and tilted through CSSOM. Tilt is `tiltFor` from a smoothed pointer velocity, applied imperatively so React re-renders only when the target zone changes.
- Source card shows as a dashed placeholder. The target zone gets a highlight, and an end-of-column drop slot.
- On drop, the ghost carries the badge. Then `settleGhost(ghost, destinationCardRect, done)` and `flash(card)`:
  - The destination card is hidden with `is-landing` until the ghost lands.
  - Its `data-hq-motion-key` is left off for that one render, so FLIP does not double-animate it, while the other cards still glide.
  - Fall back to flying back to the source after ~800 ms if the write was refused.
- Escape cancels and flies the ghost back to the source card.
- Edge auto-scroll: a requestAnimationFrame loop scrolls the board horizontally and the nearest scrollable ancestor vertically.
- `useListMotion` goes on the board root, with order `${zone}/${motionKey}`.

**Layout.**
- Horizontal grid: sticky backlog (~232 px), seven day columns (min ~144 px), then the week lane. At about 1080 px of content width this scrolls horizontally; the sticky backlog stays visible.
- Narrow (container query, below ~760 px): stack the zones vertically. Backlog groups collapse.
- Today's column is emphasised with the word "Today" (not colour alone). Past days are muted with a screen-reader word.
- Cards show the title, `KindIcon` and chips (Why, Horizon, the date chip, and an overdue chip for any overdue deadline on the same item). `DoneButton` and the "Plan for…" menu are overlaid top-right on hover or focus-within, and always visible under `@media (hover: none)`.
- No inline `style` attributes.

**Done.** `DoneButton` with `onDone` calling `env.run(env.store.move(id, 'done', { place: 'top' }), 'Moved “X” to Done.')`.

### Review

**Layout.** `PageHeader` "Review" with meta "N prompts · M resolved this session" (omit the resolved part at zero; "All clear" when nothing is left). Groups are a card grid per mockup 11. The triage queue spans the full row; the other groups flow in two or three columns. The gentle-prompts line is a quiet footer.

**Rows and exits.**
- Every row sits in `<Presence motion="collapse">`.
- Keep departed rows mounted with a `mergeRows(prev, current)` helper (prior order, departed rows reinserted after their previous sibling, `present: false`), and prune them in `onExited`.
- An Undo brings the row back with the enter animation.
- Use `useListMotion` on the groups grid keyed by group id, so groups glide up when another empties.

**"Resolved this session".**
- Per group, keep the set of row keys ever seen (`useRemembered('review.seen', {})`, which `resetViewMemory` clears in tests).
- Resolved = keys seen but not currently present (an Undo decrements it).
- Derive the union during render and persist it in an effect.
- Row keys: `item.id` for item groups, `item.id:entry.id` for date groups.

**All clear.**
- A group that had rows earlier this session and is now empty collapses to an "All clear" line.
- When everything is clear and something was seen, replace the lines with one quiet hero (`Presence rise`, no confetti).
- When nothing was ever seen (`items: []`), keep the existing `StateView empty` "All clear".

**Triage queue.**
- Each row has Why and Horizon as `wk-chip` toggle buttons with `aria-pressed`. A pressed button is clearly filled; reuse the `wk-chip--need|want|exploring` hues for Why.
- A "Move to" row has Considering, Next, Active, On hold, Done and Dropped. Next is styled as the primary default.
- Progress line: `N of M sorted this session`, where sorted means left Inbox this session and M is the Inbox rows ever seen.
- Every action stays one store call with Undo.
- Choice keys are scoped to focus inside the queue section:
  - Why: N, W, E.
  - Horizon: 1 Now, 2 Soon, 3 Later, 4 Someday.
  - Move to: C Considering, M Next (default), A Active, H On hold, D Done, X Dropped.
  - Each key shows as a `wk-kbd` chip on its button.
  - The keymap deliberately avoids first-letter collisions (Need, Now and Next all start with N).
- Keys apply to the row containing focus and are ignored with ctrl, meta or alt, and when `isTyping`. They call `preventDefault` and `stopPropagation`.
- ↑/↓ move between rows (roving tabindex), and Enter on the row itself calls `env.openItem`.
- After a Move to, focus the next row (or the previous if last) when focus was inside the departing row.

**This week strip.** Read-only. In the last seven days, count items by `updated_at` and status: Done as finished, Dropped as dropped, and newly created (`created_at`) as captured. It writes nothing.

### Archive

- `PageHeader` "Archive" with a count in the meta.
- Mockup-grade rows; keep the sub text `<Status> · archived <ago>`.
- Restore leaves through `Presence`, then Undo as today.
- The empty state stays "Archive is empty".

## What is left, in priority order

1. Verify the optimistic projection of a new `dates` entry with no id (`store.ts` ~160–215), then write `plan-week-model.ts` with unit tests: patches, `sun` and `mon` day order, past and today flags, never inventing a date, removing only the planning date, and badge text.
2. Build `PlanWeek.tsx` and `plan-week.css`: header, columns and cards, the `Menu`s, keyboard moves, then pointer drag, the ghost and landing. Write tests for a drop and a keyboard plan each making one patch with Undo.
3. Replace `VIEW_PROOF.week` with real strings (day labels, "This week, no day", "Overdue deadlines", the week-of meta).
4. Rebuild Review in `Review.tsx` and `review.css`: summary, group cards, Presence exits, All clear, triage queue with keys, This week strip. Test summary counts, All clear, triage progress and that scoped keys never reach a window-level `n` or digit listener.
5. Rebuild Archive and `PageHeader`, plus the Restore test.
6. Run `npx tsc --noEmit -p .` and `npx vitest run modules/work --no-file-parallelism` once the host load is under 13.
7. Capture screenshots. Build with `bash /tmp/hq-f2/tools/preview-build.sh <worktree> /tmp/hq-f2/plan-review/preview`, serve it on port 4304, then run `shot.mjs`. The list is in the brief: Plan week, Review and Archive at 1440 light and dark and at 760×600 light, plus mid-drag with its badge, the drop end state, the "Plan for…" menu, the triage queue, a group showing All clear, and the everything-clear state. Review every shot.
8. Final report in the brief's format, ending with the required last line.

## Open questions and risks

- **Test file placement.** May Review and Archive cases go in new `views/test/review-triage.test.tsx` and `archive.test.tsx`? The cone names only `plan-week*.test.tsx` plus `VIEW_PROOF` edits. The alternative is to name them `plan-week-review.test.tsx`, which is a poor name.
- **Day-to-week conversion** (dragging a dated card onto "This week, no day") loses its day and clears any time. The brief did not spell this case out; I chose to allow it with a clear badge and Undo, over refusing it. Confirm.
- **Overdue deadlines in the current week.** They are shown only in the backlog's Overdue group, not in the past day column. This is a choice, to keep them in view, that I'd like confirmed.
- **Slice E's rework** of `PlanningViews.tsx` should keep the `env.run` and `env.announce` contracts. Plan week relies on both. Its toasts may also announce, so check that moves are not read out twice.
- **Width.** At about 1080 px of content, nine columns do not fit, so horizontal scroll is expected. The width may improve if slice E's compact chrome frees more room; recheck once E lands.
- **Local pieces that slice A or the lead may want to promote:** the drag controller and ghost (`plan-week-drag.ts`) and the `mergeRows` helper.
- Machine load was 31–48 during this session. The tests and the build need a quieter host.

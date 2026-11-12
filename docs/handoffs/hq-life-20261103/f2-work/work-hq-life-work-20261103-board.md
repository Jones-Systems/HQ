# Handoff: F2 builder A (Board), Status board and By date

Paused on request of the owner (relayed by the F2 lead) before verification. **All source is written, committed and
pushed. Typecheck passes. No test has been run, no preview has been built and no screenshot has been taken.**

- Branch: `work/hq-life-work-20261103-board` (created from `work/hq-life-work-20261103` @ `18e6502`)
- Worktree: `~/.t3/worktrees/HQ/work-hq-life-work-20261103-board`
- Code commit: `c63d414` (`WIP: Board and By date to mockup grade with drag physics (tests not yet run)`). The head SHA is
  the handoff commit that follows it; read it with `git rev-parse HEAD`.
- Preview port reserved for this lane: 4301. No server of mine is running.

## Where things stand, by finding

Everything below is **written but unverified at runtime**. "Done" means the code exists and typechecks.

| Finding / deliverable | State |
| --- | --- |
| X-2 header: `PageHeader` "Status board", card count and project-scope note word for word, compact Keyboard popover | Written (`StatusBoard.tsx`, `KeyboardHint.tsx`) |
| X-4 / columns: 288px columns, compact head (dot, name, `.wk-count` pill), Inbox as the visible capture landing | Written (`BoardColumn.tsx`, `board.css`) |
| Columns decision (Flow 4): overflow edge fade plus keyboard-reachable scroll buttons; collapsed slim rails with vertical label and count, remembered collapse semantics kept, rails accept drops with highlight | Written |
| X-7 cards: why stripe, kind icon, 13.5px semibold title, chips row, meta row, hover lift, selected state, focus ring | Written (`BoardCard.tsx`, `board.css`) |
| X-8 Done control: shared `DoneButton` on hover and focus-within, always keyboard reachable, absent on Done and Dropped, one move to Done at the top with Undo | Written |
| D-1 drag physics: lift with tilt (CSSOM, rAF), placeholder holds the slot, neighbours glide through `useListMotion`, badge names the effect, `settleGhost` plus `flash` on landing, Escape flies the ghost back, refused move shakes the card | Written (`useBoardDrag.ts`, `BoardColumn.tsx`) |
| D-2 narrow layout: under ~640px of board width, status tabs with counts, one column at a time, tabs accept drops and highlight | Written (`StatusTabs.tsx`, `StatusBoard.tsx`) |
| Capture landing: `data-wk-capture-target="inbox"` on the Inbox list, new Inbox cards rise in and the column flashes, nothing animates on first load or remount | Written |
| By date board in the same visual language, still read-only (`BY_DATE_INERT`, status-only menu), banner replaced by header meta plus one quiet note | Written (`ByDate.tsx`, `by-date.css`) |
| Board-shaped loading skeleton | Written (`BoardSkeleton.tsx`) |
| Tests to add | Written (`board-alive.test.tsx`, `layout.test.ts`, three added cases in `by-date.test.tsx`); **not run** |
| Screenshots (1440 light and dark, 760×600 light, five interaction states) | **Not started** |
| Desktop integration tests (lead's note) | **Not run** |

## Files changed (all inside my cone)

Modified: `modules/work/board/StatusBoard.tsx` (rewritten), `board.css` (rewritten), `drag.ts` (additive), `moves.ts`
(additive `describeDrop`), `index.ts` (exports `describeDrop` and `DragEnd`), `modules/work/views/ByDate.tsx`
(rewritten), `by-date.css` (rewritten), `views/test/by-date.test.tsx` (import changed, three tests added).

New: `board/BoardCard.tsx`, `BoardColumn.tsx`, `BoardSkeleton.tsx`, `KeyboardHint.tsx`, `StatusTabs.tsx`, `icons.tsx`,
`useBoardDrag.ts`, `board/test/board-alive.test.tsx`, `board/test/layout.test.ts`.

Test assertions changed: none. One import in `by-date.test.tsx` changed to `import { BY_DATE_BANNER, BY_DATE_INERT }`
from `../ByDate`. I did not weaken or delete any existing assertion. Not touched: `board/parts.tsx`, `feedback.*`,
`SyncStatus.tsx`, `WorkToasts.tsx`, `theme/**`, `motion/**`, `views/parts.tsx`, `views-base.css`, `views/index.ts`,
`views/test/harness*`.

## Decisions and why

- **Drag model: the source keeps its slot as a dashed placeholder and a gap opens at the target.** The ghost is portalled
  to `document.body`, positioned by an rAF loop writing CSSOM `transform` (CSP forbids inline `style`). Landing settles
  the ghost onto the card's new slot with `settleGhost`, then `flash`. A landing card is hidden (`data-landing`) until
  the settle ends so there is never a duplicate.
- **One `useListMotion` ref on the board root**, not one per column. FLIP then measures every descendant, so cards glide
  across columns as well as within one. `animateEntering:false` keeps first render still.
- **Narrow layout is measured from the board's own width** (`getBoundingClientRect` plus `ResizeObserver`), not the
  window, and the first paint waits for the measurement so a narrow board never flashes wide.
- **Narrow mode:** the column head is a static span (not a collapse toggle), so tabs never change the remembered
  collapse state. A keyboard status move follows the card to its new tab.
- **`drag.ts` is extended additively only:** `DropTarget.zone?: 'tab'` and an `onEnd` report (reason, id, target, x, y)
  fired before `onChange(null)` and before `onDrop`. Existing callers behave as before.
- **Capture landing compares against every live item**, not the filtered view, so a filter change is never mistaken for
  a new card. Inbox is scrolled back into view when a capture lands off-screen.
- **Reduced motion is checked in JS** (`prefersReducedMotion()`: no tilt, no flight, ghost removed at once) and in CSS
  through the duration tokens.
- **Keydown handling:** only `.work-card-menu` stops key events from reaching the card. The Done button does not, so
  Ctrl+Z and Alt+arrows still work after focusing it.
- **Desktop shell hooks kept** (per the lead's note): each card is an `<article>` named exactly by its title
  (`aria-labelledby`), keeps `data-card-id` and is focusable; Alt+Arrow sends one move; click opens the detail panel;
  the page heading is level 2 "Status board"; the toast button is "Undo".

## Findings so far

- `npx tsc --noEmit -p .` passes (last run after all source edits except the small `index.ts` export change, which is
  type-only and trivially safe; re-run it first thing).
- **Not run:** `modules/work/board` tests, `by-date.test.tsx`, the rest of `modules/work`, the three desktop
  integration tests, any build or screenshot. The host load stayed between 45 and 70 against a limit of 13, and I
  queued a wait-for-quiet job, which I then stopped on the pause request. `/tmp/hq-f2/board/vitest-board.log` does not
  exist.
- Likely failure points when tests first run (my own suspicions, none confirmed):
  1. Existing board tests against the new DOM (`board.test.tsx`, `recovery.test.tsx`, and consumers of `board/test/host`
     in `detail`, `capture`, `references`, `nav`).
  2. The shake test provokes a refused move by a conflicting move from another device; the fixture may not produce a
     `failed` outcome.
  3. happy-dom's handling of `style.getPropertyValue('transform')` in the drag assertions.
  4. The narrow tests mock `getBoundingClientRect` and stub `ResizeObserver`; the layout hook reads both.
  5. The `hq-flash` and `hq-enter-rise` class expectations after a create.
- Setup quirk in my worktree: it had no `node_modules`. I built a real `node_modules` directory whose third-party entries
  (including `.bin`) symlink to the lead's install, and whose `@hq/*` entries point at this worktree's own packages and
  modules. A plain symlink of the lead's tree would have resolved `@hq/work` and `@hq/ui` into the lead's worktree and
  invalidated the desktop integration tests and the preview. `node_modules` is untracked; the next owner of this
  worktree may need to recreate it (check `readlink node_modules/@hq/work`).

## What's left, in priority order

1. `cat /proc/loadavg`, then `npx tsc --noEmit -p .`.
2. Run `npx vitest run modules/work/board modules/work/views/test/by-date.test.tsx --no-file-parallelism` (load below 13,
   serial, scoped). Fix failures in my new tests first; for existing tests fix the component, never the assertion,
   unless the old assertion encodes the old DOM, and then record the change in the final report.
3. Run the other `board/test/host` consumers, then `npx vitest run modules/work --no-file-parallelism` once.
4. Run `npx vitest run apps/desktop/src/social-work.integration.test.tsx apps/desktop/src/references.integration.test.tsx apps/desktop/src/preview/composition.test.tsx --no-file-parallelism`.
5. Build the preview (`bash /tmp/hq-f2/tools/preview-build.sh <worktree> /tmp/hq-f2/board/preview`), serve it on 4301
   with `python3 -m http.server 4301 --bind 127.0.0.1 --directory /tmp/hq-f2/board/preview`, and capture with
   `/tmp/hq-f2/tools/shot.mjs` into `/tmp/hq-f2/board/after/<view>-<width>-<scheme>.png`: board and By date at 1440×900
   light and dark, 760×600 light, plus mid-drag with badge, drop settle end state, Done hover, a collapsed rail and
   narrow tabs. Review against evidence 01, 03, 06, 12 and `work-hq.html`, and against `/tmp/hq-f2/before/`. Check:
   clipped titles or chips, dark-mode depth, baseline grid, overflow at 760px, By date's note wrapping to two lines at
   1440. Stop the server afterwards.
6. Commit, push, and write the final report in the brief's format (last line exactly:
   `Branch work/hq-life-work-20261103-board, head <SHA>, pushed <yes|no>, checks <tsc pass|fail>; <vitest N passed, M failed>`).

## Open questions and risks

- **No vertical auto-scroll during a drag.** Horizontal edge auto-scroll exists; a very tall column cannot be scrolled
  by dragging near its top or bottom edge.
- **The Done check animation is invisible**, because the card leaves its column immediately on the optimistic move.
  Is the shared Done motion expected to play on a card that is going away? A shared-change question for the lead.
- **`SaveState` is still in the board header actions.** If the top-bar status indicator now covers it (slice E), it
  can be removed from `StatusBoard.tsx`; I left it because removing it was not in my brief.
- **By date's note** may wrap to two lines at 1440. The brief allowed header meta or one quiet line; judge from the
  screenshot.
- **Unrun code is the main risk.** The whole drag/settle/narrow path is only typechecked. Treat the first test run as
  the real review.
- No shared changes needed so far; nothing outside the cone was edited.

## What exists only outside the branch

- `/tmp/hq-f2/board/run-when-quiet.sh`: waits for the 1-minute load to drop under 13, then runs one command into a
  log. Scratch tooling, safe to delete.
- Nothing else of mine is in `/tmp/hq-f2/board/`: no screenshots, no preview build, no logs, because none were produced.
- This thread holds the review notes above and nothing else that is not in the commit.

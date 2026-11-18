# Handoff: HQ lane F2, slice E (Frame, capture, Glance, feedback)

Branch: `work/hq-life-work-20261103-frame`, pushed to origin. Base: `work/hq-life-work-20261103` at `18e6502`.
Code head before this handoff commit: `6c82b31` (`WIP: Work frame lane F2 slice E ...`). The handoff commit is the branch tip.
Worktree: the `work-hq-life-work-20261103-frame` folder beside the lead's Work worktrees.
Author: Claude Sonnet 5.5 builder, paused by the coordinator before it finished. Nothing in this slice has been tested.

## Read this first

- **No tests, typecheck, build or screenshots were run.** The machine load was 40+ for most of the session and the worktree had no `node_modules` until late. Treat every file below as unverified source.
- `WorkDomain.tsx` is **not rewired yet**. It still renders the old frame (old toolbar, `FeedbackToasts`, local `FilterBar`, `Toast` imports). The new pieces exist beside it and are not mounted. The old file should still compile, but that is unchecked.
- `node_modules` in this worktree is a gitignored directory of per-package symlinks into the lead's `node_modules`, with `@hq` pointing at this worktree's packages. It is the same setup the board, calendar-timeline and list-detail builders use. It is not committed.
- `/tmp/hq-f2/frame/` is empty. No preview server is running. No screenshots exist.

## Status by finding

| Finding | State |
| --- | --- |
| X-3 one feedback system | Mostly written, unverified. See "Feedback" below. |
| X-2 compact top bar | Components written (`nav/TopBar.tsx`, `nav/ToolbarCapture.tsx`); **not mounted, no CSS**. |
| X-5 nav | `routes.ts` reordered with number keys, `WorkNav.tsx`, `icons.tsx`, `keys.ts` written; **not mounted, no CSS, counts not computed yet**. |
| X-4 page transitions | Not started (plan below). |
| C-1 capture flight | `capture/landing.ts` and the call in `ToolbarCapture` written. `QuickCapture` (dialog) not yet calling it. |
| C-2 compact capture | `ToolbarCapture` rewritten (field, `N` hint, popover lines); **no CSS**. |
| C-3 dialog chips, hints, scale-in | Not started. |
| F7-X15 | Done in `ToolbarCapture` (effect clears `unavailable` once `offline` is false). No test yet. |
| F7-X6 layout | `nav/DetailSheet.tsx` and `nav/useWidth.ts` written; not wired, no CSS. |
| F7-X5 | **Not investigated.** Only fact I know: `examplePlanner` in `nav/session.ts` builds items from `viewItems(...)` in `views/fixtures.ts`, not from `core/fixtures/examples.ts`. I did not read either. |
| Glance | Not started. |
| D-3 Weekly plan route link to Plan week | Not started (one `StateView` branch in `WorkDomain.tsx`). |
| `docs/ui-map/work.md` | Not started. |
| Tests | None added or changed. A list of tests that must change is below. |

## What is on the branch (all under `modules/work/`)

### Feedback (X-3)
- `board/feedback.ts`: same exported API (`createFeedback`, `sharedFeedback`, `useFeedback`, `push`, `dismiss`, `dismissUndo`, `getState`, `TOAST_LIMIT`, `PLANNING_ONLY_META`). Additions: `tone: 'unknown'`, and `feedback.key` (unique per list, used to namespace toast ids). `dismiss` and `dismissUndo` no longer emit when nothing changes.
- `board/WorkToasts.tsx`: **bridge, not a renderer.** It mirrors the feedback list (and `state.notices`) onto F1's toast store through `useToast()`, and writes dismissals back to the list.
  - `info` with `undoId` becomes a `success` toast with an Undo action only while the undo entry is still on the stack. Undo runs at most once (a `spent` set) through `undoFromToast`.
  - `warning` with the `UNCONFIRMED_TOAST` text becomes `unknown` with a **Check** action (`store.reconcile()`); other `warning` stays `warning` but sticky (`duration: Infinity`) to keep the existing "stays past eight seconds" test; `danger` is F1 `danger`.
  - Every toast gets meta `Planning change only · no run started` unless it has its own.
  - Ctrl/⌘+Z removes the toast through `feedback.dismissUndo`; the bridge then dismisses the F1 toast.
  - Programmatic dismissals (unmount cleanup) are ignored by the write-back, so leaving Work dismisses its toasts from the shared viewport but keeps them in the list for the return.
  - **Fallback viewport:** if no `.hq-toast-viewport` exists in the document (test hosts, evidence pages, `live-services` render), it mounts F1's `<ToastViewport label="Work notifications" />` itself. In the shell it adds nothing. Reason: the board test host, the views harness and `live-services` render Work without the shell's viewport, and I could not edit those hosts.
- `board/SyncStatus.tsx`:
  - `syncIndicator(state, zone)` is the **single pure mapping** the lead asked for: `{ tone, label, detail?, busy?, action? }`. Cases: offline → `Offline`, `last synced 10:42 · changes paused`, action Try again; unconfirmed → `N unconfirmed`, action Check; saving → `Saving…`; saved → `Saved`, `10:42`; idle → `null`. No unit tests yet.
  - `SyncIndicator` renders it with F1's `StatusIndicator`. `TopBarStatus` / `TopBarStatusContext`: the Work top bar sets it so the board header's `SaveState` and the in-page offline bar stay quiet there, and speak when the board or views are mounted alone (test hosts). This avoids editing `StatusBoard.tsx`.
  - `SyncBanners` now renders compact `InlineNotice` bars: offline (only without the top bar; text kept as `${OFFLINE_BANNER}. What you see may be out of date.` so `board.test.tsx` line 261 still matches), held, and the unconfirmed section (still `aria-label="Unconfirmed changes"`, title `N unconfirmed`, `Check now`, Apply and Stop tracking rows unchanged). Returns `null` when empty.
- `board/feedback.css`: reduced to the notices and the capture's offline bar.
- `views/PlanningViews.tsx`: no own `Toast`, `ToastRegion` or banners. New optional prop `feedback`. Without it (harness) it creates its own list, shows `SyncIndicator` and mounts `WorkToasts`; with it (the domain) it shows neither. Writes go through the board's `reportWrite` (one mapping place). Ctrl/⌘+Z uses `undoLatest` and posts `Nothing to undo.` when the stack is empty. It renders `SyncBanners` plus a compact `InlineNotice` per conflict ("Changed elsewhere"). Loading uses a new `PageSkeleton` (rows, columns or grid, `data-state="loading"`, `aria-busy`, still says "Loading planning…"); `StateView` only when the Planner never answered. `failureText` is still exported with its original words (now unused).
- `views/env.tsx`: additive `feedback: Feedback` on `ViewEnv`.
- `views/frame.css`: topline, notices and skeleton styles.

### Nav and top bar (X-2, X-5)
- `nav/routes.ts`: `NAV_ITEMS` order is Glance, List, Calendar, Timeline, Review, Archive (Views), then Status board, By date, Plan week (Boards), then Planner settings. Each item may carry `key` from `WORK_VIEWS` (glance 1, board 2, list 3, calendar 4, timeline 5, review 6, archive 7). New `numberKeyDestination(key)`.
- `nav/WorkNav.tsx`: line icon per item, counts via `NavCounts`, key hint `kbd`, `aria-keyshortcuts`, `aria-current`. Counts and key hints are `aria-hidden`; the count words sit in a sibling `hq-sr-only` span referenced by `aria-describedby`, so each button's name stays exactly its label (a shell-test requirement). The Status board item has `data-wk-capture-target="nav"`.
- `nav/icons.tsx`: `NavIcon`, `PlusIcon`, `SearchIcon`, `FilterIcon`, `CloseIcon`, `InfoIcon`.
- `nav/keys.ts`: `numberKeyTarget(event)` and `useNumberKeys(root, open)`. Ignores typing (`isTyping` from `views/env`), modified keys, repeat, composition, `defaultPrevented`, and keys inside a modal dialog.
- `nav/TopBar.tsx`: `FilterBar` (group `Filter planning`, always rendered; search input and Kind, Horizon, Area label native selects styled as chips with a per-chip clear button and `Clear filters (n)`; a `Filters` toggle that only matters at narrow widths by CSS), `ExampleMarker` (badge button; the full `EXAMPLE_NOTE` is a `role="note"` element always in the DOM, shown by CSS on hover/focus/open), `BarStatus`. `EXAMPLE_NOTE` is defined here too; `WorkDomain.tsx` still defines its own copy until rewired, then re-export from here.
- `nav/ToolbarCapture.tsx`: compact field with plus icon, `N` `kbd` (hidden once there is text), Capture button only when there is text, "Status or date…" button, and a `wd-capture-pop` block (error, date suggestion, chosen date, "Planner unreachable · nothing was saved" bar with **Keep as HQ draft**, and the honesty note as the field's `aria-describedby`). On a saved create it calls `landCapture(fieldRect, title)`. F7-X15 effect included.
- `nav/DetailSheet.tsx`, `nav/useWidth.ts`: overlay sheet (scrim, "Close details" button, Escape, focus in on open and back on close, `SHEET_BREAKPOINT = 720`). `useWidth` returns 0 when unmeasurable; treat 0 as wide.
- `capture/landing.ts` (exported from `capture/index.ts`): `captureTarget()` picks the first visible `[data-wk-capture-target="inbox"]`, else the visible `nav` target; `landCapture(from, title)` calls `flyTo`.

## Lead notes that shaped the code (all still binding)

1. **Shell tests** (`apps/desktop/src`, read-only, must keep passing): nav buttons named exactly their label, `aria-current="page"`; `group` "Filter planning" always rendered with a native `<select>` labelled "Kind" (option `chore`) and a text input labelled "Search", values persisting across domain switches, inline and chip-styled, popover only at narrow widths and only by CSS; `form` "Quick capture" with textbox "Capture to Inbox" (Enter submits); after an unknown capture the visible text "1 unconfirmed" and a "Check now" button (not in a closed popover; the board's `SyncBanners` keeps both); `.wv[data-view]` and `.wd-scroll` inside `main` with scroll restore; Undo button named exactly "Undo"; one undo per Ctrl/⌘+Z. Before the final push run: `npx vitest run apps/desktop/src/social-work.integration.test.tsx apps/desktop/src/live-services.integration.test.tsx apps/desktop/src/references.integration.test.tsx apps/desktop/src/preview/composition.test.tsx --no-file-parallelism`.
2. **B1 forward-compatibility**: the top-bar indicator is the pure `syncIndicator` mapping so B1's `connection.reason`, `queued` and `durable` states can slot in. Do not code against them. Keep "Offline · last synced <time> · changes paused" for the plain unreachable case (done). B1's section "What the Work UI shows" in its backend assessment (branch `work/hq-backend-planner-20261103`) lists the wording to stay compatible with.
3. **Offline-kept outcomes**: an edit that finds the Planner unavailable in live mode will become `failed` + `error.kind === 'unavailable'` + `queued`, to be shown as "Kept on this device · sends when the Planner is back", never as a rollback or "Not saved". Creates are never queued (capture stays an HQ draft). Every write outcome routes through one mapping: in this slice that is the board's `reportWrite` (in `board/actions.ts`, slice A's file) which `PlanningViews.run`, `ToolbarCapture` and `QuickCapture` all use. The lead adds the queued case there once, at integration. `failureText` in `PlanningViews.tsx` is the one stray copy of failure words; it is unused, so delete it or route it to `failureMessage`.

## Decisions and why

- **Bridge, not a second toast UI.** F1 says use `toast`/`useToast`. `feedback.push` has to stay stable for slices A and B, so the feedback list stays and `WorkToasts` mirrors it. Remounting Work dismisses and later re-shows toasts, matching the old "hidden while away" behaviour.
- **Fallback viewport in `WorkToasts`** so existing hosts keep working without edits. It detects the shell's viewport by class. Alternatives (editing `board/test/host.tsx`, the views harness) are outside my cone.
- **Filters stay inline selects, not a JS popover** (lead note 1). The brief's "Filter button with popover" becomes a CSS-only narrow-width fold; chips are the filled selects with a clear button.
- **Project note once per page**: boards render their own (slice A); `PlanningViews` renders the one `role="note"` for views; Settings keeps its own. The top bar never renders it.
- **Offline**: top-bar `StatusIndicator` is the persistent signal; the in-page offline bar exists only when no top bar is present (matches the mockup 12 bar in standalone hosts, avoids two bars in the app).
- **Number keys do not use Shift** and skip repeat and dialogs. `N` still opens the dialog (existing tests); the `N` hint's tooltip says so.
- **Sheet close affordance**: a bar with "Close details" is added by the sheet. `CardDetail` has its own "Close card", so two close controls show in sheet mode. Slice B can drop theirs in sheet mode or the lead can hide one.

## What is left, in priority order

1. **Rewire `nav/WorkDomain.tsx`** (everything else hangs on it):
   - Replace the toolbar block with one `.wd-topbar` row: `ToolbarCapture`, `FilterBar` (not on `settings` or `plan`), then `.wd-topbar-end` with `BarStatus` and, when `session.example`, `ExampleMarker`. Wrap the whole domain subtree in `<TopBarStatus>` (from `../board/SyncStatus`). Delete the collapse/"Hide capture & filters" feature, `FeedbackToasts`, the local `FilterBar` and the `Toast`, `ToastRegion`, `TOAST_AUTO_DISMISS_MS` imports. Re-export `EXAMPLE_NOTE` from `./TopBar`.
   - Mount one `<WorkToasts>` for every page. Pass `feedback={feedback}` to `PlanningViews`. Render `SyncBanners` only on the board page.
   - Replace local `WorkNav` with `./WorkNav`; compute `counts`: Status board = live items with status `inbox`; Review = sum of `reviewBucketsFor(live items, settings, now)` bucket sizes (inbox, overdue, passedTargets, stale, mismatched, unsorted). Check against slice D's Review header number.
   - Navigation: `const go = (d) => navigateWithTransition(() => navigate(d))` for nav clicks and `useNumberKeys(rootRef, go)`; wrap page `body` in `<PageTransition id={pageKey}>` inside `ScrollArea`.
   - Detail: `useWidth(areaRef)`; when `0 < width < SHEET_BREAKPOINT` and `itemId`, render `<DetailSheet label="Item details" onClose=...>` around `CardDetail` and set `inert` on `.wd-side`, the top bar and `.wd-scroll`; otherwise the existing splitter panel.
   - Settings loading uses `PageSkeleton` (export it from `views/PlanningViews`; import by path, not the lead-owned `views/index.ts`). Plan route (`board/plan/<id>`) keeps "Proposed — not available" and gets a second action linking to `board/week` (StateView has one action: add a small link row below it).
   - Single-page `h1` sr-only stays.
2. **CSS** in `nav/nav.css`: `.wd-topbar` (44–52 px, one row, `container-type` queries at about 880 px for the filter fold), `.wd-capture*` (field, expand on `:focus-within`, `.wd-capture-pop` absolutely positioned under the field, note only on focus), `.wd-fchip*`, `.wd-filter-toggle` (hidden wide), `.wd-example*` (popover), `.wd-nav*` (icons, trail count and `kbd`), `.wd-sheet*` (layer over `.wd-workarea` with `position: relative`, scrim, end-aligned sheet, `min(100%, 440px)`), `.wd-status`. Tokens only, no inline styles, durations from `--hq-duration-*`. Goal: content starts at about 110 px or less from the window top at 1440 (it was about 190).
3. **Tests** (see list below), then `npx vitest run modules/work --no-file-parallelism`, `npx tsc --noEmit -p .`, then the four shell test files.
4. **QuickCapture** (`capture/QuickCapture.tsx`): status chip picker (radiogroup with `StatusDot`), date-kind chip picker with `DateKindIcon`, footer buttons "Save ⏎" and "Save & add another ⇧⏎" (mark the `kbd` `aria-hidden` so the button names stay `Save` and `Save & add another`), `hq-enter-scale` class on the dialog for the scale-in, `landCapture(titleInputRect, title)` after a saved create, keep "Keep as HQ draft" and the unavailable bar. Existing capture tests query `Title`, `Save`, `Add date`, `Keep as HQ draft` and the status of an "Add a card in <Column>" open.
5. **Glance** (`views/Glance.tsx`, `views/glance.css`): `PageHeader` greeting, Now rows with `DoneButton` (label `Mark “<title>” done`, `store.move(id, 'done', { place: 'top' })` through `env.run` with `PLANNING_ONLY_META` Undo; rows leave via `Presence`), Overdue and Today groups, Next 21 days agenda, Inbox count with a link to Review, Worth a look, Recently changed, theme chips throughout. `ItemRow` in `views/parts.tsx` is lead-owned and has no Done slot, so build a local row. Must keep the existing Glance assertions in `views.test.tsx` (regions `Now`, `Next 21 days`, `Worth a look`, headings like `Overdue · 1`, status-pill aria-labels `Next: 4. Open on the board`, "Sort in Review", "Open calendar").
6. **Docs**: `docs/ui-map/work.md`: new `board/week` destination, compact top bar, nav order and keys, one feedback system.
7. **F7-X5 investigation**: read `nav/session.ts` (`examplePlanner`), `views/fixtures.ts`, `core/fixtures/examples.ts` (lane B1, off limits) and Social's sample data (lane F3); report the minimal pairing and the owning lane.
8. **Screenshots** to `/tmp/hq-f2/frame/after/` as specified in the common brief, and review them against evidence 01, 02, 07, 12.

## Tests that will break or must change (predicted, not run)

My cone's tests (change on purpose, and say so in the final report):
- `nav/test/toolbar-polish.test.tsx` "keeps labelled filters and an icon collapse control together": the collapse control is gone by design (lead note 1: the group is never hidden). Rewrite to keep the labelled filters and capture-text persistence.
- `nav/test/domain.test.tsx`: "hides capture and filters behind one restore control" removed or rewritten; "labels" test (`getByRole('note', { name: '' })` must still be unique); nav-order assumptions if any; `Planner unreachable` tests remain valid and should also assert X-15 recovery without typing.
- `views/test/views.test.tsx` (host cases only): the "saving then saved" and "unknown" tests query `Saving…` / `Save result unknown` inside `[role="status"]`; the indicator is now `StatusIndicator` (`1 unconfirmed`, `Check`). "unknown" also expects the old per-write banner text ("was sent but not confirmed…"), now replaced by the shared unconfirmed section. "Ctrl+Z" tests expect `Undone.`; the board's `undoLatest` posts `Undone: <label>`. "loading" test should still pass (the skeleton keeps `data-state="loading"` and `aria-busy`).
- Expect `getByText('<toast message>')` to find **two** elements wherever F1's `ToastViewport` renders: the visible title and its `sr-only` live-region copy (same text when the toast has no description). Use `getAllByText(...)[0]` or scope to `.hq-toast-text`. This affects every suite that reads toast words with `getByText`/`findByText`: `board/test/board.test.tsx` ("Undone: Moved …"), `capture/test/capture.test.tsx` ("Captured “…” to Inbox"), `nav/test/toolbar-polish.test.tsx`, `views/test/views.test.tsx` and possibly the calendar-timeline, detail and review tests of other slices. Decide at integration whether to edit those or to give toasts a description so the live-region text differs.
- Fake-timer toast tests (`toolbar-polish`, `views.test.tsx`): F1 keeps a leaving toast in the DOM for its exit animation (about 320 ms fallback), so "gone after 8000 ms" assertions may need a small extra advance.

New tests to add (none written):
- `syncIndicator` mapping (unit, pure), including idle `null`.
- Nav: order, icons, counts (Inbox on Status board, prompts on Review), button names equal labels, `aria-current`, `data-wk-capture-target="nav"` on Status board.
- Number keys: do not fire while typing, with modifiers, or when `defaultPrevented`; do navigate otherwise (iterate `NAV_ITEMS` keys).
- Capture: compact field expands and saves; `flyTo` targets Inbox or nav (stub `getClientRects`); reduced motion shows no token; X-15 recovery clears "Planner unreachable" and "Keep as HQ draft" with no typing.
- Feedback API stays compatible (`push`, `dismiss`, `dismissUndo`, `getState`); Undo runs once (double activation); Ctrl/⌘+Z dismisses its toast; an unknown outcome gives a toast with Check and no retry.
- No full-page `StateView` once a snapshot exists (offline, refresh failure); skeleton while loading.
- Narrow overlay detail: mock `getBoundingClientRect` width below 720, open `item/<id>`, Escape closes and focus returns to the opener.
- Plan route links to Plan week.
- Existing domain and routes tests iterate `NAV_ITEMS`: keep passing.

## Risks and open questions

- Everything is unverified. Expect type errors first (`exactOptionalPropertyTypes` style conditional spreads are used on purpose; `ToastInput` fields are readonly; `Notice` type import in `WorkToasts.tsx` comes from `../core`).
- `WorkToasts`'s `signature` string trick (`|undo` suffix) decides between `toast.update(id, { action })` and `toast.show`; check that losing Undo does not re-announce.
- The fallback viewport detection runs in a layout effect; two `WorkToasts` mounting in one commit could both add a viewport. Currently only one mounts per host.
- Sheet mode remounts `CardDetail` when crossing the breakpoint. Unsaved text lives in the session `detail` state, so it should survive; verify.
- `board/index.ts` is not in my cone, so `SyncIndicator`, `TopBarStatus` and `syncIndicator` are imported from `../board/SyncStatus` by path. The lead may want to export them from the barrel.
- `StatusBoard` (slice A) still renders `SaveState` in its header; `TopBarStatusContext` silences it inside the domain. If slice A removes it, nothing breaks.
- Slice D's Review count and my Review nav count must agree; I computed nothing yet.
- Dark-mode and 760 px behaviour of everything above is unseen.

## Kept only outside the branch

Nothing important. `/tmp/hq-f2/frame/` is empty and I produced no screenshots or scratch plans. The `node_modules` symlink directory exists only in the worktree.

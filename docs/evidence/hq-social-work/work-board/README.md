# Work board evidence (task.work-board.001)

Lane WRK-B, `spec.hq-social-work#task.work-board.001`, acceptance `ac.work-board.001`, test intent `test.work-board.001`.

This is the evidence for the Work status board, card detail and quick capture in `modules/work/{board,detail,capture}`. The data is all fictional and comes from the fixture Planner. Pointer evidence is synthetic, and no touch hardware was used.

## Revisions

| | Commit | Notes |
| --- | --- | --- |
| Base | `a8c791a877bd28974894e1d48913d0ff460b6f00` | Work core, PR #26. This was the verified `work/hq-work-planner` head at launch. |
| Dependency merge | `6765772dd50d6555a0e5e7d97032dc70489fde4d` | `--no-ff` merge of the root-accepted UI kit `935dedf78e04a2697bdc02d85864546948ffcb8c` (PR #24). Its parents are `a8c791a` and `935dedf`. It touches only `packages/hq-ui/**` and `docs/evidence/hq-social-work/ui/**`, with no manual edits. |
| Authored | `120e817` | Board, detail and capture source and tests |
| Authored | `342e11b` | Fixes for problems found in the browser (see below) |
| Authored | `a1766df` | Loopback evidence harness |
| Authored | `8cdb95e` | Evidence (first published head of PR #28) |
| Dependency merge | `3654a5a862b6896811cb265c3196b1fdd54b7e2d` | A root-authorized normal merge (`ort`, no conflicts, no manual edits) of the accepted WRK-P views commit `8a3261dbd0d98dac3553ffc594cd8a88cc4dcb04` (`task.work-views.001`, the current `work/hq-work-planner` head). Parents: `8cdb95e` and `8a3261d`. |
| Authored | this commit | Evidence update for the merge |

## Dependency readback after the views merge

The two sides shared history through two merge bases, `a8c791a` and `935dedf`, because both lanes merged UI kit `935dedf` into `a8c791a` separately. Git's `ort` strategy merged cleanly. Before the merge, the only overlapping paths were the UI kit's, and their trees were identical on both sides.

At `3654a5a`, every accepted incoming tree is byte-identical to `8a3261d`:

| Tree | Tree id |
| --- | --- |
| `modules/work/core` | `60dea81` |
| `modules/work/views` | `e23b428` |
| `packages/hq-ui` | `9e212f9` |
| `docs/evidence/hq-social-work/ui` | `9c09783` |
| `docs/evidence/hq-social-work/work-planner` | `f5e0456` |

`package.json`, `package-lock.json`, `tsconfig.json` and `vitest.config.ts` are also identical to `8a3261d`.

WRK-B's owned trees are byte-identical to `8cdb95e`:

| Tree | Tree id |
| --- | --- |
| `modules/work/board` | `ad35b85` |
| `modules/work/detail` | `8be7746` |
| `modules/work/capture` | `73ae7da` |

`git diff --name-only 8a3261d 3654a5a` lists only paths in WRK-B's cone: `modules/work/{board,detail,capture}/**` and `docs/evidence/hq-social-work/work-board/**`.

## Checks

The current checks below ran on the combined candidate `3654a5a` (core, UI, views and board together) with the same serial process and telemetry. CPU was 9–23% (never at or above 85%), about 49 GiB was available, and the serial ceiling was 1. No install was needed because the lockfile is unchanged.

| Check | Command | Result |
| --- | --- | --- |
| `work-module` (catalog projection) | The literal globs `modules/work/**/*.test.ts` and `modules/work/**/*.test.tsx`, expanded with bash `globstar` into 18 files (now including the 4 views test files) and passed to `npx vitest run --no-file-parallelism` | 18 files, 356 tests passed |
| Full suite, the deduplicated union of the affected groups | `npx vitest run --no-file-parallelism` | 28 files, 430 tests passed |
| Typecheck | `npm run typecheck` | Passed |
| Build | `npm run build` | Passed |

The earlier checks on `8cdb95e`, before the merge, are kept below for history.

All earlier runs used a single serial process on Linux 6.12, Node 24.19.0, Vitest 5.0.5 and Vite 8.3.4. Same-host telemetry was taken before every install, test and build. CPU was 7–21% each time (never at or above 85%), about 45 GiB was available, and the serial ceiling was 1.

| Check | Command | Result |
| --- | --- | --- |
| `work-module` (catalog projection) | The literal globs `modules/work/**/*.test.ts` and `modules/work/**/*.test.tsx`, expanded with bash `globstar` and passed as `npx vitest run <14 files> --no-file-parallelism` | 14 files, 272 tests passed |
| Full suite | `npx vitest run --no-file-parallelism` | 24 files, 346 tests passed |
| Typecheck | `npm run typecheck` | Passed |
| Build | `npm run build` | Passed |

Vitest takes its CLI arguments as filename filters, not globs. Passing the two literal globs unexpanded matches no file and exits 1. The catalog group's command has to expand them first. The group stays a projection until Design merges issue1comment6280106200. CI is not configured for this repository, so there is no CI result.

## Acceptance mapping (`ac.work-board.001`)

| Requirement | Evidence |
| --- | --- |
| Drag, keyboard and menu moves produce identical `move` calls and agree after Undo | `board/test/board.test.tsx` › "drag, keyboard and menu moves": three scenarios compared call for call, without request IDs, including the Undo calls and the restored layout. The exact anchors are checked: a status change is `{place:'top'}`, and a reorder is `{after_id}` of its new upper neighbour. `board/test/moves.test.ts` covers the shared anchor rule, and `board/test/drag.test.ts` covers the drag controller. Browser captures 02 and 10 show a keyboard move, its toast, and Undo restoring the exact place (`hx-seeds` back after `ex-library`; port log `move ×2`). |
| Detail and List status changes are `move` calls whose Undo restores the exact position | `detail/test/detail.test.tsx` › "a status pill is a move to the top, and Undo restores the exact place" checks `['it-bread',1,'active',{place:'top'}]`, then the Undo `['it-bread',2,'next',{after_id:'it-zine'}]`, the layout restored, and no `patch` at all. The List select is WRK-P's, merged here in `3654a5a`. `modules/work/views/ListView.tsx` calls the same `store.move(id, status, {place:'top'})`. Its test, `views/test/views.test.tsx` › "List sorts by column and moves status through move (top of the new status), with Undo restoring the place", passes on the combined candidate. |
| Quick capture creates one Inbox item with no dates, and a date word only offers a suggestion | `capture/test/capture.test.tsx` covers one create with `dates: []`, the item at the top of Inbox, the suggestion text, the title saved as typed, and the date added only when Add date is pressed. `capture/test/suggest.test.ts` covers the suggestion logic. Capture 04 shows this in the browser: after Enter, "Call the plumber tomorrow" is the first Inbox card with no date chip. |
| Offline capture becomes labelled HQ drafts that are sent only explicitly | `capture/test/capture.test.tsx` › "offline capture and HQ drafts" and `capture/test/drafts.test.ts`. Captures 05 and 06 show this in the browser. With the Planner offline, Save made no create call and offered "Keep as HQ draft". Reconnecting sent nothing. Send drafts made exactly one create. |
| Detail autosave and conflict states work | `detail/test/detail.test.tsx` covers: the 1,200 ms debounce (nothing at 1,199 ms, then one patch); immediate save on blur and on close; changed elsewhere, where nothing is sent until the user chooses, Keep mine re-sends at the new revision, and Use theirs sends nothing; automatic re-apply when a different field changed; and a select conflict. Capture 07 shows the conflict banner in the browser with no patch sent (the port log shows reads only). |
| Zero execution-class calls | `board/test/board.test.tsx` › "zero execution": the port's key set equals `PLANNER_PORT_KEYS`, and drag, keyboard, menu, detail, capture and following a link call only planning reads and writes. `detail/test/detail.test.tsx` checks that clicking a link makes zero port calls. The harness footer counts every port call by method. |
| Empty, loading, error, offline and saving states | `board/test/board.test.tsx` › loading, unavailable before any snapshot, empty, offline after a snapshot, saving, unknown (reconciled only with the same request), and a possibly-saved flag that is never treated as proof. Capture 08 shows an unconfirmed move, and "Check now" re-sent it (`move ×2`) and cleared it. |
| Light and dark evidence | Captures 01–10 below, each in both themes. |

## Browser evidence

- **Route.** A static Vite build of `modules/work/board/harness` (index.html, main.tsx, harness.css, vite.config.ts). It carries the exact CSP of `apps/desktop/index.html`, and the page logged no console errors under it.
- **Serving.** It was served by `vite preview` on `127.0.0.1:4185` only, with `strictPort` and an outer one-hour `timeout`. It was stopped after capture, and the port was confirmed closed.
- **Browser.** A T3 Browser preview tab driven with `preview_*` tools: real clicks, key presses and typing, plus `preview_evaluate` for readback and for scrolling the panel. The tab opened under the app's default browser profile. The page is loopback-only with `connect-src 'none'`, and no other site was visited. The browser user agent was not recorded.
- **Build correspondence.** The captures were taken from a harness build of the tree at `a1766df`. The harness and the board, detail and capture source are unchanged through `8cdb95e` and the views merge `3654a5a` (identical trees), so the captures still show the current owned source. The browser was not rerun after the merge. A rebuild reproduces the same content-hashed assets: `index-D0XZ5vRM.js` (sha256 `a2dfee30aa653db6…`) and `index-D0iNF3bw.css` (`7400b4f1e4dab403…`).
- **Viewport.** 1280×800 CSS px at devicePixelRatio 2, saved at 1280×800. The narrow captures use 900×700 CSS px, saved at 1280×996.
- **Theme.** Set on the document with `html[data-theme]`, via `?theme=light|dark` or the harness buttons. The computed `color-scheme` matched the theme.
- **Fixture.** `exampleItems(today)` plus two fictional items (`hx-seeds`; `hx-zine` with a checklist and a read-only HQ reference). The fixture Planner has `hq-references-v1`.
- **Clock and zone.** The host clock was about 2026-10-20 03:18–03:30 CEST, which is 2026-10-19 21:18–21:30 in the Planner zone `America/New_York`. So "Today" is Oct 19 and "tomorrow" is Tue, Oct 20.
- **Synthetic parts.** Faults come from `withFaults`. The "other device" is a direct fixture `patch` with its own request ID.

| # | Capture | Scenario and action |
| --- | --- | --- |
| 01 | `01-board-{light,dark}.png` | `?theme=…` Board as home. Dropped starts collapsed. Note: "Planner items aren’t project-scoped". |
| 02 | `02-keyboard-move-detail-toast-{light,dark}.png` | Clicked "Sort the seed packets", which opens the detail, then pressed Alt+→. The card moved to the top of Considering, and the toast reads "Planning change only · no run started" with Undo. |
| 03 | `03-detail-checklist-links-{light,dark}.png` | `?open=hx-zine`, panel scrolled to the end: checklist "1 of 2 done", notes, and an HQ reference shown read-only as "Not resolved". |
| 04 | `04-capture-date-suggestion-{light,dark}.png` | `?capture=1`, typed "Call the plumber tomorrow". The suggestion offers Target · Tue, Oct 20, and the title stays as typed. |
| 05 | `05-offline-capture-not-saved-{light,dark}.png` | `?offline=1&capture=1`, Save. Shows "Planner unreachable · nothing was saved" with Keep as HQ draft, and no create call. |
| 06 | `06-offline-hq-draft-{light,dark}.png` | Pressed Keep as HQ draft: a labelled HQ draft panel with Send drafts, plus the offline banner and save state. |
| 07 | `07-detail-conflict-{light,dark}.png` | `?open=ex-shed-paint&scenario=conflict`, then focused and blurred Notes. "Changed elsewhere" offers Keep mine and Use theirs, and no patch was sent. |
| 08 | `08-unconfirmed-move-{light,dark}.png` | `?scenario=unconfirmed` (a lost move response): the unconfirmed panel, the card badge, and the header "Save result unknown · Check". |
| 09 | `09-narrow-900-board-detail-{light,dark}.png` | 900×700 with a card open. The detail stacks below the board, and the pressed pill shows the drawn check. |
| 10 | `10-undo-restored-{light,dark}.png` | Undo after 02: "Undone: Moved “Sort the seed packets” to Considering", and the card is back at its exact place. |

## Fixed from browser evidence (`342e11b`)

- **Redundant name.** The Inbox add button's accessible name read "Capture to Inbox in Inbox (adds to the top)". It is now pinned by a test.
- **Generic Undone toast.** It read "Undone: Moved", because the core's undo label is generic. Undone toasts now reuse the change's own toast wording. This was observed red in the browser, and the green assertions are in the board and detail tests.
- **Panel width.** The panel's `width: min(480px, 100%)` sized to max-content in an `auto` grid track, so it left a gap at the right edge. It is now `width: 480px; max-width: 100%`.
- **Missing glyphs.** The pressed pill's `✓` and the hint's `⋯` rendered as tofu in the host's fallback font. The check is now drawn in CSS, and the hint says "Move menu".

## Gaps and limits

- **No real hardware or app shell.** No real touch hardware, Electron renderer run or screen-reader pass was done. Pointer and touch drag is proven with labelled synthetic layout in happy-dom, and the browser run used keyboard and menu moves.
- **List select is WRK-P's.** The List status select lives in WRK-P's views (`task.work-views.001`), merged here by root authority in `3654a5a`. It calls `store.move` with `{place:'top'}`, the same call as the detail pills and WRK-B's exported `changeStatus`. Its tests pass on the combined candidate. The board and the views are not yet mounted on one store in a domain entry. That integration is held for the work-domain task, which must also skip `defaultPrevented` in an outer Ctrl/⌘+Z handler so one keypress undoes once.
- **Session-only persistence.** HQ capture drafts, unsaved text buffers and toasts live in memory for the session (module-level). Persistence across restart awaits G-3 and is not provided.
- **Held surfaces.** Board presets, nav, index, the project chip and domain switching are held or owned elsewhere. The board is shown in a harness, not in the app shell.
- **Fonts.** System fallback fonts only. The host browser resolved `"IBM Plex Sans", system-ui, …, sans-serif` to a monospace-looking face, so letterforms in the captures are not representative.
- **ICU and zone data.** ICU and zoneinfo differences between hosts are service-authoritative.
- **Local checks only.** These are local checks. CI is not configured, and there was no live Planner, Electron or native run.
- **Leftover build output.** The `npm run build` outputs (`apps/desktop/dist`, `apps/desktop/dist-electron`) and the harness build (`modules/work/board/harness/dist`) remain in ignored directories. The command guard blocked recursive removal of the harness `dist/`, and it was not bypassed.

## Deferred findings

- **New, P3 (UI kit tokens, not fixed here).** `--hq-accent-edge` is fully transparent in dark, so a pressed status pill has no edge in dark. It still differs by weight, the selected surface and the drawn check, so it never depends on colour alone. Owner: UI kit.
- **New, P4 (core).** Core undo-entry labels are generic ("Moved", "Change"). WRK-B now uses toast wording, but other consumers of `state.undo` get only the generic label. Owner: WRK-P core.
- **New, P4 (catalog).** The `work-module` group's literal globs need shell expansion before `vitest run`. Owner: Design / catalog.
- **Carried, not fixed.** The UI kit's F1–F7 (`docs/evidence/hq-social-work/ui/README.md`) and the Work core's P3/P4 findings (`docs/evidence/hq-social-work/work-planner/README.md`) remain deferred. Most relevant here are F1, where only document-level theming is supported; F3, where Dialog does not make the background inert, which affects Quick capture; and F4, which has no shortcut to reach Undo.

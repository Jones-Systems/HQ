# Work domain evidence (`task.work-domain.001`)

Lane-local continuity and evidence for the Work-domain child of the HQ Social/Work campaign
(`docs/engineering-specs/hq-social-work.md`, `ac.work-domain.001`, `test.work-domain.001`). All data shown is the
fictional example fixture; no endpoint, credential or private record is read or written.

## Binding

| Item | Value |
| --- | --- |
| Repository | `Jones-Systems/HQ` |
| Branch | `t3/work-domain-integration` (a native HQ worktree child; not a plan or lane branch) |
| Start | `72854ab6a7c78306dbf078d9b5db7412e4a13ab9` (published plan head, PR #3) |
| Dependency merge | `8c2f841` = normal `--no-ff` merge of exactly `3ca74d7479283d8ac7acf7c363bd262f34578ed4` (accepted Work board, PR #28; contains views `8a3261d`, core `a8c791a`, UI kit `935dedf`); no conflicts |
| Source head checked | `089aa8abc3bdb09080ad9b85e68925de14148ca7` |
| Model | `claude-opus-5-5`, high effort, fast mode off; no descendants launched |
| Guidance | Codex V3 `AGENTS.md` at `4beb491c`, 30,716 bytes, SHA-256 `1238a90a…7ce6` (verified, read in full); HQ `AGENTS.md`/`CLAUDE.md`. `.agents/shared-guidance.md` is absent, so shared enrollment is **unavailable** and the HQ local agreements apply. Capsule SHA-256 `071dbea0…dad4` (file `190aa069…404d`) verified. No material guidance conflict. |

**Byte identity of dependency trees.** After the merge, `git diff --stat 3ca74d7 HEAD -- modules/work/core modules/work/views modules/work/board modules/work/detail modules/work/capture packages/hq-ui packages/contracts apps/desktop package.json package-lock.json tsconfig.json vitest.config.ts` is empty at the merge commit and at every later commit on this branch. The only paths that differ from `3ca74d7` outside this lane's write scope are the T1 plan-branch documents inherited from `72854ab`.

## What is built

Write scope only: `modules/work/index.tsx`, `modules/work/nav/**`, `modules/work/skeleton.test.ts` and this directory.

- `@hq/work` exports `WorkModule` named and default; R1's registry (`apps/desktop/src/modules.tsx`, unchanged) imports it.
- `nav/session.ts`: one module-level Work session per `context.id`, holding one `WorkStore` over the fictional example
  Planner (`createFixturePlanner` with the view fixtures and the Planner example settings), plus the shared toasts, HQ
  drafts, card-detail text state and the page state (last page, filters, collapsed columns, scroll per page and
  unsaved toolbar-capture text). The board, the planning views, the card detail and both capture surfaces all use it;
  a remount gets the same session back, so no second snapshot is read.
- `nav/routes.ts`: every `iface.domain-module.001` Work destination (`home` → Board, `lists` alias, `item/<id>` over
  the last page, reserved `board/plan/<id>`), each passing `isDestination`.
- `nav/WorkDomain.tsx`: secondary navigation (Boards, Views, Planner settings), board-level filters (area is offered
  only as "Area label", described as "A Planner label, not a project."), the toolbar capture, the page, and the card
  detail beside it. Labels: "Example data · Fictional example planning, kept in memory for this session only …", and
  the accepted not-project-scoped note on the board, the views and the settings page. Week grouping comes from the
  loaded Planner `week_start` (the settings page shows it read-only).
- `nav/ToolbarCapture.tsx`: title-only capture into Inbox from the toolbar, its text kept in the session; a date-like
  word only offers a date; while the Planner is unreachable an HQ draft is kept only by explicit choice. N opens the
  accepted capture dialog, scoped to focus inside Work.
- `nav/undo.ts`: the outer Ctrl/⌘+Z handler. It skips events that are `defaultPrevented` (React or native) or come
  from input, textarea, select or contenteditable, so nested `PlanningViews` plus the domain handler consume exactly
  one undo entry per keypress.

## Checks (on `089aa8a`, serial, one test process)

| Command | Result |
| --- | --- |
| `npm ci` | passed; `package-lock.json` SHA-256 `9d388b16…c994` unchanged; no tracked change |
| `npm run typecheck` | passed |
| `npx vitest run modules/work` | 23 files, 391 tests passed |
| `npm test` | 33 files, 465 tests passed |
| `npm run build` | passed; renderer `index-BdeYkbVf.js` (SHA-256 `eeefc174…376a`), `index-CNLwLbeq.css` (`b053866f…ed8ed`) |

Work test files (23): `board/test/{board.test.tsx, drag.test.ts, moves.test.ts}`,
`capture/test/{capture.test.tsx, drafts.test.ts, suggest.test.ts}`,
`core/test/{conformance, planning, store, upstream-integrity, validation}.test.ts`, `core/test/hook.test.tsx`,
`detail/test/detail.test.tsx`, **`nav/test/{boundary.test.ts, domain.test.tsx, registry.test.tsx, routes.test.ts, undo.test.tsx}`**,
**`skeleton.test.ts`**, `views/test/{by-date.test.tsx, calendar-timeline.test.tsx, moves.test.ts, views.test.tsx}`.
The full run adds `apps/desktop/electron/security.test.ts`, `apps/desktop/src/state.test.ts`,
`modules/social/skeleton.test.ts`, `packages/contracts/src/index.test.ts`, `packages/hq-ui/skeleton.test.ts` and
`packages/hq-ui/test/{components.test.tsx, contrast.test.ts, preserved-content.test.tsx, styles.test.ts, tokens.test.ts}`.

The new tests (bold) cover: the real `App` with `MODULES` through Design → Social → Work → Work, with `MODULES.work ===
WorkModule`, restored view, filters, selection, scroll and unsaved capture text and zero port calls on the switches;
detail text the Planner could not take (changed elsewhere) restored with zero writes; nested `PlanningViews` plus
domain Ctrl/⌘+Z consuming exactly one entry (a mutation that removes the `defaultPrevented` guard fails it);
typing-control, React and native `defaultPrevented` and contenteditable skips; the shared session across remounts;
labels; every destination; no navigation on mount; `week_start` grouping; scoped N; capture without an invented
date; explicit HQ drafts; and the HQ workspace import boundary for all Work production code.

CPU telemetry (Codex V3 Linux admission collector) before each batch: 11.15 % (npm ci), 19.00 %, 18.32 %, 9.21 %,
12.23 % and 12.81 % used; ≈ 40 GiB available; one core = 6.25 %; serial test ceiling 1. No batch started at or
above 85 %.

No CI is configured on this base. **No CI configured is not green CI.**

## Browser evidence (fictional fixture, app CSP)

Route: the built renderer (`npm run build`) served by `vite preview --config apps/desktop/vite.config.ts --host
127.0.0.1 --port 4193 --strictPort` and driven in a T3 Browser tab (incognito profile). The page's own CSP meta
(`default-src 'none'; script-src 'self'; style-src 'self'; … connect-src 'none'`) is in force. Captures are 1600×1000
or 1440×820 CSS pixels at device scale 2, stored downscaled to 1280 wide. Every capture below ran against
`index-BdeYkbVf.js`, the bundle built from `089aa8a`.

| File | What it shows |
| --- | --- |
| `work-board-light.png` | Work home (Status board), light, 1600×1000 |
| `work-board-dark.png` | Work home (Status board), dark, 1600×1000 |
| `work-board-detail-dark.png` | Card detail opened from the board (`item/ex-bread`), dark |
| `restore-1-before-switch-dark.png` | List view, search "the", card detail open, unsaved toolbar text, list scrolled to 140 px (1440×820) |
| `restore-2-social-dark.png` | After switching to Social (Work unmounted) |
| `restore-3-after-remount-dark.png` | Back on Work: a fresh module element (marker gone), List, search "the", detail "Repaint the garden shed", capture text "Order twine for the bean poles" and scroll 140 restored |

Readback in the page: resource entries were only `http://127.0.0.1:4193/assets/index-BdeYkbVf.js` and
`…/index-CNLwLbeq.css`; the tool's network log showed only same-origin `127.0.0.1:4193` requests; no console
entries; and no `error` or `securitypolicyviolation` events were recorded during the restoration sequence, where a
listener for both was installed.

**Native Electron: unverified.** No qualified HQ-compatible Electron evidence route exists on this host; nothing was
installed, no sudo was used and no sandbox was disabled.

## Deferred findings (recorded, not fixed)

| ID | Severity | Finding |
| --- | --- | --- |
| WD-1 | P3 | Accepted RV-3 save-on-leave: if a card-detail field has focus when the rail is clicked, its blur sends that one edit as a planning patch (`registry.test.tsx` documents it). The switch adds nothing else and nothing executes, but `ac.work-domain.001` says domain switches add no writes. Changing it needs the detail lane (WRK-B) or a root decision. |
| WD-2 | P3 | Same class: `CardDetail` flushes notes still inside the 1,200 ms debounce when it unmounts, including on a domain switch. Accepted detail behaviour; not changed here. |
| WD-3 | P4 | `calendar/<YYYY-MM>` parses and opens Calendar, but the month is not applied: the Calendar view keeps its month in its own module memory with no seed input. A small views API (WRK-P) would be needed. |
| WD-4 | P4 | The accepted capture dialog resets its title on open and takes no date seed, and it is modal, so it cannot stay open across a switch. The restored capture text is therefore the toolbar capture; a view's "capture on this day" seeds the toolbar capture's date. |
| WD-5 | P4 | Planning-view pages hold two store subscriptions. The domain polls; `PlanningViews` gets an interval beyond any session, but its `visibilitychange` listener can still add one extra version read when the page becomes visible. |
| WD-6 | P4 | Planning-view pages show two toast regions ("Work notifications" from the views, "Work card notifications" for board, detail and capture toasts). |
| WD-7 | P4 | The T0 shell's `main` padding (shell-owned `styles.css`) leaves the document about 76 px taller than the viewport at 1440×820 even though Work's own page scroller is bounded. |
| WD-8 | P4 | The views lane's remembered view preferences (`useRemembered`) are global, not keyed by `context.id`; HQ has one fixed context today. |
| WD-9 | P4 | The selected card is highlighted only on the Status board; planning views show the detail but no row selection. |
| WD-10 | P4 | The board's exported `useUndoShortcut` does not check `defaultPrevented`; the domain does not use it (it uses its own outer handler). |

Inherited deferred findings from the Work planner (PR #26) and Work board (PR #28) lanes stay as those lanes recorded
them; they were not re-assessed or changed here. No P0 or P1 finding was found.

## Held

References, the service bridge and G-3 storage were not needed and stay held. Merge is held for the integration
owner. Completion here is not acceptance.

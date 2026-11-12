# Handoff: HQ life F7-B1, global command palette and cross-module navigation

Artifact Type: handoff
Lane: F7-B1 (cross-app user flows), builder
Status: **paused mid-build by the owner. Code written and committed, nothing verified.**

## Where things are

| | |
| --- | --- |
| Branch | `work/hq-life-flow-nav-20261103` (pushed) |
| Worktree | `~/.t3/worktrees/HQ/work-hq-life-flow-nav-20261103` |
| Base | `284393d` "Add shared motion tokens, toasts and inline feedback to @hq/ui" (F1's `work/hq-life-system-20261103`). History is linear, no merge commits. |
| Code commit | `7df7614` "WIP: F7-B1 global command palette, Back pill, shell shortcuts and window title (untested)". This handoff is one more commit on top. |
| PR | none opened. Intended: non-draft, against `work/hq-foundation`, titled "HQ life F7-B1: global command palette, cross-HQ search and cross-module navigation". |
| Evidence branch | `work/hq-life-flow-nav-20261103-mounted`: **not created**. |

All of the code is under `apps/desktop/src/navigation/`. `PresentationShell.tsx` and every file outside that directory are untouched. [`README.md`](../../../../apps/desktop/src/navigation/README.md) there has the props table and the exact mount snippet for F1.

## Scope as last agreed

The original brief was amended by F1 (the shell owner): no `PresentationShell.tsx` changes on the PR branch; export props-only components and hooks; drop the read-only reference notice; put a minimal mount on a second, PR-less branch for real-app screenshots; test components directly with fakes; keep history linear.

## Brief items

| Item | State |
| --- | --- |
| 1. Global command palette (Ctrl/⌘K, event, ARIA, grouped fuzzy results, commands, search, motion, platform hints) | **Written, never run.** |
| 2. Back pill + Alt+← / ⌘[ | **Written, never run.** |
| 3. Read-only reference notice as `InlineNotice` | **Dropped** by F1's scope change (F1 renders it). |
| 4. Global shortcuts (Ctrl/⌘+1…4, Ctrl/⌘+,) | **Written, never run.** |
| 5. Window title | **Written, never run.** |
| Unit and component tests | **Written, never run.** |
| `npm run typecheck`, `build:electron`, `vitest`, `npm run build` | **Not run.** The worktree has no `node_modules`, and host load stayed far above the agreed limit of 13 (it reached 277). |
| Real-app evidence (screenshots, reduced motion, 760×560, dark) | **Not started.** The Electron binary was not installed and no driver run was started, so nothing needs quitting. |
| Evidence-only mount branch | **Not started.** |
| PR, `link_pull_request` | **Not started.** |

### Final export names and props (`apps/desktop/src/navigation/index.ts`)

- `CommandPalette`: `domain`, `destinations`, `settingsOpen`, `projectId`, `appearance`, `references?` (`find` and `open`), `returnFrame?: { label, onBack } | null`, `onNavigate(domain, destination?)`, `onOpenSettings(target)`, `onAppearance(value)`, `mac?`. It owns the window `keydown` listener (bubble phase, yields to `defaultPrevented` and to an open `[aria-modal="true"]`) and the `hq-open-command-palette` event.
- `ReturnPill`: `label: string | null`, `onBack`, `hidden?`, `mac?`. It includes the shortcut while shown and not hidden. `label={null}` plays the exit motion; unmounting skips it.
- `useShellShortcuts({ switchDomain(domain), openSettings() }, { mac? })`.
- `useDocumentTitle({ domain, settingsOpen })`, plus `documentTitle(state)`.
- Also exported: `OPEN_PALETTE_EVENT`, `SHOW_WELCOME_EVENT`, `SettingsTarget`, `describeLocation`, `chordKeys`, `chordText`, `PALETTE_CHORD`, `SETTINGS_CHORD`, `currentPlatformIsMac` (for ⌘K / Ctrl K hints in a top-bar button), `resolveShellShortcut`.

### Files

`platform`, `match`, `destinations`, `commands`, `search`, `shortcuts`, `useDocumentTitle` (pure logic and hooks); `CommandPalette.tsx`, `ReturnPill.tsx`, `navigation.css`, `index.ts`, `README.md`; tests `platform.test.ts`, `match.test.ts`, `destinations.test.ts`, `commands.test.ts`, `search.test.tsx`, `shortcuts.test.tsx`, `ReturnPill.test.tsx`, `CommandPalette.test.tsx`, `useDocumentTitle.test.tsx`; and `test-shell.tsx`, a test-only stand-in for the shell that mounts the components the way the README says, using the real `createReferencePort` and fake modules (including a Design stub that handles Ctrl+K and calls `preventDefault`).

## Decisions and why

- **Destinations come from the modules' own route code**, read-only: Social and Work `NAV_ITEMS`, Design's five nav ids with `NAV_LABELS`, Wiki `home` plus `topicsDestination` for each namespace. Design's parser never fails (it falls back to Projects), so `destinationParses` checks that the parse round-trips with no section. Design sections below the nav level are not offered.
- **Updates is left out.** `ServiceSettings` selects a category only from `target` (`'appearance'`, a data source, or `null`), so Updates cannot be targeted without editing it.
- **Search uses one `references.find(query, { projectId, limit: 20 })`** as the brief says, debounced 150 ms, stale answers ignored, previous results kept (and re-filtered by title) while the next query is pending. Wiki search is a fallback row that goes last, so Enter on a typed query opens the best result or command first.
- **Status line has a fixed height** (key hints, "Searching…", "No results for “q”"), so the list does not jump while searching. An inline `InlineNotice` appears only if the whole search rejects.
- **Close first, then act.** The palette closes and restores focus before running a command, so the shell's `openSettings` records the element the user came from. After a command, if focus was lost with the old view, focus moves to `main` (given `tabindex="-1"`; the CSS removes its outline).
- **Back label** is `describeLocation(domain, destination)`, for example `Work · Status board`, so Back says where it returns to.
- **Ties prefer the current domain** ("Calendar" and "Review" exist in several domains).
- **Pill placement.** A zero-height anchor with the pill centred over the top of the workspace, so it takes no layout space. The accessible name stays exactly "Back to <label>", because the arrow and the shortcut keys are `aria-hidden`; existing shell tests match that name exactly.
- **macOS detection** uses `hqDesktop.platform === 'darwin'`, then `navigator.userAgentData`, `navigator.platform` and the user agent. The preload reports `'desktop'`, never `'darwin'`, so the fallbacks are what actually run.

## Findings so far

None from the real app (it was never run). From reading the code:

- Design's key listener is on `document`, so it runs before the palette's `window` listener, and its `preventDefault` reliably makes the shell yield. Design handles keys only when focus is inside it or on `<body>`; from the rail, the shell palette opens even in Design.
- Design's `InteractivePanel` hides the native preview whenever `[role="dialog"]` or `[aria-modal="true"]` is in the DOM, so the palette needs no extra wiring over a live preview. Unverified in the app.
- **Work's Alt+← is not always handled.** `cardKey` returns `null`, and the handler returns before `preventDefault`, when the move is impossible (a card in the leftmost column). Alt+← there would trigger Back. The fix belongs in Work (F2): call `preventDefault` for a no-op move.
- `createReferencePort.find` queries providers in order and returns once `limit` is reached, so a Design provider with 20 or more matches starves Work and Social, and a slow provider delays everyone's results. Worth raising with the port owner; a per-domain query (the port supports `domains`) would fix both.
- Existing tests that constrain the real mount: `getByRole('button', { name: 'Back to Design draft' })` (exact name), `/Back to Autumn blend tasting notes/`, `getByLabelText('Read-only reference')` (F1's notice must keep that `aria-label` and show the message), and the Settings page's own "← Back to Work" button.

## What is left, in priority order

1. **Get a working tree.** When host load is below 13, run `npm ci` in the worktree (the lockfile hash matches no sibling worktree's, so there is nothing to copy), then `npm run build:electron` once.
2. **Typecheck.** `npm run typecheck`. Likely trouble spots: the `modules/**` imports in `destinations.ts` (paths and `.ts` extensions), `exactOptionalPropertyTypes` on spreads in `commands.ts` and `search.ts`, and the `mac` prop override in `CommandPalette.tsx`.
3. **Tests.** `npx vitest run apps/desktop/src/navigation`, then `npx vitest run apps/desktop`. These are unrun and written against assumptions that may be wrong:
   - happy-dom fires `focusin` on `.focus()` (the focus-trap test);
   - the `fireEvent` return value (false when `preventDefault` was called);
   - `wikiSearchDestination('')` and a 5000-character query return `null`;
   - the exact ranking and group order asserted in `search.test.tsx` and `CommandPalette.test.tsx`;
   - `describeLocation('social', 'nonsense/path')` is `Social`.
   Fix the code or the test expectation, whichever is wrong, and say which in the commit message.
4. **Evidence branch.** Create `work/hq-life-flow-nav-20261103-mounted` from this branch with one commit, "Evidence-only mount (F1 owns the real mount)", applying the README snippet to `PresentationShell.tsx` (replace the two `returnFrame` / `referenceNotice` lines' Back button with `ReturnPill`, keep the existing notice, add `switchDomain`, the two hooks, and `CommandPalette` before `<ToastViewport />`). Push it, no PR. Run `apps/desktop` tests on it once, since the pill replaces the button the existing tests click.
5. **Real-app evidence** on the mounted branch, after `npm run build`: install the Electron binary (`electron_config_cache=/tmp/<branch>/ec node node_modules/electron/install.js`), run `/tmp/hq-f7-eval/driver/drive.mjs <checkout> b1-<name> example`, and capture palette in Social, Work, Wiki and Design (Design's own palette unaffected), search results, Back pill after opening a result, dark theme, a 760×560 window and reduced motion. Look at them, fix what looks wrong (pill overlap with Design's top bar at narrow widths is the first thing to check), then commit the PNGs (synthetic data only, no host paths) to `docs/design/hq-cross-app-flow-assessment-20261103/b1/` on the PR branch. Quit every driver run with `/tmp/hq-f7-eval/driver/c <label> quit`.
6. **History.** The code commit is prefixed `WIP:`. Either add fix commits on top, or, with owner agreement, replace it with coherent commits (force-push) before opening the PR. I did not rewrite anything that is pushed.
7. **PR.** Non-draft against `work/hq-foundation`, with the checks (exact commands and counts), screenshots, the mount snippet, what is not verified (native macOS, screen readers), and a note that the branch includes F1's `284393d`. End the body with the standard generated-with line. Then `link_pull_request`; the parent owns `watch_pull_request`.
8. **Run `/code-review`** before handing off, since nothing has run yet.

## Open questions and risks

- Does F1 want `ReturnPill` as the first child of the workspace column? That is how the zero-height anchor avoids pushing layout. If the workspace becomes a grid, the anchor needs a `grid-row` of its own.
- Should `onOpenSettings` also be able to close Settings first? Today, opening Settings while it is already open on a category picked by hand does not re-select a category (`ServiceSettings` reacts only to a changed `target`).
- The palette's "Go to" rows say "Current" for the domain on screen, and appearance rows mark the current choice. Check that reads well in the screenshots.
- A search that returns nothing still offers "Search Wiki for …", which then opens the Wiki's own search. The Wiki provider (finding X9, F6) is not registered, so Wiki pages are not in cross-HQ results yet.
- `.hq-palette-searching::before` uses a literal 1.1 s loop; it is disabled under reduced motion but is not a token. `main[tabindex="-1"]:focus` is a shell-element rule inside `navigation.css`.
- Everything is untested, including the CSS. Treat the first test run as likely to find real bugs.

## Only here, not in git

- `/tmp/work-hq-life-flow-nav-20261103/ref/` holds two screenshots extracted from the F7 assessment (`09.png`, `02.png`) for layout reference. They are also in git on `origin/work/hq-life-flow-eval-20261103`.
- No evidence PNGs, no Electron cache, no driver runs, no scratch profile exist from this lane.
- `/tmp/hq-f7-eval/driver` and its `evidence` directory belong to the F7 lead, not to this lane.
- Nothing else lives only in the thread; the reasoning above is the whole of it.

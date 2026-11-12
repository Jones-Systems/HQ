> Historical lane record. Recovery uses ordinary ancestry merges and source-only checks; earlier install, execution, rewrite and capture instructions are superseded by the recovery capsule. Private historical paths are omitted. See [recovery source receipt](recovery-core-20261112.md).

# Handoff: Design › Review › Compare (lane F4, builder B3)

Paused on request before the build was finished. The code is built, committed as WIP and unit/DOM tested. The full check
list and part of the visual evidence are still to do.

## Where things are

- Branch: `work/hq-life-design-core-compare-20261103`, from `origin/work/hq-life-design-core-20261103`. No PR opened.
- Worktree: the T3 worktree for this branch (`HQ/work-hq-life-design-core-compare-20261103` under the T3 worktrees folder).
- Commits on top of the lane base, oldest first:
  - `c07e7d1` Let Compare discover a project's versions and add a panel for one (controller, 8 tests)
  - `27343de` Add the swipe logic for Compare (pure logic, 14 tests)
  - `539f7fd` WIP: Let Compare read the catalog again on request
  - `3d2a8fa` WIP: Rebuild Compare around the capture: compact headers, Swipe, in-place feedback
  - `d50b51f` WIP: Fold the annotation tools into the Compare toolbar as an icon group
  - this handoff document, committed last (its own SHA is the branch head).
- Nothing is uncommitted apart from this file.

## Build targets

| # | Target | State |
|---|--------|-------|
| 1 | Modes: Side by side / Swipe | Built. Swipe clips the candidate layer over the baseline with `clip-path: inset`. The divider is `role="slider"` with arrow keys (Shift ±10), Home/End, PageUp/Down, pointer drag with capture, and double-click to centre (eased, instant under reduced motion). Corner labels sit above the frame. Different viewports show a notice with Match viewports. Swipe is disabled with its reason on hover and focus unless there is exactly one baseline and one candidate, and not a hosted live preview. Touch drag was never tried on a real touch device. |
| 2 | Captures first | Built. One-line header: role chip, Version select that doubles as the title, viewport chip, Details. The header wraps in panels under about 300px. Source, provenance, caveats, viewport and role selects, exact version id, Duplicate and Remove are behind Details (collapse). |
| 3 | Panel motion | Built: Presence for add and remove, `useListMotion` for neighbours, resize grip that grows on hover, focus and drag, Synced scroll as a toggle button showing On/Off. A new panel slides into view inside the strip without moving the page. Mid-add screenshot taken. Remove and duplicate motion are not screenshot-checked. |
| 4 | Feedback | Built: `StatusIndicator` (Saving…, Unsaved changes, Saved, retryable failure), `toast.error` saying what was kept, dismissible `InlineNotice` replacing the full-width error text, Skeleton for loading captures and the catalog. "Saving…" is too short to screenshot with instant fake storage, so a DOM test covers it. The skeleton is covered by a DOM test only. |
| 5 | Annotation tools | Built in `AnnotationSlot.tsx` (`AnnotationTools`) and `CompareView.tsx`: Select, Box, Arrow, Ink, Eraser as an icon group in the toolbar, with names and aria-pressed. Unavailable in Swipe, with no panels, or when every panel is a live preview, with the reason on hover and focus. |
| 6 | Empty state | Built: "Add versions in Projects to compare them" with Open Projects (navigates to Projects), and Add panel when the catalog has versions. |
| 7 | Example labelling | Built: a "Labelled fake previews" chip in the toolbar and a "Fake preview" chip in the header of a fake live panel. |

## Tests and checks

Run so far, on the final code (host load was above the 14 limit for much of the session, 277 at worst):

- `tsc -p modules/design/compare/tsconfig.json`: clean.
- `vitest run --config modules/design/compare/vitest.config.ts`: 97 passed, 0 failed, 9 files.

NOT run on the final code: `npx tsc --noEmit`, `tsc -p modules/design/app/tsconfig.json` (this covers the CompareView and
AnnotationSlot changes), the compose `node --test` suite, the sections vitest, the annotations vitest, and
`vitest run apps/desktop`.

`view.test.ts` was changed on purpose: the version id and the source badge moved behind Details, and the Version menu now
lists labels only. The assertions were moved to `view-dom.test.ts` (after opening Details), not dropped.

## Decisions and why

- Candidate layer is clipped, not faded: `clip-path` only, with a white background under the candidate so a shorter
  candidate does not show the baseline through. No opacity, filter or blend on captures.
- Swipe is its own stage, not a mode of the strip. The other panels are hidden while swiping (the stage says how many).
  Scroll in swipe stays local and unmodelled, so the stored comparison format is untouched. Mode and divider position are
  component state.
- Unavailable actions use `aria-disabled` (still focusable) plus `aria-describedby` to a tooltip shown on hover and
  `:focus-within`, with guarded handlers. A shared `ActionButton` and `Reason` in `view/parts.tsx` do this; the annotation
  tools reuse `Reason`.
- Annotation tools moved out of the shared `SecondaryBar` into a `renderTools` slot on the workspace toolbar, so the
  composition keeps ownership of tool state and the workspace stays free of annotation code.
- `loadCatalog` stays read-once by default. `{ refresh: true }` re-reads in place and keeps the old list on failure. The
  workspace asks for a refresh on every mount because versions are added in Projects.
- Custom focus styling needs `.hqd-chrome` in the selector. `design-ui.css:13` has `.hqd-chrome :focus-visible`, which beats
  a single-class `outline: none`. The divider drew two tall blue lines until `compare.css` overrode it with
  `.hqd-chrome .cmp-swipe-divider:focus-visible`; the resize handle needed the same.
- Strip scrolling uses `scrollBy` on the strip, not `scrollIntoView`. `scrollIntoView` also scrolled the page and pushed the
  toolbar under the project bar.

## Findings, mostly for the lead

1. `fake-workspace.ts` `compareFor` builds the empty comparison for the example project once Projects has registered it,
   because `createdInProjects` is true for it. It should use the `contentFor(...).example` flag. The evidence harness works
   around this by removing the registry entry in memory before Compare first asks.
2. The example catalog's `listViews(projectId)` returns nothing for the example: the comparison project id `hq-local` is not
   the sample catalog's `sample-project`. The view unions versions from `snapshot.versions` to cope.
3. A project created in Projects gets a stub catalog that always returns `[]`, so the dev build can never offer Add panel for
   it, whatever is added in Projects. The empty state, Open Projects and the refresh-on-visit path are covered by DOM tests,
   not by a screenshot of the real flow. A catalog backed by the project's content (like the bridged one) is needed to show
   it.
4. Compare no longer uses the shared `SecondaryBar`; other views still do.
5. The scenario that hung earlier was the harness, not the app: Tab never reached the divider within its 8-press limit, so an
   unbounded loop kept sending arrow keys to the Eraser button. The loops are bounded now.

## Visual evidence

Screenshots (all in `[retained private path omitted]`, not in the repo; 38 files):

- `light-1440-*`: states 01 to 11 (side by side, details open, swipe 50/25/75, divider focused by keyboard, add-panel menu,
  mid-transition add, done, unsaved, saved), 12 empty state for a project created in Projects, 15 swipe disabled with its
  reason on focus, 16a/16 viewport mismatch notice, 17 after Match viewports. I looked at these and fixed what they showed.
- `dark-1440-*` and `light-1280-*`: states 01 to 11 ran with no console errors, but I have not looked at the images yet.
- Not done: 1024×768 at all; the reduced-motion run (no `getAnimations()` check, no screenshots); dark or 1280 versions of
  states 12 and 15 to 17.

Before shots are `[retained private path omitted]`.

## What's left, in priority order

1. Run the full check list (serially, `nice -n 10`, `uptime` first), then fix whatever the app tsconfig, compose and sections
   suites find:
   `npx tsc --noEmit`; `node_modules/.bin/tsc -p modules/design/compare/tsconfig.json`; `node_modules/.bin/tsc -p modules/design/app/tsconfig.json`;
   `node_modules/.bin/vitest run --config modules/design/compare/vitest.config.ts`;
   `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts`;
   `node_modules/.bin/vitest run --config modules/design/app/sections/vitest.config.ts`;
   `node_modules/.bin/vitest run --config modules/design/annotations/vitest.config.ts`;
   `node_modules/.bin/vitest run apps/desktop`.
2. Start the dev server and open the unviewed shots:
   `nice -n 10 npx vite --config apps/desktop/vite.config.ts --port 5183 --strictPort --host 127.0.0.1 > [retained private path omitted] 2>&1 &`.
   Look at `dark-1440-*` and `light-1280-*`. Run 1024×768:
   `F4_SCHEME=light F4_W=1024 F4_H=768 F4_TAG=light-1024 nice -n 10 node [retained private path omitted] [retained private path omitted]`.
   Expect to tune the toolbar wrap and the header wrap at that width. Copy `[retained private path omitted]` after each run.
3. Reduced motion: write a small scenario using `open(page, { reduced: true })` from `lib.mjs`. Click Details, add a panel,
   remove one, double-click the divider, and assert `document.getAnimations().length === 0` right after each. Take one shot.
   Fix anything that animates.
4. Screenshot the states not yet seen: remove and duplicate gliding, the loading skeleton, a retryable save failure, and
   dark versions of `extras.mjs` and `created.mjs` (`F4_SCHEME=dark`).
5. Touch: check the divider on a touch-emulated page (`Emulation.setTouchEmulationEnabled`) for drag without page scroll.
6. Finish: push, then the short final report (per-target summary, files, SHAs, exact checks with counts, screenshot paths,
   requests above).

## Open questions and risks

- Should the layout wrap or scroll at 1024×768? The toolbar already wraps to two rows at about 730px of content width;
  1024 has not been seen.
- `compare.css` names `.hqd-chrome` to win a specificity fight with shared chrome. A cleaner fix is for `design-ui.css` to
  exempt controls that draw their own focus ring. That file is shared Design chrome, outside this cone, so it is a request
  rather than a change.
- The tooltip for a disabled action overlaps neighbouring controls while it shows (it covers the panel header from the
  annotation tools in Swipe). It is transient, but a lead may want it placed differently.
- `modules/design/compare/README.md` still describes the old panel layout; it is outside the owned paths.
- Refresh-on-mount assumes `compareFor` returns a cached controller. If a controller is rebuilt per visit it only costs one
  extra read.

## Only outside the repo

- Evidence harness (task-owned, not repo code): `[retained private path omitted]` (open, seedExample, helpers), `states.mjs` (full state
  walk, env `F4_SCHEME`, `F4_W`, `F4_H`, `F4_TAG`, `F4_FULL`), `extras.mjs` (swipe disabled reason, viewport mismatch, Match
  viewports), `created.mjs` (project created in Projects, empty state), `dbg-focus.mjs`, older `first.mjs`, `swipe1.mjs`,
  `dbg2.mjs`, `dbg-projects.mjs`. They drive `[retained private path omitted]`, which I did not edit.
- Commit message drafts in `[retained private path omitted]` (`msg-*.txt`, `wip-*.txt`) and console logs `console-dark-1440.log`,
  `console-light-1280.log`.
- The dev server on port 5183 is stopped.
- Not in the repo, only in the thread history: the reasoning above about the harness hang and the focus-ring specificity.

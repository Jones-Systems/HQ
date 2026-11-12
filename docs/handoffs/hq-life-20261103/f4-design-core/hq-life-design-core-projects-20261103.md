# Handoff: F4 builder B1, Design › Projects (paused, 2026-11-03)

Builder B1 in lane F4 (Design core views), working for the F4 lead. Paused on request before any visual or test evidence existed. Everything below is source written but **never type-checked, run or tested**.

## Where things are

- Branch `work/hq-life-design-core-projects-20261103`, created from `origin/work/hq-life-design-core-20261103`.
- Worktree `/home/malcolmjones/.t3/worktrees/HQ/work-hq-life-design-core-projects-20261103`.
- Base `be4a0b2`. One WIP commit on top, `ffd00b5` (`WIP: rebuild Projects gallery and project screen views (unbuilt, untested)`). The handoff commit follows it; the final reply names the head SHA.
- No PR. No `node_modules` (never installed: host load stayed 20–33 against the 14 limit). No vite server was ever started (5181 is free). `/tmp/f4-projects/` and `/tmp/f4-evidence/projects/after/` **do not exist**: no scenario scripts and no screenshots were produced.

## Build targets

| # | Target | Status |
| --- | --- | --- |
| 1 | All-projects gallery: header, count, **New project** inline form, compact filter bar only when useful, skeleton while loading, true empty state, "No projects match" with **Clear filters** | Source written in `views/gallery.ts`, `views/forms.ts`, `view-model.ts`. Unverified. The "choose a projects folder" slot exists (`GalleryViewOptions.folders`) but nothing fills it yet. |
| 2 | Tiles and reflow: thumbnail settle, `hq-lift`/`hq-press`, focus ring, Enter opens, transform glide on filter/sort/group change, SVG chevron on group headers | Markup, `CaptureFrame` (`views/frame.ts`) and `useReflowWindow` (`views/hooks.ts`) written. **The CSS that makes it work is not written** (see "Next steps" 1). |
| 3 | Project screen: eyebrow, name, "N views · M versions · last capture …", **Open canvas** / **Compare** / **All projects**, kind tabs, captures grouped by view, version cards with chips, Add view / Add version inline with flash and toasts | Source written in `views/detail.ts`. Actions take a `ProjectActions` prop; **`ProjectsView.tsx` does not pass it yet**. Unverified. |
| 4 | SVG chevrons in `detail.ts` instead of `› ‹ ⌃ ⌄` | Done in source (`views/chevron.ts`, same paths as the lead's `Chevron`). The old `⌃⌄` Project tools block is gone entirely. |
| 5 | Open/close transitions, keyboard, focus | Source: each screen is a keyed `hqp-screen hq-enter-rise` wrapper; focus moves to the page title after the first screen. Unverified. |
| — | `ProjectsView.tsx` wiring | **Not started.** |
| — | `projects.css` rewrite | **Not started** (the write was aborted by the pause; the file is the old 105-line stylesheet). |
| — | Tests | **Not started.** |
| — | Screenshots, reduced-motion run | **Not started.** |

## What was built (files)

All inside the owned cone. No controller, session, content, registry, storage or grid change.

- `modules/design/projects/src/view-model.ts` (new, pure): `galleryPhase` (loading / error / empty / no-match / ready), `filtersActive`, `CLEARED_FILTERS`, `filterControls`, `captureSummary`, `overviewLine`, `formatCaptureDate`, `kindTabs`, `visibleViews`, `detailFilterControls`, `tabAfterKey`, `captureChips`, `captureRatio`, `shortRevision`, form validators, `VIEWPORT_PRESETS`.
- `views/ui.ts` (new): `ProjectsUi` structural type plus `FALLBACK_UI` and `ProjectsUiContext`.
- `views/chevron.ts`, `views/controls.ts` (`ActionButton` disabled-with-reason, `Field`, `useSingleFlight`), `views/forms.ts` (`NewProjectForm`, `AddViewForm`, `AddVersionForm`), `views/frame.ts` (`CaptureFrame`): all new.
- `views/gallery.ts`, `views/detail.ts`, `views/section.ts`, `views/hooks.ts`: rewritten or extended.

## Decisions and why

1. **The views get `@hq/ui` by injection, not import.** `@hq/ui`'s index imports CSS and `.tsx`, which plain Node cannot load. `render.test.ts` and, through `fake-workspace.ts` → `projects/src/index.ts`, the whole `modules/design/app/compose/test` suite import the views under `node --test`. Importing `@hq/ui` from the views would break them, and `projects/tsconfig.json` has no JSX setting, so tsc would also fail on `@hq/ui`'s `.tsx`. So `ProjectsSection` takes `ui?: ProjectsUi` (Presence, Skeleton, FieldError, fieldErrorProps, InlineNotice, useToast, useReducedMotion), provides it by context, and falls back to the same markup and class names with no motion and no toasts. `ProjectsView.tsx` should pass the real exports; the app tsconfig then proves they satisfy the structural types.
2. **Plain class names for the rest.** Buttons use `hq-btn hq-btn--*`, motion uses `hq-enter-*`, `hq-lift`, `hq-press`, `hq-flash`, `hq-shimmer-text`. These are global CSS classes that load when `ProjectsView.tsx` imports `@hq/ui`.
3. **Project screen scrolls with the page, not an inner scroller.** Per-project scroll memory is kept by listening on the nearest scrolling ancestor (`scrollParent`). The gallery keeps its own virtualized scroller, sized to its content and capped by CSS.
4. **Information panel**: docked and sticky beside the captures when the screen is wide, bottom dock (hidden until a version is selected) below 820px via a container query on `.hqp-screen`. Keeps the existing resizable splitter and stored width.
5. **Reflow glide is a CSS `transform` transition on `.hqp-cell`, gated by a "reflow window"** (`useReflowWindow`). The window opens when the tile key list or column count changes and lasts one `--hq-duration-slow` (read from the token, so 0 under reduced motion). Scroll, first layout and live resizing stay instant. Cells that mount during the window fade in. Do **not** put `hq-stagger` or `hq-enter-rise` on the cells: those keyframes replace the cell's `translate` transform.
6. **Thumbnail settle**: placeholder (Skeleton) then a wrapper `span.hqp-reveal` fades in once; the `img` never gets opacity or filter. A small LRU of already-seen data URLs (`hooks.ts`) means a tile scrolled back into view appears with no animation. I also removed the old `useThumbnail` habit of resetting to pending on every effect run.
7. **Gallery states.** "No projects match" only when something exists but filters exclude it. A failed first registry load with nothing cached is its own state ("Couldn't load your projects" with **Try again**), not "No projects yet". A failed refresh with a list keeps the list and shows a warning notice bar with **Retry**.
8. **Filter bar rules** (thresholds are my choice, easy to change in `filterControls` / `detailFilterControls`): bar shows with 2+ items or any active filter; Show needs both projects and sources; Host needs 2+ hosts; Freshness and Group need sources; Sort needs 2+ items. A single, uncollapsed group hides its header. Project screen: kind tabs with 2+ kinds, view search with 4+ views.
9. **Create/add failures**: validation errors are inline `FieldError`s; storage failures are `toast.error` that says nothing was saved and the typed text is still in the form. Successes are toasts naming the item. After add, the new card/group plays `hq-flash` and scrolls into view.
10. **Compare is disabled with a reason when the project has no versions** ("Add a version to compare."). This is my assumption that Compare needs at least one version; I did not read the Compare section to confirm.
11. **`ProjectSwitcher` is still exported** (the module's `index.ts` re-exports it and I do not own that file) but is slimmed to a select and rendered nowhere. Dropping it from `index.ts` is a lead decision.
12. **Added viewport presets to Add version** (Desktop 1280×800, Laptop 1440×900, Tablet 820×1180@2x, Mobile 390×844@3x), so cards show real proportions. Stored shape is unchanged.
13. **Raw implementation text removed from the Selection panel**: no Version ID row; created time is formatted; digest is shortened. The "Versions are immutable…" and "Linking is always explicit." sentences are kept.

## Findings

- `@hq/ui` cannot load under `node --test` (decision 1). Any view code in `modules/design/projects/src/views` that wants F1 primitives needs the injection seam.
- The old gallery put a scroller with `min-height: 320px; height: 70vh` and eight controls above the first tile; the old Projects view renders the whole interactive-preview panel (~290px) above the gallery.
- `controller.createProject` does not return the new project's id (it opens it itself), and `addView` does not return the new view's id. I read the new view from the snapshot (`views.at(-1)`) and the new version from the session selection instead of changing the controller.
- The browser harness (`projects/harness`) defines only the shell tokens (`--surface`, `--text`, …) and does not load `@hq/ui`; the CSS should map `--hq-*` to local `--hqp-*` variables with those as fallbacks, and the harness queries `.hqp-scroller`, `.hqp-cell[role="listitem"]`, `.hqp-cell[data-visible]` and `.hqp-scroller img.hqp-thumb` (all kept in the new markup).
- Host load was 20–33 for the whole session; `npm ci` and the checks never ran.

## Next steps (priority order)

1. **Write `projects.css`.** The views use these classes and the current stylesheet defines almost none of them: `hqp-screen` (set `container: hqp / inline-size`), `hqp-page-head`, `hqp-head-text`, `hqp-eyebrow`, `hqp-title-row`, `hqp-title`, `hqp-count-pill`, `hqp-meta`, `hqp-head-actions`, `hqp-action` + `hqp-reason` (tooltip shown on `:hover` and `:focus-within`, anchored right), `hqp-filterbar`, `hqp-search`, `hqp-pick`, `hqp-filter-status`, `hqp-toolbar-row`, `hqp-add-actions`, `hqp-tabs`/`hqp-tab`/`hqp-tab-count`, `hqp-slot`/`hqp-slot-body` (padding on the child, not on the collapsing element), `hqp-form`/`hqp-field`/`hqp-form-actions`, `hqp-state`/`hqp-state-inline`, `hqp-loading`/`hqp-skeleton-grid`/`hqp-tile-skeleton`, `hqp-frame*`/`hqp-reveal`/`hqp-thumb`/`hqp-skeleton`, `hqp-capture` (aspect-ratio comes inline), `hqp-mat`, `hqp-chips`/`hqp-chip*`, `hqp-selected-mark`, `hqp-captures`, `hqp-versions` (`repeat(auto-fill, minmax(min(100%, 232px), 1fr))`, `align-items: start`), `hqp-view-empty`, `hqp-toggle-chevron`. Needed rules: `.hqp-canvas[data-reflow="true"] .hqp-cell { transition: transform var(--hq-duration-slow) var(--hq-ease-standard) }`; `.hqp-chevron` rotates −90° when `[aria-expanded="false"] > .hqp-chevron`, transition on `--hq-duration-base`; scroller `margin: -6px; padding: 6px; max-height: clamp(360px, 72vh, 960px)` (the view sets its height inline and lays out at `width − 12`); the container query for the information panel (decision 4). Keep the `.hqi-*` block at the end of the file untouched (it styles `InteractivePanel`). Map colours once: `.hqp-root { --hqp-surface: var(--hq-surface, var(--surface, #fff)); … }`. No hard-coded durations or easings, no `opacity`/`filter` on `.hqp-thumb` or `.hqp-reveal`. The old `hqp-toolbar`, `hqp-detail`, `hqp-detail-header`, `hqp-detail-scroller`, `hqp-filters`, `hqp-kinds`, `hqp-forms`, `hqp-switcher`, `hqp-registry-note`, `hqp-thumb-*`, `hqp-pulse` rules can go once nothing uses them (`ProjectsView.tsx` still uses `hqp-toolbar` and `hqp-detail`).
2. **Install and type-check**, serially with `nice -n 10`, after `uptime` shows a 1-minute load ≤ 14: `npm ci --no-audit --no-fund`, then `npx tsc --noEmit`, `node_modules/.bin/tsc -p modules/design/projects/tsconfig.json`, `node_modules/.bin/tsc -p modules/design/app/tsconfig.json`. Expect type errors: I wrote 1,000+ lines with no compiler. Likely spots: `satisfies` on `Object.freeze` in `view-model.ts`; `createElement` typing for `ui.Presence`/`ui.InlineNotice` children; `h('h1', { ref, tabIndex })`; the now-unused `body` ref in `detail.ts` (`noUnusedLocals`).
3. **Wire `ProjectsView.tsx`**: import `Presence, Skeleton, FieldError, fieldErrorProps, InlineNotice, useToast, useReducedMotion` from `@hq/ui` into one module-level `ProjectsUi` and pass `ui`; pass `actions={{ openCanvas: () => navigate({ nav: 'review', section: 'canvas' }), compare: () => navigate({ nav: 'review', section: 'compare' }) }}` (section ids confirmed in `canvas/design-module.ts` and `compare/design-module.ts`; both are `nav: 'review'`); build the native folder controls as a node and pass it as `gallery.folders` (restyle, use `hqp-folders`); give the source-details card the class `hqp-source-details` and keep its focus handling; render `<InteractivePanel/>` **after** `<ProjectsSection/>` (reposition only); keep the active-project sync effect and the `onOpenSource` contract that `apps/desktop/src/preview-navigation.integration.test.tsx` mocks.
4. **Update tests**: `render.test.ts` asserts `Switch project` on the gallery and `← Back to Gallery` on a project; both change intentionally (switcher is gone from the gallery; the back button now reads **All projects**). State that in the commit message. The other assertions (`Atlas 1 on Synthetic host A, read-only source entry`, `data-key` counts, `aria-expanded="false" aria-controls="hqp-view-…"`, `aria-pressed="true" data-version="…"`, `Not in registry`, `Read-only`, the future-schema text) were kept compatible by attribute order and copy. Add: pure view-model tests (`galleryPhase` loading vs empty vs no-match vs error, `filterControls`, `overviewLine`, `kindTabs`, `tabAfterKey`, validators) under `node --test`; interaction tests under vitest `.test.tsx` in `modules/design/projects/test` (root vitest config picks up `.test.tsx` only for listed roots, and `modules/design` is not one, so you will need a `// @vitest-environment happy-dom` file run with its own config like `modules/design/app/sections/vitest.config.ts`) covering create flow with Enter and Escape, field errors, disabled-reason on focus, tab arrow keys, add version + toast via a `ToastStoreProvider` store.
5. **Run the check list** from the brief, then `node_modules/.bin/vitest run apps/desktop` once.
6. **Visual evidence**: start `nice -n 10 npx vite --config apps/desktop/vite.config.ts --port 5181 --strictPort --host 127.0.0.1` with `/tmp/f4-projects/vite.log`, copy `/tmp/f4-tools/flow-projects.mjs` into `/tmp/f4-projects/` and adapt it (selectors changed: the New project flow is now the **New project** button, then `input` labelled "Project name", then Enter). Capture 1440×900 light and dark, 1280×800, 1024×768; states: skeleton, empty, populated, no-match, project overview, add-version with a field error, after add (toast + flash), mid-transition frames (~100 ms), one reduced-motion run. Check `/tmp/f4-tools/last-console.log` for errors. Verify: no horizontal page overflow at 560–1100px content widths; tile hover/press/focus; glide on filter change; instant under reduced motion; reflow does not play on scroll.
7. **Optional polish if time**: arrow-key navigation between gallery tiles (Tab order already works); an exit motion when a screen is left (only the enter rise exists).

## Open questions and risks

- Compare gating (decision 10) and the filter thresholds (decision 8) are guesses for the lead to confirm.
- Whether to delete the `ProjectSwitcher` export (needs a lead edit to `projects/src/index.ts`).
- `container-type: inline-size` on `.hqp-screen` and the sticky information panel need a real browser look at 560–1100px; nothing was rendered.
- Render-phase `setState` in `useReflowWindow` and `Cell`'s mount-time `useState(reflowing)` are the subtle bits of the glide; verify they do not replay fades on scroll.
- Toast text and failure copy were written without seeing them in the toast viewport.
- `focusTitle` moves focus to the page title after the first screen; confirm it is not annoying when a project opens from the example workspace's initial state.
- Everything is unverified: treat the WIP as a draft, not a candidate.

## Exists only outside the commits

- Nothing under `/tmp` (no scenario scripts, no screenshots, no vite log). The only thing that lived solely in the conversation was the full `projects.css` draft, which was never written to disk; step 1 above lists every selector and rule it needed.
- `/tmp/f4-tools/` (the lead's `cdp.mjs`, `flow-projects.mjs`, `check-foundation.mjs`) and the before screenshots in `/tmp/f4-evidence/before/` are untouched.

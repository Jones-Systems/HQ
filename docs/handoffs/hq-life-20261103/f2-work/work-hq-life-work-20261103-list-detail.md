# Handoff: F2 builder B (List and detail), paused

Branch: `work/hq-life-work-20261103-list-detail`, from `work/hq-life-work-20261103` @ `18e6502`.
Worktree: the `work-hq-life-work-20261103-list-detail` folder under the T3 worktrees root.
Code head: `64df3f4` ("WIP: List table and card detail redesign…"). This handoff is the next commit on top of it.
Paused by the owner's stop request before any test, preview build or screenshot was run. **Everything below is source that typechecks but has never been rendered or tested.**

## Where things stand

| ID | Status | Notes |
| --- | --- | --- |
| X-8 List title | Written, unverified | `PageHeader` "List", meta `N items · Status changes here use the same move as the board…` (`N of M items` when filtered). The empty state also gets the header. |
| D-1 List Done control | Written, unverified | `DoneButton` in a leading cell, name `Mark “<title>” done`. It calls the same `move(item, 'done')` (`place: 'top'`, Undo toast) as the status select, and is not rendered on Done or Dropped rows. Shown on row hover and focus-within, always on without hover. |
| X-6 kind marks in List | Written, unverified | Uses the shared `KindMark` (not a checkbox shape). Not looked at in a browser. |
| List table (deliverable 1) | Written, unverified | Fixed-layout table; sticky header; 40 px rows; sort arrow; title cell is flexible with ellipsis and a `title` attribute. Status, Why, Horizon and Priority are chip-styled native selects. Rows glide via `useListMotion` + `data-hq-motion-key` and fade out through `usePresence` when filtered out. Columns drop out by container width (Updated, Steps, then Area, Priority, then Why, then Horizon, then Next date) with a quiet "Some columns are hidden" note. |
| D-3 detail panel (deliverable 2) | Written, unverified | See "What was built" below. |
| Fluid panel 320–640 (deliverable 3) | Written, unverified | The panel is its own `container` (inline-size) and lays out by the width it is given. Sticky header, body padding and form grids change at 400 px, and the property list goes to two columns at 540 px. Close button and Escape kept. |
| F7-X13 Advanced disclosure (deliverable 4) | Written, unverified | See decisions 4 and 5. |
| F7-X6 detail side (board squeezed to ~60 px at 760) | **Not addressed beyond making the panel fluid** | The squeeze comes from the host grid in `nav/**` (`.wd-workarea--detail`, slice E). My panel can render at any width, but I changed nothing that stops the board being squeezed. Needs slice E's overlay sheet. |
| Tests (new and updated) | **Not started** | No test file touched. Several existing assertions will need updates (list below). |
| Screenshots | **Not started** | `/tmp/hq-f2/list-detail/` is empty. No preview was built, no server started. |

## What was built (files)

Detail (`modules/work/detail/`):
- `CardDetail.tsx` (rewritten): sticky header with `StatusIndicator` (Saving…, Saved · time, Changed elsewhere, Unsaved changes, Save result unknown + Check, Offline), a `Present`-wrapped `InlineNotice` for conflicts (Keep mine / Use theirs through the existing `editor.keepMine` / `editor.useTheirs`) and for Archived (bar variant, Restore). The title is now a `<textarea rows=1>` named "Card title" (`field-sizing: content`, with a JS fallback through a CSSOM `--work-title-h`). Props are a label+chip list. Slide-in uses `hq-enter-slide-end`. Slide-out is a cloned ghost (decision 2).
- `StatusPills.tsx` (new): pills with `role=group` and `aria-pressed` kept, plus an indicator that glides between pills (position set through CSSOM custom properties; first placement instant).
- `ChipPicker.tsx` (new): a chip-styled `@hq/ui` `Menu` (menuitemradio items, trigger named `Why: Need`). Used for Why, Horizon, Priority and Kind.
- `exiting.tsx` (new): `useExiting` (keeps a removed item mounted at its old place until its exit finishes), `Present` (a `usePresence` wrapper that also marks the exiting element `aria-hidden` and `inert`), `useMounted`, `leavingProps`. Used by the Checklist and by List. A candidate for promotion to shared code.
- `Checklist.tsx`: rows enter with rise, leave with fade, and glide via `useListMotion` (`animateEntering: false`). Progress bar through CSSOM `--wk-progress` (0..1). Custom checkbox with a drawn check, a strike-through that fades in, hover-reveal row actions (always reachable by keyboard), and `FieldError`.
- `DateEditor.tsx`: date rows use the theme `wk-chip` family (kind icon, dashed when coarse, "Overdue · " / "Target passed · " words), and `FieldError`.
- `References.tsx`: HQ rows show "Social · Draft" and the title instead of `HQ · social · draft`. The raw source revision is now only a tooltip. The read-only honesty line is kept. `FieldError`.
- `HqLinks.tsx`: the paste box and Add reference moved into `<details class="work-advanced">` "Advanced" (collapsed). `FieldError` replaces the bare `<p role=alert>`.
- `detail.css` (rewritten), `index.ts` (new exports).

List (`modules/work/views/`): `ListView.tsx` (rewritten), `list.css` (rewritten).

## Decisions and why

1. **List pickers are native `<select>`s drawn as chips, not `@hq/ui` `Menu`.** The shared, off-limits `views/test/views.test.tsx` has six call sites that do `getByRole('combobox', { name: 'Status of …' | 'Horizon of …' })` + `user.selectOptions(...)` (and one that checks `.value`). A Menu cannot satisfy those, and I may not edit that file. Mockup 08 also draws Status and Horizon as select-style controls. The labels keep their old names (`Status of <title>`, `Horizon of <title>`); Why and Priority follow the same pattern (`Why of <title>`, `Priority of <title>`). Status goes through `move`; the others are one-field patches. **If you want Menu in List, the six call sites in `views.test.tsx` need a mechanical change** (open the trigger, click the menuitemradio); `ChipPicker` is ready to drop in.
2. **Slide-out is a cloned ghost.** The host unmounts `CardDetail` the moment `onClose` runs, and `nav/test/domain.test.tsx` asserts `navigate` was called right after the Close click, so `onClose` cannot be delayed for an exit animation. `slideAway()` clones the panel (inert, `aria-hidden`, fixed at the old rect, positioned by CSSOM vars) and plays a WAAPI exit, then removes the clone. The layout still collapses at once. A real glide needs slice E to wrap the panel in `Presence` in `WorkDomain`.
3. **Area stays a text input** (with a `<datalist>` of existing areas), not a Menu. It is free text that must never select a project, and existing tests drive it as a textbox.
4. **Raw IDs.** `LinkList` / `ReferenceChip` live in `packages/hq-ui` (F1, off-limits) and print the provenance line (`domain · kind · entityId · Project … · Snapshot revision …`). I hide `.hq-reference-provenance` with CSS unless the Advanced disclosure is open (`.work-hqlinks[data-advanced="closed"]`). Title, state word and freshness stay visible. **Gap:** the friendly "kind" label is not shown on project-scoped rows, because `ReferenceChip` has no slot for it. Ask F1 for a prop to hide the raw provenance and show a friendly kind.
5. **Disclosure is a native `<details>`**, so the textarea stays in the DOM when collapsed and `modules/work/references/test/links.test.tsx` (outside my cone, six tests use `getByRole('textbox', { name: 'Paste reference JSON' })`) should keep finding it. **Unverified** that happy-dom does not treat closed `<details>` content as inaccessible. If it does, those tests fail and need a different structure.
6. The conflict notice uses `live="assertive"` so it keeps `role="alert"`, which existing tests query.
7. `node_modules` was missing in this worktree (the other F2 worktrees use a symlink farm back to the lead's install). I built the same farm with `ln -s` (no install; `@hq/*` links are relative to this worktree). It is untracked and ignored by git.

## Findings so far

- `npx tsc --noEmit -p .` at the worktree root: first run found one error (`leading && 'has-lead'` passed a non-string to `cx`), fixed; the rerun printed nothing (clean). Run before the WIP commit.
- **Not run:** vitest (any scope), the three desktop-shell test files the lead listed, a preview build, and all screenshots. There are no test results to report.
- Likely test updates (none made yet):
  - `detail/test/detail.test.tsx`: the `combobox` `Why` queries with `fireEvent.change` (3 tests: select-vs-elsewhere conflict, field edit with Undo, plus the conflict path) become open-trigger (`button` named `Why: …`) then click a `menuitemradio`.
  - Same file: `getByText('HQ · social · draft')` becomes `Social · Draft`.
  - "Card title" is now a `<textarea>`, so `as HTMLInputElement` casts in tests are fine at runtime but wrong in types.
  - The Archived test expects `getByRole('status')` to be unique. The header `StatusIndicator` also has `role=status`, but only renders when there is a save state. Check it.
- Things I expect could bite and have not checked:
  - Presence rows: filtered-out List rows stay in the DOM about 320 ms in happy-dom (marked `aria-hidden`/`inert`), so tests that count `row`s right after a filter change may see ghosts through `getByText`.
  - `useListMotion` FLIP on `<tr>` and a sticky `<th>` inside `overflow: clip`.
  - Container-type on `.work-detail` and `.wl` (layout containment makes them containing blocks) with the Menu popup, the sticky header and the host's `overflow: auto` on `.work-detail`.
  - The cloned ghost keeps stale textarea values and duplicate ids (harmless while `aria-hidden`).
  - The ghost lingers 400 ms in tests that fake `setTimeout`.
  - The `StatusPills` glide and its `ResizeObserver` guard.
  - Dark mode for every new rule.
- The lead's desktop-shell hooks, by design, kept: "Card title" textbox named exactly with the item title as its value; blur and Enter commit one `title` patch (`onBlur` → `flushNow('title')`); the List row title button's name is exactly the item title (the Done button's name differs); `Open <title>` buttons come from the unchanged `LinkList`. All still to be proven by running the tests.

## What's left, in priority order

1. Run `npx vitest run modules/work/detail modules/work/views modules/work/references modules/work/nav --no-file-parallelism` (check `/proc/loadavg` first; the host was above 13 for most of this session). Fix failures. Do not touch `views.test.tsx` or `harness*`.
2. Update the detail test assertions listed above, and list each change in the final report.
3. Add the tests the brief asks for, in `detail/test/` and new `views/test/list-*.test.tsx`: List Done control (moves to Done, Undo restores); chip-menu and select edits write the same store patches as before (status `move` with `place: 'top'`, horizon / why / priority patches); the detail `StatusIndicator` states; the conflict notice's Keep mine and Use theirs call the existing paths; the Advanced disclosure hides the raw JSON by default (`details.open === false`) and shows it when opened; checklist toggles still write.
4. Run the lead's shell check: `npx vitest run apps/desktop/src/social-work.integration.test.tsx apps/desktop/src/references.integration.test.tsx apps/desktop/src/preview/composition.test.tsx --no-file-parallelism`.
5. Build the preview (`bash /tmp/hq-f2/tools/preview-build.sh <worktree> /tmp/hq-f2/list-detail/preview`), serve on port 4302, and capture to `/tmp/hq-f2/list-detail/after/`: List 1440 light and dark, List 760×600, row hover showing Done, detail open light and dark, detail as a narrow panel (320 and 640 content widths), a chip picker open, a conflict notice (test-only state is fine), the Advanced disclosure open. Compare with evidence 08 and 05 and fix clipping, hues in dark, and the 760 layout. Stop the server afterwards.
6. Run the full `npx vitest run modules/work --no-file-parallelism` and `npx tsc --noEmit -p .`, push, and write the final report in the brief's format.

## Open questions and risks for the lead

- Is a native select drawn as a chip acceptable in List (decision 1), or do you want Menu there and will you update the six `views.test.tsx` call sites?
- Slice E: will the overlay sheet at narrow widths and a real slide-out (`Presence` around the host) be provided? That is also what fixes F7-X6 (board squeezed to ~60 px at 760).
- F1: a `ReferenceChip` / `LinkList` prop to hide raw provenance and show a friendly kind would remove my CSS workaround.
- `exiting.tsx` (`useExiting`, `Present`) and `ChipPicker` may be worth promoting if other slices want the same behaviour.

## Where things exist

- Committed and pushed: all source above, on the branch at `64df3f4`.
- Not committed: nothing else in the worktree. `node_modules` is an ignored symlink farm.
- `/tmp/hq-f2/list-detail/`: empty. No screenshots, no preview build. No server was started by this lane.
- This thread: only the reasoning and design notes summarised here.

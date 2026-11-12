> Historical lane record. Recovery uses ordinary ancestry merges and source-only checks; earlier install, execution, rewrite and capture instructions are superseded by the recovery capsule. Private historical paths are omitted. See [recovery source receipt](recovery-core-20261112.md).

# F4 Design core views: Requests, Returned, Runs (builder B4) — handoff

Paused on request from the F4 lead, relayed from the HQ coordinator. **Nothing here has been compiled, tested or run in a browser.** The code was written whole and reviewed by reading only, because `node_modules` was missing in this worktree and the host load stayed at 30 to 68 against the "wait below 14" rule. Treat every file as unverified until the checks below pass.

- Branch: `work/hq-life-design-core-requests-20261103` (from `origin/work/hq-life-design-core-20261103`), pushed, no PR opened.
- Worktree: `[retained private path omitted]`
- Base: `be4a0b2` (Add the Design core flow assessment and before evidence)
- WIP commits, in order:
  - `45e220d` WIP: Make Requests, Returned and Runs alive in the Design handoff (25 source and CSS files)
  - `646b93f` WIP: Update request UI render tests for the stepper and guarded buttons (2 test files)
  - The head SHA is the commit that adds this handoff file. It is in the final reply.

## Where each build target stands

Legend: **written** means the code exists and is committed but has never been compiled or run.

| # | Target | Status |
|---|---|---|
| 1 | Complete the loop in the example workspace (`example={!workspace.bridged}`, simulated destination, freeze, Runs, simulate, Returned, review) | Written. Not exercised in a browser. |
| 2 | Request list with status chips; New request from all project versions, read fresh, disabled versions with reasons, FLIP insert, toasts | Written. |
| 3 | Stepper Draft → Clarify → Freeze → Review, freeze blockers beside the control, freeze toasts | Written. |
| 4 | Returned tab inside Requests, provenance chips, slide-in and FLIP between groups, manual return behind a collapse | Written. |
| 5 | Runs as cards with status chips, animated status change, `toast.loading` → success on simulate, connector panel kept | Written. |
| 6 | `role="alert"` and detached messages replaced by InlineNotice or toasts; empty states with actions | Written. |
| Tests | Update existing assertions; add tests for the example-mode loop, disabled-version reasons, freeze blockers, Returned tab | Existing render and lifecycle tests updated (not run). **New tests not started.** |
| Checks | tsc ×3, node tests, vitest ×3, `vitest run apps/desktop` | **Not run.** Needs `npm ci --no-audit --no-fund` first. |
| Visual evidence | Screenshots under `[retained private path omitted]`, reduced-motion run | **Not started.** No dev server was ever started; port 5184 is free. |

## What exists

All paths under `modules/design/`.

- `requests/ui/model.ts` (rewritten, framework-free): stepper progress (`stepProgress`), request status chip and title (`requestStatus`, `requestTitle`), hold reasons, provenance and decision labels, handoff timeline.
- `requests/ui/` new components: `GuardedButton` (aria-disabled plus a reason on hover and focus through `aria-describedby`, every activation path refused), `RequestStepper`, `RequestList` (FLIP via `useListMotion`), `SourceVersionPicker` (Skeleton while loading, radio group by view, disabled rows with the reason), `ReturnedRow`, `ManualReturn` (Presence collapse), plus `hooks.ts` (`useSessionStates`, `useChangeFlash`, `useLoadable`) and `context.ts` (simulation label).
- `requests/ui/` rewritten: `DraftEditor`, `ReviewScreen`, `PacketHistory`, `ReturnsInbox`, `RunsView` (cards and per-packet timeline), `RequestsView`, `requests.css`.
- `app/sections/requests/` new: `Workbench.tsx` (list rail, detail, Tabs "Requests" | "Returned (n)"), `NewRequest.tsx`, `ReturnedTab.tsx`, `ReturnChips.tsx`, `request-page.css`. `View.tsx` updated.
- `app/sections/runs/View.tsx`: single-action guard, "Open packet" and "Simulate returned work" controls, simulate toast `loading` → success/warning, refresh.
- `app/compose/closure-views.tsx`: `RequestPicker` now builds `WorkbenchPorts` and renders the workbench; `mountRequests` passes `example={!workspace.bridged}`; `mountRuns` passes `onOpenRequests`. `mountReferences` is untouched.
- `app/compose/chrome-reset.css`: the `.hqd-request-*` and related page rules were removed and now live in `app/sections/requests/request-page.css`, with a pointer comment left behind.

## Decisions and why

- **Stepper reflects the data, not the editor.** Clarify is "current" only while a clarification is open; once a question has been asked the Clarify phase would otherwise stay current forever. Review is current when a candidate is open or a head packet exists with no pending draft change.
- **Destination is not a freeze blocker** (the session's `freezeBlockers` does not include it). It only matters for send or simulate, so the destination control is offered in the draft but the Freeze control does not list it.
- **Unavailable controls use `aria-disabled`, not `disabled`.** They stay focusable so the reason shows on keyboard focus. This intentionally changes `.disabled` assertions in `ui.render` and `ui.lifecycle` to `aria-disabled` plus `aria-describedby`. The facts asserted are the same.
- **Returned is a tab inside Requests**, mounted only when active, with no new section id, descriptor or CI inventory row. The Requests tab panel stays mounted so editor state survives a tab switch.
- **New returns are detected with a module-level `WeakMap`** of shown candidates per session, so only returns that arrive while the tab is on screen slide in. Review decisions move rows between "To review" and "Reviewed" through one FLIP container spanning both groups.
- **Version list is read fresh** on mount and when New request opens (`workspace.readContent(project)` through an effect-based `useLoadable`, never a suspending promise in `useState`).
- **Simulation stays example-only.** The labelled destination is offered only when `example` is true; Runs shows "Simulate returned work" only when `env.pipeline.mode === 'example'`. The desktop store keeps the connected path, and nothing sends without its existing explicit confirmation.
- **Responsive layout uses container queries** on `.hqd-request-page` (rail plus detail at 860px), because the Design inspector makes the page 560 to 1100px regardless of window size.
- **Layout rules moved out of `chrome-reset.css`** into a stylesheet in my owned path to keep the diff inside the cone.

## Findings so far

- `StatusChip` renders `detail && <span>…`, so a numeric `0` detail renders as a bare "0" text node with no wrapper. Fixed locally in `ReturnChips.tsx` by passing `String(count)` (in `45e220d`'s tree: the fix is in the working copy that commit captured). Worth a small F1 fix: `detail !== undefined`.
- `app/sections` vitest runs in the `node` environment; DOM-level assertions there need `// @vitest-environment happy-dom`. `@testing-library/react` 16.3.3 and `user-event` 14.6.8 are installed at the root.
- Both the requests and sections `renderer-safe` tests walk every runtime import and reject node built-ins, `process.`, `Buffer`, `fetch(`, and unlisted packages. New files import only `react`, `@hq/ui` and relative modules, but this has not been run.
- One transient `git push` rejection (`[remote rejected] … (failed)`) cleared on an immediate retry.
- No stored request, packet, outbox or evidence format or storage key was changed.

## Left to do, in priority order

1. **Install and typecheck.** Run `uptime`; when 1-minute load is below 14, `npm ci --no-audit --no-fund`, then serially with `nice -n 10`: `npx tsc --noEmit`, `node_modules/.bin/tsc -p modules/design/requests/tsconfig.json`, `node_modules/.bin/tsc -p modules/design/app/tsconfig.json`. Expect some type errors; the known risks are listed below.
2. **Run the existing suites** and fix regressions: `node --test --test-concurrency=1 'modules/design/requests/test/*.test.ts'`, `vitest run --config modules/design/requests/vitest.config.ts`, `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts`, `node --test --test-concurrency=1 'modules/design/app/sections/**/*.test.ts'`, `vitest run --config modules/design/app/sections/vitest.config.ts`.
3. **Finish the test updates in `modules/design/app/sections/test/views.test.tsx`** (not started). Replace `'1 simulated returns'`, `'1 owner-reported returns'` and `'0 natively verified returns'` with chip checks such as `/hq-status-label">Simulated<\/b><span class="hq-status-detail">1</span>/`; replace `hqd-packet-list` with `hqr-cards`. The "no simulated destination by default" test should still pass.
4. **Add new tests** (all under my cone):
   - example-mode loop with fake ports through `RequestsWorkbench` and `@testing-library/react`: create → destination → freeze → simulate → Returned → review
   - disabled-version reasons: `aria-disabled`, `aria-describedby`, still focusable, click refused
   - freeze blockers: `aria-describedby`, guarded click and form submit
   - Returned tab: chip counts, groups, `data-hq-presence` on new rows, item moves group after a decision
   - `stepProgress` and `requestStatus` as framework-free `node --test` tests
5. **Visual evidence** (target list in the task): dev server on port 5184 only, `mkdir -p [retained private path omitted]` first, copy `[retained private path omitted]`, update selectors for the list, tabs and button labels, capture to `[retained private path omitted]`: 1440×900 light and dark, 1280×800, 1024×768, each loop step, one empty state, one `prefers-reduced-motion: reduce` run. Check `[retained private path omitted]` for errors per run. Stop the server afterwards.
6. `node_modules/.bin/vitest run apps/desktop` once, and the connector tests if anything Runs depends on is touched.
7. Replace the WIP commits with small focused ones going forward (do not rewrite pushed history; add commits on top), then push and report.

## Open questions and risks

- **Unverified types:** `new Map<string, string>(content.views.map(...))` in `closure-views.tsx`; the `id` prop on `Presence`; `Presence as="li"` with `onAnimationEnd` and `data-*` props; the `Tabs` API shape (`selectedId`, `onSelectedChange`, `panel`).
- **SSR:** `Presence`, `useListMotion` and `useAsyncAction` are rendered through `renderToStaticMarkup` in the existing tests; if any needs a browser API, those tests fail and the components need guards.
- **Layout and hover:** the 560–1100px container-query layout, the hover and focus reveal of the disabled-version reason (inline swap with reserved height), and the `:has(input:focus-visible)` ring have only been reasoned about, not seen.
- **Reduced motion:** the stepper and timeline fills are pseudo-elements driven by `data-position`, so they should jump; `hq-flash` is colour-only by design. Not yet verified.
- **Heavy host:** other lanes keep the load above 14. The `npm ci` and test runs may need to wait or be scheduled by the lead.
- **Copy** has not had a pass for sentence case and consistency across toasts.

## Requests for the lead (outside my cone)

- `closure-views.tsx`: I changed the import block at the top (removed `Button`, `StatusChip`, `ProjectContent`; added `useMemo`, `ValidationError`, `brandId`, `NO_SOURCE_REVISION_REASON`, the picker and workbench types). F5's `mountReferences` edits in the same file may conflict on the import lines.
- `docs/ui-map` and `modules/design/requests/README.md` need updating for the new Returned tab, list and stepper; both are outside my owned paths.
- There is no deep link from Runs to the Returned tab. The Runs toast "Open Requests" lands on the Requests tab and the owner clicks "Returned (n)". A navigation intent with a tab target would need a shell change.
- The `.hqd-request-*` and related rules moved from `chrome-reset.css` to `app/sections/requests/request-page.css`.
- F1: `StatusChip` should render `detail` when it is `0` (see Findings).

## Only uncommitted, only in /tmp, or only in this thread

- **Uncommitted:** nothing. The working tree is clean after the WIP commits and this file.
- **In /tmp:** nothing of mine. `[retained private path omitted]` and `[retained private path omitted]` were never created, so there are no after screenshots and no scenario scripts. The before evidence is committed under `docs/design/hq-visual-system/evidence/design-core-20261103/before/` (assessment in `docs/design/hq-visual-system/design-flow-assessment-20261103.md`). Shared tools `[retained private path omitted]` are untouched.
- **Only in the thread:** the reasoning above. Full prior transcript: `[retained private path omitted]`.
- **Processes:** no vite server was started (port 5184 is free). The background load-waiter finished on its own.

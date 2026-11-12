> Historical lane record; recovery scope and checks supersede its execution instructions. See [recovery source receipt](f4-design-core/recovery-core-20261112.md).

# F4 handoff — Design core views (2026-11-03)

Lane F4 makes the HQ Design module's core views alive and complete: Projects (the project gallery and a
project's Overview/Gallery screen), Canvas, Compare, and the Requests / Returned / Runs handoff. The lead was
Opus 5.5, with four Sonnet 5.5 builders (F4-B1 to F4-B4; not the backend lanes B1 to B3). Work paused at
the owner's request on 2026-11-03, relayed by the HQ coordinator. No PR is open. Nothing was merged or
deployed. The only installs were `npm ci` runs inside builder worktrees.

## Where it stands

| Part | State |
| --- | --- |
| Flow assessment ([design-flow-assessment-20261103.md](../../design/hq-visual-system/design-flow-assessment-20261103.md)) | **Done.** Findings, journey table, decisions, build plan. |
| Before evidence (8 curated PNGs + conditions README in `docs/design/hq-visual-system/evidence/design-core-20261103/before/`) | **Done.** |
| Foundation: Design-scoped active project | **Done** (`c194b43`). |
| SVG chevrons for secondary panel toggles (cross-app finding X14) | **Done** (`acced90`). |
| Section loading skeleton, in-place Try again, section fade-in | **Done** (`d90f846`). |
| F4 builder B1: Projects gallery + project overview | **Paused early.** View source partly written, never compiled or tested. CSS, wiring, tests and screenshots not started. See [builder handoffs](#builder-handoffs). |
| F4 builder B2: Canvas | **Built, partly verified; cancelled at the pause.** Six commits cover thumbnails, camera easing, the toolbar and feedback. Node tests pass. Other checks are unknown. 54 screenshots exist; there is no handoff file. See [builder handoffs](#builder-handoffs). |
| F4 builder B3: Compare | **Built, partly verified.** All seven targets built. The Compare typecheck and tests pass. Other cones, 1024×768 and reduced motion not checked. See [builder handoffs](#builder-handoffs). |
| F4 builder B4: Requests, Returned and Runs | **Written, never compiled.** All six targets written. Nothing compiled, run or captured; new tests not started. See [builder handoffs](#builder-handoffs). |
| Lead review of builder screenshots, fix rounds | **Not started.** |
| Integration of builder branches into the lane branch | **Not started.** |
| After evidence, UI-map entry, full checks, PR against `work/hq-foundation` | **Not started.** |

## Branches, worktrees, SHAs

| What | Branch | Worktree | Head |
| --- | --- | --- | --- |
| Lane (lead) | `work/hq-life-design-core-20261103` | `[retained private path omitted]` | the commit that last changed this file; the lead's code ends at `d90f846` |
| Base | `work/hq-foundation` `0cd50ab` + lane F1 `work/hq-life-system-20261103` `284393d` (fast-forward) | — | — |
| Builders | see [builder handoffs](#builder-handoffs) | created by T3 from `origin/work/hq-life-design-core-20261103` at `be4a0b2` | — |

Lead commits on top of `284393d`: `c194b43` (active project), `acced90` (chevrons), `be4a0b2` (assessment and
before evidence), `d90f846` (section loading and recovery). All are pushed.

## What the lead built

- **Active project** (`modules/design/app/compose/active-project.ts`, `useDesignProject` in
  `workspace-context.tsx`, `views/ProjectScope.tsx`, `SectionFrame` `scope` slot). The project opened in
  Projects scopes Canvas, Compare, Annotations, Requests and Runs. Each shows "Project · name · Change" at the
  top of the section. The store lives as long as the composition and records nothing durable; it defaults to
  the shell context. `ProjectsView` syncs it from the projects controller, and tolerates controller doubles
  that have no store (`apps/desktop/src/preview-navigation.integration.test.tsx` stubs `{}`).
- **Example workspace coherence** (`fake-workspace.ts`). All example projects share one in-memory store. A
  project listed in the registry before its content is first read was created in Projects, so it gets no
  synthetic seed: no synthetic components, flow or compare sample, and annotations return null when there is
  no version. The registry seed merges instead of overwriting.
- **`readContent(project)`** on the workspace (`workspace.ts`). It re-reads stored content, because
  `contentFor` memoises the content it first loaded.
- **Section loading and failure** (`modules/design/ui/src/view/SectionOutlet.tsx`,
  `compose/views/SectionErrorBoundary.tsx`). A skeleton shaped like a section replaces "Loading …". It
  appears after `--hq-duration-fast` and carries a status for assistive technology. Failures show F1's
  `InlineNotice` inside the section with **Try again**. The outlet's retry reloads a lazy section whose code
  failed to load. Composed sections fade in (`hq-enter-fade` on `.hqd-compose-frame`).
- **Toggles** in `modules/design/ui/src/secondary-panels.tsx` draw an SVG chevron instead of › ‹ ⌃ ⌄.
- Tests: `modules/design/app/compose/test/active-project.test.ts`,
  `modules/design/ui/test/vite/section-outlet.test.ts`.

## Decisions and why

1. **The project opened in Projects scopes Design.** The shell's project context is fixed and production has
   no switching (`requestProjectContext: null`); F1 owns the shell. A composition store is the smallest
   reversible fix. It can be removed once the shell can switch projects.
2. **Keep the Design navigation.** Overview and Gallery become the project screen in Projects, and Returned
   becomes a tab in Requests. No section ids, descriptors or CI inventory rows change. Placement stays
   provisional for owner review.
3. **Swipe is a `clip-path`, not a blend.** The visual system forbids filters, blend modes and lasting
   opacity on preserved content, so onion skin and difference views are out.
4. **Feedback follows F1's mapping:** toasts for outcomes, `InlineNotice` for problems with content on
   screen, `StatusIndicator` for ongoing state, `Skeleton` for loading, and boundaries only for crashes,
   with Try again.
5. **Simulation is example-only and labelled.** The desktop path keeps its explicit send confirmation.
6. **Canvas camera.** The stored camera is restored only for the shell project's canvas, because the session
   format is strict and shared. A per-project camera was left to the Canvas builder.
7. **The lane leaves `bridged-workspace.ts`, `compare-catalog.ts` and `thumbnail-port.ts` alone.** Open PRs
   #165, #168 and #179 rewrite them.
8. **Method.** Frontend-Development's variation-driven design (at
   `71c2c704930155d0b5b1e9b0646dd5d7914c7659`) defaults to owner-selected variation rounds. No owner was
   available for rounds, so the lane works inside the accepted visual system and records reversible
   decisions. The PR is the review point.

## Findings

The top six are in the assessment:

1. Projects is disconnected from the rest of Design. **Fixed.**
2. The handoff loop can't finish in the example. **Assigned to B4.**
3. Feedback is full-screen or far away. **Section-level part fixed; the rest is with the builders.**
4. Nothing moves.
5. Review surfaces show implementation instead of work.
6. Chrome costs: the inspector is open by default, and glyph toggles render as empty boxes. **Toggles fixed.**

Found during the build:

- In the desktop store, `contentFor`, `canvasFor` and `annotationSessionFor` are memoised per project, so
  versions added in Projects don't reach those views until a reload. The answers are `readContent`
  (Requests) and refreshing providers on mount (Canvas brief). Annotations is still stale.
- `perProject` caches rejected promises. Try again cannot recover a failed data load until the cache evicts
  rejections; in the desktop store that code is in `bridged-workspace.ts`.
- Versions created by hand have no source revision, so they can't seed a request. The UI must say so (B4
  brief).
- Cross-app findings from F7: X1 (first-launch empty state) is assigned to B1. X2: F4 prefers one
  shell-owned ⌘K that Design registers with, and told F7 so. X14 is fixed.

## Checks run by the lead (at `d90f846`, Node 26 on the host; CI uses Node 24.19)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit`; `tsc -p modules/design/app/tsconfig.json`; `tsc -p modules/design/ui/tsconfig.json` | pass |
| `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts` | 197 pass, 0 fail |
| `vitest run --config modules/design/ui/vitest.config.ts` | 16 pass (3 files) |
| `vitest run --config modules/design/app/sections/vitest.config.ts` | 4 pass |
| `node --test --test-concurrency=1 modules/design/projects/test/*.test.ts` (at `c194b43`) | 40 pass |
| `vitest run apps/desktop` | 379 pass, 6 fail. All six test the emitted Electron build (`dist-electron` absent; `npm test` builds it first). Not yet rerun after a build. |
| Browser journey: create project → add view → add version → Canvas, Compare, Requests scoped to it | verified in headless Chromium 156 (example workspace) |
| Full CI matrix, `npm run build`, Electron and native journeys | not run |

## What's left, in priority order

1. **Fix two example-workspace bugs in the lead-owned `fake-workspace.ts`.** B3 found both.
   - `compareFor` treats the example project as user-created once Projects has listed it, because
     `createdInProjects` is true for it. Compare then shows an empty comparison for the example. Decide with the
     `contentFor(...).example` flag instead, and check the other accessors that call `createdInProjects`.
   - The example catalog's `listViews(projectId)` returns nothing for the example project: the comparison
     uses `hq-local` and the sample catalog uses `sample-project`. B3 works around it by reading versions from
     `snapshot.versions`.
2. **Review and finish the builder branches, most ready first.** For each branch, read its handoff (linked
   below) and review its screenshots against its brief and the assessment. Then finish the remaining
   targets, either directly or in a new delegated round that gets the original brief, the handoff and the
   review findings.
   1. Compare (B3): capture 1024×768 and reduced motion, and run the remaining cones.
   2. Canvas (B2): no handoff exists, so start from its six commit messages and the note under the builder
      table. Run the canvas and app rows of `HQD_INVENTORY`, including
      `compose/test/canvas-load-cache.test.ts`. Rerun the dark scenario and explain dark run A's failures,
      then review the 54 shots.
   3. Requests (B4): run `npm ci`, then typecheck, test and fix. Add the new tests, then walk the example
      loop in a browser and capture it. This branch closes finding 2.
   4. Projects (B1): write `projects.css`, then wire `ProjectsView.tsx` to pass `ui` (the `@hq/ui` exports)
      and `ProjectActions`. Then compile, test and capture.
3. **Follow the backend B3 agreement** (see [open questions](#open-questions-and-risks)):
   - Backend B3 rebases; F4 keeps its branch.
   - Re-read on `contentEvents.revision(project.id)` once W1 is available.
   - Have new content writers call `contentEvents.notify`.
   - Send F1 the `ActiveProjectStore` shape (X8).
4. **Integrate** the builder branches into `work/hq-life-design-core-20261103` one at a time, as each passes
   review. Builders were confined to separate cones, so conflicts should only appear where a builder edited
   lead-owned lines in `ProjectsView.tsx`, `CanvasView.tsx`, `CompareView.tsx` or `closure-views.tsx`.
   Squash or reword the `WIP:` commits when integrating.
5. **Run checks:** `npm run build:electron`, then `node_modules/.bin/vitest run`, `npm run typecheck`, and
   the design-sections rows for every touched cone (app, app-sections, ui, projects, canvas, compare,
   requests, annotations). The commands are in `.github/workflows/design-sections.yml` `HQD_INVENTORY`.
6. **After evidence:** 1440×900 light and dark, 1280×800, 1024×768, and reduced motion, using
   `[retained private path omitted]` scenarios. Curate into `evidence/design-core-20261103/after/` and update the
   evidence README.
7. **UI map:** add `docs/ui-map/design-core.md` (entry points, states, journeys, evidence state) and an
   index row in `docs/ui-map/README.md`.
8. **Open one non-draft PR** against `work/hq-foundation` with before/after screenshots, then link and watch
   it. Do not merge. Note two things in it:
   - F5's PR edits adjacent hunks: `fake-workspace.ts` `discoveryEnv` (beside F4's `projectsFor`) and
     `closure-views.tsx` imports.
   - #179 replaces the desktop compare catalog and thumbnails; recheck Compare for the active project after
     it lands.
9. **Follow-ups for other owners:**
   - Design chrome: inspector closed by default.
   - Shell-owned ⌘K (F7 X2).
   - F5's Sources views may opt into `useDesignProject`; F5 listed this as a follow-up.
   - Evict rejected promises in the workspace caches.

## Open questions and risks

- **Known conflict with backend lane B3** (from F7's merge-tree scan of 14 lane branches; this was the only
  conflicting pair). Backend lane B3 is the Design backend, not F4's Compare builder.
  - Both sides edit `modules/design/app/compose/workspace.ts`. F4's `c194b43` and `d90f846` add
    `activeProject` and `readContent`. Backend B3's W1 (`3917ee9`, branch `work/hq-b3-design-errors-20261103`)
    adds `contentEvents` to the same return statement and threads it into `createInteractiveWorkspace` and
    `createBridgedWorkspace`.
  - Both solve stale project content. F7 suggests one mechanism: backend B3 owns `compose/` wiring under
    #189's frontend contract. Once W1 lands, F4's views re-read on `contentEvents.revision(projectId)`.
    `freshContent`/`readContent` then either moves into backend B3's W3 or stays as a labelled stopgap.
  - **Resolved (backend B3, 2026-11-03 09:47):** backend B3 resolves the conflict on its side and F4 does not
    rebase. When backend B3 lands after F4, it keeps `activeProject` (`compose/active-project.ts`,
    `useDesignProject`) and `readContent(project): Promise<ProjectContent>` with F4's exact signature.
  - **Freshness:** use backend B3's `workspace.contentEvents` (`notify`, `subscribe`, `revision`), documented
    in `modules/design/app/compose/BACKEND-CONTRACT.md` on `work/hq-b3-design-errors-20261103` at `3917ee9`.
    Backend B3's W3, in progress, makes the cached accessors reload on content events and adds
    `useProjectContentRevision(workspace, projectId)`. For in-place refresh before W3, key `readContent` reads
    on `contentEvents.revision(project.id)`.
  - **Their request:** any new project-content writer F4 adds must call `contentEvents.notify(projectId)`
    after the write, including after an unknown outcome.
  - Backend B3's compose PRs stack on #179. Ping backend B3 before changing `workspace.ts` again; they will
    take the resolution.
- **Two project notions (cross-app finding X8).** The shell footer still shows the shell context while
  Design shows the active project. F7 asked F4 to send F1, which owns the shell's project switcher, the
  `ActiveProjectStore` shape: `current()`, `subscribe(listener)`, `set(project | null)`, nothing durable.
  Then the shell can show or adopt it. Not sent yet because of the pause. HQR-1 activation stays owner-held.
- The owner should review the active-project scope, the navigation mapping and swipe-only Compare.
- The lead has not reviewed any builder output yet, so its quality is unknown. B1's and B4's code has never
  been compiled, and B2's checks after its first node run are unknown.
- Merge order with F5 and #179 may produce small conflicts in shared compose files.
- The desktop (bridged) behaviour of the new views has not been exercised. Evidence comes from the browser
  example workspace only.

## Exists only outside the repository

- `[retained private path omitted]`: the CDP screenshot harness (`cdp.mjs`) and scenarios (`before.mjs`, `flow-handoff.mjs`,
  `flow-projects.mjs`, `check-foundation.mjs`). Task-owned; not committed.
- `[retained private path omitted]`: the full before set (18 view shots and 12 flow shots); 8 are curated in the
  repo. `[retained private path omitted]`: 3 foundation-check shots.
- Builder evidence, none of it curated or committed yet:
  - Canvas (B2): `[retained private path omitted]` (54 after shots, run logs, a probe shot). Its scenarios are in
    `[retained private path omitted]`: `canvas-after.mjs`, `canvas-after-b.mjs` and `canvas-probe.mjs`.
  - Compare (B3): `[retained private path omitted]` (38 shots); its harness is `[retained private path omitted]`.
  - Projects (B1) and Requests (B4) produced no screenshots.
- Leftover headless Chromium profiles from the harness, `[retained private path omitted]`, are safe to delete.
- `[retained private path omitted]`: read-only copies of the Frontend-Development guidance at `71c2c70`.
- Thread-only coordination:
  - F7: X1, X2 and X14 answered.
  - F5: said it is not editing `SectionOutlet.tsx`, and named the shared hunks above.
- No F4 dev server, screenshot run or builder task is running. All four builder tasks are finished or
  cancelled, and no preview tabs are open.

## Builder handoffs

B1, B3 and B4 committed their work (prefix `WIP:`), pushed their branches and wrote handoffs on them at
`docs/handoffs/hq-life-20261103/f4-design-core/<branch>.md`. B2 was cancelled; see the note below the table.
The links below are pinned to the pushed heads.
Each worktree is `[retained private path omitted] with / replaced by ->`. No builder branch is
merged anywhere, and no builder opened a PR.

| Builder | Branch and head | State at pause |
| --- | --- | --- |
| F4-B1 Projects gallery and project screen | `work/hq-life-design-core-projects-20261103` at `f3369a4` ([handoff](https://github.com/Jones-Systems/HQ/blob/f3369a4ae8ede1c37598c8310a9feb79c9d719b0/docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-projects-20261103.md)) | One WIP commit, `ffd00b5`. It adds `view-model.ts` and new view modules (`ui.ts`, `chevron.ts`, `controls.ts`, `forms.ts`, `frame.ts`) and rewrites the gallery, detail, section and hooks views. Never type-checked, run or tested: `npm ci` never ran in that worktree. `projects.css`, the `ProjectsView.tsx` wiring, tests and screenshots are not started. |
| F4-B2 Canvas | `work/hq-life-design-core-canvas-20261103` at `78a207f`. No handoff file: the builder was cancelled (see the note below the table). | Six commits, without the `WIP:` prefix; their messages are the builder's record. They cover eased camera moves (`e615b8d`); an icon toolbar that explains unavailable actions (`d7e758b`); capture cards, selection and drop feedback, save status and a source banner (`966c360`); version thumbnails and flow frames from composition renderers that re-read the source (`c9cf0ce`); load caches that survive a development remount (`500fd95`); and polish for frames, artboards and the inspector width (`78a207f`). Canvas node tests passed 50/50 at 14:39Z, before the last two commits. Whether `tsc` and vitest ran after its `npm ci` is unknown. 54 screenshots are in `[retained private path omitted]`: light and dark; 1270, 1440 and 1800 wide; reduced motion; save and source failures with recovery; a new project and a new version. |
| F4-B3 Compare | `work/hq-life-design-core-compare-20261103` at `a1beafd` ([handoff](https://github.com/Jones-Systems/HQ/blob/a1beafddd95e116672ace8b82835e837bbb9203a/docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-compare-20261103.md)) | All seven targets built, including Side by side / Swipe with a slider divider and compact panel headers. Compare `tsc` is clean and Compare vitest passes 97/97. Other cones were not run. 38 screenshots are in `[retained private path omitted]`. 1024×768 and reduced motion were not captured, and touch drag was never tried on a touch device. |
| F4-B4 Requests, Returned and Runs | `work/hq-life-design-core-requests-20261103` at `9b68e15` ([handoff](https://github.com/Jones-Systems/HQ/blob/9b68e1524c8c5723103044610137750c570a13ca/docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-requests-20261103.md)) | Two WIP commits: `45e220d` (source) and `646b93f` (tests). All six targets are written: the example loop, the request list and new-request picker, the stepper with freeze blockers, the Returned tab, Runs cards, and notices and toasts. Never compiled, run or captured: `npm ci` never ran in that worktree. New tests not started. |

**F4-B2 was cancelled without writing a handoff.**

- The first pause message (14:50Z) queued behind the builder's running turn. A steer reached its thread at
  14:59Z, but the builder kept building: it made two more commits and started another screenshot run.
- At 15:04Z, about 14 minutes after the pause, the lead cancelled the task (status: interrupted). Its worktree
  was clean, so nothing was lost. The lead pushed the branch as the builder left it. The cancel stopped its dev
  server (port 5182) and the screenshot run.
- Its thread timeline stopped updating at 14:39Z, so later check results are not recorded there.
- Its last browser-run logs are in `[retained private path omitted]`. They were written after the screenshots
  in `after/`.
  - Light run A passed 13 of 13 steps and light run B passed 2 of 2.
  - Dark run A failed 10 of 13 steps. The toolbar buttons were never found, and a dynamically imported module
    failed to load from the dev server, so the canvas may not have loaded in that run. Not explained yet.
  - Dark run B passed 2 of 2 steps, then ended with a cleanup error when the cancel stopped it.

Notes from the builder handoffs that reach beyond one branch:

- **Lead-owned:** the two `fake-workspace.ts` bugs (priority 1). `.hqd-chrome :focus-visible`
  (`design-ui.css:13`) outranks component focus rules, so custom focus styles need `.hqd-chrome` in the
  selector (B3).
- **Lead decisions requested:**
  - B1 left `ProjectSwitcher` exported from `projects/src/index.ts` but rendered nowhere. Keep or drop it.
  - B1 disables Compare, with a reason, when a project has no versions. Confirm Compare needs a version.
  - B4 made unavailable controls `aria-disabled` so they stay focusable and show their reason. It changed
    the `.disabled` test assertions to match.
- **`@hq/ui` doesn't load under `node --test`** (it imports CSS and `.tsx`). B1 passes F1's primitives into
  the Projects views through a `ui` prop with plain fallbacks. Any cone tested under plain Node needs the
  same seam.
- **For other owners:**
  - F1's `StatusChip` renders a `0` detail as a bare text node; it should test `detail !== undefined` (B4).
  - B4 changed the `closure-views.tsx` import block, which F5's `mountReferences` edits may conflict with.
  - The Compare and Requests READMEs and `docs/ui-map` describe the old layouts.
- **Not built:** a deep link from Runs to the Returned tab. It needs a navigation intent with a tab target,
  which is a shell change (B4).

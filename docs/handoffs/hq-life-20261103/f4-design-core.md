# F4 handoff — Design core views (2026-11-03)

Lane F4 makes the HQ Design module's core views alive and complete: Projects (the project gallery and a
project's Overview/Gallery screen), Canvas, Compare, and the Requests / Returned / Runs handoff. The lead was
Opus 5.5, with four Sonnet 5.5 builders (F4-B1 to F4-B4; not the backend lanes B1 to B3). Work paused at the owner's request on 2026-11-03, relayed by the
HQ coordinator. No PR is open. Nothing was merged, deployed or installed.

## Where it stands

| Part | State |
| --- | --- |
| Flow assessment ([design-flow-assessment-20261103.md](../../design/hq-visual-system/design-flow-assessment-20261103.md)) | **Done.** Findings, journey table, decisions, build plan. |
| Before evidence (8 curated PNGs + conditions README in `docs/design/hq-visual-system/evidence/design-core-20261103/before/`) | **Done.** |
| Foundation: Design-scoped active project | **Done** (`c194b43`). |
| SVG chevrons for secondary panel toggles (cross-app finding X14) | **Done** (`acced90`). |
| Section loading skeleton, in-place Try again, section fade-in | **Done** (`d90f846`). |
| F4 builder B1: Projects gallery + project overview | **Paused mid-build.** See [builder handoffs](#builder-handoffs). |
| F4 builder B2: Canvas | **Paused mid-build.** See [builder handoffs](#builder-handoffs). |
| F4 builder B3: Compare | **Paused mid-build.** See [builder handoffs](#builder-handoffs). |
| F4 builder B4: Requests, Returned and Runs | **Paused mid-build.** See [builder handoffs](#builder-handoffs). |
| Lead review of builder screenshots, fix rounds | **Not started.** |
| Integration of builder branches into the lane branch | **Not started.** |
| After evidence, UI-map entry, full checks, PR against `work/hq-foundation` | **Not started.** |

## Branches, worktrees, SHAs

| What | Branch | Worktree | Head |
| --- | --- | --- | --- |
| Lane (lead) | `work/hq-life-design-core-20261103` | `/home/malcolmjones/.t3/worktrees/HQ/work-hq-life-design-core-20261103` | see the commit adding this file (work before it: `d90f846`) |
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

1. **Collect the four builder handoffs** (below). Review each branch's screenshots in
   `/tmp/f4-evidence/<view>/after/` against its brief and the assessment. Finish the remaining targets with
   new delegated rounds (pass the original brief, the handoff and the review findings), or do them directly.
2. **Settle the `workspace.ts` overlap with backend lane B3** before integrating (see
   [open questions](#open-questions-and-risks)). Agree who rebases, adopt `contentEvents.revision` as the
   re-read trigger once W1 lands, and send F1 the `ActiveProjectStore` shape (X8).
3. **Integrate** the builder branches into `work/hq-life-design-core-20261103`, one at a time: projects,
   canvas, compare, requests. Builders were confined to separate cones, so conflicts should only appear where
   a builder edited lead-owned lines in `ProjectsView.tsx`, `CanvasView.tsx`, `CompareView.tsx` or
   `closure-views.tsx`.
4. **Run checks:** `npm run build:electron`, then `node_modules/.bin/vitest run`, `npm run typecheck`, and
   the design-sections rows for every touched cone (app, app-sections, ui, projects, canvas, compare,
   requests, annotations). The commands are in `.github/workflows/design-sections.yml` `HQD_INVENTORY`.
5. **After evidence:** 1440×900 light and dark, 1280×800, 1024×768, and reduced motion, using
   `/tmp/f4-tools/cdp.mjs` scenarios. Curate into `evidence/design-core-20261103/after/` and update the
   evidence README.
6. **UI map:** add `docs/ui-map/design-core.md` (entry points, states, journeys, evidence state) and an
   index row in `docs/ui-map/README.md`.
7. **Open one non-draft PR** against `work/hq-foundation` with before/after screenshots, then link and watch
   it. Do not merge. Note two things in it:
   - F5's PR edits adjacent hunks: `fake-workspace.ts` `discoveryEnv` (beside F4's `projectsFor`) and
     `closure-views.tsx` imports.
   - #179 replaces the desktop compare catalog and thumbnails; recheck Compare for the active project after
     it lands.
8. **Follow-ups for other owners:**
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
  - The textual merge is mechanical: return both sets of fields. Still open: agree with backend B3 which side
    rebases. F4 has not replied to that point; it paused first.
- **Two project notions (cross-app finding X8).** The shell footer still shows the shell context while
  Design shows the active project. F7 asked F4 to send F1, which owns the shell's project switcher, the
  `ActiveProjectStore` shape: `current()`, `subscribe(listener)`, `set(project | null)`, nothing durable.
  Then the shell can show or adopt it. Not sent yet because of the pause. HQR-1 activation stays owner-held.
- The owner should review the active-project scope, the navigation mapping and swipe-only Compare.
- Builder output has not been reviewed by the lead yet; quality is unknown until it is.
- Merge order with F5 and #179 may produce small conflicts in shared compose files.
- The desktop (bridged) behaviour of the new views has not been exercised. Evidence comes from the browser
  example workspace only.

## Exists only outside the repository

- `/tmp/f4-tools/`: the CDP screenshot harness (`cdp.mjs`) and scenarios (`before.mjs`, `flow-handoff.mjs`,
  `flow-projects.mjs`, `check-foundation.mjs`). Task-owned; not committed.
- `/tmp/f4-evidence/before/`: the full before set (18 view shots and 12 flow shots); 8 are curated in the
  repo. `/tmp/f4-evidence/foundation/`: 3 foundation-check shots. Builder shots live under
  `/tmp/f4-evidence/<view>/after/`.
- `/tmp/f4-fd/`: read-only copies of the Frontend-Development guidance at `71c2c70`.
- Thread-only coordination:
  - F7: X1, X2 and X14 answered.
  - F5: said it is not editing `SectionOutlet.tsx`, and named the shared hunks above.
- The lead's dev server is stopped and no preview tabs are open.

## Builder handoffs

Each builder was told to commit its work (prefix `WIP:`), push, and write a handoff on its own branch at
`docs/handoffs/hq-life-20261103/f4-design-core/<branch>.md`.

| Builder | Branch | Handoff on that branch | Status at pause |
| --- | --- | --- | --- |
| F4-B1 Projects | `work/hq-life-design-core-projects-20261103` | `docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-projects-20261103.md` | awaiting reply |
| F4-B2 Canvas | `work/hq-life-design-core-canvas-20261103` | `docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-canvas-20261103.md` | awaiting reply |
| F4-B3 Compare | `work/hq-life-design-core-compare-20261103` | `docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-compare-20261103.md` | awaiting reply |
| F4-B4 Requests, Returned, Runs | `work/hq-life-design-core-requests-20261103` | `docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-requests-20261103.md` | awaiting reply |

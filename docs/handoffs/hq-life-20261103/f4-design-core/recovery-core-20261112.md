# DSN-C recovery source checkpoint

Authority effect: none. Source completion only; behavior remains unqualified.

## Binding and ancestry

Base DSN-S `c06e5dcc0c7f106cef4406f57f1d9082a5a11bfa`; implementation checkpoint `4edf26a44928ba9b16b00e3b12ffb2750bdfd506` on
`work/hq-recovery-design-core-20261112`. Sole task-worktree Git writer;
all new merges/commits use the explicit public Codex identity. Ordinary merges
retain F4 `64bec3e`, Canvas `78a207f`, Compare `a1beafd`, Requests `9b68e15`
and Projects `f3369a4`. No retained history was rewritten.

Each merge had a full incoming path inventory and merge-tree preflight. The
coordinator approved the actual F4 conflicts: workspace, fake-workspace,
closure-views and AnnotationsView, plus the named core helpers and Requests/Runs
section files. Requests later conflicted only in the approved closure-views file.
Canvas, Compare and Projects had no textual conflicts. All historical evidence
README/PNG additions were excluded, preserving base presence/absence. Imported
lane text is marked historical and its private paths/identifier are omitted.

Read the accepted recovery amendment at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`,
DSN-B/DSN-S receipts, complete F4/builder handoffs and flow assessment.
Frontend canonical main resolved to `b59d310cae8472ae8ed42d4d8562d08c362379d8`;
pinned AGENTS/README/CUSTODY and affected map/layout/unavailable/gallery guides
were read. HQ's shared bridge is absent; supplied immutable routes were used
without installing enrollment. Existing accepted designs were reused.

## Source result

- Active Design project scopes Canvas, Compare, Annotations, Requests and Runs;
  Projects syncs it without changing the shell project. Scope Change navigates.
- Projects gallery/overview, capture cards, inline forms, tabs, injected existing
  shared feedback/motion primitives, source details and folder controls are wired.
  Completed the unfinished stylesheet with accepted token motion, gutters,
  wrapping, narrow information dock and reduced-motion fallback. Interactive
  preview follows project content and retains its existing capability boundary.
- Canvas retains capture/flow renderers, camera easing, icon controls, source
  retry, selection and save feedback. Compare retains compact headers, details,
  Side by side/Swipe, keyboard divider, annotation tools and catalog refresh.
- Requests retains the list, stepper, source-version reasons, Returned tab and
  provenance; Runs retains packet cards and labelled example-only simulation.
  Version lists re-read on the existing content revision without remounting drafts.
- Try again calls `workspace.retry(activeProject.id)` before resetting the local
  boundary. Current durable retry/contentEvents/caches were preserved.
- Annotations selects only from existing `session.choices`, passes the exact
  selection into the existing session port and keys the panel to the version.
  Stored capture and thumbnail fallback remain distinct.
- Corrected the two planned example Compare bugs: example detection comes from
  `contentFor(...).example`, and the labelled sample catalog binds to the actual
  project ID. Created projects use their repository-backed catalog rather than
  an always-empty stub. Fake project edits notify the composition feed; fake
  annotations use the existing session selection/choices contract.

`importsFor`, rights feedback, capability/export/source ports, Taste
`projectVersionSubject` and all DSN-S source views are retained. No generation,
component runner or export enablement; no automatic recorded P2–P4 repair.
No contracts, desktop, UI-kit, storage/export host, root manifest/lock, CI or
acceptance files were authored. No bridged-workspace edit was necessary: the
active store wraps its current return intact in workspace.ts.

## Exact shared hunk requests

INT/test owner must update `modules/design/app/sections/test/views.test.tsx`
(the file was outside this writer cone):

```diff
-  assert.ok(html.includes('1 simulated returns'));
-  assert.ok(html.includes('1 owner-reported returns'));
-  assert.ok(html.includes('0 natively verified returns'));
+  assert.match(html, /hq-status-label">Simulated<\/b><span class="hq-status-detail">1<\/span>/u);
+  assert.match(html, /hq-status-label">Owner-reported<\/b><span class="hq-status-detail">1<\/span>/u);
+  assert.match(html, /hq-status-label">Natively verified<\/b><span class="hq-status-detail">0<\/span>/u);
-  assert.ok(runHtml.includes('hqd-packet-list'));
+  assert.ok(runHtml.includes('hqr-cards'));
```

Keep the distinct provenance, simulation disclaimer and render-cannot-dispatch
assertions. No workflow row is needed. Shell scope adoption and a direct Runs →
Returned-tab intent remain separately owned product/navigation work; no shell
hunk is needed for this source checkpoint. DSN-S's native picker wording hunk
remains its own outstanding request, unchanged here.

## Static checks and unrun gates

`git diff --check` passed. Node 26.12.1 `--check` parsed all 35 changed `.ts`
source/test files without imports or application/test execution; this is syntax
only and differs from CI Node 24.19.0. Literal relative imports in changed TS/TSX
resolve to existing files. TSX was inspected, not compiler-checked; TypeScript
dependencies are absent. Scope/evidence readback found no binary or off-cone
source delta. `git diff --stat <DSN-S> HEAD -- packages/hq-ui apps/desktop/src`
is empty, and all desktop/contracts/root/workflow bytes remain base-identical.

No tests, typecheck, builds, installs, servers, browser/app/native launches,
private data, posting, captures, PR, protected merge or operational activation.
The heavy-slot hold was retained regardless of load or external release.
All tests below are UNRUN. Historical builder evidence is not current-head proof.
Serial Mini verification must run required full discovery, both renderer import
scans, inventory/fan-in, root typecheck/build/tests and assembled-head acceptance.
Layout, responsive gutters/text stress, keyboard, hover/touch, reduced motion,
light/dark/system, native preview/toasts/dialogs, persistence/restart and gallery
completion remain unverified. Gallery completion requires a later admitted actual
presentation export; no source screenshot is substituted.

## Test inventory ownership (all UNRUN)

- `modules/design/app/compose/test/active-project.test.ts` — existing `app` row.
- `modules/design/app/compose/test/canvas-load-cache.test.ts` — existing `app` row.
- `modules/design/app/compose/test/core-recovery.test.tsx` — existing `app` row.
- `modules/design/canvas/test/controller.test.ts` — existing `canvas` row.
- `modules/design/canvas/test/stylesheet.test.ts` — existing `canvas` row.
- `modules/design/canvas/test/view/motion.test.tsx` — existing `canvas` row.
- `modules/design/canvas/test/view/render.test.tsx` — existing `canvas` row.
- `modules/design/canvas/test/view/renderers.test.tsx` — existing `canvas` row.
- `modules/design/canvas/test/view/toolbar.test.tsx` — existing `canvas` row.
- `modules/design/compare/src/panel-catalog.test.ts` — existing `compare` row.
- `modules/design/compare/src/view-dom.test.ts` — existing `compare` row.
- `modules/design/compare/src/view.test.ts` — existing `compare` row.
- `modules/design/compare/src/view/swipe.test.ts` — existing `compare` row.
- `modules/design/projects/test/render.test.ts` — existing `projects` row.
- `modules/design/projects/test/view-model.test.ts` — existing `projects` row.
- `modules/design/requests/test/presentation-model.test.ts` — existing `requests` row.
- `modules/design/requests/test/ui.lifecycle.test.tsx` — existing `requests` row.
- `modules/design/requests/test/ui.render.test.tsx` — existing `requests` row.
- `modules/design/ui/test/vite/section-outlet.test.ts` — existing `ui` row.

Existing rows cover each new file once; no new glob/config/CI is requested.

## Exact changed files relative to DSN-S

- `docs/design/hq-visual-system/design-flow-assessment-20261103.md`
- `docs/handoffs/hq-life-20261103/f4-design-core.md`
- `docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-compare-20261103.md`
- `docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-projects-20261103.md`
- `docs/handoffs/hq-life-20261103/f4-design-core/hq-life-design-core-requests-20261103.md`
- `docs/ui-map/README.md`
- `docs/ui-map/design-core.md`
- `modules/design/app/compose/active-project.ts`
- `modules/design/app/compose/canvas-load-cache.ts`
- `modules/design/app/compose/canvas-renderers.tsx`
- `modules/design/app/compose/chrome-reset.css`
- `modules/design/app/compose/closure-views.tsx`
- `modules/design/app/compose/fake-workspace.ts`
- `modules/design/app/compose/test/active-project.test.ts`
- `modules/design/app/compose/test/canvas-load-cache.test.ts`
- `modules/design/app/compose/test/core-recovery.test.tsx`
- `modules/design/app/compose/views/AnnotationSlot.tsx`
- `modules/design/app/compose/views/AnnotationsView.tsx`
- `modules/design/app/compose/views/CanvasView.tsx`
- `modules/design/app/compose/views/CompareView.tsx`
- `modules/design/app/compose/views/ProjectScope.tsx`
- `modules/design/app/compose/views/ProjectsView.tsx`
- `modules/design/app/compose/views/SectionErrorBoundary.tsx`
- `modules/design/app/compose/views/SectionFrame.tsx`
- `modules/design/app/compose/workspace-context.tsx`
- `modules/design/app/compose/workspace.ts`
- `modules/design/app/sections/requests/NewRequest.tsx`
- `modules/design/app/sections/requests/ReturnChips.tsx`
- `modules/design/app/sections/requests/ReturnedTab.tsx`
- `modules/design/app/sections/requests/View.tsx`
- `modules/design/app/sections/requests/Workbench.tsx`
- `modules/design/app/sections/requests/request-page.css`
- `modules/design/app/sections/runs/View.tsx`
- `modules/design/canvas/README.md`
- `modules/design/canvas/src/controller.ts`
- `modules/design/canvas/src/view/CanvasView.tsx`
- `modules/design/canvas/src/view/CanvasWorkspace.tsx`
- `modules/design/canvas/src/view/Inspector.tsx`
- `modules/design/canvas/src/view/ToolButton.tsx`
- `modules/design/canvas/src/view/Toolbar.tsx`
- `modules/design/canvas/src/view/camera-motion.ts`
- `modules/design/canvas/src/view/canvas.css`
- `modules/design/canvas/src/view/icons.tsx`
- `modules/design/canvas/src/view/index.ts`
- `modules/design/canvas/src/view/useCanvasDocument.ts`
- `modules/design/canvas/test/controller.test.ts`
- `modules/design/canvas/test/stylesheet.test.ts`
- `modules/design/canvas/test/view/motion.test.tsx`
- `modules/design/canvas/test/view/render.test.tsx`
- `modules/design/canvas/test/view/renderers.test.tsx`
- `modules/design/canvas/test/view/toolbar.test.tsx`
- `modules/design/compare/README.md`
- `modules/design/compare/src/controller.ts`
- `modules/design/compare/src/panel-catalog.test.ts`
- `modules/design/compare/src/view-dom.test.ts`
- `modules/design/compare/src/view.test.ts`
- `modules/design/compare/src/view/ComparePanel.tsx`
- `modules/design/compare/src/view/CompareWorkspace.tsx`
- `modules/design/compare/src/view/SwipeStage.tsx`
- `modules/design/compare/src/view/compare.css`
- `modules/design/compare/src/view/index.tsx`
- `modules/design/compare/src/view/parts.tsx`
- `modules/design/compare/src/view/swipe.test.ts`
- `modules/design/compare/src/view/swipe.ts`
- `modules/design/projects/src/projects.css`
- `modules/design/projects/src/view-model.ts`
- `modules/design/projects/src/views/chevron.ts`
- `modules/design/projects/src/views/controls.ts`
- `modules/design/projects/src/views/detail.ts`
- `modules/design/projects/src/views/forms.ts`
- `modules/design/projects/src/views/frame.ts`
- `modules/design/projects/src/views/gallery.ts`
- `modules/design/projects/src/views/hooks.ts`
- `modules/design/projects/src/views/section.ts`
- `modules/design/projects/src/views/ui.ts`
- `modules/design/projects/test/render.test.ts`
- `modules/design/projects/test/view-model.test.ts`
- `modules/design/requests/README.md`
- `modules/design/requests/test/presentation-model.test.ts`
- `modules/design/requests/test/ui.lifecycle.test.tsx`
- `modules/design/requests/test/ui.render.test.tsx`
- `modules/design/requests/ui/DraftEditor.tsx`
- `modules/design/requests/ui/GuardedButton.tsx`
- `modules/design/requests/ui/ManualReturn.tsx`
- `modules/design/requests/ui/PacketHistory.tsx`
- `modules/design/requests/ui/RequestList.tsx`
- `modules/design/requests/ui/RequestStepper.tsx`
- `modules/design/requests/ui/RequestsView.tsx`
- `modules/design/requests/ui/ReturnedRow.tsx`
- `modules/design/requests/ui/ReturnsInbox.tsx`
- `modules/design/requests/ui/ReviewScreen.tsx`
- `modules/design/requests/ui/RunsView.tsx`
- `modules/design/requests/ui/SourceVersionPicker.tsx`
- `modules/design/requests/ui/context.ts`
- `modules/design/requests/ui/hooks.ts`
- `modules/design/requests/ui/model.ts`
- `modules/design/requests/ui/requests.css`
- `modules/design/ui/src/secondary-panels.tsx`
- `modules/design/ui/src/view/SectionOutlet.tsx`
- `modules/design/ui/src/view/design-ui.css`
- `modules/design/ui/test/vite/section-outlet.test.ts`

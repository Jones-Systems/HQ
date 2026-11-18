# Design core flow assessment — 2026-11-03

Lane F4 assessment of the Design module's core views: Projects (the project gallery and a project's overview),
Canvas, Compare, and the Requests, Runs and returned-work handoff. It follows the owner's journey: create or
open a project, capture versions, review them in the gallery and on the canvas, compare versions, then
request a change and review what comes back. Findings come first. The decisions and the build plan follow.

Authority effect: none. This is a design record. Navigation placement, capability holds and the shell keep
their owners.

## How this was evaluated

- **Source:** `work/hq-foundation` at `0cd50ab` with lane F1's shared motion and feedback primitives
  (`284393d`) merged, on branch `work/hq-life-design-core-20261103`. Open PRs that touch these views were read:
  #165 and #179 (saved thumbnails and a project-bound Compare catalog for the desktop store), #181 and #183
  (inert project identity and capture evidence contracts). This lane leaves their files alone.
- **Runtime:** the production renderer (`apps/desktop`, `vite`) on loopback in headless Chromium 156 at
  1440×900, light and dark, with the Design sidebar and inspector open as they are by default. The page has
  no preload bridge, so Design runs its unbridged example workspace, labelled Example and Synthetic.
  Electron, the bridged desktop store, native runners and the connected Runs destination were not exercised.
- **Fonts:** this Linux host has neither IBM Plex nor SF, and its `system-ui` resolves to a monospace face.
  Captures alias `IBM Plex Sans` to Liberation Sans through `local()` (the same alias lane F5 uses).
- **Journeys:** each was walked by pointer and keyboard with scripted Chromium (CDP). Screenshots are
  curated in [`evidence/design-core-20261103/`](evidence/design-core-20261103/).
- **Guidance:** Frontend-Development `main` at `71c2c704930155d0b5b1e9b0646dd5d7914c7659` (UI view maps,
  unavailable actions, website layout and verification, design language, variation-driven design).
- **Reference products:** Figma (canvas camera, fit and zoom-to-selection, version history), Linear (status
  changes that move rather than blink, keyboard-first triage), Arc and Raycast (quiet, fast transitions;
  one command surface), Framer (direct manipulation with spring settle). Patterns only; nothing copied.

## Top findings

1. **Projects is disconnected from the rest of Design.** Opening or creating a project in Projects changes
   nothing in Canvas, Compare, Annotations, Requests or Runs. Those sections read the shell's project
   context, which is fixed at "Local projects" and cannot be switched in production
   (`requestProjectContext: null`). In the example workspace each project also had its own store, so even a
   correct project id would have opened the synthetic seed instead of the project's own views.
2. **The handoff loop cannot be completed in the example workspace.** The composition never tells Requests
   or Runs that they run in the example, so **Choose simulated destination** and **Simulate returned work**
   never render. Freeze stays blocked on a missing destination, nothing is sent (correctly), and no returned
   work can ever arrive to review. Versions added in Projects have no source revision, so they never appear
   as request sources, and nothing says why. After a title edit, the request picker still says "New request".
3. **Feedback is full-screen or far away.** Every section switch replaces the content area with the text
   "Loading Canvas…". A render error replaces the whole section with "Section unavailable". Request errors
   are paragraphs at the top of the page; Projects edit errors are text below the form. Successful actions
   (create project, add view or version, create request, save layout) have no acknowledgement, or a static
   "Layout saved" that never changes. There are no toasts.
4. **Nothing moves.** Section switches, opening a project, gallery filtering (cells jump to new positions),
   thumbnails (they pop in), the canvas camera (zoom, Fit all and Fit selection jump), Compare panels and the
   request steps all change instantly. Status changes in the handoff are a different word in the same place.
5. **The review surfaces show implementation instead of work.**
   - Canvas draws every item as a text card ("Home · Version 1 (fake)", "view-version · hq-local-home-v1",
     "Static capture"); the version thumbnails the project already holds are not drawn, and a flow map shows
     a raw `sha256:` digest. The toolbar is a row of text buttons, and a second "Canvas" inspector repeats
     the chrome inspector.
   - Compare stacks a role badge, title, id, source badge, three provenance bullets, four selects and two
     buttons above each capture, so the captures start about 330px down the panel. Side by side is the only
     mode; there is no swipe. Annotation tools sit on their own bar, starting with "No tool".
   - The project gallery leads with eight controls (project switcher, new project, create, five filters and
     sort) before any project. A project screen has no overview: no counts, no **Open canvas** or **Compare**,
     and the add-view and add-version forms are always open. First launch shows "No projects match these
     filters" before anything has loaded (cross-app finding X1).
6. **Chrome costs.** The chrome inspector (location, appearance and keyboard help) is open by default on every
   section and takes 300px at 1440px, leaving about 730px for the canvas or comparison. Toggle glyphs render
   as empty boxes on hosts whose fonts lack them (cross-app finding X14; fixed here with drawn chevrons).

## Journey walkthrough

| Step | Today | Friction | Build target |
| --- | --- | --- | --- |
| Create or open a project (Projects) | A switcher, inline "New project name" + Create, five filters and sort, then grouped tiles. Create opens the new project. | Controls before content; filters shown when there is nothing to filter; tiles pop in; no confirmation; first-launch "no match" message. | Gallery-first header with one **New project** action, filters that appear only with content, tiles that settle in and reflow with FLIP, a true empty state, a toast on create that names the project, and an open that carries the tile into the project. |
| Capture versions (project screen) | View sections with small version cards; Add view and Add version forms always visible. | No overview or next step; version cards hide the capture; forms compete with content; errors far away. | An **Overview** header (title, "3 views · 5 versions · last capture …", **Open canvas**, **Compare**), a captures-first **Gallery** grouped by view with thumbnails that settle, add forms opened on demand (Presence), inline field errors and a toast with the new version highlighted (`hq-flash`). |
| Review on the canvas (Review › Canvas) | Labelled text cards on an artboard; zoom jumps; text toolbar. | Can't see the work; camera changes disorient; selection gives little feedback. | Thumbnail renderers for project versions, eased camera moves (zoom, fit, zoom to selection) with instant fallback under reduced motion, an icon toolbar with zoom readout, selection outline and drag settle, and the project scope visible. |
| Compare versions (Review › Compare) | Side-by-side panels with dense headers. | Captures pushed down; no fast A/B reading; no swipe. | A compact panel header (role, label, viewport, one **Version** menu; details on demand), a **Side by side / Swipe** mode switch, a swipe divider that reveals the candidate over the baseline with pointer, touch and arrow keys, and panel add/remove transitions. |
| Request a change (Requests) | Request and Source version selects, Create, a four-step strip, returned work above the draft, then the draft form. | Steps don't explain what blocks Freeze; unusable versions are invisible; errors at the top; the example can't finish. | A request list with status chips, a stepper that moves, Freeze blockers next to the control with reasons on hover and focus, toasts for create/freeze, all versions listed with unavailable ones disabled and explained, and simulation controls in the example workspace only. |
| Run and return (Runs) | Pick a request, open a packet, connector panel. | In the example, no way to produce a return; status changes are silent. | Packet timeline with animated status (Frozen → Sent/Simulated → Returned), **Simulate returned work** in the example, toasts and a status indicator while running. |
| Review returned work (Requests › Returned) | Returned work is a panel inside one request. | Hard to find across requests; no count; review state changes silently. | A **Returned** tab in Requests with a count, arriving items that slide in, and review outcomes that move items between groups. |

## Decisions

1. **The project opened in Projects scopes Design.** A composition-owned active project
   ([`active-project.ts`](../../../modules/design/app/compose/active-project.ts)) records the project opened in
   Projects; Canvas, Compare, Annotations, Requests and Runs read it through `useDesignProject(context)` and
   name it in a compact **Project** scope with **Change**. It defaults to the shell context and records
   nothing durable. Alternatives: switching the shell's project (production has no switching and the shell
   belongs to F1), or a picker in each section (fragmented). Reversible: once the shell can switch projects,
   sections read the shell context again and the store is removed. The example workspace now keeps all its
   projects in one in-memory store, so a created project shows its own views everywhere.
2. **Keep the Design navigation.** The mockup's project sidebar (Overview, Canvas, Gallery, Compare;
   Requests, Returned) maps onto existing sections: Overview and Gallery become the project screen in
   Projects, Canvas and Compare stay in Review, and Returned becomes a tab inside Requests. No section ids,
   descriptors or CI inventory rows change. Placement stays provisional for owner review, as lane F5 records.
3. **Swipe is a clip, not a blend.** The visual system forbids filters, blend modes and lasting opacity on
   preserved content, so onion skin and difference views are out. Swipe reveals the candidate with a
   `clip-path` inset over the baseline at the same scale; the divider is a slider (`role="slider"`, arrow keys,
   Home/End). The mode lives in component state; no persisted schema changes.
4. **Feedback follows F1's mapping.** Toasts for one-off outcomes (created, saved, frozen, simulated; failures
   say what was kept), `InlineNotice` for problems with content already on screen, `StatusIndicator` for
   ongoing state (saving, running), `Skeleton` shaped like the content for loading, and section error
   boundaries only for render crashes, with **Try again**. Unavailable actions stay visible with a reason on
   hover and keyboard focus (`aria-describedby`), and every activation path is guarded.
5. **Motion has a job.** F1 tokens only: thumbnails settle (skeleton out, frame in), lists reflow with FLIP,
   panels and forms use `Presence`, the camera eases over `--hq-duration-slow`, steps and statuses move.
   Captures themselves never fade, filter or recolour; transient enter on a wrapper is allowed. Under reduced
   motion every move is instant and colour-only cues (`hq-flash`) remain.
6. **Simulation stays labelled and example-only.** Simulation controls appear only in the unbridged example
   workspace and say Simulation. The desktop store keeps the connected path, which never sends without
   explicit confirmation.
7. **Method deviation.** Frontend-Development's variation-driven design defaults to staged, owner-selected
   variations for substantially changed screens. This lane works inside the accepted HQ visual system and
   the owner's stated principles, with no owner available for rounds during the build, so it records its
   choices here as reversible decisions and uses the pull request as the owner's review point. Choices that
   change navigation or durable data are not made here.

## Recommendations for other owners

- **Design chrome (shared with F5):** open the inspector only on request; move keyboard help into the
  command palette. On ⌘K, cross-app finding X2: one palette long-term, owned by the shell, with Design
  registering its sections and commands. Until that registration exists, Design keeps its palette.
- **Shell (F1):** a real project switch would let the active-project store be removed.

## Build plan

| View | Builder branch | Owned paths |
| --- | --- | --- |
| Projects gallery and project overview | `work/hq-life-design-core-projects-20261103` | `modules/design/projects/src/views/`, `projects.css`, `modules/design/app/compose/views/ProjectsView.tsx` |
| Canvas | `work/hq-life-design-core-canvas-20261103` | `modules/design/canvas/src/view/`, `canvas.css`, `modules/design/app/compose/views/CanvasView.tsx` |
| Compare | `work/hq-life-design-core-compare-20261103` | `modules/design/compare/src/view/`, `compare.css`, `modules/design/app/compose/views/CompareView.tsx`, `AnnotationSlot.tsx` |
| Requests, Returned and Runs | `work/hq-life-design-core-requests-20261103` | `modules/design/requests/ui/`, `modules/design/app/sections/requests/`, `modules/design/app/sections/runs/View.tsx`, the Requests and Runs parts of `modules/design/app/compose/closure-views.tsx` and their rules in `chrome-reset.css` |
| Section loading and failure (lead) | `work/hq-life-design-core-20261103` | Composition foundation, `modules/design/ui/src/view/SectionOutlet.tsx` |

Not touched by this lane: the shell, F5's Sources views (References, Components, Flows, Taste, Imports,
Discovery), `bridged-workspace.ts`, `compare-catalog.ts` and `thumbnail-port.ts` (open PRs #165, #168,
#179), and persisted document schemas. The lead reviews every builder's screenshots, integrates the
branches into `work/hq-life-design-core-20261103`, and opens one PR against `work/hq-foundation`.

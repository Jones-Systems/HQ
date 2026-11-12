# Design Sources flow assessment — 2026-11-03

Lane F5 assessment of the Design module's Sources views: References, Components, Flows, Taste, Imports and
Discovery. It covers the owner's journey: find or import a reference, tag its taste, browse and test components,
map a flow, and discover new inspiration. Findings come first. The decisions and the build plan follow.

Authority effect: none. This is a design record. Product placement and capability holds remain with their owners.

## How this was evaluated

- **Source:** `work/hq-foundation` at `0cd50abc`, branch `work/hq-life-design-sources-20261103`. The open PRs that overlap these views were read: #140, #168 and #179 for Taste, and #170, #171, #174 and #175 for Imports.
- **Runtime:** the production renderer (`apps/desktop`, `vite`), served on loopback in headless Chromium 156 at 1280×820 with the sidebar and inspector open. This is the default window. It leaves the content column 572px wide. The page has no preload bridge, so Design runs its unbridged, labelled example workspace. Electron, the bridged store and native runners were not exercised.
- **Fonts:** the Linux host has neither IBM Plex nor SF. Its `system-ui` and `sans-serif` both resolve to Liberation Mono. Captures alias `IBM Plex Sans` to Liberation Sans through `local()`, so the proportional/mono contrast reads as it would on macOS. The before and after shots use the same alias.
- **Journeys:** each journey was walked by pointer and keyboard. One reference journey imported two generated PNGs.
- **Reference products:** Storybook (canvas, controls, docs), Figma (assets panel, variants), Mobbin (flow strips, screen grid), Are.na (blocks and channels), Pinterest (saving with low friction, masonry), Linear (density, keyboard-first work, quiet motion).

Screenshots: [`evidence/sources-20261103/`](evidence/sources-20261103/).

## Top findings

1. **Three of the six views break at the default window size.** At a 572px content column, Taste's two columns overlap: rating buttons are drawn over the profile text. Discovery's fixed 56px rows overlap each other. Components squeezes its preview to a 24px strip and prints the held-runner text over the props panel. None of these views uses container-responsive layout. They were built in wider harnesses.
2. **The journey has no through-line.** No view hands anything to the next. A reference cannot be sent to Taste, although the Taste contract accepts `reference`, `component` and `flow` subjects. Taste rates one fixed synthetic subject. Discovery's **Link to project…** button does nothing (`onRequestLink={() => undefined}`). Two import surfaces share a name: References → Import screenshots and Requests → Imports. Neither mentions the other.
3. **Nothing moves, and outcomes are easy to miss.** None of the six views uses an entrance, a transition or a progress animation. Success and failure appear as a status line, which is often far from the action, and they persist (References, Imports and Components). Importing and refreshing show only a disabled button. A rating saves without visible acknowledgement near the control.
4. **Components cannot preview anything, and the screen does not say why or what to do next.** Component execution is held: the static and scripted tiers wait for native qualification (`ac.component-static-enablement.001` and `ac.component-scripted-enablement.001`). That hold is correct and stays. The screen, however, renders the hold as overlapping debug text (`HELD · component runner unavailable`). It shows raw ids (`synthetic-button`) and lists the four variants with **Defaults** selected, so none of them is chosen.
5. **Discovery is a host catalog, not inspiration.** It lists source projects from (example) hosts as dense text rows with badges. Every preview tile is blank. The example catalog registers no preview source, and when a preview does load, the view makes a `blob:` object URL, which the shell CSP's `img-src 'self' data:` blocks. Nothing leads from a discovered item toward saving or rating it.

## Journey walkthrough

| Step | Today | Friction | Build target |
| --- | --- | --- | --- |
| Find or import a reference (Resources → References) | Works. One file goes through a form with a required title, capture time, and website or app source. The card appears, and a status line says "Screenshot saved". | One file at a time. No drag and drop. The status line persists and sits far from the new card. Cards are static, with one action. There is no larger view. | Drop zone, a multi-file queue with progress per file, a toast plus a highlight on the new card, hover lift, a lightbox, and **Rate taste** on every card. |
| Tag taste (Review → Taste) | Rates a fixed synthetic subject across 14 aspect rows, each with five buttons. | No path from References, Components, Flows or Discovery. The layout overlaps at 572px. It reads as a form, with no quick triage. | A **Waiting to rate** deck fed by the handoff queue: keyboard and swipe, an inline saved state, then the full aspect form for depth. Fix the layout with container queries. |
| Browse and test components (Resources → Components) | A list of ids, a collapsed held stage, radio variants and a props form. | Overlap. No overview. No selected variant. The held state is unexplained. | See [Components families](#components-families). |
| Map a flow (Resources → Flows) | A pinned-versions debug list, a screen strip, a player with Start, Previous, Next and Back, and an SVG map further down. | Steps swap without continuity. The map is far from the player and static. The evidence banner dominates. | Directional step transitions, a filmstrip with a moving indicator, a map beside the player at wide widths that highlights the current node and draws the traversed edge, and compact version chips. |
| Discover inspiration (Projects → Discovery) | A catalog of source projects with badges and a Refresh button. | Overlapping rows, blank previews and a dead link button. Refresh gives no feedback. | A responsive card grid with working previews (`data:` URLs), skeletons, source filter chips, refresh progress and result toasts, an **Explore** deck (save for Taste or skip), and the dead button removed. |
| Bulk import (Requests → Imports) | Choose files, see a plan, apply it. History has Undo. Bundle export. | The steps are implicit. Apply has no progress. The bottom message persists. The name collides with References' import. | A three-step stepper (Choose, Review, Done) with animated plan rows, apply progress, a toast with **Undo**, a history timeline, export choices as radio cards, and cross-links with References. |

## Cross-cutting decisions

- **Feedback:** uses lane F1's shared primitives from `@hq/ui`, specified in [motion and feedback](motion-and-feedback.md). One-off outcomes go to `useToast()` toasts on the current screen: success, an error that says what was kept, or an unknown outcome with **Check**. Problems with content that has already loaded go to `InlineNotice` or `StatusIndicator` beside it. `StateView` remains only when nothing has loaded. Section error boundaries remain only for render crashes.
- **Motion:** F1's tokens and primitives: `Presence`, `useListMotion` (FLIP), `Skeleton`, `animateElement` and the `hq-enter-*`, `hq-stagger`, `hq-lift`, `hq-press` and `hq-flash` classes. Entrances run 160–240ms and exits 90–160ms. Reduced motion zeroes every duration and distance, and script-driven motion checks `useReducedMotion()`. Preserved content (captures, previews) is never faded, filtered or recoloured; its frame moves instead.
- **Through-line:** a handoff queue that lasts as long as the composition (`tasteQueue`, in [`modules/design/app/compose/sources/`](../../../modules/design/app/compose/sources/README.md)) connects References, Components, Flows and Discovery to Taste. Sections stay independent: a composed view passes `onSendToTaste` into its section, and Taste reads the queue through a context owned by its own section.
- **Responsive:** every view is laid out against its container (container queries or `auto-fill` grids), not the window. The 572px column is the primary target. 900px and wider adds side-by-side layouts.
- **Keyboard and accessibility:** grids use roving focus with the arrow keys. Enter opens and Escape closes. Decks accept the arrow keys and 1–5. Toasts sit in the shared polite live region. Every status pairs a word with its shape or colour.
- **Not changed here:** Design navigation placement (descriptors mark it provisional, pending owner review), the shell, and the Projects, Overview, Canvas, Gallery and Compare views (lane F4). Capability holds also stay as they are: the component runner, live preview, file pickers and the durable store.

## Proposed for the owner

The mockup groups References, Components and Flows under a **Sources** heading. Today they sit across four
navigation groups: Projects (Discovery), Resources (References, Components, Flows), Review (Taste) and Requests
(Imports). A single Sources group in journey order would shorten the path: Discovery, References, Imports,
Taste, Components, Flows. This lane adds cross-links instead and leaves the placement decision open.

## Components families

No committed artifact or branch recorded the four alternatives: neither the repository, its history nor any open
PR names them. This lane defined four layout families from the reference products. Each was drawn at the
572px column with the held stage. Mockup: [`mockups/components-families.html`](mockups/components-families.html).
Render: [`evidence/sources-20261103/components-families/families-light.png`](evidence/sources-20261103/components-families/families-light.png).

The working constraint: component execution, static or scripted, stays disabled until native qualification
(`ac.component-static-enablement.001` and `ac.component-scripted-enablement.001`). No layout may render
component markup in the renderer. Each stage therefore shows the held blueprint: the declared frame and size,
the resolved props, and the tokens the component uses.

| Family | Reference | Browse | Test (variants and props) | Held today | With a qualified runner | 572px |
| --- | --- | --- | --- | --- | --- | --- |
| A · Workbench | Storybook canvas and controls | Good: library list | Best: stage and controls side by side | Clear | Best: one stable stage rect for the overlay, plus backdrop and width presets | Good |
| B · Specimen gallery | Figma assets, Mobbin | Best at scale | Weak: detail is a cramped slide-over | Weak: a grid of empty held boxes | Strong once captures exist | Cramped detail |
| C · Variant matrix | Figma component set, Storybook docs | Weak across components | Best for comparing variants; editing props is a separate step | Most informative: prop-diff chips per variant | Good | Tall |
| D · Spec sheet | Linear list and detail | Dense, fast by keyboard | Weak: read-only tables | Honest, but inert | Weak | Good |

## Components family decision

**Blend A and C, and borrow D's constraint hints.**

- **Frame (A).** The Workbench: library list, stage and controls. It is the only family that serves the testing loop, and it gives a future runner overlay one stable, untransformed stage rectangle.
- **Variants (C).** A variant strip sits above the stage. Each variant is a compact blueprint tile with its prop-diff chips (`tone: danger · radius: 24`). The current variant is always visible and selected. **Base** (declared defaults) is the first tile and is preselected when a session has no variant. This removes "no variant selected" without changing variant semantics.
- **Controls (D).** Each control shows its type and constraint inline (`0–24, step 1`, `≤ 60 chars`), with an overridden dot and Reset. A **Spec** disclosure holds the full props table.

Gallery (B) is deferred until captures or a qualified runner exist. Its cards add little while every preview is
held. The library list switches to an overview grid then.

Motion: the selected-variant highlight glides between tiles. On a variant or prop change, the blueprint content
cross-fades and the changed values flash. Nothing transforms the stage host. The Motion tab plays the study on an
HQ-drawn proxy box, labelled as a proxy. The component itself stays held. The Tokens tab becomes a swatch grid,
and copying a token confirms with a toast.

## Build plan

| View | Builder branch | Owned paths |
| --- | --- | --- |
| References | `work/hq-life-design-sources-references-20261103` | `modules/design/references/ui/`, `modules/design/app/sections/references/`, `modules/design/app/compose/closure-views.tsx` (References wiring only) |
| Imports | `work/hq-life-design-sources-imports-20261103` | `modules/design/imports/src/ImportsPanel.ts`, `imports.css`, `controller.ts` (view state only), `modules/design/app/compose/views/ImportsView.tsx` |
| Taste | `work/hq-life-design-sources-taste-20261103` | `modules/design/taste/src/ui/`, new `modules/design/app/compose/views/TasteSourcesView.tsx`, `modules/design/taste/design-module.ts`. It never edits `TasteView.tsx`, which open PRs #168 and #179 rewrite. |
| Flows | `work/hq-life-design-sources-flows-20261103` | `modules/design/flows/src/views.ts`, new `flows.css`, `presentation.ts`, `modules/design/app/compose/views/FlowsView.tsx` |
| Discovery | `work/hq-life-design-sources-discovery-20261103` | `modules/design/discovery/src/CatalogView.ts`, new `discovery.css`, `view-model.ts`, `modules/design/app/compose/views/DiscoveryView.tsx` |
| Components | `work/hq-life-design-sources-components-20261103` | `modules/design/components/ui/`, `modules/design/app/compose/views/ComponentsView.tsx` |

The lane owner integrates each branch into `work/hq-life-design-sources-20261103` after reviewing its
screenshots. One PR targets `work/hq-foundation`.

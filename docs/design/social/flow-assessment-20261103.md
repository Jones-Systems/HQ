# HQ Social — flow assessment and build direction (2026-11-03)

Artifact Type: design-brief
Artifact ID: brief.hq-social-flow-assessment-20261103
Purpose: Evaluate how well the built Social views support the owner's end-to-end flow, rank what blocks it, and set the design direction that lane F3 builds.
Decision owner: M Jones
Consumers: Lane F3 (Social views) and its builders, lane F1 (shell, motion, feedback), lane B2 (Social backend and transport)
Authority effect: none

## What was evaluated

The flow: **add sources → run a workbench → review results → compose in Library → plan on the calendar → check run history**.

- **Build:** `work/hq-foundation` at `0cd50ab`, in the HQ browser preview (the production `PresentationShell` with the fictional Social example workspace), 1280×800, light and dark.
- **Reference:** the mockups in [`screenshots/`](screenshots/) and the page specs in [`hq-social-design.md`](hq-social-design.md).
- **Code:** read under `modules/social`.

Every page in the flow was walked by clicking: the catalog, a tool with *Load example* and *Run*, a run receipt with *Start draft*, the Library composer, the calendar in Month and Agenda, Run history and Channels.

**Capture-host note.** On this Linux host, fontconfig resolves `sans-serif` and `system-ui` to *Liberation Mono*. HQ declared `"IBM Plex Sans"` but bundles no font files, so every earlier evidence capture was monospace, and that alone produced much of the "wireframe" look. The *before* captures substitute *Liberation Sans*, the face the mockups were rendered with, and say so in their captions. F1 has since changed `--hq-font-family-sans` to a stack of concrete system faces (`284393d`). The modernization spec keeps system fallbacks with no bundled font, so the *after* captures use the host's own fonts.

## Verdict

The Social views are functionally careful: honest copy, conflict-safe saves, *Unknown* for unproven runs, keyboard alternatives and no automatic retries. As a **flow**, though, the product does not hold together:

- the example workspace cannot complete a run;
- one step has no page;
- results, composing and planning live on separate screens that don't hand off to each other;
- every page repeats the same three status notices above its content.

Visually, the views are plain stacks of bordered boxes with no hierarchy, no motion and no shared page frame. The mockups (and the Design area) have all three.

## Findings, ranked

Severity: **High** blocks or breaks the flow. **Medium** costs the user time or trust in a normal session. **Low** is polish.

### High

1. **Runs never finish in the example workspace.** Every run, including *Run fictional example*, stays *Queued* forever ("runs stay queued"). In the preview and in any HQ without a configured service, users cannot experience results, *Start draft* or a receipt. The tool page is a dead end. *Fix:* the example workspace walks **example** runs through queued → running → succeeded on a short visible timer with fictional outputs, labelled *Example data*. Runs on the user's own input stay queued and say why ("no Social service is set up"), with a route to set it up. Live mode is unchanged.
2. **Seeded example results don't render.** The seeded *Succeeded* runs carry outputs that the results reader rejects. *Signal inbox*, for example, shows "Result shape not recognized", so there is no summary and no *Start draft*. *Fix:* seed outputs in the real result shapes. This is fixture-only.
3. **"Add sources" has no page.** *Sources* is a "Proposed" placeholder because the service has no source registry (SOC-6). Inputs are typed or imported separately inside each workbench. The first step of the flow has nowhere to start. *Fix (honest, works today):* Sources becomes an **import desk**. Drop or choose a file and it is validated locally, with line/column errors inline. HQ recognizes which workbenches accept that kind, then *Open in <workbench>* loads it there. Imports are kept for the session and labelled *Not saved: needs the source registry*. When B2 or the service ships a registry, the same page lists saved sources.
4. **Results don't flow into composing.** *Start draft* opens a second, smaller draft editor on the run receipt. The real composer is in Library, so drafting is split across two editors with different capabilities. Nothing on the receipt says where the draft will live. *Fix:* *Start draft* opens the **Library composer** prefilled with the result text and its run citation (still unsaved until Save). The receipt then shows "Draft started · Open in Library".
5. **Status noise above every page.** *Example data*, *Delivered limits* and *Synced · observed …* repeat at the top of every page. They push content down by about 120 px and make the honest notes unreadable through repetition. *Fix:* one service/sync pill in each page header (*Example workspace*, *Synced 2:25 PM*, *Offline · last synced …*, *Refreshing…*). It opens a small panel with the example-data note, the delivered limits and *Check again*, next to the page's primary action. There is no extra Social header bar: the modernization spec rules out a repeated domain or project header.

### Medium

6. **Full-screen error states replace the page.** Load error and *service unreachable* swap the whole page for a `StateView`, even when a last-synced snapshot exists. *Fix:*
   - keep the page and its data;
   - the header pill turns to *Offline*;
   - a toast says what paused ("Saving and runs are paused; your text is kept") with *Check again*;
   - controls that would write show an inline reason.

   A full-area state stays only for "nothing has ever loaded", and it renders inside the page frame with a skeleton.
7. **Workbench layout hides the work.** The catalog is a long card grid, so choosing a tool means scrolling and then losing the list. On the tool page, inputs and results sit side by side at fixed width, with a 32-character run ID, a static status chip and no progress. *Fix:*
   - a master–detail layout: a tool rail grouped by category, then the selected tool;
   - an animated **run stepper** (Queued → Running → Succeeded/Failed);
   - summary tiles, then a results table whose rows stream in;
   - short receipt IDs with copy.
8. **Library composer is a form, not a composer.** The list panel stretches to the editor's height, leaving 60–90 px gaps between filters. Four selects sit above a list of four items. The body is a bare textarea, with no sense of how the post will read on its channel. *Fix:*
   - a compact filter bar: search, *Active/Archived* segmented control, and brand and channel as chips;
   - list rows with channel badge, planned-date chip and unsaved dot;
   - a composer with a **live channel preview** (Typefully-style post card that updates as you type) with an illustrative-limit ring, the checks list, planned date, citations and links;
   - a sticky save bar whose state animates (*Unsaved* → *Saving…* → *Saved v4 · 2:31 PM*).
9. **Calendar has no "now".** The calendar opens on the real month and the example drafts sit in October, so the first view is empty. Chips show the channel name in grey above a truncated title, and the tray has a stray arrow. *Fix:*
   - Notion-Calendar-style chips: a channel colour bar and badge, full title on hover or focus;
   - drag with lift, drop-target highlight and a settle animation, plus an Undo toast;
   - a *Today* button, plus "Next planned: Oct 24 →" when the visible month is empty;
   - a cleaner *No date yet* tray.
10. **Run history reads as a log table.** Timestamps wrap onto two lines. The receipt opens below the table, off-screen. Failed and interrupted rows use red paragraphs. *Fix:*
    - a day-grouped **timeline** with status icons; active runs pulse and failed runs carry an inline reason;
    - a **receipt side panel** (Linear-style peek) that stays beside the list;
    - *Run again with same input* stays explicit.
11. **Overview has no point of view.** The overview has four capability boxes, then four equal cards of nested bordered rows, each repeating "As of Nov 3, 2026, 2:25 PM". "Coming up" is empty whenever the example data is in the past, and "Needs attention" mixes runs and unsaved drafts without priority. *Fix:*
    - a brand header;
    - a compact capability strip;
    - "Next up" (planned drafts, or the nearest past ones labelled *Past*);
    - "Needs attention" sorted by consequence (unsaved > failed > interrupted > stale);
    - "Recent research";
    - "Linked across HQ";
    - one freshness line for the page, plain list rows, and card entrances with a stagger.

### Low

12. **Channels repeats itself.** Six identical cards each repeat four status lines, a disabled *Connect account…* and the same footnote. *Fix:* one capability **matrix** (channels × text checks, account, collection, publishing), one explanation of why connection is unavailable, and the "What publishing would need" checklist.
13. **The sidebar is flat.** It has no icons, counts or brand identity, and *Manage brands* looks like body text. *Fix:* a brand switcher with initials avatar, icons and counts (drafts, runs, failed badge), and a *Later* group de-emphasized.
14. **Shortcuts are thin.** Only ⌘/Ctrl S exists. *Fix:* N (new draft, outside text fields), ⌘/Ctrl Enter (run the current tool), ? (shortcut sheet). Each is listed in the header help.

## Design direction

**Bar:** the Design area and the Social mockups, with interaction quality taken from best-in-class tools:

- **Typefully:** live post preview and quiet autosave state.
- **Buffer:** channel badges and per-channel thinking, plus drag-to-plan.
- **Linear:** dense, crisp rows; peek panels; optimistic feedback with Undo toasts; keyboard-first.
- **Notion Calendar:** drag physics, a today marker and clean chips.

**Frame (all pages).** The page structure is:

- the Social sidebar;
- a page header with an optional parent eyebrow, the title, a one-line purpose, the page actions and the sync pill;
- content at a max width with consistent gutters.

There are no stacked notices. Honest limits move into the sync pill's popover, onto each page's own empty or explanatory surfaces, and into receipts.

**Motion** uses F1's shared tokens (`--hq-duration-*`, `--hq-ease-*`, `--hq-motion-*`) and `@hq/ui` motion helpers (`Presence`, `useListMotion`, `animateElement`, the `hq-enter-*` and `hq-stagger` classes). Durations are 90–360 ms and easing is *standard*, *enter* or *spring*. Reduced motion turns every movement into an instant state change while keeping the colour and state feedback. The purposeful motions:

| Moment | Motion |
| --- | --- |
| Page change | content fades and rises 8 px |
| Lists and cards | enter with a 28 ms stagger |
| Run progress | stepper connector fills; active step pulses; result tiles count up; rows stream in |
| Composer | preview card updates in place; character ring animates; save state cross-fades |
| Calendar | lift shadow on drag, drop target glows, chip settles with spring, Undo toast |
| Run history | new run slides in at the top; active rows pulse; receipt panel slides in |
| Feedback | toasts slide in from the edge; inline indicators fade in place |

**Feedback.** Use toasts for outcomes and paused work (saved, moved with Undo, run finished, service unreachable with *Check again*). Use inline indicators for field errors, blocked actions and per-row state. Full-screen error pages are gone, except a framed first-load failure.

**Honesty rules are unchanged.** Nothing says scheduled, posted, live or connected. Planned dates are editorial. Example data is labelled. Unknown stays *Unknown*. No automatic retries. A run is always an explicit click.

## Build plan

The frame, the shared Social UI primitives and the domain-level states (example workspace, offline, stale, load error, project mismatch) are built first in `modules/social/ui` and `modules/social/nav`, so every view shares them. Views are then rebuilt in parallel, one builder each:

| Lane | Views | Owns |
| --- | --- | --- |
| F3-V1 | Overview, Sources import desk, Channels | `nav/Overview.tsx`, `nav/Sources.tsx`, `nav/Channels.tsx`, their CSS |
| F3-V2 | Workbench catalog, tool page, run stepper, results, *Start draft* hand-off, example-run simulation | `workbench/*` except `RunHistory.tsx`; the example fixture |
| F3-V3 | Library list, filters and composer with live channel preview and save bar | `content/Library.tsx`, `DraftEditor.tsx`, `DraftLinks.tsx`, `BrandManager.tsx`, `content.css` |
| F3-V4 | Calendar (month, agenda, tray, drag, keyboard move) and the Run history timeline with receipt side panel | `content/Calendar.tsx`, `calendar.css`, `calendar-time.ts`, `workbench/RunHistory.tsx` |

Each lane keeps its tests green, adds focused tests for new behaviour, and captures before/after screenshots in light, dark and reduced motion.

## Shared asks (not built by F3)

- **F1 (shell and visual system):** both asks are delivered in `284393d`, which this lane builds on:
  - the font token now resolves to concrete system faces on every host, with no bundled font;
  - motion tokens, `toast` with the shell-mounted viewport, `InlineNotice`, `StatusIndicator`, `Skeleton` and the motion helpers. Social calls them directly; it has no local notice layer.
- **B2 (Social backend):** Social needs these from the service, in order of flow impact:
  1. a source registry (file, kind, as-of, digest, used-by-runs);
  2. run input provenance on the run record (input label, as-of, digest) for receipts and *Run again*;
  3. draft states (Idea / Drafting / Ready) and per-channel variants;
  4. brand profile fields.

  Until each lands, the UI labels it *Proposed* or derives it honestly from what exists.

## Acceptance for this lane

- **Example workspace:** every step of the flow can be completed end to end, with example labels intact.
- **Errors:** no page shows a full-screen error while it has data.
- **Shared frame:** every page uses the shared header and page frame, and none stacks notices above its content.
- **Motion:** each moment in the motion table works, and reduced motion shows no movement.
- **Keyboard:** full keyboard paths are preserved (calendar move dialog, tabs, dialogs, save).
- **Contrast:** AA contrast in light and dark.
- **Checks:** existing Social tests pass (updated only where structure changed, never weakened), and the typecheck is clean.

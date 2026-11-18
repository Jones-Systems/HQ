# Reference graph

Purpose: browse site/page and app/flow/screen hierarchy, immutable captures,
rights and availability; inspect anchors and pin an exact capture to the open
project. Selection and navigation do not launch work.

## Reach, drive and reset

[ReferenceGraphPanel](../../modules/design/references/ui/ReferenceGraphPanel.tsx)
owns local subject/capture selection and observes the graph service.
[ReferenceGraphView](../../modules/design/references/ui/ReferenceGraphView.tsx)
owns presentation. Known entry points:

- The real References section in Design → Resources → References, including
  restored destination, palette and reference-navigation routes described in
  [the library map](references.md). `hideWhenEmpty` suppresses an empty graph,
  except when an access banner needs to be shown. Native/real-store paths are
  **unverified** here.
- The [combined harness](references.md#combined-synthetic-recipe) at
  `http://127.0.0.1:5191/combined.html` supplies the composed production section.
- The same Vite server's `/` page runs the existing graph-only
  [harness](../../modules/design/references/harness/main.tsx). It includes
  missing/unavailable/no-image examples and two Pricing captures, but no library
  or screenshot-import controls. `window.__graphHarness` exposes its fake graph.

Start from a freshly loaded synthetic page. Select the button named
`Page Pricing /pricing 2 captures Image stored`: subject details replace the
instruction and show two captures, newest first. Select a capture to inspect its
anchors; pinning is explicit. `Close subject details` restores the instruction.
Hide/Show Subject details collapses/restores the shared panel independently of
selection. Reload resets in-memory fixtures and selection; panel display
preferences survive reload. Follow the combined recipe's owned-origin and
exact-process cleanup rules, not a shared-state reset.

Other source-known states: standalone empty message, read-only/future-schema
banner with Reload, no-project disabled pin, missing blobs, unavailable sources,
selected capture anchors and already-pinned captures. The rendered/Node tests
cover their named semantics; they are not all browser-verified here.

## Layout contract

The graph section is a full-width grid below the library, separated by its
existing top border, 28px margin and 24px padding. Heading, unselected instruction
and tree share the section's left edge. The instruction is a full-width row
**before** the tree/detail layout, linked to the list by `aria-describedby`.
It disappears with selected details and is absent for an empty graph.

This corrects the reproduced flex competition: at the baseline the growing tree
pushed the unselected instruction to the far right at wide sizes and beneath the
whole tree at 320px. Guidance describes the list; it does not need an invented
detail placeholder box. The section's existing 20px grid gap supplies spacing.
No new card, shared-panel, title, source or footer CSS is introduced.

Tree row button edges advance 16px per hierarchy depth; badge and label content
retain the existing 8px internal inset/gaps. Selected details keep the existing
340px panel body and 6px splitter at wide sizes. At graph container widths up to
1099px, details occupy a full-width row above the tree and the splitter is hidden;
at 1100px they return beside the tree. Widths are container widths, not device
names. [Shared consumers and ownership](README.md#shared-consumers) remain unchanged.

## Candidate evidence

Observed 2026-10-20 in the local Vite 8.3.4 harness, Chromium 154, DPR 2,
working candidate `e539430-issue20-working-a` based on
`e53943092566e902bf24e698fa31e0c0f2fbb912`. The graph source SHA-256 was
`3a122572d066255e68bfd119555520d17b78150ab044e8ba5a3f23db4cd82263`;
combined fixture SHA-256 was
`1ca78080a652b6633ed1324aada27b8ac84d58aeecfa2c54cd49edffe41d2c51`.
The candidate label and loaded module URLs were read back from the owned server.
Source manifest, measurements, test logs and screenshots are retained as private
implementation evidence with the delivery coordinator, not public repository
assets. Subsequent source changes require rechecking these observations.

| Check | Observed result and scope |
| --- | --- |
| Combined unselected graph at 1920, 1280, 800 and 320 CSS-pixel viewports, height 800 | Verified: heading and instruction DOM Range left edges and tree box all x=24px; row edges x=24/40/56px; zero document horizontal overflow. At 320px the instruction stays before the tree. |
| Exact containers 599/600, 759/760 and 1099/1100px (viewports 647/648, 807/808 and 1147/1148) | Verified: same graph anchors, no overflow. Import form changes from one 557px track at 599 to two 271px tracks at 600. Collections move from a full-width row at 759 to a 206px side panel at 760. |
| Selected Pricing, 1280/800/320 viewports and 1099/1100 containers | Verified: two captures; instruction absent; no overflow. At 1099, detail x=24/width=1099 above tree; at 1100, detail x=784/width=340 beside tree. Close restores instruction. |
| Existing card anchors, normal text, 1280 viewport | Verified: all three title tops y=361.81, source tops y=409.81 and footer tops y=536.11. Same-row anchors also aligned at 1920 and 800. At 320 cards stack. |
| Long content and import | Verified: full long title and app provenance reachable in reference details at 320; synthetic PNG import yields four references and success message; reload restores three. |
| Light/dark; 200% text; text spacing | Verified for measured geometry: zero document overflow at 1280 and 320. Font-size doubling produced 24px instruction/48px heading; spacing stress used line-height 1.5, paragraph margin 2em, letter spacing .12em and word spacing .16em. Selected details remained reachable under spacing stress. This is not full accessibility conformance. |
| Keyboard | Verified: subject controls are focusable, Hide Subject details shows a 2px focus outline after keyboard navigation, Enter on close restores instruction. Existing limitation: close removes the focused element and leaves focus on body; focus return is not claimed. |
| Shared consumer | Canvas inspector in the 5197 integration preview collapsed/restored 286→6→286px. Components panels remain untested. No shared panel source changed. |

References Node checks: 153 passed; rendered checks: 12 passed. Section Node
checks: 32 passed; section rendered checks: 4 passed. References and sections
TypeScript checks passed. Integration-preview registry/egress checks: 9 passed,
with their original exclusion of production app imports intact. Node 24.9.0 was
used locally from an official checksum-verified task-owned binary.

Root `npm run build` was attempted but stopped in its typecheck stage on the
pre-existing Social `Catalog.tsx`/`catalog.ts` resolution collision on a
case-insensitive macOS filesystem (`TS2305`, `TS1149`). No Social changes or
system-runtime repair were made; Linux CI is separate evidence.

Remaining limits: 200% text retains existing fixed 20px card-title line height;
complete text is reachable in details, but unqualified title readability is not
claimed. Loading movement/CLS and screen-reader behavior were not measured.
Native Electron, real storage/preload, installed app, authenticated journeys,
all shared consumers and gallery publication remain unverified. This is a
partial product map and a bounded layout repair, not product completion.

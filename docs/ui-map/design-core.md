# Design core recovery (source only)

Entry points: Design → Projects; Review → Canvas, Compare, Annotations; Requests;
Runs. Restored destinations and the command palette use the same section IDs.
Projects opens a composition-scoped active project; Change returns to Projects.
The shell context remains independently owned. Navigation alone never launches work.

## Views and states

- Projects: gallery loading, empty, filtered-empty, cached refresh failure and
  ready; inline create/add forms; overview, version gallery, selection and source
  details. Open canvas and Compare navigate explicitly. Interactive preview stays
  after the project content; native folder operations retain their existing ports.
- Canvas: project version thumbnails, flow frames, selection and save feedback,
  eased camera, icon toolbar, source failure and retry. Camera persistence stays
  limited to the shell project's existing session slot.
- Compare: compact capture headers, details, Side by side and Swipe, keyboard
  divider, panel addition/removal, save feedback and annotation tools. Synthetic
  previews stay labelled. Unavailable actions retain reasons and guards.
- Annotations: version choices come from the existing annotation session. Each
  controller and capture remain pinned to the selected exact version. Static
  capture mode does not acquire Pick/Cite capabilities.
- Requests/Returned/Runs: request rail, source-version picker with unavailable
  reasons, draft/clarify/freeze/review stepper, returned groups and provenance,
  packet cards, and example-only simulation. Connected sends retain confirmation.

## Shared consumers and verification gaps

SectionFrame, ProjectScope and SectionErrorBoundary wrap the core screens;
SectionErrorBoundary also wraps Sources sections and must preserve their mounts.
Try again calls the workspace retry port for the active project before reset.
SecondaryPanel also serves References, its graph and Components; the existing
[References map](references.md) and [chrome map](design-chrome-interactive.md)
remain separate coverage records. Shared UI primitives were consumed unchanged.

All journeys above are **unverified** at the DSN-C recovery head. Historical
builder screenshots and checks do not qualify this source. The serial Mini
verifier must cover creation → version → Canvas → Compare → Requests → Runs →
Returned → review; version switching and content refresh; failed reads/retry;
keyboard and unavailable controls; 1440×900, 1280×800, 1024×768, narrow content,
200% text/spacing, light/dark/system, gutters at both scroll ends and reduced
motion. Native preview bounds/toasts, preload, persistence/restart and dialogs
need native evidence. No presentation export/capture occurred; gallery completion
awaits an admitted real export.

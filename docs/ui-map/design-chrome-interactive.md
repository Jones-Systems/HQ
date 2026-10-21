# Design chrome and Interactive controls

Entry: production renderer, Design → Projects. The existing browser fallback
is explicitly synthetic; no enrolled project or live preview connection is
required or implied. `npm run build`, then `npm run preview` serves port 4173.
Use an isolated browser context; navigation/width preferences stay in that
context. Stop the owned preview when checks finish.

The desktop rail owns primary navigation. DesignChrome owns the secondary
sidebar/inspector and their persisted panel layout. InteractivePanel inside
Projects owns only its compact source/viewport/action groups; the Projects
toolbar keeps its separate layout semantics. Inspect their actual CSS scopes
before changing shared rules.

The 2026-10-21 correction checks the rail through keyboard widths 64, 88, 96,
104, 112, 120, 160 and 280: compact behavior is retained, and expanded rows
have only icon/label tracks. At 112px the Design label fits its full intrinsic
width; narrower text tracks ellipsize only under real pressure. Actual pointer
drag reaches the 120px sidebar floor; rendered event tests additionally cover
continuous samples, release at 100/50, cancellation and collapse/restore.

Interactive checks at 600/760/1024/1280/1440/1536px show wrapping groups and no
horizontal panel overflow. The final narrow source selector retains useful
width instead of being squeezed beside Refresh. At 200% text, the controls
remain reachable through the existing compose scroll region. Live preview,
private sources, annotation actions and native installation remain unverified.
Light/dark and exact candidate hashes are retained in private task evidence.

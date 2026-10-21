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

## Project-to-preview navigation

The interactive selector groups available websites and prototypes by registered
collection, falling back to the enrolled host label. Stills and unavailable
sources appear disabled with a reason. In Projects, opening a source card shows
details with an explicit Open website or Open prototype action when available.
The action preserves the current interactive destination and reveals the native
preview surface. Workspace project records organize saved views; they do not
implicitly identify a source by name.

The last explicitly selected source is remembered by opaque host/source identity.
After catalog refresh, Resume offers that source when available. Startup itself
does not change project context or open a preview. A missing or unavailable saved
source keeps a visible explanation. The same Interactive panel is also reachable
through Flows; both entry points need navigation-preservation checks.

Affected checks cover collection metadata and stable identities, disabled stills,
exact source selection, explicit Resume and desktop mount preservation. Native
card-to-preview, domain return and restart journeys require separate evidence;
browser fixtures cannot verify an Electron WebContentsView.

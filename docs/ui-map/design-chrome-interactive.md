# Design chrome and Interactive controls

Entry: production renderer, Design → Projects. The existing browser fallback
is explicitly synthetic; no enrolled project or live preview connection is
required or implied. `npm run build`, then `npm run preview` serves port 4173.
Use an isolated browser context; navigation/width preferences stay in that
context. Stop the owned preview when checks finish.

The desktop rail owns primary navigation. DesignChrome owns the secondary
sidebar/inspector and their persisted panel layout. InteractivePanel inside
Projects and Flows owns its own scoped styles in
`modules/design/app/compose/views/interactive-workbench.css` (`hqw-*`); the
Projects toolbar keeps its separate layout semantics. Inspect their actual CSS
scopes before changing shared rules.

## Live preview workbench

States: closed (title, source/viewport/Open row, Resume, holds) and open. Open
anchors, top to bottom: header (source, non-fresh chip, Refresh sources, Close
preview); workbench region "Live preview workbench" with the browser bar (Back,
Preview route form, Go, viewport/scale chip, Annotation mode group
Browse/Pick/Cite with `aria-pressed`, Capture), one fixed-height context line
(status, alert or the Pick/Cite instruction and Comment for next mark), the stage
and frame "Host live preview surface", and the network disclosure caption. The
complementary region "Review" holds Capture (thumbnail, Add screen to flow),
Annotations (Save annotations, Check anchors), Proposal (Change proposal, Save
unsent proposal, Open Requests), the captured flow and Source identity. Review
is a 320px side column when the panel is at least 1180px wide, or when the stage
height already limits the page so the column costs it under a tenth of its scale
(short windows, phone viewports; `reviewBeside`). Otherwise it follows the
workbench. A divider separates the open panel from content after it.

Layout contract: the frame is the logical viewport scaled to the stage width and
one scrollport height, never above 100%. The desktop host fits native bounds to
the same box, so no native background appears beside the page. Nothing may
overlap the frame. Mode, messages and review changes must not resize it, because a
size change fences the preview. The native view shows only while the whole frame is
inside the window and its scrollport; otherwise the frame says it is paused and
offers Show preview, which returns focus to the pressed mode button. Changing
mode replaces an older notice with the mode instruction. A Pick or Cite mark that
could not be kept is reported in the context line until the next mark succeeds.
Entry points are Projects → source details → Open, Resume, and the Interactive
panel in Flows; gallery sources open from the source selector.

Evidence: synthetic rendered tests cover labels, the single disclosure, review
placement and route submission. Native acceptance of candidate `e9d98e6` on the
staged packaged app (Electron 44.9.0, 1x display) verified, against a real
loopback gallery website and phone prototype: native bounds equal to the DOM
frame within 1 DIP at panel widths 524, 760, 1006, 1280 and 1600 and two window
heights, with widget surfaces exactly the bounds (no native background); in-site
link navigation keeping bounds and widget size; phone centring; HQ zoom 125%
conversion; scrolling to pause and Show preview restoring; Settings hiding and
restoring one session; 200% text without horizontal overflow; keyboard order and
`aria-pressed`. OS window capture was unavailable, so composite pixels are
inferred from shell captures plus measured bounds and widget images.

That run also found defects, corrected in source after it and `unverified`
natively until rerun: an overlapping-placement race left a resumed phone view
at a stale oversized box, hidden; a 1px context-row growth in Pick/Cite could
fence a height-limited frame; failed marks vanished silently; a finished notice
hid the mode instruction; focus was lost after Show preview; no separation
before Project folders. Coherent capture at a scaled frame is intermittently
`pixels-unstable` on a real image-heavy site (Pick at 92% failed twice; capture
alternated), while unscaled frames passed. This is the recorded clipped-capture
rescale residual and is not fixed. At 200% HQ zoom in a short window the stage
floor cannot fit, so the preview correctly stays paused.

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
These checks predate the live preview workbench layout and are historical for
its open state.

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

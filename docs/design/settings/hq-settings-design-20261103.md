# HQ Settings design (2026-11-03)

Authority effect: none. Lane F6 design decisions for app Settings, made by the lane lead under the owner's
2026-11-03 direction (“design decisions yourself”). Inputs: [flow assessment](../../../modules/wiki/ui/flow-assessment-20261103.md)
findings SF-1 to SF-7, the [HQ visual system](../hq-visual-system/README.md) (Design area is the visual bar) and the
shared motion and feedback primitives from lane F1 ([motion and feedback](../hq-visual-system/motion-and-feedback.md),
merged from `work/hq-life-system-20261103` at `284393d`). Reference products: Linear and Raycast settings, macOS
appearance.

## Goals

1. See the health of every data source at a glance and reach the control that fixes it in one click.
2. One panel per subsystem; no page mixes unrelated forms.
3. Every action answers: busy state on the control, inline result on the row it changed, and a toast for the outcome.
4. Theme choice is visual and switching feels smooth.
5. Keep every existing safety rule: endpoint values never read back, removal needs confirmation, Updates consent
   rules unchanged, no new native capability.

## Information architecture

Settings stays a full-workspace page opened from the rail (same entry points, Escape/Back close, focus returns to
the opener). The category list becomes grouped, with SVG icons (same 18 px stroke style as the rail) and an optional
trailing status shape:

| Group | Category id | Label | Content |
| --- | --- | --- | --- |
| Data sources | `overview` | Overview | One status row per source (Social, Work, Local Wiki, Project sources, Jones requests): icon, name, status chip (shape + word), one-line detail, **Manage** button opening its category. A “Recheck all” action. |
| | `services` | Social & Work | The two service rows: status, Check connection, Change address (disclosure form). |
| | `wiki` | Local Wiki | Setup guide when nothing is configured; one row per repository (display name first, namespace id secondary) with status, Reindex, Change repository…, Remove…; Import source profile…; Recheck. |
| | `projects` | Projects & Jones | Project sources (local folder, gallery enrollment, enrolled rows) and Jones change requests. |
| App | `appearance` | Appearance | Theme tiles, dark palette presets, colour editor in a “Customize colours” disclosure. |
| | `updates` | Updates | Existing Updates view restyled to the shared row/panel system. |

Targets map as today: `social`/`work` → `services` with the row highlighted and scrolled into view, `wiki` → `wiki`,
`appearance` → `appearance`, none → `overview`. The rail's compact Data sources summary opens `overview`. Keep the
section element ids `settings-social`, `settings-work`, `settings-wiki` so existing deep links and tests resolve.

## Layout and components

- **Page header** (48 px, `--hq-surface-raised`, hairline bottom): category title (`--hq-type-title`) and, on the
  right, the existing “← Back to <domain>” ghost button (keep its accessible name).
- **Category sidebar** (216 px, `--hq-nav`): group eyebrows (`--hq-type-eyebrow`, uppercase), 32 px items with icon +
  label, shared selected fill (no stripe), `aria-current="page"`. Arrow Up/Down move between items. Below 600 px the
  sidebar becomes a horizontal scrolling row, as today.
- **Content**: max 720 px, 28 px padding. Each category starts with a heading block (`h2`, one short sentence of
  help). Panels are `settings-group` cards (`--hq-radius-lg`, hairline border, raised surface) containing rows.
- **Row**: left copy (`h3` label 13/600, description 13 muted, optional status chip below), right control cluster
  (buttons `size="sm"`). Rows separate with hairlines. Long forms open *inside* the row as a disclosure with an
  animated height (grid-rows 0fr→1fr) and move focus to the first field.
- **Fields**: label stacked above input (12/500, `--hq-text`), help below (12, muted), inputs full width up to
  480 px, actions under the field group, left-aligned. Never place label and input inline.
- **Status chip**: `StatusChip` from `@hq/ui` (shape + word). Copy maps raw states to words: Ready, Stale, Indexing,
  Not set up, Unavailable, Checking…, Reachable, Unreachable, Sample data, Set up · not checked, Address rejected,
  Not qualified. Never show raw enums (`not-configured`, `generation 3`) as primary text; secondary metadata may.
- **Disabled actions** follow the Frontend-Development unavailable-actions standard: stay visible, explain the reason
  on hover and keyboard focus (`aria-describedby` to a visible short reason, e.g. “Save a Jones connection first.”),
  and keep activation guarded.
- **Icons** replace text glyphs: recheck/reindex use an SVG rotate icon; the icon spins (respecting reduced motion)
  while busy.

## Feedback

All feedback uses the F1 primitives from `@hq/ui`; Settings adds no toast or notice system of its own.

- **Busy**: run each mutation through `useAsyncAction` (double activation ignored). The triggering `Button` uses
  `busy`/`busyLabel` ("Checking", "Saving", "Reindexing", "Removing") and keeps its width; other mutating controls in
  the same row disable with the reason "Another action is in progress."
- **Inline result** on the row that changed: a `StatusIndicator` (shape + word + mono detail) for the row's ongoing
  state, and an `InlineNotice variant="bar"` inside the row for a failure, with Retry only where repeating is safe.
  Wrap the notice in `<Presence show motion="collapse">` so the row grows smoothly. This replaces today's card-bottom
  status paragraph. Changed rows play `hq-flash` once.
- **Toasts** (`useToast()`): one per completed action. Success uses `toast.success` (4 s), failures `toast.error` with
  what was kept and Retry when safe, an unconfirmed outcome `toast.unknown` with Check. Do not toast what the row
  already shows; a toast is the confirmation for people who looked away. Examples: "Social address saved", meta
  "Reload HQ to use it"; "BusinessLessons reindexed"; "Couldn't reach Work", description "The saved address was kept."
- **Indexing**: while any Wiki source is `indexing`, its row shows `StatusIndicator busy label="Indexing"` with
  `hq-shimmer-text`, and Settings polls `wikiAdmin.status` every 2 s (stops when no source is indexing, the page
  closes, or after 2 minutes). When indexing finishes the row flashes and a success toast names the repository.
- **Loading**: first load shows `Skeleton` rows shaped like the rows (`aria-busy` on the panel), never a centred
  spinner.
- Full-panel error states are not used once anything has loaded. An unavailable bridge shows the panel with its rows,
  a single `InlineNotice tone="warning" live="off"` ("Native Wiki management isn't available in this window.") and
  disabled actions with reasons. `StateView` remains only for a first load that failed with nothing to show.

## Appearance

- **Theme tiles**: three 132×84 tiles (Light, Dark, System) drawn with real token colours (a miniature rail + panel;
  System is split diagonally), radio-group semantics with arrow keys, selected ring (`--hq-focus`, 2 px). Label under
  each tile; System shows “Following your device: Dark/Light”.
- **Smooth switch**: changing theme from Settings runs inside `document.startViewTransition` when available and
  motion is allowed (crossfade, `--hq-duration-slow`); otherwise it switches instantly.
- Dark palette presets stay (cards with swatch strip); the long colour editor moves into a “Customize colours”
  disclosure, closed by default, opened automatically if the current preset has edits.

## Motion

F1 tokens only (`--hq-duration-instant/fast/base/slow`, `--hq-ease-standard/enter/exit/spring`,
`--hq-motion-distance-*`), all zeroed under reduced motion or `<html data-hq-motion="reduce">`. Category change: the
content region rises in (`hq-enter-rise`, `slow`) and scroll resets to top; the sidebar selection moves without
delay. Disclosures use `Presence motion="collapse"` (real height) and a chevron rotation (`base`). Row lists that
change (sources added or removed) use `useListMotion`. Status words change in place without layout shift. No motion
may delay input or focus; reduced motion removes transforms and animated height but keeps colour feedback such as
`hq-flash`.

## Accessibility

- Category list is `nav` with buttons and `aria-current`; content region is labelled by the category heading, which
  receives focus on category change.
- Every icon-only control has a text label; status never relies on colour; focus rings stay visible on every control.
- Toasts come from the shell's single `ToastViewport` (polite, failures assertive, F8 reaches them); they never
  steal focus, and every failure toast is mirrored inline on its row so it is not lost when the toast is dismissed.

## Ownership and boundaries

Edits stay in `apps/desktop/src/ServiceSettings.tsx`, `apps/desktop/src/settings/**`,
`apps/desktop/src/appearance/**` and their tests. `PresentationShell.tsx`, `styles.css`, `Connections.tsx` and the rail
belong to the shell lane (F1); recommendations for them are recorded in the PR instead of edited (for example ⌘, to
open Settings and replacing the rail's ↻ glyph). No contract, preload or Electron change.

## Retained design, recovery source checkpoint

The accepted layout and interaction decisions above remain the implementation input. The referenced historical assessment and capture trees are excluded from this assembled source tree. Their presence or historical observations do not qualify the recovered candidate; no redesign, new capture, presentation export or gallery completion occurred in this source-only recovery.

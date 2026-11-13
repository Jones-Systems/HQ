# Shared panels (source-only)

`@hq/ui` exports `Panel`, `PanelHeader`, `PanelRows`, `PanelGrid` and `TileGrid`.
These are opt-in composition primitives. There is no production page adoption
in this change. Known entries are the package exports and the synthetic DOM
fixtures in `packages/hq-ui/test/panel.test.tsx`; no new browser entry is supplied.

## Structure and responsibility

| Primitive | Behavior | Caller owns |
| --- | --- | --- |
| `Panel` | Raised theme surface, 1px border, 10px radius; comfortable 16px or compact 12px padding; forwards its div ref and attributes | Accessible region/name when needed, content, actions and state |
| `PanelHeader` | Title heading (level 2 by default), description, metadata and wrapping actions | Heading level and ID, freshness/provenance wording, limitation disclosures and action semantics |
| `PanelRows` | A list with one wrapper row per nonempty child and hairlines between rows | Row content; use an array of children for separate rows (a Fragment is one child) |
| `PanelGrid` | Auto-fill columns with `minmax(min(100%, 400px), 1fr)` and 16px gaps | Outer page gutters, scrolling and panel selection |
| `TileGrid` | The same shrink-safe rule with a 260px preferred minimum | Tile content and its interaction |

Styles live in `packages/hq-ui/src/panel/panel.css`, loaded by the panel export.
Every selector starts with an opt-in panel/tile class. Grid children have a zero
minimum width; panels and row/header text can wrap. No nested card selectors,
global element rules or token redefinitions are added. A panel does not turn
its content into another card or change the meaning of existing freshness,
status, loading, error or unavailable-action controls. Those remain caller-owned.
`PanelHeader.metadata` accepts existing disclosure/status content without
flattening it into a decorative string.

## Verification map

| Journey | Initial fixture and actions | Expected result | Evidence |
| --- | --- | --- | --- |
| Header, freshness and rows | Render a compact panel with heading, native freshness details, action, long identifier and nested caller card | Heading level/name, details content and action preserved; two list rows; nested card class unchanged | Authored DOM assertions; unverified execution |
| Shrink-safe grid source | Inspect the panel stylesheet and render panel/tile fixtures | Percentage-safe 400px/260px tracks and direct-child minimums; only scoped selectors | Authored source/DOM assertions; unverified execution; no layout engine measurement |
| Actual reflow and focus | Future consumer fixture at 320px, intermediate and wide containers, 200% text, text-spacing stress, light/dark/system | Insets, readable wrap, reachable actions and no accidental nested-card treatment | Unverified; no candidate browser or native capture |

The tests use Foundation's existing `*.test.tsx` DOM discovery. GitHub checks
must execute them on the published candidate. No local test, build or visual
qualification was performed for this source capsule. No skips are introduced.
DOM cleanup belongs to the test's `afterEach(cleanup)`; fixtures have no stores,
accounts, servers or persisted data to reset.

Existing shared consumers inventoried in [the UI map](README.md#shared-consumers)
include Design's SecondaryPanel/Canvas/Components surfaces and the broader UI
kit consumers. None adopts these new panels here. Social Overview/Workbenches,
Work settings/Export and Settings adoption remain separate work; their existing
layout, freshness and capability controls are not qualified by these fixtures.
Gallery/export delivery and native Electron behavior remain unverified.

# HQ UI map (partial)

Start here before changing the mapped Design views. HQ owns the entry points,
fixtures and observations; reusable practice lives in the maintained
[Frontend-Development UI view-map guide](https://github.com/Jones-Systems/Frontend-Development/blob/main/docs/guides/ui-view-maps.md)
and [layout guide](https://github.com/Jones-Systems/Frontend-Development/blob/main/docs/guides/website-layout-and-verification.md).
Those links require access to that private repository; its content is not copied here.

| View | Known entry points | Coverage |
| --- | --- | --- |
| [References library and composed section](references.md) | Design → Resources → References; restored `resources/references` destination; command palette; reference navigation; combined synthetic harness; integration preview library | Source discovery plus explicitly recorded synthetic checks |
| [Reference graph](reference-graph.md) | Nonempty graph inside References; graph-only harness; combined synthetic harness | Source discovery plus explicitly recorded synthetic checks |

The inventory is intentionally partial. Other Design views, Social, Work, Wiki,
settings, dialogs and native desktop journeys are not inventoried. A shared
component's presence is not evidence that all its consumers were checked.

## Common setup and boundaries

Run from the HQ repository root on an isolated task branch. Use the committed
npm workspace install (`npm ci` when absent), a supported Node version (CI uses
Node 24.19), and fresh local capacity admission before checks. Do not run the
References harness and the Design UI harness together: both own port 5191.
No harness is a prerequisite to launching or modifying shared data.

The [References recipe](references.md#combined-synthetic-recipe) starts from
owned in-memory fixtures, with no account, preload bridge or real store. Read
its readiness and reset instructions before capturing. Keep browser captures,
logs and candidate manifests in task-owned evidence storage outside this public
repository. Capture owners retain needed evidence and stop only their own
server/session; never clear a shared browser profile or delete shared storage.

Evidence states are per journey: `unverified` (source discovery only), `verified`
(the named check ran and met its expectation), `blocked` (a named prerequisite
prevented it), or `inconclusive` (an attempt could not establish a result).
Record failures separately. Bind results to source/candidate, URL and state,
viewport/container widths, text settings, browser/harness, date and private
artifact location. A changed candidate makes earlier observations historical.
Native Electron and real-store/preload journeys remain unverified here.

## Shared consumers

[SecondaryPanel](../../modules/design/ui/src/secondary-panels.tsx) supplies
References collections, reference details and graph subject details. Known
other consumers are [CanvasWorkspace](../../modules/design/canvas/src/view/CanvasWorkspace.tsx)
(`canvas-inspector`) and [ComponentsWorkspace](../../modules/design/components/ui/ComponentsWorkspace.tsx)
(`component-catalog`, `component-props`). Buttons, IconButton and StatusChip
come from [the shared UI kit](../../packages/hq-ui/src/index.ts); their wider
consumer inventory is incomplete. This repair changes no shared contracts.

# Shared disclosure navigation (source-only)

The package exports `DisclosureNav`, `CompactNav`, the `NavNode` and
`DomainNavSource` interfaces, bounded pure state helpers, `useDomainNavSource`,
and an explicitly default-off `ModuleNavHostProvider`/`useModuleNavHost` context.
There is no production host registration, module mount, provider lookup,
navigation-store migration or new route grammar. Known entries are the package
exports and injected fixtures in `packages/hq-ui/test/nav.test.tsx` and
`nav-state.test.ts`. No new browser or native entry point is supplied.

## Interface and control map

| Surface | Primitive responsibility | Injecting owner responsibility |
| --- | --- | --- |
| `NavNode` | ID, label, destination or group, decorative icon, tag/count, children/lazy flag and optional loading/error/stale text | Stable IDs, safe display data, real destination grammar and capability meaning |
| `DisclosureNav` | Named nav with nested lists; destination buttons separate from chevron disclosure buttons; group-only disclosure button | `projectId`, nodes, current destination, `onNavigate`; no work is started by the primitive |
| Current item | Exact destination match by default; explicit `currentId` overrides; null means no current item; current control gets `aria-current=page`, ancestors get visible “Contains current page” text | Effective route/preference resolution through an injected source, when needed; no prefix or route parsing is invented |
| Expansion | Local session-only state by default; optional controlled `expansion` and `onExpansionChange`; ancestors expand once when effective location changes, later manual collapse persists | Controlled owners must accept reconciliation callbacks as well as manual changes; supply `locationKey` when effective location changes behind a bare route |
| Project switch | Expansion resets across project identity; invalid/removed expansion IDs are discarded | Opaque project ID of at most 128 characters; location key of at most 1,024 characters; longer state keys are rejected |
| Source metadata | `useDomainNavSource(source, projectId)` subscribes only to the supplied source/project; null is idle; changed binding exposes no old-project rows; late notifications are ignored; cleanup unsubscribes | A synchronous metadata-only `getSnapshot`, atomic `subscribe` returning a reliable unsubscribe, project-bound loading/cancellation and error custody |
| Source current/lazy methods | Interfaces expose `currentId(projectId, destination)` and optional `activate(projectId, nodeId)`; neither is called implicitly | Call current resolution with appropriate error handling; wire deliberate `onExpand` to lazy loading only when authorized. Current-item background loading is also an external owner decision |
| Source states | Hook reports idle/loading/ready/error; read/subscription errors clear the snapshot. Nav supports loading/error/stale messaging, and per-node status descriptions | Choose honest stale/loading/error wording. Retaining stale data is an explicit source policy, never a claim that it is current |
| Host context | Defaults false, including an omitted `enabled`; returns only the explicit opt-in value | A future shell may enable external module-nav ownership; existing harnesses keep their old navigation until adoption |
| Compact mode | Controlled `open`, owned labelled trigger, inline 232px flyout bounded by the viewport, scrim, contained focus, Escape/close and trigger restoration | `onOpenChange`, `onNavigate` and `onWorkspaceFocus`; mount outside clipping/transform ancestors and make background content inert as appropriate for the host's modal composition |

The source hook does not own a provider or execute `activate`. A subscription
must not attach then throw before returning its cleanup. Returning an unsubscribe
is the source contract; thrown or incomplete cleanup cannot be repaired by the
primitive. Snapshot nodes should be immutable between notifications; replace the
array when directly supplying changed props. Pass `limited={snapshot.model.limited}`
with the hook's sanitized nodes to preserve its completeness warning. No app persistence is written.

Destination activation in the compact list calls injected navigation, requests
close, restores the trigger when the controlled host closes/unmounts the flyout,
then requests workspace focus. The workspace callback can move focus from the
restored trigger. Escape, scrim and Close navigation restore the trigger without
requesting workspace focus. A host that declines a controlled close also delays
that workspace request. The primitive adds no Portal or global shortcut handler.

## Keyboard and data bounds

Natural Tab visits destination and disclosure buttons separately. Up/Down move
between visible actionable rows; Home/End move to the first/last row. Right
expands a closed group or focuses its first child when open. Left collapses an
open group or focuses its parent. Enter/Space retain native button behavior.
Modified chords are left to the host. A collapse or snapshot removal that hides
the focused descendant recovers focus to the nearest surviving ancestor, then
the first available row, or the nav container when none survives. Focus already
moved outside the nav is not reclaimed by this recovery.

`buildNavModel` examines at most 512 nodes and eight levels. IDs are unique,
1–128 characters matching `[A-Za-z0-9][A-Za-z0-9._:-]*`; labels have at most 256
characters and destinations at most 512. Invalid/duplicate entries are omitted;
depth/size overflow is limited and reported. Cycles terminate through duplicate
and depth checks. Tags/status text and counts are bounded; expansion IDs are
deduplicated, bounded and restricted to surviving branches. A limited snapshot
shows “Some navigation entries are unavailable” rather than implying a complete
catalog. ReactNode icons are trusted caller-owned decorative content.

## Verification map

| Test file | Injected journey / regression protected | Evidence |
| --- | --- | --- |
| `nav-state.test.ts` | Exact/effective current matching; once-per-location expansion and manual collapse; project isolation; removed IDs; focus ancestor selection; malformed, duplicate, cyclic, deep and wide inputs | Authored pure Node assertions; execution unverified |
| `nav.test.tsx` | Independent toggle/navigation; list and aria relations; natural Tab, Enter/Space and row arrows; controlled collapse/removal focus; source refresh after manual collapse; lazy and error/loading/stale disclosure | Authored DOM assertions; execution unverified |
| `nav.test.tsx` | Compact Escape/scrim/selection, Tab containment, nested access, trigger restoration, workspace callback and unmount cleanup | Authored DOM assertions; execution unverified |
| `nav.test.tsx` | Fake-source project/replacement unsubscribe, ignored late notification, read/subscription error, no activation and default-off context | Authored DOM assertions; execution unverified |
| Future composed consumer | Narrow/232px flyout, long labels, 200% text/text-spacing stress, light/dark/system, forced colors, screen reader, focus and native shell integration | Unverified; no candidate browser or native evidence |

Foundation's existing Node/DOM globs discover these tests. Fixtures use no real
provider, service, project store or persisted state. DOM fixtures clean up after
each test; source fixtures dispose subscriptions on unmount. No local tests or
builds ran for this source capsule and no test skips were added. GitHub execution
must qualify the exact published head. Existing Design, Social, Work, Wiki and
desktop navigation consumers remain untouched and unverified against these new
primitives. Gallery/export delivery and native behavior are unverified.

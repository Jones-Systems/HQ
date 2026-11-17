# Design sub-routes, section payload and hosted chrome

Lane D of the selected-UI work. It adds routing metadata, one owner for a
section's saved view, a navigation source for a shell, and a hosted mode for the
Design chrome. It mounts nothing in the production shell and changes no
contract package. Entry points are the Design chrome
(`modules/design/ui/src/view/DesignChrome.tsx`), the synthetic harness and the
tests listed below. No real store, project or service is involved.

## Routes

`parseDestination(destination, subRoutes?)` and `formatDestination(location)`
in [navigation.ts](../../modules/design/ui/src/navigation.ts). A location is
`{ nav, section, sub? }`. Two-segment routes parse as before and carry no `sub`.

| Area / section | Destination | Fixed views |
| --- | --- | --- |
| Review / Compare | `review/compare/<view>` | `strip`, `before-after`, `swipe`, `matrix` |
| Resources / Flows | `resources/flows/<view>` | `player`, `storyboards`, `outline`, `board` |
| Resources / Components | `resources/components/<view>` | `tokens`, `motion` |
| Resources / Components | `resources/components/item/<encodeURIComponent(id)>` | one library entry |

A section declares its views in its own `design-module.ts` (`subRoutes`: `fixed`,
`navChildren`, optional `itemPrefix: 'item'`), so the registry, not a central
list, decides what is valid. The `item/` prefix keeps a component named
`tokens` (`item/tokens`) distinct from the fixed Tokens view. Only the canonical
encoding is accepted, so every parsed destination formats back to the same
string. An invalid third segment, malformed encoding or a destination over 512
characters leaves the same section with `sub: null`; an invalid section with
extra segments still falls back to Projects. `parseDestination` without a lookup
never keeps a third segment, so older callers see no new route.

Which view is shown (`resolveDesignRoute`, in
[nav-source.ts](../../modules/design/ui/src/nav-source.ts)): an explicit valid
view in the route, else the view remembered for this project and section, else
the section's first fixed view (none for an item section). `subExplicit` is true
only when the route named the view, so a section may say an explicit item is
missing but falls back silently for a remembered one. Resolving only reads: a
bare, restored, Back or reference destination is shown with the effective view
and never rewritten. Only a user choice is remembered and navigated: the section's
`navigateSub`, a shell nav child, or a palette view command.

## Section payload

[section-payload.ts](../../modules/design/ui/src/section-payload.ts) is the one
owner of a section's slot in the chrome session. A section with sub-routes keeps
`{ v: 1, view, data }` there; the session schema, key and bounds are unchanged.
Legacy section state is read as `data` and wrapped, never discarded, the first
time a view is remembered. Writes are read-modify-write. A payload with `v` above
1 is read-only: the section still reads its data, writes are refused, and a chosen
view is kept in memory for the session (at most 256 views). A section without
sub-routes keeps its raw slot untouched. The handle a section receives reaches
`data` only; a stored `null` data value reads back as `undefined`. Held and
unavailable storage behave as before, with the choice kept in memory.

## Navigation source

`createDesignNavSource({ registry, sessions })` returns a `DomainNavSource`
(`@hq/ui`); `createDesignDomain` returns it as `navSource`, and the composition
exports `designNavSource`. It is registered nowhere.

- `getSnapshot(projectId)`: one immutable tree. Areas (`area:<nav>`, destination
  the bare area), their sections (`section:<id>`) and, where `navChildren` is true,
  the fixed views (`view:<section>:<view>`). No Library level is invented, Flows
  has no children, Components has Tokens and Motion only.
- `currentId(projectId, destination)`: applies the precedence above. A fixed-view
  destination selects its leaf; an item view selects its section; a bare area
  follows the remembered section and view.
- `subscribe(projectId, listener)`: notifies only when that project's remembered
  section or view changed, holds one session subscription only while something
  listens, and returns an idempotent cleanup. At most 32 projects and 16 listeners
  per project, project ids of 1-128 characters; a refused subscription throws before
  attaching anything. A throwing listener cannot starve the others.
- No `activate`: nothing loads lazily, no section code runs and nothing is read
  from a store.

## Hosted mode

`DesignDomainView` reads `useModuleNavHost()` (default off). Off, the chrome is
unchanged. On:

- the area buttons, section sidebar, its splitter and its toggle are not rendered
  and are not tab stops; the bar becomes a page head with the crumb
  (`Group / Section / View`), Commands and the inspector toggle;
- F6 cycles the workspace and the inspector (`HOSTED_REGIONS`);
- Mod+\ is not handled or prevented, so the shell receives it;
- Mod+K opens Design's palette only when the key starts inside `[data-hqd-chrome]`;
  body focus, the shell's navigation and other domains reach the shell's palette;
- Alt+1..5 navigate, then focus the workspace;
- the stored sidebar preference is never rewritten: only inspector changes are
  merged into the stored layout;
- the inspector hint for Mod+\ reads "Expand or compact navigation".

## Control and test map

| Control or behaviour | Where | Test |
| --- | --- | --- |
| Route grammar, canonical item encoding, limits | `navigation.ts` | `ui/test/node/route-payload.test.ts`, `theme-panels.test.ts` |
| Descriptor `subRoutes` validation and copy | `registry.ts` | `ui/test/node/registry.test.ts` |
| Precedence, crumb, palette view commands | `nav-source.ts`, `palette.ts` | `route-payload.test.ts`, `keyboard.test.ts` |
| Payload envelope, legacy wrap, future payload, held storage | `section-payload.ts`, `session.ts` | `route-payload.test.ts`, `session.test.ts` |
| Navigation nodes, `currentId`, `subscribe`, limits | `nav-source.ts` | `ui/test/node/nav-source.test.ts` |
| Hosted tab stops, F6, Mod+\, Mod+K ownership, hints | `focus.ts` | `keyboard.test.ts` |
| Hosted render, no remount on view change, no rewrite, sidebar preference | `DesignChrome.tsx`, `SectionOutlet.tsx` | `ui/test/vite/render.test.ts`, `section-outlet.test.ts` |

The Node tests run without a DOM. The Vite tests use fixture sections that report the
props they receive; they prove routing and chrome behaviour, not any real section's
layout. CI runs both through the existing Design sections and inventory jobs.

## Not implemented here

- Shell registration and adoption: nothing mounts the navigation source or turns the
  host context on in production (lane S).
- Alternate layouts for Compare, Flows and Components (lanes F, C and L). The fixed
  views are routing metadata only: those sections receive `sub` and `navigateSub`
  but do not consume them yet, so choosing a view changes the route, the crumb and
  the remembered choice but not the section's layout.
- Dynamic Components catalog children (per-entry nodes) and any lazy `activate`.
- The other 18 unselected comparisons.

## Known limits

- `currentId` reads the project's session (a synchronous storage read for that
  project on first use) and builds no other state.
- A view kept only in memory because its stored payload is newer than this build
  changes without a session notification, so a shell highlighting a bare
  destination may lag until the next route change.
- Legacy section state shaped exactly like `{ v: 1, view, data }` is read as an
  envelope. No current section stores state with sub-routes, so this is latent.
- The crumb names the effective view, including a default the section does not yet
  consume.

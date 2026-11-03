# HQ F5 handoff: Design Sources, Flows view ("map a flow")

Status: paused by the owner. The brief's seven build items are implemented, committed and pushed. Nothing is in progress. What remains is verification, review and two items owned by someone else (see "What's left").

## Where it stands against the brief

| Brief item | State |
|---|---|
| 1. Header: title, platform chip, counts, saved-flow switcher, pinned-version chips, evidence note | Done |
| 2. Filmstrip: connectors, token-timed indicator, `aria-current="step"`, arrows / Home / End | Done |
| 3. Player: directional slide and crossfade, hotspot toggle, labelled outlines, broken target as inline notice | Done |
| 4. Map beside player at 900px+, collapsible below, current ring, traversed edge draw, Links disclosure | Done |
| 5. History and capture details as restyled disclosures | Done |
| 6. Bridged empty state as a guided three-step card | Done |
| 7. "Rate this flow" handoff to Taste | Done |
| Node tests for pure logic, existing tests kept passing | Done (36 new tests) |
| Evidence screenshots | Mostly done, with gaps (see below) |
| `npm run typecheck` green | **Not green**, for a reason outside my paths (see Findings) |
| Independent code review, PR | Not started (the brief said no PR) |

## Branch and location

- Branch: `work/hq-life-design-sources-flows-20261103`, from `work/hq-life-design-sources-20261103` @ `f5d6bc8`.
- Worktree: `~/.t3/worktrees/HQ/work-hq-life-design-sources-flows-20261103`.
- Commits on the branch: `583d0a0` (the view), `a64b74d` (WIP evidence screenshots), then this handoff on top. The pushed head SHA is reported in the final message of the thread, because a file cannot name its own commit.
- No PR opened, nothing merged, nothing deployed.

## Files changed (owned paths only)

- `modules/design/flows/src/views.ts`: rewritten. Still JSX-free erasable TypeScript.
- `modules/design/flows/src/presentation.ts`: pure playback and pin logic added. Existing exports kept, because `InteractivePanel.tsx` imports `screenName` and `stateLabel`.
- `modules/design/flows/src/flows.css`: new. Imported from `FlowsView.tsx` only.
- `modules/design/app/compose/views/FlowsView.tsx`: rewritten.
- `modules/design/flows/test/playback.test.ts` (26 tests) and `modules/design/flows/test/workspace.test.ts` (10 tests): new.
- Deliberately untouched: `map.ts` (canvas intrinsic sizes depend on its geometry), `InteractivePanel.tsx`, `index.ts`, `packages/hq-ui`, shell, other views.

## Decisions and why

- **Injected `FlowsUi` port instead of importing `@hq/ui`.** Section `views.ts` is rendered under `node --test` type stripping, which cannot load `.tsx`. `FlowsView.tsx` supplies `{ motion: { reduced, animate }, notice }` (`animateElement`, `useReducedMotion`, `InlineNotice`). Defaults are no motion and a plain `<p role="alert|status">`, so section tests and the dev harness still render. This is also what keeps sections from importing the app.
- **Filmstrip connectors are arrows only where a recorded link joins neighbours; otherwise a dot** ("saved order only, no link"). An arrow everywhere would imply links that do not exist.
- **Back is always a "back" slide; other moves compare positions in saved screen order.** Derived purely from the player's step log (`lastMove`, `moveDirection`, `traversedEdge`), so the animation never disagrees with what the player did.
- **Only the wrapper (`.hqd-flows__slide`) is animated.** The captured frame keeps `data-hq-content="captured"` and is never faded, filtered or recoloured. Thumbnails do not carry that marker, since it produced a grey matte behind the artwork.
- **Hotspot colours are theme-independent** because they overlay captures, which keep their own colours.
- **Map is closed by default below 900px** (open by default pushed the capture below the fold at 572px). At 900px+ it is forced open beside the player and its summary is hidden.
- **`MAP_MIN_SCALE = 0.62`** with horizontal scroll and scroll-to-current, rather than editing `map.ts` geometry. The wide rail is `minmax(320px, 40%)` and the stage height budget is `100dvh - 470px`, tuned so the frame fits a 1680x1000 window.
- **Pinned versions:** non-exact bindings are always shown (half-dot shape plus a word); exact ones fill the remaining room (limit 4) and the rest fold into "+n exact". Full ids stay in the tooltip and the "Versions" disclosure.
- **Toolbar is `role="group"`, not `role="toolbar"`**, because arrow keys switch screens rather than moving within the toolbar. Position text moved to its own `aria-live` caption row so "Show hotspots" does not wrap alone at 572px.
- **Rate this flow** is wired in `FlowsView` through `sendToTaste`. The section receives only `onRate` / `rated` props.

## Findings

1. **`npm run typecheck` fails at the first stage, outside my paths.** Root `tsc --noEmit` reports two errors, both at `modules/design/flows/src/player.ts:88`: `findLastIndex` is not in the root config's `lib: ["ES2022", ...]`. The flows config uses ES2023, so `tsc -p modules/design/flows/tsconfig.json` passes. I did not change `player.ts` or the root `tsconfig.json`. The same call and the same root lib exist on `origin/work/hq-life-system-20261103` and `origin/review/hq-design-flows-fixes`, and the root graph reaches `player.ts` through `apps/desktop/src/modules.tsx` and the design composition. I did **not** run a baseline typecheck on `f5d6bc8`; "predates my work" rests on that reasoning. Fix options: set the root `lib` to ES2023, or replace the call in `player.ts`. Because the `&&` chain stops at the first failure, I ran the later stages by hand (all pass; see Checks).
2. **The flows dev harness renders unstyled.** `modules/design/preview/sections/flows/View.tsx` and `flows/harness` render `FlowsWorkspace` without importing `flows.css`. These are not my paths. They need a `flows.css` import from their owner, or an explicit decision that they stay unstyled.
3. **F1 gaps:** there is no CSS-only Presence exit or collapse for unmounting elements (I used the enter-only data attributes). Section `.ts` cannot import `@hq/ui`, hence the port.
4. **Process slip to be aware of:** my last `npm run typecheck` ran when a fresh CPU sample read 92.09% (limit 85%). The sample and the command were in the same call, so I did not gate on it. It was a typecheck, not a test run, and it completed normally. Nothing further ran until CPU read 38%.

## What's left, in priority order

1. **Make the root typecheck pass** (owner of `player.ts` / root `tsconfig.json`). Then re-run `npm run typecheck` end to end. This is the only check on the brief's list that is not green.
2. **Decide the dev-harness styling** (Finding 2): add the `flows.css` import there, or record it as intentionally unstyled.
3. **Verify in a real app build with real stored captures.** All visual checks ran in a browser against the dev server and a purpose-built harness with synthetic data. Not exercised: real captured PNGs through the bridged path (the bridged harness cases show "No image"), the live "Open live" navigation, and the "other source" entries in the switcher beyond one harness case. Do this in a Jones Code / Electron build, not by restarting the installed one.
4. **Capture the missing states:** wide 1680x1000 dark, the example flow at 572px (only bridged and tall harness cases were captured at 572px), the hotspot keyboard `:focus-visible` outline, a mid width around 1000px, and the traversed-edge state under reduced motion (only the step transition was captured under reduced motion).
5. **Engine support check.** The disclosure height animation uses `::details-content` and `interpolate-size`, plus `light-dark()` and container queries. Expected to degrade to an instant open/close where unsupported, but I did not verify the Electron version these ship in.
6. **Independent code review** of `views.ts`, `presentation.ts`, `flows.css` and `FlowsView.tsx` before any PR. Not run.
7. Optional polish: more render tests for the map node states and the Links table (currently covered by screenshots only).

## Open questions and risks

- Who owns the fix for the root typecheck, and is ES2023 for the root config acceptable? It affects every module the root graph compiles.
- Connector dots instead of arrows for unlinked neighbours is a truthfulness choice that changes the look of flows with no links. The lead may prefer a different treatment.
- `flows.css` uses a mask-image data-URI for icons. It is CSP-safe (data: only, no blob:, no inline `<style>`, no SSR `style` attributes) but I did not run the CSP tests beyond the compose suite.
- Risk of layout drift if `map.ts` geometry changes, since `MAP_MIN_SCALE` and the rail width were tuned to the current node sizes.

## Checks run and results

CPU 47.6% at the first sample. One serial test process at a time.

| Command | Result |
|---|---|
| `node_modules/.bin/tsc -p modules/design/flows/tsconfig.json` | exit 0 |
| `cd modules/design/flows && node --test test/*.test.ts` | 84 pass, 0 fail (74 earlier + 10 in `workspace.test.ts`; the 26 `playback.test.ts` tests are in the 74) |
| `node_modules/.bin/tsc -p modules/design/app/tsconfig.json` | exit 0 |
| `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts` | 197 pass, 0 fail |
| `npm run typecheck` | **fails** at root `tsc --noEmit`: 2 errors, both `player.ts:88` (Finding 1) |
| `tsc -p apps/desktop/tsconfig.electron.json --noEmit`, `...design-host.json --noEmit`, `...wiki-host.json --noEmit` | each exit 0 |
| `npm run typecheck --workspace @hq/wiki` | exit 0 |

After the pause message, no further checks, tests or builds were run.

## Exists only outside the repo (uncommitted, in /tmp or in the thread)

- Full screenshot set (about 45 PNGs: default / dark / wide, steps, hotspots, keyboard, map, notice, reduced-motion, rich / captured / empty / switcher / toast / versions harness cases) and logs: `/tmp/hq-f5-evidence/flows/` (`shots/`, `vite.log`, `harness-vite.log`, `npm-ci.log`). Six of them are committed under `docs/design/hq-visual-system/evidence/sources-20261103/wip/flows/`: `default-top`, `dark-top`, `wide-top`, `hotspots-3-hover`, `map-4-edge-drawn`, `toast-rated`.
- My capture tooling: `/tmp/hq-f5-evidence/flows/tools/flows-shots.mjs` (scenarios `view`, `tall`, `steps`, `hotspots`, `keyboard`, `notice`, `map`; `REDUCED=1` for reduced motion), `harness-shots.mjs` (cases `rich`, `captured`, `bridged-empty`, `bridged-switcher`; steps `map,next,hot,broken,end,rate,versions`) and the out-of-repo vite harness `tools/harness/{vite.config.mjs,index.html,main.tsx}`. They resolve `playwright-core` and a system Chromium from a sibling checkout, so they are not portable as is.
- The brief files `/tmp/hq-f5-briefs/flows.md` (sha256 `a941532f55454467f049ea0fe9d5c9c6f1c8eff912567402dd23c7438905b8e7`) and `common.md` (sha256 `f150b6398d9848ebd6156ec176c4dc9335c118d2d548d7f9df8b3be343067aba`), and the lead's `/tmp/hq-f5-tools/capture.mjs`.
- To restart the dev servers (not running now; I stopped both): `npm exec vite -- --config apps/desktop/vite.config.ts --port 5285 --strictPort` from the worktree, and `npm exec vite -- --config /tmp/hq-f5-evidence/flows/tools/harness/vite.config.mjs` for the harness (port 5286, set in that config). Use only these ports.
- Nothing else is uncommitted: the worktree was clean before the WIP commits.

# Handoff: HQ lane F5, Discovery view (Design → Projects → Discovery)

Status: **the brief's six steps are built, checked and pushed.** Nothing is half-done. Owner review, a PR and some follow-ups remain (see "What's left"). Work was paused by the owner after the final report; this note lets anyone resume without the original thread.

## Where it stands

| Brief step | State |
| --- | --- |
| 1. Previews as base64 `data:` URLs (png/jpeg/webp only), abort-on-unmount, window-limited; example workspace serves real generated PNGs through a labelled fake source | Done |
| 2. Responsive auto-fill card grid, virtualised by rows × columns; 16:10 preview, skeleton, hover lift/press, first-load stagger, roving tabindex, Enter opens details | Done |
| 3. Source chips (status shape + word) filter by host with `aria-pressed`, result count, animated reorder | Done |
| 4. Refresh: busy button + indicator, result toast, failure → error toast + bar notice on the source, cached catalog stays readable; host-identity conflict stays a prominent `role="alert"` with the existing wording | Done |
| 5. Explore mode (Grid \| Explore): large card with the next peeking, swipe/keyboard skip and save for Taste, "N of M" progress, end-of-deck summary, reduced-motion instant swap | Done |
| 6. Dead "Link to project…" removed (shown only when a handler is supplied); details drawer with path, repo, revision, host, freshness | Done |
| Tests: existing discovery tests untouched and green; new node tests for the data URL builder, grid windowing and source filtering | Done (38 new tests, more than asked) |

In progress: none. Not started: none from the brief.

## Where the work is

- Branch: `work/hq-life-design-sources-discovery-20261103`, created from `origin/work/hq-life-design-sources-20261103` at `f5d6bc8dfbd058905ed65ccaf5a2ff8f794cd415` (verified as an ancestor).
- Worktree: `~/.t3/worktrees/HQ/work-hq-life-design-sources-discovery-20261103`
- Code head: `cc0b202de76b95ff84dfc5de4b366bc7f857284c` ("Build the Discovery view: card grid, source filter, refresh feedback and Explore deck"). Two docs-only WIP commits sit on top: `cafe5cd` (evidence screenshots) and the commit that adds this file. The pushed tip is whatever `git log -1` shows on the branch; this file cannot contain its own commit id.
- No PR opened, nothing merged.

Files changed (all under `modules/design/`):

- `discovery/src/CatalogView.ts`: rewritten view (about 860 lines, JSX-free).
- `discovery/src/view-model.ts`: additive view model, data URL builder, grid keyboard helper, refresh summary, deck state.
- `discovery/src/previews.ts`: `gridMetrics` and `planGridWindow` appended; `planPreviewWindow` and the loader are untouched.
- `discovery/src/discovery.css`: new, `.discovery-*` classes on `--hq-*` tokens only (all 52 tokens used were checked as defined in `@hq/ui`).
- `app/compose/views/DiscoveryView.tsx`: builds the F1 kit, imports the CSS, wires Save for Taste.
- `app/compose/fake-workspace.ts`: only `discoveryEnv()` and its imports.
- Tests in `discovery/test/`: `data-url`, `grid`, `source-filter`, `explore-refresh`, `view-render`.

## Decisions and why

- **F1 primitives are injected, not imported.** Node's built-in test runner renders `CatalogView.ts` with type stripping, so it has to be JSX-free, erasable TypeScript, and must not import `@hq/ui` or a `.css` file. `DiscoveryView.tsx` builds a `DiscoveryKit` (Button, StatusIndicator, InlineNotice, Skeleton, Presence, useToast, useListMotion, useReducedMotion, animateElement) from `@hq/ui` and passes it in. `PLAIN_KIT` is the inert fallback used by Node renders. If F1's component props change, the kit types in `CatalogView.ts` and the wiring in `DiscoveryView.tsx` must follow.
- **`data:` URLs, never `blob:`.** The shell CSP allows `img-src 'self' data:` only. Bytes become a URL only if the media type is on the allowlist and the file signature matches (PNG, JPEG, RIFF/WEBP), so text or SVG labelled as an image is refused. The base64 encoder is a small pure function, tested against `Buffer` for every length 0–40.
- **Windowing is by rows.** `planGridWindow` converts a row window to card indices via `planPreviewWindow(total, firstRow*cols, visibleRows*cols, prefetchRows*cols)`. Columns are measured from the container with a `ResizeObserver` and set explicitly; an unmeasured container (server render) is one column, which keeps the pre-existing view tests valid unchanged. Decoded URLs sit in a 64-entry LRU.
- **Preview bytes keep their own colours.** Previews sit in a `data-hq-content="producer"` well and are never faded or filtered; only the card frame animates.
- **Refresh feedback is layered.** A minimum busy time of 450 ms so a fast refresh is still seen; one toast per refresh (`success`, `info` or `danger` from `summarizeRefresh`); a bar notice per source for errors (`live="off"`, with Retry); a host identity conflict remains an assertive `role="alert"`. A source with no adapter is a dismissible calm hold, not an error.
- **Details drawer is a non-modal dialog.** It docks at 340 px when the container is 900 px or wider (`@container`), otherwise overlays with a scrim. Escape closes; focus goes to Close and returns to the card.
- **Explore keys cards by id in a fixed DOM order** so promoting the next card is a CSS transition, not a DOM move. Fly-off uses the F1 `animateElement`; under reduced motion the swap is instant and there is no rotation. Key presses during a fly-off are ignored by design.
- **Header text is truthful.** `cacheLabel` was "Showing cached catalog" even after every source had refreshed. It now reads "Catalog is up to date" once all sources are fresh (unit-tested). This is an addition beyond the brief.
- **Source chip layout:** the "Fake source" badge sits in the chip's head row so every chip stays two rows whatever the freshness text says.

## Findings

- **Preview harness is stale (not mine to edit).** `modules/design/preview/sections/discovery/View.tsx` renders `DiscoveryCatalog` without the CSS or a kit and still passes a dead `onRequestLink={() => undefined}`. It still works but will not show the new look, and it shows a dead button.
- **Stale comment.** The doc comment on `DiscoveryEnv.service` in `fake-workspace.ts` still says no adapter is registered. It is outside the edit scope for this lane, so it was left.
- **`FakeSourceAdapter` answers "offline" for any host with no scripted behaviour.** Tests that want one host to succeed must script it (the `view-render` error test does).
- **Vite's file watcher missed a `CatalogView.ts` edit once** and kept serving the old module until the dev server was restarted. If a screenshot does not match the source, restart the server before debugging.
- **Narrow windows are cramped.** At 1024×768 the three panes and the stacked header leave about one card row of grid. Hiding the inspector (Ctrl+Shift+\\) helps. Not changed.
- One 404 appears in the browser console during every walk. I did not trace it; it appears to be a static resource unrelated to this view.

## What's left (priority order)

1. **Owner review of the look and feel** against "alive, well designed, functioning". Start with the screenshots below. Judgement calls most worth a second look: the heavy keyboard focus ring on the Explore deck, the chip density, and the example data names and colours.
2. **Open the PR** when work resumes: base `work/hq-life-design-sources-20261103`, from this branch. Move the evidence out of `wip/` to its final folder and delete or update this handoff as part of that.
3. **Run the broader repo checks before merge.** `npm test` (build + vitest) and `npm run build` were not run in this lane.
4. **Exercise a real source.** Only the labelled fake source was seen in a browser. Open the real bridged/native discovery path and confirm previews load (media types, size caps), the count and filter behave with a large catalog, and that the item shape sent to Taste (`kind: 'other'`, `from: 'discovery'`, optional `imageUrl`) is accepted by the Taste side.
5. **Fix the preview harness** (`preview/sections/discovery/View.tsx`): load the CSS and kit, drop `onRequestLink`. Owner of that file should do it.
6. **Refresh the stale `DiscoveryEnv.service` comment** in `fake-workspace.ts`.
7. **Consider a byte budget for the preview cache.** The LRU counts entries (64), not bytes, and the local adapter admits previews up to 5 MiB, so a real source of large images could hold a lot of base64 in memory. Fine for the example data; revisit for real catalogs.
8. **Optional polish:** narrow-window layout; softer deck focus ring; automated browser checks for pointer swipe and focus return (today those are verified only by a manual Playwright walk).

## Open questions and risks

- **The fake source in `discoveryEnv()` must stay example-only and labelled.** `discoveryEnv()` now registers a `FakeSourceAdapter` (`adapters: { fake: source }`), serves generated PNG previews, delays responses 160–1100 ms, finds one new Laptop project on the first refresh, and makes the Studio source fail with "Fake source is offline" from the second refresh on, to show the error states. It is labelled in three places: the `fake: true` "Fake source" badge, the "(synthetic)" host labels, and the provenance string "synthetic fixture cache (labelled fake source, refresh-on-open off)". The project names are fictional and use the `git.example.test` domain. `refreshOnOpen` stays `false`, so opening the page reads only the cache. Risks: someone copies this adapter wiring into the real desktop path; or removes the labels. Suggested guard (not done): a test in `modules/design/app/compose/test/` asserting that `discoveryEnv()` enrolls only fake-labelled sources.
- **Behaviour change in the example workspace.** It used to register no adapter, so Refresh produced the "Refresh isn't available yet" hold. Refresh now really runs against the fake source. The no-adapter hold is still implemented and unit-tested, but it is no longer visible in the example.
- **Dependence on F1.** The kit adapter assumes the current F1 component and hook APIs.
- **Provenance rule.** Nothing here may present fake data as real; keep the Synthetic tag and the Fake source badge together.

## Checks run (all on code head `cc0b202`, serial, CPU sampled first and below 85% each time)

| Command | Result |
| --- | --- |
| `node_modules/.bin/tsc -p modules/design/discovery/tsconfig.json` | exit 0 |
| `node --test --test-concurrency=1 'modules/design/discovery/test/*.test.ts' 'modules/design/discovery/test/adapters/*.test.ts'` | 108 tests, 108 pass, 0 fail (70 existing, 38 new) |
| `node_modules/.bin/tsc -p modules/design/app/tsconfig.json` | exit 0 |
| `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts` | 197 tests, 197 pass, 0 fail |
| `npm run typecheck` | exit 0 |
| CSS token check (every `--hq-*` used exists in `packages/hq-ui/src` CSS) | 52 of 52 defined |

Not run: `npm test` (vitest), `npm run build`, anything in Electron, anything against a real source.

Browser verification (manual, headless Chromium with a Playwright walk): skeleton → real previews; hover quick-save and lift; roving focus (only the active card tabbable); details open/close with focus return; source filter and empty filter; Explore swipe, save, skip, end-of-deck summary; refresh busy, success toast, then failure toast with Retry plus bar notice; light, dark, 1280, 1680, 1024, and reduced motion.

## Evidence in the repo

Folder: `docs/design/hq-visual-system/evidence/sources-20261103/wip/discovery/`

- [Default 1280×820, light](../../../design/hq-visual-system/evidence/sources-20261103/wip/discovery/02-loaded-light-1280.png)
- [Default 1280×820, dark](../../../design/hq-visual-system/evidence/sources-20261103/wip/discovery/02-loaded-dark-1280.png)
- [Wide 1680×1000, light](../../../design/hq-visual-system/evidence/sources-20261103/wip/discovery/02-loaded-light-1680.png)
- [Refresh failure: error toast and bar notice, 1280 light](../../../design/hq-visual-system/evidence/sources-20261103/wip/discovery/16-refresh-error-light-1280.png)
- [Explore deck, 1280 light](../../../design/hq-visual-system/evidence/sources-20261103/wip/discovery/09-explore-light-1280.png)
- [Explore swipe under reduced motion, 1280 light](../../../design/hq-visual-system/evidence/sources-20261103/wip/discovery/10-explore-swipe-light-1280-reduced.png)

## Exists only in /tmp or in the lane thread

- `/tmp/hq-f5-evidence/discovery/shots/`: the full set of about 70 screenshots (hover, keyboard focus, details, filter, filter-empty, Explore swipe/save/skip/end, refresh busy/done/error; light and dark at 1280, light at 1680 and 1024, light 1280 reduced motion). Names are `NN-name-<theme>-<width>[-reduced].png`. Only six are in the repo.
- `/tmp/hq-f5-evidence/discovery/tools/states.mjs`: the Playwright walk that produced them (usage: base URL, output dir, width, height, `light|dark`, optional comma-separated scenarios `loading,loaded,hover,keys,explore,deck-end,refresh`; set `REDUCED=1` for reduced motion). It uses `playwright-core` from another checkout's `node_modules` and the system Chromium, so it is not a repo dependency. It exists only in `/tmp`.
- `/tmp/hq-f5-evidence/discovery/vite.log` and `npm-ci.log`: dev server and install logs.
- `/tmp/hq-f5-briefs/discovery.md` (sha256 `768713c00f2a7599150d002ab817b47ba82dfdea14d409add46a73a57d18df31`) and `/tmp/hq-f5-briefs/common.md` (sha256 `f150b6398d9848ebd6156ec176c4dc9335c118d2d548d7f9df8b3be343067aba`): the brief this work followed.
- To see the view live: run `node_modules/.bin/vite --config apps/desktop/vite.config.ts --port <free port> --strictPort` in the worktree and open Design → Projects → Discovery. My server on port 5386 has been stopped; port 5286 belonged to another builder and was never touched.
- Only in the thread: the step-by-step reasoning behind the visual tweaks (chip density, badge placement, deck centering and focus-ring padding). The decisions are summarised above.

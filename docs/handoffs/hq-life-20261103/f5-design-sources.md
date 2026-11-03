# Lane F5 handoff: Design Sources views — 2026-11-03

Lane F5 makes the Design module's Sources views (References, Imports, Taste, Flows, Discovery and Components)
alive, flowing and fully functional. The owner paused the lane on 2026-11-03, before review, integration or a PR.

Authority effect: none. This is a handoff record. It grants nothing and changes no hold.

## Status

- **Done:** the Sources flow assessment, the Components family decision and the shared Taste handoff seam, built on lane F1's primitives. All are pushed on the lane branch.
- **Built, not yet reviewed:** all six views. Each builder reports its brief implemented on its own pushed sub-branch, with six screenshots and a handoff. The one exception is Flows, whose root `npm run typecheck` fails (see [Builder results](#builder-results)). The lead has reviewed none of them yet.
- **Not started:** review and fix rounds, integration into the lane branch, after screenshots, the full check run and the PR to `work/hq-foundation`.

## Branches, worktrees and SHAs

Each worktree is `~/.t3/worktrees/HQ/<branch>`, with the branch's `/` replaced by `-`. The lane branch holds this
file; its head is the commit that adds or last updates it. The builder heads are their pushed heads after the
pause. "Code head" is the last code commit; the WIP commits after it add only screenshots and the handoff.
Copies of the builder handoffs sit beside this file, in [`f5-design-sources/`](f5-design-sources/).

| Branch | Pushed head | Code head | Builds on | Builder's own checks | Handoff |
| --- | --- | --- | --- | --- | --- |
| `work/hq-life-design-sources-20261103` (lane) | this commit | `4104a6b` | `work/hq-foundation` `0cd50ab`, merged with F1 `284393d` | handoff seam 2/2, app `tsc` pass | this file |
| `work/hq-life-design-sources-references-20261103` | `1f4d5b0` | `4cd4259` | lane `f5d6bc8` | all listed checks pass, `npm run typecheck` pass | [References](f5-design-sources/hq-life-design-sources-references-20261103.md) |
| `work/hq-life-design-sources-imports-20261103` | `ea2824a` | `373a185` | lane `f5d6bc8` | all listed checks pass, `npm run typecheck` pass | [Imports](f5-design-sources/hq-life-design-sources-imports-20261103.md) |
| `work/hq-life-design-sources-taste-20261103` | `8d3db74` | `6346fd9` | lane `f5d6bc8` | all listed checks pass, `npm run typecheck` pass; merges cleanly with #168 and #179 | [Taste](f5-design-sources/hq-life-design-sources-taste-20261103.md) |
| `work/hq-life-design-sources-flows-20261103` | `c47bb5a` | `583d0a0` | lane `f5d6bc8` | section checks pass; **`npm run typecheck` fails** | [Flows](f5-design-sources/hq-life-design-sources-flows-20261103.md) |
| `work/hq-life-design-sources-discovery-20261103` | `cc0b202` | `cc0b202` | lane `f5d6bc8` | all listed checks pass, `npm run typecheck` pass | pending (see [Builder results](#builder-results)) |
| `work/hq-life-design-sources-components-20261103` | `6b4bc02` | `1d2d473` | lane `4104a6b` | all listed checks pass, `npm run typecheck` pass | [Components](f5-design-sources/hq-life-design-sources-components-20261103.md) |

No builder ran the root `npm test` (the Electron build and vitest). Every check and screenshot so far is the
builder's own evidence.

PRs: F5 has opened none. Related work:

- Lane F1 `work/hq-life-system-20261103` at `284393d`: shared motion tokens, toasts and inline feedback. It is merged into the lane branch. The API is in [motion and feedback](../../design/hq-visual-system/motion-and-feedback.md).
- Lane F4 `work/hq-life-design-core-20261103`, last seen at `d90f846`: Projects, Overview, Canvas, Gallery, Compare and handoffs. It is not merged here.
- Lane F7's draft PR #185, the cross-app flow assessment. F7 offered to review the F5 PR.
- Taste: #140, #168 and #179. Imports: #170, #171, #174 and #175. F5 rewrites none of them.
- Backend lane B3 (`work/hq-backend-design-*`) had no branches or PRs at the pause.

## Decisions and why

1. **Components family: blend A (Workbench) and C (Variant matrix), and borrow D's constraint hints.** Only the Workbench serves the browse-and-test loop, and it gives a future runner overlay one stable, untransformed stage. The variant matrix's prop-diff chips are the most informative content while every preview is held. Inline constraints make the controls explain themselves. **Base** (the declared defaults) is the first variant tile and is preselected, so a variant is always selected. Gallery (B) waits until captures or a qualified runner exist. See the [assessment](../../design/hq-visual-system/sources-flow-assessment-20261103.md#components-family-decision) and the [families mockup](../../design/hq-visual-system/mockups/components-families.html).
2. **The four families were defined by F5.** No committed artifact, branch or PR named the four alternatives the brief mentions, so F5 drew four from the reference products and rendered each at the 572px column.
3. **The component execution hold stays.** The stage shows an HQ-drawn held blueprint built from metadata only. The Motion tab plays the study on a labelled proxy box. No component markup, styles or scripts render in the renderer, and nothing transforms the stage host.
4. **Feedback and motion come only from F1's `@hq/ui` primitives.** F5's earlier toast store, host and CSS were removed when F1 published.
5. **The through-line is an app-level handoff queue.** `tasteQueue` in [`modules/design/app/compose/sources/`](../../../modules/design/app/compose/sources/README.md) connects References, Components, Flows and Discovery to Taste. It lives only in memory for the composition. Sections stay independent: each composed view passes `onSendToTaste` down. Confirmation is one updating toast with **Open Taste**, so repeated sends do not stack toasts.
6. **Taste is wrapped, not rewritten.** A new `TasteSourcesView.tsx` wraps `TasteView`. `TasteView.tsx` is left alone because open PRs #168 and #179 rewrite it.
7. **Discovery previews use `data:` URLs**, because the shell CSP blocks `blob:`. The unbridged example workspace gets a labelled fake source adapter with generated previews and simulated refresh delays. A second Studio refresh fails on purpose, to show the error handling.
8. **Navigation placement is unchanged.** A single Sources group is proposed for the owner in the assessment, not implemented.
9. **Not opted into F4's `useDesignProject`.** It would make this PR depend on F4's unmerged branch.

## Findings so far

Full list and the journey walkthrough: [Sources flow assessment](../../design/hq-visual-system/sources-flow-assessment-20261103.md).

1. Taste, Discovery and Components break at the default window's 572px content column.
2. No view hands anything to the next. Taste rates one fixed synthetic subject, Discovery's **Link to project…** does nothing, and two import surfaces share one name.
3. Nothing moves. Outcomes appear as status lines that persist, often far from the action.
4. The correct component hold renders as overlapping debug text, and no variant is selected.
5. Discovery previews are blank, and nothing leads from a discovered project to saving or rating it.

## Builder results

What each builder reported, plus the lead's notes. None of it has been reviewed yet.

- **References.** It reports every brief item done: a multi-file import queue, a drop overlay, a card grid with roving focus, a lightbox, collections chips, **Rate taste**, and a cross-link to Imports.
  - **Needs sign-off:** one existing assertion in `preview-lifecycle.render.test.tsx` changed, from one scroll to no scroll, because details now open in a lightbox.
  - **Stale doc:** `docs/ui-map/references.md`, which is outside the lane's paths.
  - **F1 gap:** `Dialog` is not safe to render on the server, and `container-type` traps fixed-position dialogs.
- **Imports.** It reports Choose, Review and Done steps with apply progress, a toast with **Undo**, a history timeline, export choices as radio cards, and a cross-link to References.
  - The panel takes F1's primitives through an injected "kit" prop, because a section's `.ts` view cannot import `@hq/ui` under `node --test`.
  - **Outcomes:** a write that fails in an unexpected way reports an unknown outcome with **Check**, and never "nothing changed".
- **Taste.** It reports a container layout, segmented 1–5 rows and a **Waiting to rate** deck fed by `tasteQueue` through the new `TasteSourcesView.tsx`. `TasteView.tsx` is untouched.
  - **Merges:** with #168 at `13cbbd1` and #179 at `c83294b`, both clean.
  - **Semantic overlap with #168:** #168 hides the form when a reload fails, which hides the new inline notice too. Decide which behaviour to keep after #168 lands.
  - **Gaps:** there is no capture at 572px. The deck's single-key shortcuts need an accessibility review.
- **Flows.** It reports a filmstrip, directional step transitions, a map beside the player at 900px and wider with the traversed edge drawn, version chips and **Rate this flow**.
  - **Root `npm run typecheck` fails:** `findLastIndex` at `modules/design/flows/src/player.ts:88` is not in the root config's ES2022 lib.
  - **Lead's reading:** this branch probably caused it. `presentation.ts` now imports types from `player.ts`, which brings that file into the root program, and the other five builders started from the same base and pass. This is not verified. Fix it inside F5's paths, by dropping that import or replacing the call. Changing the shared root `lib` is not this lane's call.
  - **Unstyled harness:** the preview harness does not import `flows.css`.
- **Discovery.** Its handoff is pending. From its final report:
  - **Previews:** `data:` URLs for PNG, JPEG and WebP, accepted only when the bytes match the file signature.
  - **Grid:** virtualised, with roving focus.
  - **Filters and refresh:** source filter chips; refresh with busy state, a result toast, and on failure a Retry toast plus a notice on the affected source.
  - **Explore deck:** skip, or save for Taste.
  - **Other:** **Link to project…** shows only when a handler exists. A details drawer was added. The header now says when the catalog is up to date.
  - **Left alone:** the doc comment on `DiscoveryEnv.service` in `fake-workspace.ts` is stale, and the preview harness still passes a dead `onRequestLink`.
- **Components.** It reports the A+C blend built: a variant strip whose **Base** tile is preselected and whose highlight glides, a held blueprint stage with backdrop and width presets, controls with constraint hints, a token swatch grid, and a Motion proxy.
  - **The hold is enforced by structure:** tests use a source guarded by a `Proxy`, which fails on any read of markup, styles or script, and assert that no element in the stage host chain carries a transform.
  - **Shell finding for F1:** a button rule in `apps/desktop/src/styles.css`, lines 13–17, gives every button `min-height: 30px` and padding, which distorts small controls.
- **Across builders:**
  - Imports, Flows and Discovery each inject `@hq/ui` primitives through a local kit, with a plain fallback for node tests. A Node-safe entry point in `@hq/ui` would remove the duplication; that is for F1.
  - The dev server logs a `/favicon.ico` 404 in every capture.

## What's left, in priority order

1. **Read the builder handoffs** (linked below) and [Builder results](#builder-results). Fix the Flows root typecheck before integrating.
2. **Review each builder branch.** Look at its screenshots at 572px and 1280px, in light, dark and reduced motion. Check the diff for: owned paths only; no `style` attributes and no `blob:` images (CSP); no fading or filtering of preserved content; the Components hold intact, with no transform on the stage host; `TasteView.tsx` untouched; and each new test file claimed by exactly one row of `.github/workflows/design-sections.yml`. Check that Discovery's fake adapter stays example-only and labelled. Send fix rounds as new `delegate_task` rounds: the view's brief from [`f5-design-sources/briefs/`](f5-design-sources/briefs/) plus the findings, a new `clientRequestId`, and Sonnet 5.5 at `xhigh`.
3. **Integrate into the lane branch.** Merge each reviewed sub-branch with `--no-ff`. Owned paths do not overlap, so conflicts between builders are not expected. Then confirm Taste still merges cleanly with #168: `git merge-tree --write-tree HEAD origin/work/hq-taste-production-mount-20261026-r1`.
4. **After screenshots.** Start the renderer with `npx vite --config apps/desktop/vite.config.ts --port 5281 --strictPort`, then run the capture script (appendix). Walk the journey: import a reference, **Rate taste**, the Taste deck, Components, Flows, then Discovery's **Explore**. Capture light, dark, wide and reduced motion. Commit a curated set to `docs/design/hq-visual-system/evidence/sources-20261103/after/` and add the results to the assessment.
5. **Checks.** Take a CPU sample first: run no tests at 85% CPU or above, and one serial test process at a time. Then run, for each section (components, references, imports, flows, taste, discovery, app, app-sections): `tsc`, node tests and vitest, as in its workflow row. Then `npm run typecheck`, and root `npm test` if the host allows.
6. **Open one PR** from the lane branch to `work/hq-foundation`, with before and after screenshots. Link and watch it, and ask F7 for the review. Do not merge.
7. **Follow-ups once F4 lands:**
   - Resolve the hunks next to F4's changes: `discoveryEnv()` beside `projectsFor` in `fake-workspace.ts`, `mountReferences` beside the Requests functions in `closure-views.tsx`, and F4's skeleton change to `SectionOutlet.tsx`.
   - Opt the Sources views into the active project where it helps, for example References and Flows.

## Open questions and risks

- **Owner:** are F5's four Components families the intended ones? If another set existed (for example in Figma), the decision should be revisited against it.
- **Owner:** should References, Imports, Taste, Components, Flows and Discovery share one Sources navigation group?
- No builder output has been reviewed. Quality and scope are unverified until step 2.
- Taste can conflict with #168 or #179 if either lands first and changes the same `TastePanel` hunks.
- F4's edits sit next to F5's in `fake-workspace.ts` and `closure-views.tsx`. F4 was told which functions F5 touches.
- The Discovery fake adapter must never reach the bridged store or a real host.
- The host maps `system-ui` to Liberation Mono. Captures alias the Plex faces to Liberation, and F1 fixed the font stack.
- Tooling gaps at the pause: `.agents/shared-guidance.md` is absent, so shared enrollment was unavailable. The Figma MCP needs authorization. The Playwright MCP failed to connect, so captures used `playwright-core` directly.

## Outside the repository

- **Builder briefs:** written to `/tmp/hq-f5-briefs/`. Copies with private paths removed are in [`f5-design-sources/briefs/`](f5-design-sources/briefs/): `common.md` and one file per view.
- **Capture tooling:** `/tmp/hq-f5-tools/`. `capture.mjs` is in the appendix. `shot.mjs` takes a full-page shot of one URL. `flow-refs.mjs` drives the two-image reference import. Its fixtures are two generated PNGs, which can be regenerated.
- **Screenshots:** builders kept theirs in `/tmp/hq-f5-evidence/<view>/` and were asked to commit up to six each to `docs/design/hq-visual-system/evidence/sources-20261103/wip/<view>/` on their branches. The curated "before" shots are already committed in [`evidence/sources-20261103/before/`](../../design/hq-visual-system/evidence/sources-20261103/before/).
- **Threads:**
  - Lead: `mcp:launch:client%3Addb62b7e-9526-46f2-a948-8508706836d5:fwd%3A9f91925da322cbd636d453fbb9356b42d78148333bef1a8c58f660c9d7499dd1`.
  - Builders: `thread:delegated-task:command%3Amcp%3A0960095c-b1b4-4209-9b0c-3f02c2504358%3Adelegate-task%3Ahq-f5-builder-<view>-r1`, with `<view>` one of `references`, `imports`, `taste`, `flows`, `discovery` and `components`.
- **Messages received:**
  - F1: its primitives were published.
  - F4: its shared-file edits, and its next change to `SectionOutlet.tsx`. F5 replied that it is not editing that file.
  - F7: PR #185. F7 will review the F5 PR.

## Builder handoffs

Each builder committed its handoff on its own branch, at
`docs/handoffs/hq-life-20261103/f5-design-sources/hq-life-design-sources-<view>-20261103.md`. The copies here are identical.
Each branch also holds six screenshots in `docs/design/hq-visual-system/evidence/sources-20261103/wip/<view>/`.

- [References](f5-design-sources/hq-life-design-sources-references-20261103.md): pushed head `1f4d5b0`
- [Imports](f5-design-sources/hq-life-design-sources-imports-20261103.md): pushed head `ea2824a`
- [Taste](f5-design-sources/hq-life-design-sources-taste-20261103.md): pushed head `8d3db74`
- [Flows](f5-design-sources/hq-life-design-sources-flows-20261103.md): pushed head `c47bb5a`
- [Components](f5-design-sources/hq-life-design-sources-components-20261103.md): pushed head `6b4bc02`
- Discovery: pending. Its stop message arrived after it had filed its final report, so it was asked again, for the handoff only. Its code is pushed at `cc0b202` and its worktree is clean.

## Appendix: capture script

`node capture.mjs <baseUrl> <outDir> [width] [height] [light|dark] [View,View]` opens each Sources view through the Design navigation and saves `<view>-<theme>-<width>.png`. Set `REDUCED=1` for reduced motion and `SETTLE=<ms>` to change the settle delay (1800ms by default). It needs a Chromium at `/usr/bin/chromium`.

```js
// Usage: node capture.mjs <baseUrl> <outDir> [width] [height] [theme]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('<path to a local playwright-core install>');
const [base, out, w = '1280', h = '820', theme = 'light', only = ''] = process.argv.slice(2);
const views = [
  ['Resources', 'References'], ['Resources', 'Components'], ['Resources', 'Flows'],
  ['Review', 'Taste'], ['Requests', 'Imports'], ['Projects', 'Discovery'],
].filter(([, s]) => !only || only.split(',').includes(s));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: theme === 'dark' ? 'dark' : 'light', reducedMotion: process.env.REDUCED ? 'reduce' : 'no-preference' });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: "@font-face{font-family:'IBM Plex Sans';src:local('Liberation Sans')}@font-face{font-family:'IBM Plex Mono';src:local('Liberation Mono')}" });
await page.getByRole('button', { name: 'Resources' }).waitFor();
for (const [tab, section] of views) {
  await page.getByRole('navigation', { name: 'Design' }).getByRole('button', { name: tab, exact: true }).click();
  await page.getByRole('navigation', { name: `${tab} sections` }).getByRole('button', { name: section, exact: true }).click();
  await page.waitForTimeout(+(process.env.SETTLE ?? 1800));
  await page.screenshot({ path: `${out}/${section.toLowerCase()}-${theme}-${w}.png` });
}
console.log(JSON.stringify({ captured: views.map(([, s]) => s), logs }, null, 1));
await browser.close();
```

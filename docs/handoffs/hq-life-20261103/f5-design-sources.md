# Lane F5 handoff: Design Sources views — 2026-11-03

Lane F5 makes the Design module's Sources views (References, Imports, Taste, Flows, Discovery and Components)
alive, flowing and fully functional. The owner paused the lane on 2026-11-03, before review, integration or a PR.

Authority effect: none. This is a handoff record. It grants nothing and changes no hold.

## Status

- **Done:** the Sources flow assessment, the Components family decision and the shared Taste handoff seam, built on lane F1's primitives. All are pushed on the lane branch.
- **In progress:** six builders each committed a first pass of one view on its own sub-branch. The lead has not reviewed any of them yet.
- **Not started:** review and fix rounds, integration into the lane branch, after screenshots, the full check run and the PR to `work/hq-foundation`.

## Branches, worktrees and SHAs

Each worktree is `~/.t3/worktrees/HQ/<branch>`, with the branch's `/` replaced by `-`. The lane branch holds this
file; its head is the commit that adds or last updates it. Builder heads are the last commits seen before the pause.
Each builder's handoff gives its final pushed head.

| Branch | Head before pause | Builds on | State | Handoff |
| --- | --- | --- | --- | --- |
| `work/hq-life-design-sources-20261103` (lane) | `4104a6b` | `work/hq-foundation` `0cd50ab`, merged with F1 `284393d` | Pushed: assessment, families mockup, handoff seam | this file |
| `work/hq-life-design-sources-references-20261103` | `4cd4259` (3 commits) | lane `f5d6bc8` | First pass committed | pending |
| `work/hq-life-design-sources-imports-20261103` | `373a185` (2 commits) | lane `f5d6bc8` | First pass committed | pending |
| `work/hq-life-design-sources-taste-20261103` | `6346fd9` (3 commits) | lane `f5d6bc8` | First pass committed | pending |
| `work/hq-life-design-sources-flows-20261103` | `583d0a0` (1 commit) | lane `f5d6bc8` | First pass committed | pending |
| `work/hq-life-design-sources-discovery-20261103` | `cc0b202` (1 commit) | lane `f5d6bc8` | First pass committed | pending |
| `work/hq-life-design-sources-components-20261103` | `1d2d473` (1 commit) | lane `4104a6b` | First pass committed | pending |

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

## What's left, in priority order

1. **Read the six builder handoffs** (pending; they are linked below once written).
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

Pending. Each builder writes `docs/handoffs/hq-life-20261103/f5-design-sources/hq-life-design-sources-<view>-20261103.md`
on its own branch.

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

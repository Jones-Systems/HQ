# F5 Design Sources: Components view handoff

Status: paused by the owner at the next safe point. The brief's build items are all implemented and checked. What remains is review and polish, not missing features.

## Where it stands against the brief

| Brief item | State |
| --- | --- |
| 1. Responsive layout (library, variant strip, stage, controls; 3 columns at 880px and wider; no overflow at 572px) | Done |
| 2. Variant strip (Base first, prop-diff chips from a pure helper, gliding highlight, arrows/Home/End, session persistence) | Done |
| 3. Held blueprint stage (backdrops, width presets, dashed frame, token swatches, one Preview held notice, Why? disclosure, FAKE label for the synthetic runner) | Done |
| 4. Controls (type chip, hint, overridden dot, Reset, Reset all, Spec disclosure, FieldError, save-failure toast) | Done |
| 5. Tokens swatch grid with copy toast and missing-clipboard fallback | Done |
| 6. Motion tab (player kept, HQ-drawn proxy, curve draw-in, save toast, reduced-motion sampled frames) | Done |
| 7. Optional `onSendToTaste`, wired in `ComponentsView` | Done |
| 8. Load failure (`StateView` only when nothing loaded, otherwise `InlineNotice`) | Done |
| Tests (node helpers, vitest render and hold tests) | Done |
| Visual polish and review | In progress: one pass done by the builder, no lead review yet |

## Branch, worktree, head

- Branch: `work/hq-life-design-sources-components-20261103` (from `origin/work/hq-life-design-sources-20261103` @ `4104a6b`, an ancestor of HEAD).
- Worktree: `~/.t3/worktrees/HQ/work-hq-life-design-sources-components-20261103`
- Code head: `1d2d473` "Rebuild the Components view around a held blueprint, variant strip and calm controls". This commit has no `WIP:` prefix because it was committed as a finished slice before the pause.
- WIP commits after it: `4d3a4f6` "WIP: Components evidence screenshots", then this handoff ("WIP: Components handoff"). The pushed head SHA is in the final message of the thread, because a file cannot contain its own commit hash.
- No PR opened, nothing merged.

## Decisions and why

- **Security hold is structural, not a flag.** The blueprint is built only from `source.name`, `source.size`, `source.props`, the variant name, resolved props and token metadata. `ComponentSurface` reads `source.script.trim() !== ''` only to word the hold, never to run anything. Pure helpers are tested with a Proxy-guarded source that fails on any read of markup, styles or script.
- **Single-DOM container-query layout.** One DOM with grid areas serves both the stacked 572px column and the 3-column wide layout, so there is no duplicated markup and no JS breakpoint.
- **Variant selection moved out of `PropsPanel` into `VariantStrip`.** `PropsPanel` lost `onSelectVariant`. `SecondaryPanel` was dropped from `ComponentsWorkspace` because the strip and Spec disclosure replace it.
- **Glide ring measured with `offsetLeft/Top/Width/Height`**, with CSS transitions using the duration tokens, so reduced motion gets no motion with no extra logic.
- **Motion proxy has no CSS transition.** It always shows exactly the sampled frame. Under reduced motion the frame is `sampleStudy(draft, snapToSampleFrames(t, total))`, which gives 5 frames while playback time still advances.
- **Boolean props show no constraint hint** (it was "on or off", redundant next to "off").
- **Session-save failure is a toast with a stable id**, not a persistent notice, per the brief.
- **`onSaveDraft` return type widened** to `Promise<MotionStudy | void>` so the saved revision can be named in the success toast.
- **Test assertions changed from `/HELD/` to "Preview held"** in `render.test.tsx` and `runner.test.tsx`, because the old wording is gone.

## Findings

- The shell's zero-specificity rule in `apps/desktop/src/styles.css` (lines 13-17) gives every button `min-height: 30px; padding: 6px 10px`. It stretched the keyframe diamonds into bars until I set `min-height: 0; min-width: 0`. The library chips and the link button needed explicit resets too. This is the likeliest source of future small-button bugs.
- `text-overflow` does nothing on a `display: grid` element. The tile thumbnail text clipped mid-glyph until I switched the frame to `display: block`.
- A `/favicon.ico` 404 appears as a console error in every capture. It is a dev-server artifact (plain `curl` shows it too), not from this view.
- A negative-margin strip caused 3px of horizontal overflow at 572px. It was fixed and the final captures report no overflow at 1280 and 1680.

## What is left, in priority order

1. **Lead visual review against the brief.** I reviewed every screenshot myself, but no one else has.
2. **Dark-theme captures for the Tokens and Motion tabs, and for the 320/480 presets.** Only the default stage, tall layout and wide layout were captured in dark.
3. **Capture the failed-session-save toast.** It is covered by `workspace.test.tsx` but there is no screenshot. Next step: make `library.saveSession` reject in the evidence tool (`states.mjs` in `/tmp`, see below) and add a state.
4. **Motion tab polish.** The Preview held notice is tall in that tab. A compact variant or a shorter message would leave more room for the player.
5. **Wide layout.** At 1680 with the inspector open, the stage column is about 430px wide. Consider giving the stage more width or collapsing the inspector in the capture.
6. **Base tile spacing.** The Base tile has empty space under "declared defaults" because the neighbouring tiles carry two chip rows. Consider a shared min-height or aligning to content.
7. **Taste handoff contract.** `ComponentsView` imports `sendToTaste` from `../sources/taste-handoff.ts`. If another lane changes its signature, this call breaks. Re-run the app typecheck after merging.

## Open questions and risks

- **Confirmed: no component markup, styles or scripts render in the renderer.** The stage is an HQ-drawn blueprint. A final grep of the workspace UI found no `innerHTML`, `DOMParser`, shadow DOM, `srcdoc` or `blob:`. The one `srcDoc` is in the existing `SandboxFrame`, which I did not modify and which the workspace does not import (asserted in `hold.test.tsx`). The runner path through `ComponentSurface` with a `runner` still works and only appears with a runner supplied.
- **Confirmed: the stage host is never transformed.** `div.hqc-frame` and its ancestors carry no `transform`, and no `hq-enter`, `hq-lift`, `hq-press` or `hq-flash` class. `workspace.test.tsx` asserts this on the host chain. Transforms exist only on children: the blueprint content, the motion proxy boxes and the variant glide ring.
- **Risk: the real runner path was not exercised in a browser.** Runner behaviour is covered by tests with a fake runner only.
- **Risk: the unit tests and screenshots are my own evidence.** Keyboard behaviour (arrows, Home/End, Escape in a control) is tested in happy-dom, not in a real browser.
- **Question for the lead:** should the Rate taste button stay in the stage meta row, or move beside the variant strip?

## Checks run

All run before the pause, on code head `1d2d473` (nothing was run after the stop order, and the commits after it only add docs and images). CPU was sampled first at 67.9%, and checks ran one at a time.

| Command | Result |
| --- | --- |
| `node_modules/.bin/tsc -p modules/design/components/tsconfig.json` | pass |
| `node --test modules/design/components/tests/*.test.ts` | 66 of 66 pass (12 files) |
| `npx vitest run --config modules/design/components/vitest.config.ts` | 52 of 52 pass (4 files) |
| `node_modules/.bin/tsc -p modules/design/app/tsconfig.json` | pass |
| `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts` | 197 of 197 pass |
| `npm run typecheck` | pass |

## Evidence

Six screenshots are committed in `docs/design/hq-visual-system/evidence/sources-20261103/wip/components/`: `stage-light-1280`, `stage-dark-1280`, `stage-light-1680`, `motion-light-1280`, `toast-copy-light-1280`, `field-error-light-1280` (all `.png`, synthetic data).

## What exists only outside the repo

- Nothing uncommitted in the worktree.
- `/tmp/hq-f5-evidence/components/shots/` holds 28 screenshots (hover, glide keys, Why?, width presets, card, motion states, toasts, tall layouts). Only the six above are committed.
- `/tmp/hq-f5-evidence/components/tools/states.mjs` and `inspect-key.mjs` are my capture helpers (states: stage, tall, scrolled, tokens, toast-copy, motion, error, hover, keys, rate, why, presets, card). They are not in the repo. The lead's `capture.mjs` lives in `/tmp/hq-f5-tools/`.
- The dev server on the assigned port is stopped, and I started no other background process.

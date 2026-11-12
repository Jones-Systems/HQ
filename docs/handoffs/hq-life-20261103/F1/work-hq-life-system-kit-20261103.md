# Handoff: F1-B1 kit page, motion and feedback evidence (paused)

Paused at the F1 lead's request. Work is partly done and **not yet verified by tests or typecheck**.

- Branch: `work/hq-life-system-kit-20261103` (from `work/hq-life-system-20261103` @ `284393d`), pushed to origin.
- Worktree: `work-hq-life-system-kit-20261103` (under `~/.t3/worktrees/HQ/`).
- WIP head: `454c06145ca5f3fc3ac464e685ca062f8cf5c35f`. The handoff commit sits on top of it.
- No PR opened. No force-push, reset, clean, rebase or merge.

## Where it stands

**Done (code, written and browser-checked)**
- Kit "Motion and feedback" section: `packages/hq-ui/test/kit/MotionFeedbackSection.tsx`, wired into `KitPage.tsx`/`main.tsx`, styles in `kit.css`, usage in `test/kit/README.md`. It covers all nine requested items: toasts (each tone, Undo with `meta`, promise resolve/reject, repeat ×3, burst of 5, Dismiss all, Resolve loading), banner and `bar` notices with actions, a busy action and a dismiss, a notice in `<Presence motion="collapse">`, status indicators, `FieldError` with `fieldErrorProps`, seven `Presence` motions, `useListMotion` (Shuffle/Sort/Add/Remove), `PageTransition` + `navigateWithTransition` (3 panels), `Skeleton` shapes and the five utility classes, `ErrorBoundary` with Crash and Try again, and a Reduced motion switch in the header beside the theme switch.
- URL params: `?only=motion`, `?theme=light|dark`, `?motion=reduce`. Scripting hooks: `window.hqKit.toast`, `setReducedMotion`, `setAppearance`.
- Defect fixes in `@hq/ui` (below). No exported names or signatures changed.

**In progress**
- Regression tests for each fix are written (`test/feedback.test.tsx`, `test/motion.test.ts`) but **never run**.
- Screenshot evidence: not captured. The capture script is written but never run.

**Not started**
- Final `npx vitest run packages/hq-ui`, `npx tsc -p packages/hq-ui/tsconfig.json --noEmit`, `npm run typecheck`.
- Rebuilding the kit and re-checking the `useListMotion` fix in a browser.
- All PNG evidence for light/dark, toast stack mid-animation, reduced motion and dark notices.

## Defects found and fixed

1. **Ghost toasts** (`src/feedback/ToastViewport.tsx`, `ToastItem` ~l.200-204). A toast that expired or was dismissed while folded behind "N more" was first rendered already "leaving". It had no exit animation to wait for, so `onExited` never ran and it stayed on screen as an inert li after the store was empty (observed: 0 in store, 2 slots in DOM). Fix: render null when not mounted, and call `onExited` once if the item started leaving. Verified in browser after the fix (folded toasts expiring and Dismiss all leave nothing behind).
2. **Only the last toast of a burst was announced; folded repeats were silent** (`ToastViewport.tsx` l.43 `nextAnnouncement`, effect ~l.100-121). Each `setPolite`/`setAssertive` overwrote the previous. Now one pass joins all texts with ". ", and identical consecutive text gets a trailing no-break space so the region re-announces. Verified: the burst announces all five.
3. **F8 could not leave the toasts when nothing had focus before** (`ToastViewport.tsx` `leaveToasts` ~l.125). The return target was `document.body`, and `body.focus()` is a no-op, so focus stayed in the toast. Now it blurs the active element in that case. Verified in browser.
4. **Stack did not close up on exit** (`src/feedback/feedback.css` l.47-48). The slot is a flex item; its automatic min-height held it at full height while the `height: 0` keyframe ran, so neighbours jumped when it unmounted. Added `min-height: 0` to the exit rule. Verified: slot height goes 46→0 over ~160 ms.
5. **Reorder during a running glide jumped by the leftover offset** (`src/motion/useListMotion.ts` l.39, ~l.55-70). The layout effect measured `after` while the old glide's transform was still applied, so the new glide started that many px away (35 px on the first frame in one capture). Now it cancels tracked glides before measuring. **Not yet re-verified in a browser**, because the build I tested lacked this fix.

## Verified in browser (Chromium 156, T3 preview tab, incognito, 1440×900 viewport), kit under the app CSP

- Assertive live region text for error toasts; F8 in and out; Escape dismisses and returns focus; hover pauses timers and releases them when the pointer leaves.
- Seven `Presence` motions use their enter/exit durations (exit shorter than enter) and unmount about 170 ms after hide.
- `PageTransition`: `startViewTransition` ran with type `hq-nav-forward`; old fade-out 90 ms, new rise-in 240 ms.
- `useListMotion` Sort/Shuffle/Add/Remove produce the expected offsets.
- `FieldError` sets `aria-invalid`/`aria-describedby`. `ErrorBoundary` contains the crash and recovers.
- Reduced motion: tokens are 0, `Presence` unmounts at once, no view transition, shimmer and skeleton sheen stop, `hq-flash` still plays.
- **Zero CSP violations and no console errors** other than React's expected log of the intentional boundary crash. The only `style` attributes come from `Skeleton`'s CSSOM `setProperty`, which the CSP allows.

## Decisions

- Fixed only inside the allowed scope and kept exported APIs unchanged.
- Chose a joined announcement with a no-break-space toggle over a queue, as the smallest change with no API impact.
- Left the folded-out-toast pop unfixed (below): animating it needs a "hidden but live" state that interacts with the ghost fix, so it deserves its own design decision.
- Exposed `window.hqKit.toast` in the kit only so evidence runs can script toasts.

## Findings not fixed (observations)

- When a 4th toast arrives, the oldest visible one disappears instantly with no exit animation (it is folded, not removed).
- `ErrorBoundary`: focus drops to `body` after the crash and again after Try again; a keyboard user loses their place.
- Toast twin-folding ignores `meta`, so toasts that differ only in `meta` merge.
- The preview tool's screenshot is downscaled to 1280×800 even at a 1440×900 viewport. That is why the capture script uses headless Chromium.
- `bar` notices with an action wrap to two lines at 1120 px (visual nit in the kit, not the component).

## What's left, in priority order

1. Check `uptime` (wait for the 1-minute load ≤ 13; it was 27-68 during this session). Run `npx vitest run packages/hq-ui`, `npx tsc -p packages/hq-ui/tsconfig.json --noEmit`, `npm run typecheck`. Fix failures in the new tests first. Likely risk points: the happy-dom `animate` and `getBoundingClientRect` mocks in the `useListMotion` tests; fake timers with the `usePresence` 320 ms exit fallback in the ghost test; and F8-from-body in happy-dom. Diagnose before changing; do not weaken a test just to get green.
2. `npx vite build --config packages/hq-ui/test/kit/vite.config.ts`; serve with `npx vite preview --config packages/hq-ui/test/kit/vite.config.ts --port <free 5320-5339> --strictPort --host 127.0.0.1`. In a browser, re-check fix 5: click Sort, then Shuffle about 90 ms later; the first-frame jump should be 0.
3. Run `node /tmp/hq-f1-system/evidence/kit/capture.mjs <port> /tmp/hq-f1-system/evidence/kit`. It is headless Chromium over CDP, untested, and lives only in `/tmp` (not in the repo). It writes light/dark 1440×900 and full-page PNGs, notices, toast stack entering and exit-closing (animations frozen mid-flight), burst-folded, reduced motion and dark notices, plus `capture-results.json` with keyboard, hover, view-transition and console/CSP results. Expect to debug it once. Look at the PNGs before reporting.
4. Commit coherent checkpoints (drop the `WIP:` prefix), push, and send the final report (SHAs, defects with file:line, check counts, screenshot paths, unverified items).
5. Stop the preview server and close any preview tab.

## Open questions and risks

- Should the lead take the folded-out toast exit animation and the `ErrorBoundary` focus fix, or leave them as follow-ups?
- `ToastItem` calls `onExited` from an effect; under StrictMode it runs twice. This is harmless (a repeated map delete and rerender) but worth a glance in review.
- The trailing no-break space will appear in live-region text; any test or tool comparing it exactly needs `.trim()`.
- I never ran vitest or `npm run typecheck`. `tsc -p packages/hq-ui/tsconfig.json --noEmit` passed after the `useListMotion` edit but before the test files were edited, so it needs a rerun.

## Exists only outside the pushed branch

- `/tmp/hq-f1-system/evidence/kit/`: `capture.mjs`, `gated-checks.sh` (waits for low load, then builds, runs vitest and tsc; I killed it before it ran), `light-top-first-build-preview-tool-1280x800.png` (one early screenshot from the first build, preview tool, downscaled) and server logs. No other PNGs exist.
- `packages/hq-ui/test/kit/dist/` is the gitignored build from before the `useListMotion` fix.
- My preview server is stopped and my preview tab is closed. Port 5327 is free.
- Observations above were made in this thread; the numbers quoted are from live evaluate runs and were not saved to files.

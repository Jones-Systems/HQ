# Lane F2 builder brief — shared part (read all of it; it is part of your task)

You are one of five builders on HQ lane F2: make the HQ Work module's views mockup-grade, alive and flowing. The F2 lead (an Opus agent; the thread that delegated you) owns design decisions, shared files, review, integration and the PR. You build one slice in your own git worktree. Your slice brief (in your task prompt) names your branch, cone, port, scratch folder and deliverables.

Base: `work/hq-life-work-20261103` @ `18e6502` (pushed to origin). It already contains F1's shared motion and feedback primitives and the lead's Work foundation.

## Read first, in your worktree

1. `AGENTS.md` (HQ working agreements) and `CLAUDE.md`, and the guidance they route to.
2. `docs/design/work/flow-assessment-20261103.md`. This is your design spec: the flow findings, decisions, feedback rules, invariants and build slices. Your slice brief cites the finding IDs you own.
3. `docs/design/hq-visual-system/motion-and-feedback.md`. F1's shared `@hq/ui` motion and feedback API:
   - Feedback: `toast` / `useToast` (the shell mounts the viewport), `InlineNotice`, `StatusIndicator`, `FieldError` / `fieldErrorProps`, `ErrorBoundary`, `useAsyncAction`, `Skeleton`.
   - Motion: `Presence` / `usePresence`, `useListMotion` (FLIP via `data-hq-motion-key`; one ref on a container measures all its descendants, so cards glide across columns), `PageTransition` / `navigateWithTransition`, `useReducedMotion` / `prefersReducedMotion`, `animateElement`, `MOTION_DURATIONS` / `MOTION_EASINGS`.
   - Classes and tokens: `hq-enter-*`, `hq-stagger`, `hq-press`, `hq-lift`, `hq-flash`, `hq-shimmer-text`; `--hq-duration-*`, `--hq-ease-*` (including `--hq-ease-spring`), `--hq-motion-*`.
   Use these. Do not build parallel versions.
4. The Work theme in `modules/work/theme/` and the motion extras in `modules/work/motion/`. Both are lead-owned and read-only for you.
   - Palette: `--work-st-*` (status), `--work-why-*` (why) and `--work-dk-*` (date kind), each with a `-bg` fill. All use light-dark().
   - Type, radii and shadows: `--wk-type-*`, `--wk-radius-*`, `--wk-shadow-*`, `--wk-card-bg`, `--wk-gutter`.
   - The one chip family: `.wk-chip` with `--need`, `--want`, `--exploring`, `--target`, `--deadline`, `--start`, `--event`, `--coarse`, `--overdue`, `--passed`, `--high` and `--status`.
   - Marks and pieces: `.wk-dot` status shapes, `.wk-seg` / `SegmentedNav`, `PageHeader`, `.wk-kbd`, `.wk-count`, `.wk-quiet`.
   - Components: `KindIcon`, `DateKindIcon`, `StatusDot`, `CheckIcon`, `ArrowUpIcon`, and `DoneButton`, the shared round Done control.
   - Motion extras: `flyTo`, `flash`, `tiltFor`, `settleGhost`.
   - Shared parts: `modules/work/views/parts.tsx` (`DateChip`, `StatusMark`, `KindMark`, `MotivationPill`, `ItemRow` and others) and `modules/work/board/parts.tsx` (card chips) are already on the theme.
5. The mockups are the visual bar. Match or beat them.
   - `docs/design/work/mockups/work-hq.html` (open it in the browser, or read its CSS for exact spacing).
   - `docs/design/work/mockups/evidence/01-…13-*.png`, plus `docs/design/work/mockup-evidence.md` and `docs/design/work/hq-work-design.md`.
   - Inspiration: Linear, Things 3, Todoist, Notion boards, Sunsama.
   - The Design domain of the app is the in-app quality bar.

## Ownership

- Change only the files in your slice's cone. Everything else is read-only for you.
- **Lead-owned (do not edit):**
  - `modules/work/theme/**` and `modules/work/motion/**`
  - `modules/work/board/parts.tsx`, `modules/work/views/parts.tsx` and `modules/work/views/views-base.css`
  - `modules/work/views/index.ts` and the assessment doc
  If you need something shared, keep it local to your own files, for example a small component or CSS rule in your view's file. List it in your report so the lead can promote it.
- **Off-limits entirely:**
  - `modules/work/core/**`, `modules/work/live/**` and `services/**`: lane B1, the Planner backend.
  - `packages/**`, including `@hq/ui`, and the global HQ shell (`apps/**`): lane F1.
  Do not change the Work store API or `PlannerPort`. Use them as they are.
- Do not touch package.json or lockfiles. Add no dependencies.

## Cross-slice contracts (all five builders rely on these)

- **Capture landing.**
  - Board (slice A): the Inbox column's card list carries `data-wk-capture-target="inbox"`.
  - Frame (slice E): the Work nav's Status board item carries `data-wk-capture-target="nav"`.
  - After a successful capture, slice E calls `flyTo(fieldRect, target, title)` from `modules/work/motion`. The target is the first visible `[data-wk-capture-target="inbox"]`, otherwise `[data-wk-capture-target="nav"]`.
  - Slice A makes a card that newly appears in Inbox after first render rise into place (`Presence` / `hq-enter-*`). Cards present at first load never animate.
- **Done.** Board cards (A), List rows (B), Glance Now rows (E) and Plan week cards (D) use `DoneButton` from `modules/work/theme`.
  - The accessible name is `Mark “<title>” done`.
  - `onDone` makes one status move to Done, place top, through the existing write path (the store `move`), with the usual Undo toast.
  - Show it on row hover and focus-within. It always stays reachable by keyboard.
- **Feedback API.**
  - Slice E rebuilds Work feedback on F1's toasts. It keeps the exported API of `modules/work/board/feedback.ts` stable (`createFeedback`, `sharedFeedback`, `useFeedback`, and `push` / `dismiss` / `dismissUndo` / `getState` on a feedback object), so the board and detail keep calling `feedback.push(...)` unchanged.
  - Views keep using `useEnv()` from `modules/work/views/env.tsx`.
- **Moves helpers.** `modules/work/views/moves.ts` belongs to slice C. Its exported function signatures must stay stable, because Plan week (D) imports `addDatePatch`, `rescheduleDatePatch`, `removeDatePatch` and `scheduleDay`. Additive changes only.
- **Keyboard.**
  - Board moves use Alt+←/→/↑/↓ and must keep calling `preventDefault()`. F7's global Back shortcut (Alt+←, ⌘[ on Mac) yields to `event.defaultPrevented`.
  - Global Work keys: `N` (capture) and the view number keys `1`–`7` (slice E). They ignore typing contexts (`isTyping` in `views/env.tsx`), modified keys and `event.defaultPrevented`.
  - Any scoped keys (for example Review's triage queue) apply only while focus is inside that surface. They call `preventDefault()` and `stopPropagation()` and are shown as visible hints.
- **Chrome.** Slice E compacts the Work top bar. Pages render their own `PageHeader` (title, meta, actions) and add no page-wide banners. Contextual problems use `InlineNotice` in place. A full-page `StateView` appears only when nothing is loaded.

## Non-negotiables

- **Planner invariants** (assessment, "Invariants kept"):
  - Moving a card never starts work.
  - No date is invented.
  - Coarse precision stays visible (dashed).
  - Status changes from the detail panel or List go through `move`.
  - Field undo is compare-and-swap.
  - By date stays read-only.
  - Weekly plan lists (D-3) stay Proposed.
  - Keep the honesty copy ("Planning change only · no run started", the example-data notes).
- **Motion** must be purposeful and quick, and must never block input.
  - Use the shared tokens (fast 90 ms, base 160, slow 240, slower 360; spring for drops and settles).
  - Animate transform and opacity, not layout.
  - Honour reduced motion, from both the OS and the shell's `<html data-hq-motion="reduce">`. In JS, use `useReducedMotion()` / `prefersReducedMotion()`. In CSS, use the duration tokens: they become 0 ms under reduce. Never hard-code durations.
- **Accessibility.**
  - Every pointer interaction has a keyboard path. Focus is visible, and roles and names are correct.
  - Moves are announced through the existing live regions.
  - Colour is never the only signal: pair it with a word or shape.
  - Text contrast is 4.5:1 (the theme hues already pass). Forced-colors mode stays usable. Hit targets are at least 24 px.
- **CSP:** no inline `style` attributes, so no React `style={…}` either. Set dynamic values through CSSOM (`el.style.setProperty('--x', …)`) or WAAPI.
- **Tests:**
  - Do not weaken or delete existing tests.
  - Update an assertion only when the visible copy or structure legitimately changed per the assessment, and say which ones you changed in your report.
  - Add tests for new behaviour (Vitest 5 with happy-dom and Testing Library; follow the tests next to your files).
  - Keep class names that tests query, or update those tests on purpose.
- **Public repo:** no private data, credentials, internal hostnames or IPs, or home-directory paths in code, docs or commit messages. Screenshots show only the synthetic sample data.
- **Git:**
  - Commit only on your branch, and push it to origin at checkpoints and at the end.
  - Never force-push, `reset --hard`, rebase published commits, `git clean`, or touch other branches.
  - Do not merge into `work/hq-foundation` or `main`. Do not open PRs: the lead integrates and opens the PR.
  - End each commit message with the co-author attribution line your harness specifies.
  - Do not use bare `git stash`.
- **Never** install, update or restart Jones Code. No deploys, no restarting services or apps outside your own scratch preview server, no sudo.
- **Shell hook:** a safety hook rejects shell variables inside git commands (`git -C "$X"` is rejected; use literal absolute paths) and truncating redirects (`>`) into home-directory paths. Create files with your editor tools, and write scratch output only under your `/tmp/hq-f2/<slice>/` folder.

## Host etiquette (a shared 16-core machine; four other builders run in parallel)

- **Load check.** Before vitest, a vite build or a Chromium capture, run `cat /proc/loadavg`. If the 1-minute load is above 13, wait about a minute and check again.
- **Tests.** Run vitest serially and scoped: `npx vitest run modules/work/<area> --no-file-parallelism`. Run `npx vitest run modules/work --no-file-parallelism` once before your final push.
- **Typecheck:** `npx tsc --noEmit -p .` at the worktree root.
- **Setup.** Your worktree was prepared by project setup. If `node_modules` is missing, report it rather than running a large install.

## Preview and screenshots (lane scratch tools, not product code)

- **Build.** Build a browser preview of your worktree: `bash /tmp/hq-f2/tools/preview-build.sh <your-absolute-worktree-path> /tmp/hq-f2/<slice>/preview`. It takes about 30–60 s, builds uncommitted source too, and replaces only that folder. The preview is the full HQ shell with synthetic Work sample data, and Work opens on the Status board.
- **Serve.** Run `python3 -m http.server <your-port> --bind 127.0.0.1 --directory /tmp/hq-f2/<slice>/preview` as a background process. Stop it when you finish.
- **Capture.** Run `node /tmp/hq-f2/tools/shot.mjs <plan.json>` from cwd `/tmp`.
  - The header of `/tmp/hq-f2/tools/shot.mjs` documents the plan format: url, width, height, colorScheme, reducedMotion, settle, and steps such as click, press, type, hover, focus, drag (with hold/holdShot for mid-drag), release, wait, eval, shot and resize.
  - Example plan: `/tmp/hq-f2/before/plan-light.json`.
  - Selectors are Playwright selectors, for example `role=button[name="List"]` or `css=.work-card >> nth=2`.
  - You may also use the t3-code `preview_*` tools for interactive checks if your session has them.
- **Before shots.** `/tmp/hq-f2/before/*.png` holds 1440×900 light captures from before F2: board, bydate, list, calendar, timeline, review, archive, glance, board-detail and capture-dialog. If you need other before states, serve the pre-F2 bundle `/tmp/hq-f2/before-preview` on your port + 10 and capture it. Do not rebuild that bundle.
- **After shots (required)**, saved to `/tmp/hq-f2/<slice>/after/` as `<view>-<width>-<scheme>.png`:
  - each of your views at 1440×900 light and dark;
  - 760×600 light (the app's minimum window);
  - the key interaction states your slice adds, such as mid-drag, drop badge, toast, detail open, empty or all clear, or the reduced-motion end state.
- **Review your own shots.** Look at every screenshot yourself and compare it with the mockup and the before shot. Fix what misses the bar before you report: clipping, cramped spacing, wrong hues in dark, misaligned baselines or focus rings, overflow at 760.

## Report (your final message, short)

- What you built, by finding ID.
- Files changed.
- Any test assertions you changed, and why.
- Checks, with the commands and pass counts.
- Before and after screenshot paths.
- Known gaps, and questions for the lead (including shared changes you need).
- Last line exactly: `Branch <branch>, head <SHA>, pushed <yes|no>, checks <tsc pass|fail>; <vitest N passed, M failed>`

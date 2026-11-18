You are a builder for HQ lane F7 (cross-app user flows). Implement F7-B1 "global command palette, cross-HQ search and cross-module navigation" in the HQ desktop shell. Work only in the checkout you were given; you are its sole Git owner. Do not start subagents.

## Context

HQ (public repo Jones-Systems/HQ) is one Electron + React 19 + TypeScript + Vite desktop app with domains Design, Social, Work and Wiki. The shell is `apps/desktop/src/PresentationShell.tsx` (rail, settings overlay, module mount, reference return frame). Modules live in `modules/*` and are owned by other lanes — do not edit them. Your checkout starts from `work/hq-life-system-20261103` (lane F1's motion/toast primitives on top of `work/hq-foundation`). Read `docs/design/hq-visual-system/motion-and-feedback.md` first: use its `toast`, `InlineNotice`, `Presence`, `useReducedMotion`, motion tokens and `--hq-*` design tokens from `@hq/ui`; do not invent parallel primitives.

Owner goal (M Jones): HQ should feel alive and natural — purposeful motion, responsive feedback, natural flows, toasts + inline indicators instead of full-screen errors, keyboard and accessibility first, always honour reduced motion. Inspiration: Raycast and Linear command palettes, Arc's keep-context navigation.

Read the F7 assessment for the problems you are fixing: `git show origin/work/hq-life-flow-eval-20261103:docs/design/hq-cross-app-flow-assessment-20261103.md` (findings X2, X5 navigation part, X7 shortcuts, X12). Screenshots are in the same path without `.md`.

## What to build

All new code under `apps/desktop/src/navigation/` (components, pure logic, CSS, tests). Keep `PresentationShell.tsx` edits to the minimum mount points listed below.

1. **Global command palette (Ctrl+K; ⌘K on macOS)**, available in every domain and in Settings.
   - Listen on `window` `keydown` in the bubble phase. Do not open if `event.defaultPrevented` (Design's own palette handles Ctrl/⌘K while focus is inside Design and calls preventDefault — keep that working), or if an `[aria-modal="true"]` dialog is already open. Also open on a `window` CustomEvent `hq-open-command-palette` (other lanes will dispatch it from a top-bar button).
   - Modal combobox + listbox with correct ARIA (`role="dialog"` `aria-modal`, `role="combobox"`, `aria-activedescendant`, `role="listbox"`/`option`), focus trapped inside, Escape closes and returns focus to the previously focused element, ↑/↓/PageUp/PageDown/Home/End move, Enter runs, mouse hover highlights, click runs. Grouped results with group labels. Fuzzy-ish matching (word prefix + subsequence is enough), case-insensitive.
   - Commands:
     - Go to Design / Social / Work / Wiki.
     - Go to each domain's main sections. Derive valid destination strings from each module's own route code (read-only): Social `modules/social/nav/routes.ts` (`parseSocialDestination`), Work `modules/work/nav/routes.ts` (`parseWorkDestination`, `pageDestination`), Wiki `modules/wiki/ui/src/destinations.ts` + `modules/wiki/contract` (`formatDestination`), Design: find the destination format the Design composition accepts (look at `modules/design/app` / `modules/design/ui` and the existing `references.integration.test.tsx`/`preview-navigation.integration.test.tsx`). Only emit destinations those parsers accept; add a unit test that every emitted destination parses.
     - Settings: Data sources, Appearance, Updates (use the shell's existing `openSettings` target support; check `ServiceSettings.tsx` for how a category is selected; if Updates cannot be targeted without editing ServiceSettings, open Settings and leave Updates out rather than editing other owners' files).
     - Appearance: Light, Dark, Follow system.
     - "Show getting started" — dispatches `window` CustomEvent `hq-show-welcome` (another F7 builder implements the listener; just dispatch it).
     - "Back to <label>" when a reference return frame is active.
   - **Search across HQ**: when the query is ≥ 2 characters, also query `references.find(query, { projectId: context.id, limit: 20 })` (the shell's reference port; see `apps/desktop/src/references.ts`) debounced ~150 ms, cancelling stale queries. Show results grouped by domain with title and a human domain/kind label ("Work card", "Social draft", "Design …") — never raw entity IDs. Selecting a result calls `references.open(envelope, { label: <current location label>, to: { domain: state.domain, destination: state.destinations[state.domain] } })` so the existing return frame and Back work. Also offer "Search Wiki for “<query>”" which navigates to the Wiki search destination for that query. Show a quiet inline "Searching…" row while pending and "No results" state; provider failures must not break the palette (inline note, no full error).
   - Motion: palette enter/exit with F1 `Presence` (scale/fade per tokens), result list without layout jank; zero movement under reduced motion.
   - Platform: detect macOS via `window.hqDesktop?.platform === 'darwin'` with a browser fallback (`navigator.platform`/`userAgentData`); show `⌘K` vs `Ctrl K` hints accordingly. Show each command's shortcut hint when one exists.
2. **Cross-module Back affordance.** Replace the shell's unstyled `{returnFrame && <button …>Back to …</button>}` with a compact `ReturnPill` ("← Back to <label>") placed at the top of the workspace without pushing the page layout around (it must not add a full-width bar; overlay or occupy an existing header band — inspect the screenshot `09-reference-back-button-unstyled.png`). It keeps the existing `goBack` behaviour. Keyboard: Alt+← on Windows/Linux and ⌘[ on macOS trigger Back only while the pill is shown, only when the event is not `defaultPrevented` (Work uses Alt+←/→ on focused cards and calls preventDefault — verify this in `modules/work` and add a test that a prevented event does not trigger Back) and not from an editable field. Short enter motion (reduced-motion safe).
3. **Read-only reference notice.** Replace the unstyled `{referenceNotice && <section …>}` with F1's `InlineNotice` (tone `info`, `variant="bar"`, dismiss action), keeping `role="status"` semantics and the existing Dismiss behaviour.
4. **Global shortcuts** (one hook, e.g. `useShellShortcuts`): Ctrl/⌘+1..4 switch to Design, Social, Work, Wiki (same effect as clicking the rail: close settings, cancel reference open, clear return frame); Ctrl/⌘+, opens Settings. Ignore when `defaultPrevented`, when an `aria-modal` dialog is open, or with extra modifiers. Do not bind Alt+digits (Design uses Alt+1…5) or anything Design already uses (Ctrl+K inside Design, F6, Ctrl+\, Ctrl+Shift+\).
5. **Window title.** `document.title` tracks location: "Settings — HQ" while settings is open, otherwise "<Domain> — HQ" (e.g. "Work — HQ").

## PresentationShell.tsx mount points (keep the diff small — other lanes edit this file heavily)

- One import line for your module.
- Replace exactly the two existing lines that render `returnFrame` and `referenceNotice`.
- Call your hooks (shortcuts, title) on the lines just before `return <div className="shell"`.
- Mount the palette element immediately before `<ToastViewport />`.
- Pass what you need as props (state, navigate callback, openSettings, setAppearance, references, context, returnFrame/goBack). If you need a small callback that doesn't exist yet (e.g. `switchDomain(domain)` identical to the rail button's onClick), add it next to `goBack` and make the rail use it too only if that is a one-line change.

Do not edit: `packages/contracts`, root `package.json`/lockfile/tsconfig/vite/vitest config, `modules/**`, `packages/hq-ui/**` (F1 owns it — if a primitive is missing, write the smallest local version in your directory and note it in the PR), `ServiceSettings.tsx`, `settings/**`, `Connections.tsx`. No new npm dependencies.

## Checks (meaningful, focused)

- Unit tests for pure logic (matching/ranking, destination emission parses with each module's own parser, shortcut resolution incl. defaultPrevented/editable/modal guards, platform hints).
- Component/integration tests with the existing Vitest + happy-dom + Testing Library setup (see `apps/desktop/src/App.settings.test.tsx`, `references.integration.test.tsx` for how `App`/`PresentationShell` are rendered with fixture modules): palette opens with Ctrl+K in Social/Work/Wiki/Settings, does not open over Design's handled event, Escape restores focus, a command navigates, a search result opens via the reference port and Back returns, Ctrl+2 switches domain, title updates.
- Run `npm run typecheck`, `npx vitest run apps/desktop` (run `npm run build:electron` once first), then `npm run build`. Before any test/build command, check host load (`uptime`; do not start tests if the 1-minute load is above 13 on this 16-core host) and run one test process at a time. Never weaken, skip or delete existing tests; if an existing test breaks, fix your code or explain precisely why the test's expectation must change.
- Real-app evidence: build, then drive the real Electron app with the F7 driver (same host):
  - Install the Electron binary once in your checkout: `mkdir -p /tmp/<your-branch-name>/ec && electron_config_cache=/tmp/<your-branch-name>/ec node node_modules/electron/install.js`
  - `node /tmp/hq-f7-eval/driver/drive.mjs <your checkout absolute path> <unique-label> example` (run in background; it prints READY), scenarios: `example` (no services), `dead` (unreachable), `live` (real local Planner). Control with `/tmp/hq-f7-eval/driver/c <label> <route> '<json>'`; routes: `window {"width","height"}`, `shot {"name"}` (PNG under /tmp/hq-f7-eval/evidence/<label>/), `key {"key","mods":["ctrl"|"meta"|"alt"|"shift"]}`, `type {"text"}`, `click {"text","selector","exact":false,"nth"}`, `eval {"expr"}`, `media {"features":[{"name":"prefers-reduced-motion","value":"reduce"}]}`, `errors`, `quit`. Always `quit` your runs when done. Use a label starting with `b1-`.
  - Capture before/after PNGs: palette in Social, Work, Wiki, Design (Design palette unaffected), search results, Back pill after opening a result, notice bar, dark theme, 760×560 window, reduced motion. Look at your screenshots and fix what looks wrong. Copy the final set into `docs/design/hq-cross-app-flow-assessment-20261103/b1/` (synthetic data only; no host paths visible).

## Delivery

- Coherent commits on your branch, messages ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Push and open a **non-draft** PR against `work/hq-foundation` titled "HQ life F7-B1: global command palette, cross-HQ search and cross-module navigation". Body: what/why mapped to findings X2/X5/X7/X12, screenshots (relative links to the committed PNGs), exact check commands and results (with counts), what is not verified (native macOS, screen readers), and a note that the branch includes F1's base commit(s) from `work/hq-life-system-20261103` (list SHAs) so reviewers should review only the F7-B1 commits. End the body with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- Link the PR to your thread with `link_pull_request`. Do not call `watch_pull_request` (your parent owns the watch). Do not merge, deploy, install or restart anything; never install/update/restart Jones Code. No automated review bots.
- Final message: what was built, files, check results, screenshot paths, known gaps. Last line exactly: `PR <full URL>, head <SHA>, checks and reviews <state>`.

You are a builder for HQ lane F7 (cross-app user flows). Implement F7-B2 "first-run welcome and getting-started guidance" in the HQ desktop shell. Work only in the checkout you were given; you are its sole Git owner. Do not start subagents.

## Context

HQ (public repo Jones-Systems/HQ) is one Electron + React 19 + TypeScript + Vite desktop app with domains Design, Social, Work and Wiki. The shell is `apps/desktop/src/PresentationShell.tsx` (rail with "Data sources" status, settings overlay, module mount). Modules live in `modules/*` and are owned by other lanes — do not edit them. Your checkout starts from `work/hq-life-system-20261103` (lane F1's motion/toast primitives on top of `work/hq-foundation`). Read `docs/design/hq-visual-system/motion-and-feedback.md` first and use its `Presence`, `InlineNotice`, `StatusIndicator`, `toast`, motion tokens and `--hq-*` design tokens from `@hq/ui`; also look at `docs/design/hq-visual-system/` mockups for the visual language. Do not invent parallel primitives.

Owner goal (M Jones): HQ should feel alive and natural — purposeful motion, natural flows, toasts + inline indicators, keyboard and accessibility first, always honour reduced motion. Inspiration: Linear's and Notion's getting-started checklists, Things 3's calm first run, Arc's welcome.

Read the F7 assessment: `git show origin/work/hq-life-flow-eval-20261103:docs/design/hq-cross-app-flow-assessment-20261103.md` — finding X1. Today a new user lands on Design › Projects (dense form, "No projects match these filters") with nothing explaining the four domains, that Social/Work show sample data kept only for this session, that the Wiki needs a local repository, or what to do first. Screenshot: `docs/design/hq-cross-app-flow-assessment-20261103/01-first-launch.png` on that branch.

## What to build

All new code under `apps/desktop/src/onboarding/` (components, pure logic, CSS, tests). Keep `PresentationShell.tsx` edits to the mount points listed below.

1. **Getting-started panel** — a calm, **non-modal** floating card anchored to the bottom-left of the workspace area (F1's toasts live bottom-right; never overlap the rail or the footer). It must not block interaction with the rest of the app, must not trap focus, and must not use `aria-modal` (existing integration tests and the native acceptance harness drive the app on fresh profiles and must keep passing unchanged).
   - Header: "Welcome to HQ" with one line: "Design, Social, Work and Wiki in one place. Here's how to get set up."
   - Four compact domain rows (reuse the rail's domain SVG icons by extracting nothing — copy the four small SVG paths into your component, they are 1–2 paths each), each: name, one-line purpose, and live status from the shell's data-source state (`apps/desktop/src/settings/DataSources.tsx` provider/hook and `apps/desktop/src/services/data-source-status.ts`): e.g. Social/Work "Sample data · set up to use your own", "Connected", "Unreachable"; Wiki "Not set up" / "Ready"; Design "Local, on this device".
   - A short checklist (3–5 items) with done-state derived from real state where it exists (configured data sources) and from local dismissal flags otherwise:
     - "Take a look around with sample data" → navigates to Social overview (then Work board); done once both domains have been visited this profile.
     - "Connect Work (Planner)" → opens Settings › Data sources with target `work` (dispatch the existing `window` CustomEvent `hq-open-settings` with `detail: { source: 'work' }`).
     - "Connect Social" → same with `social`.
     - "Add a Wiki repository" → same with `wiki`.
     - "Jump anywhere with ⌘K / Ctrl K" → dispatches `window` CustomEvent `hq-open-command-palette` (another F7 builder implements the palette; just dispatch). Done after first use (listen for the same event).
   - Progress "2 of 5" with a small progress bar; finishing everything shows a brief "You're all set" state then auto-collapses.
   - Collapse to a small pill ("Getting started · 2/5") that stays bottom-left; expand again on click. "Hide" removes it; a toast (F1 `toast`, neutral) confirms "Getting started hidden — reopen it from ⌘K › Show getting started" with an Undo action.
   - Reopen when a `window` CustomEvent `hq-show-welcome` is dispatched (the palette dispatches it).
   - Persistence: a versioned localStorage key (e.g. `hq.onboarding.v1`) storing `{ state: 'open'|'collapsed'|'hidden', visited: {...}, used: {...} }`, parsed defensively like `apps/desktop/src/state.ts` (malformed → defaults). Storage failures must not break the shell (session-only fallback, same as the rest of the shell). First launch = key absent → open. Do not show again after "Hide" unless reopened.
   - Motion: enter with F1 `Presence` (rise/scale), checklist item completion gets a small check animation and `hq-flash`; collapse/expand animates height (F1 `collapse`). Everything instant under reduced motion. Keyboard: all controls reachable by Tab in a sensible order; Escape collapses the panel when focus is inside it; visible focus rings; headings and list semantics; polite live-region announcement when an item completes.
   - Dark and light themes via tokens only; looks right at 760×560 (collapse automatically to the pill when the workspace is narrower than ~900px).
2. **Not in scope:** module-internal empty states (Design Projects, Wiki not-set-up page, Social/Work views) — other lanes own them. The command palette — another builder. Settings UI — F6 owns it; only dispatch the existing event.

## PresentationShell.tsx mount points (keep the diff small — other lanes edit this file heavily)

- One import line for your module.
- Mount your component on a new line between `</main>` and `{settingsOpen && <ServiceSettings`. Hide it (do not unmount state) while settings is open. Pass what you need as props: a `navigate(domain, destination)` callback (the same state update the rail uses), current domain, `storage` port, `settingsOpen`. If a shared callback is missing, add it right after `goBack` only if it is a one-line change.

Do not edit: `packages/contracts`, root `package.json`/lockfile/tsconfig/vite/vitest config, `modules/**`, `packages/hq-ui/**` (F1 owns it — if a primitive is missing, write the smallest local version and note it in the PR), `ServiceSettings.tsx`, `settings/**`, `Connections.tsx`. No new npm dependencies.

## Checks

- Unit tests for the pure state (parse/serialize, defaults on malformed storage, checklist derivation from data-source states, visited/used tracking).
- Component tests (Vitest + happy-dom + Testing Library; see `apps/desktop/src/App.settings.test.tsx` for rendering `App`): first render shows the panel; Hide persists and a toast offers Undo; `hq-show-welcome` reopens; checklist "Connect Work" dispatches `hq-open-settings` with `work`; configured data source marks the item done; collapsed pill expands; Escape collapses; existing App tests still pass unchanged.
- Run `npm run typecheck`, `npx vitest run apps/desktop` (run `npm run build:electron` once first), then `npm run build`. Before any test/build command check host load (`uptime`; do not start if the 1-minute load is above 13 on this 16-core host); one test process at a time. Never weaken, skip or delete existing tests.
- Real-app evidence: build, then drive the real Electron app with the F7 driver (same host):
  - Install the Electron binary once in your checkout: `mkdir -p /tmp/<your-branch-name>/ec && electron_config_cache=/tmp/<your-branch-name>/ec node node_modules/electron/install.js`
  - `node /tmp/hq-f7-eval/driver/drive.mjs <your checkout absolute path> <unique-label> example` (background; prints READY). Scenarios: `example` (no services, first launch), `dead` (configured but unreachable), `live` (real local Planner). Control with `/tmp/hq-f7-eval/driver/c <label> <route> '<json>'`; routes: `window {"width","height"}`, `shot {"name"}` (PNG under /tmp/hq-f7-eval/evidence/<label>/), `key {"key","mods":[...]}`, `type {"text"}`, `click {"text","selector","exact":false,"nth"}`, `eval {"expr"}`, `media {"features":[{"name":"prefers-reduced-motion","value":"reduce"}]}`, `restart` (relaunch with the same profile — use it to prove persistence), `errors`, `quit`. Always `quit` your runs. Use labels starting with `b2-`.
  - Capture: first launch light + dark, collapsed pill, after Hide (toast), reopened, `dead` scenario statuses, 760×560, reduced motion. Look at the screenshots and fix what looks wrong. Copy the final set into `docs/design/hq-cross-app-flow-assessment-20261103/b2/` (synthetic data only; no host paths visible).

## Delivery

- Coherent commits, messages ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Push and open a **non-draft** PR against `work/hq-foundation` titled "HQ life F7-B2: first-run welcome and getting-started guidance". Body: what/why (finding X1), screenshots (relative links to committed PNGs), exact check commands and results with counts, what is not verified, and a note that the branch includes F1's base commit(s) from `work/hq-life-system-20261103` (list SHAs) so reviewers review only the F7-B2 commits. End the body with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- Link the PR with `link_pull_request`. Do not call `watch_pull_request` (your parent owns the watch). Do not merge, deploy, install or restart anything; never install/update/restart Jones Code. No automated review bots.
- Final message: what was built, files, check results, screenshot paths, known gaps. Last line exactly: `PR <full URL>, head <SHA>, checks and reviews <state>`.

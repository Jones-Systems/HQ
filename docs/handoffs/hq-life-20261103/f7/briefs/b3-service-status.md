You are a builder for HQ lane F7 (cross-app user flows). Implement F7-B3 "one observed service status across HQ" (assessment finding X3) in the HQ desktop shell. Work only in the checkout you were given; you are its sole Git owner. Do not start subagents.

## Context

HQ (public repo Jones-Systems/HQ) is one Electron + React 19 + TypeScript + Vite desktop app with domains Design, Social, Work and Wiki. Your checkout starts from `work/hq-life-system-20261103` (lane F1's motion/toast primitives on top of `work/hq-foundation`). Read `docs/design/hq-visual-system/motion-and-feedback.md` and use F1's `toast`/`useToast`, `StatusIndicator`, `InlineNotice`, `Presence`, tokens from `@hq/ui`. Status words must match lane F6's Settings vocabulary (`git show origin/work/hq-life-wiki-settings-20261103:docs/design/settings/hq-settings-design-20261103.md`, "Status chip"): Ready, Stale, Indexing, Not set up, Unavailable, Checking…, Reachable, Unreachable, Sample data, Set up · not checked, Address rejected, Not qualified. Never show raw enums as primary text.

Owner goal (M Jones): HQ should feel alive and truthful — toasts plus inline indicators instead of full-screen errors, keyboard and accessibility first, reduced motion honoured. Read the F7 assessment, finding X3, and the screenshots `07-status-disagreement.png` and `08-work-offline-inline-model.png`: `git show origin/work/hq-life-flow-eval-20261103:docs/design/hq-cross-app-flow-assessment-20261103.md`.

### The problem (observed on the real Electron app)

Three places report the same service and disagree:
- The domain banner (`Surface` in `apps/desktop/src/services/domains.tsx`) is built from configuration only. It reads "Work: Set up · not checked." while the Planner is live and serving data, and still reads that while the module shows "Planner service unreachable".
- The rail's Data sources list (`apps/desktop/src/Connections.tsx`, fed by `DataSourcesProvider` in `apps/desktop/src/settings/DataSources.tsx` and `apps/desktop/src/services/data-source-status.ts`) says "Set up · not checked" until someone presses ↻; then it says "Unreachable" while the banner still says "not checked".
- The Work module itself correctly shows "Offline · last synced … · changes paused". After the Planner recovers, nothing tells the user in other domains.

## What to build

1. **Observed status in the existing provider (additive API only).** Lane F6 consumes `useDataSources()` as it is: keep `statuses`, `busy`, `check`, `reload` and `SourceStatus { text, tone }` working unchanged. Add fields and functions only, for example: `SourceStatus.kind` (a machine-readable state), `observedAt`, and `lastReachableAt`, plus `report(source, outcome)`. Configured services move between `Set up · not checked` → `Checking…` → `Reachable` / `Unreachable`. Unconfigured ones stay `Sample data`, and invalid addresses stay `Address rejected`.
2. **Observe real outcomes at the shell boundary, with no module edits.** In `createServiceDomains` (`services/domains.tsx`), wrap the Social and Work transports passed to the modules so that every call result is reported. `{ ok: true }` means reachable. `{ ok: false, kind: 'unavailable' }` or a thrown error means unreachable. Treat `{ ok: false, kind: 'unknown' }` as not proving reachability either way. Wrap the same transports in `apps/desktop/src/reference-providers.ts` only if it is a one-line change. Debounce state flips so that one failed call during a flurry doesn't flicker. Work already polls `version` about every 20 s (see `modules/work/live/adapter.ts`), so a live session converges without any extra traffic.
3. **A quiet check at launch.** Once, after startup, run `check()` for each configured Social/Work service whose status is still `Set up · not checked`, using the existing read-only routes (Social `workspace`, Work `version`). Repeat when the window regains focus or comes back online, at most once per 60 s per source. Never send a mutation. Never contact an unconfigured service.
4. **Replace the domain banner with a compact status line.** It should take less height than today and read like F6's chips (shape + word + small meta):
   - "● Reachable · synced just now" (relative time from `observedAt`, refreshed every 30 s);
   - "▲ Unreachable · last reached 14:02 · Retry" (Retry calls `check`);
   - "○ Sample data · Set up" (opens Settings for that source, as today);
   - "Checking…" with a reduced-motion-safe busy indicator.
   Keep the Settings/Set up action and its accessible name stable. The existing tests and the native acceptance harness look for "Social service"/"Work service" regions and the Set up/Settings buttons, so keep those regions and labels. Use F1 `StatusIndicator` where it fits.
5. **Transition toasts.**
   - When a configured service goes from Reachable to Unreachable after the first observation of the session: `toast` warning, id `service-<source>`, "Work is unreachable", description "Showing the last snapshot. Changes are paused." with a Retry action.
   - When it comes back: `toast.success` "Work is back online", reusing the same id so it replaces the warning.
   - No toast for the first observation at launch. No repeats while the state is unchanged.
   - These live in or next to the provider, so `PresentationShell.tsx` needs no change. If one mount line is truly needed, put it immediately before `<ToastViewport />` and say so in the PR.
6. **The rail keeps working through `useDataSources()`.** Don't restyle `Connections.tsx`; lane F1 is redesigning the rail. A one-line change to show the new meta (such as `title` text) is allowed if useful.

Do not edit: `packages/contracts`, the root `package.json`, lockfile, tsconfig, vite or vitest config, `modules/**`, `packages/hq-ui/**`, `ServiceSettings.tsx`, `settings/ProjectSources.tsx`, `settings/Updates.tsx`, or the rail markup beyond the allowance above. Add no new npm dependencies. Other F7 builders are working in `apps/desktop/src/navigation/` and `apps/desktop/src/onboarding/`; don't touch those.

## Checks

- **Unit tests** for the pure state machine: transitions, debounce, ignoring `unknown`, the launch-check rate limit, no check for an unconfigured service, and toast rules (no toast on first observation, warning then success with one id, no repeats).
- **Component tests** (Vitest + happy-dom + Testing Library; follow `apps/desktop/src/live-services.integration.test.tsx`, `Connections.test.tsx` and `ServiceSettings.test.tsx`):
  - A live fake transport makes the banner and the rail both say Reachable.
  - A failing transport makes both say Unreachable, and Retry calls the check.
  - Recovery produces exactly one success toast.
  - Existing tests still pass. Never weaken, skip or delete an existing test. If an expectation legitimately changes because status is now observed, change only that expectation and explain why in the PR.
- **Commands.** Run `npm run typecheck`, then `npx vitest run apps/desktop` (run `npm run build:electron` once first), then `npm run build`. Before each test or build command, check host load (`uptime`; don't start if the 1-minute load is above 13 on this 16-core host), and run one test process at a time.
- **Real-app evidence.** Build, then drive the real Electron app with the F7 driver on this host:
  - Install the Electron binary once in your checkout: `mkdir -p /tmp/<your-branch-name>/ec && electron_config_cache=/tmp/<your-branch-name>/ec node node_modules/electron/install.js`
  - Start a run: `node /tmp/hq-f7-eval/driver/drive.mjs <your checkout absolute path> <unique-label> live` (in the background; it prints READY). The `live` scenario runs the repository's real local Planner behind a proxy you can switch with `/tmp/hq-f7-eval/driver/c <label> svc '{"down":true}'` and `'{"down":false}'`, plus a read-only, empty Social fixture. The `dead` scenario configures both services to a closed port. The `example` scenario configures nothing.
  - Control with `/tmp/hq-f7-eval/driver/c <label> <route> '<json>'`. Routes: `window {"width","height"}`, `shot {"name"}` (PNG under /tmp/hq-f7-eval/evidence/<label>/), `key`, `type`, `click {"text","selector","exact":false,"nth"}`, `eval {"expr"}`, `media`, `ledger` (request ledger; confirm no non-GET requests from your checks), `errors`, `restart`, `quit`. Always `quit` your runs. Use labels starting with `b3-`.
  - Capture: live Reachable in the Work banner and rail; Social banner; service dropped while in Social (toast) and while in Work; recovered (toast); `dead` scenario at launch; `example` scenario; dark theme. Look at your screenshots and fix what looks wrong. Copy the final set into `docs/design/hq-cross-app-flow-assessment-20261103/b3/`, with synthetic data only and no host paths visible.

## Delivery

- Make coherent commits. End each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Push and open a **non-draft** PR against `work/hq-foundation`, titled "HQ life F7-B3: one observed service status across rail, banner and toasts". The body covers:
  - what and why (X3);
  - screenshots, as relative links to the committed PNGs;
  - the exact check commands and their results, with counts;
  - the request ledger evidence that checks are GET-only;
  - what is not verified;
  - a note that the branch includes F1's base commits from `work/hq-life-system-20261103` (list the SHAs), so reviewers should review only the F7-B3 commits.
  End the body with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- Link the PR with `link_pull_request`. Don't call `watch_pull_request`; your parent owns the watch. Don't merge, deploy, install or restart anything, and never install, update or restart Jones Code. No automated review bots.
- In your final message, cover what was built, the files, check results, screenshot paths and known gaps. The last line must be exactly: `PR <full URL>, head <SHA>, checks and reviews <state>`.

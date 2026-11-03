# Handoff: lane F6 (HQ Wiki module and app Settings), 2026-11-03

Authority effect: none. This handoff was written on the owner's pause request. The lane lead is Opus 5.5 and the
builders are Sonnet 5.5 at xhigh effort, run as T3 delegated tasks. Nothing from this lane is merged into
`work/hq-foundation` or `main`, no PR is open, and nothing was deployed, installed or restarted.

## Status in three lines

- **Done:** the flow assessment with before evidence; the Settings and Wiki designs; lane F1's primitives merged
  in; and the shared Wiki base (cache, session, feedback pieces, host affordances, static-test evolution).
- **In progress (paused):** builders S1 (Settings, close to complete), W1 (Wiki chrome, search, home, history) and W2
  (Wiki reader, previews, topics). Each has its own handoff, linked below.
- **Not started:** lead review and fix rounds, integration, consolidated after evidence, full checks, and the two PRs
  against `work/hq-foundation`.

## Branches and worktrees

All branches are on `origin` (github.com/Jones-Systems/HQ).

| Branch | Role | Head | Worktree | Handoff |
| --- | --- | --- | --- | --- |
| `work/hq-life-wiki-settings-20261103` | Lane branch: docs, evidence, F1 merge, Wiki base | see the commit carrying this file | `~/.t3/worktrees/HQ/work-hq-life-wiki-settings-20261103` | this file |
| `work/hq-life-settings-20261103` | S1: Settings redesign (base `4cdb7a7`) | `bf0822b` at pause time; see its handoff for the final head | `~/.t3/worktrees/HQ/work-hq-life-settings-20261103` | [`f6-wiki-settings/hq-life-settings-20261103.md`](f6-wiki-settings/hq-life-settings-20261103.md) on that branch |
| `work/hq-life-wiki-w1-20261103` | W1: Wiki chrome, search, home, history (base `d2711c7`) | not pushed at pause time; see its handoff | `~/.t3/worktrees/HQ/work-hq-life-wiki-w1-20261103` | [`f6-wiki-settings/hq-life-wiki-w1-20261103.md`](f6-wiki-settings/hq-life-wiki-w1-20261103.md) on that branch |
| `work/hq-life-wiki-w2-20261103` | W2: Wiki reader, links, previews, topics (base `d2711c7`) | local `f6a773d` at pause time, not yet pushed; see its handoff | `~/.t3/worktrees/HQ/work-hq-life-wiki-w2-20261103` | [`f6-wiki-settings/hq-life-wiki-w2-20261103.md`](f6-wiki-settings/hq-life-wiki-w2-20261103.md) on that branch |
| `work/hq-life-wiki-w3-20261103` | W3: Wiki reference provider. **Cancelled:** lane B5 owns this | `dbdd5bb` (4 commits, pushed before the cancel took effect) | `~/.t3/worktrees/HQ/work-hq-life-wiki-w3-20261103` | none (cancelled); see "W3" below |

Each sub-handoff path is relative to `docs/handoffs/hq-life-20261103/` on that builder's own branch.

### Lane branch commits (on top of `work/hq-foundation` `0cd50ab`)

| Commit | What |
| --- | --- |
| `06d4910` | Flow assessment (`modules/wiki/ui/flow-assessment-20261103.md`), 20 before screenshots, Settings design |
| `ec3e6ea` | Merge of lane F1 `work/hq-life-system-20261103` @ `284393d` (motion tokens, toasts, inline feedback in `@hq/ui`) |
| `4cdb7a7` | Settings design pointed at the F1 APIs |
| `d2711c7` | Shared Wiki base and Wiki design spec (`modules/wiki/ui/design-20261103.md`) |
| `fdf3c04` | Design records that B5 owns the reference provider and its optional graph context |

## What the lead built (lane branch)

- **Assessment and designs.**
  - `modules/wiki/ui/flow-assessment-20261103.md`: Wiki findings WF-1 to WF-12 and Settings findings SF-1 to SF-7.
    Evidence is in `modules/wiki/ui/evidence/before-20261103/` (README plus 20 PNGs).
  - `docs/design/settings/hq-settings-design-20261103.md`.
  - `modules/wiki/ui/design-20261103.md`.
- **Wiki base** (`modules/wiki/ui/src/`):
  - `cache.ts`: session response cache with dedupe and LRU.
  - `load.ts`: `useResource`, which shows a cached value at once, refreshes after 60 s, keeps the last good value on
    failure, and has `retry`.
  - `resources.ts`: one descriptor per read.
  - `session.ts`: history, recent pages, filter and scroll state that survive domain remounts.
  - `feedback.ts`: `Notice`, `ErrorNotice`, `StatusChip`, `Skeleton`, `Kbd`.
  - `icons.ts`; `format.ts` helpers (`errorRecovery`, `pageName`, `folderParts`, `relativeTime`); a history
    `replace` action.
  - `view.ts`: wiring for the optional host affordances (`toast`, `openSettings`), guarded so a host failure never
    breaks the view.
  - The stylesheet is split into `wiki-view.css` (base) plus area files `wiki-chrome/home/reader/search/topics.css`.
- **Static tests extended, never weakened.** They now cover every `wiki-*.css` file (scoping), `@keyframes wiki-*`,
  `@media`/`@supports`/`@container`/`@starting-style` with their contents still checked, token-only motion timing,
  and the entry's stylesheet list.
- **New tests.** `ui/test/base.test.ts` (10 tests). `ui/test/support.ts` `launch()` accepts `affordances` and `View`.
- **Shell touch** (isolated; lane F1 informed). In `apps/desktop/src/modules.tsx`, `createWikiDomain` receives
  `toast` from `@hq/ui`, and `openSettings` dispatches the existing `hq-open-settings` event with `source: 'wiki'`.
- **Checks at `d2711c7`.** The host was at about 59% CPU when sampled before these runs.

  | Command | Result |
  | --- | --- |
  | `cd modules/wiki && npm test` | 528/528 before the 10 base tests were added; those 10 pass in isolation; full rerun pending |
  | `npx tsc -p modules/wiki/tsconfig.json --noEmit` | clean |
  | Root `npx tsc --noEmit` | clean |
  | `npx vitest run --project dom apps/desktop/src/wiki.integration.test.tsx apps/desktop/src/App.settings.test.tsx` | 11/11 |
  | Full root `npm run typecheck` | not run |
  | Full `vitest run` | not run |

## Decisions and why

- **Wiki shortcuts.** The Wiki does not bind ⌘K, because lane F7 is building a cross-HQ ⌘K palette. In-Wiki search
  is a top-bar combobox with search as you type, focused with `/`.
- **Toasts reach the Wiki by injection.** The Wiki cannot import `@hq/ui`: its tests run under `node:test`, and
  `@hq/ui` is TSX with CSS imports. So `toast` and `openSettings` are injected structurally from the shell's
  composition root. The Wiki ships local feedback pieces that mirror F1's look through tokens.
- **Errors stay in place.** Inline notices replace full-screen error panels, and what already loaded is kept. Toasts
  are used only for one-off events: once per outage while showing cached content, recovery, and a retry that fails
  again.
- **History survives domain switches.** It lives in a per-view session, because the shell remounts a domain on
  switch.
- **Revision history and diffs: none.** The contract has no revision API, and the specification defines Wiki history
  as in-session navigation. A revision API would change the closed seven-method contract, so it needs an owner
  decision. Lane B5 documents a proposal only.
- **Settings uses F1 directly.** It imports `useAsyncAction`, `StatusIndicator`, `InlineNotice` inside
  `Presence collapse`, toasts, `Skeleton` and `hq-flash`. No Settings-local toast system.
- **Ownership splits to avoid conflicts.**
  - S1 does not edit `settings/DataSources.tsx`, `services/**`, the shell or the rail. Lane F7 owns the unified
    status store (X3).
  - W1 and W2 own disjoint files. The base files are lead-only.

## Coordination state

| Lane | State |
| --- | --- |
| F1 (`work/hq-life-system-20261103`) | Primitives `284393d` merged into the lane branch. F1 was told about the `modules.tsx` touch. Any F6 PR will contain `284393d` until F1's work lands |
| F7 (PR #185, `work/hq-life-flow-eval-20261103`) | X3 (status sources disagree) is F7's. F6 takes X4 and X14 in the Wiki and X16 in Settings. X9 moved to B5. ⌘K is F7's |
| B5 | Owns the Wiki reference provider (`work/hq-b5-wiki-references-20261103`). Optional contract additions are on `work/hq-b5-wiki-graph-context-20261103`: `BacklinkEntry.excerpt`/`via` and `Topic.pageTitles`. Adopt them after B5's review; W2 keeps one helper each so the switch is local. `wikiAdmin.status` answers immediately while indexing |

### W3 (cancelled)

B5 told me it had been building the provider since about 14:10, so I cancelled W3. Before the cancel took effect,
W3 had pushed `work/hq-life-wiki-w3-20261103` @ `dbdd5bb`:

- the provider (`modules/wiki/app/src/references.ts`) and its tests;
- the registration and an integration test;
- a README section;
- evidence in `modules/wiki/ui/evidence/after-20261103/w3/`.

B5 has been told, with a correction to my first message, which wrongly said it had pushed nothing. The branch is
unreviewed and must not be merged by F6. B5 keeps whichever implementation is further along.

## What's left, in priority order

1. **Collect the three handoffs** (S1, W1, W2) and check that each branch is pushed with its WIP. If a builder did
   not respond, its worktree path is in the table above; inspect `git status` there before touching anything.
2. **Review S1** against the Settings design.
   - Look at the screenshots in `docs/design/settings/evidence/after-20261103/` on its branch.
   - Check every changed test assertion against the rule: never weakened.
   - Send fix rounds with `t3_task_continue`, or start a fresh builder from its handoff.
   - Then open PR B (Settings): head `work/hq-life-settings-20261103`, base `work/hq-foundation`, with
     before/after screenshots.
3. **Finish W1 and W2** from their handoffs. Merge both into the lane branch; their files are disjoint, and the only
   shared touch point is `view.ts`, which calls the `ReaderView`/`TopicsView` signatures. Then re-run everything.
4. **Consolidate after evidence** from the real renderer. Use the scratch harness, described below, or recreate it.
   Capture light and dark at 1280×820, plus narrow widths and reduced motion.
5. **Full checks.** Take a CPU sample first.
   - Root `npm run typecheck`.
   - `cd modules/wiki && npm test`.
   - `npx vitest run apps/desktop packages/hq-ui`.
   - Record exact counts.
6. **Open PR A (Wiki and lane docs)** against `work/hq-foundation`. Then `link_pull_request` and
   `watch_pull_request` for both PRs. Do not merge.
7. **Follow-ups once B5 has reviewed its W4a additions:** switch backlink context to `excerpt` and topic rows to
   `pageTitles`. Then merge B5's provider when B5 delivers it.

## Open questions and risks

- **F1 dependency.** The PRs depend on F1's `284393d`. If F1 changes the primitives' API before landing, the
  Settings code must follow. F1 promised additive changes only.
- **X3 overlap.** F7's X3 store touches `settings/DataSources.tsx` and `services/**`, next to S1's files. Expect a
  merge-order question for whichever lands second.
- **Unverified in Electron.** CSS anchor positioning (W2's previews), `<dialog>` and popover behaviour, and View
  Transitions (S1's theme switch) are untested in Electron's Chromium. The harness used headless Chrome 156.
- **CSP coverage.** The harness relaxes `style-src` for the Vite dev server, because Vite injects style elements in
  development. CSP safety therefore rests on the static tests (no `style` props, no style elements) and
  `modules/wiki/app/test/csp-build.test.ts`.
- **Fonts on this host.** The host has no system sans font, so harness captures pin Liberation Sans. F1's token font
  stack fixes this in the app.
- **Owner decision needed:** revision history and diffs for Wiki pages, a contract change.

## Exists outside the repository

- **Scratch harness** in `/tmp/hq-f6-harness/` on this host:
  - `vite.config.mjs`: serves the real renderer from a worktree (`HQ_WORKTREE`, `HQ_PORT`) with synthetic bridges.
  - `fakes.ts`: synthetic `hqServices`/`hqUpdates`. Parameters `?wiki=down|slow|none`, `?bridge=none`,
    `?updates=available`; the Liberation Sans pin is on unless `?font=host`.
  - `shoot.mjs`: CDP driver for headless Chrome, with click/hover/type/press/wait/scroll/shot/frames steps.
  - Step files for the before captures.

  It is kept out of the repository because it hard-codes host paths. The lane's dev server on port 5241 has been
  stopped. Raw before captures are in `/tmp/hq-f6-shots/before/`; the curated set is committed.
- **Thread-only.** Messages to and from F1, F7 and B5, all summarised above. Nothing else is uncommitted: the lane
  worktree was clean at pause time.

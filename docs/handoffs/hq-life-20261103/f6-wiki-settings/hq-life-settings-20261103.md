> Historical lane handoff. November 12 recovery supersedes current-status and next-action claims below. See [source recovery receipt](settings-recovery-20261112.md). Historical captures are excluded and prior test results do not qualify the recovered candidate.

# Handoff: F6 Settings redesign (S1 builder), 2026-11-03

Authority effect: none. A work record for the lane lead and for whoever resumes this lane.

## Status

**In progress for the lane; the builder work is done.** Implementation, tests, ui-map docs and evidence captures are complete and pushed. Nothing in the build is unfinished. What remains (below) is lead review, fix rounds and the PR. No PR is open.

## Location

- Branch: `work/hq-life-settings-20261103` (pushed to `origin`).
- Code head when this file was written: `bf0822ba5836faefdb254b2f10a3129c2e05a8fa`. This handoff lands in the next commit on the same branch; `git log -1` is the authority.
- Base: includes the F1 merge `ec3e6ea` (`origin/work/hq-life-system-20261103`, F1 primitives at `284393d`). Target for the PR: `work/hq-foundation`.
- Commit trail from the design commit `4cdb7a7`: `2f740af` shell and panels (WIP), `7d07ccc` tests, `8f1850d` Wiki/tile/transition tests, `81b6f3f` Projects, Updates and CSS guard tests, `08f2bb2` composition test, `73be63e` ui-map docs and Updates spacing, `bf0822b` evidence.

## What was built

Design: [HQ Settings design](../../../design/settings/hq-settings-design-20261103.md). Behaviour map: [settings-data-sources](../../../ui-map/settings-data-sources.md), [appearance](../../../ui-map/settings-appearance.md), [updates](../../../ui-map/settings-updates.md).

- **Shell** (`apps/desktop/src/ServiceSettings.tsx`): grouped category navigation (Data sources: Overview, Social & Work, Local Wiki, Projects & Jones; App: Appearance, Updates) with SVG icons, `aria-current="page"`, Arrow/Home/End keys and attention shapes. Each category change resets scroll, focuses the category heading and replays `hq-enter-rise`. Target mapping unchanged (`social`/`work` → Social & Work with the row highlighted, `wiki`, `appearance`, none → Overview). Ids `settings-social`, `settings-work`, `settings-wiki` kept.
- **Overview**, **Social & Work**, **Local Wiki** (setup guide, per-repository rows, 2-second indexing poll capped at 2 minutes), **Projects & Jones** and **Updates**, built on shared parts (`settings/parts.tsx`: `Panel`, `Row`, `Field`, `Disclosure`, `ActionButton`, `FailureNotice`) and one mutation guard (`settings/actions.ts`: `useSettingsActions` over `useAsyncAction`, toasts, row flash, inline failure bar).
- **Appearance**: Light/Dark/System tiles (radio group, arrow keys, drawn with real token colours, System shows "Following your device"), `document.startViewTransition` switch guarded for reduced motion, and the colour editor behind a "Customize colors" disclosure.

## Files changed

- **New in `apps/desktop/src/settings/`:** `parts.tsx`, `actions.ts`, `status.ts`, `categories.ts`, `project-status.ts`, `use-source-check.ts`, `Overview.tsx`, `ServicesPanel.tsx`, `WikiPanel.tsx`.
- **Rewritten or restyled:** `ServiceSettings.tsx`, `settings/settings.css`, `settings/ProjectSources.tsx`, `settings/Updates.tsx` (logic kept), `settings/updates.css`.
- **Appearance:** new `ThemeTiles.tsx`, `AppearancePanel.tsx`, `theme-switch.ts`, `generated-roles.ts`; edited `PaletteSettings.tsx` and `appearance.css`.
- **Tests:** new `settings/WikiPanel.test.tsx`, `appearance/ThemeTiles.test.tsx`, `appearance/theme-switch.test.tsx`, `settings/settings-css.test.ts`; edited `ServiceSettings.test.tsx` (rewritten), `settings/ProjectSources.test.tsx`, `settings/Updates.test.tsx`, `appearance/palette.app.test.tsx`, `App.settings.test.tsx`, `preview/composition.test.tsx`.
- **Docs:** new `docs/ui-map/settings-data-sources.md`; updated `settings-appearance.md` and `settings-updates.md`; evidence in `docs/design/settings/evidence/after-20261103/` (README plus 53 images).
- **Not touched:** `settings/DataSources.tsx`, `services/**` (F7), `PresentationShell.tsx`, `styles.css`, `Connections.tsx`, contracts, preload, Electron.

## Findings

| Finding | Disposition |
| --- | --- |
| SF-1 | Fixed: grouped navigation, Overview with one chip row per source plus Manage and Recheck all, one panel per subsystem. |
| SF-2 | Fixed: setup guide, display names with the namespace id secondary, `Set up…` / Reindex / Change repository… / Remove… (inline confirm) per row, results as toast plus inline bar on the row. |
| SF-3 | Fixed: stacked fields, plain-word statuses, unavailable actions stay focusable with a visible reason on hover and keyboard focus. |
| X16 | Fixed: Gallery label and Gallery base URL are stacked (`08a-form-gallery-*` evidence). |
| SF-4 | Fixed: scroll reset and heading focus on each category change, icons and status shapes in the navigation. |
| SF-5 | Fixed: busy button, success toast and row flash, failure toast stating what was kept, Retry only where repeating is safe, Check for an unconfirmed result. |
| SF-6 | Fixed inside Settings (tiles, view-transition crossfade). **Left:** the rail appearance button still cycles themes silently; `PresentationShell`, outside the cone. |
| SF-7 | Settings uses an SVG rotate icon. **Left:** the rail's ↻ glyph in `Connections.tsx`, outside the cone. |

## Changed test assertions

- **`Updates.test.tsx`:** download/cancel test now asserts `aria-disabled` instead of `.disabled`; the "Cancelling…" button is `aria-busy="true"` and a second click does not call `cancelDownload` again. Unconfirmed-result test: Check and Install are `aria-disabled="true"` described by "Refresh the update status first."; clicks do not call `check`. Unsupported-installation test: `aria-disabled` plus the reason "Updates aren’t available for this installation." and no `check` call. Four new toast tests (finished check, failed check with Retry, failed download without Retry, lost result with Check).
- **`ProjectSources.test.tsx`:** the existing test clicks "Enroll a gallery…" before filling the form. Six new tests (stacked labels, disclosure focus and Escape, single enrollment with toast, refused gallery, Jones reasons, missing bridges).
- **`palette.app.test.tsx`:** `openColors(settings)` helper clicks "Customize colors" in the three editor tests; Color theme group/button assertions became `radiogroup`/`radio`.
- **`App.settings.test.tsx`:** first test uses `await findAllByText(/unavailable/i)`; appearance test uses radio roles and `aria-checked`.
- **`ServiceSettings.test.tsx`** (rewritten, 18 tests): chip label "Sample data" (was "Sample data · not set up"); rejected-address copy is the regex `/Use an allowed address and save it successfully/`, expected twice; the "Service configuration is unavailable…" message is asserted under Social & Work; Wiki tests go through the setup guide ("Set up your first repository"), "Selected BusinessLessons: synthetic.git", `Remove BusinessLessons…` then "Remove source"; new tests for navigation keys, `aria-current`, heading focus, target mapping and highlight, Manage routing, Recheck all, busy/double activation, toasts, reasons.
- **`preview/composition.test.tsx`:** `toHaveLength(2)` on the unavailable message became: open Social & Work, expect at least one message and both Check connection buttons `aria-disabled`.
- **New test files:** `WikiPanel.test.tsx` (11, fake-timer poll start/stop/2-minute cap/unmount, busy, failure, skeleton, first-load failure, no-bridge reasons, guide), `ThemeTiles.test.tsx` (6), `theme-switch.test.tsx` (5, including `data-hq-motion="reduce"` and `prefers-reduced-motion`), `settings-css.test.ts` (4, token-only styling and CSP-safe source).

## Checks (run from the worktree root, 2026-11-03)

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npx vitest run apps/desktop` | 58 files, 434 tests passed |
| `npx vitest run --project dom apps/desktop/src` | 16 files, 131 passed |
| `npx vitest run --project node apps/desktop/src` | 8 files, 52 passed |

- Five `apps/desktop/electron/*` tests (design-host, emit-layout, r3-preload, update-preload, wiki-host) fail in a fresh worktree until `npm run build:electron` has produced the gitignored `apps/desktop/dist-electron/`. After the build they pass.
- `apps/desktop/electron/catalog-host.test.ts` ("preserves K3 partial completeness at 500 entries") timed out at 5000 ms twice (5.07 s and 5.09 s) while the host was heavily loaded (about 84% CPU, load average 30–50). It passed at the default timeout in 1.9–2.4 s on reruns and with `--testTimeout=30000`. It is outside this lane's files; treat it as a load-sensitive test, not a regression.

## Screenshots

[`docs/design/settings/evidence/after-20261103/`](../../../design/settings/evidence/after-20261103/README.md): every category, disclosure forms, busy, failure (inline plus toast), Wiki not set up and indexing, theme tiles, Customize colors, narrow (560 px), and three motion strips; light and dark where it applies. Synthetic data only; headless Chrome 156 against a scratch harness, not the installed app. Before images are the ones referenced in `modules/wiki/ui/flow-assessment-20261103.md` (`settings-01` to `settings-05`); this lane did not re-shoot them.

## Deviations from the design

- Header is `h1 "Settings"` plus the category as a crumb, not the category as the title (an existing App test requires `h1` focus on open). The category `h2` takes focus on category change.
- The disclosure is "Customize colors" (US spelling, matching existing app copy), not "Customize colours".
- The Updates checkboxes keep native `disabled` (`aria-disabled` does not stop a checkbox toggling). Updates buttons use reasoned `aria-disabled`.
- The recheck spinner's 900 ms period is a literal (F1 has no looping-animation token); under reduced motion it slows to 2.4 s rather than stopping.
- "Save source" is offered right after a profile import, before "Choose repository…" (previous behaviour kept).
- A rejected service address says the previous address was cleared, because the host clears it on an invalid `config.set`.
- Unavailable-reason tooltips can clip inside the collapsing disclosures; the reason stays exposed through `aria-describedby`.
- Minor polish not done: the "Change <domain> address" buttons differ in width (controls about 4 px off between the Social and Work rows); chips sit below the description on service and Wiki rows but inline on Overview and Jones rows.

## What's left, in priority order

1. **Lead review and fix rounds** on the screenshots and code. Likely nits: the two minor polish items above, tooltip clipping in disclosures, anything the lead sees in the dark captures.
2. **Resolve the F7 overlap** (see risks) before the PR merges.
3. **Open the PR against `work/hq-foundation`** (the lead opens it; this lane does not) with before and after screenshots. Do not add reviewer bots. Link the PR and watch it from the parent thread (subagents cannot).
4. **Recommendations for files outside this cone** (shell lane): a ⌘, shortcut to open Settings; replace the rail's ↻ glyph in `Connections.tsx` with the SVG icon; a toast on the rail appearance button so SF-6 is fully closed; collapse the rail on narrow windows (at 560 px the rail keeps its width and Settings gets about 400 px); add `settings-data-sources.md` to `docs/ui-map/README.md`; optionally expose a last-checked time from `useDataSources()` so Overview can say "checked N minutes ago". No `useDataSources()` field was required for this work.
5. **`dist-electron` in a fresh worktree:** run `npm run build:electron` (about 2 s; output is gitignored; `npm test` already runs it) before `npx vitest run apps/desktop`, or five Electron-host tests fail. Note the `catalog-host` timeout above so it is not mistaken for a regression.
6. **Native and Electron verification** (not done here): View Transitions in the Electron build, real Wiki, source and Jones bridges, installed app.

## Open risks

- **F1 dependency on `284393d`.** Settings imports Toast (`useToast`, `ToastStoreProvider`), `Presence`, `useListMotion`, `Skeleton`, `useAsyncAction`, `InlineNotice`, `StatusIndicator`, `StateView`, `hq-enter-rise` and `hq-flash` from `@hq/ui`. They arrive through the merge `ec3e6ea` of `work/hq-life-system-20261103`. If F1 is not in `work/hq-foundation` first, the PR must stack on it or the build fails. The shell's single `ToastViewport` (in `PresentationShell.tsx`) must be mounted; tests wrap components in `ToastStoreProvider`.
- **F7 X3 status-store overlap, next to this lane's files.** F7 is building one observed-status store under `services/` and `settings/DataSources.tsx`, both off limits here. Settings consumes `useDataSources()` unchanged: `statuses` as `{text, tone}` with the current text strings (`status.ts` maps those raw strings to words and falls back to "Unavailable"-style handling for unknown ones), `check(source)` resolving after the status commits (`use-source-check.ts` waits for that commit), `busy`, `reload()`, and the `hq-connections-changed` event. If F7 changes the text values, the shape or the check timing, `status.ts`, `Overview.tsx`, `ServicesPanel.tsx`, `WikiPanel.tsx` and their tests need updating together. Reconcile when F7 lands.
- **View Transitions unverified in Electron.** `switchAppearance` is guarded (API present, motion allowed, try/catch falls back to an instant switch) and unit-tested with a mocked `startViewTransition`. Real crossfades were only seen in headless Chrome 156, with the harness relaxing CSP `style-src` for its own tooling; the Settings code sets no inline style attributes. Electron's Chromium version and its CSP behaviour with view transitions were not checked.
- All evidence uses synthetic fakes. Real native bridges, real Wiki repositories and credentials were not exercised.

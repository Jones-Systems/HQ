# HQ lane F5 handoff: Design Sources, Imports view

Paused by the owner mid-handoff. Written 2026-11-03.

## Where it stands against the brief

The brief (`imports.md` + `common.md`, kept under `/tmp/hq-f5-briefs/`, read-only) was built end to end and verified before the pause. Nothing was in flight when the stop arrived; the only work after the final report was copying evidence and writing this note.

| Brief item | State |
| --- | --- |
| Choose / Review / Done stepper using F1 `Presence` | Done |
| Drop-target-styled Choose card, supported types, calm unavailable state, no pretend drag and drop | Done |
| Review rows with `hq-stagger`, tone icon plus word (New, Updated, Unchanged, Conflict, Rejected) | Done |
| Conflict "Keep mine / Take incoming" segmented control | Done |
| Apply busy button ("Importing"), indeterminate bar, `StatusIndicator busy` | Done |
| Done summary | Done |
| F1 feedback: success toast with Undo, `InlineNotice` plus error toast for rejection, `toast.unknown` with Check, bottom message line removed | Done |
| History as a vertical timeline, relative time, exact time in `<time>` and tooltip, struck and labelled undone entries, Undo busy then toast | Done |
| Backup and export radio cards, inline private-draft confirmation, save-unavailable as a quiet notice, receipt card, Copy digest that survives a missing clipboard | Done |
| Header cross-link to References → Import screenshots via the References module's `nav` and `id` | Done |
| Responsive at 572px, calm two-column layout at 900px and up | Done |
| Existing tests stay green; new node tests for pure helpers in files the `imports` CI row claims | Done |
| Full repo test suite (`npm test` / vitest) | Not run (see Checks) |

## Branch, worktree, head

- Branch: `work/hq-life-design-sources-imports-20261103`, created from origin `work/hq-life-design-sources-20261103` at `f5d6bc8`.
- Worktree: `~/.t3/worktrees/HQ/work-hq-life-design-sources-imports-20261103`.
- Head before this handoff commit: `711b84c` (`WIP: Imports evidence screenshots`). Feature commits: `016c0a3` (rebuild as Choose/Review/Done with F1 feedback and motion) and `373a185` (withdraw stale toasts, hide repeated rejection text, test the new flow). The pushed tip is the "WIP: Imports handoff" commit on top of `711b84c`.
- No PR opened. Nothing merged.

Changed files (all in the owned paths, plus this handoff and the evidence stills):

- `modules/design/imports/src/controller.ts`: view state only (see decisions). Importer, bundle, mapper and contract code untouched.
- `modules/design/imports/src/ImportsPanel.ts`
- `modules/design/imports/src/imports.css`
- `modules/design/app/compose/views/ImportsView.tsx`
- `modules/design/imports/test/flow.test.ts` (19 tests, new)
- `modules/design/imports/test/panel-flow.test.ts` (14 tests, new)
- `docs/design/hq-visual-system/evidence/sources-20261103/wip/imports/` (6 stills)

## Decisions and why

- **Injected kit instead of importing `@hq/ui` in the panel.** `@hq/ui` pulls in CSS and extensionless TSX that plain `node --test` cannot load, and a type import breaks the imports tsconfig (no `jsx`). `ImportsPanel.ts` declares structural types (`ImportsKit` and the `Kit*` props) and `ImportsView.tsx` passes the real `Presence`, `InlineNotice`, `StatusIndicator`, `useToast`, `useListMotion`. A `PLAIN_KIT` (no motion, silent toasts) serves node tests. This also keeps `.ts` view files JSX-free and keeps sections from importing the app.
- **Truthful unknown outcomes.** `StorageConflictError` and `StoredSchemaError` are treated as definite refusals ("Nothing was changed", plan restored, re-applicable). Any other error thrown during a write is classified as unknown: an `unknown` toast with Check, which reconciles against the store and then publishes what actually landed. The risk of the opposite choice is telling someone nothing changed when it did.
- **Outcome events, not only state.** The controller publishes a structured `outcome` and also fires `onOutcome` listeners, so a toast is not lost when React batches two updates. `announceOutcome` owns toast ids (`imports-applied-<id>`, `imports-unknown-result`) so Undo withdraws its own toast and a successful Check withdraws the unknown one.
- **Existing `message` strings kept** in the controller because `controller.test.ts` and `panel.test.ts` pin them. Existing pinned markup (Choose button, class-free Create buttons, checkbox directly followed by its text, `aria-label="Import preview"`, `aria-label="Undo import from <iso>"`, the `<h2>`) is preserved; new styling for those elements hangs off `button:not([class])` rather than adding classes.
- **`aria-busy` instead of `disabled`** on busy actions so keyboard focus is not dropped mid-action. Focus moves to the new step heading (`tabIndex -1`, `data-step-heading`) on step change.
- **Stage panels share one grid cell** so the leaving and entering step cross over rather than stack; leaving panels are `pointer-events: none`.
- **`minBusyMs: 450` (display only), set in `ImportsView.tsx`.** Fast local writes would otherwise flash the busy state. Controller default is 0 so tests are unaffected. It never delays the write itself.
- **Indeterminate progress bar** is static under `prefers-reduced-motion` and `:root[data-hq-motion="reduce"]`; durations come from tokens; script-driven motion checks `useReducedMotion()`.
- **No hardcoded nav in the cross-link.** `ImportsView.tsx` navigates with the References module's own `nav` and `id`.

## Findings

- Plain-node renderability of F1 primitives is the main friction. A node-safe subpath export from `@hq/ui` would remove the kit indirection.
- `Presence` unmounts content while it animates out, so the panel keeps the last notice text itself (`useHeld`) to avoid an empty flash.
- There is no segmented-control or radio-card primitive in `@hq/ui`; both are styled locally from tokens. Worth proposing to F1.
- The dev server has no favicon, so the browser logs one 404 per page load for `/favicon.ico`. It is outside this lane's paths and harmless.
- Mutation check: temporarily breaking the unknown-outcome path made the new tests fail, so they are meaningful; the source was restored.

## What is left, in priority order

1. **Integrate and review.** Nothing blocks a PR from this branch; the owner paused before one was requested. When allowed: open the PR against `work/hq-life-design-sources-20261103`, and confirm no overlap with other F5 views (this branch touches only `ImportsView.tsx` in the composed layer).
2. **Run the wider suite** (`npm test`, which builds the Electron bundle and runs vitest) when CPU allows. Only the targeted node tests and the TypeScript projects were run.
3. **Real-host spot check.** Everything was exercised in a browser dev server on the design app, against the example workspace plus a fault-injection harness. A pass in the desktop host (Electron CSP: `style-src 'self'`, no `blob:`) would confirm nothing relies on inline styles; none was added, but it was not run in Electron.
4. **Optional: promote the browser flow scripts** to committed tests if the repo wants browser coverage. They live in `/tmp` (see below) and use a Playwright install from another checkout, so they are not portable as they are.
5. **Optional polish** if the owner wants it: the 900px two-column layout is verified at 1680 and in a 960 harness but not at every width in between.

## Open questions and risks

- If the importer can throw other definite-refusal error classes during a write, those currently surface as "unknown, Check" rather than "nothing changed". That errs safe (Check resolves it) but may be chattier than needed. A tighter classification belongs with importer semantics, which this lane may not touch.
- The default Example workspace never produces conflicts or rejections, so those states were verified only through the scripted harness, not the shipped example data.
- `copyText` relies on `navigator.clipboard`; a refusing or missing clipboard is handled (quiet message, no throw), but the real desktop host's permission behaviour was not tested.
- Ports 5173 and 5281 were avoided by rule; another builder was using 5284, so the harness used 5391. All of my servers are stopped.

## Checks run and results

CPU was sampled before each group; no test ran at 85% or higher, one serial process at a time. `npm run typecheck` waited until CPU was 73%.

| Command | Result |
| --- | --- |
| `node_modules/.bin/tsc -p modules/design/imports/tsconfig.json` | pass |
| `node --test --test-concurrency=1 modules/design/imports/test/*.test.ts` | 70 pass, 0 fail (7 files: flow 19, panel-flow 14, importer 17, bundle 7, controller 6, jcs 4, panel 3) |
| `node_modules/.bin/tsc -p modules/design/app/tsconfig.json` | pass |
| `node --test --test-concurrency=1 modules/design/app/compose/test/*.test.ts` | 197 pass, 0 fail (includes the renderer-safe import walk) |
| `npm run typecheck` | exit 0 |
| `npm test` (build:electron + vitest) | not run |

Visual verification (screenshots, not automated): light and dark at 1280×820, 1680×1000, a 572px content column, reduced motion, and a keyboard-only pass through the whole flow. Hover, busy, progress, toast, error, unknown, conflict, history and receipt states were captured.

## Exists only outside this commit

- **Committed evidence (6 stills):** `docs/design/hq-visual-system/evidence/sources-20261103/wip/imports/`.
- **`/tmp/hq-f5-evidence/imports/` (not committed, may vanish):**
  - Screenshot sets `r1`–`r6` and `final/` (13 stills each for light 1280×820, dark 1280×820, light 1680×1000; plus `r3` error/unknown/conflict states, `r5` keyboard flow, `r6` reduced motion and 572px receipts).
  - `tools/`: the Playwright drivers (`flow.mjs`, `states.mjs`, `keys.mjs`, `receipt.mjs`) and `harness/`, a separate small vite app outside the repo that mounts the real panel and real `@hq/ui` kit against a fake storage port with scripted faults (failed commit, lost-reply commit, conflicts, history, save unavailable).
  - Two controller backups (`controller.keep.ts`, `controller.before-reconcile.ts`); the committed `controller.ts` supersedes both.
- **`/tmp/hq-f5-tools/capture.mjs`:** shared stills tool for the lane.
- **`/tmp/hq-f5-briefs/`:** the two read-only brief files.
- Nothing is uncommitted in the worktree. Nothing lives only in the thread.

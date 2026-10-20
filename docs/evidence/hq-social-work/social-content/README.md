# SOC-C Social core (`task.social-core.001`)

Authority effect: none. This is the lane evidence for `spec.hq-social-work#ac.social-core.001` and `spec.hq-social-work#test.social-core.001`. It produces `spec.hq-social-work#iface.social-port.001`.

## Binding and preflight

| Item | Value |
| --- | --- |
| Branch | `work/hq-social-content`, an isolated linked worktree with one Git owner (this lane) |
| Start | `cfdab378e28940662ddb6e731264afca164a1957` (R1); the accepted foundation `35f9a3e` is an ancestor |
| Plan | `spec.hq-social-work` read at `cfdab378e2…` through the section reader. Sections read: `task.social-core.001` and its context, requires, acceptance and test refs, plus `iface.domain-module.001`, `iface.references.001`, `iface.service-reference-extensions.001`, `ctx.check-catalog.001`, `ctx.test-plan.001` and `ctx.research-decision-basis.001`. R0/R1 evidence was read as Git objects at PR #3 head `d5a34d74b3…`. |
| Codex V3 guidance | The full root `AGENTS.md` was read at commit `4beb491c44…`: blob `3402719bc3…`, 30,716 bytes, SHA-256 `1238a90adb…87ce6`, all verified. Triggered guides applied: CPU telemetry, section reading and delivery. The builder profile is prompt-carried guidance only; no profile isolation is enforced. |
| HQ rules | Root `AGENTS.md`. There is no nested `AGENTS.md` on touched paths. `.agents/shared-guidance.md` is absent, so shared enrollment is unavailable; nothing was installed. |
| Model | Claude Frontier, explicit `claude-opus-5-5` at high effort; no descendants |
| Contributing T3 threads | SOC-C Social content lane, role builder (native ID withheld from this public repository). Coordination owner: HQ root thread. |

**Guidance conflicts.** V3 defaults to delegating qualifying work and to delivering through merge. The owner's no-descendants rule and the HQ merge hold override both. No other conflict was found.

## What `modules/social/core` provides

The module is consumed by relative import from inside `@hq/social` (for example `../core`). No package export changed.

| File | Exports |
| --- | --- |
| `port.ts` | `SocialWorkspacePort` and its record types: `Channel`, `ToolId`, `ToolCategory`, `Brand`, `Draft`, `DraftFields`, `SaveDraft`, `Tool`, `RunRecord`, `RunStatus`, `ObservedRunStatus`, `WorkspaceSnapshot`, `PortError`. Also `PortFailure` (the rejection carrying a `PortError`), `portErrorOf`, `CALL_CLASSES`, `hasFeature`, the constant lists, `DEFAULT_BRAND_ID`, `FEATURE_HQ_REFERENCES`, `FEATURE_HQ_BRAND_PROJECT`, `PROPOSED_SCHEMA` and `MAX_DRAFT_LINKS`. |
| `validate.ts` | Client validation in the service's order, with its messages: `checkDraft`, `checkLinks`, `checkBrandName`, `checkRunSubmission`, `isPlanningDate`, `isRunId`, `isChannel`, `isToolId`. Also `MESSAGES`, `LIMITS` and `MAX_BODY_BYTES`. |
| `fixture.ts`, `fixtures/workspace.ts` | `createFixtureWorkspace({ features, clock, seed, delay })` returns `{ port, controls }`. The controls are `editElsewhere`, `loseNextSubmitResponse`, `failNext`, `setUnavailable`, `advanceRuns`, `restart` and `inspect`. Fictional seed data: `fictionalSeed`, `FIXTURE_IDS`, `FIXTURE_PROJECT_ID`. |
| `recorder.ts` | `recordCalls(port)` returns `{ port, calls(), callsOf(class), clear() }`. Every call is tagged `content`, `read` or `execution`. |
| `runs.ts` | `submitRunOnce` submits once, from an explicit action only, and returns `accepted`, `unknown` or `rejected`. `possibleRunMatches` lists possible matches after an unknown submission. Also `isActiveRun`. |
| `session.ts` | `socialSession(projectId)` and `useSocialSession(projectId)`: module-level state that survives shell remounts. It holds the workspace load (stale snapshots stay visible), draft editors with conflict handling (`saveEditor`, `saveAsCopy`, `reopenLatest`) and page view state. |
| `test/port-conformance.ts` | `describeSocialPortConformance(label, createHarness)` and the `SocialPortHarness` interface, shared by the fixture and live adapters |

**Proposed schema.** `Draft.links` exists only with `hq-references-v1`, and `Brand.project_id` only with `hq-brand-project-v1`. Both come from `iface.service-reference-extensions.001`. They are labeled through `PROPOSED_SCHEMA` and are not delivered service fields.

- The fixture advertises `hq-references-v1` by default.
- `features: []` reproduces today's service.
- Adding `hq-brand-project-v1` makes the seed carry `project_id`, which lets the domain lane demonstrate the mismatch banner.

**Safety invariants checked by tests:**

- There are no network, filesystem or account calls.
- Only `submitRun` is `execution`.
- Loading, editing and saving make zero execution calls.
- A lost `submitRun` response is `unknown`, the port makes exactly one execution call and nothing retries it.
- A conflict never overwrites the other copy, and the user's text is kept.

## Interface research

The research read the private Social workspace service (Fieldnotes) at `3f647daced7fa12f4885222a22ec542bbae6d4e1`. It used Git objects only, under `apps/social_dashboard/` (`server.py`, `catalog.py`, `static/app.js`). Nothing under `data/` and no protected record was read. No source was copied.

- **Mirrored as interface facts:** the validation order and message strings, limits, defaults, conflict semantics, queue capacity, restart interruption and route error classes.
- **Mirrored as catalog identity:** tool IDs, names, categories and marks.
- **Authored for the fixture:** tool descriptions, examples and all records.

**Recorded divergences.** Each entry gives its reason.

1. **Unparseable planning dates.** For a string such as `2026-02-30` or `2026-2-03`, the service returns the CPython `date.fromisoformat` exception text. That text depends on the Python version and does not come from Fieldnotes source. The client returns "Use a YYYY-MM-DD planning date" for every malformed date. **The live adapter must run `checkDraft` before sending** so it passes the shared conformance suite.
2. **`archived: 1.0`.** The service rejects a JSON float. JavaScript cannot represent the difference, and HQ always sends the integer.
3. **Non-text `brand_id`.** SQLite binding fails with a generic HTTP 500. The client returns "Unknown brand".
4. **Ordering edge cases.** Fixture brand order uses UTF-16 comparison where SQLite compares UTF-8 bytes; they differ only above U+FFFF. Ties on equal timestamps sort newest-inserted first, where SQL leaves the order unspecified.
5. **Run outputs and examples.** These are generic fictional shapes. Tool-specific result shapes and the service's structured example files are not modeled; the workbench lane owns that research.
6. **Same-origin and token refusals (HTTP 403).** These are modeled only as an injected `forbidden`, which carries no message, matching the port type.

## Checks

Local, on the exact candidate tree. Each run had fresh telemetry admission first; the last reading before the final runs was CPU 14.46% used and 40.16 GiB RAM available, allowing one serial process. Nothing ran in parallel.

| Command | Result |
| --- | --- |
| `npx tsc -p modules/social/tsconfig.json --noEmit` | Pass |
| `npx vitest run modules/social` (literal `social-module` projection) | Pass: 131 tests in 4 files. That is 129 new core tests in 3 files (two conformance runs, fixture, validation and the session hook) plus R1's 2 skeleton tests. |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 159 tests in 9 files |
| `npm run build` | Pass. It writes only the ignored `apps/desktop/dist*`, which is left in this worktree as classified ignored output. |

**Is the suite sensitive?** As a reversible mutation, the fixture's version check was removed (the backup was restored in place). Four tests then failed: both conformance conflict cases and two session conflict cases.

**Projection.** The `social-module` group is a projection of the group proposed in `ctx.check-catalog.001`. `tests/check-groups.toml` is Design-owned and was not edited.

**Not covered.** No CI is configured, so these are not green CI. There was no Electron launch, and no visual evidence because there is no UI in this task. The suite has not been checked against a live service; that waits for `task.social-live-adapter.001` and D-2 gates.

## Deferred and open items

- **Content task.** `task.social-content.001` was released by root after accepting core at `83dafc5`. Its record is the next section. The nav, index and live paths stay held and untouched.
- **Restart persistence.** `session.ts` is session-only. Persistence across restarts waits for a `ModulePort` storage member (G-3, proposed to the root).
- **No response parsing.** No response-shape parsers exist yet. The live adapter task should validate service responses before trusting them.

# Social content pages (`task.social-content.001`)

Authority effect: none. This is the evidence for `spec.hq-social-work#ac.social-content.001` and `spec.hq-social-work#test.social-content.001`. It covers `req.social-content.001` RC-1 to RC-4 and RC-8. RC-5 to RC-7 belong to the held domain/nav task.

## Binding

| Item | Value |
| --- | --- |
| Core dependency | `task.social-core.001` at `83dafc50ef9e4e1b296baf2f1f9ad2d6b3115f04` (PR #25), root-accepted. Core is read-only in this task; nothing under `modules/social/core/` changed. |
| UI kit dependency | `task.ui-kit.001` at `935dedf78e04a2697bdc02d85864546948ffcb8c` (PR #24: source `1b7dcae`, evidence `935dedf`), root-accepted. It was consumed by one normal, conflict-free merge, `3bc79e1`, authorized by root for this purpose only. No kit file was edited. The kit README and evidence were read before use. |
| Kit limits honoured | Theming is document-level only (`<html data-theme>`); nested-subtree theming is the kit's deferred F1. No inline styles, because the CSP blocks them. These pages have no preserved-content wells. |
| Plan | Sections read at `cfdab378e2…`: `task.social-content.001`, `req.social-content.001`, `ac.social-content.001`, `test.social-content.001`, `iface.ui-kit.001` and `ac.ui-kit.001`. T3 design input read-only at `8f91f6b2…` (`docs/design/social/hq-social-design.md`). |
| Write scope | `modules/social/content/**` and this evidence folder only |

## What `modules/social/content` provides

Consumers import from `modules/social/content`; the nav and index lanes mount it.

| Export | What it is |
| --- | --- |
| `SocialContent({ port, projectId, destination, navigate, now? })` | The content pages for `library`, `library/<draftId>`, `library/new`, `calendar` and `calendar/<YYYY-MM>`. It loads the workspace once per session and shows the loading, empty, error, unreachable and stale states. |
| `Library` | Filters by brand, channel, planned/unplanned, active/archived and search. Rows carry an unsaved-changes chip and an Archive/Restore menu. The draft editor sits beside the list. |
| `DraftEditor` | Fields follow Fieldnotes: title, brand, channel, planned date and one body (RC-8), with character counts. Saving uses `Ctrl`/`⌘` `S`. It shows the save states, the service validation message on the field, the *Changed elsewhere* conflict and the unknown-result check. Links are shown read-only. |
| `Calendar` | A month view plus the *No date yet* tray. Drafts move by pointer drag, or with the keyboard through a dialog offering Move to date, Clear date, Open draft and Cancel. Undo is offered. A note says planned dates are editorial intent only. |
| `BrandManager` | Lists brands and adds one. The built-in brand is labelled present (*Built in*), never created. Exported for the brand switcher, which belongs to the held domain/nav task. |
| `changeDraft`, `reconcileUnknownSave`, `saveStateOf`, model helpers | Pure and helper logic: destinations, filters, the month grid and date labels |

## Calls per interaction

The tests check these with the core recorder. **No content interaction makes an `execution` call.**

| Interaction | Port calls |
| --- | --- |
| Open Social content, first time in a session | `snapshot` |
| Remount after a domain switch | none (the session's snapshot is reused; unsaved text is kept) |
| Create a draft, or save an edit | one `saveDraft` |
| Conflict, then *Save mine as a copy* | one `saveDraft` (refused), then one `saveDraft` that creates the copy. The other copy is unchanged. |
| *Load their version* (after confirmation) | `snapshot` |
| Archive or restore | one versioned `saveDraft` |
| Calendar move, by drag or the dialog | exactly one versioned `saveDraft`, changing only `planned_date` |
| Undo of a move | one more versioned `saveDraft` that restores the previous date |
| Move a draft that has unsaved Library edits | none: the move is refused with a message, so it can never conflict with your own text |
| Unknown save result, then *Check* | one `snapshot`. It never saves again. A save is a separate explicit action. |
| Add a brand | `addBrand`, then `snapshot` |
| Month navigation, opening a draft, filtering | none (destination and view state only) |

## Decisions and recorded behavior

1. **Field changes use the stored record.** Calendar moves and row archive/restore save the stored draft through `changeDraft`, never unsaved editor text. A draft with unsaved edits is refused, and a clean open editor is closed so it reopens from the saved record.
2. **The editor's Archive saves the open text.** It saves the text together with the flag in one versioned save, as the service's own editor does. A failed save leaves the flag unchanged.
3. **Copy lands under its own ID.** After *Save mine as a copy*, the session rests the editor on the copy, so the page navigates to the copy's ID and closes the editor under the original key.
4. **Unreachable service.** Data stays visible, labelled *Offline · showing data last synced …*. Saving, archive and moves pause, and text is kept. *Check again* reloads only; it never retries a save.
5. **"Kept" means this session only.** Unsaved text is kept in memory for the session, not on the device. Persistence across restarts waits for G-3.
6. **Honesty copy.** No *scheduled*, *published*, *posted* or *connected* status is shown. A test asserts the calendar has none of these words.

## Checks

These ran on the candidate tree after fresh telemetry admission: CPU 8.89% used, 44.0 GiB RAM available, one serial process.

| Command | Result |
| --- | --- |
| `npx tsc -p modules/social/tsconfig.json --noEmit` | Pass |
| `npx vitest run modules/social` (literal `social-module` projection) | Pass: 173 tests in 6 files (42 new content tests in 2 files) |
| `npm run typecheck`, `npm test`, `npm run build` | See the PR body for the final head |

**Mutation checks** (each reverted afterwards):

- Removing the unsaved-edit guard in `changeDraft` failed the refusal test.
- Removing the archive-flag revert failed its conflict test.

**Projection.** The `social-module` group is a projection of `ctx.check-catalog.001`. `tests/check-groups.toml` is untouched.

## Visual evidence

The evidence page is `modules/social/content/preview/`. It runs under the exact CSP of `apps/desktop/index.html`, uses only the fictional fixture, and drives each state with real DOM events.

To reproduce, from the repository root:

```sh
npx vite build --config modules/social/content/preview/vite.config.ts      # writes the ignored preview/dist/
npx vite preview --config modules/social/content/preview/vite.config.ts    # http://127.0.0.1:4184/?theme=light|dark&view=<name>
```

**Views:** `library`, `unsaved`, `saving`, `conflict`, `invalid`, `offline`, `empty`, `loading`, `error`, `calendar`, `calendar-move`, `calendar-moved` and `brands`.

**Capture method:** headless Chromium 155.0.8059.79, driven from the command line with `--screenshot` and `--virtual-time-budget=4000`, without an automation protocol. Every view was confirmed to reach its ready marker with `--dump-dom`. Captures are 1280×800 in light and dark, plus 900×700 for the library and calendar. The loopback preview server was stopped afterwards.

![Conflict: text kept, nothing overwritten (light)](captures/conflict-light.png)

![Calendar after a move, with Undo (dark)](captures/calendar-moved-dark.png)

| File | SHA-256 |
| --- | --- |
| `captures/brands-dark.png` | `1044467410abbff480ce2c785744beea6180326c63fdde46f96fd6e4464053e7` |
| `captures/brands-light.png` | `e0999bf319f0e89d659b96feaa2ba09a10e2bba4aaaf31d414dc3505a85b9ebb` |
| `captures/calendar-dark-900.png` | `843ac286efad90d5c7461b8c30389c7413b2ea7177af37e79c316724b5c3e965` |
| `captures/calendar-dark.png` | `33d468bec6fb96e583ac0aff59ce181a2ab8831e0f82f52311811aee2806b203` |
| `captures/calendar-light-900.png` | `b8150951384acaf8090a46811c2172e6e446d04d8bb6e83388a8eed0b3346b53` |
| `captures/calendar-light.png` | `785652450fbc0c235c014ab99706c5d72bea4bd0b6b8255755f88990fecb8635` |
| `captures/calendar-move-dark.png` | `3728e327d139d11f0558f51f27105c77028d7ec614c634788c2ab90e07772a2b` |
| `captures/calendar-move-light.png` | `772c1b6a0ac81c74ac3d23af72608e8b437a3fb6f6aeb3acb5298e2fc7bc7b70` |
| `captures/calendar-moved-dark.png` | `0a88f18b6d03e47c8c7a827b58beb939e671eb0f51aeb36103422ca15753347c` |
| `captures/calendar-moved-light.png` | `4c0f147642e677785b866fb57f0674f03225b4da2c4e466042f1e8b8c6100eed` |
| `captures/conflict-dark.png` | `a9da5f0229e993ba00f616e19a6ed56d4969355d3d1033d08e45761c6710341d` |
| `captures/conflict-light.png` | `9943aec9a9669addcc1871f853702b2e0025a2f9afb121cfcce8880b1fbdec8e` |
| `captures/empty-dark.png` | `d249e03ab6f90858c3d765f9cb05b7cb788520a3a0010489cfdec347a5d007db` |
| `captures/empty-light.png` | `5731e259b22de0b32a9ffdb4eef4fbfb192e9f6ef74d3b7a074b626c343a7bc1` |
| `captures/error-dark.png` | `be371cbcb914bd0bf27eac0b99dfd79ed7d09ec780929a4dbe89a9afbf224f96` |
| `captures/error-light.png` | `526a996a42184f7b0b9f81c9f733f9536369990e93311bd8a04f5106d1c8cc97` |
| `captures/invalid-dark.png` | `aec9056f36dff42a7996b5ef4b10f4bdc4d1ecad167b06adda367ad9a573c5ce` |
| `captures/invalid-light.png` | `97ee96d7ed51f6fb7ff95f8b55b31ea2d2d3f42f053fac3059469eb0214e6c47` |
| `captures/library-dark-900.png` | `a70c61775e4e8427f89c90b672e423550de72c81259d9e0869e38f9da9f374f8` |
| `captures/library-dark.png` | `a071afb7d07ec7dcb66971116e52f8a7cd2df7c1bbc199cda6b0cc99e203ff72` |
| `captures/library-light-900.png` | `646c7075a8bd508ed4d2acd971fe51d60c80f4dc58ddb8ca30c9264b1bb539ee` |
| `captures/library-light.png` | `8576ffe7bfca711e57f81a6e0cbb1b82219b3b3e727150fbcc82297fa270d6ce` |
| `captures/loading-dark.png` | `2565ded0759f74d02f2a84655c2bcbe0310606c021571e0226d149f90bb65067` |
| `captures/loading-light.png` | `cba4e42eedce5dde78e55cb89287626e337a67fdf7e9b86937eb20a41efcf592` |
| `captures/offline-dark.png` | `0b707b7089cafced4731c16752ee6dc99eeea85b35f6997d7d61393fda561182` |
| `captures/offline-light.png` | `c54ea8952497a00094130e49933ce254ca4d028fb36b55790d36f4b50efc351e` |
| `captures/saving-dark.png` | `691da3d95baec0a74a5e8386aaf8d33061eeeb5260b1a9b47e3f2aac558ef4a2` |
| `captures/saving-light.png` | `47872d32c75863997974903238c67cae2d5eae544499ce978d66e878938f4f7e` |
| `captures/unsaved-dark.png` | `aa40e90ebeabe8d5bfdd9df2162a009aeb4619c7ebaa84637415a39cfa86c32e` |
| `captures/unsaved-light.png` | `ea4c3a46e1e4fe58938d9182861030f0e1e78fbf4c1e63a95b48d26e1f11a61a` |

**Not covered.**

- **Fonts.** The host renders a monospace fallback face, because IBM Plex is not shipped (the kit's font gate). Type therefore differs from T2's mockups.
- **Scale.** No 2× capture.
- **Platforms.** No Electron and no macOS.
- **Assistive technology.** No screen reader and no forced-colours check. Roles, names and keyboard paths are asserted in happy-dom only.
- **Reduced motion.** Not rendered with the preference on.
- **Pointer drag.** In a real browser, drag was proved only by the happy-dom test with a stubbed `elementFromPoint`. The capture shows the keyboard dialog path instead.

## Deferred

- The core P4 items stay deferred, as root directed: key-order sensitivity in `isDirty`, and the shared in-flight `load`.
- **P4.** The move dialog defaults an undated draft to the first of the visible month, not today.
- **P4.** Unknown-save reconciliation for a *new* draft can only offer an exact-text possible match; it cannot prove the match.
- **P3.** The pointer drag has no auto-scroll and no live drop-target highlight. The keyboard dialog is the complete alternative.

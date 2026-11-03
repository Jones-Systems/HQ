# SOC-W Social workbench (`task.social-workbench.001`)

Authority effect: none. This is the lane evidence for `spec.hq-social-work#ac.social-workbench.001` and `spec.hq-social-work#test.social-workbench.001`.

## Binding and preflight

| Item | Value |
| --- | --- |
| Branch | `work/hq-social-workbench`, an isolated linked worktree with one Git owner (this lane) |
| Start | `83dafc50ef9e4e1b296baf2f1f9ad2d6b3115f04`: the accepted SOC-C core, head of `work/hq-social-content` |
| UI dependency | The accepted UI kit `935dedf78e04a2697bdc02d85864546948ffcb8c` was merged as `d3fe415849bbf227a9c24c9fdc4b8db1ed748b35`, with no conflict, rebase or force. R1 `cfdab37` is an ancestor of both parents. |
| PR base | `work/hq-social-content` at `5f5df2a7c3881091a6d038be32fdee5ab23ef5e2`. That is SOC-C's content commit on top of its own merge (`3bc79e1`) of the same UI commit `935dedf`. |
| Content dependency | At root's direction, the accepted SOC-C content commit `5f5df2a` was merged normally, once, as `17351d0f275d4fd940d349bb9a0b2e4c7fbf9ec4`. Its parents are `ae5e0e43441045d7061f76a27bc62b3ba9a587c9` (the first published candidate) and `5f5df2a`. The merge had no conflict and needed no manual resolution. Verified after the merge: <br>• the tree differs from `5f5df2a` only by this lane's 43 added files; <br>• `modules/social/core` equals `83dafc5`; <br>• `packages/hq-ui` and the UI evidence equal `935dedf`; <br>• SOC-C's content and evidence equal `5f5df2a`. <br>This resolves the add/add conflict GitHub reported against its single merge base. |
| Plan | `spec.hq-social-work` read at `cfdab378e2…`; it is byte-identical to the working copy. Sections read: `task.social-workbench.001`, `ac.social-workbench.001` and `test.social-workbench.001`, plus `ctx.launch-preflight.001`, `ctx.change-surface.001`, `ctx.stop-recovery-delivery.001`, `ctx.check-catalog.001`, `ctx.test-plan.001`, `iface.social-port.001`, `iface.ui-kit.001`, `iface.references.001`, `iface.service-reference-extensions.001`, `req.social-research.001`, `req.safety.001` and `req.references.001`. |
| Codex V3 guidance | Root `AGENTS.md` at commit `4beb491c44…`: blob `3402719bc3…`, 30,716 bytes, SHA-256 `1238a90adb…87ce6`, all verified. Triggered guides applied: CPU telemetry, section reading and delivery. The builder profile is prompt-carried guidance only. |
| HQ rules | Root `AGENTS.md`. There is no nested `AGENTS.md` on touched paths. `.agents/shared-guidance.md` is absent, so shared enrollment is unavailable; nothing was installed. |
| Install | `npm ci` against the unchanged lockfile, with lockfile SHA-256 `9d388b16…a994bbc994` before and after. No manifest or lockfile changed. |
| Model | Claude Frontier, explicit `claude-opus-5-5` at high effort; no descendants |
| Contributing T3 threads | SOC-W Social workbench lane, role builder (native ID withheld from this public repository). Coordination owner: HQ root thread. |

**Guidance conflicts.** V3 defaults to delegating qualifying work and to delivering through merge. The owner's no-descendants rule and the HQ merge hold override both.

## What `modules/social/workbench` provides

The domain lane mounts `WorkbenchSection`:

- **Props:** `port`, `context`, `destination` and `navigate`, plus optional `clock`, `visibility` and `pollIntervalMs`.
- **Destinations:** `workbenches`, `workbenches/<toolId>`, `runs` and `runs/<runId>`. Use `parseWorkbenchDestination` or `isWorkbenchDestination` to recognize them.
- **Leaving the section:** the module asks to leave only through `navigate('library/<draftId>')`, after a draft is saved.

Navigation, nav and the domain descriptor stay with SOC-C, and no core file was edited.

| Area | Files | Behavior |
| --- | --- | --- |
| Catalog | `catalog.ts`, `Catalog.tsx` | Groups the eight tools by category, following the core's tool list. Shows each tool's delivered limit, its input kind and the banner "No account connection, posting, live collection or scheduling". |
| Inputs | `inputs.ts`, `imports.ts`, `fields.tsx`, `ToolForms.tsx` | Each tool has a form-first builder for the exact native input object, with typed JSON or JSON Lines file import, shape previews that never echo values, and Advanced JSON. A JSON value converts back to the form only when the form can represent it unchanged. |
| Run | `state.ts`, `ToolWorkbench.tsx` | `runTool` is the only submit path: one `submitRunOnce` per explicit Run, with double submits guarded. A loaded example is sent byte-for-byte with `is_example` set. Once edited, it is sent as supplied input. |
| Unknown outcome | `UnknownOutcome.tsx` | Lists `possibleRunMatches` without claiming any of them, and "Check run history again" only reads. "Run again…" after an unknown outcome needs a confirmation. |
| Receipts and history | `RunReceipt.tsx`, `RunHistory.tsx`, `polling.ts` | A run is read only while it is active and the page is visible; reading waits while hidden and stops on a terminal status or an error. When the service stops answering, a run last seen active shows as Unknown. Download receipt and Raw result JSON are available. |
| Results | `results.ts` | A summary for each tool, built from the fields the delivered recipes read, capped at 20 entries. Failed, interrupted and unrecognized output is shown honestly. |
| Start draft | `citation.ts`, `StartDraft.tsx` | Opens an unsaved editor through the core session. Save to library creates one draft. The run citation is a `ReferenceEnvelope` (`kind: 'run'`) sent in `links` only under `hq-references-v1`, with its persistence read back. Without the feature it shows "Not saved — needs Social service support". |
| Fixtures | `fixtures/examples.ts` | Wraps the core fixture with fictional, native-shaped examples and outputs for every tool (Larkspur Tea Co., `example.invalid`) |

## Interface research

The research read the private Social workspace service at `3f647daced7fa12f4885222a22ec542bbae6d4e1`. It used Git objects only (`git show <commit>:<path>`):

- `apps/social_dashboard/worker.py` and `catalog.py`, in full;
- `server.py`, through a filtered grep;
- `static/app.js`, the first 22 KB;
- `static/index.html`;
- `docs/social-growth-dashboard.md`.

Nothing under `data/` and no database, backup, credential or record was read. No source file was copied.

- **Mirrored as interface facts:**
  - each worker's top-level input keys, the defaults it applies, its limits and its `{ok, result}` envelope;
  - the delivered limit text and recipe wording. The exception is the Reddit opportunities limit and notice: root replaced an internal profile identifier there with neutral public wording that keeps the same limitation ("Built-in example-product profile only");
  - the rule-status wording of Channel preview.
- **Authored here:** every example, every output and all copy beyond those strings.

| Tool | Native input this module builds |
| --- | --- |
| `x-studio` Writing studio | `notes` (required). `format` is `short_post`, `thread` or `article`. `audience` and `intent` are omitted when blank so the worker applies its own defaults. |
| `social-publisher` Channel preview | `caption`, at most 30,000 characters, with the fixed `format: 'text'` |
| `x-intelligence` Signal inbox | `topic`, normalized `terms`, and `items` as JSON Feed items, from a feed file plus typed rows |
| `tiktok-intelligence` TikTok signals | `niche`, `as_of`, and 1–20 `batches` of `{manifest, records}` |
| `seo-studio` SEO workbench | `config`, `packets` and a date `as_of` |
| `search-visibility` Search visibility | `panel`, `entities`, `inventory`, and `answers` rows from JSON or JSON Lines |
| `reddit-opportunities` Reddit opportunities | `bundle` and `as_of` |
| `creator-relationships` Creator fit | `batch` (needs `account_id`), `niche_topics`, optional `brand_topics` (omitted when empty) and `as_of` |

**Divergences and assumptions.** Each entry gives its reason.

1. **Inner document schemas.** The inner shapes of `niche`, the manifests, `packets`, `panel`, `bundle` and `batch` were outside the research scope. They are imported and passed through unchanged. The fixture examples are labeled illustrative placeholders, not native schemas; the native worker remains the validator.
2. **Advanced JSON warns but does not block.** This matches the delivered UI. It warns on missing keys the worker reads without a default. Form mode blocks on problems and focuses the problem summary.
3. **The citation's `returnDestination` is `library`.** A new draft has no ID before it is saved. `sourceRevision` is the run's as-of date: `finished_at`, otherwise `created_at`.
4. **Writing studio drafts default to channel X.** This is the delivered behavior. Other tools default to General, with a source line.
5. **Short run IDs show the trailing eight characters.** The leading characters are identical across the core fixture's sequential IDs. For random native IDs either end is equally distinct.
6. **Reddit opportunities wording.** The limit reads "Built-in example-product profile only". The notice reads "Scores against the built-in example product profile. Custom product profiles exist only in the native tool." The fictional result uses the illustrative profile `example-product`. Input keys, behavior and the limitation are unchanged.
7. **Proposed, not delivered:** `links` on a draft (`hq-references-v1`) is the proposed service extension from `iface.service-reference-extensions.001`. No other tool or feature is proposed.

**Working decisions.** Root accepted these for this fixture and source slice:

- Advanced JSON warns rather than blocks, for parity with the delivered UI.
- An edited example runs as supplied input (`is_example` false).
- "Run again…" after an unknown outcome requires an explicit confirmation.
- The citation's `returnDestination` is `library`, and its `sourceRevision` is the run's as-of date.

## Checks

Local, on the exact reconciled tree: merge `17351d0` plus the public-wording change. Each run was admitted by fresh telemetry through `inspect-linux-system-telemetry`, and every reading allowed one serial test process. Nothing ran in parallel.

| Command | Telemetry before it (2026-10-20 UTC) | Result |
| --- | --- | --- |
| `npx tsc -p modules/social/tsconfig.json --noEmit` | 01:32:08Z, CPU 5.62%, 46.24 GiB available | Pass |
| `npx vitest run modules/social` (literal `social-module` projection) | 01:32:08Z, CPU 15.46% | Pass: 246 tests in 11 files, now including SOC-C's merged content tests |
| `npx vitest run modules/social/workbench` | 01:32:24Z, CPU 7.55% | Pass: 73 tests in 5 files (this lane) |
| `npm run typecheck` | 01:32:12Z, CPU 10.62% | Pass |
| `npm test` | 01:32:13Z, CPU 7.23% | Pass: 320 tests in 21 files |
| `npm run build` | 01:32:17Z, CPU 35.02% | Pass. It writes only the ignored `apps/desktop/dist*`. |

The first candidate `ae5e0e4` passed the same commands at 01:23 UTC, before the merge: 204 tests (social), 278 (all), typecheck and build.

**Is the suite sensitive?** On the first candidate, as a reversible mutation, `runTool` was made to submit again after an unknown outcome. Exactly one test then failed: "a lost response renders unknown with possible matches and never resubmits". The file was restored from its backup and compared byte-for-byte.

**Process gap.** One intermediate `vitest` rerun during development, after a test-label fix, was not preceded by its own telemetry reading. The reading about 15 seconds earlier was CPU 12.15%.

**Projection.** The `social-module` group is a projection of the group proposed in `ctx.check-catalog.001`. `tests/check-groups.toml` is Design-owned and was not edited.

**How the tests cover the acceptance criteria:**

| Acceptance | Test (`workbench.test.tsx` unless noted) |
| --- | --- |
| Exact native input from each tool's form or import | `inputs.test.ts`: one builder test per tool, plus the example round trip for all 8. DOM tests cover simple-field input and file import as built. |
| One `submitRun` per explicit Run, zero otherwise | "one Run submits once with the exact example input" (all 8, args `[tool, example, true]`); "navigation, examples, form edits, mode switches, file import and receipts make zero execution calls"; "a blocked Run makes no call" |
| Lost response | "a lost response renders unknown with possible matches and never resubmits" (core `loseNextSubmitResponse`) |
| Results for every synthetic example | The same per-tool Run test, plus `results.test.ts` "its synthetic example output renders a summary" (all 8) |
| Save to library creates one draft | "saves one draft whose citation is persisted under hq-references-v1" and the not-saved variant: one `saveDraft` each |
| Visible-only polling | `polling.test.ts`, with fake timers and a visibility source, plus the history DOM test |

## Visual evidence

Fixture UI in the T3 Browser preview (Chromium, Incognito profile, 1280×800 freeform). The exact app CSP applies: `style-src 'self'` and `connect-src 'none'`. There were no console entries and only same-origin GETs.

Theme comes from `?theme=light|dark`, which sets `html[data-theme]`. It is not CDP emulation. The harness side panel is test scaffolding labeled "test only": a stand-in for the Social navigation, fixture controls and live recorder counts.

| Capture | What it shows | Recorder (execution / read / content) | SHA-256 |
| --- | --- | --- | --- |
| `captures/01-catalog-light.png` | Catalog, grouped, with limits and the limits banner. Recaptured with the public Reddit limit "Built-in example-product profile only". | 0 / 0 / 1 | `7fa2b4d8a1a4ec0c6bf17c7c13f4fe6a6abfe5a957de2e27b2416679c5e99c11` |
| `captures/02-writing-studio-result-light.png` | Example loaded, one Run, result rendered | 1 / 2 / 2 | `8d1c3accd4eafcf83dd7ca7f5d4eaa70f2d31c1f3424caf7c358be5eba87e80c` |
| `captures/03-start-draft-saved-citation-light.png` | Start draft, Save to library: one draft, citation "Saved with the draft · version 1" | 1 / 2 / 3 | `e6092418ddd2af9bf740036fa7fd3ba6260d68e78b79af2e4b65ebd81fa98681` |
| `captures/04-unknown-outcome-possible-matches-light.png` | Lost response: Outcome unknown, one possible match, "Run again…" | 2 / 2 / 4 | `59c13a14da91ba0946ef1c7460ae8651e0b5dded0cbfd6a0486a885c98e7716b` |
| `captures/05-run-again-confirm-light.png` | The confirmation alert dialog. Cancel kept the execution count at 2. | 2 / 2 / 4 | `f0ff0393ba3b5dfce8502a4f9ec2c4c6a68bc9b994754592a1eba34692266802` |
| `captures/06-run-history-light.png` | History: queued, succeeded, failed with its error, interrupted, example labels | 2 / 2 / 4 | `d0ab8015419d317c4cd35dc28a53282a61f7348805bb12b83cd72b1e7b633c55` |
| `captures/07-catalog-dark.png` | Catalog, dark. Recaptured with the same public Reddit limit. | 0 / 0 / 1 | `3441ef610f338845ce44f0ef0465d7cdc6e5a30e29df24d429d2c0a3b91c6d06` |
| `captures/08-channel-preview-result-dark.png` | Channel preview result: per-channel findings in the delivered wording | 1 / 7 / 2 | `40b10a0d0d3956c4773f3b9ff17a8e0b99bf36d1f817de568ce1cd05d7c1d1be` |
| `captures/09-unknown-outcome-dark.png` | Unknown outcome, dark | 2 / 7 / 3 | `7b991a96b64a1b1f0920018ffcf99626220b821d50ac15b5a0a5c7ba7c111e52` |
| `captures/10-run-history-unreachable-dark.png` | Service unreachable: the active run shows "Unknown · last seen queued, Don't start it again" | 2 / 7 / 4 | `4825cb8d459312e0fc38e4c70ed6dcc913d8721e09c806bda83ef1ec7a43d16b` |
| `captures/11-start-draft-citation-not-saved-dark.png` | `features=none` (today's service): the citation is "Not saved — needs Social service support". The later Save made one `saveDraft` (content 2 → 3) and the chip still said not saved. | 1 / 7 / 2 | `3de31ff88422f994f0f1fdc7ab63bbce7f7b923f14e69170fa746436442a3930` |
| `captures/12-tiktok-import-narrow-light.png` | 900×700 viewport, saved at 1280×996: single column, typed import previews, no horizontal overflow | 0 / 1 / 1 | `df86eb2c6ab8e21e919600b7b8d99ecc02c24d52fe46ac24d8c835d7a15ef072` |

Read counts include the receipt's run reads while a run was active, plus Load example. Execution counts always equal the number of Run clicks.

**Build provenance.**

- **Captures 02–06 and 08–10** were taken in the first publication pass, from a harness build that came before its last CSS change.
- **Captures 11–12** come from that pass's final build (first candidate `ae5e0e4`).
- **The only change between those two builds** is an overflow guard (`.sw-workbench > * { min-width: 0 }` and wrapping chips), found by capture 11's first attempt. Captures 02–10 have no overflow at the widths shown.
- **Captures 01 and 07** were retaken on 2026-10-20 around 01:31 UTC, under the same exact CSP.
  - They come from a fresh harness build of the reconciled tree: the merge `17351d0` plus the public Reddit wording, with script `index-CMif-e-G.js` and style `index-Di_-_wUk.css`.
  - Only the Reddit limit text differs from the first pass.
- **The other captures do not show the Reddit tool**, so the wording change does not affect them.

**Harness.**

```sh
npx vite build --config modules/social/workbench/test/harness/vite.config.ts
timeout 5400 npx vite preview --config modules/social/workbench/test/harness/vite.config.ts   # 127.0.0.1:4187, strict port
```

The listener was loopback-only and bounded by `timeout`. After capture, the preview tab was closed and the exact four process IDs were stopped; port 4187 was verified free. The build output `test/harness/dist/` is ignored. It was left in place because the command guard blocks recursive deletion.

## Gaps

- **Fonts.** On this Linux host `system-ui` measures identically to `monospace` (canvas widths 57.6 px for both `iiiiii` and `MMMMMM`). The captures therefore show a monospace fallback, not the intended sans. IBM Plex is not bundled (UI kit scope), so the captures are layout, state and color evidence, not typography evidence.
- **Not exercised:** Electron launch, macOS and a screen reader. Real window visibility is covered only by DOM tests with an injected visibility source. Receipt download (`Blob` plus an object URL) is unverified in Electron.
- **No live service.** Only fixture adapters were used.
  - Bridge and live-access gating is **D2**. Construction of the source bridge is selected, but verified real endpoints and access, and custody of contracts and IPC, are still held.
  - Editable Planner structures are deferred as **D3**.
- **CI.** No workflow is configured, so CI is unavailable, not green.

## Deferred findings

1. **Core fixture IDs.** The core fixture's sequential run IDs share a long common prefix. SOC-C owns the fixture; this module works around it with trailing short IDs.
2. **Kit chip wrapping.** The UI kit `StatusChip` is `white-space: nowrap`, so a long detail overflows narrow columns. This module passes a wrap class through `className`. A kit-level option is the kit owner's call.
3. **No file-input primitive.** The UI kit has none, so file pickers use the native control.
4. **Kit findings.** The kit's F1–F7 and deferred P2–P4 findings are unchanged, not fixed here.

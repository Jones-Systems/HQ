# Handoff: B3 W5, Design capabilities query and export readiness

Paused at the owner's request on 2026-11-03. Nothing is running. Nothing is uncommitted.

## Where it stands

- Branch: `work/hq-b3-design-export-20261103`, pushed, no force.
- Worktree: `~/.t3/worktrees/HQ/work-hq-b3-design-export-20261103`.
- Head before this handoff commit: `e699de5` (`WIP: add the design.capabilities host route`). The head that includes this file is reported in the reply that carries this text.
- Base: `807346e` on `work/hq-b3-design-imports-20261103` (W2, still being revised). W2's final head has **not** been merged yet. When the lead sends it: `git fetch origin work/hq-b3-design-imports-20261103`, then `git merge origin/work/hq-b3-design-imports-20261103` (a merge, not a rebase).
- Dependencies are installed (`npm ci` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`). `apps/desktop/dist-electron` has **not** been built.

| Piece | State |
| --- | --- |
| Capabilities host route | **Done, in `e699de5`.** New tests passed; see "Checks run". |
| Renderer capabilities port, fake answer, contract §5 | **Not started.** Design below. |
| Export readiness in the engine (status reflects the flag) and host error mapping | **Not started.** Findings below. |
| Renderer export port and its contract section | **Not started.** Design below. |
| Enablement commit (must be the last commit) | **Not started.** Exact scope below. |
| Qualification evidence | **Not started.** |

### What `e699de5` contains

- `packages/contracts/src/services.ts`: `'design.capabilities'` added to `DESIGN_SERVICE_ROUTES`.
- `packages/contracts/src/design-records.ts`: types `DesignFeatureState`, `DesignHeldFeature`, `DesignCapabilities`; the route's params `Record<string, never>` and value.
- `apps/desktop/electron/design-host.ts`:
  - exported `DESIGN_HELD_FEATURES` (frozen, fixed list);
  - the route accepts only `{}`;
  - an explicit `case 'design.capabilities'` in the execute switch.
- `apps/desktop/electron/design-host.test.ts`: three new tests (route registered and truth table of the reply; lazy open, invalid params, closed host, failed open; fresh held list per call).

Reply shape: `{ imports, pick, export, held }`.

- `imports`: `enabled` when `store.transactions.status.accepted`. The candidate construction therefore reads `enabled`.
- `pick`: `enabled` when a picker was injected.
- `export`: `enabled` only when the store advertises export (`exportBundle.status.state !== 'disabled'`) **and** a save function was injected. Otherwise `disabled`.
- `held`: fixed list, each `status: 'held'`:

| feature | reason id |
| --- | --- |
| `generation-sources` | `external-access-held` |
| `component-runner` | `native-qualification-pending` |
| `jones-code-live-send` | `live-effects-held` |

## Decisions and why

- **Route name `design.capabilities`.** It follows the brief's example and the `<group>.<noun>` shape of the existing routes. The operation name for typed failures is also `design.capabilities`, with section `storage`, because `DESIGN_SECTIONS` has no `design` entry.
- **The route awaits the lazy store open**, like every other route, so the first call opens the store and runs recovery. If the open fails it answers `{ ok: false, kind: 'unavailable' }`. This is what the brief preferred. Document it in §5.
- **Shared gate, not exclusive.** The route name does not start with `import.` or `export.`, so `host.call` runs it under the readers gate, concurrently with other reads.
- **An explicit switch case is required.** The execute switch's `default:` branch is `putDocument`. Validation rejects unknown routes first, but any new route must still get its own `case`, or it would fall into a write.
- **The held list lives in the host as a local constant**, not imported from `@hq/contracts`. Electron main imports `@hq/contracts` as types only, and the emitted host should not gain a runtime dependency on it. The renderer port needs its own copy of the closed vocabulary for strict validation. Plan: add a test that the two lists are identical (desktop tests can import compose modules).
- **`export` means the whole export action is usable** (store export on and a save function present). `export.save` without a save function answers a plain `unavailable`, which a UI would offer to Retry forever, so hiding the action is the honest signal. This is a judgement call; see open questions.
- **Reason ids are neutral kebab ids.** No prose, no names, no hosts.

## Findings

1. **The engine already has an `enabled` flag, but its status never reflects it.** `createDesignExport(runtime, enabled = false)` in `modules/design/app/storage/design-export.ts` builds real bundles when `enabled` is true. Its `status` is always `EXPORT_STATUS` (disabled) and is typed `typeof EXPORT_STATUS`. The qualification fixture `test/engine-fixture.ts` calls `createDesignExport(runtime, true)`, so build and preview are already exercised.
   The host decides on `exportBundle.status.state === 'disabled'`. So enabling needs two things:
   - (a) a **preparatory** change: widen the status type to `typeof EXPORT_STATUS | { readonly state: 'enabled' }` and make `status` follow the flag. This changes no construction, because none passes `true` outside tests;
   - (b) the **one-expression enablement**: in `modules/design/app/storage/enabled-candidate.ts`, `createDesignExport(runtime)` becomes `createDesignExport(runtime, state === 'enabled')`. Only the `enabled` construction turns on; `candidate`, `openDesignStorage` and `bindDesignStorage` stay disabled.
2. **Host export error mapping is wrong for an enabled export.** In `design-host.ts`:
   - `export.preview`: a throw from the engine (for example `ExportProjectionError`) lands in the catch and becomes `{ ok: false, kind: 'unavailable' }`, because the route is not in the write list. It should be `invalid` for a projection refusal.
   - `export.save`: the route is in the write list, so a throw from `build(...)` becomes `{ ok: false, kind: 'unknown' }`, although nothing was written before the save dialog. Only a failure of the `save(...)` call itself may be `unknown`. A projection refusal in `build` should be `invalid` and any other build failure `unavailable`.
   - `publicResult` also flattens the engine's own `unavailable` reasons (for example `stream-enumeration`) to a plain `unavailable`. That is acceptable, but note it in the contract.
   This is the meaning of "projection refusals keep their kinds". Fix it in a commit before the enablement commit, with tests.
3. **Tests that pin export OFF** (all need `npm run build:electron` except the storage one):
   - To flip to ON in the enablement commit:
     - `apps/desktop/electron/design-imports.e2e.test.ts` (the "export stays off" test, around line 214);
     - `apps/desktop/electron/import-pick-wiring.test.ts` (around line 130);
     - `apps/desktop/electron/design-host.candidate.test.ts`: "explicitly enables the actual emitted opener…" (around lines 292 to 306) and "builds the production host from the actual emitted modules…" (around lines 321 to 324);
     - `modules/design/app/storage/test/enabled-candidate.test.ts`: "uses the same single-store gated construction for explicit enabled status, with export OFF".
   - To keep as they are (default and other constructions): the first candidate test in `design-host.candidate.test.ts` (around lines 125 to 130), the two "default emitted store/opener" tests there, "advertises only candidate Imports routes while preview and build remain disabled" and "keeps both production constructors on the unchanged disabled transaction status" in `enabled-candidate.test.ts`, and the `design-host.test.ts` disabled-routes test.
   - Re-grep before editing: `grep -rn "export.preview\|export.save\|exportBundle" apps modules`.
4. **Comments and docs that become false at enablement** (put these in the enablement commit; keep the commit otherwise minimal):
   - the JSDoc of `createProductionDesignHost` in `apps/desktop/electron/design-host-production.ts` ("Export stays disabled…");
   - the comment in `enabled-candidate.ts`;
   - the storage `README.md` lines "the Node wiring never enables it" and "Both return disabled in production".
   Write the BACKEND-CONTRACT text in earlier commits so it is true whether or not the enablement commit is present. For example, the export port answers whatever the host answers, and `capabilities.export` says whether this build enables it.
5. **Environment.**
   - The host test "real emitted T9 store…" failed in the one run only because `apps/desktop/dist-electron` was not built. It is not a regression.
   - The storage suite's import-edge scan fails while `apps/desktop/dist-electron` exists in the worktree. After the emitted-build tests, move the build output to a fresh `/tmp` directory (no `rm -rf`).
   - Compose tests run as `node --test modules/design/app/compose/test/*.test.ts` from the repo root. Storage tests run as `node --test modules/design/app/storage/test/*.test.ts`. Typecheck the app with `node_modules/.bin/tsc -p modules/design/app/tsconfig.json`, and use `npm run typecheck` for the rest.
   - Run tests under `umask 0022` with a `timeout` and `TMPDIR=/tmp`.
   - Take `top -bn2 -d1 | grep Cpu | tail -1` first and run nothing at 85% CPU or more.
6. **`.agents/shared-guidance.md` is absent in this worktree.** Shared enrollment is unavailable; the local agreements in `AGENTS.md` were followed.

## What is left, in priority order

1. **Check the base.** If the lead has sent W2's final head, merge it first (see above). Conflicts are possible in `BACKEND-CONTRACT.md` §5 and §12 and in the compose workspace files.
2. **Renderer capabilities port** (`modules/design/app/compose/capabilities.ts`).
   - `readDesignCapabilities(transport: DesignServiceTransport)`.
   - Call `transport.call('design.capabilities', {})`. Convert a rejection to `DesignBridgeError('unavailable')` and unwrap with `bridgeResultValue(result, 'unavailable')`, so a `disabled` refusal keeps its reason.
   - Validate strictly: exact keys `imports`, `pick`, `export`, `held`; the three states in `enabled|disabled`; `held` exactly the three known features in order with their exact reason ids and `status: 'held'`; nothing extra. Any other shape is `unavailable`. Return a frozen copy.
   - Reject every failure through `toDesignOperationError` with context `{ section: 'storage', operation: 'design.capabilities', action: 'check which Design features are on', write: false }`.
   - Export the closed held vocabulary and add the cross-check test against `DESIGN_HELD_FEATURES` in the host.
   - Expose it on the workspace. For the bridged workspace, use `bridgeTransportFor(documents)`. For the in-memory fake, answer a labelled synthetic set carrying `FAKE_TAG`, so it never reads as real.
   - Open decision: a bridged workspace whose documents are not on the bridge (no transport). Either answer all `disabled`, matching `createUnavailableImportsEnv`, or reject as `disabled`.
   - Tests in `compose/test/` using `createTransportDouble`: valid reply, each malformed shape, refusal envelopes, transport rejection, and a `classifyDesignError` check.
   - Replace §5 "planned" in `BACKEND-CONTRACT.md` with the real contract: shape, definitions of each field, lazy-open behaviour, `unavailable` on a failed open, the fixed held list, and the fake's labelled answer. Also add `design.capabilities` to the operation-name tables.
3. **Preparatory engine and host change.** Widen and honour the export status flag (finding 1a). Fix the host's export error mapping (finding 2). Add tests: engine status with `enabled` true and false; host `export.preview` and `export.save` with a stub store that throws a projection error, a generic build error, and a failing `save`; `saved: false` when the dialog is cancelled. Nothing in this commit turns a construction on.
4. **Renderer export port** (`modules/design/app/compose/design-export-port.ts`).
   - `preview(exportedAt)` returns `{ documents, blobs, events, omitted: [{ category, count, unit, reason }] }`.
   - `save(exportedAt)` returns `{ saved }`, where `saved: false` means the dialog was cancelled and nothing was written.
   - Validate `exportedAt` with the host's ISO pattern (`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$`) before calling.
   - Validate replies strictly: exact keys; non-negative safe-integer counts; `unit` in `documents|streams|blobs|events|records`; non-empty strings.
   - Uncertainty: a lost or malformed reply on `preview` is `unavailable`; on `save` it is `unknown` (the file may have been written).
   - A `disabled` refusal stays `disabled`. A projection refusal arrives as `invalid`. Both are definite no-effect.
   - Context names are undecided. Suggested: section `storage`, operations `storage.export-preview` (`write: false`) and `storage.export-save` (`write: true`).
   - Add a contract section. Say explicitly that there is no UI yet and that F4 and F5 decide where the export action lives.
   - Reword the §12 "Backup and export" row and the `imports.export` operation row so they stay true: the Imports env's own `saveBundle` stays undefined and its storage-port bundle reads still fail as `disabled`; the host-level export is a separate capability reached through this port.
5. **Enablement commit, last, citing `ac.import-export-enablement.001`.**
   - Source: `createDesignExport(runtime, state === 'enabled')` in `enabled-candidate.ts` (finding 1b).
   - Same commit: the comments and README lines in finding 4, and the test flips in finding 3.
   - Add one production-host assertion that export preview returns a report and save calls the injected `save` with bytes.
   - Nothing else.
6. **Qualification evidence at the final head.** Run, serially and with the CPU check, then record the exact head, counts and every skip:
   - `hq-design-storage-engine`: `modules/design/app/storage/**/*.test.ts` (node:test);
   - `hq-shared-r3`: `packages/contracts/**/*.test.ts`, `apps/desktop/electron/**/*.test.ts` and `apps/desktop/src/references.test.ts` (vitest). Run `npm run build:electron` first, and move `dist-electron` to a fresh `/tmp` directory after the emitted-build tests and before the storage suite.
   - Also run the compose suite, the app typecheck and `npm run typecheck`.
   - The evidence goes in the report only. Committing it after the enablement commit would change the head and break the "last commit" rule.
7. **Report** in the agreed short format; last line `branch work/hq-b3-design-export-20261103, head <sha>`.

## Checks run so far

- `npx vitest run apps/desktop/electron/design-host.test.ts --project node` under `umask 0022`: 17 tests, 16 passed (all three new ones), 1 failed.
  - The failure is "real emitted T9 store…", because `dist-electron` is not built. It is environmental.
- Nothing else has been run: no typecheck, no `build:electron`, no storage, compose or contracts suites. The route change has therefore not been typechecked.

## Open questions and risks

- **`export` capability definition** (store export on and a save function present). If the lead prefers the store flag alone, change one expression in the route and the truth-table test.
- **Capabilities opens the store as a side effect** on first call. A palette that queries at start-up would trigger the open and recovery earlier than today. If that is unwanted, the alternative is to answer from injected state only and mark the store-derived fields `unknown`, which needs a contract change.
- **Candidate construction stays disabled for export** by the brief ("every other construction stays disabled"). The qualification fixture uses the engine directly with `enabled = true`, so qualification still covers real builds.
- **Evidence acceptance** is the integration owner's step under `ac.import-export-enablement.001`. The enablement commit exists only so that it can be accepted or dropped as a unit. If it is dropped, the capabilities field `export` will read `disabled` and the contract text above remains true.
- **The enablement commit must stay the last commit.** Any fix after it means re-ordering with a merge-only history, which this lane cannot do (no rebase). Land all fixes before it, or add a fix commit and note it in the evidence report.
- **Public repository.** Keep reason ids and messages free of names, hosts and paths. Reply text and evidence must use repo-relative or `~` paths.

## Exists only in this thread

Nothing uncommitted remains. These items were in the working session only, and are now captured above: the compose port designs (steps 2 and 4), the test-flip list (finding 3), the commit order, and the environment notes (finding 5). The npm install log is a scratch file outside the repo and is not needed.

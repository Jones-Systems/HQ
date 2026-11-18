You are a builder on lane B3 (HQ Design backend) in the public repo Jones-Systems/HQ, an Electron desktop app. Implement W5: a Design capabilities query, and export readiness. The B3 lead reviews your work and opens the PR.

## Workspace
- Your worktree is on the new branch `work/hq-b3-design-export-20261103`, created from `origin/work/hq-b3-design-imports-20261103`. That is W2, the Imports enablement, which is still being revised.
- You are stacked on W2. When the lead sends you W2's final head, run `git fetch origin work/hq-b3-design-imports-20261103`, then `git merge origin/work/hq-b3-design-imports-20261103`. Use a merge, not a rebase.
- You are the only Git writer of this worktree. Push only your own branch, with no force. Do not open PRs or comment on GitHub.

## Read first
- `AGENTS.md` at the repo root, and the guidance it routes to for this area.
- `modules/design/app/compose/BACKEND-CONTRACT.md`: the B3 contract (typed failures, bridge envelopes, and §5 Capabilities, still "planned").
- `docs/engineering-specs/backend-assessment-design-20261103.md` on `origin/work/hq-backend-design-20261103`: the W5 row and the enable-by-default table.
- `docs/engineering-specs/hq-integration-parallel-execution.md`, sections `ac.import-export-enablement.001`, `task.import-export-qualification.001` and `test.import-export-qualification.001`.
- Storage, under `modules/design/app/storage/`:
  - `README.md` (the Export and K1 sections);
  - `export.ts` (`EXPORT_STATUS`);
  - `design-export.ts`, `enabled-candidate.ts` and `node.ts`.
- Desktop, under `apps/desktop/electron/`:
  - `design-host.ts`: how `import.status`, `export.preview` and `export.save` are served;
  - `design-host-production.ts` and `main.ts`.
- `packages/contracts/src/services.ts` and `packages/contracts/src/design-records.ts`.
- `modules/design/app/compose/errors.ts` and `bridge-documents.ts` (`bridgeResultValue`).

## Goal
The owner's goal (2026-11-03): HQ's backend works for everything it is meant to have, and default-disabled pieces become working, enabled features where that is safe. For Design, two pieces remain.

### 1. Capabilities query
Shared surfaces (the palette, the Imports panel, Projects) need to know which Design features this build has enabled. Then they can hide or label a command instead of letting it fail with `disabled`.

- **Host route.** Add one cheap, read-only route, named like the existing ones (for example `design.capabilities`). It is an additive entry in `DESIGN_SERVICE_ROUTES`, with params `{}`. It reports only what the host already holds:
  - `imports`: enabled or disabled, from the opened store's transactions status;
  - `pick`: whether a file picker is injected;
  - `export`: enabled or disabled;
  - held features as a fixed list: generation sources, the component runner and Jones Code live sends. Each is `held` with a stable reason id. No prose that names people or hosts.
  Decide and document what it does before the store opens. Prefer awaiting the lazy open like other routes, and returning `unavailable` if the open fails.
- **Renderer port.** Add it in compose, for example `compose/capabilities.ts` with `readDesignCapabilities(transport)`.
  - Validate the reply strictly.
  - Reject with typed failures: a `DesignBridgeError` is classified by `classifyDesignError` with operation `design.capabilities` and `write: false`.
  - The in-memory fake workspace answers a labelled synthetic set.
- **Contract.** Replace §5 "planned" with the real contract.

### 2. Export readiness
`export.preview` and `export.save` are disabled in every construction (`EXPORT_STATUS`). Enabling them is governed by `ac.import-export-enablement.001`: qualification evidence at one exact head, accepted by the integration owner. No further owner approval is needed.

- **Export port.** Add a renderer port in compose, for example `compose/design-export-port.ts`.
  - `preview(exportedAt)` returns the omission report.
  - `save(exportedAt)` returns `{ saved }`.
  - Validate replies strictly, and reject with typed failures. `disabled` stays `disabled`. Projection refusals keep their kinds. A lost reply on `save` is `unknown`, because the file may have been written.
  - Add a contract section for it.
  - No UI changes. F4 and F5 decide where the export action lives; say so in the contract.
- **Enablement commit.** Make the enablement change as the LAST commit on your branch, and keep everything else out of that commit.
  - The application's enabled construction, the one `createProductionDesignHost` opens, advertises export as enabled and builds real bundles. The default construction and every other construction stay disabled.
  - Keep it as small as possible: the spec calls it a one-constant commit.
  - Flip the tests that pin export OFF for the production host to ON. Keep the tests that pin the default store disabled.
  - The commit message must cite `ac.import-export-enablement.001`.
- **Qualification evidence.** Then run the qualification suites at your head and record the exact head, the counts and every skip:
  - the `hq-design-storage-engine` group (`modules/design/app/storage/**/*.test.ts`);
  - the `hq-shared-r3` group (`packages/contracts/**/*.test.ts`, `apps/desktop/electron/**/*.test.ts`, `apps/desktop/src/references.test.ts`), after `npm run build:electron` for the emitted-build tests.
  Report them for the lead. The integration owner accepts them.

## Constraints
- **Repository.** It is public: no private data, personal names, hostnames or credentials.
- **Effects.**
  - No sudo or deployment, and no installing or restarting any app or service.
  - Never install, update or restart Jones Code.
  - No network beyond git and npm.
- **Tests.**
  - Never weaken, skip or delete tests to get green. Change an assertion only for an intended behaviour change, and list each change in your report.
  - Before tests, take fresh telemetry with `top -bn2 -d1 | grep Cpu | tail -1`. Run no tests at 85% CPU or more. Use one serial process and `TMPDIR=/tmp`.
  - If `node_modules` is missing, run `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund`.
  - The storage suite's import-edge scan fails while `apps/desktop/dist-electron` exists in the worktree. After the emitted-build tests, move the build output to a fresh `/tmp` directory; you cannot `rm -rf`.
- **Git.**
  - Use literal paths in git commands and shell redirects; a hook blocks dynamic ones.
  - Never reset, clean, rewrite history or force push.
- **Ownership.** Stay out of the view files F5's lane owns:
  - ImportsPanel and imports.css;
  - the Imports, Flows, Discovery and Components views;
  - References wiring;
  - the taste, references, flows, discovery and components UI folders.

## Report
Keep it short:
- changes by file;
- the contract sections you added;
- the qualification suite counts at the exact head;
- the tests you changed, and why;
- anything not done.

Last line: `branch work/hq-b3-design-export-20261103, head <sha>`.

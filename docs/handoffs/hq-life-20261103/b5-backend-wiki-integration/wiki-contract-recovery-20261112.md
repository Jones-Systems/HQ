# WIK-CTR source recovery

Artifact Type: source-receipt
Purpose: Hand the additive Wiki contract recovery to the integration owner and serial Mini verifier.
Authority effect: none

## Source binding

- Repository: `Jones-Systems/HQ`; task branch `work/hq-recovery-wiki-contract-20261112`.
- Foundation base: `8945d156585510fbdf1515fad01798f416146b4e`.
- Accepted amendment: `e9db4f61b0688f3727e4be4e37d00521131fc6f3`, `docs/engineering-specs/hq-integration-parallel-execution.md`, recovery outcome, writers, capsules, execution and assembled-head acceptance sections; accompanying resume Work Note read.
- Original B5 handoff and its partial W4a review read from `work/hq-backend-wiki-integration-20261103`.
- Retained contract predecessor `a4ec7dec1d2e73a29ab1ac6128c37b9f44ced86a` is the parent of runtime checkpoint `0a5f819b6b6cd7cb68df19bd67d4ef1b77db4ae1`; common base with foundation is `0cd50abc974320771cc21145dc8a8fd58a3eb8b1`.
- Ordinary merge `068e4ea7b0e766bc929e122354591eab7790ce8c` has foundation and retained runtime checkpoint as its parents. Preflight merge-tree reported no conflicts. All 19 incoming paths were in the explicit grant; no incoming paths were excluded.
- Merge and recovery documentation commit use explicit public Codex author/committer identity. Retained commits are unchanged.

## Files and behavior carried as source

- `modules/wiki/contract/`: README, `src/{index,limits,page,records}.ts`, `test/records.test.ts`.
- `modules/wiki/core/src/{analyze,build,draft,host,index,markdown,namespace-index,profile,snapshot}.ts`.
- `modules/wiki/core/test/{backlink-context,index}.test.ts`, `modules/wiki/app/test/client.test.ts`, core README and this receipt.

Optional backlink `via` and `excerpt`, and topic `pageTitles`, are retained exactly as originally built. Validators remain closed; old payloads remain representable and the seven service methods stay unchanged. Core snapshots retain strictly validated link origins and deterministic ordering, with rules version 2. The README explains the persisted per-namespace rebuild on next refresh, conditional on successful store write and unchanged commit/profile; failed writes or invalid caches can repeat it. Historical synthetic size figures are explicitly historical, not current recovery or private-corpus measurements.

The current foundation's Git source, desktop runtime, validation scripts/configuration, renderer and shared contracts are untouched. No other worktree or unpublished validation checkpoint was used or changed.

## Static evidence only

- Clean assigned branch at the exact foundation before mutation.
- Predicted merge tree: `c602c9c4fba0e036e7655ebf6ab8e96f626f7071`; all 19 incoming paths checked against the literal cone.
- All 108 relative import targets in incoming TypeScript files exist in that tree.
- All 17 changed TypeScript files pass `node --check`, syntax only, on available Node `v26.12.1`. No imports/application/test code executed; this is not Node 24.19.0 CI evidence.
- `git diff --check` passes. Both retained commits remain ancestors. Git source and desktop runtime compare byte-identical to foundation.
- No builds, tests, installs, servers, app/browser/native launches, private corpus access, PRs, merge into integration/main or operational effects performed. Shared bridge is absent; supplied host snapshot and HQ rules were used.

## Serial verifier handoff (unrun)

After the existing heavy-slot release and fresh admission, use the campaign's single Mini verifier, pinned Node 24.19.0/Python 3.13.5 and compiler-controller rules. Bind to the final pushed task SHA supplied with this receipt, then to the assembled head for acceptance.

1. Full Wiki discovery via the existing package test command, including contract, core, app and UI consumers. In particular exercise `contract/test/records.test.ts`, `core/test/backlink-context.test.ts`, `core/test/index.test.ts` and `app/test/client.test.ts`.
2. Core typecheck (`tsc -p modules/wiki/core/tsconfig.json --noEmit`) plus root typecheck/build and required fast discovery under the coordinator's queue. Do not treat syntax checking here as a substitute.
3. Synthetic stored version-1 snapshot rejection/rebuild and version-2 reload without source reads; strict origin rejection, deterministic snapshots, raw-page fallback, sorted/capped provenance, inert excerpts and parallel topic titles. Existing retained tests cover these seams; execution remains unrun.
4. On the assembled native head, committed synthetic Wiki indexing/recovery/backlinks/status and Planner reference round trip. Measure stalls before deciding on the held worker-host follow-on. No private corpus execution is authorized here.

## Shared hunks and deferred findings

No shared hunk is requested: no new methods, IPC, shared contract, desktop wiring, package/config, workflow or acceptance registration changes are needed for this capsule. Wiki UI adoption belongs to WIK-V; validation tooling and its README additions belong to WIK-VAL and must be composed without replacing this README's additive section.

The partial W4a review remains incomplete. Its P2 excerpt-window finding is intentionally unrepaired: the first 160 UTF-16 units of the block may omit a late link. Its P3 contract-README older-snapshot wording and P4 findings remain unselected, including tight-list fallback context, duplicated field-name rules, text rendering concerns, table context and validated-snapshot guard observations. The core README's original lower-severity excerpt note does not supersede the independent P2 severity. No automatic P2–P4 repair was made. Historical test totals in retained documentation do not qualify this recovery head.

Source completion is not behavior qualification, contract acceptance, integration, activation or release readiness.

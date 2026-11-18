# SOC-X source checkpoint

Authority effect: none. Source implementation only; no behavior qualification or activation.

Implementation commit: `83e1c5bbca06d3badad704c9ab6b066b4c3725f4`.
Branch: `work/hq-recovery-social-extensions-20261112` in canonical `Jones-Systems/HQ`.
Base: SOC-V `fe2faa3e59e2f64548fe5e442d17556c5419b223`.
Accepted amendment read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.
Listener `fa2728a9d8ed90abd7b6980c905d805fed5c96a0` was already an ancestor of the assigned base. Merge-tree reported no conflicts and ordinary merge returned already up to date; no dependency files were replaced or additional merge commit fabricated. Sole task-worktree Git ownership and clean base were verified. Explicit public Codex identity was used for commits.

## Source

- `services/social/social_service/{extensions,service,store,runner,server,__main__}.py`: additive schema v2; persisted brand project set/clear, closed supplied-source kinds and exact UTF-8 digest, parsed-content read/archive, metadata snapshots and run provenance; default-off simulator with local provider seam, exact version/hash approval, invalidation, cancellation and one-shot outbox delivery. Run source IDs are inserted atomically with their run. Approval durably prevents replay before file I/O, syncs/readbacks the local outbox and records only simulated receipts; interruption can leave `failed` plus an uncertain local outbox, requiring explicit reconciliation.
- `modules/social/core/{extensions,fixture-extensions,fixture,port,index}.ts`: additive extension types and fixture methods; base legacy ports remain valid; fixture defaults are unchanged. Simulator fixture state is in memory and does not model disk failure or restart persistence.
- `modules/social/live/{extension-guards,guards,port,transport}.ts`: capability-absent local invalid rejection without transport; workspace/response guards, closed route/parameter source, source provenance submission and execution-class approval with unknown-on-loss and no adapter retry.
- Matching service/client test source, wire stub, authored extension exchanges, six additive baseline golden expectations and SHA manifest; service and contract documentation. Baseline golden expectations were edited statically for specified fields and byte lengths, not recaptured. Real generator equality remains unproved.

## Defaults and guards

The service advertises `hq-brand-project-v1` and `hq-sources-v1` only after storage initialization succeeds. New brands have null project mappings. Sources are supplied JSON/JSON Lines only; nothing is collected. Empty as-of derives from a top-level supplied `as_of` when present, otherwise null. Metadata is capped at 500 sources with latest 20 associated runs; content is read separately. Source shape validation checks the specified top-level import slot shape; analyzers retain their separate semantic input validation.

Publishing stays off unless the service is explicitly started with `--publishing simulator`. Off mode has no feature, workspace publishing block or publishing routes (404). Only the simulator provider exists: no network, accounts, tokens or credentials. Requests snapshot content/version, only approval delivers, and nothing automatically retries. Simulator delivery allocates persistent sequence numbers; failed writes may leave sequence gaps. Desktop startup/settings/activation were not changed.

Workspace-scoped Social/Work references, listener implementation, rendered views/navigation/content/workbench, shared contracts and desktop encoding/settings/acceptance/workflows remain unchanged. No recorded B2-F5/F6 or other unselected finding was selected for repair.

## Static evidence and unrun verification

Passed: changed Python AST parsing (13 files); changed TypeScript `node --check` syntax parsing (11 files); changed JSON parsing (7 files); 21 baseline exchange manifest hashes and response byte-length consistency; `git diff --check`. A final AST check also covers outbox directory sync/readback. These checks execute no application or test code. The host Node used solely for syntax parsing is v26.12.1; it is not CI-version behavior evidence.

Semantic TypeScript checking was unavailable: this checkout has no installed TypeScript module. No dependencies were installed. No builds, tests, service/server/app/browser/native launches, real data, account/provider calls, activation, signing, installation, deployment, PR or foundation/main merge occurred. The earlier unknown baseline launch remains with its originating owner.

Tests authored (unrun):

- `services/social/tests/test_extensions.py`: authored extension exchanges; off-mode no advertisement/404; idempotent brand mapping and UTF-16 limits; source digest/read/duplicate/archive/provenance/restart; strict keys, invalid shape/filename/dates, JSON Lines diagnostics, all twelve kinds; exact approval/hash/repeated refusal/restart; changed-draft invalidation/cancel; outbox sync failure with no replay.
- `modules/social/live/test/extensions.test.ts`: fixture and live-wire extension conformance, absent capability rejection, source duplicate/archive/provenance, exact one-shot approval, snapshot invalidation and accepted approval with lost response remaining unknown and exactly one transport attempt.
- `modules/social/live/test/wire-stub.ts`: additive synthetic extension route parity.

Existing assertion updates (unrun): service `test_server.py`, `test_launch.py`, `test_drafts.py`, `test_persistence.py`, `test_runs.py`, `test_store.py` for the specified additive fields/features/schema and refusal of unsupported real providers. Assertions were updated from the settled contract; no test was removed/skipped or failure oracle weakened.

Serial verifier queue: focused extension Python cases; complete Social Python discovery including retained concurrency tests; `contract/generate.py --check` real HTTP equality and manifest; root semantic typecheck; Social core/live conformance and full root checks on the assembled integration head; real-service preload/main end-to-end coverage after shared integration. Use the campaign's CI versions/admission and one serial process. Source and fixture-wire parity do not establish real transport, crash/restart, native or installed behavior. Crash-boundary disk faults and concurrent approval/save require verifier coverage beyond the authored happy/error cases.

## Shared integration request

[INT-request.md](INT-request.md) is the exact operation/body/guard/class/token-refresh request. INT must coordinate the WSP-owned encoder: expand shared contracts and closed Social routes, encode IDs only into the fixed paths, preserve caps and errors, allow one token refresh only for the listed content operations and zero refresh/replay for approval/submission. No new Electron main construction/channel/startup hunk is needed. Real-provider and normal-startup simulator enablement remain absent. The client cannot use the new operations through the currently unchanged shared desktop bridge until these hunks are integrated.

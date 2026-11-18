# B1-T: re-verify the HQR Planner pull requests and build their composite

You are a builder in lane B1 (HQ backend: Planner service and Work live connection). The lead (Opus) reviews your
branches and opens every pull request. Your worktree is on new branch `work/hq-planner-hqr-composite-20261103`,
created from `origin/work/hq-foundation` (expected `0cd50abc974320771cc21145dc8a8fd58a3eb8b1`; record what you get).

## Background

Eleven open "HQR" review-and-fix pull requests from 2026-10-20 harden the Planner service (`services/planner`), its
legacy web client (`services/planner/public`), the agent CLI (`tools/hq-cli`) and their tests. Each was green in CI
against an older foundation and is textually mergeable, but none has been checked against the current foundation.
Merges are held for the integration owner; your job is evidence and a ready composite, not merging.

| PR | Head ref | Head SHA | Scope |
| --- | --- | --- | --- |
| #80 | `review/hq-main-a4-contract` | `6dd4694b4f8b7628847646de8be5671d777cb3cd` | contract generator/test hygiene, zero contract bytes |
| #81 | `review/hq-main-a1-store` | `307a228b11c1f6673e67ee757a6262352fea4cfc` | `planning/store.py` |
| #84 | `review/hq-main-a2-server` | `6530b5eeba8d40da1e23bcfdbc776fd03977d80f` | `planning/server.py`, `__main__.py` |
| #89 | `review/hq-main-a3-validation` | `89098b293b214282702fa4d3ecc26377e7357656` | `planning/validation.py`, `dates.py` |
| #94 | `work/hqr-a9-harness-20261020` | `f9648bb2eb3fbb9ccb705fdb1284007ee540481c` | test harness, check groups, CLI e2e |
| #82 | `review/hq-main-a8-cli-writes` | `e72ce522bfd8b22b77a3e77f14bc9ffaa1c7c242` | CLI writes and dates |
| #86 | `review/hq-main-a7-cli-transport` | `330c0e85db047127f9f8c13d185602c32f6f49af` | CLI transport and intent files |
| #93 | `review/hq-main-a5-client-core` | `7a4213d0b0a8c46d445b81bc19e6587830aca37e` | legacy client core JS |
| #102 | `work/hqr-a6-client-views-20261020` | `31f86615201a28c0796df851770f25593d2b604a` | legacy client views/CSS |
| #83 | `review/hq-main-a10-docs` | `4bcae77232c584b1e2370875c559398a11b47055` | Planner/CLI docs |
| #85 | `work/hqr-a4-contract-captures-20261020` | `b3597e9d02c2c44161cadd48919011f65609c833` | contract captures 28–42 (stacked on #80; HOLD) |

Read each PR's description (`gh pr view N`) before you work on it; they list their own checks, deferred findings
and cross-lane requests. Fetch heads with `git fetch origin <ref>` and confirm the SHA matches the table; report any
difference instead of proceeding with it.

## Tasks

1. **Per-PR verification on the current foundation.** For each of #80, #81, #84, #89, #94, #82, #86, #102 (and the
   original #93 and #83), make a local scratch branch `verify/pr-<N>-20261103` from `origin/work/hq-foundation`,
   `git merge --no-ff --no-edit <head SHA>`, record whether the merge was clean, then run serially:
   Planner Python and Node suites; `PYTHONDONTWRITEBYTECODE=1 python3 contract/generate.py --check` (from
   `services/planner`); `HQ_CLI_E2E=1 npm test` (from `tools/hq-cli`); and from the root
   `node_modules/.bin/vitest run --maxWorkers=4 modules/work/live apps/desktop/src/live-services.integration.test.tsx`
   (the Work-live tests pin the contract exchange bytes; the integration test drives the real Planner). Do not push
   scratch branches.
2. **#93 needs a fix.** It edits `services/planner/public/js/ordering.js`, `dates.js` and `model.js`. `spec.hq-agent-cli`
   (requirement 3 and F acceptance) keeps those three files byte-equal to Work's pinned copies in
   `modules/work/core/upstream/manual-planner/` (SHA-256 listed in `services/planner/PROVENANCE.md` under "Work upstream
   equality"). Create branch `work/hq-hqr-a5-client-core-successor-20261103` from #93's head, merge
   `origin/work/hq-foundation` forward, then: restore those three files to their pinned bytes; keep #93's behaviour
   fixes by moving any that depended on those edits to the callers (for example pass an explicit bottom anchor where
   #93 changed `projectMove`'s default); keep its tests meaningful (adapt a test only to the new location of the same
   behaviour); and add a small test under `services/planner/tests/` that fails if those three files stop matching the
   pinned SHA-256 values. Run the Planner suites and the CLI suite. Push this branch.
3. **#83 refresh.** Create `work/hq-hqr-a10-docs-successor-20261103` from #83's head, merge the foundation forward,
   and correct statements that are now false on the foundation (for example "main has no hosted CI": the foundation
   has `.github/workflows/foundation.yml`, `cli-planner.yml` and others). Then apply the factual documentation deltas
   that the other HQR descriptions request for code that is in the composite (look for "Doc deltas for HQR-D1",
   "Cross-cone findings" aimed at A10, and README suggestions in #81, #84, #93, #94, #102). Documentation only. Do not
   edit the `services/README.md` sentence about the Work live adapter and desktop connection; the lead changes it.
   Push this branch.
4. **#85 successor with the Work-live re-pin (held).** Create `work/hq-hqr-a4-captures-successor-20261103` from #85's
   head and merge the foundation forward. #85 rewrites `15-batch-dry-run.json` and adds exchanges 28–42 under
   `services/planner/contract/`. Re-pin the Work copies: update `modules/work/live/test/contract/exchanges/`,
   `SHA256SUMS` and `PROVENANCE.md` there to match, extend `modules/work/live/test/contract.test.ts` or the transcript
   tests only as needed so the new exchanges are checked the same way as 01–27, and run every suite that reads the
   contract (Planner, `generate.py --check`, CLI with `HQ_CLI_E2E=1`, root vitest for `modules/work/live`). If an
   exchange exposes a Work decoder gap, report it rather than editing `modules/work/live/adapter.ts` or `wire.ts`
   (another builder owns those). Push this branch. It stays held for owner acceptance.
5. **Composite.** On your branch `work/hq-planner-hqr-composite-20261103`, from the foundation, forward-merge with
   `git merge --no-ff --no-edit` in this order: #80, #81, #84, #89, #94, #82, #86, the #93 successor head, #102, the
   #83 successor head. Resolve any conflict minimally and describe it. #94 marks three cross-component CLI e2e cases
   as `todo` until #89 (A3) merges: enable the ones whose prerequisites are now in the composite (keep a case `todo`
   only if it still needs something absent, and say what). Then run the full required-check union locally: root
   `npm run build`, `node_modules/.bin/vitest run --maxWorkers=4`, `npm test --workspace @hq/wiki`,
   `node --test --test-concurrency=1 'tests/acceptance/**/*.test.mjs' 'tools/storage/test/**/*.test.mjs'`, the Planner
   suites, `generate.py --check`, and `HQ_CLI_E2E=1 npm test`. Push the composite branch.

Do not implement the deferred P2–P4 findings or cross-lane code requests listed in the descriptions; list them in
your report under "Recorded, not implemented". Do not touch `modules/work/core`, `modules/work/live/*.ts` (other than
tests named in task 4), `apps/desktop` or `packages/contracts`.

## Report

A table per PR: head SHA, clean merge or conflict, each check with exact counts, and your verdict: land-ready, needs
fixes (what), or superseded. Then the three successor branches and the composite: head SHAs, merge order, conflicts
resolved, enabled `todo` cases, and full check results.

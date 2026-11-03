# R0 foundation binding (`task.bind-foundation.001`)

Authority effect: none. This is the evidence for `ac.foundation-baseline.001`. The full record is `spec.hq-social-work#ctx.foundation-binding-record.001`.

| Item | Value |
| --- | --- |
| Bound source | `work/hq-foundation` `33dfe44d6786b40ac8a5dcb5442d85c20da38c67` |
| Accepted head | `35f9a3e1fd0561335737ea47f6a680e74a5ad0e7` (PR #2). It is a guidance-only merge of PR #5 onto `33dfe44`. |
| Source equivalence | `git diff 33dfe44..35f9a3e` changes only `AGENTS.md`, `CLAUDE.md`, `.gitignore` and `docs/shared-agent-guidance.md` |
| Rebind | None. The registry, `@hq/contracts` exports, workspaces, scripts, `tsconfig` and Vitest configuration match the plan. |
| Custody | T0's handoff is on issue #1 (comment 6279970589), verified by the root. The R1 paths are assigned to T1. `App.tsx` and `styles.css` are released but unassigned. `tests/check-groups.toml` is not transferred. |
| Shared guidance | `.agents/shared-guidance.md` is absent in this checkout, so enrollment is reported unavailable |

**Checks on the unmodified `35f9a3e` tree, 2026-10-20, after telemetry admission** (CPU 20.25%, 38.34 GiB RAM available, serial test ceiling 1):

- `npm ci` added 123 packages;
- `npm test` passed 25 tests in 3 files, matching T0's report.

Native Electron launch and Mac packaging and signing remain unverified, as T0 reported.

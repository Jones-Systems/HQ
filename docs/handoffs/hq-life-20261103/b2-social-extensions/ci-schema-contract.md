# Social CI schema and contract source checkpoint

Authority effect: none. Source completion only; behavior and real HTTP capture remain unqualified.

Repository: `Jones-Systems/HQ`. Dedicated branch: `work/hq-recovery-social-ci-schema-contract-20261112`.
Base: `9fc113c2d3ee9b8168f48f5e9f1eea636f143068`.
Implementation: `d5a19b6490e64b55e1688469cac4282503096263`; this receipt is a subsequent documentation checkpoint.
Explicit public Codex commit identity; retained ancestry, no merges or history rewriting.

Accepted recovery amendment read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`: `ctx.recovery-outcome.001`, `arch.recovery-writers.001`, `task.recovery-capsules.001`, `arch.recovery-execution.001`, `ac.recovery-assembled-head.001`, plus its current-state work note. Fetch observed the coordination branch subsequently at the assigned base. Local shared-guidance bridge absent; supplied immutable guidance used without enrollment changes. B2 `source-receipt.md`, `INT-request.md` and `shared-bridge-source.md` read. Implementation-role fallback: codex-v3-builder scope, explicit Blended Frontier Max pin, captured preference revision 11, Sol/high, default service tier, no Fast; no child agents.

## Selected failure source and fixes

Provided hosted evidence: PR #213 head `580a72a4d4f40b9f396cee09b89bc4b196996b17`, run `43246359052`, job `131279961062`: 525 tests in 45.388s, two failures and one error. Burst admission was not reported failing. This checkpoint does not rerun or certify that evidence.

- `services/social/tests/test_runs.py`: crash fixture names the seven original INSERT columns, allowing the additive `source_ids TEXT NOT NULL DEFAULT '[]'` migration default. Adds an empty-source assertion for both interrupted records. Existing status/error, finished timestamp, untouched completed run, ordering and freed-queue assertions are retained.
- `services/social/tests/test_server.py`: brand response keys include `project_id`, asserted null. Existing creation status, trimmed name, ID, case-insensitive ordering and duplicate-name expectations remain. Workspace brands additionally check exact field order, null project mapping and valid generated IDs; supplied sources remain exactly empty for this no-import scenario.
- `services/social/tests/test_contract.py`: retains one real capture, checks the complete identical file keyset, then uses sorted per-file subtests with full `maxDiff` and exact UTF-8 bytes against `read_bytes()`. Nothing is filtered, normalized, skipped or retried. This also avoids universal-newline normalization of golden files.

## Bounded static golden derivation

SOC-X retained checkpoint `90a3098684f4824508f16ea674388afbeeb218b5` carries the manual adaptation from implementation `83e1c5bbca06d3badad704c9ab6b066b4c3725f4`. Its receipt explicitly leaves real capture unproved. That implementation appended `source_ids` after `output` in both finished-run goldens.

The exact source chain at this task base establishes the opposite order:

1. `social_service/store.py::_run` constructs the seven existing fields, then unions `source_ids`. `Store.get_run` returns that dictionary.
2. `social_service/service.py::get_run` obtains that dictionary and then appends `record['output']` for a finished run with output.
3. `social_service/server.py::_json_bytes` serializes without key sorting; response Content-Length is the resulting byte count.
4. `contract/generate.py::capture` preserves parsed response order; `rendered` uses `json.dumps(indent=2, ensure_ascii=True)` without sorting and a final newline.

Only `12-run-succeeded.json` and `13-run-failed.json` move `source_ids: []` immediately before `output`. No values, nested structures, request, response headers, feature flags, clock, IDs or other fields change. These order-only changes preserve both rendered file lengths (1093 and 1005 bytes) and compact HTTP body lengths (313 and 295 bytes). Their SHA256SUMS entries alone change:

- `12-run-succeeded.json`: `abfdfb808c4c4c5a250c92c47892547d5244d8781202055b0b01dc94f2bc3a89`
- `13-run-failed.json`: `ecf50534116a9f72b71afe606e7ed82a6d6972a2a210ddd6e501350709b5f9da`

The other additive manual expectations agree with the inspected source: workspace brand mappings null, source list empty, features ordered timebox/references/brand-project/sources, publishing absent by default, run provenance empty. Those 19 exchange files remain byte-identical. Static reasoning supports the two bounded order corrections; it does not prove these are the only differences in an actual hosted capture.

## Static evidence and remaining qualification

Passed without importing or executing application/test modules:

- Python AST parsing: all three edited tests and unchanged generator.
- JSON parsing, exact complete manifest keyset and SHA-256 verification for all 21 exchange files.
- Compact UTF-8 body-length arithmetic matching all 21 stored Content-Length headers.
- Baseline comparison: all decoded JSON values unchanged, 19 files byte-identical, two order-only with unchanged lengths.
- `git diff --check` and scoped final diff inspection. Commit/push hooks inspected; no executable hooks present for those effects.

No tests, builds, generator/capture/service execution, dependencies, app/browser/native launches, real data, provider calls, activation, signing, installation, deployment, PRs or foundation/main merges. No timeout, skip, retry or failure-oracle relaxation. Publishing remains off; unknown baseline reconciliation and the occupied heavy slot remain with their existing owners. Recorded non-finite-number and other unselected P2–P4 findings are untouched.

Later verifier: focused Restart and brand cases, full Social discovery including unchanged burst admission, and real `contract/generate.py --check` under accepted serial admission and CI versions. Hosted CI must confirm actual capture parity; any further drift should now identify the exact file and full differing bytes.

## Shared hunk requests

None from this task. No production module, renderer, root, workflow, shared contract, generator source or extension-exchange source changed. Earlier SOC-X shared bridge requests retain their separate disposition; this checkpoint requests no module pin or additional shared edit.

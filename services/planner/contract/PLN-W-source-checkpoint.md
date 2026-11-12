# PLN-W source checkpoint

Authority effect: none. This records source preparation; runtime verification and publication remain with the integration owner.

Baseline: `8945d156585510fbdf1515fad01798f416146b4e` in Jones-Systems/HQ.
Task branch: `work/hq-recovery-planner-wiki-20261112`.
Retained source: `26b4928` on `work/hq-planner-wiki-references-20261103`.
B1 handoff read from `origin/work/hq-backend-planner-20261103:docs/handoffs/hq-life-20261103/b1-planner.md`, especially B1-W and the held #85 collision.

Only the Planner and CLI domain allowlists change in production. Both target and return-destination domains accept Wiki. All existing validation, feature gates, HTTP semantics and revision guards remain in place. The current HQR regressions are retained; no stale ancestry is imported.

The 52 original reference cases are unchanged. Fourteen additions cover Wiki, cross-domain return destinations with remote provenance, and malformed Wiki envelopes. Work's copies and pins match the service. All 27 existing HTTP transcripts remain byte-identical, including their strict replay/HTTP assertions. No #85 captures are imported. Work's additional wire-field assertion checks remote target provenance independently of the source item's title; no project/source association is inferred from matching strings.

## Static evidence

- Python AST parsing of changed Python files: passed.
- `node --check` on CLI schema, CLI reference/E2E tests, Planner reference Node test and Work contract test: passed (host Node v26.12.1; syntax only, no behavioral qualification).
- `git diff --check`: passed.
- Static write-cone audit, all original vector cases unchanged, SHA-256 manifest integrity, Work/service byte equality and 27 baseline exchange comparisons: passed.
- No tests, builds, installs, servers or app launches were run. No PR was opened.

## Contract preimages and new pins

Both service and Work copies started from these exact preimages:

| File | Preimage SHA-256 | Preimage Git blob |
| --- | --- | --- |
| reference-vectors.json | `94f030e550d4c7d6bb823836dcfed75a7d86b1c1442dd3efc748dee2389ba5a1` | `73d4da4b924c79f6b493b2af4ff2d54ca3691f23` |
| SHA256SUMS | `dafe2da70363b4db60b9bc5d5466a6c77097369f896fbbb7c1ac56f1c5c7733b` | `41a4e19903676574b5082e29cb838451a4824775` |

New vector SHA-256: `ebc01c0a4f9f503342279911390a9e69c0f03e352360fdcff269047b0428d0bc`.
New manifest SHA-256: `e06ebfd0278431efa3e6662acecb98dbde0743bf2c3f7a9e2e167c6ebb0e3921`.
Git blobs and sizes are pinned in Work's `contract/PROVENANCE.md`.

## Deferred verification

After allocation of the serial Mini/Apple Silicon slot, use Node 24.19.0 and Python 3.13.5. These commands are unrun on this checkpoint:

From `services/planner`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -t tests
node --test --test-concurrency=1 'tests/*.test.mjs'
PYTHONDONTWRITEBYTECODE=1 python3 contract/generate.py --check
```

From `tools/hq-cli` (real Planner opt-in is required):

```sh
HQ_CLI_E2E=1 npm test
```

From the repository root, affected Work and shared parser coverage:

```sh
node_modules/.bin/vitest run --maxWorkers=1 modules/work/live packages/contracts
```

The integration owner still owns the full required fast-check family before publication/integration. Static evidence does not establish the real Planner roundtrip, native behavior, CI, release or installation readiness.

## Changed files

- `docs/engineering-specs/hq-agent-cli.md`
- `modules/work/live/test/contract.test.ts`
- `modules/work/live/test/contract/PROVENANCE.md`
- `modules/work/live/test/contract/SHA256SUMS`
- `modules/work/live/test/contract/reference-vectors.json`
- `services/planner/README.md`
- `services/planner/contract/README.md`
- `services/planner/contract/SHA256SUMS`
- `services/planner/contract/build_vectors.py`
- `services/planner/contract/reference-vectors.json`
- `services/planner/planning/validation.py`
- `services/planner/tests/hq_references.test.mjs`
- `services/planner/tests/test_references.py`
- `tools/hq-cli/src/schema.ts`
- `tools/hq-cli/test/e2e/planner.test.mjs`
- `tools/hq-cli/test/references.test.mjs`
- `services/planner/contract/PLN-W-source-checkpoint.md` (this receipt)

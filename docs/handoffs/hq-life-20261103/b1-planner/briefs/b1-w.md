# B1-W: accept HQ references to Wiki pages in the Planner, the CLI and the pinned vectors

You are a builder in lane B1 (HQ backend: Planner service and Work live connection). The lead (Opus) reviews your
branch and opens the pull request. Your worktree is on new branch `work/hq-planner-wiki-references-20261103`,
created from `origin/work/hq-foundation` (expected `0cd50abc974320771cc21145dc8a8fd58a3eb8b1`; record what you get).

## Problem

`@hq/contracts` `DOMAIN_IDS` is `['design', 'social', 'work', 'wiki']`, and Work's reference parsing (`parseReference`
in `packages/contracts`) accepts Wiki targets. The Planner does not: `services/planner/planning/validation.py`
`_HQ_DOMAINS = ("design", "social", "work")` is used for both the target domain and the `returnDestination`
domain, so saving a Work card that links a Wiki page fails the whole save with "Reference N has an invalid HQ
target." The agent CLI has the same list in `tools/hq-cli/src/schema.ts` (`referenceDomain`), so once the Planner
accepts Wiki references the CLI would reject items that carry one. Lane B5 is registering a Wiki reference provider
now. `spec.hq-agent-cli` line 229 says to validate targets "exactly like unchanged `parseReference`" and also lists
"domain design/social/work".

## Tasks

1. Planner: add `"wiki"` to `_HQ_DOMAINS`. Check every other place in `services/planner` (Python, the legacy client
   under `public/`, README) that names the HQ reference domains, and update the ones that must agree. The legacy
   client must render a Wiki reference like the others.
2. Vectors: in `services/planner/contract/build_vectors.py` add a `domain-wiki` accept case next to `domain-social`
   and `domain-work` (same construction), regenerate the contract outputs with the repository's generator (read
   `services/planner/contract/README.md` for the exact command), and confirm `generate.py --check` passes. Only
   `reference-vectors.json` should change among generated files; if anything else changes, stop and report.
3. Planner tests: a Wiki target accepted on create and patch, round-tripped through get/state and export/import v1,
   and a Wiki `returnDestination`; keep the existing rejection cases (an unknown domain is still rejected).
4. CLI: add `'wiki'` to `referenceDomain` in `tools/hq-cli/src/schema.ts`; check the CLI's own reference input
   (`--ref` or similar), help text and README for domain lists; add a CLI test that writes and reads back a Wiki
   reference (the vector-driven tests pick up the new case automatically; make sure they do).
5. Work's pinned copy: copy the regenerated `reference-vectors.json` to `modules/work/live/test/contract/`, update
   `SHA256SUMS` there, the `SUMS_SHA256` constant in `modules/work/live/test/contract.test.ts`, and `PROVENANCE.md`
   (follow how earlier re-pins recorded their source; name this branch and commit as the source). Do not change any
   Work production code. If Work's tests show that `parseReference` rejects the Wiki vector, stop and report.
6. Spec: amend `docs/engineering-specs/hq-agent-cli.md` line 229 so the domain rule reads as the `DOMAIN_IDS` of
   `@hq/contracts` (today design, social, work and wiki), keeping "exactly like unchanged `parseReference`". Add one
   short dated note in that document's change or decision log if it has one (look first); otherwise only the line.
7. Conflict check: this branch will be a small PR against `work/hq-foundation`, merged independently of the open
   Planner pull requests. Test-merge it (in a throwaway local branch, never pushed) with #89
   (`89098b293b214282702fa4d3ecc26377e7357656`, validation), #80 (`6dd4694b4f8b7628847646de8be5671d777cb3cd`,
   contract generator) and #85 (`b3597e9d02c2c44161cadd48919011f65609c833`, contract captures and SHA256SUMS), and
   report each as clean or conflicting, with the conflicting hunks.

## Checks

From `services/planner`: the Python and Node suites and `PYTHONDONTWRITEBYTECODE=1 python3 contract/generate.py
--check`. From `tools/hq-cli`: `HQ_CLI_E2E=1 npm test`. From the root: `npm run typecheck` and
`node_modules/.bin/vitest run --maxWorkers=4 modules/work/live packages/contracts`.

## Boundaries

Edit only `services/planner/**`, `tools/hq-cli/**`, the four pinned files under `modules/work/live/test/`
(`contract/reference-vectors.json`, `contract/SHA256SUMS`, `contract/PROVENANCE.md`, `contract.test.ts`), and the
one spec line. Nothing in `packages/contracts`, `modules/work/core`, `modules/work/live/*.ts`, `apps/**`, or the
Work UI directories.

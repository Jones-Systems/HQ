# HQ working agreements

For UI work, read the [partial UI map](docs/ui-map/README.md), its affected entries and shared consumers; the index links to maintained frontend guidance. Keep untested entry points explicit.

At startup, read `.agents/shared-guidance.md` when present. It is the locally delivered Universal Agents / Codex V3 bridge; follow its pointers to the exact shared-method snapshot. Combine that guidance with the HQ agreements below. HQ owns its product, local roles and lane boundaries. If the bridge is absent, report shared enrollment as unavailable and follow these local agreements; do not claim current shared guidance or install a replacement implicitly. See [shared guidance setup](docs/shared-agent-guidance.md) for enrollment and verification.

HQ is one Electron application with Design, Social and Work domains. M Jones owns product decisions. Each implementation lane has an explicitly assigned scope and isolated non-main worktree. Its agent is sole Git owner there. Preserve unrelated changes; never reset/clean or rewrite history. No sudo, deployment, signing, credential access or private-data access without exact separate authorization.

Read docs/engineering-specs/hq-bootstrap.md and the assigned campaign plan before work. Root configuration, lockfiles, shared contracts and desktop packaging have one coordinating owner. Module lanes edit only their assigned directory and lane-local tests/docs. Propose shared changes through the coordination issue; do not edit other lanes. Work card movement, reference navigation and domain switches never launch work.

This is a public repository. Do not copy private source, personal data, internal host addresses, session history or credentials into it. Existing private implementations may inform bounded interface research; importing actual files requires a selected-file licensing and publication decision.

Use meaningful focused tests and inspect final diffs. Source completion, checked behavior, source integration and installed app are distinct. No automated PR reviewer bots. Publication of an assigned candidate is authorized; merge is held for integration-owner agreement. Record exact commits and check results. Report unknown dispatch effects without retrying them blindly.

## Required checks and test placement

The following fast checks are required for ordinary source merges into main or an integration base wherever these workflows are present:

- `Foundation typecheck, tests and build`: full root typecheck, renderer/Electron build, root Vitest discovery, Wiki Node tests, and portable acceptance-fixture and storage lifecycle Node tests. CI builds once and runs Vitest directly against that same checkout's Electron output; local `npm test` still builds its own prerequisite.
- `CLI Node tests and synthetic Planner E2E`: full CLI discovery with `HQ_CLI_E2E=1`, including the disposable real Planner service. The synthetic E2E is part of this fast required check.
- `Planner contract, Python and Node tests`: full Python and Node discovery, including `test_contract`'s real HTTP capture, reference-vector and manifest checks. CLI and Planner need no root dependency install.
- The existing Design family: `Design section inventory`, every emitted `Design section (<id>)` job, and `Design sections`. Keep the inventory's complete coverage and the fan-in's requirement that inventory and all selected section jobs succeed; preserve the separately owned Design batching workflow.

Foundation and CLI/Planner run on PR open, code synchronization, reopen and ready-for-review events, across all target branches and changed paths, plus manual dispatch. They do not repeat on main pushes or metadata-only edits. Full discovery is the conservative default, including unknown/global changes and dispatches; do not add path or draft skips that silently remove required signals. A cancelled, skipped, missing or timed-out check is not passing execution evidence. Report any test-level skips explicitly; CLI qualification requires the real Planner opt-in, not a skipped E2E. Keep Node 24.19.0 and Python 3.13.5 until a separately verified version change.

No required job may exceed 6m30s; foundation and CLI/Planner use six-minute timeouts. Preserve the historically sub-two-minute fast-feedback target and concurrency cancellation. Compare actual execution and queue-inclusive completion separately; a timeout setting is not measured performance. Diagnose failing tests before changing them, and never weaken, skip or delete a test just to get green. Every retained test needs a suitable trigger; portable acceptance fixtures and storage tests belong in fast PR CI, while native journeys and packaging belong in their owned nightly, explicit label/dispatch or manual release qualification tier.

Native, package, nightly and other checks outside the required fast family are advisory for ordinary source merges. Fix or track advisory failures; advisory status does not certify native behavior, package acceptance or release readiness. Preserve all reserved acceptance obligations and foundation-to-main, release, signing, deployment and installation holds. The owner's October 24, 2026 authorization permits only qualified scoped integration-successor merges into the relevant integration bases for the overlaps in #2/#94/#82/#86/#135/#138/#141/#142. It does not authorize merging or closing those existing PRs, advancing foundation to main, changing protections, or releasing/installing the app. Apply the integration owner's exact scope and readback gates; green checks alone grant no merge authority.

# SOC-C Social core (`task.social-core.001`)

Authority effect: none. This is the lane evidence for `spec.hq-social-work#ac.social-core.001` and `spec.hq-social-work#test.social-core.001`. It produces `spec.hq-social-work#iface.social-port.001`.

## Binding and preflight

| Item | Value |
| --- | --- |
| Branch | `work/hq-social-content`, an isolated linked worktree with one Git owner (this lane) |
| Start | `cfdab378e28940662ddb6e731264afca164a1957` (R1); the accepted foundation `35f9a3e` is an ancestor |
| Plan | `spec.hq-social-work` read at `cfdab378e2…` through the section reader. Sections read: `task.social-core.001` and its context, requires, acceptance and test refs, plus `iface.domain-module.001`, `iface.references.001`, `iface.service-reference-extensions.001`, `ctx.check-catalog.001`, `ctx.test-plan.001` and `ctx.research-decision-basis.001`. R0/R1 evidence was read as Git objects at PR #3 head `d5a34d74b3…`. |
| Codex V3 guidance | The full root `AGENTS.md` was read at commit `4beb491c44…`: blob `3402719bc3…`, 30,716 bytes, SHA-256 `1238a90adb…87ce6`, all verified. Triggered guides applied: CPU telemetry, section reading and delivery. The builder profile is prompt-carried guidance only; no profile isolation is enforced. |
| HQ rules | Root `AGENTS.md`. There is no nested `AGENTS.md` on touched paths. `.agents/shared-guidance.md` is absent, so shared enrollment is unavailable; nothing was installed. |
| Model | Claude Frontier, explicit `claude-opus-5-5` at high effort; no descendants |
| Contributing T3 threads | SOC-C Social content lane, role builder (native ID withheld from this public repository). Coordination owner: HQ root thread. |

**Guidance conflicts.** V3 defaults to delegating qualifying work and to delivering through merge. The owner's no-descendants rule and the HQ merge hold override both. No other conflict was found.

## What `modules/social/core` provides

The module is consumed by relative import from inside `@hq/social` (for example `../core`). No package export changed.

| File | Exports |
| --- | --- |
| `port.ts` | `SocialWorkspacePort` and its record types: `Channel`, `ToolId`, `ToolCategory`, `Brand`, `Draft`, `DraftFields`, `SaveDraft`, `Tool`, `RunRecord`, `RunStatus`, `ObservedRunStatus`, `WorkspaceSnapshot`, `PortError`. Also `PortFailure` (the rejection carrying a `PortError`), `portErrorOf`, `CALL_CLASSES`, `hasFeature`, the constant lists, `DEFAULT_BRAND_ID`, `FEATURE_HQ_REFERENCES`, `FEATURE_HQ_BRAND_PROJECT`, `PROPOSED_SCHEMA` and `MAX_DRAFT_LINKS`. |
| `validate.ts` | Client validation in the service's order, with its messages: `checkDraft`, `checkLinks`, `checkBrandName`, `checkRunSubmission`, `isPlanningDate`, `isRunId`, `isChannel`, `isToolId`. Also `MESSAGES`, `LIMITS` and `MAX_BODY_BYTES`. |
| `fixture.ts`, `fixtures/workspace.ts` | `createFixtureWorkspace({ features, clock, seed, delay })` returns `{ port, controls }`. The controls are `editElsewhere`, `loseNextSubmitResponse`, `failNext`, `setUnavailable`, `advanceRuns`, `restart` and `inspect`. Fictional seed data: `fictionalSeed`, `FIXTURE_IDS`, `FIXTURE_PROJECT_ID`. |
| `recorder.ts` | `recordCalls(port)` returns `{ port, calls(), callsOf(class), clear() }`. Every call is tagged `content`, `read` or `execution`. |
| `runs.ts` | `submitRunOnce` submits once, from an explicit action only, and returns `accepted`, `unknown` or `rejected`. `possibleRunMatches` lists possible matches after an unknown submission. Also `isActiveRun`. |
| `session.ts` | `socialSession(projectId)` and `useSocialSession(projectId)`: module-level state that survives shell remounts. It holds the workspace load (stale snapshots stay visible), draft editors with conflict handling (`saveEditor`, `saveAsCopy`, `reopenLatest`) and page view state. |
| `test/port-conformance.ts` | `describeSocialPortConformance(label, createHarness)` and the `SocialPortHarness` interface, shared by the fixture and live adapters |

**Proposed schema.** `Draft.links` exists only with `hq-references-v1`, and `Brand.project_id` only with `hq-brand-project-v1`. Both come from `iface.service-reference-extensions.001`. They are labeled through `PROPOSED_SCHEMA` and are not delivered service fields.

- The fixture advertises `hq-references-v1` by default.
- `features: []` reproduces today's service.
- Adding `hq-brand-project-v1` makes the seed carry `project_id`, which lets the domain lane demonstrate the mismatch banner.

**Safety invariants checked by tests:**

- There are no network, filesystem or account calls.
- Only `submitRun` is `execution`.
- Loading, editing and saving make zero execution calls.
- A lost `submitRun` response is `unknown`, the port makes exactly one execution call and nothing retries it.
- A conflict never overwrites the other copy, and the user's text is kept.

## Interface research

The research read the private Social workspace service (Fieldnotes) at `3f647daced7fa12f4885222a22ec542bbae6d4e1`. It used Git objects only, under `apps/social_dashboard/` (`server.py`, `catalog.py`, `static/app.js`). Nothing under `data/` and no protected record was read. No source was copied.

- **Mirrored as interface facts:** the validation order and message strings, limits, defaults, conflict semantics, queue capacity, restart interruption and route error classes.
- **Mirrored as catalog identity:** tool IDs, names, categories and marks.
- **Authored for the fixture:** tool descriptions, examples and all records.

**Recorded divergences.** Each entry gives its reason.

1. **Unparseable planning dates.** For a string such as `2026-02-30` or `2026-2-03`, the service returns the CPython `date.fromisoformat` exception text. That text depends on the Python version and does not come from Fieldnotes source. The client returns "Use a YYYY-MM-DD planning date" for every malformed date. **The live adapter must run `checkDraft` before sending** so it passes the shared conformance suite.
2. **`archived: 1.0`.** The service rejects a JSON float. JavaScript cannot represent the difference, and HQ always sends the integer.
3. **Non-text `brand_id`.** SQLite binding fails with a generic HTTP 500. The client returns "Unknown brand".
4. **Ordering edge cases.** Fixture brand order uses UTF-16 comparison where SQLite compares UTF-8 bytes; they differ only above U+FFFF. Ties on equal timestamps sort newest-inserted first, where SQL leaves the order unspecified.
5. **Run outputs and examples.** These are generic fictional shapes. Tool-specific result shapes and the service's structured example files are not modeled; the workbench lane owns that research.
6. **Same-origin and token refusals (HTTP 403).** These are modeled only as an injected `forbidden`, which carries no message, matching the port type.

## Checks

Local, on the exact candidate tree. Each run had fresh telemetry admission first; the last reading before the final runs was CPU 14.46% used and 40.16 GiB RAM available, allowing one serial process. Nothing ran in parallel.

| Command | Result |
| --- | --- |
| `npx tsc -p modules/social/tsconfig.json --noEmit` | Pass |
| `npx vitest run modules/social` (literal `social-module` projection) | Pass: 131 tests in 4 files. That is 129 new core tests in 3 files (two conformance runs, fixture, validation and the session hook) plus R1's 2 skeleton tests. |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 159 tests in 9 files |
| `npm run build` | Pass. It writes only the ignored `apps/desktop/dist*`, which is left in this worktree as classified ignored output. |

**Is the suite sensitive?** As a reversible mutation, the fixture's version check was removed (the backup was restored in place). Four tests then failed: both conformance conflict cases and two session conflict cases.

**Projection.** The `social-module` group is a projection of the group proposed in `ctx.check-catalog.001`. `tests/check-groups.toml` is Design-owned and was not edited.

**Not covered.** No CI is configured, so these are not green CI. There was no Electron launch, and no visual evidence because there is no UI in this task. The suite has not been checked against a live service; that waits for `task.social-live-adapter.001` and D-2 gates.

## Deferred and open items

- **Content task held.** `task.social-content.001` waits for an accepted UI kit candidate. The reserved content, nav, index and live paths are untouched.
- **Restart persistence.** `session.ts` is session-only. Persistence across restarts waits for a `ModulePort` storage member (G-3, proposed to the root).
- **No response parsing.** No response-shape parsers exist yet. The live adapter task should validate service responses before trusting them.

# SHL final module wiring source checkpoint

Authority effect: none. Source completion only; behavior remains unqualified.

Base: `89669e3204f2e94e33230af260a4a65901fe5d10`.
Source checkpoint: `262255a1b6f9f80bd5cde287a797f73a0eb1c75f`.
Branch: `work/hq-recovery-shell-module-wiring-20261112`.
Canonical repository: Jones-Systems/HQ. Initial branch, HEAD, clean status and
sole-writer scope were verified before edits. No ancestry merge was needed.
Commits use explicit public Codex identity; retained ancestry is unchanged.
Implementation-role fallback: codex-v3-builder scope, no subagents. Requested
Blended Frontier Max, explicit owner pin, preference revision 11, Sol/high,
default tier, no Fast. This receipt does not attest provider billing or tier.

## Integrated source

- All four Social desktop requests are composed contextually: public
  `createExampleWorkspace(projectId)` in preview and production selection,
  project-seed regression, Example pill and Overview-scoped capability assertion.
  `getSocial` caches one exact port. Reference-first selection uses the shown
  workspace scope (production `WORKSPACE_SCOPE`); custom hosts can supply their
  scope as the factory's third argument. Live selection remains fixed for the
  renderer; missing/failed configuration never falls back to examples.
- `mountWork` awaits the selected Work port, registers live durability through
  the existing bridge guard/adapter, then binds the session before rendering
  Work. Reference reads keep that same port and never register or mount a session.
  The captured device bridge belongs to the same frozen service choice.
  `planner.recovery` remains bound. No new eager restore, polling, retry or
  teardown policy is introduced: core owns load/claim-before-write ordering,
  durable failure state and its existing health/status lifecycle. Missing local
  bridge keeps the existing non-durable policy; failed load/save stays with the
  existing adapter/hub refusal policy, without fallback or automatic repair.
- Settings Work check uses the direct `live/health` probe and plain Planner
  health wording. Its result enters the shared observation store with the
  existing timestamp and reachability transition semantics. A received HTTP
  refusal is reachable transport with refused usability wording. Later actual
  traffic replaces the check wording; unknown traffic leaves it unchanged.
  No retries, replay, Apply authority or Updates changes were added.
- Settings composition selects Social & Work and asserts visible disabled
  checks and description associations. The exact Settings UI-map row is added.
- The exact SHL reference-fixture patch is applied, including fixture-local
  providers and moved-fixture selection; all behavioral assertions remain.
- WRK-V1's edge-card reservation, Wiki mount/routes and fourth-domain ordering
  are unchanged. No module source was edited.

## Files

- `apps/desktop/src/services/domains.tsx`
- `apps/desktop/src/services/reference-reads.test.tsx`
- `apps/desktop/src/services/data-source-status.ts`
- `apps/desktop/src/services/data-source-status.test.ts`
- `apps/desktop/src/services/observed-status.ts`
- `apps/desktop/src/services/observed-status.test.ts`
- `apps/desktop/src/settings/DataSources.tsx`
- `apps/desktop/src/settings/DataSources.test.tsx`
- `apps/desktop/src/preview/composition.tsx`
- `apps/desktop/src/preview/composition.test.tsx`
- `apps/desktop/src/social-work.integration.test.tsx`
- `apps/desktop/src/references.integration.test.tsx`
- `docs/ui-map/README.md`
- This receipt.

## Static evidence and unrun verification

Whitespace, lexical conflict-marker, relative-import target and exact write-cone
checks pass. Module, Electron, contracts, packages, root dependency/configuration
and workflow preimages remain unchanged. Reverse `git apply --check` confirms
that the exact authorized reference-fixture patch is present. Final diffs were
inspected. Node v26.12.1 `--check` parsed the four changed service `.ts` files
without importing or executing application/test code. This is syntax evidence
only, not the pinned CI toolchain or a typecheck. Local TypeScript parser
prerequisites are absent; TSX parsing and semantic typechecking are UNRUN.

Authored regressions are UNRUN: reference-first Social scope and exact shared
port, live durability-before-session order and once-only binding, Planner
wording/observation timestamps, one read-only version probe, Settings category
navigation and disabled explanations. Existing behavioral assertions are kept.

No tests, builds, installs, servers, browser/native launches, captures, real data,
posting, activation, signing, deployment, PRs or foundation/main merges occurred.
The unresolved original baseline launch remains with its existing owner; this
checkpoint authorizes no execution. The serial Mini verifier owns all later
focused shell/services/Settings/reference/Social-Work checks, root semantic and
required fast checks, and assembled native persistence/restart journeys.
Layout, accepted gutters, responsive states, accessibility, keyboard ownership,
reduced motion, light/dark/system, native overlays and fidelity remain unverified.
No presentation export or gallery completion occurred.

The accepted amendment and current Work Note were read at
`e9db4f61b0688f3727e4be4e37d00521131fc6f3`, alongside original F1 and requested
module receipts. Canonical Frontend-Development main resolved and guidance was
read at `b59d310cae8472ae8ed42d4d8562d08c362379d8`; no private implementation
was copied. The local shared-guidance bridge is absent; none was installed.

## Exact remaining owner requests

Production capture has no durable-slot adoption. Current source is:

```text
modules/work/nav/session.ts:119
  drafts: createDraftStore(), ...
modules/work/capture/drafts.ts:34-36
  createDraftStore(options: { now?: () => Date } = {})
  let drafts: readonly HqDraft[] = [];
modules/work/core/durability.ts:62
  durableDrafts(port: PlannerPort): DurableDrafts | null
```

Smallest next assignment: a separately authorized Work capture/nav owner adds
an optional durable-drafts slot to the draft store and passes
`durableDrafts(port)` from session creation. That owner must define restore-before-
mutation ordering, validation/ID collision handling, save/refusal behavior and
truthful scope wording, preserving explicit Send drafts and unknown outcomes.
SHL cannot supply a valid one-line session patch until capture accepts that API.
WRK-V2 owns planning views, not capture; no change was silently assigned to it.

The recorded P2 background-device-save cleanup race remains unselected and
unwaived (`work-live.integration.test.ts`, device persistence cleanup around
line 441). It was not repaired. Other recorded P2-P4 retain their dispositions.
No additional module or shared hunk is requested for the completed shell wiring.

# Engineering Spec — HQ integration parallel execution

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.artifact-header.001" -->
Artifact Type: `engineering-spec`

Artifact ID: `spec.hq-integration-parallel-execution`

Purpose: Divide the remaining HQ integration into scoped concurrent lanes that end in one working, merged desktop app.

Governing artifact: `spec.hq-bootstrap`

Specification owner: HQ integration root (T1)

Integration owner: HQ integration root (T1)

Consumers: T1 through T11 lanes, compiler, verifier

Authority effect: none
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.artifact-header.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.project-summary.001" -->
## Project Summary

**Outcome:** one HQ Electron app on `main` in which Design, Social, Work and Wiki are mounted, use real local service paths, persist and replay state across restart, and round-trip cross-domain references. Requests, Runs and References run in the production Design shell over durable storage. Design import and export, the laptop-local catalog and Work export are real. The app is verified at one exact head and installed on the owner's laptop through a proved route.

**Finish line:** `work/hq-foundation` holds every landed slice. Final acceptance passes on that exact head, and T1 merges #2 into `main` last with readback. Accepting source alone does not deliver it.

**Amends, does not replace:** `spec.hq-bootstrap`, `spec.hq-design`, `spec.hq-social-work` and `spec.hq-expansion` keep their requirements and acceptance. This artifact adds lane ownership, shared contracts and landing order. It is the only shared plan; lanes do not write duplicate project plans. This revision adds the required-capability closure: Design closure K1–K4 and CL1b, shared r3, D-4 references, Work export, hosted CLI/Planner CI, closure qualification, and the held-capability gates.

**Lanes:**

| Lane | Owner | Outcome |
| --- | --- | --- |
| T1 | Integration root | Continuity, shared-ref landings, plan amendments, #2 delivery |
| T2 | Existing Design coordinator (shared writer) | F2 shared bridge (active), then shared r3, live wiring, Wiki mount, reference round trip, CLI/Planner CI |
| T3 | Existing Social builder | Social live adapter #48 — landed |
| T4 | Existing Work runtime builder | Work live runtime #51 — landed |
| T5 | — | CLI stack #46 merged; no lane |
| T6 | Wiki builder | Wiki module assembly #54 — landed |
| T7 | Acceptance builder/verifier | Native harness #53 landed; integrated scenarios, qualifications, final acceptance |
| T8 | Existing Design coordinator (Design closure) | K1 storage engine, K2 app sections, K3 local catalog, K4 reference provider, CL1b mount, import/export enablement |
| T9 | Original `@hq/ui` owner custody | Reference UI kit |
| T10 | Original Social content owner custody | Read-only Social reference provider and link editor |
| T11 | Original Work board owner custody | Work reference provider, Links section, then RW-6 Export UI |

**No goal reduction:** every requirement and protected gate in the existing specs remains a completion obligation. Six capabilities stay held behind their own native, privacy or authority gates, encoded as explicit-activation qualification tasks: live S1 receiver qualification (native OAuth consent), new-thread launch U1 (a missing Jones Code contract), the S2 preview surface, component-execution containment, Wiki private validation, and service enablement (Planner revision, Social `hq-references-v1`, live conformance). Laptop installation is a seventh gate. The existing-thread receiver is planned, required source work: its contract framing is complete, and `receiver-adapter` builds it and qualifies it against fixtures without native OAuth. Only live S1 qualification waits for the owner's consent. Signing, notarization, release and deployment were never authorized.

While any required capability is held, final reports say exactly that. They never call the app "working" or "complete", and fakes, fixtures or previews never count as production qualification.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.project-summary.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.source-integration.001" -->
## Source Integration Requirement

Every slice lands on `work/hq-foundation` with an ordinary merge commit at an exact head, after green exact-head checks. Every original PR ends actually merged; all except #2 already are. #2 is the only path to `main` and merges last.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.source-integration.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.domain-runtime.001" -->
## Domain Runtime Requirement

The shell mounts Design, Social, Work and Wiki. Each domain restores its own destination and state, and domain switches, card moves and reference navigation never launch work.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.domain-runtime.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.service-transport.001" -->
## Service Transport Requirement

Social and Work use real local service paths through closed, typed main-process routes that follow `iface.service-response.001`. Status is truthful: available, unavailable, unknown or replayed. Labelled synthetic services remain the default for tests.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.service-transport.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.wiki-mount.001" -->
## Wiki Mount Requirement

Wiki appears fourth in the rail and reads committed Git objects through the host port in `iface.wiki-host-ipc.001`, following `spec.hq-expansion#req.wiki.001`. Tests use synthetic corpora only. The mount alone never closes `spec.hq-expansion#task.wiki-integration.001`: its private-source validation dependency stays a gate under `ac.wiki-private-validation-binding.001`.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.wiki-mount.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.acceptance.001" -->
## Acceptance Requirement

A real Electron run proves the integrated behavior on the final head. Laptop installation uses only an owner-authorized route.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.acceptance.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.design-closure.001" -->
## Design Closure Requirement

These keep `prd.hq-design`, `spec.hq-design` and `spec.hq-expansion` intact:

- **Production loop (CL1).** Requests, Runs and References are mounted in the production Design registry over durable lane ports. The loop runs freeze → strict packet verification → outbox CAS → labelled fake dispatch with a durable send record → evidence → returned inbox → accept, reject or revise. The only destination is the labelled simulated one ("Simulated — nothing sent"). An owner-reported return can never claim native verification.
- **Import and export (CL4).** One durable-manifest transaction (`hq.design.storage.import-txn/v1`) is all-or-nothing for every reader through the Design host under process kill. `recover()` runs at open before any route is served and finishes a committed intent by idempotent replay (`clientEventId` dedupes). Only torn-tail repair is never automatic: a torn tail leaves the intent blocked until the explicit owner action `import.repair`, which quarantines the original bytes. A corrupt stream is refused and never repaired. Export produces bundle/v1 with per-section allow-lists and an exact omitted-store report. Both stay disabled (`unavailable`, reason `disabled`) until `ac.import-export-enablement.001` is satisfied.
- **Local catalog (CL7).** A user-selected laptop-local root feeds the discovery `SourceAdapter`. Main keeps the absolute path, and the renderer sees only `{rootId, label}`.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.design-closure.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.references-closure.001" -->
## Reference Closure Requirement

D-4 closes exactly as in `spec.hq-social-work#req.references.001` (RL-1 to RL-11) and `spec.hq-social-work#iface.references.001`:

- `ReferenceEnvelope` and `parseReference` are reused unchanged.
- Links are owned by their source record. There is no global link, task or reference store.
- At most 30 links per record, with duplicates rejected.
- The eight statuses carry `observedAt` and freshness. Unresolved, stale and unknown never render as available.
- *Update snapshot* is an explicit mutation.
- Search, resolve, link, unlink, open and return make zero execution calls.
- Back restores the source domain, destination and state.
- A project mismatch is read-only and never navigates silently.
- Exports preserve envelopes byte-for-byte.
- No module imports another domain.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.references-closure.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.work-export.001" -->
## Work Export Requirement

RW-6, after the bridge: HQ writes the Planner's existing export bytes (`jones-planning-export` v1, JSON or Markdown) unmodified through a native save dialog in main.

- The renderer never receives a path.
- Non-2xx writes nothing. Transport loss is `unavailable`.
- Import and replace-restore stay in the Planner's own tools.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.work-export.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.hosted-ci.001" -->
## Hosted CI Requirement

Hosted checks run the root build, every Design section cone including the new app sections, the Wiki Node test-runner suites, and the CLI and Planner tests (`spec.hq-social-work#ac.joint-ci.001`, Amber under `ac.ci-adoption.001`). Absent checks are reported as absent.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.hosted-ci.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.held-capabilities.001" -->
## Held Capability Requirement

The live S1 receiver loop, new-thread launch U1, the S2 preview surface, component execution, Wiki private validation, service enablement and laptop installation remain required. Each is qualified only through its own gate task, at real native evidence. While any is unqualified, the final report lists it as held. A fake, fixture, preview or labelled simulation never stands in for its qualification.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.held-capabilities.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.source-landing.001" -->
## Source Landing Acceptance

For each landing, readback shows the target ref at the expected merge commit, the PR merged at its exact head, and ancestry containing that head. Nothing is forced, rebased or deleted.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.source-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.module-candidates.001" -->
## Module Candidate Acceptance

A module or C candidate is a published non-draft PR against `work/hq-foundation`. Its diff stays inside the lane's literal write scope, its named tests pass, its exact-head hosted checks are green, and its evidence labels synthetic data as synthetic.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.module-candidates.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.shared-runtime.001" -->
## Shared Runtime Acceptance

Root typecheck, test and build cover every domain, including Wiki. Electron security tests pass. Live paths behave as `iface.service-response.001` requires, and tokens never reach the renderer.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.shared-runtime.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.working-app.001" -->
## Working App Acceptance

Every requested Design, Social, Work and Wiki function in the existing specs is closed, or explicitly reported as held with its gate. On one exact head, the following pass:
- `npm ci`, typecheck, test and build;
- the Wiki Node tests;
- the CLI and Planner tests;
- the Electron harness: four-domain round trip, restart persistence and replay, reference round trips, and truthful unavailable/unknown states;
- the closure suites in `ac.capability-closure.001`.

The final candidate is installed and launched on the laptop through the proved route, or the exact gap is recorded. A gap is never reported as a pass.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.working-app.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.main-delivery.001" -->
## Main Delivery Acceptance

`main` contains the accepted #2 head through a merge commit, #2 is merged, and the original-PR disposition audit is complete.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.main-delivery.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.design-closure.001" -->
## Design Closure Acceptance

- **K1:** fault injection at every fs call in the transaction's stage, commit, replay and intent steps, both clean and torn. After reopen and recover, the host sees nothing (orphans only counted) or everything, never a partial state.
  - No duplicate events. An idempotent rerun leaves revisions unchanged.
  - Torn-tail block, overlay and repair work, with quarantine holding the original bytes. A corrupt stream refuses repair.
  - Every preflight refusal leaves a byte-equal store. A concurrent `doc.put` waits behind the import.
  - Export is deterministic, has no privacy markers and gives the exact omitted report; export → import into an empty store reproduces the projected state.
  - Disabled routes return `unavailable`. There are no delete members.
- **K2:** the full loop passes with restart recovery on in-memory and crashing doubles.
  - Nothing is dispatched without a durable send record, and unknown is never resent.
  - Reject creates no draft or send. Navigation and readback make zero sends.
  - A labelled fake is never shown as real. Host and model variance is shown.
  - `design-sections.yml` gains exactly the `app-sections` row and its expected-row count. No production descriptor is added.
- **K3:** the guards in `ctx.lane-t8.001` pass under the existing discovery row, with `qualificationRef: hq.design.local-directory-adapter/v1`.
- **K4:** read-only find and resolve for `project | version | request | reference`, with T14-valid destinations and zero writes.
- **CL1b:** Requests, Runs and References appear in production, bound to K2 environments over K1 adapters. Labelled fakes are used only when unbridged, and the renderer-safe walk covers the sections.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.design-closure.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.reference-closure.001" -->
## Reference Closure Acceptance

`spec.hq-social-work` `ac.reference-contract.001`, `ac.reference-shell.001`, `ac.reference-ui.001`, `ac.social-references.001`, `ac.work-references.001` and `ac.reference-integration.001` pass as written, plus the following:

- **Social persistence:** Social draft links stay "not saved — needs Social service support" until service enablement qualifies.
- **Work export:** the bytes equal the Planner response, and the renderer state has no path.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.reference-closure.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.capability-closure.001" -->
## Capability Closure Acceptance

On one exact `work/hq-foundation` head, a typed matrix classifies each requirement in `req.design-closure.001`, `req.references-closure.001`, `req.work-export.001`, `req.hosted-ci.001` and `req.held-capabilities.001` as closed, with its suite and evidence, or held, with its gate. A missing implementation or suite is a failure, never a hold.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.capability-closure.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.reference-lane-custody.001" -->
## Reference Lane Custody Predicate

Explicit activation predicate: T1 has bound an actual native owner to the lane, either the original custody owner or a disclosed successor, and recorded that binding in the coordination channel. A custody proposal or a retained alias alone does not satisfy it.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.reference-lane-custody.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.import-export-enablement.001" -->
## Import And Export Enablement Predicate

Explicit activation predicate: `import-export-qualification` passed its crash, CAS and privacy suites at one exact head, and T1 accepted that evidence for that head. The owner's existing HQ fix and activation permission covers this; no further owner approval is required.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.import-export-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.receiver-s1-binding.001" -->
## Receiver S1 Binding Predicate

Explicit activation predicate:
- the owner has completed native Jones Code OAuth consent for the HQ client, at the recommended narrowest access level;
- a task-owned idle receiver thread within that ceiling is bound;
- the packet is synthetic and public-safe.

Only then does live S1 run its steps Q0–Q5: transport and identity, one send, one deliberate harness-only replay, lookup and lineage, unknown recovery, and definite refusals. `qualification.evidenceRef` is set only from those results.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.receiver-s1-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.new-thread-u1-binding.001" -->
## New-Thread U1 Binding Predicate

Explicit activation predicate: Jones Code exposes a client-callable launch that takes `clientRequestId` and `projectId`, derives a stable thread ID and offers lookup by key, and a later amendment adopts it in HQ. Until then, new-thread mode stays disabled with its existing reason, and there is no launch qualification.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.new-thread-u1-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.preview-s2-binding.001" -->
## Preview S2 Binding Predicate

Explicit activation predicate:
- T1 accepts a concrete containment design for a separate preload-free preview view, including its source, CSP or surface rebind, within the owner's existing HQ permission;
- its implementation is landed through a later amendment.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.preview-s2-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.component-containment-binding.001" -->
## Component Containment Binding Predicate

Explicit activation predicate: the Design components owner has a containment design and native host evidence, and T1 accepted the enabling change. Until then, component execution stays disabled.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.component-containment-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.wiki-private-validation-binding.001" -->
## Wiki Private Validation Binding Predicate

Explicit activation predicate: the owner has given the exact privacy scope for an owner-local `spec.hq-expansion#task.wiki-private-validation.001` run, and only aggregates are published.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.wiki-private-validation-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.service-enablement-binding.001" -->
## Service Enablement Binding Predicate

Explicit activation predicate: the owner approved and the service owners executed Red envelopes for:
- the Planner at an HQ revision with `requests.replay` and `hq-references-v1`;
- the Social `hq-references-v1` extension and `links` migration.

The owner has also entered the endpoints. Agents never read live data.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.service-enablement-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.laptop-route-binding.001" -->
## Laptop Route Binding Predicate

Explicit activation predicate:
- the owner identified the laptop target;
- an owner-authorized unsigned build and install route exists for it;
- any packaging configuration is landed through a later amendment.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.laptop-route-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.research-decision-basis.001" -->
## Research And Decision Basis

No new broad research. This amendment encodes accepted, already-settled sources:
- the requirements closure audit;
- the Design owner's closure disposition (K1/K2/K3/K4, shared r3, CL1b; Opus 5.5/high, accepted by the root);
- the Social owner's accepted D-4/RW-6 ownership from `spec.hq-social-work` at `6ef007fbc36c13351dc305db1989579f413da343` (spec blob `6e44e24c58d79bfe4b638570eef97626ad306792`, unchanged at current foundation);
- current native GitHub reads.

**Landed (read back 2026-10-20).** `work/hq-foundation` = `d9f9682d43cc36b234248c7375018d067bbd3ca5`, after #49 (C), #52 (plan and main sync), #48 (Social live), #53 (native harness checkpoint), #51 (Work runtime) and #54 (Wiki assembly). All original PRs except #2 are actually merged. `main` = `bc8202a9731d51922c7cddde91f6ada0074adc1d`.

**Shared bridge candidate:** the runtime host candidate `73a6532159686c769ba6e39d8070907b2a9b021e` is published as branch `work/hq-design-runtime-host`. It holds F1, r2, F2 composition and the shared services host, merged with foundation `d9f9682`. It is ready for its root-owned PR publication and `bridge-landing`, independently of the K tasks. F2's scope is preserved and it is not restarted.
- The F2 host already implements ServiceSettings and the exact Social 403 refresh (only `saveContent`/`addBrand`, status 403 with the exact reload body, one refresh, one resend, `submitRun` never resent). No lane duplicates either.
- F2's r2 contract has no blob, event, transaction, export, catalog, Work export or reference routes; those are r3.

**Decisions:**
- **Cones:** K1 is the sole writer of `modules/design/app/storage`. K2 is the sole editor of `design-sections.yml` until it lands.
- **Base:** K1, K2 and K3 branch from the runtime host candidate `73a6532`, so all three land after `bridge-landing`.
- **Shared writer:** shared r3 is the single shared writer after F2. It imports K1's main-only transaction and export and K3's Node snapshot builder, so it starts after their landings. It also follows the Wiki mount landing, because it shares files with live wiring and the Wiki mount. Live wiring and the Wiki mount keep their original dependencies, so no new barrier is added.
- **CL1b** binds everything after r3.
- **Receiver:** the existing-thread receiver is implementable now against Jones Code `76fb3dc2bfc4d05b6681ec93de7abab18fb79356`, with no Jones Code change, as framed in the receiver contract framing record.
  - HQ main acts as an OAuth PKCE MCP client of `/mcp`, sends with `t3_thread_send` in `queue` mode, and uses the attempt key as `clientRequestId`.
  - Credentials stay main-only.
  - Unknown is fenced and never resent. Deduplication is session-scoped.
  - Lookup uses the timeline suffix and the queue marker.
  - Results are agent-reported text.
  - The Design connector contract is unchanged.
  - The receiver is a T2 serialized successor after r3. Fixture qualification (Q-S) does not wait for OAuth; live S1 does.
- **CLI/Planner CI** is a separate workflow written by T2 after K2 returns workflow custody, so it races neither K2 nor the Wiki mount.

**Unknowns:**
- Laptop target and install route.
- Native OAuth consent for the receiver, and the U1 Jones Code contract.
- MCP session framing and `queue`-on-idle behaviour (proved by S1 Q0/Q3).
- S2 containment.
- Wiki privacy scope.
- Service enablement envelopes.
- A shared project registry: open owner decision; the single fixed context stays, with project mismatch read-only.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.research-decision-basis.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.change-surface.001" -->
## Exact Change Surface And Ownership

Only one writer owns a path at a time. Each task block's `write_scope` gives its literal paths. No two tasks that can be ready together share a path.

- **T2 (one shared owner, serialized):** root manifests, scripts and lockfile, `tsconfig.json`, `vitest.config.ts`, `.github/workflows/foundation.yml`, the new `.github/workflows/cli-planner.yml`, `apps/desktop/**` (including the Design host compatibility layer, `apps/desktop/tsconfig.design-host.json` and ServiceSettings) and `packages/contracts/**`.
  - F2 also holds `modules/design/app/compose/**` and `modules/design/app/index.ts` until it hands them off to CL1b at `bridge-landing`.
  - Shared r3 owns `apps/desktop/src/reference-providers.ts` and `apps/desktop/src/references.ts`. After that, the reference round trip writes only the provider registrations, its integration test, and the Work export client mount in `apps/desktop/src/modules.tsx`.
  - The receiver writes `apps/desktop/electron/jones-code/**` plus its closed route registration. A separate bounded main-subdirectory writer is allowed only if the Design coordinator accepts an explicit non-overlap rebind.
- **T8 (Design closure; each a new Design descendant in its own worktree):**
  - K1: `modules/design/app/storage/**`.
  - K2: `modules/design/app/sections/**` and `.github/workflows/design-sections.yml`.
  - K3: `modules/design/discovery/{node,src/adapters,test}/**`.
  - K4: `modules/design/app/references-provider/**`.
  - CL1b: `modules/design/{requests,connector,references}/design-module.ts`, `modules/design/app/compose/**` and `modules/design/app/index.ts`.
  - Enablement: the two status constants only.
  - `packages/design-store` stays frozen.
- **T9:** `packages/hq-ui/src/references/**`, `packages/hq-ui/test/references/**`, the explicit exports in `packages/hq-ui/src/index.ts`, and evidence.
- **T10:** `modules/social/references/**` and `modules/social/content/**`, plus the explicit mount plumbing in `modules/social/index.tsx`, `modules/social/nav/SocialDomain.tsx` and `modules/social/nav/index.ts`, and evidence.
- **T11:** `modules/work/references/**` and `modules/work/detail/**`, then `modules/work/export/**`, plus the explicit mount plumbing in `modules/work/index.tsx`, `modules/work/nav/WorkDomain.tsx` and `modules/work/nav/index.ts`, and evidence. It never edits the landed `live` or `core` runtime.
- **T7:** `tests/acceptance/**` and `docs/evidence/hq-integration/acceptance/**`.
- **T1:** shared refs and PR bases, this spec, and `tests/check-groups.toml`.

A needed edit outside a lane's scope goes to T1 as a rebind request. Module lanes do not edit `packages/contracts`. They declare structurally identical module-local types, and T2 proves those types are assignable to the canonical ones. No module imports another domain.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.change-surface.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.contracts.001" -->
## Interface Contracts

Five shared contracts govern concurrent lanes:
- `iface.service-response.001`: owned by T2 in `packages/contracts`; consumed by T3, T4, T7 and T11.
- `iface.wiki-host-ipc.001`: owned by T2 in main/preload; consumed by T6 and T7.
- `iface.shared-r3.001`: owned by T2; consumed by T7, T8, T10 and T11. It also covers the receiver's closed `design.jonesCode.*` route family (`status`, `authorize`, `identify`, `send`, `lookup`, `readEvidence`, `listThreads`), whose names are reconciled with r3. That family maps to the unchanged Design connector `TransportPort`/`EvidenceReadbackPort` for `transport:"jones-code"` and stays `unqualified` until S1 evidence.
- `spec.hq-social-work#iface.references.001`, unchanged: owned by T2 at `@hq/contracts/references`; consumed by T7, T8, T9, T10 and T11.
- The Design lane contracts already at the runtime host parent: owned by the Design coordinator.

Changing any of them needs a T1 rebind of every consumer.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.contracts.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.service-response.001" -->
## Service Response Contract

```ts
type ServiceResponse<B> =
  | { ok: true; status: number; body: B; replayed: boolean }
  | { ok: false; kind: 'unavailable' | 'unknown' };
```

- `ok: true` is transport-only. It covers every received HTTP response, including 4xx and 5xx, and adapters branch on `status`. An empty body is `null`. A missing `replayed` is `false`.
- A failed read is `unavailable`. A malformed or lost mutation is `unknown`. A Work 5xx write is `unknown` and keeps the caller request ID for reconciliation by replay.
- Never retry an unknown write or `submitRun`. Never fall back from live to fixture.
- Routes are closed and typed. Configuration and tokens exist only in main.
- After a 403, refresh at most once, and only when the response matches the exact Social token-rejection predicate.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.service-response.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.wiki-host-ipc.001" -->
## Wiki Host IPC Contract

The renderer gets exactly the seven `WikiService` methods from the merged Wiki contract:
- `listSources`
- `search`
- `getPage`
- `resolveAlias`
- `getBacklinks`
- `listTopics`
- `indexStatus`

Each returns `WikiResult`. `refresh` and home migration are host-only in main over `modules/wiki/core`. Requests are validated by the contract guards, and there is no arbitrary path, filesystem or shell access. CSS ships as an external file under the existing CSP.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.wiki-host-ipc.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.shared-r3.001" -->
## Shared r3 Contract

Closed, typed routes are added by one writer, with no generic filesystem, shell or URL IPC.

- **Design records:**
  - `blob.put{bytes ≤16 MiB, expectedDigest}`, `blob.get`, `blob.has`;
  - `event.append{stream, payload, clientEventId?}`, where main fixes the type by root;
  - `event.read` → `{events:[{seq,payload}], status}`.

  Document roots gain `design/requests/`, `design/connector/{outbox,evidence}/` and `design/references/`.
- **Transaction and export:**
  - `import.commit|status|repair`, `storage.diagnostics`, `export.preview|save`;
  - a readers-writer gate: import, repair and export are exclusive; document, blob and event operations are shared;
  - `recover()` runs at open, before any route is served;
  - main runs K1's transaction and export, exported only from `node.ts`;
  - every route returns `unavailable` with reason `disabled` while its status constant is off.
- **Catalog:**
  - `catalog.roots|chooseRoot|forget|snapshot|preview`, over K3's Node builder;
  - `forget` removes the configuration entry only, never files;
  - design `cache.put` for the catalog key only.
- **Work export:**
  - `export{format:'json'|'markdown'}`;
  - main does the GET with an 8 MiB cap and writes temp + rename through the native save dialog;
  - the renderer gets `ServiceResponse<{saved:boolean}>` with the Planner status and no path.
- **Shared save dialog:** `apps/desktop/electron/save-dialog.ts` serves both the Work export and the Design export.
- **References:**
  - `@hq/contracts/references`, exactly `spec.hq-social-work#iface.references.001`;
  - `ModulePort` gains optional `references?` and `returnContext?`;
  - `App.tsx` gets `open`, return and Back, the in-memory per-device resolution cache, and project-mismatch read-only handling;
  - root-owned `apps/desktop/src/reference-providers.ts`;
  - assignability tests for the module-local structural types.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.shared-r3.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.test-plan.001" -->
## Test Plan

Each task names its Test Intent and check groups.

Groups for the `tests/check-groups.toml` amendment:
- **Already in the catalog:** `hq-root-build`, `hq-cli-planner`, `hq-social-live`, `hq-work-runtime`, `hq-wiki-module`, `hq-shared-bridge`, `hq-electron-acceptance`, `hq-source-readback`.
- **Added by this revision:** `hq-design-storage-engine`, `hq-design-app-sections`, `hq-design-local-catalog`, `hq-shared-r3`, `hq-design-reference-provider`, `hq-design-compose`, `hq-reference-ui`, `hq-social-references`, `hq-work-references`, `hq-reference-round-trip`, `hq-hosted-ci`, `hq-capability-closure`, `hq-held-gates` (gate readback only).

Rules:
- Run the exact behavior test while editing.
- At a candidate, run the lane's groups plus `hq-root-build` whenever shared files changed.
- The final union runs once on the final head.
- Take a fresh CPU admission sample before each test run, under the host's admission policy, and never chain it with the test command.
- Hosted checks attach through `foundation.yml` and `design-sections.yml`, and through `cli-planner.yml` after it lands. Report absent checks as absent, never as green.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.test-plan.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001" -->
## Operator Interaction Inventory

| Phase | Owner action | Executing route | Boundary and readback |
| --- | --- | --- | --- |
| Build, test, publication, landings, #2 merge | None; covered by the owner's in-scope merge authority | Ordinary user, isolated HQ worktrees, GitHub | Exact-head checks; ref/PR/ancestry readback; no sudo |
| Electron acceptance on the check host | None | Ordinary user, owned temporary profile | Stops with a recorded gap if no display exists; no package installation |
| Import/export enablement | None; existing owner permission | T1 accepts exact-head crash, CAS and privacy evidence; T8 makes the one-constant commit | `ac.import-export-enablement.001`; disabled until then |
| Live S1 receiver | Native Jones Code OAuth consent in the system browser; bind a task-owned receiver | HQ main loopback OAuth client; token in `safeStorage` | Held; fixture tests only until consent; renderer never sees the token; 30-day expiry needs fresh consent |
| S2 preview, component execution | None; T1 accepts the containment design and source rebind within the existing owner permission | Later amendment, then gate task | Held until native evidence; no preview or execution before the predicate |
| New-thread U1 | None in HQ; needs a Jones Code contract | Later amendment, then gate task | Held; no launch qualification |
| Wiki private validation | Give the exact privacy scope | Owner-local runner; aggregates only | Never published |
| Service enablement | Approve Red envelopes; enter endpoints | Service owners | Agents never read live data |
| Laptop install and launch | Identify the target; authorize the route | Proved owner route | Unsigned local build only; any elevation, signing or credential need stops with a disclosed gap |
| Recovery | None | Forward revert on a feature branch | No force, rewind, cleanup or deletion; unknown effects are reconciled first |
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t1.001" -->
## T1 Integration Root

T1 is the continuity owner and the only mutator of shared refs and PR bases.

T1 lands each candidate as it qualifies, in completion order, one serialized operation at a time on `work/hq-foundation`. It never waits for unrelated lanes, supplies explicit activation evidence only from the actual binding named by each predicate, and merges #2 last.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t1.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t2.001" -->
## T2 Shared Writer

The existing Design coordinator owns this lane. It is the sole writer of shared files. Its chain is serial:

1. F2 (`shared-bridge`, active, not restarted; models preserved) → `bridge-landing`.
2. Live wiring, then the Wiki mount, with their original dependencies unchanged.
3. Shared r3 (one new Design descendant) after `bridge-landing`, the K1 and K3 landings and the Wiki mount landing, because it shares main, preload, contract and `App.tsx` files with them → `r3-landing`.
4. The reference round trip after every provider and the Work export UI land. It also mounts r3's Work export client in `apps/desktop/src/modules.tsx`.
5. CLI/Planner CI after K2 returns `design-sections.yml` custody.
6. The existing-thread receiver after the Wiki mount, CL1b and the reference round trip land, because it shares main, preload, settings and `modules.tsx`. It is fixture-qualified by the Q-S wire stub of the exact `76fb3dc` shapes.

**Wiki mount:**
- mounts `createWikiDomain({ getPort })`;
- registers the `@hq/wiki` workspace and lockfile entry;
- raises the engine and CI Node version to `>=22.18`;
- keeps Wiki `node:test` suites out of Vitest discovery;
- adds a Node test-runner CI step;
- adds main-only home and source configuration.

The F2 host's ServiceSettings and exact 403 refresh are already implemented and are not duplicated.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t2.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t3.001" -->
## T3 Social Live

The existing Social builder finishes #48 now, starting with the failed-read-is-unavailable contract fix. The work is module-only. Integration with the real transport comes later through T2's live wiring.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t3.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t4.001" -->
## T4 Work Runtime

The existing Work runtime builder works now on module-local code and tests, using the Planner wire fixtures. Live tests against a real Planner service use foundation after `main-sync`.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t4.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t6.001" -->
## T6 Wiki Assembly

T6 is ready now from foundation, which already contains the Wiki contract, core and UI. It is module-only: the assembly and the synthetic-corpus tests. T2 mounts Wiki later.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t6.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t7.001" -->
## T7 Acceptance

The native harness checkpoint (#53) has landed. T7 extends it with integrated scenarios as their source lands, runs the import/export and capability-closure qualifications, the held-gate qualifications once their predicates hold, and final acceptance. HQ's layout is not changed to suit the Jones Code harness, and the harness stays separate from Design production code and tests.

The harness owns its scratch profile and processes. It removes exactly those on success, failure and cancellation, after preserving the evidence it needs.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t7.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t8.001" -->
## T8 Design Closure

The existing Design coordinator owns T8. K1, K2 and K3 run in the preflight children the Design coordinator has already created (Astra/medium), from the runtime host candidate `73a6532159686c769ba6e39d8070907b2a9b021e`. There are no new launches or replacements, and these children have no descendants. Their new-scope implementation starts after publication. Budget: the planned 7 of 12. K4 and shared r3 follow only when ready. CL1b goes to the F2 successor.

**K1, storage engine (sole writer of `modules/design/app/storage/**`):**
- Additive `WorkspaceRecords`; `createRequestsStoragePort` retargeted to it.
- `createReferencesStorage`, `createEvidenceStore` (create-only, `listByDispatch`), the outbox aligned to `OutboxStorePort`, and `createDiscoveryCacheStore` (exact key).
- `storage/transactions.ts` and `storage/design-export.ts`, exported only from `node.ts`; the renderer-safe test asserts `index.ts` does not export them.
- The transaction protocol:
  1. Validate: closed op kinds, Design roots only, `design/storage/` rejected, ≤64 MiB, blob ≤16 MiB, ≤10k ops, `txnId` = sha256 of the canonical ops.
  2. Preflight with no writes: revision CAS, `head.seq === expectedSeq`, an existing torn or corrupt stream refused.
  3. Stage blobs with `expectedDigest`.
  4. One `commitPuts` holding the docs, the blob-meta and the committed intent.
  5. Replay with `clientEventId = <txnId>:<s>:<i>`.
  6. Intent CAS to `applied`.
- Blocked-intent overlay, explicit `import.repair` with quarantine, read-only `storage.diagnostics`, and export with the exact omitted report.
- Existing exports keep their signatures. `DesignStorage` members are add-only, so host `compat.ts` passes. `proposal/imports-txn.ts` is unchanged. There are no delete members. If `packages/design-store` shows a gap, K1 stops and reports.

**K2, app sections:**
- `modules/design/app/sections/{requests,runs,references}/**` with its own `tsconfig.json` and `test/`.
- `env.ts` factories take injected lane ports, clock, ids and `compareSlot`.
- The production views compose the requests, connector and reference-library pieces.
- `pipeline.ts` runs the loop in `req.design-closure.001`.
- The PR37 producer stays Node-only and unmounted.
- No descriptors and no compose edits.
- It is the only editor of `.github/workflows/design-sections.yml`: one `app-sections` row, the `HQD_EXPECTED_ROWS` increment, and inventory accounting.

**K3, local catalog:**
- It starts with a preflight confirming that the existing `SourceAdapter` contract and the discovery row cover the new tests; otherwise it stops without editing the workflow.
- A Node snapshot builder (`discovery/node/local-directory.ts`) and a renderer adapter over a structural `LocalCatalogPort`.
- Guards:
  - the root comes only from the native dialog;
  - fixed opaque HostId `laptop-local`;
  - immediate child directories only, at most 500, with `complete:false` when capped;
  - dot directories and symlinks skipped; realpath confined to the root;
  - a single-segment `relativePath` of at most 255;
  - `repoIdentity:{localOnly:true}`, with no `.git` read and no execution;
  - `sourceProjectId` = sha256 JCS `{hostId, rootId, relativePath}`, and a persisted `generation`;
  - previews only `<entry>/.hq/preview.{png,jpg,jpeg,webp}`, magic-checked, at most 5 MiB, sha256 in main, and re-hashed on read.
- No content search, recursion or remote enrollment.

**K4, reference provider:**
- Read-only find and resolve over injected reads.
- Exported through `app/index` only at CL1b.

**CL1b:**
- Binds K2 environments over K1 adapters in compose, using labelled fakes only when unbridged.
- Adds the three production descriptors importing `../app/sections/…`, titled Requests, Runs and References.
- Extends the renderer-safe walk.

**Enablement:** a later one-constant commit, only under `ac.import-export-enablement.001`.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t8.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t9.001" -->
## T9 Reference UI

Custody stays with the original `@hq/ui` owner, bound at launch under `ac.reference-lane-custody.001`. T9 builds `ReferenceChip`, `LinkList` and `LinkPicker` now, against local structural copies of the reference types:
- every RL-4 status shown with a text label and freshness;
- light and dark, keyboard only;
- readable snapshots;
- explicit Unlink and Update snapshot with Undo.

It adds explicit exports to `src/index.ts`. Shared r3 proves the copies are assignable to the canonical contract.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t9.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t10.001" -->
## T10 Social References

Custody stays with the original Social content owner, bound at launch.

- **Provider:** a read-only provider for drafts, runs and brands.
- **Link editor:** in content. Persistence is gated: without `hq-references-v1`, links show "not saved — needs Social service support" and are never dropped.
- **Mount plumbing:** passes the optional `references` and `returnContext` through the index and nav files only.
- **Zero execution:** the call recorder shows zero execution calls.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t10.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t11.001" -->
## T11 Work References And Export

Custody stays with the original Work board owner, bound at launch.

1. **References first:**
   - a provider covering items, including archived and missing;
   - the card detail's Links section, using `kind:'hq'` with revision guards, conflict handling and Undo, enabled only with `hq-references-v1`;
   - mount plumbing through the index and nav only.
2. **Then RW-6 Export UI, in the same lane:** JSON or Markdown through a module-local structural export port. T2 mounts r3's client into that port in the reference round trip. It shows the Planner status and `saved`, and never a path.

It does not edit the landed `live` or `core` runtime.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t11.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.task-plan.001" -->
## Parallelization And Task Plan

The machine `task.*` blocks are authoritative. In summary:

| Task | Lane | Depends on |
| --- | --- | --- |
| `main-sync`, `joint-shell`, `shell-landing`, `social-live`, `social-landing`, `work-runtime`, `work-landing`, `wiki-assembly`, `wiki-landing`, `acceptance-harness`, `harness-landing` | T1–T7 | as before (landed in fact) |
| `install-route` | T7 | — (source research adopted with failed native provenance) |
| `shared-bridge` → `bridge-landing` | T2 → T1 | `joint-shell`; `shell-landing` |
| `design-storage-engine` (K1) → `design-storage-landing` | T8 → T1 | — ; + `bridge-landing` |
| `design-app-sections` (K2) → `design-sections-landing` | T8 → T1 | — ; + `bridge-landing` |
| `design-local-catalog` (K3) → `design-catalog-landing` | T8 → T1 | — ; + `bridge-landing` |
| `reference-ui` → `reference-ui-landing` | T9 → T1 | custody predicate |
| `shared-r3` → `r3-landing` | T2 → T1 | `bridge-landing`, `design-storage-landing`, `design-catalog-landing`, `wiki-mount-landing` |
| `live-wiring` → `wiring-landing` | T2 → T1 | as before (unchanged) |
| `wiki-mount` → `wiki-mount-landing` | T2 → T1 | `live-wiring`, `wiki-landing`; + `wiring-landing` |
| `design-reference-provider` (K4) → `design-provider-landing` | T8 → T1 | `r3-landing` |
| `design-compose-mount` (CL1b) → `design-compose-landing` | T8 → T1 | `bridge-landing`, `r3-landing`, K1/K2/K4 landings |
| `social-references` → `social-references-landing` | T10 → T1 | custody, `r3-landing`, `reference-ui-landing`, `social-landing` |
| `work-references` → `work-references-landing` | T11 → T1 | custody, `r3-landing`, `reference-ui-landing`, `work-landing` |
| `work-export-ui` → `work-export-landing` | T11 → T1 | `work-references`, `r3-landing`; + `work-references-landing` |
| `reference-round-trip` → `round-trip-landing` | T2 → T1 | `r3-landing`, `social-references-landing`, `work-references-landing`, `design-compose-landing`, `work-export-landing` |
| `cli-planner-ci` → `cli-ci-landing` | T2 → T1 | `design-sections-landing` |
| `receiver-adapter` → `receiver-landing` | T2 → T1 | `wiki-mount-landing`, `design-compose-landing`, `round-trip-landing` |
| `acceptance-scenarios` → `scenarios-landing` | T7 → T1 | `harness-landing`, `wiring-landing`, `wiki-mount-landing`, `round-trip-landing`, `design-compose-landing`, `work-export-landing` |
| `import-export-qualification` → `import-export-enablement` → `enablement-landing` | T7 → T8 → T1 | `design-storage-landing`, `r3-landing`, `design-compose-landing`; enablement predicate |
| `closure-qualification` | T7 | all closure landings |
| seven held-gate qualifications | T7 | each explicit predicate (receiver S1 also after `receiver-landing`) |
| `final-acceptance` → `main-delivery` | T7 → T1 | `closure-qualification`, `scenarios-landing`, `wiki-mount-landing`, every gate, `install-route` |

**Ready as soon as this amendment is published:** K1, K2 and K3 (`design-storage-engine`, `design-app-sections`, `design-local-catalog`). Their write scopes are disjoint from each other and from the shared bridge candidate. Preflight, research and worktree preparation for them may run before publication; new-scope implementation waits for this publication. `reference-ui` and the T10/T11 tasks wait for actual custody binding.

**Model hints (claude_frontier; the native tuple is recorded per task in the compile projection):**
- Building defaults to Astra/medium.
- K2 (`design-app-sections`) is the production successor of `spec.hq-expansion#task.request-composition.001`, whose explicit Sonnet 5.5/high builder override may apply.
  - Its existing preflight child is Astra/medium. The override takes effect only if the Design coordinator explicitly reconciles the native implementation binding before source work; nothing claims an effective Sonnet model otherwise.
  - The typed helper has no Sonnet entry, so compiler capsules carry a labelled placeholder.
- K1, K3, K4, r3 and the D-4 lanes come from `spec.hq-design` or `spec.hq-social-work` and use Astra/medium; the old Design-section Opus builder instruction is not extended.
- Verification mechanics and research use Sol/medium; closure and final judgment use Astra/high.
- In-flight F2 and CL1b (the F2 successor) keep their existing native tuples.

**Release:** there is no wave barrier. Each landing releases as soon as its own candidate qualifies. Only the shared-writer chain is deliberately serial.

**Coordination channel:** HQ issue #50 holds:
- lane registration;
- custody bindings;
- source identities;
- claimed scopes;
- readiness;
- the landing queue;
- rebind requests.

No lane relays status through the owner.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.task-plan.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.stop-recovery-delivery.001" -->
## Stop, Recovery, And Delivery Boundaries

**Stop the affected effect only** on:
- a stale head or base;
- an overlapping writer;
- an unexpected change;
- an unknown effect;
- contract drift;
- failed checks;
- an unresolved P0 or P1.

**Recovery:** reconcile before any retry. Repair forward by revert; never force, rewind or delete.

**Review:** zero independent reviewers by default. One focused lens is allowed only where it is materially useful, and never a bot. Record P2–P4 findings with their original severity and report them after delivery.

**Delivery:** lanes publish non-draft PRs against `work/hq-foundation` and own repairs through green exact-head checks. T1 lands them and merges #2 last. A lane's finish line is the readback of its landed PR, not "source written".
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.stop-recovery-delivery.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#plan.implementation.001" -->
```json
{
  "schema_version": 1,
  "default_context_refs": [
    "spec.hq-integration-parallel-execution#ctx.project-summary.001",
    "spec.hq-integration-parallel-execution#ctx.change-surface.001",
    "spec.hq-integration-parallel-execution#ctx.stop-recovery-delivery.001"
  ],
  "deferred_findings_sink_ref": null,
  "artifact_path_hints": {
    "spec.hq-integration-parallel-execution": "docs/engineering-specs/hq-integration-parallel-execution.md"
  },
  "launch_policy": "start_all_currently_launchable_with_rolling_capacity_refill",
  "machine_block_source_rendering": "deterministic_two_space_json",
  "runtime_rendering": "canonical_compact_json",
  "fan_in_owner": "lane-t1",
  "additional_final_check_groups": [
    "hq-root-build",
    "hq-cli-planner",
    "hq-electron-acceptance",
    "hq-capability-closure"
  ],
  "delivery_boundary": "Lanes publish module or shared-writer PRs against work/hq-foundation (K1–K3 first against work/hq-design-runtime-host); T1 alone lands them and merges #2 into main after final acceptance on the same head. Held gates stay held until their explicit predicates are bound. No release, signing, deployment or credentials."
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#plan.implementation.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.main-sync.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 makes work/hq-foundation contain main (CLI stack and Planner service, exact bc8202a9731d51922c7cddde91f6ada0074adc1d or its current successor) through an ordinary merge commit, so the feature base carries tools/hq-cli and services/planner for live Work and acceptance tests. Landing the plan PR satisfies this when that PR already carries main. Read back the foundation ref and ancestry of main.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "tools/hq-cli/",
    "services/planner/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.main-sync.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.joint-shell.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Joint shell C, PR #49 (published head 6f2eddfd87453b6f21ac90c8d7d1fcafb9e02961, now based on work/hq-foundation 11a6839e9acdae0f74cd493eaa0316340f1543f1): mount Design next to Social and Work. The implementation is already accepted. The existing C writer normalizes it with an ordinary merge of foundation into the C branch and repairs only qualification failures. Keep the agreed seven shared paths, the bounded App.tsx/styles.css fill layout and leave-flush, and the two registry heading assertions. Do not expand C into bridge, services, IPC, contracts, Electron main/preload, Wiki or storage work.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.ts",
    "apps/desktop/package.json",
    "apps/desktop/src/modules.tsx",
    "apps/desktop/src/social-work.integration.test.tsx",
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/styles.css",
    "modules/social/nav/test/registry.test.tsx",
    "modules/work/nav/test/registry.test.tsx"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.domain-runtime.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.joint-shell.001"
  ],
  "affected_check_groups": [
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.joint-shell.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.shell-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 lands C: with #49 based on work/hq-foundation, confirm its diff is only the shell work, require green exact-head foundation and design-sections checks, merge with --match-head-commit and read back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.joint-shell.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.shell-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.social-live.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t3",
  "objective": "Finish the Social live runtime adapter, PR #48 (corrected head d9359d3b9df67e09b66a122224b54489548f7d2f, awaiting Social acceptance), as module-only code over the closed transport in iface.service-response.001. Apply the pending contract fix: a failed read is unavailable, a malformed or lost mutation is unknown, submitRun is never retried, one refresh only on the exact Social token-rejection 403 predicate, and never fall back from live to fixture. Prove it with contract tests over a wire stub. T1 retargets #48 to work/hq-foundation.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t3.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/social/live",
    "modules/social/index.tsx",
    "modules/social/nav/workspace.ts",
    "modules/social/nav/test/source.test.tsx",
    "docs/evidence/hq-social-work/social-runtime"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.social-live.001"
  ],
  "affected_check_groups": [
    "hq-social-live"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.social-live.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.social-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 retargets #48 to work/hq-foundation, verifies a module-only diff and green exact-head checks, merges and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/social/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.social-live.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.social-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-runtime.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t4",
  "objective": "Build the live Work runtime and replay adapter in modules/work: Planner reads and writes over the closed transport in iface.service-response.001, using the Planner references, receipts and published wire fixtures from the merged CLI stack. Every write carries a caller request ID. A 5xx write is unknown and keeps that ID for reconciliation by replay; replayed:true is an idempotent replay. Never retry an unknown write or fall back from live to fixture. Restoration survives restart through the Work session. This addresses HQ issue #45. Publish one module-only PR against work/hq-foundation.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t4.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/work/live",
    "modules/work/core",
    "modules/work/index.tsx",
    "modules/work/nav/session.ts",
    "docs/evidence/hq-social-work/work-runtime"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.work-runtime.001"
  ],
  "affected_check_groups": [
    "hq-work-runtime"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-runtime.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the Work runtime PR is module-only with green exact-head checks, merges it into work/hq-foundation and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/work/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.work-runtime.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiki-assembly.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t6",
  "objective": "From work/hq-foundation (which contains the Wiki contract, core and UI), assemble Wiki as a mountable module without touching root or shared files. Add a domain descriptor and Component, a renderer client over the seven-method host port in iface.wiki-host-ipc.001, file-based CSS that works under the app CSP, module workspace and tsconfig files, and a synthetic committed-Git corpus fixture with end-to-end module tests. Keep Node test-runner tests out of Vitest discovery and record the Node >=22.18 requirement for T2. Never read a private corpus. Publish one module-only PR.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t6.001",
    "spec.hq-integration-parallel-execution#iface.wiki-host-ipc.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/wiki",
    "docs/evidence/hq-wiki"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.wiki-mount.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.wiki-assembly.001"
  ],
  "affected_check_groups": [
    "hq-wiki-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.wiki-assembly.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiki-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the Wiki assembly PR is module-only with green exact-head and local Wiki checks, merges it into work/hq-foundation and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/wiki/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.wiki-assembly.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.wiki-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.shared-bridge.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Shared bridge F2 under the Design owner, not restarted: F1 section storage, the r2 service contract, F2 composition and the shared services host, published as the runtime host candidate 73a6532159686c769ba6e39d8070907b2a9b021e on work/hq-design-runtime-host (foundation d9f9682d43cc36b234248c7375018d067bbd3ca5 merged in) or its read-back successor. The Design owner is the sole writer of shared services, IPC, contracts, main, preload, environment, root scripts and config, the Design host compatibility layer, apps/desktop/tsconfig.design-host.json and ServiceSettings, and holds modules/design/app/compose and modules/design/app/index.ts until CL1b. ServiceSettings and the exact Social 403 refresh are already implemented; keep the canonical ServiceResponse, closed typed routes, main-only configuration and tokens, and no generic filesystem, shell or URL IPC. F1's accepted modules/design/app/storage files are frozen lineage carried by this candidate; K1 alone writes that directory now. Keep the CSP unchanged unless T1 accepts a rebind. Root owns the candidate's PR publication and landing; it is not a K task.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "apps/desktop",
    "packages/contracts",
    "modules/design/app/compose",
    "modules/design/app/index.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.joint-shell.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.shared-bridge.001"
  ],
  "affected_check_groups": [
    "hq-shared-bridge",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.shared-bridge.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.bridge-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 publishes (or reads back) the runtime host candidate PR from work/hq-design-runtime-host against work/hq-foundation. It verifies the diff is only the bridge work plus F1's frozen, already accepted storage lineage, requires green exact-head checks, merges with --match-head-commit and reads back. This releases the K1, K2 and K3 landings and hands modules/design/app/compose and app/index.ts to CL1b.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/",
    "packages/contracts/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.shared-bridge.001",
    "spec.hq-integration-parallel-execution#task.shell-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.bridge-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.live-wiring.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Wire the landed Social live and Work runtime adapters to the bridge transports in the shell, with real local services opt-in and synthetic services by default. Add a shell integration test proving the live path, unavailable/unknown truthfulness, no unknown-write retry and no live-to-fixture fallback. Exercise Work against a disposable local Planner service from services/planner.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "apps/desktop/src/modules.tsx",
    "apps/desktop/src/services",
    "apps/desktop/electron",
    "apps/desktop/src/live-services.integration.test.tsx"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.bridge-landing.001",
    "spec.hq-integration-parallel-execution#task.social-landing.001",
    "spec.hq-integration-parallel-execution#task.work-landing.001",
    "spec.hq-integration-parallel-execution#task.main-sync.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.live-wiring.001"
  ],
  "affected_check_groups": [
    "hq-shared-bridge",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.live-wiring.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiki-mount.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Mount Wiki fourth in the rail after Work with createWikiDomain({ getPort }) from modules/wiki. Add domain ID wiki to shared contracts; the seven-method preload/IPC with host-only refresh and home migration in main over modules/wiki/core; register the @hq/wiki workspace and its lockfile entry; raise engines and CI to Node >=22.18; keep Wiki node:test suites out of Vitest discovery and run them in a Node test-runner step in foundation.yml; add main-only Wiki home and source configuration (renderer sees labels only); external CSS under the existing CSP. Prove a synthetic Git-corpus round trip through the real shell. This mount never claims spec.hq-expansion wiki-integration closure while private validation is held.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.wiki-host-ipc.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.ts",
    ".github/workflows/foundation.yml",
    "apps/desktop/package.json",
    "apps/desktop/vite.config.ts",
    "apps/desktop/src/modules.tsx",
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/styles.css",
    "apps/desktop/src/environment.d.ts",
    "apps/desktop/electron",
    "packages/contracts",
    "apps/desktop/src/wiki.integration.test.tsx",
    "apps/desktop/src/ServiceSettings.tsx"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.wiki-mount.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.live-wiring.001",
    "spec.hq-integration-parallel-execution#task.wiki-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.wiki-mount.001"
  ],
  "affected_check_groups": [
    "hq-wiki-module",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.wiki-mount.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.acceptance-harness.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t7",
  "objective": "Build a dependency-free Electron acceptance harness under tests/acceptance. It launches the built app with an owned temporary profile and drives it over the Chrome DevTools Protocol using Node's built-in WebSocket. Cover the Design/Social/Work/Wiki round trip, state persistence and replay across restart, domain-reference round trips and truthful unavailable/unknown states over synthetic services. Each run cleans up its profile and processes on success, failure and cancellation. Add no npm dependency or script; run with node. The host has Xvfb, bubblewrap, user namespaces and fonts, but the Jones Code harness rejects HQ's layout, so build an HQ-specific native harness and do not alter HQ's layout to suit that runner. Stay separate from Design production code and tests. Develop now against the #49 head, and use Wiki and live paths as they land.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "tests/acceptance",
    "docs/evidence/hq-integration/acceptance"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.working-app.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.acceptance-harness.001"
  ],
  "affected_check_groups": [
    "hq-electron-acceptance"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.acceptance-harness.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.harness-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the test-only harness PR, merges it into work/hq-foundation and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "tests/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.acceptance-harness.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.harness-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.install-route.001" -->
```json
{
  "schema_version": 1,
  "kind": "research",
  "profile_role": "researcher",
  "accountable_owner": "lane-t7",
  "objective": "Read-only: identify the owner-authorized route for building, installing and launching the final candidate on the owner's laptop. Cover the platform, an available packaging command or its absence, and display availability for the Electron harness on the build host. Do not install, change privileges or configuration, sign, or access credentials. If no proved route exists, return the exact platform gap.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "docs/",
    "package.json",
    "apps/desktop/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.working-app.001"
  ],
  "test_refs": [],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "Any host effect, elevation, signing or credential access would be needed."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.install-route.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.final-acceptance.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "On the exact final work/hq-foundation head (equal to the #2 head), run npm ci, typecheck, test and build, the Wiki Node tests, CLI and Planner tests, the Electron acceptance scenarios and the closure suites. Then follow the bound laptop route: install and launch the final candidate. Report every failure, skip and gap, and every held capability with its gate; never report a gap or a fixture as a pass.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.wiki-mount.001",
    "spec.hq-integration-parallel-execution#task.harness-landing.001",
    "spec.hq-integration-parallel-execution#task.install-route.001",
    "spec.hq-integration-parallel-execution#task.wiki-mount-landing.001",
    "spec.hq-integration-parallel-execution#task.scenarios-landing.001",
    "spec.hq-integration-parallel-execution#task.closure-qualification.001",
    "spec.hq-integration-parallel-execution#task.receiver-s1-qualification.001",
    "spec.hq-integration-parallel-execution#task.new-thread-u1-qualification.001",
    "spec.hq-integration-parallel-execution#task.preview-s2-qualification.001",
    "spec.hq-integration-parallel-execution#task.component-containment-gate.001",
    "spec.hq-integration-parallel-execution#task.wiki-private-validation-gate.001",
    "spec.hq-integration-parallel-execution#task.service-enablement-qualification.001",
    "spec.hq-integration-parallel-execution#task.laptop-route-binding.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-integration-parallel-execution#task.install-route.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.working-app.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.final-acceptance.001"
  ],
  "affected_check_groups": [
    "hq-root-build",
    "hq-cli-planner",
    "hq-electron-acceptance",
    "hq-capability-closure"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "Head moved during the run; restart on the new exact head."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.final-acceptance.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.main-delivery.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 marks #2 ready and requires green exact-head foundation and design-sections checks plus accepted final-acceptance evidence for that same head. It then merges #2 into main with --merge --match-head-commit, and reads back main, the merge commit and #2. All other original PRs are already merged; the audit confirms each actual merged state.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.final-acceptance.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-integration-parallel-execution#task.final-acceptance.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.main-delivery.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.main-delivery.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.main-delivery.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-storage-engine.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "K1 from the runtime host candidate 73a6532159686c769ba6e39d8070907b2a9b021e: the storage engine and adapters in ctx.lane-t8.001 — WorkspaceRecords, references/evidence/outbox/discovery-cache adapters, the hq.design.storage.import-txn/v1 transaction (validate, preflight, stage, single commitPuts, replay, intent CAS), blocked-intent overlay, explicit import.repair with quarantine, read-only diagnostics and bundle/v1 export with the omitted report, exported only from node.ts. Status constants stay off. Publish one non-draft PR against work/hq-design-runtime-host.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/design/app/storage"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.design-closure.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.design-storage-engine.001"
  ],
  "affected_check_groups": [
    "hq-design-storage-engine"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "packages/design-store, F1 signatures or another cone would need a change; stop and report."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-storage-engine.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-app-sections.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "K2 from 73a6532159686c769ba6e39d8070907b2a9b021e: production Requests, Runs and References sections in modules/design/app/sections with env.ts factories over injected lane ports and pipeline.ts for the full loop in req.design-closure.001 (labelled simulated destination only). Sole editor of .github/workflows/design-sections.yml: one app-sections row, HQD_EXPECTED_ROWS and inventory accounting. No descriptors, no compose edits; the PR37 producer stays unmounted. Publish one non-draft PR against work/hq-design-runtime-host.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/design/app/sections",
    ".github/workflows/design-sections.yml"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.design-closure.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.design-app-sections.001"
  ],
  "affected_check_groups": [
    "hq-design-app-sections"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "packages/design-store, F1 signatures or another cone would need a change; stop and report."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-app-sections.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-local-catalog.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "K3 from 73a6532159686c769ba6e39d8070907b2a9b021e: first a preflight that the existing SourceAdapter contract and the discovery workflow row cover the new tests (otherwise stop; never edit the workflow). Then the Node snapshot builder discovery/node/local-directory.ts and the renderer adapter over a structural LocalCatalogPort with every guard in ctx.lane-t8.001, qualificationRef hq.design.local-directory-adapter/v1. Publish one non-draft PR against work/hq-design-runtime-host.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/design/discovery/node",
    "modules/design/discovery/src/adapters",
    "modules/design/discovery/test"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.design-closure.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.design-local-catalog.001"
  ],
  "affected_check_groups": [
    "hq-design-local-catalog"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "packages/design-store, F1 signatures or another cone would need a change; stop and report."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-local-catalog.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-storage-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 retargets the design-storage-engine PR from work/hq-design-runtime-host to work/hq-foundation after bridge-landing, then verifies a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/app/storage/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-storage-engine.001",
    "spec.hq-integration-parallel-execution#task.bridge-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-storage-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-sections-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 retargets the design-app-sections PR from work/hq-design-runtime-host to work/hq-foundation after bridge-landing, then verifies a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back. Workflow custody returns to T2.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/app/sections/",
    ".github/workflows/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-app-sections.001",
    "spec.hq-integration-parallel-execution#task.bridge-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-sections-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-catalog-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 retargets the design-local-catalog PR from work/hq-design-runtime-host to work/hq-foundation after bridge-landing, then verifies a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/discovery/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-local-catalog.001",
    "spec.hq-integration-parallel-execution#task.bridge-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-catalog-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.shared-r3.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Shared r3, one new Design descendant as sole shared writer after the bridge: every route and member in iface.shared-r3.001 — Design records and document roots, the readers-writer gate with recover() before serving, disabled transaction/export routes over K1's node.ts, catalog routes over K3's Node builder plus catalog cache.put, Work export through the shared save dialog, @hq/contracts/references exactly as spec.hq-social-work iface.references.001, optional ModulePort references/returnContext, App open/return/Back with the in-memory cache and read-only project mismatch, root-owned reference-providers.ts, and assignability tests for module-local structural types. Electron security invariants and CSP unchanged.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.shared-r3.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "packages/contracts",
    "apps/desktop/electron",
    "apps/desktop/design-host",
    "apps/desktop/tsconfig.design-host.json",
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/references.ts",
    "apps/desktop/src/references.test.ts",
    "apps/desktop/src/reference-providers.ts",
    "apps/desktop/src/environment.d.ts",
    "apps/desktop/src/services"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.design-closure.001",
    "spec.hq-integration-parallel-execution#req.references-closure.001",
    "spec.hq-integration-parallel-execution#req.work-export.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.bridge-landing.001",
    "spec.hq-integration-parallel-execution#task.design-storage-landing.001",
    "spec.hq-integration-parallel-execution#task.design-catalog-landing.001",
    "spec.hq-integration-parallel-execution#task.wiki-mount-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001",
    "spec.hq-integration-parallel-execution#ac.reference-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.shared-r3.001"
  ],
  "affected_check_groups": [
    "hq-shared-r3",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.shared-r3.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.r3-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the shared-r3 PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/",
    "packages/contracts/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.shared-r3.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.r3-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiring-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the live-wiring PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.live-wiring.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.wiring-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiki-mount-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the wiki-mount PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/",
    "modules/wiki/",
    ".github/workflows/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.wiki-mount.001",
    "spec.hq-integration-parallel-execution#task.wiring-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.wiki-mount-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-reference-provider.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "K4: read-only Design ReferenceProvider in modules/design/app/references-provider for kinds project | version | request | reference over injected reads, with T14-valid destinations, zero writes and zero execution calls. It is exported through app/index only by CL1b.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001",
    "spec.hq-integration-parallel-execution#iface.shared-r3.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/design/app/references-provider"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.r3-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.design-closure.001",
    "spec.hq-integration-parallel-execution#ac.reference-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.design-reference-provider.001"
  ],
  "affected_check_groups": [
    "hq-design-reference-provider"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "packages/design-store, F1 signatures or another cone would need a change; stop and report."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-reference-provider.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-provider-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the design-reference-provider PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/app/references-provider/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-reference-provider.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-provider-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-compose-mount.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "CL1b by the F2 successor: bind K2 environments over K1 adapters in compose (labelled fakes only when unbridged), add the three production descriptors modules/design/{requests,connector,references}/design-module.ts importing ../app/sections, titled Requests, Runs and References, export K4's provider through app/index, and extend the renderer-safe walk to the sections.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001",
    "spec.hq-integration-parallel-execution#iface.shared-r3.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/design/requests/design-module.ts",
    "modules/design/connector/design-module.ts",
    "modules/design/references/design-module.ts",
    "modules/design/app/compose",
    "modules/design/app/index.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.bridge-landing.001",
    "spec.hq-integration-parallel-execution#task.r3-landing.001",
    "spec.hq-integration-parallel-execution#task.design-storage-landing.001",
    "spec.hq-integration-parallel-execution#task.design-sections-landing.001",
    "spec.hq-integration-parallel-execution#task.design-provider-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.design-closure.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.design-compose-mount.001"
  ],
  "affected_check_groups": [
    "hq-design-compose"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "packages/design-store, F1 signatures or another cone would need a change; stop and report."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-compose-mount.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.design-compose-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the design-compose-mount PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-compose-mount.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.design-compose-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.reference-ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t9",
  "objective": "D-4 reference UI in @hq/ui: ReferenceChip, LinkList and LinkPicker over local structural copies of the reference types, every RL-4 status with text label and freshness, light/dark, keyboard only, readable snapshots, explicit Unlink and Update snapshot with Undo; explicit exports in packages/hq-ui/src/index.ts.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t9.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "packages/hq-ui/src/references",
    "packages/hq-ui/test/references",
    "packages/hq-ui/src/index.ts",
    "docs/evidence/hq-social-work/reference-ui"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.reference-lane-custody.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.reference-closure.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.reference-ui.001"
  ],
  "affected_check_groups": [
    "hq-reference-ui"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.reference-ui.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.reference-ui-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the reference-ui PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "packages/hq-ui/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.reference-ui.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.reference-ui-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.social-references.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t10",
  "objective": "Read-only Social ReferenceProvider (drafts, runs, brands) and the content link editor. Without hq-references-v1, links show 'not saved — needs Social service support' and are never dropped. Mount plumbing passes optional references/returnContext through index and nav only. Zero execution calls on the recorder; no cross-domain import; no live-runtime edit.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t10.001",
    "spec.hq-integration-parallel-execution#iface.shared-r3.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/social/references",
    "modules/social/content",
    "modules/social/index.tsx",
    "modules/social/nav/SocialDomain.tsx",
    "modules/social/nav/index.ts",
    "docs/evidence/hq-social-work/social-references"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.r3-landing.001",
    "spec.hq-integration-parallel-execution#task.reference-ui-landing.001",
    "spec.hq-integration-parallel-execution#task.social-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.reference-lane-custody.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.reference-closure.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.social-references.001"
  ],
  "affected_check_groups": [
    "hq-social-references"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.social-references.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.social-references-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the social-references PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/social/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.social-references.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.social-references-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-references.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t11",
  "objective": "Work ReferenceProvider (items including archived and missing) and the card detail Links section with kind:'hq', revision guards, conflict handling and Undo, enabled only with hq-references-v1; mount plumbing through index and nav only; no live or core runtime edit; fixture export/import preserves envelopes byte-for-byte; dragging a linked card makes zero execution calls.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t11.001",
    "spec.hq-integration-parallel-execution#iface.shared-r3.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/work/references",
    "modules/work/detail",
    "modules/work/index.tsx",
    "modules/work/nav/WorkDomain.tsx",
    "modules/work/nav/index.ts",
    "docs/evidence/hq-social-work/work-references"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.r3-landing.001",
    "spec.hq-integration-parallel-execution#task.reference-ui-landing.001",
    "spec.hq-integration-parallel-execution#task.work-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.reference-lane-custody.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.reference-closure.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.work-references.001"
  ],
  "affected_check_groups": [
    "hq-work-references"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-references.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-references-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the work-references PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/work/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.work-references.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-references-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-export-ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t11",
  "objective": "RW-6 Export UI in the same Work lane after references: JSON or Markdown through a module-local structural export port matching r3's client, showing the Planner status and saved, never a path; import and restore stay pointers to the Planner's own tools.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t11.001",
    "spec.hq-integration-parallel-execution#iface.shared-r3.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/work/export",
    "modules/work/nav/WorkDomain.tsx",
    "modules/work/nav/index.ts",
    "docs/evidence/hq-social-work/work-export"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.work-export.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.work-references.001",
    "spec.hq-integration-parallel-execution#task.r3-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.reference-closure.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.work-export-ui.001"
  ],
  "affected_check_groups": [
    "hq-work-references"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-export-ui.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-export-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the work-export-ui PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/work/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.work-export-ui.001",
    "spec.hq-integration-parallel-execution#task.work-references-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-export-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.reference-round-trip.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Register the landed Design, Social and Work providers in apps/desktop/src/reference-providers.ts and prove spec.hq-social-work ac.reference-integration.001 in a shell integration test: Social draft ↔ Work card links, open and Back with source state intact, truthful changed/archived/missing/moved/unavailable, unlink leaves the target, export/import preserves links, all execution spies zero. Also hand r3's Work export client to the Work module mount in apps/desktop/src/modules.tsx through the module-local structural export port.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.shared-r3.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "apps/desktop/src/reference-providers.ts",
    "apps/desktop/src/references.integration.test.tsx",
    "apps/desktop/src/modules.tsx"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.r3-landing.001",
    "spec.hq-integration-parallel-execution#task.social-references-landing.001",
    "spec.hq-integration-parallel-execution#task.work-references-landing.001",
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.work-export-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.reference-closure.001",
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.reference-round-trip.001"
  ],
  "affected_check_groups": [
    "hq-reference-round-trip",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.reference-round-trip.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.round-trip-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the reference-round-trip PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.reference-round-trip.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.round-trip-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.cli-planner-ci.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "After K2 returns workflow custody, add .github/workflows/cli-planner.yml running the tools/hq-cli node tests and the services/planner tests on hosted runners, read-only permissions, no secrets, pinned Node and Python; touch no other workflow.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    ".github/workflows/cli-planner.yml"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.hosted-ci.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-sections-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.cli-planner-ci.001"
  ],
  "affected_check_groups": [
    "hq-hosted-ci",
    "hq-cli-planner"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.cli-planner-ci.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.cli-ci-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the cli-planner-ci PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    ".github/workflows/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.cli-planner-ci.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.cli-ci-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.receiver-adapter.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Existing-thread receiver per the receiver contract framing against Jones Code 76fb3dc2bfc4d05b6681ec93de7abab18fb79356, with no Jones Code change and no Design connector contract change: main-only MCP client and OAuth PKCE loopback flow with safeStorage credentials; t3_thread_send in queue mode with clientRequestId = the attempt key; a durable pre-send ledger; timeline-suffix and queue-marker lookup; run-scoped evidence readback as agent-reported text; unknown fenced and never resent. Closed design.jonesCode.* routes reconciled with r3 names, mapped to the TransportPort and EvidenceReadbackPort for transport:'jones-code' and kept unqualified. The renderer sees status only. Qualify with the Q-S wire stub only; no live send.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.shared-r3.001",
    "spec.hq-integration-parallel-execution#iface.service-response.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "apps/desktop/electron/jones-code",
    "apps/desktop/electron/main.ts",
    "apps/desktop/electron/preload.cts",
    "apps/desktop/src/ServiceSettings.tsx",
    "apps/desktop/src/modules.tsx",
    "packages/contracts/src/jones-code.ts",
    "packages/contracts/src/index.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.wiki-mount-landing.001",
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.round-trip-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.receiver-adapter.001"
  ],
  "affected_check_groups": [
    "hq-receiver-adapter",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "Any live Jones Code send, OAuth consent or token read would be needed."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.receiver-adapter.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.receiver-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the receiver-adapter PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/",
    "packages/contracts/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.receiver-adapter.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.receiver-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.acceptance-scenarios.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t7",
  "objective": "Extend the landed native harness with the integrated scenarios it held: four-domain round trip including Wiki, live and replay paths over synthetic services, restart persistence, Design Requests/Runs/References over durable storage, reference round trips and Work export to an owned temporary directory, truthful unavailable/unknown. No npm dependency; owned profile and process cleanup on every exit path.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "tests/acceptance",
    "docs/evidence/hq-integration/acceptance"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.harness-landing.001",
    "spec.hq-integration-parallel-execution#task.wiring-landing.001",
    "spec.hq-integration-parallel-execution#task.wiki-mount-landing.001",
    "spec.hq-integration-parallel-execution#task.round-trip-landing.001",
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.work-export-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.working-app.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.acceptance-scenarios.001"
  ],
  "affected_check_groups": [
    "hq-electron-acceptance"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.acceptance-scenarios.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.scenarios-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the acceptance-scenarios PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "tests/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.acceptance-scenarios.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.scenarios-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.import-export-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "On one exact work/hq-foundation head after K1, r3 and CL1b land, run K1's fault-injection, blocked-state, preflight, concurrency, export and surface suites plus r3's gate and disabled-route tests; record exact head, counts and every skip for T1 acceptance under the owner's existing permission.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-storage-landing.001",
    "spec.hq-integration-parallel-execution#task.r3-landing.001",
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.design-closure.001",
    "spec.hq-integration-parallel-execution#ac.import-export-enablement.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.import-export-qualification.001"
  ],
  "affected_check_groups": [
    "hq-design-storage-engine",
    "hq-shared-r3"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.import-export-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.import-export-enablement.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "The exact enablement checkpoint: one commit turning on EXPORT_STATUS and the transaction status constant for the accepted head's evidence, nothing else; disabled-route tests become enabled-route tests.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [
    "modules/design/app/storage/export.ts",
    "modules/design/app/storage/transactions.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.import-export-qualification.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-integration-parallel-execution#task.import-export-qualification.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.import-export-enablement.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.import-export-enablement.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.import-export-enablement.001"
  ],
  "affected_check_groups": [
    "hq-design-storage-engine"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "packages/design-store, F1 signatures or another cone would need a change; stop and report."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.import-export-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.enablement-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the import-export-enablement PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/app/storage/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.import-export-enablement.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.source-landing.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "T1 alone mutates shared integration refs and PR bases; one serialized operation per shared ref.",
    "Merge with an exact --match-head-commit after green exact-head checks; read back ref, PR state and ancestry.",
    "No force, rewind or retry of an unknown effect; reconcile first and repair forward by revert."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.enablement-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.closure-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "On one exact work/hq-foundation head, produce the typed capability matrix of ac.capability-closure.001: each closure requirement closed with its suite and evidence, or held with its gate. A missing implementation or suite is a failure, never a hold.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.enablement-landing.001",
    "spec.hq-integration-parallel-execution#task.scenarios-landing.001",
    "spec.hq-integration-parallel-execution#task.cli-ci-landing.001",
    "spec.hq-integration-parallel-execution#task.design-catalog-landing.001",
    "spec.hq-integration-parallel-execution#task.work-export-landing.001",
    "spec.hq-integration-parallel-execution#task.round-trip-landing.001",
    "spec.hq-integration-parallel-execution#task.wiki-mount-landing.001",
    "spec.hq-integration-parallel-execution#task.receiver-landing.001",
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.capability-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.closure-qualification.001"
  ],
  "affected_check_groups": [
    "hq-capability-closure",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.closure-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.receiver-s1-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "Live S1 Q0–Q5 against the bound task-owned receiver after native OAuth consent; set qualification.evidenceRef only from those results.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.receiver-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.receiver-s1-binding.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.receiver-s1-binding.001",
    "spec.hq-integration-parallel-execution#ac.capability-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.receiver-s1-qualification.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "OAuth consent, receiver binding or synthetic packet is absent; report held."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.receiver-s1-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.new-thread-u1-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "Qualify new-thread launch only after an adopted idempotent client-callable Jones Code launch with lookup by key; no fake launch qualification.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.receiver-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.new-thread-u1-binding.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.new-thread-u1-binding.001",
    "spec.hq-integration-parallel-execution#ac.capability-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.new-thread-u1-qualification.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "No adopted U1 contract; report new-thread mode disabled and held."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.new-thread-u1-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-s2-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "Qualify the S2 preview surface with route/viewport/digest binding after the accepted containment design is implemented by amendment.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.preview-s2-binding.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.preview-s2-binding.001",
    "spec.hq-integration-parallel-execution#ac.capability-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.preview-s2-qualification.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "No accepted containment design or landed implementation; report held."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-s2-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.component-containment-gate.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "Qualify component execution containment with native host evidence; execution stays disabled until accepted.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.component-containment-binding.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.component-containment-binding.001",
    "spec.hq-integration-parallel-execution#ac.capability-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.component-containment-gate.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "No containment evidence; report held."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.component-containment-gate.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiki-private-validation-gate.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "Read back the accepted owner-local spec.hq-expansion wiki-private-validation result (aggregates only).",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.wiki-mount-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.wiki-private-validation-binding.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.wiki-private-validation-binding.001",
    "spec.hq-integration-parallel-execution#ac.capability-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.wiki-private-validation-gate.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "No exact privacy scope; report held and never read a private corpus."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.wiki-private-validation-gate.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.service-enablement-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "After owner-approved service envelopes and owner-entered endpoints, read back live conformance owned by the service owners, including the exact 403 predicate.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.wiring-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.service-enablement-binding.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.service-enablement-binding.001",
    "spec.hq-integration-parallel-execution#ac.capability-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.service-enablement-qualification.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "Envelopes not executed or endpoints absent; report held and read no live data."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.service-enablement-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.laptop-route-binding.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t7",
  "objective": "Bind the owner's laptop target and the authorized unsigned build and install route for final acceptance.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/",
    "apps/desktop/",
    "packages/",
    "modules/",
    "tests/",
    "tools/hq-cli/",
    "services/planner/",
    "package.json",
    "vitest.config.ts",
    "tsconfig.json"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.install-route.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.laptop-route-binding.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.laptop-route-binding.001",
    "spec.hq-integration-parallel-execution#ac.capability-closure.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.laptop-route-binding.001"
  ],
  "affected_check_groups": [],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Own only the literal write scope in one isolated non-main HQ worktree; one Git owner per worktree.",
    "Public repository: no private corpus, personal data, host addresses, session history, native thread IDs or credentials.",
    "Merge commits only; no force push, rebase, squash, history rewrite, branch or worktree deletion.",
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "No target or route, or elevation, signing or credentials would be needed; report the exact gap."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.laptop-route-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.source-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "scenario": "Each T1 landing reads back the target ref OID, the PR merged state and merge commit, and ancestry of the exact head.",
  "evidence": {
    "predicate": "Native GitHub readback matches the expected postcondition.",
    "invalid": "A ref moved unexpectedly, a PR is unmerged, or ancestry is missing.",
    "unknown": "The response was lost or partial; reconcile before any retry."
  },
  "environment": [
    "GitHub API readback"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.shell-landing.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.shell-landing.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/engineering-specs/"
  ],
  "affected_check_groups": [
    "hq-source-readback"
  ],
  "required_at": "integration"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.source-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.joint-shell.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.domain-runtime.001"
  ],
  "scenario": "Design mounts and fills the workspace; Design→Social→Work→Design restores each domain; leaving Design flushes chrome state; Social/Work assertions are unchanged.",
  "evidence": {
    "predicate": "Root typecheck, tests and build plus design-sections pass at the exact head.",
    "invalid": "Any Social/Work execution, write, restoration or undo assertion is weakened.",
    "unknown": "Hosted checks are absent or stale for the head."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.joint-shell.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.joint-shell.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/src/"
  ],
  "affected_check_groups": [
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.joint-shell.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.social-live.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "scenario": "A wire stub returns 2xx, 4xx, 5xx, an empty body, malformed responses and a lost response; one exact token-rejection 403 triggers a single refresh.",
  "evidence": {
    "predicate": "Every received HTTP response is ok:true with its status; failed reads are unavailable, malformed or lost mutations unknown; submitRun is never retried; nothing falls back to fixtures.",
    "invalid": "A retry of an unknown mutation, a fixture fallback, or a token in renderer state.",
    "unknown": "The stub cannot represent the case."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.social-live.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.social-live.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/social/live/"
  ],
  "affected_check_groups": [
    "hq-social-live"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.social-live.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.work-runtime.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "scenario": "Planner wire fixtures drive reads and writes; a 5xx write yields unknown with the caller request ID; replay reconciles it; restart restores the Work session.",
  "evidence": {
    "predicate": "Module tests pass with zero duplicate writes and truthful unknown/replayed status.",
    "invalid": "Any automatic retry of an unknown write or fixture fallback.",
    "unknown": "The Planner fixture is missing for the case."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.work-runtime.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.work-runtime.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/work/live/"
  ],
  "affected_check_groups": [
    "hq-work-runtime"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.work-runtime.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.wiki-assembly.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.wiki-mount.001"
  ],
  "scenario": "A synthetic committed-Git corpus is indexed through core and rendered through the assembled module over the seven-method port.",
  "evidence": {
    "predicate": "Contract, core, UI and assembly tests pass; CSS is an external file; no private corpus is read.",
    "invalid": "Inline styles that need a CSP change, arbitrary path access, or a private corpus read.",
    "unknown": "Node >=22.18 is unavailable for the Node tests."
  },
  "environment": [
    "Node >=22.18 test runner and Vitest DOM"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.wiki-assembly.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.wiki-assembly.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/wiki/"
  ],
  "affected_check_groups": [
    "hq-wiki-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.wiki-assembly.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.shared-bridge.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "scenario": "Closed routes cross preload into main; config and tokens stay in main; Design durable storage persists through main/preload.",
  "evidence": {
    "predicate": "Root checks and Electron security tests pass; module transport types are assignable to the canonical type.",
    "invalid": "Generic filesystem, shell or URL IPC, a token reaching the renderer, or a CSP change without rebind.",
    "unknown": "Electron cannot run on the check host."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.shared-bridge.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.shared-bridge.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/electron/",
    "packages/contracts/"
  ],
  "affected_check_groups": [
    "hq-shared-bridge"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.shared-bridge.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.live-wiring.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "scenario": "The shell drives Social through a wire stub and Work through a disposable local Planner service.",
  "evidence": {
    "predicate": "Integration tests pass with truthful status and no duplicate or fallback effects.",
    "invalid": "Live and fixture data are mixed or unlabelled.",
    "unknown": "The local Planner service cannot start."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only",
    "Python 3 for the disposable Planner service"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.live-wiring.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.live-wiring.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/src/"
  ],
  "affected_check_groups": [
    "hq-shared-bridge"
  ],
  "required_at": "integration-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.live-wiring.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.wiki-mount.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.wiki-mount.001"
  ],
  "scenario": "Wiki appears fourth in the rail; search, page, backlinks and topics work over IPC against a synthetic corpus; refresh is host-only.",
  "evidence": {
    "predicate": "Root checks include modules/wiki and pass; Wiki node:test suites run in a CI Node test-runner step on Node >=22.18 and stay out of Vitest discovery; home and source configuration is main-only.",
    "invalid": "The renderer can trigger refresh, read paths or arbitrary sources, or Wiki tests are silently excluded.",
    "unknown": "CI Node version cannot be raised."
  },
  "environment": [
    "Node >=22.18"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.wiki-mount.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.wiki-mount.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/",
    "modules/wiki/"
  ],
  "affected_check_groups": [
    "hq-wiki-module",
    "hq-root-build"
  ],
  "required_at": "integration-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.wiki-mount.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.acceptance-harness.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "scenario": "The harness launches the built app, completes domain round trips and restart persistence, and cleans its profile on every exit path.",
  "evidence": {
    "predicate": "The harness passes against the current candidate, with a self-test for cleanup.",
    "invalid": "A leaked profile or process, or a pass recorded without a real Electron launch.",
    "unknown": "No display is available on the host; record it as a platform gap."
  },
  "environment": [
    "Built app on the check host"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.acceptance-harness.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.acceptance-harness.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "tests/acceptance/"
  ],
  "affected_check_groups": [
    "hq-electron-acceptance"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.acceptance-harness.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.final-acceptance.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "scenario": "The full matrix and the closure suites run on the exact final foundation head, followed by laptop install and launch through the bound route.",
  "evidence": {
    "predicate": "Every listed check passes at one head; installation evidence or an exact gap is recorded.",
    "invalid": "Mixed heads, an omitted check, or a gap reported as a pass.",
    "unknown": "The install route is unavailable."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only",
    "owner laptop through the proved route"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.final-acceptance.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.final-acceptance.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "tests/acceptance/",
    "tools/hq-cli/",
    "services/planner/"
  ],
  "affected_check_groups": [
    "hq-root-build",
    "hq-cli-planner",
    "hq-electron-acceptance",
    "hq-capability-closure"
  ],
  "required_at": "candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.final-acceptance.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.main-delivery.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "scenario": "#2 merges into main at the exact accepted head.",
  "evidence": {
    "predicate": "Main contains the #2 head; #2 is merged; every original PR reads back as actually merged.",
    "invalid": "Main moved to an unaccepted head, or an original PR's disposition is wrong.",
    "unknown": "The merge response was lost; read back before any action."
  },
  "environment": [
    "GitHub API readback"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.main-delivery.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.main-delivery.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-source-readback"
  ],
  "required_at": "integration"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.main-delivery.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.design-storage-engine.001" -->
```json
{
  "schema_version": 1,
  "kind": "recovery/fault",
  "validates": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "scenario": "Fault-injecting fs crashes every call across stage, commit, replay and intent; torn and corrupt streams; preflight refusals; concurrent doc.put; export round trip.",
  "evidence": {
    "predicate": "After reopen and recover the host sees nothing or everything; no duplicate events; byte-equal stores on refusal; deterministic export with the exact omitted report; disabled routes unavailable.",
    "invalid": "A partial state is visible, a repair runs automatically, a corrupt stream is repaired, or a delete member exists.",
    "unknown": "The fault injector cannot reach an fs call."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.design-storage-engine.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.design-storage-engine.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/app/storage/"
  ],
  "affected_check_groups": [
    "hq-design-storage-engine"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.design-storage-engine.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.design-app-sections.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "scenario": "The full Requests→Runs→References loop on in-memory and crashing doubles with restart recovery.",
  "evidence": {
    "predicate": "No dispatch without a durable send record; unknown never resent; reject creates nothing; navigation and readback send nothing; fakes labelled; the app-sections row runs in CI.",
    "invalid": "A descriptor is added, a fake appears real, or an owner-reported return claims native verification.",
    "unknown": "Hosted checks absent for the head."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.design-app-sections.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.design-app-sections.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/app/sections/"
  ],
  "affected_check_groups": [
    "hq-design-app-sections"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.design-app-sections.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.design-local-catalog.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "scenario": "Synthetic temporary roots exercise caps, dot directories, symlinks, realpath escape, bad segments, previews and digest mismatch.",
  "evidence": {
    "predicate": "Every guard holds; no .git read or execution; qualificationRef set once the suite passes under the existing discovery row.",
    "invalid": "A path escapes the root, the renderer sees an absolute path, or the workflow is edited.",
    "unknown": "The host filesystem cannot create symlinks."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.design-local-catalog.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.design-local-catalog.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/discovery/"
  ],
  "affected_check_groups": [
    "hq-design-local-catalog"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.design-local-catalog.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.shared-r3.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.design-closure.001",
    "spec.hq-integration-parallel-execution#req.references-closure.001",
    "spec.hq-integration-parallel-execution#req.work-export.001"
  ],
  "scenario": "Closed r3 routes cross preload into main; gate exclusivity and recover-before-serve; Work export via a stubbed save dialog and Planner stub; reference open/Back/mismatch in the shell.",
  "evidence": {
    "predicate": "Root checks and Electron security tests pass; transaction/export routes return unavailable(disabled); Work export bytes equal the stub and the renderer gets no path; reference contract matches iface.references.001; structural types assignable.",
    "invalid": "Generic IPC, a path or token in renderer state, an enabled route, or a CSP change.",
    "unknown": "Electron cannot run on the check host."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.shared-r3.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.shared-r3.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/electron/",
    "packages/contracts/"
  ],
  "affected_check_groups": [
    "hq-shared-r3",
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.shared-r3.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.design-reference-provider.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "scenario": "find and resolve over injected fake reads for project, version, request and reference kinds.",
  "evidence": {
    "predicate": "Statuses truthful with observedAt; T14-valid destinations; zero writes and execution calls.",
    "invalid": "A write, an execution call, or a cross-domain import.",
    "unknown": "A kind has no fixture."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.design-reference-provider.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.design-reference-provider.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/app/references-provider/"
  ],
  "affected_check_groups": [
    "hq-design-reference-provider"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.design-reference-provider.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.design-compose-mount.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "scenario": "The production registry shows Requests, Runs and References bound to bridged durable adapters.",
  "evidence": {
    "predicate": "Sections mount in production; labelled fakes only when unbridged; renderer-safe walk covers sections.",
    "invalid": "Preview-only registration counted as production, or a fake shown as real.",
    "unknown": "Bridge unavailable on the check host."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.design-compose-mount.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.design-compose-mount.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/app/compose/"
  ],
  "affected_check_groups": [
    "hq-design-compose"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.design-compose-mount.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.reference-ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "scenario": "Chip, list and picker render all eight statuses in light and dark by keyboard.",
  "evidence": {
    "predicate": "Text label and freshness per status; readable snapshots; Unlink and Update snapshot explicit with Undo.",
    "invalid": "Colour-only status, or an automatic snapshot update.",
    "unknown": "DOM environment unavailable."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.reference-ui.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.reference-ui.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "packages/hq-ui/src/references/"
  ],
  "affected_check_groups": [
    "hq-reference-ui"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.reference-ui.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.social-references.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "scenario": "Fixture Social provider and link editor with and without hq-references-v1.",
  "evidence": {
    "predicate": "Read-only resolve; links without the flag shown not saved and kept; zero execution calls.",
    "invalid": "Links silently dropped or sent to a service without the flag.",
    "unknown": "Recorder unavailable."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.social-references.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.social-references.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/social/references/"
  ],
  "affected_check_groups": [
    "hq-social-references"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.social-references.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.work-references.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "scenario": "Fixture Work provider and Links section including archived and missing, conflicts and Undo.",
  "evidence": {
    "predicate": "Revision-guarded link mutations; byte-preserved export/import; zero execution calls on drag.",
    "invalid": "A live or core runtime edit, or an unguarded write.",
    "unknown": "Planner fixture lacks a case."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.work-references.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.work-references.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/work/references/"
  ],
  "affected_check_groups": [
    "hq-work-references"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.work-references.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.work-export-ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.work-export.001"
  ],
  "scenario": "Export UI over a structural export port returning saved, non-2xx and unavailable.",
  "evidence": {
    "predicate": "Status truthful; no path in renderer state; import stays a pointer.",
    "invalid": "A path or byte transformation in the renderer.",
    "unknown": "Port stub missing a case."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.work-export-ui.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.work-export-ui.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/work/export/"
  ],
  "affected_check_groups": [
    "hq-work-references"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.work-export-ui.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.reference-round-trip.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.references-closure.001"
  ],
  "scenario": "Shell integration: Social draft ↔ Work card, open, Back, statuses, unlink, export/import.",
  "evidence": {
    "predicate": "ac.reference-integration.001 holds with all execution spies at zero.",
    "invalid": "Navigation without return state, silent cross-project navigation, or a global store.",
    "unknown": "A provider is unregistered."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.reference-round-trip.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.reference-round-trip.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/src/"
  ],
  "affected_check_groups": [
    "hq-reference-round-trip",
    "hq-root-build"
  ],
  "required_at": "integration-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.reference-round-trip.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.cli-planner-ci.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.hosted-ci.001"
  ],
  "scenario": "The new hosted workflow runs CLI and Planner tests on a PR head.",
  "evidence": {
    "predicate": "Hosted CLI and Planner jobs report success at the exact head with read-only permissions.",
    "invalid": "Secrets, write permissions, or a skipped job counted green.",
    "unknown": "Hosted runner unavailable."
  },
  "environment": [
    "GitHub-hosted runner"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.cli-planner-ci.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.cli-planner-ci.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    ".github/workflows/"
  ],
  "affected_check_groups": [
    "hq-hosted-ci",
    "hq-cli-planner"
  ],
  "required_at": "ci"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.cli-planner-ci.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.receiver-adapter.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Q-S: a recorded-schema Jones Code MCP stub at 76fb3dc shapes covers success, every typed failure, timeout after write, same-key replay, timeline/queue lookup, absence, duplicates, overflow, run-status mapping, oversize, ledger failure and 401.",
  "evidence": {
    "predicate": "Outcomes match the framing table; unknown never resent; no token or command ID in renderer state; transport stays unqualified.",
    "invalid": "A live send, a retry of unknown, a no-effect from lookup, or a qualified flag from fixtures.",
    "unknown": "The stub cannot represent a case."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.receiver-adapter.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.receiver-adapter.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/electron/jones-code/"
  ],
  "affected_check_groups": [
    "hq-receiver-adapter",
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.receiver-adapter.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.acceptance-scenarios.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "scenario": "Real Electron runs cover four domains, live/replay, restart, Design loop, references and Work export.",
  "evidence": {
    "predicate": "Every scenario passes on the candidate with cleanup self-test.",
    "invalid": "A pass without a real launch, or leaked profiles or processes.",
    "unknown": "No display; record a gap."
  },
  "environment": [
    "Built app on the check host"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.acceptance-scenarios.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.acceptance-scenarios.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "tests/acceptance/"
  ],
  "affected_check_groups": [
    "hq-electron-acceptance"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.acceptance-scenarios.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.import-export-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "recovery/fault",
  "validates": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "scenario": "K1 and r3 crash, CAS and privacy suites on one exact integrated head.",
  "evidence": {
    "predicate": "All suites pass at one head with counts recorded.",
    "invalid": "Mixed heads or omitted suites.",
    "unknown": "Fault injector unavailable."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.import-export-qualification.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.import-export-qualification.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/app/storage/"
  ],
  "affected_check_groups": [
    "hq-design-storage-engine",
    "hq-shared-r3"
  ],
  "required_at": "verification"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.import-export-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.import-export-enablement.001" -->
```json
{
  "schema_version": 1,
  "kind": "unit",
  "validates": [
    "spec.hq-integration-parallel-execution#req.design-closure.001"
  ],
  "scenario": "The enablement commit flips exactly the two status constants.",
  "evidence": {
    "predicate": "Only the two constants change; enabled-route tests pass.",
    "invalid": "Any other change, or enablement without the accepted evidence.",
    "unknown": "Evidence head differs."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.import-export-enablement.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.import-export-enablement.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/app/storage/"
  ],
  "affected_check_groups": [
    "hq-design-storage-engine"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.import-export-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.closure-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Typed closed/held matrix over every closure requirement at one exact head.",
  "evidence": {
    "predicate": "Every requirement closed with suite and evidence or held with its gate.",
    "invalid": "A missing implementation reported as held, or a fixture as closure.",
    "unknown": "A suite cannot run."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.closure-qualification.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.closure-qualification.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-capability-closure",
    "hq-root-build"
  ],
  "required_at": "candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.closure-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.receiver-s1-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "manual",
  "validates": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Live S1 Q0–Q5 with a task-owned receiver after native OAuth consent.",
  "evidence": {
    "predicate": "Native evidence for the bound predicate is accepted by T1.",
    "invalid": "A fixture, fake, preview or simulation offered as qualification.",
    "unknown": "The predicate is unbound; report held."
  },
  "environment": [
    "Owner-bound native environment"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.receiver-s1-qualification.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.receiver-s1-qualification.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-held-gates"
  ],
  "required_at": "verification"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.receiver-s1-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.new-thread-u1-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "manual",
  "validates": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Idempotent new-thread launch with lookup by key, after an adopted Jones Code contract.",
  "evidence": {
    "predicate": "Native evidence for the bound predicate is accepted by T1.",
    "invalid": "A fixture, fake, preview or simulation offered as qualification.",
    "unknown": "The predicate is unbound; report held."
  },
  "environment": [
    "Owner-bound native environment"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.new-thread-u1-qualification.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.new-thread-u1-qualification.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-held-gates"
  ],
  "required_at": "verification"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.new-thread-u1-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.preview-s2-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "manual",
  "validates": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Contained S2 preview with route/viewport/digest binding.",
  "evidence": {
    "predicate": "Native evidence for the bound predicate is accepted by T1.",
    "invalid": "A fixture, fake, preview or simulation offered as qualification.",
    "unknown": "The predicate is unbound; report held."
  },
  "environment": [
    "Owner-bound native environment"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.preview-s2-qualification.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.preview-s2-qualification.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-held-gates"
  ],
  "required_at": "verification"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.preview-s2-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.component-containment-gate.001" -->
```json
{
  "schema_version": 1,
  "kind": "manual",
  "validates": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Component execution under accepted containment.",
  "evidence": {
    "predicate": "Native evidence for the bound predicate is accepted by T1.",
    "invalid": "A fixture, fake, preview or simulation offered as qualification.",
    "unknown": "The predicate is unbound; report held."
  },
  "environment": [
    "Owner-bound native environment"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.component-containment-gate.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.component-containment-gate.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-held-gates"
  ],
  "required_at": "verification"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.component-containment-gate.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.wiki-private-validation-gate.001" -->
```json
{
  "schema_version": 1,
  "kind": "manual",
  "validates": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Owner-local Wiki private validation, aggregates only.",
  "evidence": {
    "predicate": "Native evidence for the bound predicate is accepted by T1.",
    "invalid": "A fixture, fake, preview or simulation offered as qualification.",
    "unknown": "The predicate is unbound; report held."
  },
  "environment": [
    "Owner-bound native environment"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.wiki-private-validation-gate.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.wiki-private-validation-gate.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-held-gates"
  ],
  "required_at": "verification"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.wiki-private-validation-gate.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.service-enablement-qualification.001" -->
```json
{
  "schema_version": 1,
  "kind": "manual",
  "validates": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Live Planner and Social conformance after owner envelopes.",
  "evidence": {
    "predicate": "Native evidence for the bound predicate is accepted by T1.",
    "invalid": "A fixture, fake, preview or simulation offered as qualification.",
    "unknown": "The predicate is unbound; report held."
  },
  "environment": [
    "Owner-bound native environment"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.service-enablement-qualification.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.service-enablement-qualification.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-held-gates"
  ],
  "required_at": "verification"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.service-enablement-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.laptop-route-binding.001" -->
```json
{
  "schema_version": 1,
  "kind": "manual",
  "validates": [
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Bound laptop target and unsigned install route.",
  "evidence": {
    "predicate": "Native evidence for the bound predicate is accepted by T1.",
    "invalid": "A fixture, fake, preview or simulation offered as qualification.",
    "unknown": "The predicate is unbound; report held."
  },
  "environment": [
    "Owner-bound native environment"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.laptop-route-binding.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.laptop-route-binding.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/"
  ],
  "affected_check_groups": [
    "hq-held-gates"
  ],
  "required_at": "verification"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.laptop-route-binding.001" -->

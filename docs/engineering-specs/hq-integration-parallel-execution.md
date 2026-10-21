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

**Amends, does not replace:** `spec.hq-bootstrap`, `spec.hq-design`, `spec.hq-social-work` and `spec.hq-expansion` keep their requirements and acceptance. This artifact adds lane ownership, shared contracts and landing order. It is the only shared plan; lanes do not write duplicate project plans. The closure revision added the required-capability closure: Design closure K1–K4 and CL1b, shared r3, D-4 references, Work export, hosted CLI/Planner CI, closure qualification, and the held-capability gates. This revision adds the source construction of the S2 preview host and the contained component runner (`req.preview-component.001`), and the Work session-injection seam that live wiring consumes. Native qualification and production enabling of the preview and components stay explicit. The U1 follow-on revision adds the HQ source for new-thread launch (`req.new-thread-followon.001`): the keyed Jones Code launch transport and the owner-confirmed Resolve unknown action, against the planned Jones Code contract `spec.jones-client-launch`. Its live qualification stays explicit.

**Lanes:**

| Lane | Owner | Outcome |
| --- | --- | --- |
| T1 | Integration root | Continuity, shared-ref landings, plan amendments, #2 delivery |
| T2 | Existing Design coordinator (shared writer) | F2 shared bridge (landed), then shared r3, live wiring, Wiki mount, reference round trip, CLI/Planner CI, receiver, the preview/component host and its enabling commits, then the new-thread transport |
| T3 | Existing Social builder | Social live adapter #48 — landed |
| T4 | Existing Work runtime owner | Work live runtime #51 — landed; then the bounded Work session-injection seam |
| T5 | — | CLI stack #46 merged; no lane |
| T6 | Wiki builder | Wiki module assembly #54 — landed |
| T7 | Acceptance builder/verifier | Native harness #53 landed; integrated scenarios, preview/component suites, qualifications, final acceptance |
| T8 | Existing Design coordinator (Design closure) | K1 storage engine, K2 app sections, K3 local catalog, K4 reference provider, CL1b mount, import/export enablement, preview module lanes and compose adapters, and the connector Resolve unknown action |
| T9 | Original `@hq/ui` owner custody | Reference UI kit |
| T10 | Original Social content owner custody | Read-only Social reference provider and link editor |
| T11 | Original Work board owner custody | Work reference provider, Links section, then RW-6 Export UI |

**No goal reduction:** every requirement and protected gate in the existing specs remains a completion obligation. Six capabilities stay held behind their own native, privacy or authority gates, encoded as explicit-activation qualification tasks: live S1 receiver qualification (native OAuth consent), new-thread launch U1 (the Jones Code contract planned in `spec.jones-client-launch`, then an installed build and native consent), the S2 preview surface, component-execution containment, Wiki private validation, and service enablement (Planner revision, Social `hq-references-v1`, live conformance). Laptop installation is a seventh gate. The existing-thread receiver is planned, required source work: its contract framing is complete, and `receiver-adapter` builds it and qualifies it against fixtures without native OAuth. Only live S1 qualification waits for the owner's consent. The S2 preview host and the component runner are likewise planned source work; only their native qualification and production enabling wait. The new-thread transport and the Resolve unknown action are planned source work too, qualified only against the Q-N wire stub; only live U1 qualification waits for the merged and installed Jones Code build and the owner's consent. Signing, notarization, release and deployment were never authorized.

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
- **Local catalog (CL7).** One active user-selected laptop-local root feeds the discovery `SourceAdapter`; choosing a different root explicitly replaces the selection. Main keeps the absolute path, and the renderer sees only `{rootId, label}`. Snapshot completeness covers that configured root under the fixed `laptop-local` host, with a durable host-wide generation across replacement, forget and restart; failed refreshes preserve cached records and workspace links.
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

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.preview-component.001" -->
## Preview And Component Requirement

These close CL-6 and CL-12 while keeping `prd.hq-design` and `spec.hq-design` intact:

- **S2 preview (CL-6).** A live preview of a chosen target site runs in a main-owned, preload-free, sandboxed view with its own in-memory session, as `iface.preview-host.001` defines. Pick and Cite run as the existing annotations agent in an isolated world. Every pick and capture binds to route, state, viewport, DPR, scroll and a coherent capture digest. The main-renderer CSP is unchanged.
- **Preview claim.** The preview claims isolation from HQ only (C1–C6 in `iface.preview-host.001`). The previewed site keeps ordinary browser network reach on this host; HQ discloses that reach and makes no destination-containment claim for previews.
- **Components (CL-12).** One contained runner under `iface.component-runner.001` has two required tiers: Tier S static rendering and Tier X scripted execution. Tier X requires full zero-egress qualification. Tier S is the first stage and never closes the component goal on its own.
- **Activation.** Each capability stays disabled in production until its qualification gate and its own enabling predicate. Source construction never waits for native activation, and native activation never follows from source alone.
- **PV-D1 (closed for v1).** Previews are ephemeral only. A persistent or credential-bearing preview profile is not built; it would need a new owner decision. No PRD line requires authenticated previews.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.preview-component.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.new-thread-followon.001" -->
## New-Thread Follow-On Requirement

HQ source implements new-thread delivery against the planned Jones Code launch contract `spec.jones-client-launch` (target `Jones-Systems/Jones-Code` at `fa7c6c013811db33d128422027697dbaa1517b60`). It has two parts:

- a main-only keyed launch transport, with lookup by key and a closed result mapping (`iface.new-thread-transport.001`);
- an explicit, owner-confirmed **Resolve unknown** action in the Design connector. It is the only path that can fence a key (`iface.resolve-unknown.001`).

**Invariants:**
- Automatic reconciliation stays lookup-only.
- An unknown is never resent.
- A fence that returns no answer leaves the attempt unknown.
- Nothing retries.
- A fixture never qualifies the live capability.

**Source versus activation.** Source construction uses synthetic wire stubs. It needs no OAuth grant, token, live call, installed Jones Code build or native consent. Native activation still needs `ac.new-thread-u1-binding.001`.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.new-thread-followon.001" -->

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

On one exact `work/hq-foundation` head, a typed matrix classifies each requirement in `req.design-closure.001`, `req.references-closure.001`, `req.work-export.001`, `req.hosted-ci.001`, `req.preview-component.001` and `req.held-capabilities.001` as closed, with its suite and evidence, or held, with its gate. A missing implementation or suite is a failure, never a hold.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.capability-closure.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.preview-component-source.001" -->
## Preview And Component Source Acceptance

Source construction passes when these run green at the candidate head, without Electron:

- **Module lanes:** the preview agent ignores untrusted events, tags every event with its generation, exposes the bounded queue shim and returns identity, text and rects in one re-resolution call. Compare reports host-surface placement and a `stale` session state and never creates an iframe. Components expose `ComponentRunnerPort` with labelled fakes and declarative prop slots, and production mounts a held placeholder instead of `srcdoc` frames when no runner is injected.
- **Host:** scheme-policy and hygiene classification tables; route validation with exact keys and bounds; the fence and PV-COHERE state machine, including blob-write-after-accept ordering and every `stale` reason; capture-record JCS golden vectors; the PV-TRUST factory and registry, including the identical-preload untrusted case; qualification-switch gating, where packaged builds ignore every switch; and the Tier S document builder, which emits no `<script>` and the exact header CSP.
- **Invariants:** every preview and component route returns `unavailable` with reason `disabled` while its status constant is false; all four status constants are false; the main-renderer CSP string equals the one at `73a6532`; `allowedSender` is unchanged.
- **Compose:** the adapters bind the routes to `PreviewCapability`, `AgentChannelPort` and `ComponentRunnerPort` with no generic invoke, URL fetch or path, and the renderer-safe walk passes.

Source acceptance is never native qualification and never enables a capability.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.preview-component-source.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.new-thread-followon-source.001" -->
## New-Thread Follow-On Source Acceptance

Each candidate passes its checks at one exact head, and T1 then lands it:

- **Connector candidate:** the new suites run in the existing `design-sections.yml` connector row (`test/*.test.ts`) and pass. A fence call is reachable only from a confirmed `resolveUnknown`. Existing exports, persisted formats, and the send and reconciliation paths are unchanged.
- **Transport candidate:** every Q-N wire-stub case in `iface.new-thread-transport.001` passes, and so does the root build.
  - In production, new-thread destinations stay refused, because the descriptor lists `new-thread` only with U1 evidence.
  - The `jones-code` transport stays unqualified.
  - No token, `projectId` or command ID reaches renderer state.

**What landing does and does not change.** Landing both candidates makes the U1 gate qualifiable. It does not qualify the gate, and new-thread stays held until `ac.new-thread-u1-binding.001`.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.new-thread-followon-source.001" -->

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

**Explicit activation predicate.** All of the following hold:

- **G1:** the Jones Code PR of `spec.jones-client-launch` is merged and read back under its `#ac.source-delivery.001`.
- **G2:** the owner has adopted an installed Jones Code build that contains it, through the existing owner-controlled Jones update path.
- **G3:** the owner has completed native Jones Code OAuth consent for the HQ client, at the recommended narrowest access level.
- `new-thread-landing` has landed.
- A task-owned synthetic Jones project is bound.
- The packet is synthetic and public-safe.

**Live U1 steps.** Only then does live U1 run its steps N0–N5:

- **N0:** transport and identity.
- **N1:** one keyed launch.
- **N2:** lookup by key, including one deliberate harness-only identical replay. The replay must return the same thread.
- **N3:** unknown recovery: lookup, then one owner-confirmed fence on a deliberately orphaned harness key.
- **N4:** definite refusals (`request_conflict`, `launch_fenced`).
- **N5:** session-change readback (a different-session lookup or fence returns `unavailable`).

`qualification.evidenceRef`, and the descriptor's `new-thread` mode, are set only from those results.

**Until then.** New-thread mode stays disabled with its existing reason, and a fixture never stands in for qualification.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.new-thread-u1-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.preview-s2-binding.001" -->
## Preview S2 Binding Predicate

Explicit activation predicate:
- T1 accepted a concrete containment design for a separate preload-free preview view, including its source and surface rebind, within the owner's existing HQ permission. For source construction this is satisfied by T1's acceptance of the preview/component contract framing revision 2, encoded in `iface.preview-host.001`. That acceptance is not native activation.
- Its implementation has landed through this amendment: `preview-agent`, `preview-compare`, `preview-host`, `preview-compose` and `preview-scenarios`. The task's dependencies enforce this.
- T1 has bound one exact `work/hq-foundation` head containing that implementation and a T7 native check host (ordinary user, a display, the pinned Electron 44.9.0 and the built app, no sudo and no credentials), and recorded the binding in the coordination channel.

Binding activates the qualification run only. The preview stays disabled until `ac.preview-enablement.001`.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.preview-s2-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.component-containment-binding.001" -->
## Component Containment Binding Predicate

Explicit activation predicate: the Design components containment design is `iface.component-runner.001`, accepted by T1 for source construction with the framing revision 2. The runner (`preview-host`), `component-runner-port`, `preview-compose` and `preview-scenarios` have landed, and T1 has bound one exact head and a T7 native check host as in `ac.preview-s2-binding.001`.

Binding activates the Tier S and Tier X qualification runs only. Component execution stays disabled until `ac.component-static-enablement.001` (Tier S) and `ac.component-scripted-enablement.001` (Tier X); each needs T1's acceptance of its own enabling change.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.component-containment-binding.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.preview-enablement.001" -->
## Preview Enablement Predicate

Explicit activation predicate: `preview-s2-qualification` ran every preview row in `ctx.preview-qualification.001` and the public-website smoke at one exact head; C1–C6 passed there; and T1 accepted the claim set and its disclosed network reach for that head. `PREVIEW_PICK_QUALIFIED` may become true only if Q-PV4 and every Q-PV6 row passed at the same head; otherwise picks stay `stale` and unqualified. This general route qualifies Linux only; macOS requires the accepted OS-MAC1 evidence below. The owner's existing HQ fix and activation permission covers this; no further owner approval is required.

The owner explicitly accepted Mac activation using native candidate `313cd0ab8936d8d4ee60ccfdb0aa90a786493d3a`: 58 passing rows, zero failing rows, and a separate passing packaged switch-refusal check on macOS 26.3 ARM64 / Electron 44.9.0. Q-PV4 and every Q-PV6 row passed. Bluetooth and client-certificate callback execution remain **unmeasured**: actual requests were refused before those callbacks were reached. The owner accepted precisely these two Q-PV2 exceptions, with retained runtime-source and fail-closed handler evidence, and normal browser network access. Raw native reports retain their original unmeasured status. This acceptance permits Mac preview and coherent-pick enablement on that candidate's unchanged preview implementation and its enabling descendant; it does not qualify Linux, Windows, component execution or Jones dispatch. No certificate identity or Bluetooth provisioning is required.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.preview-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.component-static-enablement.001" -->
## Component Static Enablement Predicate

Explicit activation predicate: Q-CS1–4 passed natively under the static qualification switch at one exact head, with zero canary hits on every row whose positive control hit, and T1 accepted that evidence for that head. This enables Tier S only and never closes the component goal.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.component-static-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.component-scripted-enablement.001" -->
## Component Scripted Enablement Predicate

Explicit activation predicate: Q-CX1–6 already ran under the scripted qualification switch, before any production activation, with zero hits on every positively controlled row in all three repetitions, and T1 accepted that evidence for that head. A measured hit has no residual-acceptance path. An unmeasured row keeps this predicate unsatisfied unless T1 and the owner accept that row explicitly by name. Until then Tier X stays disabled, required and reported held.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.component-scripted-enablement.001" -->

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
- the preview/component contract framing, revision 2 (sha256 `d8804828ad32ba905febb17feee3e5f0535912f1d386f3a62e1d9068ddba4a52`), accepted by T1 for bounded source construction, not native activation, including its three P1 corrections (PV-COR-01 trust by creation identity, PV-COR-02 the settled network claim, PV-COR-03 coherent capture) and its qualification-switch clarification;
- T1's settled Work session-injection rebind for live wiring, published in the coordination channel;
- current native GitHub reads.

**Landed (read back 2026-10-20).** `work/hq-foundation` = `d9f9682d43cc36b234248c7375018d067bbd3ca5`, after #49 (C), #52 (plan and main sync), #48 (Social live), #53 (native harness checkpoint), #51 (Work runtime) and #54 (Wiki assembly). All original PRs except #2 are actually merged. `main` = `bc8202a9731d51922c7cddde91f6ada0074adc1d`.

**Landed since (read back 2026-10-20).** `work/hq-foundation` = `9badd4f16b55e14a52e91cff95f6a5d6f20ec584` (tree `eb87c4ad09c43cc34b7607e8116dda2b9ee763319`), after #55 (the runtime host candidate) and #57 (K3 local catalog). Landing records stay with T1. Between `73a6532` and `9badd4f`, main, security, preload, the contract services and the annotations, compare and components modules are byte-unchanged, so the framing's source facts hold at that foundation. The foundation has since advanced to `43658bfad026ebe7fadba57ef1d92eceb1d7fd0d` after #59 (K1) and #60 (T9). Lanes base on the read-back successor.

**Shared bridge candidate:** the runtime host candidate `73a6532159686c769ba6e39d8070907b2a9b021e`, published as branch `work/hq-design-runtime-host`, held F1, r2, F2 composition and the shared services host, merged with foundation `d9f9682`. It landed as #55. F2's scope was preserved and it was not restarted.
- The F2 host already implements ServiceSettings and the exact Social 403 refresh (only `saveContent`/`addBrand`, status 403 with the exact reload body, one refresh, one resend, `submitRun` never resent). No lane duplicates either.
- F2's r2 contract has no blob, event, transaction, export, catalog, Work export or reference routes; those are r3.

**Decisions:**
- **Cones:** K1 is the sole writer of `modules/design/app/storage`. K2 is the sole editor of `design-sections.yml` until it lands.
- **Base:** K1, K2 and K3 branch from the runtime host candidate `73a6532`, so all three land after `bridge-landing`.
- **Shared writer:** shared r3 is the single shared writer after F2. It imports K1's main-only transaction and export and K3's Node snapshot builder, so it starts after their landings. It also follows the Wiki mount landing, because it shares files with live wiring and the Wiki mount. The Wiki mount keeps its original dependencies, so no new barrier is added.
- **Work session injection:** live wiring stopped with clean source at `9badd4f` because the Work package exports only `WorkModule`, and its session always chooses the bridge, even when unconfigured. The existing `setWorkSessionPort(port, {example, recovery})` was documented only as a test seam reached by deep import. T1 settled a bounded Work-owner promotion of that seam to a public production entry, with no algorithm or signature change. Its landing is live wiring's one added dependency: a consumed interface, not a K barrier. Live wiring keeps every other dependency, and the live-wiring-before-Wiki order stays.
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
- **Preview and components:**
  - T1 accepts the C1–C6 native isolation claim with truthful ordinary browser network reach. No universal zero egress is claimed or required for web previews.
  - Component Tier X still requires full containment and stays held until native proof.
  - The module lanes PV-M1, PV-M2 and CC-M1 start at this revision's publication over structural ports.
  - The native host is T2 step 7, after `receiver-landing`, because it shares main, preload and contracts with the earlier steps.
  - PV-M3 compose adapters go to the CL1b owner after CL1b and the host land, so compose never has two writers.
  - The T7 suites follow the integrated scenarios because they share `tests/acceptance`.
  - Each production enabling commit waits for its own explicit predicate.

**Unknowns:**
- Laptop target and install route.
- Native OAuth consent for the receiver, and the U1 Jones Code contract.
- MCP session framing and `queue`-on-idle behaviour (proved by S1 Q0/Q3).
- Electron 44.9.0 behaviours that the framing marks unverified and native qualification must prove or record:
  - separate-session process separation;
  - isolated-world injection without a preload under `sandbox:true`;
  - `insertCSS` and preferred size with JavaScript disabled;
  - WebRTC TCP and TURN under `disable_non_proxied_udp`, with and without H-PROXY and `<-loopback>`;
  - a qualification-only host-resolver mapping;
  - synchronous `web-contents-created` firing;
  - file-chooser behaviour;
  - `capturePage` determinism under software rendering.
- Wiki privacy scope.
- Service enablement envelopes.
- A shared project registry: open owner decision; the single fixed context stays, with project mismatch read-only.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.research-decision-basis.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.change-surface.001" -->
## Exact Change Surface And Ownership

Only one writer owns a path at a time. Each task block's `write_scope` gives its literal paths. No two tasks that can be ready together share a path.

- **T2 (one shared owner, serialized):** root manifests, scripts and lockfile, `tsconfig.json`, `vitest.config.ts`, `.github/workflows/foundation.yml`, the new `.github/workflows/cli-planner.yml`, `apps/desktop/**` (including the Design host compatibility layer, `apps/desktop/tsconfig.design-host.json` and ServiceSettings) and `packages/contracts/**`.
  - F2 also held `modules/design/app/compose/**` and `modules/design/app/index.ts` until it handed them to CL1b at `bridge-landing`.
  - Shared r3 owns `apps/desktop/src/reference-providers.ts` and `apps/desktop/src/references.ts`. After that, the reference round trip writes only the provider registrations, its integration test, and the typed live-only Work export injection in `apps/desktop/src/services/domains.tsx`, plus the optional `WorkModuleProps.workExport` type member in `modules/work/index.tsx`.
  - The receiver writes `apps/desktop/electron/jones-code/**` plus its closed route registration. A separate bounded main-subdirectory writer is allowed only if the Design coordinator accepts an explicit non-overlap rebind.
  - The new-thread transport (`new-thread-transport`), after `preview-host-landing`, writes `apps/desktop/electron/jones-code/**`, `packages/contracts/src/jones-code.ts`, `packages/contracts/src/index.ts`, its main and preload route entries, `apps/desktop/src/ServiceSettings.tsx` and the `jones-code` composition in `apps/desktop/src/modules.tsx`.
  - The preview/component host writes `apps/desktop/electron/contents-factory.ts`, `apps/desktop/electron/{preview,components}/**`, its main, preload, security and contract entries, `apps/desktop/src/environment.d.ts`, the root `build:preview-agent` script and its Vite configuration. Each later enabling commit writes only its own status file and status test. `apps/desktop/index.html`, which holds the CSP, is in no scope.
- **T4 (the existing Work owner, bounded successor):** `modules/work/nav/session.ts` (production documentation only), the named exports and entry documentation in `modules/work/index.tsx`, `modules/work/nav/test/live-selection.test.tsx`, and its own evidence file. No Work core or live adapter, shared contract or root file.
- **T8 (Design closure; each a Design descendant in its own worktree):**
  - K1: `modules/design/app/storage/**`.
  - K2: `modules/design/app/sections/**` and `.github/workflows/design-sections.yml`.
  - K3: `modules/design/discovery/{node,src/adapters,test}/**`.
  - K4: `modules/design/app/references-provider/**`.
  - CL1b: `modules/design/{requests,connector,references}/design-module.ts`, `modules/design/app/compose/**` and `modules/design/app/index.ts`.
  - PV-M1: `modules/design/annotations/src/preview-agent/**` and `modules/design/annotations/test/**`.
  - PV-M2: `modules/design/compare/src/**`.
  - CC-M1: `modules/design/components/{src,ui,tests}/**`.
  - CN-U1: `modules/design/connector/src/**`, `modules/design/connector/test/**` and `modules/design/connector/README.md`. CL1b keeps `modules/design/connector/design-module.ts`.
  - PV-M3: the CL1b owner's `modules/design/app/compose/**`, after CL1b.
  - Enablement: the two status constants only.
  - `packages/design-store` stays frozen.
- **T9:** `packages/hq-ui/src/references/**`, `packages/hq-ui/test/references/**`, the explicit exports in `packages/hq-ui/src/index.ts`, and evidence.
- **T10:** `modules/social/references/**` and `modules/social/content/**`, plus the explicit mount plumbing in `modules/social/index.tsx`, `modules/social/nav/SocialDomain.tsx` and `modules/social/nav/index.ts`, and evidence.
- **T11:** `modules/work/references/**` and `modules/work/detail/**`, then `modules/work/export/**`, plus the explicit mount plumbing in `modules/work/index.tsx`, `modules/work/nav/WorkDomain.tsx` and `modules/work/nav/index.ts`, and evidence. It never edits the landed `live` or `core` runtime. Its entry and navigation edits come after the Work session-injection seam, which the r3-after-Wiki order already guarantees.
- **T7:** `tests/acceptance/**` (the preview and component suites after the integrated scenarios land), `docs/evidence/hq-integration/acceptance/**` and `docs/evidence/hq-integration/preview/**`.
- **T1:** shared refs and PR bases, this spec, and `tests/check-groups.toml`.

A needed edit outside a lane's scope goes to T1 as a rebind request. Module lanes do not edit `packages/contracts`. They declare structurally identical module-local types, and T2 proves those types are assignable to the canonical ones. No module imports another domain.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.change-surface.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.contracts.001" -->
## Interface Contracts

Ten shared contracts govern concurrent lanes:
- `iface.service-response.001`: owned by T2 in `packages/contracts`; consumed by T3, T4, T7 and T11.
- `iface.wiki-host-ipc.001`: owned by T2 in main/preload; consumed by T6 and T7.
- `iface.shared-r3.001`: owned by T2; consumed by T7, T8, T10 and T11. It also covers the receiver's closed `design.jonesCode.*` route family (`status`, `authorize`, `identify`, `send`, `lookup`, `readEvidence`, `listThreads`), whose names are reconciled with r3. That family maps to the unchanged Design connector `TransportPort`/`EvidenceReadbackPort` for `transport:"jones-code"` and stays `unqualified` until S1 evidence.
- `spec.hq-social-work#iface.references.001`, unchanged: owned by T2 at `@hq/contracts/references`; consumed by T7, T8, T9, T10 and T11.
- The Design lane contracts already at the runtime host parent: owned by the Design coordinator.
- `iface.preview-host.001`: owned by T2 in main, preload and `packages/contracts`; consumed by T7 and T8.
- `iface.component-runner.001`: owned by T2; consumed by T7 and T8.
- `iface.new-thread-transport.001`: owned by T2 in main and `packages/contracts/src/jones-code.ts`; consumed by T7. It adds one route, `fence`, to the closed `design.jonesCode.*` family and targets the Jones Code contract `spec.jones-client-launch`.
- `iface.resolve-unknown.001`: owned by the Design coordinator in the connector module; consumed by T2, which proves its transport assignable to the module-local types, and by T7. It is frozen at this revision's publication, before any consumer builds against it.
- The Work session-injection seam, `setWorkSessionPort(port, {example, recovery})` and `examplePlanner` from the `modules/work` public entry: owned by T4 with its signature and algorithm unchanged; consumed by T2's live wiring. `resetWorkSessions` stays test-only and unexported.

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
  - one active root: `roots` returns zero or one opaque `{rootId,label}` descriptor. `chooseRoot` uses only the native directory dialog and visibly replaces the current selection; cancellation or validation/persistence failure preserves it. Selecting the current canonical root retains its opaque ID; a different canonical root gets a new opaque ID;
  - main retains the selected canonical root binding and its absolute path. A later canonical-path mismatch requires explicit reselection; renderer input cannot supply a path or silently retarget the root;
  - `snapshot` covers exactly the active root under K3's fixed `laptop-local` host. Preserve the builder's `complete` value, including partial enumeration at its existing entry bound and a genuinely empty successful complete scan. Never publish separate complete per-root snapshots or invent multi-root aggregation;
  - persist one strictly increasing safe-integer host generation before exposing a snapshot. It survives root replacement, forget and restart; gaps are allowed, reuse/reset is not. Persistence failure, corrupt generation state or exhaustion fails closed. Serialize allocation/publication with configuration changes and discard scans from obsolete selections;
  - no configured root, a missing/unreadable root, failed enumeration, or a realpath escape/mismatch returns the existing unavailable result boundary with bounded path-free detail, never a fabricated empty complete snapshot. Cached records and workspace links survive. Preserve K3's optional-preview omission/refusal behavior without upgrading a partial scan to complete;
  - `forget` removes the configuration entry only, never files, cached records, links or the generation high-water mark. Replacement/forget invalidate old preview readers. The next successful complete replacement-root snapshot may mark prior-root records `missing-at-source` under the existing reducer; this means absence from the selected catalog scope, not proven physical deletion;
  - catalog routes retain the settled `DesignStorageResult` boundary and existing `ServiceResponse` status conventions; no new HTTP response shape or module edit;
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

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.preview-host.001" -->
## Preview Host Contract

Owned by T2; consumed by T7 and T8. The main-renderer CSP and `allowedSender` are unchanged, and the renderer never frames content.

- **View (PV-ARCH):**
  - Main owns at most four live preview views per window. Each is a `WebContentsView` child of the HQ window.
  - Each view has no preload. `sandbox`, `contextIsolation` and `webSecurity` are on; `nodeIntegration`, `nodeIntegrationInSubFrames`, `webviewTag`, `allowRunningInsecureContent`, `experimentalFeatures`, `plugins`, `spellcheck`, `enableWebSQL` and `navigateOnDragDrop` are off; `disableDialogs` is on; devtools exist only unpackaged.
  - Each preview session has a fresh partition without the `persist:` prefix, so its storage is in memory.
  - Child views draw above the renderer, so the renderer reports a placeholder rect and hides the view while HQ overlays are open.
  - Main converts the placeholder from renderer CSS px to window DIP with the main renderer's zoom factor, sets the view to the largest centred box with the logical viewport's aspect inside it, and emulates that fit with `dontSetVisibleSize`, so neither placement nor a new document can paint outside the placeholder. The renderer shows the view only while the whole placeholder is inside the window and its scrollport.
  - Close runs `webContents.close()`, `removeChildView`, then `session.clearData()`. A main-renderer reload, crash, domain switch or window close tears down every view.
- **Trust (PV-TRUST):** every HQ `webContents` is created by one factory, `apps/desktop/electron/contents-factory.ts`, in one of three classes with literal webPreferences:
  - `hq-main`: `WINDOW_SECURITY` plus the exact `EXPECTED_MAIN_PRELOAD`, computed once at startup;
  - `hq-preview` and `hq-component`: no `preload` key at all.

  Before each constructor call the factory sets a one-shot pending expectation. The `web-contents-created` handler consumes it and records the class in a main-only registry before any load. Contents without a matching expectation are untrusted even with the identical preload path: popups are denied, navigation is prevented, and they close on the next tick. Preview and component sessions must have zero session-registered preload scripts. If `web-contents-created` does not fire synchronously inside the constructor (Q-PV0 decides), the factory records identity right after construction and before load, and unregistered contents are untrusted at their first navigation.
- **Policy (PV-POLICY), per preview session:**
  - **Target:** one `https:` origin, or `http:` on `127.0.0.1`, `[::1]` or `localhost`. No URL credentials or other schemes; at most 2048 characters.
  - **Navigation:** the main frame stays within the target origin. A cross-origin attempt is cancelled and reported as `blocked:navigation`, and is never opened externally. Subframes may use http(s).
  - **Schemes:** one session `webRequest` owner cancels `file:` and every custom scheme, including `hq-component:`.
  - **Hygiene only:** literal loopback, private and link-local addresses, `localhost` and `.local`, other than the target, are cancelled. This is never claimed as a boundary.
  - **WebRTC:** policy `disable_non_proxied_udp`, a local-IP rule, not an egress claim.
  - **Denials:** every permission, device chooser and display capture; popups; downloads; basic auth and client certificates. Certificate errors are never overridden. Dialogs are disabled, unload prevention is ignored, and audio is muted.
- **Network claim (PV-NET), accepted by T1:** the preview claims and tests isolation from HQ only:
  - C1: no Node, preload, `hqServices`, `hqDesktop` or HQ IPC;
  - C2: a separate in-memory session and renderer process, with no HQ cookies, storage or credentials;
  - C3: permissions, choosers, display capture, popups and downloads denied;
  - C4: the main frame locked to the target origin;
  - C5: no `file:` or custom-scheme access;
  - C6: teardown with no orphans.

  A previewed site keeps the network reach of an ordinary browser tab on this host. That includes private-network hosts reached by name, redirect or rebinding, and WebRTC over TCP and TURN. The panel says so: "Live preview: runs this site's code with normal browser network access; isolated from HQ". HQ never auto-opens a target, and Chromium Private Network Access is not relied on. Destination containment for previews would be a new requirement.
- **Routes (PV-IPC):** one closed channel, `hq:svc:preview`, and one preload member, `hqServices.preview.call(route, params)`. Each handler runs `allowedSender` and exact-key validation. It returns `{ok:true, value}` or `{ok:false, kind:'invalid'|'unavailable'|'stale'|'blocked', reason?}`. The routes are:
  - `open{versionId, url, viewport{w,h,dpr∈1|2|3}, label}`;
  - `place{sessionId, rect, visible}`;
  - `navigate{sessionId, route}`;
  - `mode{sessionId, generation, mode:'off'|'pick'|'cite'}`;
  - `capture{sessionId, expectedGeneration}`;
  - `events{sessionId, after}`, at most 64 per call;
  - `resolve{sessionId, generation, requests}`, at most 50 requests;
  - `image{captureId}`, a PNG data URL of at most 16 MiB;
  - `status{sessionId}`;
  - `close{sessionId}`, idempotent.

  Every route returns `unavailable` with reason `disabled` while `PREVIEW_HOST_ENABLED` is false. `CaptureRecord = {captureId, sessionId, versionId, generation, route, state, viewport, scroll, contentSize, captureDigest:'sha256:<hex>', capturedAt}`.
- **Fences (PV-FENCE):** a per-session generation increments on:
  - main-frame cross-document and in-page navigation, and reload;
  - a viewport or emulation change, or a size-changing `place`;
  - a renderer crash, after which the session is `crashed` until reopened.

  Main reads route (`pathname + search`) and state (`hash` plus an optional label) from `getURL()`, never from the renderer. Device emulation applies the viewport and an integer DPR.
- **Coherent capture (PV-COHERE):** a pick or capture is anchored only after one bracketed window:
  1. a pre-read records generation, URL, frame, the mutation counter and the target's re-resolution, with the agent highlight hidden;
  2. the queued event's geometry and text must equal that re-resolution;
  3. main captures twice, giving `P1` and `P2`;
  4. a post-read repeats the first step.

  The capture is accepted only if generation, URL, viewport, scroll, mutation counter and the re-resolved identity, text and rects are unchanged, `sha256(P1) = sha256(P2)`, and `P1`'s width divided by the viewport width equals the DPR. Otherwise it returns `stale` with reason `navigation`, `scroll`, `mutation`, `target-changed`, `pixels-unstable` or `dpr`, writes nothing, and allows one bounded retry. Only an accepted capture writes `P1`, once, through r3 `blob.put{expectedDigest}`. If static captures are not byte-identical on the host (Q-PV4), pick binding stays unqualified and always `stale`. The renderer reuses an anchor only on an exact `{versionId, route, state, viewport, captureDigest}` match.
- **Agent (PV-AGENT):**
  - `build:preview-agent` bundles `modules/design/annotations/src/preview-agent/index.ts` as one IIFE with the existing Vite library mode, into ignored build output, with no new dependency.
  - Main pins the bundle's SHA-256 at startup and injects it into isolated world 1001 (never 999) on `dom-ready` and after each main-frame navigation. The script is idempotent.
  - Events go to a bounded isolated-world queue. Main drains it through the same API every 100 ms, only while a mode is on and the view is visible, and revalidates every output's shape and bounds.
  - The agent ignores untrusted events and runs in the main frame only.
- **Status:** `PREVIEW_HOST_ENABLED` and `PREVIEW_PICK_QUALIFIED` live alone in `apps/desktop/electron/preview/status.ts`, with their own status test. Both follow the platform qualification in `ac.preview-enablement.001`: enabled on the accepted Mac route, disabled on other platforms.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.preview-host.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.component-runner.001" -->
## Component Runner Contract

Owned by T2; consumed by T7 and T8. One contained runner serves two required tiers.

- **View:** a separate `WebContentsView` of class `hq-component`. It uses the preview webPreferences, the in-memory partition `hq-components`, no preload, and WebRTC policy `disable_non_proxied_udp`.
- **Document:**
  - It is served by `protocol.handle('hq-component', …)` on that session only.
  - The scheme is registered `{standard:true}` in the single before-ready `registerSchemesAsPrivileged` call. It is never `secure`, `bypassCSP`, `supportFetchAPI` or service-worker enabled.
  - Main renders from a validated `{componentId, revision, digest, renderInputDigest}` after re-reading the source through the Design store and checking the digest. The renderer never sends HTML.
- **Header CSP:** `sandbox` for Tier S or `sandbox allow-scripts` for Tier X, giving an opaque origin. It also sets `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'`. Tier S sets `script-src 'none'`; only Tier X sets `script-src 'unsafe-inline'`.
- **Network:** the session's `webRequest` cancels every URL except `hq-component://doc/<id>` for the current document, and navigation away from it is denied. Permissions, downloads, popups and credentials follow the preview policy.
- **Tier S (`javascript:false`):**
  - Main binds props and variants through declarative slots (`data-hq-text`, `data-hq-attr-*`).
  - Main injects sampled motion CSS from `sampleStudy(study, t)` with `insertCSS` and `removeInsertedCSS`.
  - Size comes from preferred-size mode.
  - A source with a non-empty script shows "scripted: held".
- **Tier X (`javascript:true`):**
  - The bootstrap and component script run inline under the header CSP. Main applies motion through an isolated-world style write.
  - CSP is not an egress boundary for WebRTC, so Tier X needs full zero-egress qualification (`ctx.preview-qualification.001`).
  - H-PROXY, a closed loopback session proxy with `<-loopback>` bypass subtraction, is a candidate mitigation measured there and never assumed.
  - Final reports state that a compromised renderer is outside the threat model, which covers author-written or agent-generated design code, not exploit code.
- **Capture:** `capturePage` produces a digest, recorded as a canvas capture with `evidence:'web-sandbox'` bound to `{componentId, revision, renderInputDigest, viewport, captureDigest}`.
- **Status:** `COMPONENT_STATIC_ENABLED` lives in `apps/desktop/electron/components/static-status.ts` and `COMPONENT_SCRIPTED_ENABLED` in `apps/desktop/electron/components/scripted-status.ts`, each with its own status test. They stay false until `ac.component-static-enablement.001` and `ac.component-scripted-enablement.001` respectively.
- **Not proposed:** an OS-level helper process in a Linux network namespace, or a macOS network extension. Either would be a new decision for T1 and the owner.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.component-runner.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.new-thread-transport.001" -->
## New-Thread Transport Contract

**Settled target.** `spec.jones-client-launch` sections `#iface.mcp-tools.001`, `#iface.semantics.001` and `#ctx.gates-and-hq-seam.001` (published in this repository), against Jones Code base `fa7c6c013811db33d128422027697dbaa1517b60`. HQ builds against a Q-N wire stub of those shapes and makes no live call.

**Owner and place.** T2 owns it, in main only, inside the landed receiver's `apps/desktop/electron/jones-code/**`. It reuses the receiver's:
- MCP client and OAuth session;
- `safeStorage` credentials;
- pre-send ledger;
- handoff text: the marker line, then the JCS envelope.

The renderer sees status only.

**Binding:**
- A new-thread destination is a `jones-code` endpoint. Main resolves its locator to a main-only binding `{mode: "new-thread", projectId, label}`, which is set in ServiceSettings.
- `projectId` never reaches the renderer or the handoff.
- `identify` returns the receiver's host identity, with `receiverId = "jones-project:" + the first 32 hex digits of sha256(hostId + "\0" + projectId)`.

**Send** (`TransportPort.send`; called only after `submitting` is durable):
1. Write the ledger entry `{idempotencyKey, mode: "new-thread", locator, wireDigest, sessionLabel}`. If the write fails, the result is `rejected` and nothing is sent.
2. Make exactly one `t3_thread_launch` call with:
   - `clientRequestId`: the attempt key (`idempotencyKey = attemptId`);
   - `projectId`: from the binding;
   - `title`: `HQ handoff <packetId>`, trimmed to the Jones limit;
   - `message`: the receiver's handoff text;
   - `modelSelection`: only when the handoff pins a model, mapped as the receiver maps it.

   The call never sets `runtimeMode` or `interactionMode` (the consented client ceiling applies), `workspaceStrategy` (root), `scratch` or `attachments`. The request is a pure function of the handoff and the binding, so it is canonically identical for its key.
3. Map the result:

| Jones result | `SendOutcome` |
| --- | --- |
| success with `initialMessage: "accepted"` | `accepted`, receipt `jcl1:<threadId>` |
| success with any other `initialMessage` or `preparation` state | `held`, the same receipt, with a reason that names both states |
| `invalid_request`, `capability_denied`, `runtime_mode_escalation_denied`, `interaction_mode_escalation_denied`, `request_conflict`, `launch_fenced` | `rejected`, with the code |
| anything else: `orchestration_error`, timeout, reset after write, a malformed result or an unknown code | thrown, so the outbox records `unknown`; never resent |

HTTP 401 follows the receiver's landed handling: the session becomes `needs-authorization`, and HQ never re-authorizes silently.

**Receipt fields:**

| Field | Value |
| --- | --- |
| `receiptId` | `"jcl1:" + threadId` |
| `idempotencyKey` | the attempt key |
| `status` | as mapped above |
| observed host and receiver | from `identify` |
| `observedModel` | the returned model, when it maps to a pin; otherwise `null` |
| `provenance` | `"jones"` |
| `at` | the response time |

**Lookup** (`ReadbackPort.lookup`; read-only; `t3_thread_launch_lookup`):

| Jones state | `LookupOutcome` |
| --- | --- |
| `launched` | `found`, with the receipt rule above; `threadDeleted` gives `held` with a reason |
| `no_effect` | `no-effect`, basis `jones:<basis>` |
| `absent`, claimed or not | `not-found` |
| failure, timeout, malformed | `unavailable` |

**Fence** (`TransportPort.fence`; `t3_thread_launch_fence`). It is reachable only from `iface.resolve-unknown.001`:

| Jones state | `FenceOutcome` |
| --- | --- |
| `launched` | `found`, with the receipt rule above |
| `no_effect` | `no-effect`, basis `jones:fence` |
| failure, timeout, malformed | `unavailable`; the attempt stays unknown, and nothing retries |

An existing-thread locator returns `unavailable` without a call. The receiver at `76fb3dc` has no fence, so existing-thread unknowns stay lookup-only, as framed.

**Session rule (R1):**
- Jones derives launch IDs from the OAuth session's request namespace, and a re-authorized session gets a new namespace.
- So lookup and fence run only while the current session label equals the ledger entry's `sessionLabel`. Otherwise they return `unavailable` without a call: "session changed; this attempt cannot be resolved by key".
- Unknowns must be resolved before the 30-day session expiry.

**Routes:**
- The closed `design.jonesCode.*` family gains one route: `fence {locator, idempotencyKey}`.
- `send` and `lookup` dispatch on the locator's binding.
- The shapes live in `packages/contracts/src/jones-code.ts`.
- There is no generic IPC.

**Qualification:**
- The descriptor lists `new-thread` in `modes` only when U1 qualification evidence is recorded under `ac.new-thread-u1-binding.001`. An S1 qualification of existing-thread delivery therefore never enables new threads.
- Until then the transport is `unqualified` for new-thread, and its destinations keep `NEW_THREAD_REASON`.

**Q-N stub cases:**
- success with each `initialMessage` and `preparation` state;
- every definite failure code, `orchestration_error`, a timeout after write, and malformed results and unknown codes;
- a ledger write failure;
- lookup of `launched`, `no_effect`, `absent`, claimed and deleted keys;
- fence on an absent key, a launched key, and a failure;
- the existing-thread fence refusal;
- a session-label change;
- HTTP 401 and oversize.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.new-thread-transport.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#iface.resolve-unknown.001" -->
## Resolve Unknown Contract

**Owner.** The Design coordinator owns this, in the connector module (`modules/design/connector/**`). It is a module-local contract, and T2 proves that the transport's types are assignable to it. Every change is additive, so existing exports and the persisted `hq.design.dispatch/v1` and `hq.design.handoff/v1` formats are unchanged.

**Port additions** (`src/contract.ts`; all optional):

```ts
interface TransportDescriptor { readonly modes?: readonly DestinationMode[] }  // absent = ['existing-thread']
type FenceOutcome =
  | { readonly kind: 'found'; readonly receipt: Receipt }
  | { readonly kind: 'no-effect'; readonly basis: string }
  | { readonly kind: 'unavailable'; readonly detail: string };
interface TransportPort {
  fence?(query: { readonly endpoint: DestinationEndpoint; readonly idempotencyKey: string }, signal: AbortSignal): Promise<FenceOutcome>;
}
```

**Eligibility:**
- A new-thread destination is eligible only when its transport qualifies under the existing rule **and** `descriptor.modes` includes `new-thread`. Otherwise it keeps `NEW_THREAD_REASON`.
- `newThreadControl` follows from the rows: it is enabled only while a selectable new-thread destination exists. Activating it selects that destination; it never sends.

**Outbox: `resolveUnknown({dispatchId, confirmation})`:**
1. **Preconditions.** Each failure is a refusal with no transport call:
   - the latest attempt is `unknown`;
   - the bound mode is `new-thread`;
   - the transport has `fence`;
   - no send of the packet is in flight;
   - the confirmation binds `dispatchId`, `attemptId`, `idempotencyKey` and the attempt's `readbacks` count, is younger than the confirmation TTL, and has not been used.

   Because the confirmation binds the `readbacks` count, a used confirmation is stale in every process, with no format change.
2. **One `fence` call**, under the probe timeout.
3. **Mapping:**
   - `found` with a valid receipt → `accepted` or `held` with basis `readback`, as reconciliation does;
   - `no-effect` → `no-effect` with basis `readback`, and a reason naming the owner-confirmed fence;
   - anything else, including a throw, timeout or malformed result → the attempt stays `unknown`, with `readbacks` incremented and the detail recorded. Nothing retries.
4. **Compare-and-swap write.** On a conflict the result is not saved, and that is reported.

No new state or basis literal is added.

**Never fences.** `recover`, `reconcile`, `checkStatus`, `refresh`, selection and the evidence feed never call `fence`; reconciliation keeps its lookup-only readback port. Each later explicit confirmation is a fresh owner action.

**Controller and panel:**
- `requestResolveUnknown()` opens a card, only when the preconditions hold.
- `confirmResolveUnknown()` runs one resolution.
- `cancel()` closes the card.
- The view gains `resolveUnknown {available, reason, confirming}`.
- The panel gains optional `onRequestResolveUnknown`/`onConfirmResolveUnknown` props. `ConnectorPanelHost` wires them, so no host or compose change is needed.
- The card says three things: HQ asks the receiver to make this attempt permanently unable to run; if it already ran, HQ records that instead; nothing is resent.
- A result that stays unknown shows "Still unknown", with its detail.

**Fakes.** The labelled fake transport in `src/fakes.ts` may implement `fence` and declare `modes` for tests. A labelled fake never qualifies Jones.

**Tests** (`test/*.test.ts`, the existing connector row):
- new-thread eligibility with and without declared modes and qualification;
- the `newThreadControl` derivation;
- every precondition refusal: an attempt that is not unknown, existing-thread, no fence, in flight, stale, used, expired;
- one fence call per confirmation;
- the `found`, `no-effect`, `unavailable`, throw, timeout and malformed mappings;
- a compare-and-swap conflict;
- zero fence calls from every read path;
- the card and `ConnectorPanelHost` wiring;
- compatibility exports unchanged.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#iface.resolve-unknown.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.test-plan.001" -->
## Test Plan

Each task names its Test Intent and check groups.

Groups for the `tests/check-groups.toml` amendment:
- **Already in the catalog:** `hq-root-build`, `hq-cli-planner`, `hq-social-live`, `hq-work-runtime`, `hq-wiki-module`, `hq-shared-bridge`, `hq-electron-acceptance`, `hq-source-readback`.
- **Added by the closure revision:** `hq-design-storage-engine`, `hq-design-app-sections`, `hq-design-local-catalog`, `hq-shared-r3`, `hq-design-reference-provider`, `hq-design-compose`, `hq-reference-ui`, `hq-social-references`, `hq-work-references`, `hq-reference-round-trip`, `hq-hosted-ci`, `hq-capability-closure`, `hq-held-gates` (gate readback only).
- **Added by this revision:** `hq-preview-agent`, `hq-preview-compare` and `hq-component-runner-port`, which mirror the existing `design-sections.yml` rows; `hq-preview-host`; and `hq-preview-acceptance`. The existing `design-annotations`, `design-compare`, `design-components`, `hq-design-compose`, `hq-work-runtime`, `hq-root-build` and `hq-electron-acceptance` groups also cover the new intents.

Rules:
- Run the exact behavior test while editing.
- At a candidate, run the lane's groups plus `hq-root-build` whenever shared files changed.
- The final union runs once on the final head.
- Take a fresh CPU admission sample before each test run, under the host's admission policy, and never chain it with the test command.
- Hosted checks attach through `foundation.yml` and `design-sections.yml`, and through `cli-planner.yml` after it lands. Report absent checks as absent, never as green.
- Native preview and component rows need a display and run only under their unpackaged qualification switches. A row without a positive control is `unmeasured`, never passed.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.test-plan.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.preview-qualification.001" -->
## Preview And Component Qualification

T7 owns these suites in `tests/acceptance/**`. They run the native built HQ app on Electron 44.9.0 at one exact head. Synthetic pages and canaries are the test inputs; the surface under test is the real one. A fake or simulated surface never qualifies.

- **Switches:** `HQ_QUALIFY_PREVIEW`, `HQ_QUALIFY_COMPONENT_STATIC` and `HQ_QUALIFY_COMPONENT_SCRIPTED` take effect only when the app is unpackaged and `HQ_USER_DATA_DIR` is set. They run a capability for qualification without changing its status constant. Every suite checks that a packaged-mode start ignores its switch.
- **Fault hooks:** unpackaged, switch-gated named pause points sit between the PV-COHERE steps. At a pause point the harness runs a main-world mutation script, so races are deterministic.
- **Canaries (CC-CANARY):**
  - Ordinary-user listeners run on `127.0.0.1`, `::1` and one non-loopback address the host already owns. They cover HTTP, a 302 hop, WS, raw TCP, raw UDP, STUN, TURN-TCP and TURN-TLS. An mDNS listener joins `224.0.0.251:5353` and records only.
  - DNS aliases use a qualification-only host-resolver mapping in the unpackaged build. If none works at 44.9.0, the alias rows are `unmeasured`.
  - Before and after each run, an unconstrained Node client and an unrestricted control `webContents` must reach every canary on every channel. A row counts only if its positive control hit.
  - With the optional unprivileged network namespace (OS-NS1, `bwrap --unshare-net`), the app, the canaries and the controls all run inside it. There is no sudo and no packet capture.
- **Public smoke:** one public https page with ordinary outbound network and no credentials, recorded separately from the synthetic rows.
- **Platform:** Linux harness results qualify Linux only. OS-MAC1 requires a separately bound macOS route during final acceptance. The actual laptop OS, architecture and route must be read back; a Linux run or a different machine is not laptop qualification.

**Preview rows (`preview-s2-qualification`, under `HQ_QUALIFY_PREVIEW`):**

| ID | Scenario | Pass |
| --- | --- | --- |
| Q-PV0 | HQ starts through the factory and a Design IPC call succeeds. A hook then creates an unregistered contents with the identical preload path, and a preview-class view whose literal includes that path. Synchronous `web-contents-created` firing is recorded. | HQ IPC works; the unregistered contents closes before load and fails `allowedSender`; the altered view is refused; the firing outcome selects the PV-TRUST path |
| Q-PV1 | Open a fixture; compare OS process IDs; probe `require`, `process`, `hqServices` and `hqDesktop` from page JS | Separate processes; all absent (C1, C2) |
| Q-PV2 | Cross-origin main-frame navigation, `window.open`, a download, basic auth, client-certificate selection, each permission API, display media and a file input | Each blocked and counted (C3, C4); the file chooser row is recorded as observed |
| Q-PV3 | Requests for `file:`, `hq-component:` and other custom schemes | Cancelled (C5) |
| Q-PV3h | Literal private and loopback URLs; a canary reached through a DNS alias and through a 302; WebRTC TCP to a TURN-TCP canary, with positive controls | Recorded as observed; a hit is expected and disclosed under PV-NET; literal-URL cancellations count as hygiene only |
| Q-PV4 | Ten repeated captures of a static page at 1280×800@1 and 390×844@3 | Viewport and DPR match; digests byte-identical, or recorded with pick binding left unqualified |
| Q-PV5 | Navigate, scroll and resize at each PV-COHERE pause point | `stale:<reason>`; the blob-store count is unchanged |
| Q-PV6 | Pick, navigate, then drain | `stale:navigation` |
| Q-PV6d | At a pause point: same-length text replacement; remove and reinsert an identical node; a sibling height change that moves the target | `stale:target-changed`, `stale:mutation`, `stale:target-changed`; no anchor |
| Q-PV6a | A compositor-only animation, a playing video, a blinking caret | `stale:pixels-unstable` for each; anchored once the page pauses the animation |
| Q-PV6h | Pick on a static page | Anchored; no highlight colour in the pixels; `captureDigest` equals the stored blob digest |
| Q-PV7 | Pick and cite modes; synthetic `dispatchEvent` clicks | Element only in pick, text only in cite; synthetic clicks ignored |
| Q-PV8 | Page JS overrides `Element.prototype.getBoundingClientRect` | Agent geometry unaffected |
| Q-PV9 | Renderer crash, main-renderer reload, domain switch | Session crashed then closed; no orphan views; `clearData` called (C6) |
| Q-PV10 | The main-renderer CSP at the built head | Equal to the `73a6532` string |

**Component rows (`component-containment-gate`):**

| ID | Scenario | Pass |
| --- | --- | --- |
| Q-CS1–4 | Tier S under `HQ_QUALIFY_COMPONENT_STATIC`: fixture button and card with props, variants and motion at t = 0, 0.5 and 1; a probe `<script>` that must do nothing; markup-only egress rows plus every canary channel markup can reach; denied navigation self-reload | Deterministic digests per input and t; zero canary hits on every positively controlled row |
| Q-CX1–6 | Tier X under `HQ_QUALIFY_COMPONENT_SCRIPTED`, before any production activation: the full prior proof matrix on 44.9.0 plus every canary channel (HTTP, redirect, WS, TCP, UDP, STUN, TURN-TCP, TURN-TLS, mDNS, DNS alias; IPv4 and IPv6; loopback and non-loopback), with H-PROXY off and on, three repetitions; a packaged start ignores the switch | Zero hits on every row whose positive control hit; any hit recorded as failed and never overwritten; rows without a positive control `unmeasured` |

The final report says "integrated with held capabilities" while Tier X or OS-MAC1 is open.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.preview-qualification.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001" -->
## Operator Interaction Inventory

| Phase | Owner action | Executing route | Boundary and readback |
| --- | --- | --- | --- |
| Build, test, publication, landings, #2 merge | None; covered by the owner's in-scope merge authority | Ordinary user, isolated HQ worktrees, GitHub | Exact-head checks; ref/PR/ancestry readback; no sudo |
| Electron acceptance on the check host | None | Ordinary user, owned temporary profile | Stops with a recorded gap if no display exists; no package installation |
| Import/export enablement | None; existing owner permission | T1 accepts exact-head crash, CAS and privacy evidence; T8 makes the one-constant commit | `ac.import-export-enablement.001`; disabled until then |
| Live S1 receiver | Native Jones Code OAuth consent in the system browser; bind a task-owned receiver | HQ main loopback OAuth client; token in `safeStorage` | Held; fixture tests only until consent; renderer never sees the token; 30-day expiry needs fresh consent |
| S2 preview, component execution | None; T1 accepted the source design within the existing owner permission and accepts each enabling change | T7 runs the built app under unpackaged-only qualification switches, with synthetic inputs, userspace canaries and positive controls, optionally inside an unprivileged network namespace (OS-NS1); one public-website smoke uses ordinary outbound network without credentials; T2 makes each enabling commit | Held until each enabling predicate; production disabled before it; no sudo or packet capture (OS-PC1 not requested); macOS (OS-MAC1) runs on the laptop route |
| New-thread U1 | Source: none. Native: G1 the Jones Code PR merged, G2 the owner adopts an installed build through the existing Jones update path, G3 native Jones Code OAuth consent for the HQ client | HQ main, with the same loopback client and `safeStorage` as S1; `new-thread-transport` builds against the Q-N stub only | Held; production new-thread disabled until U1 evidence; Resolve unknown runs only on the owner's confirmation; 30-day expiry needs fresh consent, and keys from an earlier session cannot be resolved |
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

1. F2 (`shared-bridge`, not restarted; models preserved) → `bridge-landing`.
2. Live wiring, then the Wiki mount. Live wiring gains one dependency, the Work session-injection landing, because it consumes that public seam; every other dependency of both tasks is unchanged.
3. Shared r3 (one new Design descendant) after `bridge-landing`, the K1 and K3 landings and the Wiki mount landing, because it shares main, preload, contract and `App.tsx` files with them → `r3-landing`.
4. The reference round trip after every provider and the Work export UI land. It also injects r3's Work export client for live selection in `apps/desktop/src/services/domains.tsx`, through the optional `WorkModuleProps.workExport` type member in `modules/work/index.tsx`.
5. CLI/Planner CI after K2 returns `design-sections.yml` custody.
6. The existing-thread receiver after the Wiki mount, CL1b and the reference round trip land, because it shares main, preload, settings and `modules.tsx`. It is fixture-qualified by the Q-S wire stub of the exact `76fb3dc` shapes.
7. The preview/component host (`preview-host`) after `receiver-landing`, because it shares main, preload and contracts with steps 3 and 6. It binds the landed preview agent and component runner port, and lands as one PR with two coherent commits: the preview host, then the component runner. Every status constant stays false. Moving it earlier needs a T1 amendment.
8. The enabling commits (`preview-enablement`, `component-static-enablement`, `component-scripted-enablement`), each only under its own predicate, and each changing only its own status file and status test.
9. The new-thread transport (`new-thread-transport`) after `preview-host-landing` and `connector-resolve-landing`. It extends the landed receiver's main-only `jones-code` module under `iface.new-thread-transport.001` and consumes the landed connector port of `iface.resolve-unknown.001`. Placing it after the preview host keeps the earlier critical flow closed. It waits on no Jones Code merge, install or consent: it is fixture-qualified by the Q-N wire stub, and new-thread stays disabled in production.

**Live wiring and the Work seam:** the shell calls `setWorkSessionPort` once, before the first Work session. It selects the configured live Planner with recovery, or the labelled example only when configuration explicitly says unconfigured. A failed configuration read or a live-service error never falls back to the example. A configuration change needs the labelled reload.

**Wiki mount:**
- mounts `createWikiDomain({ getPort })`;
- registers the `@hq/wiki` workspace and lockfile entry;
- raises the engine and CI Node version to `>=22.18`;
- keeps Wiki `node:test` suites out of Vitest discovery;
- adds a Node test-runner CI step;
- adds main-only home and source configuration. Home migration is versioned Wiki configuration and index initialization and upgrade in the app userData directory only, never an inferred legacy or private location;
- migrates the renderer's stored navigation destination separately in `apps/desktop/src/state.ts`, with Wiki fourth and the legacy home mapped to it;
- adds `apps/desktop/tsconfig.wiki-host.json` as an additive mirror of the Design host emit;
- keeps exactly the seven closed read methods, with refresh and migration host-only, synthetic Git corpora only, and external CSS with no CSP change.

The F2 host's ServiceSettings and exact 403 refresh are already implemented and are not duplicated.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t2.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t3.001" -->
## T3 Social Live

The existing Social builder finishes #48 now, starting with the failed-read-is-unavailable contract fix. The work is module-only. Integration with the real transport comes later through T2's live wiring.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t3.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t4.001" -->
## T4 Work Runtime

The existing Work runtime builder works now on module-local code and tests, using the Planner wire fixtures. Live tests against a real Planner service use foundation after `main-sync`.

**Work session injection.** The existing Work owner, bound to a fresh successor ref by the retained Social/Work representative, promotes `setWorkSessionPort(port, {example, recovery})` to an explicit production shell seam. The work is:
- production documentation of the existing signature and behaviour in `modules/work/nav/session.ts`, with no algorithm or signature change;
- named exports of `setWorkSessionPort` and `examplePlanner` from `modules/work/index.tsx`, correcting the stale entry documentation;
- focused public-entry injection and selection tests in `modules/work/nav/test/live-selection.test.tsx`;
- optionally, its own evidence file.

`resetWorkSessions` stays test-only and unexported. The work needs no Work core or live adapter, shared contract or root change, and depends on neither T9 nor r3. Actual custody is reported in the coordination channel.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t4.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t6.001" -->
## T6 Wiki Assembly

T6 is ready now from foundation, which already contains the Wiki contract, core and UI. It is module-only: the assembly and the synthetic-corpus tests. T2 mounts Wiki later.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t6.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t7.001" -->
## T7 Acceptance

The native harness checkpoint (#53) has landed. T7 extends it with integrated scenarios as their source lands, runs the import/export and capability-closure qualifications, the held-gate qualifications once their predicates hold, and final acceptance. HQ's layout is not changed to suit the Jones Code harness, and the harness stays separate from Design production code and tests.

**Acceptance infrastructure first.** A new task, `acceptance-infrastructure`, prepares only the harness infrastructure that the landed services, wiring and Wiki mount already support. It does not reuse the landed `acceptance-harness` task. Its machine block gives its seven literal paths and exact boundaries. It adds:
- per-row results;
- harness-generated userData configuration;
- closed synthetic Work and Social HTTP fixtures with a request ledger;
- a synthetic isolated Wiki corpus;
- complete cleanup of every resource it owns.

It writes no scenario or preview suite, adds no qualification switch, and activates nothing. `acceptance-scenarios` keeps every existing dependency and also waits for `infrastructure-landing`, because both write `tests/acceptance`.

The new task may self-test its fixtures and cleanup without Electron. Its native checks then run only as separately bound checks on its exact candidate: the unchanged shell checkpoint, and full mode reporting a gap for every scenario row not yet implemented. That full-mode gap outcome is evidence that those rows are held. It is never integrated or full acceptance.

After the integrated scenarios land, T7 writes the preview and component suites of `ctx.preview-qualification.001` (`preview-scenarios`) in the same harness. It then runs them as `preview-s2-qualification` and `component-containment-gate` once T1 binds the head and the native check host.

The U1 gate (`new-thread-u1-qualification`) also follows `new-thread-landing`, so it runs against landed HQ source, and only under `ac.new-thread-u1-binding.001`.

The harness owns its scratch profile, processes, fixture sites, canary listeners and control clients. It removes exactly those on success, failure and cancellation, after preserving the evidence it needs.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t7.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t8.001" -->
## T8 Design Closure

The existing Design coordinator owns T8. K1, K2 and K3 run in the preflight children the Design coordinator has already created (Astra/medium), from the runtime host candidate `73a6532159686c769ba6e39d8070907b2a9b021e`. There are no new launches or replacements, and these children have no descendants. Their new-scope implementation starts after publication. Budget: actual 7 of 12 children; the preview module lanes add at most one. K4 and shared r3 follow only when ready. CL1b goes to the F2 successor.

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

**Preview module lanes.** These are ready at this revision's publication, from `work/hq-foundation` at `9badd4f16b55e14a52e91cff95f6a5d6f20ec584` or its read-back successor. They use structural ports and labelled fakes, with no Electron.
- **PV-M1 `preview-agent`** (`modules/design/annotations/src/preview-agent/**` and `modules/design/annotations/test/**`):
  - ignore untrusted pick and cite events, and tag every event with its generation;
  - export the bounded queue host shim;
  - add PV-COHERE support: a synchronous `MutationObserver` counter through `takeRecords()`, highlight hide and restore, and one-call exact re-resolution returning identity, text and rects;
  - keep the entry IIFE-safe, with no imports outside its folder.
- **PV-M2 `preview-compare`** (`modules/design/compare/src/**`):
  - host-surface placement and visibility callbacks: rect reporting, and hiding while overlays are open;
  - a `stale` session state;
  - still no iframe.
- **CC-M1 `component-runner-port`** (`modules/design/components/{src,ui,tests}/**`):
  - `ComponentRunnerPort` (`render`, `place`, `motion`, `capture`, `close`) with labelled fakes;
  - declarative prop slots;
  - a held placeholder in production when no runner is injected, so production no longer mounts `srcdoc` frames; the `srcdoc` path stays harness-only.
- **Rules for all three:**
  - New tests stay inside the existing `design-sections.yml` row globs: annotations `test/*.test.ts`, compare `src/**/*.test.ts`, components `tests/*.test.ts` and `ui/**/*.test.tsx`. If a row cannot cover them, the lane stops and reports, and never edits the workflow.
  - No lane edits an index, build or generated path outside its own module.
  - Custody goes to the original module owners where their current custody is bound; otherwise one combined disjoint module builder (one new Design child) runs all three.
  - Each lane publishes from a new branch; nothing is pushed to an original ref whose current identity has not been read back.
- **PV-M3 `preview-compose`:** the CL1b owner, after CL1b and the host land, writes the compose adapters from the preview and component routes to `PreviewCapability`, `AgentChannelPort` and `ComponentRunnerPort`. Compose therefore has one writer, and no compose work runs against an unlanded host.

**CN-U1 `connector-resolve-unknown`** (`modules/design/connector/{src,test}/**` and its README) is ready at the U1 follow-on publication, from `work/hq-foundation` at `fc3f69a4a4ee6096e4dc60bd1295ed4e31995e52` or its read-back successor.
- It adds the optional port members, new-thread eligibility and the owner-confirmed Resolve unknown action of `iface.resolve-unknown.001`, with labelled fakes only.
- New tests stay flat `test/*.test.ts` files in the existing connector row; the lane never edits the workflow.
- Custody goes to the original connector owner where its current custody is bound; otherwise to one Design child, at most one more than the published budget.
- CL1b keeps `modules/design/connector/design-module.ts`.
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

Source work may proceed alongside r3 using the landed `@hq/ui` exports `ReferenceStatus`, `REFERENCE_STATUSES`, `ReferenceResolution`, `ReturnContext` and `ReferencePort`. Its module-local `ReferenceProvider` and optional `references`/`returnContext` props must match the unchanged `spec.hq-social-work#iface.references.001` exactly; props may structurally extend `ModulePort`. It must not edit shared contracts or depend on an unfinished r3 branch. The module candidate may be published and checked before r3, but its foundation landing still waits for `r3-landing`. Canonical assignability, shell provider registration, round-trip and native qualification remain later integration obligations. Source fixture/recorder checks prove only the module source boundary.

- **Provider:** a read-only provider for drafts, runs and brands.
- **Link editor:** in content. Persistence is gated: without `hq-references-v1`, links show "not saved — needs Social service support" and are never dropped.
- **Mount plumbing:** passes the optional `references` and `returnContext` through the index and nav files only.
- **Zero execution:** the call recorder shows zero execution calls.
<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.lane-t10.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.lane-t11.001" -->
## T11 Work References And Export

Custody stays with the original Work board owner, bound at launch.

Source work may proceed alongside r3 using the landed `@hq/ui` exports `ReferenceStatus`, `REFERENCE_STATUSES`, `ReferenceResolution`, `ReturnContext` and `ReferencePort`. Its module-local `ReferenceProvider` and optional `references`/`returnContext` props must match the unchanged `spec.hq-social-work#iface.references.001` exactly; props may structurally extend `ModulePort`. It must not edit shared contracts or depend on an unfinished r3 branch. The module candidate may be published and checked before r3, but its foundation landing still waits for `r3-landing`. Canonical assignability, shell provider registration, round-trip and native qualification remain later integration obligations. Source fixture/recorder checks prove only the module source boundary.

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
| `work-session-injection` → `work-injection-landing` | T4 → T1 | `work-landing` |
| `live-wiring` → `wiring-landing` | T2 → T1 | as before, plus `work-injection-landing` |
| `wiki-mount` → `wiki-mount-landing` | T2 → T1 | `live-wiring`, `wiki-landing`; + `wiring-landing` |
| `design-reference-provider` (K4) → `design-provider-landing` | T8 → T1 | `r3-landing` |
| `design-compose-mount` (CL1b) → `design-compose-landing` | T8 → T1 | `bridge-landing`, `r3-landing`, K1/K2/K4 landings |
| `social-references` → `social-references-landing` | T10 → T1 | custody, `reference-ui-landing`, `social-landing`; + `r3-landing` |
| `work-references` → `work-references-landing` | T11 → T1 | custody, `reference-ui-landing`, `work-landing`; + `r3-landing` |
| `work-export-ui` → `work-export-landing` | T11 → T1 | `work-references`, `r3-landing`; + `work-references-landing` |
| `reference-round-trip` → `round-trip-landing` | T2 → T1 | `r3-landing`, `social-references-landing`, `work-references-landing`, `design-compose-landing`, `work-export-landing` |
| `cli-planner-ci` → `cli-ci-landing` | T2 → T1 | `design-sections-landing` |
| `receiver-adapter` → `receiver-landing` | T2 → T1 | `wiki-mount-landing`, `design-compose-landing`, `round-trip-landing` |
| `preview-agent` (PV-M1), `preview-compare` (PV-M2), `component-runner-port` (CC-M1) → `preview-agent-landing`, `preview-compare-landing`, `component-port-landing` | T8 → T1 | — |
| `preview-host` → `preview-host-landing` | T2 → T1 | `receiver-landing`, `preview-agent-landing`, `component-port-landing` |
| `connector-resolve-unknown` (CN-U1) → `connector-resolve-landing` | T8 → T1 | — |
| `new-thread-transport` → `new-thread-landing` | T2 → T1 | `preview-host-landing`, `connector-resolve-landing` |
| `preview-compose` (PV-M3) → `preview-compose-landing` | T8 → T1 | `design-compose-landing`, `preview-host-landing`, `preview-compare-landing` |
| `acceptance-infrastructure` → `infrastructure-landing` | T7 → T1 | `harness-landing`, `wiring-landing`, `wiki-mount-landing` |
| `acceptance-scenarios` → `scenarios-landing` | T7 → T1 | `harness-landing`, `wiring-landing`, `wiki-mount-landing`, `round-trip-landing`, `design-compose-landing`, `work-export-landing`, `infrastructure-landing` |
| `preview-scenarios` → `preview-scenarios-landing` | T7 → T1 | `scenarios-landing`, `preview-host-landing` |
| `import-export-qualification` → `import-export-enablement` → `enablement-landing` | T7 → T8 → T1 | `design-storage-landing`, `r3-landing`, `design-compose-landing`; enablement predicate |
| `closure-qualification` | T7 | all closure landings, including `preview-compose-landing`, `preview-scenarios-landing` and `new-thread-landing` |
| seven held-gate qualifications | T7 | each explicit predicate (receiver S1 also after `receiver-landing`; U1 also after `new-thread-landing`; S2 and component also after `preview-compose-landing` and `preview-scenarios-landing`) |
| `preview-enablement` → `preview-enablement-landing`; `component-static-enablement` → `component-static-landing`; `component-scripted-enablement` → `component-scripted-landing` | T2 → T1 | its qualification gate and its own enabling predicate |
| `final-acceptance` → `main-delivery` | T7 → T1 | `closure-qualification`, `scenarios-landing`, `wiki-mount-landing`, every gate, the three enabling landings, `install-route` |

**Ready at publication:** K1, K2 and K3 became ready at the previous revision; K3 has since landed as #57. This revision adds `work-session-injection` and the three preview module lanes (`preview-agent`, `preview-compare`, `component-runner-port`). Their write scopes are disjoint from each other and from every task that can be ready with them. The only existing task that gains a dependency is live wiring, on the Work seam it consumes. No other dependency changes for live wiring, the Wiki mount, K1–K4, r3 or the D-4 lanes, so there is no new barrier. `reference-ui` and the T10/T11 tasks wait for actual custody binding. The U1 follow-on revision adds `connector-resolve-unknown`, ready at its publication with a scope disjoint from every task that can be ready with it, and `new-thread-transport`, which waits for `preview-host-landing` and `connector-resolve-landing`. Only `new-thread-u1-qualification` and `closure-qualification` gain a dependency, `new-thread-landing`; no other dependency changes.

**Reference-source scheduling amendment:** Social and Work reference source tasks consume the landed UI structural types and unchanged reference specification, so they can run in parallel with r3 after their existing UI/domain/custody prerequisites. Their `r3-landing` dependency moves to each source-landing task; integration order is preserved. No shared write scope, test intent, reference contract, round-trip dependency or native gate changes. Work Export UI still waits for the actual r3 export seam and its existing dependencies. Use sibling PRs against foundation because unfinished r3 host source is not an upstream source input.

**Acceptance-infrastructure amendment:** this revision adds three things:
- `acceptance-infrastructure` (T7, building, Astra/medium);
- its T1 landing, `infrastructure-landing`;
- its Test Intent `test.acceptance-infrastructure.001`, covered by `hq-electron-acceptance`.

The new task depends only on `harness-landing`, `wiring-landing` and `wiki-mount-landing`.
- **Dependencies.** Only `acceptance-scenarios` gains a dependency, the new landing; it keeps all six of its existing dependencies. No other task changes.
- **Write scope.** The new task's scope lies inside T7's existing `tests/acceptance` and `docs/evidence/hq-integration/acceptance`. The new dependency serializes it ahead of `acceptance-scenarios` and, through `scenarios-landing`, ahead of `preview-scenarios`, so no two tasks that can be ready together share a path.
- **Unchanged.** Every source scope, interface, check group, native flag, held gate, reviewer disposition, the Work restart contract and the finish line stay as they are.

**Model hints (claude_frontier; the native tuple is recorded per task in the compile projection):**
- Building defaults to Astra/medium.
- K2 (`design-app-sections`) is the production successor of `spec.hq-expansion#task.request-composition.001`, whose explicit Sonnet 5.5/high builder override may apply.
  - Its existing preflight child is Astra/medium. The override takes effect only if the Design coordinator explicitly reconciles the native implementation binding before source work; nothing claims an effective Sonnet model otherwise.
  - The typed helper has no Sonnet entry, so compiler capsules carry a labelled placeholder.
- K1, K3, K4, r3 and the D-4 lanes come from `spec.hq-design` or `spec.hq-social-work` and use Astra/medium; the old Design-section Opus builder instruction is not extended.
- The preview module lanes, the preview host, the T7 preview suites and the enabling commits are building work at Astra/medium. `preview-compose` keeps the CL1b owner's existing native tuple. `work-session-injection` keeps the existing Work owner's native tuple.
- `connector-resolve-unknown` and `new-thread-transport` are building work at Astra/medium. `connector-resolve-unknown` keeps the original connector owner's native tuple when that custody is bound.
- Verification mechanics and research, including the two preview qualification gates, use Sol/medium; closure and final judgment use Astra/high.
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
  "objective": "Wire the landed Social live and Work runtime adapters to the bridge transports in the shell, with real local services opt-in and synthetic services by default. Add a shell integration test proving the live path, unavailable/unknown truthfulness, no unknown-write retry and no live-to-fixture fallback. Exercise Work against a disposable local Planner service from services/planner. Consume the Work public seam: call setWorkSessionPort once before the first Work session with the configured live Planner and recovery, or the labelled examplePlanner only when configuration explicitly says unconfigured. A failed configuration read or a live-service error never falls back to the example, and a configuration change needs the labelled reload. Adapt only wrapper descriptor/identity expectations and explicit valid UNCONFIGURED synthetic-bridge setup in the three named existing test fixtures. Preserve every port, write, execution, navigation, restoration and Undo assertion plus missing/failed configuration and live-no-fixture-fallback negatives. A real product regression is repaired inside the owned wrapper cone, never accepted by weakening a test.",
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
    "apps/desktop/src/live-services.integration.test.tsx",
    "modules/social/nav/test/registry.test.tsx",
    "modules/work/nav/test/registry.test.tsx",
    "apps/desktop/src/social-work.integration.test.tsx"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.bridge-landing.001",
    "spec.hq-integration-parallel-execution#task.social-landing.001",
    "spec.hq-integration-parallel-execution#task.work-landing.001",
    "spec.hq-integration-parallel-execution#task.main-sync.001",
    "spec.hq-integration-parallel-execution#task.work-injection-landing.001"
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
    "hq-root-build",
    "hq-social-live",
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.live-wiring.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.wiki-mount.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Mount Wiki fourth in the rail after Work with createWikiDomain({ getPort }) from modules/wiki. Add domain ID wiki to shared contracts and exactly the seven closed read methods over preload/IPC; refresh and home migration stay host-only in main over modules/wiki/core. Home migration means versioned Wiki configuration and index initialization and upgrade in the app userData directory only, never an inferred legacy or private location. Separately, migrate the renderer's stored navigation destination in apps/desktop/src/state.ts so Wiki is fourth and a legacy home maps to it. Add apps/desktop/tsconfig.wiki-host.json as an additive mirror of the Design host emit. Register the @hq/wiki workspace and its lockfile entry; raise engines and CI to Node >=22.18; keep Wiki node:test suites out of Vitest discovery and run them in a Node test-runner step in foundation.yml; add main-only Wiki source configuration (renderer sees labels only); external CSS under the existing CSP. Prove a synthetic Git-corpus round trip through the real shell; no private data. This mount never claims spec.hq-expansion wiki-integration closure while private validation is held.",
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
    "apps/desktop/src/ServiceSettings.tsx",
    "apps/desktop/src/state.ts",
    "apps/desktop/src/state.test.ts",
    "apps/desktop/src/App.settings.test.tsx",
    "apps/desktop/tsconfig.wiki-host.json"
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
  "objective": "On the exact final work/hq-foundation head (equal to the #2 head), run npm ci, typecheck, test and build, the Wiki Node tests, CLI and Planner tests, the Electron acceptance scenarios and the closure suites. Then follow the bound laptop route: install and launch the final candidate, including the preview and component checks for its verified OS and the separately bound macOS check (OS-MAC1); do not assume the laptop OS or substitute a different machine. Report every failure, skip and gap, and every held capability with its gate; never report a gap or a fixture as a pass.",
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
    "spec.hq-integration-parallel-execution#task.laptop-route-binding.001",
    "spec.hq-integration-parallel-execution#task.preview-enablement-landing.001",
    "spec.hq-integration-parallel-execution#task.component-static-landing.001",
    "spec.hq-integration-parallel-execution#task.component-scripted-landing.001"
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
    "spec.hq-integration-parallel-execution#task.social-references.001",
    "spec.hq-integration-parallel-execution#task.r3-landing.001"
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
    "spec.hq-integration-parallel-execution#task.work-references.001",
    "spec.hq-integration-parallel-execution#task.r3-landing.001"
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
  "objective": "Register the landed Design, Social and Work providers in apps/desktop/src/reference-providers.ts and prove spec.hq-social-work ac.reference-integration.001 in a shell integration test: Social draft ↔ Work card links, open and Back with source state intact, truthful changed/archived/missing/moved/unavailable, unlink leaves the target, export/import preserves links, all execution spies zero. Also bind r3's Work export client once for live selection in apps/desktop/src/services/domains.tsx, forwarding the stable port through the typed WorkModuleProps.workExport member in modules/work/index.tsx; example and unavailable selections never receive an export port.",
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
    "apps/desktop/src/services/domains.tsx",
    "modules/work/index.tsx"
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

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.acceptance-infrastructure.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t7",
  "objective": "Prepare only the landed native harness's infrastructure before the integrated scenarios; do not reuse the landed acceptance-harness task. Add per-row pass/fail/gap/held/unmeasured results, harness-generated userData configuration, loopback synthetic Work and Social HTTP fixtures with a request ledger over the landed closed routes, a synthetic isolated Wiki corpus, and complete cleanup of every owned resource. Write no scenario or preview suite; this task does not activate acceptance-scenarios. Add no npm dependency or script; run with node.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
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
    "tests/acceptance/run.mjs",
    "tests/acceptance/runtime.mjs",
    "tests/acceptance/cleanup.test.mjs",
    "tests/acceptance/cleanup-fixture.mjs",
    "tests/acceptance/README.md",
    "tests/acceptance/fixtures",
    "docs/evidence/hq-integration/acceptance"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.harness-landing.001",
    "spec.hq-integration-parallel-execution#task.wiring-landing.001",
    "spec.hq-integration-parallel-execution#task.wiki-mount-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.working-app.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.acceptance-infrastructure.001"
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
    "No reviewer bots or automated PR review services; no sudo, signing, credential or deployment effect.",
    "Scope: only the five named tests/acceptance files, new files under tests/acceptance/fixtures, and docs/evidence/hq-integration/acceptance. Nothing under tests/acceptance/scenarios or tests/acceptance/preview, and no other file under tests/acceptance.",
    "Environment: keep stripping every inherited HQ_* variable. Pass only the harness-generated HQ_USER_DATA_DIR for the owned profile, which main honours only when unpackaged. Add no HQ_QUALIFY_* or other qualification-switch allowance; packaged-mode ignore rules stay unchanged.",
    "Per-row results: each row records pass, fail, gap, held or unmeasured with its prerequisite evidence, and an unavailable prerequisite is never a pass. Full mode never reports a full pass while any scenario row is missing, unimplemented or held. Checkpoint mode keeps its existing semantics and outcome.",
    "Service fixtures: loopback-only synthetic Work and Social HTTP servers on harness-chosen ports, using only the closed routes and wire shapes of the landed services.ts and the landed Work and Social live adapters. A fixture self-test binds the Work codec read-only to the landed Planner contract exchanges. Module source and module tests are neither imported nor edited.",
    "Ledger and failure modes: fixtures record method, path, canonical body, request ID and count for every request. They induce applied-but-response-lost, not-applied, malformed, unavailable and indeterminate outcomes only as iface.service-response.001 and the landed adapters define them.",
    "Work restart contract unchanged: fixtures model Planner-persisted service state only. They neither provide nor assert durability of in-session unresolved write intent, which spec.hq-social-work RW-9 and G-3 keep session-only.",
    "Wiki corpus: an owned synthetic committed Git corpus shaped like the checked-in synthetic corpus, with isolated Git configuration and owned commits, plus the owned profile's wiki/config.json. No private corpus, remote, fetch or provenance substitution.",
    "Cleanup: register every fixture server, socket, process, profile and temporary corpus or export tree before startup. Remove exactly those on success, deliberate failure (preserving the original error), SIGINT, SIGTERM and partial startup, with concurrent invocations isolated. Preserve bounded evidence first; a cleanup failure is a failure. No broad /tmp or process cleanup.",
    "Checks: fixture and cleanup self-tests run without Electron. Native checks run only as separately bound checks on this task's exact candidate, each after a fresh CPU admission sample taken apart from the command: the unchanged shell checkpoint, and full mode recording a gap for every unimplemented scenario row. That full-mode outcome is held-row evidence, never integrated or full acceptance.",
    "No real endpoint, owner configuration, canary, public network, host installation, display or network reconfiguration, packet capture or credential.",
    "No product, shared-contract, apps, modules, packages, root-script, dependency, lockfile or workflow change. No native save-dialog driver, main-process or API monkeypatch, generic filesystem IPC, reference-provider registration, or fake or simulated qualification.",
    "This task neither activates nor satisfies acceptance-scenarios, preview-scenarios or any qualification gate, and its evidence substitutes for none of them."
  ],
  "stop_conditions": [
    "Stale source identity, unexpected or unowned change, overlapping writer, or unknown prior effect.",
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "A needed path outside the seven write-scope entries, a qualification switch, a native-dialog driver, or a landed wire shape the fixtures cannot bind exactly; request a T1 rebind instead."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.acceptance-infrastructure.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.infrastructure-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the test-only acceptance-infrastructure PR, merges it into work/hq-foundation and reads back.",
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
    "spec.hq-integration-parallel-execution#task.acceptance-infrastructure.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.infrastructure-landing.001" -->

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
    "spec.hq-integration-parallel-execution#task.work-export-landing.001",
    "spec.hq-integration-parallel-execution#task.infrastructure-landing.001"
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
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-scenarios-landing.001",
    "spec.hq-integration-parallel-execution#task.new-thread-landing.001",
    "spec.hq-integration-parallel-execution#task.source-registry-host-landing.001"
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
  "objective": "Qualify new-thread launch only under ac.new-thread-u1-binding.001: the merged and installed Jones Code launch contract of spec.jones-client-launch, native consent, and the landed HQ new-thread transport; no fake launch qualification.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.operator-interaction-inventory.001",
    "spec.hq-integration-parallel-execution#iface.new-thread-transport.001"
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
    "spec.hq-integration-parallel-execution#task.receiver-landing.001",
    "spec.hq-integration-parallel-execution#task.new-thread-landing.001"
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
  "objective": "On the bound exact head and native check host, under HQ_QUALIFY_PREVIEW, run every preview row in ctx.preview-qualification.001 (Q-PV0 to Q-PV10, including 3h, 6a, 6d and 6h) against the native built app on Electron 44.9.0 with synthetic inputs, positive controls and the named fault hooks, plus one public-website smoke run with ordinary outbound network and no credentials, recorded separately. Record C1–C6, the observed network reach as disclosure and the pick-binding outcome for T1. Production stays disabled.",
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
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-scenarios-landing.001"
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
    "No bound head or native check host, or a run would need sudo, credentials or packet capture; report held."
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
  "objective": "On the bound exact head and native check host, under HQ_QUALIFY_COMPONENT_STATIC and HQ_QUALIFY_COMPONENT_SCRIPTED, run Q-CS1–4 and Q-CX1–6 on the native built app: every CC-CANARY channel over IPv4 and IPv6, loopback and non-loopback, with H-PROXY off and on, three repetitions and positive controls before and after. Report Tier S and Tier X separately; any hit is a recorded failure and never overwritten; a row without a positive control is unmeasured. Execution stays disabled.",
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
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-scenarios-landing.001"
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
    "No bound head or native check host, or a run would need sudo, credentials or packet capture; report held."
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

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-session-injection.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t4",
  "objective": "From work/hq-foundation at 9badd4f16b55e14a52e91cff95f6a5d6f20ec584 or its read-back successor, on a fresh successor ref of the existing Work owner: promote the existing setWorkSessionPort(port, {example, recovery}) to the explicit production shell injection seam with no algorithm or signature change. Document its production behaviour in modules/work/nav/session.ts; export setWorkSessionPort and examplePlanner by name from modules/work/index.tsx and correct the stale entry documentation; add public-entry injection and selection regressions in modules/work/nav/test/live-selection.test.tsx. resetWorkSessions stays test-only and unexported. Publish one module-only non-draft PR against work/hq-foundation.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t4.001",
    "spec.hq-integration-parallel-execution#iface.contracts.001"
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
    "modules/work/nav/session.ts",
    "modules/work/index.tsx",
    "modules/work/nav/test/live-selection.test.tsx",
    "docs/evidence/hq-social-work/work-shell-injection.md"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.work-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.work-session-injection.001"
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
    "A needed change to a shared contract, root configuration or another lane's scope; request a T1 rebind instead.",
    "A signature or algorithm change, a resetWorkSessions export, or a Work core, live, shared or root write would be needed; stop and report."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-session-injection.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.work-injection-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the work-session-injection PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back. This releases live wiring's consumed seam.",
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
    "spec.hq-integration-parallel-execution#task.work-session-injection.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.work-injection-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-agent.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "PV-M1. From work/hq-foundation at 9badd4f16b55e14a52e91cff95f6a5d6f20ec584 or its read-back successor, under iface.preview-host.001 PV-AGENT and PV-COHERE: ignore untrusted pick and cite events; tag every event with its mode generation; export the bounded isolated-world queue host shim (cap 64, drop-oldest with a counter); add a synchronous MutationObserver counter through takeRecords(), highlight hide and restore, and one-call exact re-resolution returning identity, text and rects; keep the entry IIFE-safe with no imports outside its folder. Structural ports and fakes only; no Electron. New tests are flat test/*.test.ts files. Publish one non-draft PR against work/hq-foundation from a new branch.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001",
    "spec.hq-integration-parallel-execution#iface.preview-host.001"
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
    "modules/design/annotations/src/preview-agent",
    "modules/design/annotations/test"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.preview-component-source.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.preview-agent.001"
  ],
  "affected_check_groups": [
    "hq-preview-agent",
    "design-annotations"
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
    "A new test would fall outside the existing design-sections.yml row globs, or a change outside the module cone would be needed; stop and report, never edit the workflow.",
    "Pushing to an original module ref whose current identity has not been read back."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-agent.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-agent-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the preview-agent PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/annotations/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.preview-agent.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-agent-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-compare.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "PV-M2. From work/hq-foundation at 9badd4f16b55e14a52e91cff95f6a5d6f20ec584 or its read-back successor: host-surface placement and visibility callbacks in modules/design/compare/src (rect reporting in window DIP, hidden while HQ overlays are open) and a stale preview-session state, over the existing PreviewSurface, PreviewSession and OverlayFrame contract. Compare still never creates an iframe; live panels read live preview and captures static capture. Tests stay src/**/*.test.ts. Publish one non-draft PR against work/hq-foundation from a new branch.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001",
    "spec.hq-integration-parallel-execution#iface.preview-host.001"
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
    "modules/design/compare/src"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.preview-component-source.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.preview-compare.001"
  ],
  "affected_check_groups": [
    "hq-preview-compare",
    "design-compare"
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
    "A new test would fall outside the existing design-sections.yml row globs, or a change outside the module cone would be needed; stop and report, never edit the workflow.",
    "Pushing to an original module ref whose current identity has not been read back."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-compare.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-compare-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the preview-compare PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/compare/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.preview-compare.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-compare-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.component-runner-port.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "CC-M1. From work/hq-foundation at 9badd4f16b55e14a52e91cff95f6a5d6f20ec584 or its read-back successor, under iface.component-runner.001: ComponentRunnerPort (render, place, motion, capture, close) with labelled fakes; declarative prop slots (data-hq-text, data-hq-attr-*) as a module-local schema extension; production mounts a held placeholder instead of srcdoc frames when no runner is injected, and the srcdoc path stays harness-only. Tests stay tests/*.test.ts and ui/**/*.test.tsx. Publish one non-draft PR against work/hq-foundation from a new branch.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001",
    "spec.hq-integration-parallel-execution#iface.component-runner.001"
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
    "modules/design/components/src",
    "modules/design/components/ui",
    "modules/design/components/tests"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.preview-component-source.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.component-runner-port.001"
  ],
  "affected_check_groups": [
    "hq-component-runner-port",
    "design-components"
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
    "A new test would fall outside the existing design-sections.yml row globs, or a change outside the module cone would be needed; stop and report, never edit the workflow.",
    "Pushing to an original module ref whose current identity has not been read back."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.component-runner-port.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.component-port-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the component-runner-port PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/components/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.component-runner-port.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.component-port-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-host.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "T2 step 7 after receiver-landing: one PR with two coherent commits under iface.preview-host.001 and iface.component-runner.001. First the preview host: the single contents factory (PV-TRUST), the WebContentsView host with PV-POLICY, PV-FENCE and PV-COHERE (blob.put only after acceptance), isolated-world injection of the pinned build:preview-agent bundle of the landed agent, the closed hq:svc:preview channel and one preload member. Then the hq-component runner: per-session protocol, header CSP per tier, webRequest allow-list and capture. All four status constants stay false, each alone in its status file with its own status test. Add the unpackaged-only HQ_QUALIFY_PREVIEW, HQ_QUALIFY_COMPONENT_STATIC and HQ_QUALIFY_COMPONENT_SCRIPTED switches and switch-gated fault hooks, ignored by packaged builds. The main-renderer CSP and allowedSender are unchanged; no new dependency.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.preview-host.001",
    "spec.hq-integration-parallel-execution#iface.component-runner.001",
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
    "package.json",
    "apps/desktop/vite.preview-agent.config.ts",
    "apps/desktop/tsconfig.electron.json",
    "apps/desktop/electron/contents-factory.ts",
    "apps/desktop/electron/contents-factory.test.ts",
    "apps/desktop/electron/preview",
    "apps/desktop/electron/components",
    "apps/desktop/electron/main.ts",
    "apps/desktop/electron/preload.cts",
    "apps/desktop/electron/security.ts",
    "apps/desktop/electron/security.test.ts",
    "apps/desktop/src/environment.d.ts",
    "packages/contracts/src/preview.ts",
    "packages/contracts/src/services.ts",
    "packages/contracts/src/index.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.receiver-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-agent-landing.001",
    "spec.hq-integration-parallel-execution#task.component-port-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.preview-component-source.001",
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.preview-host.001"
  ],
  "affected_check_groups": [
    "hq-preview-host",
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
    "A CSP change, an allowedSender change, a preload on preview or component contents, or generic IPC would be needed; stop and request a T1 rebind."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-host.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-host-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the preview-host PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
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
    "spec.hq-integration-parallel-execution#task.preview-host.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-host-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-compose.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "PV-M3 by the CL1b owner after CL1b; source may use structural fakes while landing waits for the host: adapters in modules/design/app/compose from hqServices.preview and the component routes to compare's PreviewCapability (host-surface surface, qualification from status), annotations' AgentChannelPort and components' ComponentRunnerPort. The Compare, Annotations and Components views use them and show unavailable while the host reports disabled. No generic invoke, URL fetch or path; extend the renderer-safe walk. Bind registry Open to the direct presentation main-frame document; persist route/state/capture-bound annotations and Add screen. Keep stale anchors explicit.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001",
    "spec.hq-integration-parallel-execution#iface.preview-host.001",
    "spec.hq-integration-parallel-execution#iface.component-runner.001",
    "spec.hq-integration-parallel-execution#ctx.project-experience-workflow.001"
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
    "modules/design/app/compose"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-compare-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.preview-component-source.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.preview-compose.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-compose.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-compose-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the preview-compose PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
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
    "spec.hq-integration-parallel-execution#task.preview-compose.001",
    "spec.hq-integration-parallel-execution#task.preview-host-landing.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-compose-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-scenarios.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t7",
  "objective": "Extend the landed native harness with the suites of ctx.preview-qualification.001: synthetic fixture sites on loopback; CC-CANARY listeners on loopback and one host-owned non-loopback address with positive-control clients before and after each run; the named fault-hook driver; packaged-mode-ignores checks for every switch; and runners for Q-PV0–Q-PV10, Q-CS1–4 and Q-CX1–6 against the built app. A row without a positive control reports unmeasured. No npm dependency, sudo or packet capture; owned profile, listener and process cleanup on every exit path. Qualifying runs belong to the gate tasks. Add synthetic enrollment → interactive click-through → pick/comment → capture flow → explicit qualification-stub send → receipt/readback.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t7.001",
    "spec.hq-integration-parallel-execution#ctx.preview-qualification.001"
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
    "docs/evidence/hq-integration/preview"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.preview-component.001",
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.scenarios-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-host-landing.001",
    "spec.hq-integration-parallel-execution#task.preview-compose-landing.001",
    "spec.hq-integration-parallel-execution#task.runs-live-dispatch-landing.001",
    "spec.hq-integration-parallel-execution#task.source-registry-host-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.preview-component-source.001",
    "spec.hq-integration-parallel-execution#ac.working-app.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.preview-scenarios.001"
  ],
  "affected_check_groups": [
    "hq-preview-acceptance",
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-scenarios.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-scenarios-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the preview-scenarios PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
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
    "spec.hq-integration-parallel-execution#task.preview-scenarios.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-scenarios-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-enablement.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "The enabling checkpoint: one commit that sets PREVIEW_HOST_ENABLED true, and PREVIEW_PICK_QUALIFIED true only when Q-PV4 and every Q-PV6 row passed for the accepted head's evidence, and turns the disabled-status test into an enabled-status test. Nothing else changes.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.preview-host.001",
    "spec.hq-integration-parallel-execution#iface.component-runner.001"
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
    "apps/desktop/electron/preview/status.ts",
    "apps/desktop/electron/preview/status.test.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.preview-s2-qualification.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-integration-parallel-execution#task.preview-s2-qualification.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.preview-enablement.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.preview-enablement.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.preview-enablement.001"
  ],
  "affected_check_groups": [
    "hq-preview-host",
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
    "The accepted evidence is for a different head, or any change beyond the status file and its test would be needed."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.preview-enablement-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the preview-enablement PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/electron/preview/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.preview-enablement.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.preview-enablement-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.component-static-enablement.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "The enabling checkpoint: one commit that sets COMPONENT_STATIC_ENABLED true for the accepted head's evidence, and turns the disabled-status test into an enabled-status test. Nothing else changes.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.preview-host.001",
    "spec.hq-integration-parallel-execution#iface.component-runner.001"
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
    "apps/desktop/electron/components/static-status.ts",
    "apps/desktop/electron/components/static-status.test.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.component-containment-gate.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-integration-parallel-execution#task.component-containment-gate.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.component-static-enablement.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.component-static-enablement.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.component-static-enablement.001"
  ],
  "affected_check_groups": [
    "hq-preview-host",
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
    "The accepted evidence is for a different head, or any change beyond the status file and its test would be needed."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.component-static-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.component-static-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the component-static-enablement PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/electron/components/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.component-static-enablement.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.component-static-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.component-scripted-enablement.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "The enabling checkpoint: one commit that sets COMPONENT_SCRIPTED_ENABLED true for the accepted head's evidence, and turns the disabled-status test into an enabled-status test. Nothing else changes.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.preview-host.001",
    "spec.hq-integration-parallel-execution#iface.component-runner.001"
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
    "apps/desktop/electron/components/scripted-status.ts",
    "apps/desktop/electron/components/scripted-status.test.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.component-containment-gate.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-integration-parallel-execution#task.component-containment-gate.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-integration-parallel-execution#ac.component-scripted-enablement.001"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.component-scripted-enablement.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.component-scripted-enablement.001"
  ],
  "affected_check_groups": [
    "hq-preview-host",
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
    "The accepted evidence is for a different head, or any change beyond the status file and its test would be needed."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.component-scripted-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.component-scripted-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the component-scripted-enablement PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "apps/desktop/electron/components/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.component-scripted-enablement.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.component-scripted-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.connector-resolve-unknown.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "CN-U1. From work/hq-foundation at fc3f69a4a4ee6096e4dc60bd1295ed4e31995e52 or its read-back successor, under iface.resolve-unknown.001: add the optional TransportDescriptor.modes, FenceOutcome and TransportPort.fence port members; make a new-thread destination eligible only when its transport qualifies and declares new-thread, and derive newThreadControl from the rows; add outbox.resolveUnknown with its preconditions, one fence call and closed mapping, where an unanswered fence leaves the attempt unknown and nothing retries; add controller requestResolveUnknown/confirmResolveUnknown and the panel card wired through ConnectorPanelHost; a labelled fake fence for tests; README status rows. Additive only: existing exports, persisted dispatch and handoff formats, and the send and reconciliation paths are unchanged, and no read path can reach fence. New tests are flat test/*.test.ts files. Publish one non-draft PR against work/hq-foundation from a new branch.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t8.001",
    "spec.hq-integration-parallel-execution#iface.resolve-unknown.001"
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
    "modules/design/connector/src",
    "modules/design/connector/test",
    "modules/design/connector/README.md"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.new-thread-followon.001"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.new-thread-followon-source.001",
    "spec.hq-integration-parallel-execution#ac.module-candidates.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.connector-resolve-unknown.001"
  ],
  "affected_check_groups": [
    "hq-connector-resolve-unknown",
    "design-connector"
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
    "A new test would fall outside the existing design-sections.yml connector row glob, or a change outside the module cone would be needed; stop and report, never edit the workflow.",
    "A needed change to a persisted dispatch or handoff format, or a fence call reachable from any read path.",
    "Pushing to an original module ref whose current identity has not been read back."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.connector-resolve-unknown.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.connector-resolve-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the connector-resolve-unknown PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t1.001"
  ],
  "read_scope": [
    "docs/",
    "modules/design/connector/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.source-integration.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.connector-resolve-unknown.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.connector-resolve-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.new-thread-transport.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "T2 step 9 after preview-host-landing and connector-resolve-landing, under iface.new-thread-transport.001, against the planned Jones Code contract spec.jones-client-launch (target Jones-Systems/Jones-Code fa7c6c013811db33d128422027697dbaa1517b60), with no Jones Code change. Inside the landed receiver's main-only jones-code module: the main-only new-thread binding; keyed t3_thread_launch send with clientRequestId = the attempt key and the jcl1 receipt; t3_thread_launch_lookup readback; t3_thread_launch_fence reachable only through the connector's owner-confirmed resolveUnknown; the closed result mapping, the ledger and the session rule; the one added design.jonesCode.fence route and its contract shapes; the jones-code composition with the connector port types. The descriptor lists new-thread only with U1 evidence, so production stays disabled and unqualified. Qualify with the Q-N wire stub only; no OAuth, token, live call or installed Jones Code dependency.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.lane-t2.001",
    "spec.hq-integration-parallel-execution#iface.new-thread-transport.001",
    "spec.hq-integration-parallel-execution#iface.resolve-unknown.001",
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
    "apps/desktop/electron/jones-code",
    "apps/desktop/electron/main.ts",
    "apps/desktop/electron/preload.cts",
    "apps/desktop/src/ServiceSettings.tsx",
    "apps/desktop/src/modules.tsx",
    "packages/contracts/src/jones-code.ts",
    "packages/contracts/src/index.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.new-thread-followon.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.preview-host-landing.001",
    "spec.hq-integration-parallel-execution#task.connector-resolve-landing.001",
    "spec.hq-integration-parallel-execution#task.source-registry-host-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.new-thread-followon-source.001",
    "spec.hq-integration-parallel-execution#ac.shared-runtime.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.new-thread-transport.001"
  ],
  "affected_check_groups": [
    "hq-new-thread-transport",
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
    "Any live Jones Code call, OAuth consent or token read would be needed.",
    "The landed receiver lacks the MCP client, ledger or handoff text this task reuses; request a T1 rebind."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.new-thread-transport.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.new-thread-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "T1 verifies the new-thread-transport PR a diff inside its literal write scope and green exact-head checks, merges it into work/hq-foundation with --match-head-commit and reads back.",
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
    "spec.hq-integration-parallel-execution#task.new-thread-transport.001"
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.new-thread-landing.001" -->

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
  "scenario": "The shell drives Social through a wire stub and Work through a disposable local Planner service. Wrapper integration adapts the existing Social/Work registry and shell fixtures with explicit valid UNCONFIGURED synthetic bridge setup while preserving all behavior assertions and negative configuration/no-fallback cases.",
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
    "hq-shared-bridge",
    "hq-root-build",
    "hq-social-live",
    "hq-work-runtime"
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
  "scenario": "Wiki appears fourth in the rail; search, page, backlinks and topics work over the seven closed IPC methods against a synthetic Git corpus; refresh and home migration are host-only; versioned userData Wiki configuration and index initialize and upgrade; a stored legacy navigation destination maps to Wiki fourth.",
  "evidence": {
    "predicate": "Root checks include modules/wiki and pass; Wiki node:test suites run in a CI Node test-runner step on Node >=22.18 and stay out of Vitest discovery; home and source configuration is main-only; home migration touches only the versioned app userData configuration and index; state and settings tests cover the destination migration; the wiki host emit mirrors the Design host additively; the CSP is unchanged.",
    "invalid": "The renderer can trigger refresh, migration, read paths or arbitrary sources; an inferred legacy or private location is read; Wiki tests are silently excluded.",
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
  "scenario": "Closed r3 routes cross preload into main; gate exclusivity and recover-before-serve; singleton catalog selection/replacement/cancel, restart generation and partial/failing scans with synthetic directories; Work export via a stubbed save dialog and Planner stub; reference open/Back/mismatch in the shell.",
  "evidence": {
    "predicate": "Root checks and Electron security tests pass; transaction/export routes return unavailable(disabled); catalog roots is empty/singleton, cancel preserves selection, same canonical root retains ID, replacement changes ID, generations strictly increase across replacement/forget/restart, stale scans/readers are refused, K3 partial completeness is preserved, unavailable scans cannot mark cached entries missing, and next complete replacement scan marks old-scope records missing without deleting links; Work export bytes equal the stub and the renderer gets no path; reference contract matches iface.references.001; structural types assignable.",
    "invalid": "Generic IPC, a path or token in renderer state, an enabled route, a CSP change, generation reset/reuse, complete empty snapshots fabricated from root failures, or deletion on forget.",
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

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.acceptance-infrastructure.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "scenario": "Fixture and cleanup self-tests run without Electron. Then, as separately bound native checks on the exact candidate, the unchanged shell checkpoint passes and a full-mode run records a gap for every unimplemented scenario row.",
  "evidence": {
    "predicate": "Self-tests pass. Fixtures bind the landed closed codecs and record exact request ledgers. Cleanup leaves no owned profile, process, listener, socket or tree on any exit path. Checkpoint mode passes unchanged, and full mode records per-row gaps and no full pass. The full-mode gaps are held-row evidence, not integrated or full acceptance.",
    "invalid": "A full pass with any missing scenario row, an unavailable prerequisite counted as a pass, an inherited HQ_* variable or a qualification switch passed through, a real endpoint contacted, or a leaked resource.",
    "unknown": "No display is available on the host for the native checks; record it as a platform gap."
  },
  "environment": [
    "Node 24 for the self-tests; built app on the check host for the separately bound native checks"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.acceptance-infrastructure.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.acceptance-infrastructure.001",
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.acceptance-infrastructure.001" -->

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
  "scenario": "Every preview row of ctx.preview-qualification.001 on the native built app under HQ_QUALIFY_PREVIEW, with synthetic fixture sites, positive controls and named fault hooks, plus one separately recorded public-website smoke run.",
  "evidence": {
    "predicate": "At one exact head every row has its recorded outcome: C1–C6 pass; Q-PV3h hits are recorded as disclosed reach, never as containment; picks anchor only with coherent digests and blobs are written only after acceptance; T1 accepts the claim set.",
    "invalid": "A fake or simulated surface, a run outside the built app, a production-enabled run before the gate, mixed heads, or a hygiene observation counted as containment.",
    "unknown": "No display or Electron 44.9.0 on the check host; report held."
  },
  "environment": [
    "Owner-bound native environment: built app, Electron 44.9.0, ordinary user, display"
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
    "hq-held-gates",
    "hq-preview-acceptance"
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
  "scenario": "Q-CS1–4 and Q-CX1–6 on the native built app under the component qualification switches: every CC-CANARY channel over IPv4 and IPv6, loopback and non-loopback, redirects and DNS aliases, H-PROXY off and on, three repetitions, positive controls before and after.",
  "evidence": {
    "predicate": "Per tier at one exact head: zero canary hits on every row whose positive control hit; unmeasured rows listed by name; any hit recorded as failed and never overwritten; packaged starts ignore the switches.",
    "invalid": "A row counted without a positive control, an overwritten hit, a fake runner, a CSP-only egress claim, or Tier S offered as component closure.",
    "unknown": "No display or Electron 44.9.0 on the check host; report held."
  },
  "environment": [
    "Owner-bound native environment: built app, Electron 44.9.0, ordinary user, display"
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
    "hq-held-gates",
    "hq-preview-acceptance"
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

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.work-session-injection.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-integration-parallel-execution#req.service-transport.001"
  ],
  "scenario": "Inject through the public modules/work entry before the first Work session: a live Planner port with recovery, and the labelled example.",
  "evidence": {
    "predicate": "The public entry exports setWorkSessionPort and examplePlanner; injection before the first session selects exactly the injected port; the example stays labelled; signature and algorithm are unchanged; resetWorkSessions is not exported.",
    "invalid": "A deep import as the production path, an implicit fallback to the example, or a Work core, live or root change.",
    "unknown": "The DOM test environment is unavailable."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.work-session-injection.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.work-session-injection.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/work/nav/"
  ],
  "affected_check_groups": [
    "hq-work-runtime"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.work-session-injection.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.preview-agent.001" -->
```json
{
  "schema_version": 1,
  "kind": "unit",
  "validates": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "scenario": "Fake-DOM suites: untrusted synthetic events, generation tags, queue cap and drop counter, the mutation counter across takeRecords, highlight hide and restore, one-call re-resolution for element and text targets, and a tampered getBoundingClientRect.",
  "evidence": {
    "predicate": "Untrusted events yield no pick; every event carries its generation; re-resolution returns identity, text and rects in one call; the entry imports nothing outside its folder; the existing annotations row runs the new tests.",
    "invalid": "A preload assumption, an IPC or Electron import, or a test outside the row's globs.",
    "unknown": "The fake DOM cannot model MutationObserver.takeRecords."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.preview-agent.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.preview-agent.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/annotations/src/preview-agent/"
  ],
  "affected_check_groups": [
    "hq-preview-agent",
    "design-annotations"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.preview-agent.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.preview-compare.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "scenario": "Compare with a host-surface session: placement callbacks, hide on overlay, the stale session state and labels.",
  "evidence": {
    "predicate": "Rects are reported in window DIP; the surface is hidden while overlays are open; stale shows as stale; captures read static capture; no iframe is created.",
    "invalid": "An iframe, a URL load, or a stale session shown as current.",
    "unknown": "No DOM environment."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.preview-compare.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.preview-compare.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/compare/src/"
  ],
  "affected_check_groups": [
    "hq-preview-compare",
    "design-compare"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.preview-compare.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.component-runner-port.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "scenario": "ComponentRunnerPort fakes, declarative prop slots, and the production workspace with and without an injected runner.",
  "evidence": {
    "predicate": "Without a runner, production shows the held placeholder and creates no srcdoc frame; slot binding is deterministic; fakes are labelled; the harness keeps the srcdoc path.",
    "invalid": "A srcdoc frame in production, script execution, or a fake shown as a contained run.",
    "unknown": "No DOM environment."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.component-runner-port.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.component-runner-port.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/components/"
  ],
  "affected_check_groups": [
    "hq-component-runner-port",
    "design-components"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.component-runner-port.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.preview-host.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "scenario": "Node and Vitest suites without Electron: scheme-policy and hygiene tables; route validation with exact keys and bounds; the fence and PV-COHERE state machine; capture-record JCS golden vectors; the PV-TRUST factory and registry; qualification-switch gating; the Tier S document builder.",
  "evidence": {
    "predicate": "Every suite in ac.preview-component-source.001 passes in root checks; every route returns unavailable(disabled) while its constant is false; blob writes happen only after acceptance; the CSP string equals 73a6532's; allowedSender is unchanged.",
    "invalid": "A CSP change, a preload on preview or component contents, generic IPC, a blob written before acceptance, or a switch honoured when packaged.",
    "unknown": "A behaviour needs Electron; record it for native qualification."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.preview-host.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.preview-host.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/electron/preview/",
    "apps/desktop/electron/components/"
  ],
  "affected_check_groups": [
    "hq-preview-host",
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.preview-host.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.preview-compose.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "scenario": "Compose adapters over stubbed preview and component routes in disabled and enabled states.",
  "evidence": {
    "predicate": "Compare, annotations and components receive their ports; disabled shows unavailable; no generic invoke, URL fetch or path; the renderer-safe walk passes.",
    "invalid": "A live compose path against an unlanded host, or a fake shown as a live preview.",
    "unknown": "A route stub lacks a case."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.preview-compose.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.preview-compose.001",
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
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.preview-compose.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.preview-scenarios.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.preview-component.001",
    "spec.hq-integration-parallel-execution#req.acceptance.001"
  ],
  "scenario": "Harness self-test: fixture sites, canaries, positive controls and fault hooks start and clean up; each suite runs against the built app under its switch and records pass, fail or unmeasured per row.",
  "evidence": {
    "predicate": "The self-test passes; a canary without a positive-control hit reports unmeasured; packaged-mode starts ignore every switch; owned profiles, listeners and processes are removed on every exit path.",
    "invalid": "A row passed without a positive control, a simulated surface, a sudo or packet-capture step, or a leaked process.",
    "unknown": "No display on the check host; record a gap."
  },
  "environment": [
    "Built app on the check host"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.preview-scenarios.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.preview-scenarios.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "tests/acceptance/"
  ],
  "affected_check_groups": [
    "hq-preview-acceptance",
    "hq-electron-acceptance"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.preview-scenarios.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.preview-enablement.001" -->
```json
{
  "schema_version": 1,
  "kind": "unit",
  "validates": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "scenario": "The enabling commit flips only the preview status file.",
  "evidence": {
    "predicate": "Only the preview status file and its status test change; enabled-status tests pass at the accepted head.",
    "invalid": "Any other change, or enablement without accepted evidence for the same head.",
    "unknown": "The evidence head differs."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.preview-enablement.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.preview-enablement.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/electron/"
  ],
  "affected_check_groups": [
    "hq-preview-host",
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.preview-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.component-static-enablement.001" -->
```json
{
  "schema_version": 1,
  "kind": "unit",
  "validates": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "scenario": "The enabling commit flips only the static component status file.",
  "evidence": {
    "predicate": "Only the static component status file and its status test change; enabled-status tests pass at the accepted head.",
    "invalid": "Any other change, or enablement without accepted evidence for the same head.",
    "unknown": "The evidence head differs."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.component-static-enablement.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.component-static-enablement.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/electron/"
  ],
  "affected_check_groups": [
    "hq-preview-host",
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.component-static-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.component-scripted-enablement.001" -->
```json
{
  "schema_version": 1,
  "kind": "unit",
  "validates": [
    "spec.hq-integration-parallel-execution#req.preview-component.001"
  ],
  "scenario": "The enabling commit flips only the scripted component status file.",
  "evidence": {
    "predicate": "Only the scripted component status file and its status test change; enabled-status tests pass at the accepted head.",
    "invalid": "Any other change, or enablement without accepted evidence for the same head; a measured hit or an unmeasured row not accepted by name.",
    "unknown": "The evidence head differs."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.component-scripted-enablement.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.component-scripted-enablement.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/electron/"
  ],
  "affected_check_groups": [
    "hq-preview-host",
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.component-scripted-enablement.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.connector-resolve-unknown.001" -->
```json
{
  "schema_version": 1,
  "kind": "unit",
  "validates": [
    "spec.hq-integration-parallel-execution#req.new-thread-followon.001"
  ],
  "scenario": "Node suites with the labelled fake: new-thread eligibility with and without declared modes and qualification; the newThreadControl derivation; every resolveUnknown precondition refusal (not unknown, existing-thread, no fence, in flight, stale, used, expired); one fence call per confirmation; found, no-effect, unavailable, throw, timeout and malformed mappings; a CAS conflict; zero fence calls from recover, reconcile, checkStatus, refresh, selection and the evidence feed; the card and ConnectorPanelHost wiring; compatibility exports unchanged.",
  "evidence": {
    "predicate": "Fence is reachable only from a confirmed resolveUnknown; an unanswered fence leaves the attempt unknown with no retry; existing exports, persisted formats and the send path are unchanged; the existing connector row runs the new tests.",
    "invalid": "A fence call from any read path, a resend, a new persisted state or basis, a labelled fake marked qualified, or a test outside the row glob.",
    "unknown": "The server-render check cannot exercise the card interaction."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.connector-resolve-unknown.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.connector-resolve-unknown.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/connector/src/"
  ],
  "affected_check_groups": [
    "hq-connector-resolve-unknown",
    "design-connector"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.connector-resolve-unknown.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.new-thread-transport.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-integration-parallel-execution#req.new-thread-followon.001",
    "spec.hq-integration-parallel-execution#req.held-capabilities.001"
  ],
  "scenario": "Q-N: a recorded-schema stub of the Jones Code fa7c6c0 launch, lookup and fence shapes covers success with each initialMessage and preparation state, every definite failure code, orchestration_error, timeout after write, malformed and unknown codes, ledger write failure, lookup of launched, no_effect, absent, claimed and deleted keys, fence on absent, launched and failure, the existing-thread fence refusal, a session-label change, 401 and oversize.",
  "evidence": {
    "predicate": "Outcomes match iface.new-thread-transport.001; one launch call per attempt; unknown never resent; fence only through the resolve route; no token, projectId or command ID in renderer state; new-thread stays out of descriptor modes and the transport unqualified.",
    "invalid": "A live call, a retry of unknown, a no-effect from an absent lookup or after a session change, or a qualified flag or new-thread mode from fixtures.",
    "unknown": "The stub cannot represent a case."
  },
  "environment": [
    "Node 24 with npm ci on a clean isolated worktree; synthetic services only"
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.new-thread-transport.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.new-thread-transport.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/desktop/electron/jones-code/"
  ],
  "affected_check_groups": [
    "hq-new-thread-transport",
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.new-thread-transport.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.project-experience-workflow.001" -->
## Interactive Project Workflow Amendment

The owner requests enrollment, full interactive project experiences, durable annotations and explicit Jones change requests. A catalog card or imported screenshot alone does not satisfy this requirement. This amendment reuses the existing receiver, Preview Host, keyed new-thread transport, annotation agent and qualification gates. No second receiver or gallery service is introduced.

Research found existing interactive web presentations and a hashed gallery registry export; image collections are separate stills. Jones Code source `38ced3fb7857506779bf8f2f76af0ed1caf026db` implements keyed launch lookup/fencing. The paired gallery-window gateway needs an opener and is not HQ's preload-free preview transport. HQ retains its main-only MCP route.

Architecture screen: registration metadata is consumed by Discovery, the desktop host and Design composition, so identities and experience classification are explicit. Host/root/project identities remain opaque; remote/path similarity only suggests a link. The existing SourceAdapter is read-only and never executes or clones a project. Compatibility is carried as bounded flat metadata until the single shared contract owner promotes it. Network fetching and credentials stay in main. Snapshots retain last-good state, and only complete snapshots can mark omissions missing. New module mappers require no shared runtime change.

Web prototypes are the first interactive target. Native simulator execution needs a separately qualified toolchain, synthetic backend and device-control/streaming capability; it is not supplied by the web preview. The owner has subsequently requested a measured native pilot on both Macs and authorized its necessary setup and installation. Results must bind the actual source, toolchain, device and workload; resource or remote-control claims require measurements. Ordinary preview clicks must not rebuild an application.

Preview targets keep HTTPS or loopback HTTP. Existing remote plain-HTTP deployments require an approved supported route; this amendment does not relax that policy. The existing gallery's ephemeral in-page comments and paired Send control are distinct from HQ's canonical durable annotations and explicit dispatch. Existing gallery-comment import is a follow-on compatibility mapping.

Source tasks can proceed before host qualification. Production dispatch defaults to an honest disconnected state and accepts an injected qualified port; explicit example mode remains visibly simulated. No transport, reload, navigation, annotation or project enrollment triggers execution. Existing unknown outcomes remain lookup-only, never blind resend.

Writer allocation: root owns Git, this amendment and check catalog. The mapper and Runs slices have landed. Under the owner's subsequent explicit completion direction, the laptop coordinator binds one serialized successor desktop/contracts/root writer and a disjoint Design composition writer in its isolated task worktree, recorded in #50 and the existing Work Note. The old remote release remains unknown and is not retried, resent or resumed; retained remote worktrees and their lifecycle stay untouched. A later overlapping candidate requires fresh source reconciliation before landing. PR #95 touches cache/discovery/view-model and #99 touches requests; their independently owned source stays outside this assignment. Any publication must qualify the actual target-base integration without rewriting unrelated work.

Source delivery remains non-draft PRs with exact-head CI. The owner's subsequent explicit instruction releases the integration merge hold and authorizes the local HQ update after verification. Full acceptance still requires the existing S1, U1, S2/OS-MAC1, install and enablement predicates. Text-only handoff contains route, selector, quoted text, proposals and capture digest; image attachments require a coordinated follow-on contract and must not be implied.

<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.project-experience-workflow.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#req.project-experience-workflow.001" -->
## Interactive Project Requirements

XR1: UI enrollment supports the laptop root, each registered Jones environment and gallery bases with explicit user confirmation. Subsequent refresh shows freshness, conflict and offline states without recurring terminal work. Repository identity suggests but never silently merges links.

XR2: Open an interactive presentation document as the preview main frame, not iframe gallery chrome. Web prototypes, websites and stills are explicitly distinguished. Stills are never offered as interactive. Flow navigation binds route/state and coherent captures.

XR3: Pick, Cite, comments and proposals persist against version, route, state, viewport and capture digest. Stale anchors remain stale until explicitly resolved.

XR4: Only an explicit send dispatches a frozen verified packet through an injected qualified transport, targeting an existing thread or linked registered project. Missing or unqualified transport means Not connected — nothing sent, never synthetic success.

XR5: Runs displays durable receipts, lookup, readback and status. Unknown effects are never automatically resent; a changed session truthfully reports when keyed resolution is unavailable.

XR6: Capability holds remain visible until real qualification, activation and installation. Routine startup and refresh require no commands, TTY or password after enrollment.

XR7: Interactive choices retain their registered collection names. Stills and unavailable entries cannot be selected as interactive targets and display a reason. Source details provide an explicit Open action for an available website or prototype, preserving the current interactive destination and revealing the preview. A saved opaque source identity offers an explicit Resume action after refresh or restart; restoration alone never selects a project, opens a preview or dispatches work. Source identities and existing authoring links remain unchanged, and workspace records are never matched by display name.

XR8: An open preview is a website-first workbench. The page fills a frame sized to its logical viewport within the available width and one scrollport height, never above 100 % scale, with no native background beside it. One browser bar holds route, viewport, Browse/Pick/Cite and Capture; one fixed-height context line holds status, errors and the next-mark comment. Capture, annotations, proposal, flow and source provenance sit in an adjacent review column, or below the frame on narrow panels. Ordinary UI state does not resize the frame, because a size-changing placement fences the session. Open, Resume, capture anchoring, proposal locality and explicit Requests/Runs sending are unchanged.

<!-- codex-section:end id="spec.hq-integration-parallel-execution#req.project-experience-workflow.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ac.project-experience-source.001" -->
## Interactive Project Acceptance

Mapper fixtures cover stable host/root/project identity, bounded malformed input, hash mismatch, partial catalogs, remote URL policy and interactive-versus-still classification. Runs tests cover injected real-shaped ports, disconnected and unqualified states, explicit send, unknown lookup without resend, readback and labelled examples. Compose tests use a structural PreviewCapability fake; native tests qualify the actual preload-free browser.

One synthetic end-to-end scenario enrolls a gallery and Jones list, opens a full document, clicks through, picks/comments, captures a flow, explicitly sends through the existing qualification stub and reads the receipt. Fixtures prove source behavior only. Separate owner-approved real enrollment and native consent verify actual projects; no fixture closes a live gate.

Workbench geometry tests cover host fit, zoom conversion, `dontSetVisibleSize` on every metrics override, fencing only on fitted size changes, renderer fit without upscaling, scrollport visibility and one bounded mode retry after a host fence. Native acceptance must show desktop and phone sites filling the frame at several panel widths, in-site link navigation staying inside it, scrolled panels pausing rather than covering HQ, and unchanged capture, Pick/Cite and proposal behavior. Browser fixtures cannot verify native composition.

<!-- codex-section:end id="spec.hq-integration-parallel-execution#ac.project-experience-source.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#ctx.project-experience-operators.001" -->
## Operator Interaction Inventory

| Phase | Concrete interaction and enforcement | Readback / failure / recovery |
| --- | --- | --- |
| Source/bootstrap preparation | None for bounded source, tests and PR publication. Shared custody is reconciled in #50 before shared edits. | Exact source/check identity; preserve merge hold. |
| Enrollment | Existing authorization permits native Settings/project chooser setup; the product asks the owner to confirm each source/link. No terminal, source move or clone. | Persist bindings in private userData, restart and recheck; cancel leaves existing sources. |
| Startup and steady state | None beyond ordinary HQ launch, selection and explicit Send. Main refreshes enrolled read-only sources. | Last-good cache with freshness; failed refresh never clears data or starts work. |
| Routine diagnostics/recovery | None for read-only status/recheck. Unknown sends use lookup, never resend. | Receipts/session identity and held reasons; no automatic auth or network repair. |
| Credentials/enrollment/rotation | Jones OAuth requires native browser consent; private secret route only if needed. No token extraction. | Main-only protected storage; 401 means needs authorization. Stop on unknown consent effect. |
| Remote gallery route | Existing HTTPS/loopback policy applies. Any missing HTTPS service or SSH forwarding requires an exact host/command/data-path/verification/rollback envelope before activation. | Prepare concrete route first; no silent deployment or network change. |
| Upgrade/rollback | Existing authorized unsigned development route only; preserve profile and source provenance. Persistent updater work remains its existing owner's scope. | Exact installed manifest and process readback; revert source forward or launch retained prior build with preserved data. |
| Native simulator follow-on | Toolchain/backend qualification and device access remain separate; no build/boot is performed by this amendment. | Measure one bounded pilot before claims about cost; no signing/account/host changes. |
| Destructive/forced effects | None planned. Removal, relocation, reset, forced restart or source cleanup is not authorized. | Reject outside-scope action; preserve sources/data/services. |
| Exceptional fallback | Stop the affected capability and retain last-good state; no unmodeled privileged fallback. | Record exact failure and smallest missing approval or binding. |

<!-- codex-section:end id="spec.hq-integration-parallel-execution#ctx.project-experience-operators.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.registry-adapters.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "Implement pure Jones-project and gallery-index mappers to the existing CatalogSnapshot contract with stable host/root identity, bounded inputs, verified gallery hashes and explicit website/web-prototype/stills metadata. No network or source execution.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.project-experience-workflow.001"
  ],
  "read_scope": [
    "modules/design/",
    "apps/desktop/",
    "packages/contracts/",
    "docs/",
    "tests/"
  ],
  "write_scope": [
    "modules/design/discovery/src/adapters",
    "modules/design/discovery/test/adapters"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.project-experience-workflow.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.design-catalog-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.project-experience-source.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.registry-adapters.001"
  ],
  "affected_check_groups": [
    "hq-source-registry",
    "hq-design-local-catalog"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Root is sole Git owner; each builder writes only its literal cone. No host changes, deployment, credentials, private data or live sends.",
    "Existing T2 and composition custody must be reconciled before shared implementation. Source completion is distinct from live qualification."
  ],
  "stop_conditions": [
    "Unexpected or unowned changes, unknown prior effect, overlap or a required change outside the assigned cone."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.registry-adapters.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.registry-adapters.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.project-experience-workflow.001",
    "spec.hq-integration-parallel-execution#ac.project-experience-source.001"
  ],
  "scenario": "Implement pure Jones-project and gallery-index mappers to the existing CatalogSnapshot contract with stable host/root identity, bounded inputs, verified gallery hashes and explicit website/web-prototype/stills metadata. No network or source execution.",
  "evidence": {
    "predicate": "Focused deterministic tests pass on the exact candidate, including negative and stale cases.",
    "invalid": "Fixtures or simulated sends are presented as live operational success.",
    "unknown": "Required native runtime or private binding is unavailable."
  },
  "environment": [
    "Synthetic fixtures and task-local test storage; no private source or services."
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.registry-adapters.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.registry-adapters.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/",
    "apps/desktop/"
  ],
  "affected_check_groups": [
    "hq-source-registry",
    "hq-design-local-catalog"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.registry-adapters.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.registry-adapters-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "Integration owner qualifies the exact scoped candidate and lands only under accepted policy; read back ancestry. Merge hold remains until agreement.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.project-experience-workflow.001"
  ],
  "read_scope": [
    "modules/design/",
    "apps/desktop/",
    "packages/contracts/",
    "docs/",
    "tests/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.project-experience-workflow.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.registry-adapters.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.project-experience-source.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [
    "hq-source-registry",
    "hq-design-local-catalog"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Root is sole Git owner; each builder writes only its literal cone. No host changes, deployment, credentials, private data or live sends.",
    "Existing T2 and composition custody must be reconciled before shared implementation. Source completion is distinct from live qualification."
  ],
  "stop_conditions": [
    "Unexpected or unowned changes, unknown prior effect, overlap or a required change outside the assigned cone."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.registry-adapters-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.runs-live-dispatch.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t8",
  "objective": "Replace implicit fake-only production composition with an injected TransportPort/catalog/readback seam; disconnected by default, visibly labelled explicit examples, explicit send, durable receipt and unknown lookup without blind resend.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.project-experience-workflow.001"
  ],
  "read_scope": [
    "modules/design/",
    "apps/desktop/",
    "packages/contracts/",
    "docs/",
    "tests/"
  ],
  "write_scope": [
    "modules/design/app/sections/runs"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.project-experience-workflow.001"
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
    "spec.hq-integration-parallel-execution#ac.project-experience-source.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.runs-live-dispatch.001"
  ],
  "affected_check_groups": [
    "hq-design-app-sections"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Root is sole Git owner; each builder writes only its literal cone. No host changes, deployment, credentials, private data or live sends.",
    "Existing T2 and composition custody must be reconciled before shared implementation. Source completion is distinct from live qualification."
  ],
  "stop_conditions": [
    "Unexpected or unowned changes, unknown prior effect, overlap or a required change outside the assigned cone."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.runs-live-dispatch.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.runs-live-dispatch.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.project-experience-workflow.001",
    "spec.hq-integration-parallel-execution#ac.project-experience-source.001"
  ],
  "scenario": "Replace implicit fake-only production composition with an injected TransportPort/catalog/readback seam; disconnected by default, visibly labelled explicit examples, explicit send, durable receipt and unknown lookup without blind resend.",
  "evidence": {
    "predicate": "Focused deterministic tests pass on the exact candidate, including negative and stale cases.",
    "invalid": "Fixtures or simulated sends are presented as live operational success.",
    "unknown": "Required native runtime or private binding is unavailable."
  },
  "environment": [
    "Synthetic fixtures and task-local test storage; no private source or services."
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.runs-live-dispatch.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.runs-live-dispatch.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/",
    "apps/desktop/"
  ],
  "affected_check_groups": [
    "hq-design-app-sections"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.runs-live-dispatch.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.runs-live-dispatch-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "Integration owner qualifies the exact scoped candidate and lands only under accepted policy; read back ancestry. Merge hold remains until agreement.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.project-experience-workflow.001"
  ],
  "read_scope": [
    "modules/design/",
    "apps/desktop/",
    "packages/contracts/",
    "docs/",
    "tests/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.project-experience-workflow.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.runs-live-dispatch.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.project-experience-source.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [
    "hq-design-app-sections"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Root is sole Git owner; each builder writes only its literal cone. No host changes, deployment, credentials, private data or live sends.",
    "Existing T2 and composition custody must be reconciled before shared implementation. Source completion is distinct from live qualification."
  ],
  "stop_conditions": [
    "Unexpected or unowned changes, unknown prior effect, overlap or a required change outside the assigned cone."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.runs-live-dispatch-landing.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.source-registry-host.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-t2",
  "objective": "Implement main-only persisted source enrollment/refresh over the receiver MCP session and bounded gallery fetch; v1 catalog migration preserves preimage and generation. Wire native Settings and closed IPC under the reconciled single shared writer.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.project-experience-workflow.001"
  ],
  "read_scope": [
    "modules/design/",
    "apps/desktop/",
    "packages/contracts/",
    "docs/",
    "tests/"
  ],
  "write_scope": [
    "apps/desktop/electron/catalog-host.ts",
    "apps/desktop/electron/sources",
    "packages/contracts/src/catalog.ts",
    "apps/desktop/electron/main.ts",
    "apps/desktop/electron/preload.cts",
    "apps/desktop/src/environment.d.ts",
    "apps/desktop/src/ServiceSettings.tsx",
    "packages/contracts/src/services.ts",
    "packages/contracts/src/index.ts"
  ],
  "requires": [
    "spec.hq-integration-parallel-execution#req.project-experience-workflow.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.preview-host-landing.001",
    "spec.hq-integration-parallel-execution#task.receiver-landing.001",
    "spec.hq-integration-parallel-execution#task.registry-adapters-landing.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.project-experience-source.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-registry-host.001"
  ],
  "affected_check_groups": [
    "hq-source-registry",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Root is sole Git owner; each builder writes only its literal cone. No host changes, deployment, credentials, private data or live sends.",
    "Existing T2 and composition custody must be reconciled before shared implementation. Source completion is distinct from live qualification."
  ],
  "stop_conditions": [
    "Unexpected or unowned changes, unknown prior effect, overlap or a required change outside the assigned cone."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.source-registry-host.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#test.source-registry-host.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-integration-parallel-execution#req.project-experience-workflow.001",
    "spec.hq-integration-parallel-execution#ac.project-experience-source.001"
  ],
  "scenario": "Implement main-only persisted source enrollment/refresh over the receiver MCP session and bounded gallery fetch; v1 catalog migration preserves preimage and generation. Wire native Settings and closed IPC under the reconciled single shared writer.",
  "evidence": {
    "predicate": "Focused deterministic tests pass on the exact candidate, including negative and stale cases.",
    "invalid": "Fixtures or simulated sends are presented as live operational success.",
    "unknown": "Required native runtime or private binding is unavailable."
  },
  "environment": [
    "Synthetic fixtures and task-local test storage; no private source or services."
  ],
  "obligation_owner_task": "spec.hq-integration-parallel-execution#task.source-registry-host.001",
  "evidence_executor_task": "spec.hq-integration-parallel-execution#task.source-registry-host.001",
  "acceptance_owner": "lane-t1",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/design/",
    "apps/desktop/"
  ],
  "affected_check_groups": [
    "hq-source-registry",
    "hq-root-build"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#test.source-registry-host.001" -->

<!-- codex-section:begin id="spec.hq-integration-parallel-execution#task.source-registry-host-landing.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "lane-t1",
  "objective": "Integration owner qualifies the exact scoped candidate and lands only under accepted policy; read back ancestry. Merge hold remains until agreement.",
  "context_refs": [
    "spec.hq-integration-parallel-execution#ctx.project-experience-workflow.001"
  ],
  "read_scope": [
    "modules/design/",
    "apps/desktop/",
    "packages/contracts/",
    "docs/",
    "tests/"
  ],
  "write_scope": [],
  "requires": [
    "spec.hq-integration-parallel-execution#req.project-experience-workflow.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-integration-parallel-execution#task.source-registry-host.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-integration-parallel-execution#ac.project-experience-source.001"
  ],
  "test_refs": [
    "spec.hq-integration-parallel-execution#test.source-landing.001"
  ],
  "affected_check_groups": [
    "hq-source-registry",
    "hq-root-build"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Root is sole Git owner; each builder writes only its literal cone. No host changes, deployment, credentials, private data or live sends.",
    "Existing T2 and composition custody must be reconciled before shared implementation. Source completion is distinct from live qualification."
  ],
  "stop_conditions": [
    "Unexpected or unowned changes, unknown prior effect, overlap or a required change outside the assigned cone."
  ]
}
```
<!-- codex-section:end id="spec.hq-integration-parallel-execution#task.source-registry-host-landing.001" -->

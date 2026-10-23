# Design connector (T12 / HQD-11)

Destinations, dispatch and returned evidence for HQ Design. This section
decides **whether** and **where** a frozen request may be handed off, records
every attempt durably, and checks returned work against the exact request it
answers. It is execution-only: source discovery, request authoring and
candidate review belong to other sections.

Governing task: `spec.hq-design#task.connector.001`
(`docs/engineering-specs/design.md`, T12). Checks: `spec.hq-design#test.connector.001`.

## Status

| Area | State |
| --- | --- |
| Models, ports, outbox, evidence intake, controller | Implemented; Node tests below |
| Lifecycle projection, evidence list/subscribe/readback, pinned route, manual-route fence | Implemented (`spec.hq-expansion#task.connector-lifecycle.001`); Node tests below |
| React panel | Implemented; server-render checks in the repo (browser evidence for the expansion flow is reported with the PR, not committed) |
| Transport | **Labelled fake receiver only.** No real Jones adapter exists here |
| Real Jones existing-thread send | Not qualified — needs S1 and a public wire contract (HQD-11b) |
| New-thread eligibility | Requires existing qualification plus explicit `modes: ['new-thread']`; the control selects only. No live new-thread transport is implemented here |
| Resolve unknown | Owner-confirmed, one-use TTL fence for unknown new-thread attempts; labelled fake and flat Node tests only |
| Root composition (StoragePort, IPC, shell) | Not done; root wires the ports |

## Formats

- `hq.design.host-catalog/v1` (`src/host-catalog.ts`) — observed destinations:
  endpoint `{transport, locator}`, mode `existing-thread | new-thread`,
  identity `{hostId, receiverId, fingerprint}`, optional pinned model,
  freshness `{status, lastSuccessAt, generation}` and reachability. Strict
  parsing; other versions are rejected. Entries are keyed by opaque
  `DestinationId`, never merged by label. A late generation is ignored; a
  changed identity or endpoint is held as `identityConflict` until explicitly
  acknowledged; partial refreshes never remove entries.
- `hq.design.dispatch/v1` (`src/dispatch.ts`) — one packet × one bound
  destination with ordered attempts. States: `submitting`, `accepted`, `held`,
  `rejected`, `unknown`, `blocked`, `no-effect`. Transition table in the file
  header and `test/dispatch.test.ts`.
- `hq.design.handoff/v1` (`src/contract.ts`) — the per-attempt wire envelope.
  Its `wireDigest` is distinct from the packet's authoring `packetDigest`.
  It carries `fallback: 'forbidden'` and the pinned model.
- `hq.design.result-evidence/v1` (`src/evidence.ts`) — returned candidate
  evidence bound to dispatch, attempt, receipt and packet digest.

Digests are `sha256:<hex>` over RFC 8785 JCS (`src/canonical.ts`, golden
vectors in `test/canonical.test.ts`). This is section-local until root promotes
one shared implementation.

## Invariants

- Eligibility is not reachability. Only a transport registered as a labelled
  fake (`fake-receiver`) or one carrying qualification evidence can send. Real
  Jones is shown **Not qualified**. New-thread destinations also require an explicit declared mode.
- The owner's **Confirm send** is the execution boundary. A confirmation binds
  the packet digest and the destination identity the owner saw, is single-use
  and expires (default two minutes).
- `submitting` is durably written (compare-and-swap) before any transport call;
  if that write fails, nothing is sent.
- One live submit per packet per process (synchronous guard), and CAS across
  processes, so a double click or two windows produce one handoff.
- After the durable write, a read-only identity probe runs; a mismatch blocks
  the attempt with no send.
- Any thrown error, timeout or unrecognized result from `send` is `unknown`.
  Unknown is never resent, and no new attempt starts. On restart, leftover
  `submitting` attempts become `unknown`.
- Reconciliation can only call `lookup`. `not-found` proves nothing; only an
  authoritative `no-effect` (receiver fences the key) resolves an unknown.
- A new attempt needs the latest attempt in `rejected`, `blocked` or
  `no-effect` **and** a confirmation made after that result.
- No host or model fallback: the binding is fixed per dispatch, and ineligible
  destinations are reported, not substituted. A receipt from another host or
  model is recorded as a variance and never retried.
- Evidence is rejected unless packet ID and digest, attempt, receipt, host,
  receiver, pinned model and provenance all match. Receivers cannot claim
  `owner-judged`. Fake evidence stays labelled fake.

## Resolve unknown

`spec.hq-integration-parallel-execution#iface.resolve-unknown.001` governs the
optional transport `modes` and `fence` members. Only an explicit confirmation
can reach `outbox.resolveUnknown`. The controller opens a card explaining the
permanent fence, recording a prior run instead, and that nothing is resent.
`ConnectorPanelHost` wires both actions without host or compose changes.

A confirmation binds dispatch, attempt, idempotency key and readback generation,
with the existing two-minute default TTL. A CAS consumes that generation before
the fence, preserving one use across processes and restart without adding a
persisted field, state or basis. The result is saved by a second CAS; conflicts
are reported, never overwritten or retried. A found receipt maps to accepted or
held; authoritative no-effect names the owner-confirmed fence. Throws, timeouts,
unavailable and malformed answers leave unknown with detail. Reads, recovery,
refresh, selection and the evidence feed never call `fence`.

The fake fence retains fake provenance and never qualifies Jones. Tests exercise
controller-driven events through `ConnectorPanelHost` in a simulated DOM. Server
rendering alone cannot exercise the card interaction; neither check proves live
browser layout, Electron integration or an installed transport.

## Request lifecycle (expansion)

Governing task: `spec.hq-expansion#task.connector-lifecycle.001`
(`docs/engineering-specs/hq-expansion.md`, `iface.requests.001`). Requests keeps
its own local status/returns ports; root composition maps these types, so there
are no cross-section imports.

- `dispatchLifecycle(record, evidence, options?)` (`src/lifecycle.ts`) is a pure
  projection: no clock, no I/O, never sends. Stages: `not-sent`, `submitting`,
  `unknown`, `held`, `queued`, `running`, `returned`, `failed`, `cancelled`.
  `not-sent` also carries the no-effect resolution (`rejected`, `blocked`,
  `no-effect`, or `none`). `queued` means the receiver accepted the handoff and
  has reported no run yet. Only evidence that answers the latest attempt's exact
  receipt, packet digest, host, receiver, pinned model and provenance counts;
  anything else is listed as `ignored` with a reason. A terminal report is not
  walked back by a later `running`; conflicting terminals are flagged. A `held`
  handoff stays `held` whatever evidence says (flagged `evidence-while-held`).
  Receiver reports are claims: `returned` is not approval and not native
  verification, and fake evidence stays labelled fake.
- Send fence view: `open`, `needs-fresh-confirmation` (with the instant the new
  confirmation must follow) or `fenced` (`unresolved-attempt` /
  `already-handed-off`). There is no resend path for `unknown`.

### Evidence list, subscription and readback

- `EvidenceFeedPort` (`list`, `subscribe`) is a read-only view over the
  append-only store. The fake store (`createMemoryEvidenceStore`) implements it
  and isolates a throwing listener.
- `EvidenceReadbackPort` has only `descriptor` and `readEvidence`. It is not a
  `TransportPort`: no `send`, no `identify`. `readbackEvidence` calls it only
  when the receiver holds the handoff, re-wraps the port so nothing else is
  reachable, bounds the wait, and passes whatever returns through the same strict
  `intakeEvidence` as any other evidence. Tests use a trap port whose `send`,
  `identify` and `lookup` getters record any access, and assert zero sends,
  zero probes and zero reads of those members.
- `createLifecycleReader` lists/gets lifecycles and notifies with the
  recomputed lifecycle when evidence is appended.

### Pinned route

`pinnedRouteOf` / `lifecycle.route` show the host, receiver, fingerprint, thread
and model a dispatch is bound to, with `fallback: 'forbidden'`, the receipt's
observed host/model, variances (stored ones plus a recomputation from the
receipt, so a missing stored variance cannot hide a mismatch), and freshness and
drift against the current catalog when one is given. Drift is reported, never
repaired; a vanished destination is `destination-missing`, not replaced. No
pinned model is displayed as "No model pinned".

### Manual-route / route-switch fence

A packet that already reached a receiver through another destination, or that
the owner handed off by hand, is fenced until the owner acknowledges it:

- Manual handoff history is a read-only `ManualHandoffHistoryPort` (requests
  owns the record; composition adapts it). Pass it to `createOutbox`
  (`manualHandoffs`). An unreadable history refuses the send (`route-history-unavailable`).
- Sources are other-destination dispatches whose latest attempt is `accepted` or
  `held`, plus every manual record for the packet ID. Without an acknowledgement
  the send is refused `route-switch-unacknowledged` before anything is recorded
  or probed. This applies even with no history port, so a v1 composition can no
  longer duplicate a held packet to a second destination.
- `createRouteSwitchAcknowledgement` binds the owner's acknowledgement to one
  confirmation, packet digest and destination and lists every source shown. A
  source that appears later is not covered (`route-acknowledgement-mismatch`).
- History only adds fences. It never resolves or reopens anything: an unknown
  attempt stays `unresolved-attempt`, other destinations stay `packet-fenced`,
  and a same-destination handoff stays `already-handed-off`, acknowledgement or
  not.
- The controller shows the sources, requires an explicit acknowledgement before
  Confirm is enabled, and clears it on cancel, reselect or refresh.

### Compatibility

Existing v1 inputs are unchanged: `hq.design.handoff/v1` (wire digest separate
from the packet's authoring digest), `dispatch/v1`, `result-evidence/v1`,
`host-catalog/v1`, all enums, `EvidenceStorePort`/`OutboxStorePort`, and the
fake receiver's `calls` shape. `test/compat.test.ts` pins golden digests
computed independently of this code, the vocabularies, the public exports, a
stored v1 dispatch written before this change, and a v1 composition. Additive
changes: optional `SubmitRequest.routeSwitch`, optional `OutboxOptions.manualHandoffs`,
optional controller options and panel prop, three new refusal codes, new view
fields. One behavioural tightening, called out for the integration owner: a
second destination is refused once another destination holds the packet
(previously only an unresolved effect fenced other destinations).

## Ports for root composition

`src/contract.ts`: `OutboxStorePort` (one document per dispatch in the
`workspace` namespace, atomic CAS put), `EvidenceStorePort` (append-only),
`TransportPort`/`ReadbackPort`, `Clock`. Entry point `src/index.ts` exports
`createOutbox`, `intakeEvidence`, `createConnectorController`,
`ConnectorPanelHost` and the models. Fakes live in `src/fakes.ts` and are not
re-exported from the index. Styles: `src/connector.css` (shell tokens only).

Assumption: one outbox instance owns a store at a time (the main process).
Across processes, CAS keeps a single winner; recovery assumes the previous
owner is gone.

## Checks

From the repository root (Node 24, after `npm ci`):

```sh
node_modules/.bin/tsc -p modules/design/connector/tsconfig.json   # TypeScript 7.0.2
node --test --test-concurrency=1 modules/design/connector/test/*.test.ts
```

The connector has no Vitest config; every `*.test.ts` is covered by the glob
above and root `npm test` does not run it.

The panel test renders with `react-dom/server`; it proves markup, labels and
disabled state, not browser layout or Electron behaviour.

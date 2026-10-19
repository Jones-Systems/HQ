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
| React panel | Implemented; server-render checks only (no browser/Electron run) |
| Transport | **Labelled fake receiver only.** No real Jones adapter exists here |
| Real Jones existing-thread send | Not qualified — needs S1 and a public wire contract (HQD-11b) |
| New-thread launch | Disabled with reason — needs U1 idempotent launch/lookup |
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
  Jones is shown **Not qualified**. New-thread destinations are refused.
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
node --test modules/design/connector/test/*.test.ts
node_modules/.bin/tsc -p modules/design/connector/tsconfig.json
```

The panel test renders with `react-dom/server`; it proves markup, labels and
disabled state, not browser layout or Electron behaviour.

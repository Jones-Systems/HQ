# Design requests (T6 / HQD-05)

The request lifecycle for HQ Design: **draft → clarify → freeze → review**.
Task `spec.hq-design#task.requests.001`, checks `spec.hq-design#test.requests.001`
(check group `design-requests`). This section owns only `modules/design/requests/`.

## What it does

- **Drafts** (`hq.design.request-draft/v1`) autosave after a 400 ms debounce and
  carry the privacy label `local-unsent`. They never enter an export or a send.
  Every edit is a pure `DraftEdit` that bumps the draft revision.
- **Clarify**: asking a question moves the draft to the clarify phase. Freezing is
  blocked until every question is answered or dismissed.
- **Attachments** are stored as immutable blobs but start unselected. Only those
  the owner ticks enter a packet.
- **Freeze** writes one write-once record (`hq.design.request-freeze/v1`). It holds
  the immutable `hq.design.decision-packet/v1`, the draft-consumed marker, the
  consumed draft as recoverable history and the linked editable continuation.
  The packet carries an RFC 8785 / SHA-256 `authoringDigest`, `lineage`
  (sequence, root, parent, origin, consumed draft revision, review link) and
  `supersedes`. The connector's wire digest is a separate value.
- **Later edits** continue in the continuation draft. Freezing again creates a
  new packet linked to the previous one and leaves that packet's bytes unchanged.
  Refreezing with no changes is refused.
- **Review** of a returned candidate groups claims by level: agent-reported,
  observed and owner-judged. Before/after renders through the injected compare
  slot. Accept, revise, defer and reject are appended events. Revise starts a new draft
  linked to the reviewed packet. It keeps all original evidence and adds the
  candidate's evidence.
- **Export** (`hq.design.requests-export/v1`) includes frozen packets, review
  events, reviewed candidates and the selected image bytes. It reports every
  omitted store: drafts, draft history, unselected attachments, cache, send
  records and handoff statuses.

Freezing never dispatches. `RequestStore` has no dispatch dependency. The only
hand-off is the explicit **Send packet** button, which calls the injected
`DispatchSlot.requestSend`. The connector owns receipts.

## Storage layout (workspace namespace)

| Key | Content | Write |
| --- | --- | --- |
| `design/requests/<id>/draft` | active draft | atomic replace (autosave) |
| `design/requests/<id>/packets/<seq6>` | freeze record | write-once; the sequence slot is the compare-and-swap |
| `design/requests/<id>/candidates/<candidateId>` | reviewed candidate snapshot | write-once |
| `design/requests/<id>/review` (event stream) | review events | append-only |
| `design/requests/<id>/sends/<packetId>` | send record | write-once; one per packet, ever; durable before transport |
| `design/requests/<id>/handoff/<packetId>` | last connector status | atomic replace; never moves backward or out of a terminal state |
| blobs | attachment bytes by SHA-256 | content-addressed |

When a request is opened, interrupted operations are completed and listed in
`recovered`:

- If a freeze record exists but the draft it consumed is still stored, the draft
  is replaced by the record's continuation.
- If a revise event exists but its draft was never written, that exact draft is
  rebuilt from the stored candidate.

Stored data that fails validation or uses a newer schema opens read-only. It is
never rewritten. A write whose outcome is unknown holds all edits until
`reconcile()` re-reads storage. Reconciliation never repeats the write.

## Composition ports

Root wires these after qualification. The labelled fakes in `src/fakes.ts` stand
in until then:

- `StoragePort`: documents, write-once documents, blobs, events (store lane T9)
- `ClockPort`, `IdPort`, `SchedulerPort`
- `DispatchSlot`: connector hand-off (T12). The only member that can send.
- `HandoffStatusPort`, `ReturnsPort`: read-only status and returned-work readback (see Lifecycle extension)
- `NavigationPort`: shell navigation; receives navigation-only intents
- `CompareSlot`: a `ComponentType<CompareSlotProps>` from the compare section (T4)
- `AnnotationRef` / `SourceAnchor` (T5, types only) and `EvidenceRef` /
  `ReturnedCandidate` (T12 results) are mirrored locally in `src/contract.ts`.

Review code is removable: `src/review.ts` and `ui/ReviewScreen.tsx` render only when a
candidate is supplied, and nothing produced for a finished product depends on them.

Composition entry: `createRequests(ports)` in `src/index.ts`. UI entry: `ui/RequestsView.tsx` (`RequestsView`, plus the labelled
`CompareSlotFake`). Model entry: `src/index.ts`.

## Checks

```sh
# framework-free behavior (Node 24 type stripping)
node --test --test-concurrency=1 modules/design/requests/test/*.test.ts
# rendered markup through React's server renderer (needs the root npm install)
npx vitest run --config modules/design/requests/vitest.config.ts
# types, with the root-pinned TypeScript 7.0.2
npx tsc -p modules/design/requests/tsconfig.json
```

The rendered checks cover markup and state wiring only. They don't cover browser
layout, interaction, or the Electron runtime. The storage fake models
per-document atomic replace with crash points. It is not evidence for the real
store adapter.

## Lifecycle extension (`spec.hq-expansion#task.requests-lifecycle.001`)

Extends the first release without changing any stored v1 shape. Every v1 document
still parses and re-serialises to the same bytes (`test/compat.test.ts` replays
bytes captured from the first release).

**Reject.** `REVIEW_DECISIONS` gains `reject` after the first three, which keep
their order. A reject is an appended event only: no draft, no packet, no send.
The review-event schema stays `/v1`. A build from before this change reading a
`reject` event fails validation and opens that request read-only, which is the
existing safe behaviour for unknown stored data.

**Candidate without a comparable version.** `ReturnedCandidate.candidateVersionId`
is nullable (the key is still required, so every v1 value stays valid). With
`null` the review shows the returned artifacts and provenance, does not mount the
compare slot, and carries no invented version into a revision. A new optional
`provenance` (`origin`, `host`, `model`) is omitted on v1 inputs, so candidate
digests are unchanged. Missing host or model stays missing.

**Handoff status (read-only).** `HandoffStatusPort.read(packet)` returns an
`hq.design.request-handoff-status/v1` status: `not-sent | submitting | unknown |
queued | held | running | returned | failed | cancelled`, its `observedAt`
freshness, the pinned and the reported host/model and the destination. The last
reading per packet is stored locally for restart. A reading older than the stored
one, or one that would leave `returned/failed/cancelled`, is ignored and noted.
A non-terminal status older than 60 s shows as stale. Host/model variance is
computed only from reported values; nothing is substituted. The port has no send
method, and the session passes it nothing else.

**Returned inbox.** `ReturnsPort.list(requestId)` is read-only and untrusted:
each item is validated strictly against a frozen packet and stored write-once;
an invalid, foreign or conflicting item is skipped and reported, never
overwritten. The inbox lists every candidate newest first with its latest decision.

**Owner-reported returns.** `session.reportReturn` records what the owner says
came back outside HQ. It is stored write-once, labelled `owner-reported`, has no
comparable version, and the validator permits only `agent-reported` claims and
`note`/`capture` artifacts with the status `owner-reported`. It cannot carry
`observed` or `owner-judged` claims or `observation`/`candidate` evidence, and a
stored copy that violates this opens the request read-only. Owner judgments remain
review events. A manual return writes no send record and no status, cannot clear
an unknown handoff, and blocks a later send of that packet.

**Send gate.** `session.send(dispatch, packetId, confirmedDestinationId)` is the
only path to `DispatchSlot.requestSend`. It writes the write-once send record
first and calls transport only after that is durable. A packet is sendable once:
only the current packet, only with an `existing-thread` destination equal to the
one the owner confirmed, and not after any send record, connector status, or manual
return. A transport failure, or a record whose outcome is unknown after a crash,
leaves the packet `unknown`, which cannot be resent. `requestSend` receives a
second `SendBinding` argument; a v1 implementation that ignores it stays valid.
Retrying after a definitive failure is deliberately not offered here.

**Navigation-only intents.** `open-request`, `open-packet`, `open-returned` and
`open-runs` are closed shapes validated before they reach `NavigationPort`. The
module that emits them imports no dispatch, storage or status port.

**Golden vectors.** `test/golden.test.ts` pins the freeze body's RFC 8785 text and
SHA-256 digest, computed by an independent reference, for the composition layer to
compare with the connector's canonicalisation.

Limits: everything here is exercised against labelled fakes. It is not evidence
of a live receiver, a host catalog, thread launch, the Electron runtime or a Mac
installation, and the rendered checks cover markup, not layout.

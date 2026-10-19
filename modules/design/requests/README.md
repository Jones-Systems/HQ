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
  slot. Accept, revise and defer are appended events. Revise starts a new draft
  linked to the reviewed packet. It keeps all original evidence and adds the
  candidate's evidence.
- **Export** (`hq.design.requests-export/v1`) includes frozen packets, review
  events, reviewed candidates and the selected image bytes. It reports every
  omitted store: drafts, draft history, unselected attachments and cache.

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
- `DispatchSlot`: connector hand-off (T12)
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
node --test --test-concurrency=1 'modules/design/requests/test/**/*.test.ts'
# rendered markup through React's server renderer (needs the root npm install)
npx vitest run --config modules/design/requests/vitest.config.ts
# types, with the root-pinned TypeScript 7.0.2
npx tsc -p modules/design/requests/tsconfig.json
```

The rendered checks cover markup and state wiring only. They don't cover browser
layout, interaction, or the Electron runtime. The storage fake models
per-document atomic replace with crash points. It is not evidence for the real
store adapter.

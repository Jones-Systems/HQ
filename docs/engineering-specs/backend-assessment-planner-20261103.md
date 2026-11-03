# Backend assessment: Planner service and the Work live connection

Artifact Type: `engineering-spec`

Artifact ID: `spec.hq-backend-planner-assessment-20261103`

Purpose: Record what the Planner service, agent CLI and Work live connection were specified to do, what is
implemented and tested on `work/hq-foundation`, the disposition of the open Planner pull requests, and the B1
design that completes the Work live adapter and desktop connection.

Governing artifacts: `spec.hq-agent-cli`, `spec.hq-social-work`, `proposal.hq-work-adapter-boundary`

Decision owner: M Jones (product). The HQ integration owner holds every merge.

Consumers: HQ integration owner, the Work presentation lane (F2), Planner/CLI maintainers

Authority effect: none. This document merges nothing, deploys nothing and changes no running service.

## Summary

Bound to `work/hq-foundation` at `0cd50abc974320771cc21145dc8a8fd58a3eb8b1` (2026-11-03).

- **The Work live path already exists end to end.** The Planner service (`services/planner`, API 2 with batch,
  retention-aware replay and HQ references), the agent CLI (`tools/hq-cli`), the Work live adapter
  (`modules/work/live`), the closed main-process bridge (`apps/desktop/electron/services.ts`), main-only endpoint
  settings and the Settings "Check connection" control are all on the foundation branch. One shell test drives the
  real disposable Planner through the real bridge. The sentence in `services/README.md` saying the live adapter and
  desktop connection "remain follow-on work" is stale.
- **What is missing is resilience and visibility.** Unconfirmed writes and HQ drafts live only in memory; edits made
  while the Planner is unreachable fail and roll back; the connection check reports only reachable or unreachable;
  unavailable errors carry no reason; and real-Planner coverage stops at one lost-create scenario.
- **B1 closes those gaps** with typed connection health, a durable offline queue with compare-and-swap rebasing and
  typed conflicts, restart-safe recovery of unconfirmed writes, and a real-Planner end-to-end suite. The store
  contract additions the Work UI consumes are fixed in [Store contract additions](#store-contract-additions).
- **Eleven open Planner pull requests** (the HQR A-series) are review-and-fix passes from 2026-10-20. Their last CI
  ran against an older foundation. B1 re-verifies each on the current foundation and publishes one composite
  integration successor that preserves every original head as an ancestor. #93 needs a fix and #85 stays owner-held.

## Inventory: specified, implemented, tested

Status words: **done** (implemented and tested on foundation), **partial**, **gap**, **deferred** (owner decision
pending or explicitly later).

| Area | Specified in | Implemented | Tested | Status |
| --- | --- | --- | --- | --- |
| Planner storage, ordering, history, backups, import/export v1 | `spec.hq-agent-cli` req 1 | `services/planner/planning/store.py` | Python unittest (store, server, contract) | done; hardening in #81 |
| HTTP boundary: loopback bind, Host allow-list, mutation guards, body caps | Planner README Security | `planning/server.py`, `__main__.py` | `test_server.py` | done; hardening in #84 |
| Typed dates, validation, link safety | Planner README Design choices | `planning/dates.py`, `validation.py` | `test_dates.py`, `test_validation.py` | done; hardening in #89 |
| Batch create (`items.batch_create`) | `iface.contracts.002` | `POST /api/items/batch` | contract exchanges 15–16, CLI E2E | done |
| Retention-aware replay (`requests.replay`) | `iface.contracts.002` replay protocol | `POST /api/requests/replay`, eviction floor | exchanges 19–23, Python, CLI E2E | done |
| HQ references (`hq-references-v1`) | `iface.hq-references.001` | Planner JSON references, legacy UI text | vectors, Python, CLI, Work wire | done |
| Golden exchanges and vectors with drift check | `iface.wire-contract.001` | `services/planner/contract/` (27 exchanges) | `generate.py --check`, `test_contract.py` | done; #80 hygiene, #85 adds 28–42 (held) |
| Legacy web UI | Planner README | `services/planner/public/` | Node smoke and logic tests (fake DOM) | done; #93 client core, #102 views |
| Agent CLI | `spec.hq-agent-cli` req 2 | `tools/hq-cli` | 85 Node cases incl. `HQ_CLI_E2E=1` real Planner | done; #82, #86, #94 |
| Work port and store | `iface.work-port.001`, RW-5/8/9 | `modules/work/core` | store, conformance, parity tests | done |
| Work live adapter with replay-safe recovery | `iface.work-live-transport.001` (D) | `modules/work/live` | adapter, transcript, SHA-pinned contract copies | done |
| Desktop bridge, typed preload, main-only endpoint | `iface.work-live-transport.001` (E) | `electron/services.ts`, `service-config.ts`, `preload.cts` | `services.test.ts` | done |
| Live or labelled-example selection | E | `apps/desktop/src/services/domains.tsx` | `live-services.integration.test.tsx` | done |
| Endpoint settings and connection check | E | `ServiceSettings.tsx`, `settings/DataSources.tsx` | `ServiceSettings.test.tsx` | partial: reachable or not only (G3) |
| Work export through a native save dialog | P-7 | `electron/work-export.ts` | `work-export.test.ts` | done |
| Composite CLI → Planner → Work port → mounted UI | I | `docs/evidence/hq-agent-cli/integration.md` | recorded evidence | done (historical) |
| Durable unconfirmed writes and HQ drafts | P-4, P-5, GW-2 (G-3) | in memory only | — | gap (G1) |
| Edits while the Planner is unreachable | task brief 2026-11-03 | writes fail and roll back | — | gap (G2) |
| Typed connection health and unavailable reasons | task brief 2026-11-03 | — | — | gap (G3, G4) |
| Real-Planner coverage of every Work route | `ac.d.001`, task brief | one lost-create scenario | — | gap (G6) |
| Editable lists and multiple boards (schema v2) | D-3, P-9 | Work shows "Proposed — not available" | — | deferred (owner) |
| Item history and Planner settings editing in HQ | port `history`, `updateSettings` | port only; Review edits `stale_days` | port tests | partial (Work presentation) |

### Gaps on the current foundation

| ID | Gap | Effect | Owner in this campaign |
| --- | --- | --- | --- |
| G1 | Unconfirmed writes, the adapter's recorded intents and HQ drafts are in memory. | A restart loses them. After a restart a lost write cannot be checked (`no_intent`). | B1 (core, live, desktop); F2 adopts the drafts slot |
| G2 | A write that finds the Planner unreachable fails and its projection rolls back. | Board, detail and review edits are lost while the service is down. | B1 |
| G3 | "Check connection" maps any 2xx `GET /api/version` to Reachable and anything else to Unreachable. | A 421 from the Host allow-list, a non-Planner service and a Planner without replay all look the same. | B1 |
| G4 | `PlannerError` `unavailable` carries no reason; the store reduces every failed read to an offline flag. | The UI cannot say why it is offline. | B1 |
| G5 | Endpoint changes apply after a reload. | Deliberate: a live session never swaps its Planner. | unchanged; see G11 |
| G6 | Real-Planner tests cover one lost create. | Move, patch, archive, restore, review, settings, history, conflicts, offline and restart paths are proved only against fixtures and recorded exchanges. | B1 |
| G7 | A replay lookup answered 400 (a baseline newer than the store, as after a store swap) is reported as `unavailable`. | A misleading offline banner until the next poll; the write stays unchecked. | B1 |
| G8 | `services/README.md` and `proposal.hq-work-adapter-boundary` GW-1/GW-7 describe the live path as unbuilt. | Stale documentation. | B1 |
| G9 | The real-Planner shell test stores its SQLite under the checkout (`.t3/live-wiring/`, ignored). | Test data inside the repository tree. | B1 |
| G10 | No item history panel; week start and display zone are read-only in HQ. | Presentation scope. | F2 or later |
| G11 | Main resolves the Work address on every call, so a saved address change reaches the running session before the reload that `RELOAD_NOTE` asks for. | Until that reload, the session's polls, writes, queued sends and replay checks go to the new address. Item writes for unknown IDs fail `not_found`, and a store older than a recorded baseline answers `store_changed`, but an explicit Apply of an unconfirmed create could land on the new Planner. | Recorded for the owner. B1 binds the device document to the address it was loaded for (`binding`), so saved changes never move between addresses |

Recorded Planner findings that the HQR pull requests deferred for owner judgment (for example restoring backups over
5,000 items, unbounded backup and request-record growth, SIGTERM handling, no-op mutations bumping the state
version) remain recorded in those pull requests. B1 does not implement them without owner direction.

## Open pull request triage

Initial dispositions. Each is re-verified on the current foundation before the composite is published; the final
report records exact heads and check results.

| PR | Lane | Scope | Disposition |
| --- | --- | --- | --- |
| #80 | HQR-A4 | Contract generator and test hygiene; zero artifact bytes | Land-ready after re-verification; composite |
| #81 | HQR-A1 | Store persistence, replay retention, imports, revisions | Land-ready after re-verification; composite |
| #82 | HQR-A8 | CLI write commands and date flags (repair #152 merged in) | Land-ready after re-verification; composite |
| #83 | HQR-A10 | Planner and CLI documentation | Needs a refresh against the current foundation and B1's README correction |
| #84 | HQR-A2 | HTTP framing, error handling, bind host | Land-ready after re-verification; composite |
| #85 | HQR-A4 | Contract captures 28–42; rewrites `15-batch-dry-run` | **Held for owner acceptance.** B1 prepares the Work-live re-pin it requires; merge stays held |
| #86 | HQR-A7 | CLI transport and intent files (repair #153 merged in) | Land-ready after re-verification; composite |
| #89 | HQR-A3 | Validation, dates, link safety | Land-ready after re-verification; composite |
| #93 | HQR-A5 | Legacy client replay recovery, sync races, drag and dialogs | **Needs fixes:** it edits `public/js/ordering.js`, `dates.js` and `model.js`, which `spec.hq-agent-cli` req 3 and F acceptance keep byte-equal to Work's pinned upstream copies. A successor drops those edits and keeps the behaviour fixes |
| #94 | HQR-A9 | Test harness, check groups, reference regressions (repair #154 merged in) | Land-ready after re-verification; composite |
| #102 | HQR-A6 | Legacy client views, focus and accessibility | Land-ready after re-verification; composite |
| #161, #162 | Fleet | Design HQ-sync generation consumer and source host | Not Planner or Work. Already composed by #179; no B1 action |

Composite: one integration-successor branch from the current foundation with ordered forward merges of the
land-ready heads and the #93 successor, so each original head stays an ancestor. No history is rewritten and no
original pull request is closed or retargeted.

## B1 design: Work live connection

### Principles kept

- The renderer never sees a Planner address; main owns the endpoint and the closed route set.
- A write whose outcome is unknown is never re-sent through its ordinary route or retried automatically. Only an
  explicit Check (replay lookup) and, after a proved `not_applied`, an explicit Apply (replay resend) touch it.
- Nothing in Work can start or dispatch work.
- A live failure never selects the example Planner.

### Typed health and errors

Added to `modules/work/core/port.ts` (additive):

```ts
type UnavailableReason = 'unreachable' | 'refused' | 'server_error' | 'incompatible';
type PlannerError = … | { kind: 'unavailable'; reason?: UnavailableReason } | …;   // no reason means unreachable
type PlannerLimit = 'no_replay' | 'no_hq_references' | 'no_batch';
type PlannerHealth =
  | { status: 'ready' | 'limited'; checkedAt; api: number | null; stateVersion; features; limits; retention }
  | { status: 'unavailable'; checkedAt; reason: UnavailableReason; httpStatus? };
type IndeterminateReason = … | 'store_changed';   // the store at this address is older than the recorded baseline
interface Snapshot { …; api?: number }
interface PlannerRecovery { …; exportIntent?(requestId): RecoveryIntent | null; adoptIntent?(intent): boolean }
```

The live adapter classifies failures: no answer is `unreachable`; HTTP 403 or 421 is `refused`; a 5xx read is
`server_error`; an unexpected status or malformed body on `state` or `version` is `incompatible`. A write that may
have been applied stays `unknown` whatever the status. A replay answered 400 because the recorded baseline is newer
than the store is `replay_indeterminate` with reason `store_changed` (G7). `probePlanner(transport)` (live) reads only
`GET /api/version` and returns `PlannerHealth`; `PlannerLive.health()` calls it. Settings uses it for "Check
connection" through `plannerHealthStatus`:

| Health | Settings text | Tone |
| --- | --- | --- |
| `ready` | Reachable · Planner API 2 | good |
| `limited` | Reachable · limited (no replay, no HQ links, no batch create) | neutral |
| `refused` | Refused · start the Planner with --allowed-host for this address | bad |
| `unreachable` | Unreachable | bad |
| `server_error` | Planner error | bad |
| `incompatible` | Not a compatible Planner | bad |

### Store contract additions

Additive fields and methods on the Work store (`modules/work/core/store.ts`). Existing fields keep their meaning.

```ts
type ConnectionState =
  | { status: 'connecting' }
  | { status: 'online'; checkedAt: string; limits: PlannerLimit[] }
  | { status: 'offline'; since: string; checkedAt: string; reason: UnavailableReason };

interface QueuedWrite {
  queueId: string;            // unique across restarts
  requestId: string;          // the ID of its latest send (or reserved for the first); never reused once sent
  write: WriteOp;             // patch | move | setArchived | markReviewed | updateSettings; never create
  base: Item | Settings;      // what the user saw when making the edit: the compare-and-swap base
  queuedAt: string;
  state: 'queued' | 'sending' | 'conflict' | 'rejected';
  conflict?: { fields: string[]; current: Item | null; settings?: Settings };   // state 'conflict'
  error?: PlannerError;                                                           // state 'rejected'
}

interface WorkState {
  …;
  connection: ConnectionState;
  queued: QueuedWrite[];
  /** 'off': no durable storage (example Planner, tests); 'ok': saved on this device; 'failed': last save failed. */
  durable: 'off' | 'ok' | 'failed';
}
type SaveState = … | { kind: 'offline'; queued?: number } | { kind: 'queued'; count: number };
type WriteOutcome = … | { status: 'failed'; error: PlannerError; queued?: { queueId: string } };

store.flushQueued(): Promise<void>;                                   // "Send now"; also runs on reconnect
store.resolveQueued(queueId, 'keep_mine' | 'discard'): Promise<WriteOutcome | null>;
store.discardQueued(queueId): void;
QUEUE_LIMIT = 200; DURABLE_SCOPE_NOTE   // shown instead of UNCONFIRMED_SCOPE_NOTE when durable !== 'off'
```

Precedence of `save`: `offline` (with `queued` only when the count is above zero) before `unconfirmed`, then
`queued`, `saving`, `saved`. The count covers queued entries in every state. `saveLabel` adds `Offline · N queued`
and `N queued`; existing labels are unchanged. Without durability or the `offlineQueue` option, the store behaves
exactly as before: no queueing, and `save` never carries `queued`.

A queued write's outcome is `failed` with `error.kind === 'unavailable'` and `queued.queueId`: callers that only know
the old shape still see "not saved yet", and callers that read `queued` can say "kept on this device". Treat a
queued outcome as kept, not rolled back: the change stays projected on the board.

`connection` is `connecting` until the first read answers, `online` after any successful read or write (`limits` from
the snapshot's features), and `offline` after a failed read, or a write or Check that finds the Planner unavailable.
`since` keeps the start of the outage. A read failing with anything other than `unavailable` is `incompatible`.

### Offline queue semantics

- **Queueing.** With durability registered for the port (production live mode), a patch, move, archive or restore,
  review mark or settings write is queued instead of sent while the store is offline, and queued instead of failing
  when its send finds the Planner unavailable (known not sent). While a target (an item, or the settings) has queued
  entries, later writes to it queue behind them, so per-target order holds even online. The queued write is
  projected on the board until it is sent or dropped; entries in `conflict` or `rejected` are not projected, so the
  board shows the Planner's version there. Queued writes add no undo entry, and Undo refuses while its item has
  queued entries. Past `QUEUE_LIMIT` a write fails as before, with a notice that it was not kept.
- **Creates are not queued.** An offline capture stays an explicit HQ draft (P-5); the durable drafts slot below
  lets the capture lane keep drafts across restarts.
- **Flushing.** On the first successful read after being offline, after a restore once the Planner answers, and on
  `flushQueued()`, the store refreshes and then sends queued writes one at a time in order, each through the ordinary
  first-send path with a fresh request ID. A target whose first entry is `conflict` or `rejected` waits until the
  user resolves it. Before each send the store compares base, mine and the Planner's current version, field by field
  (compare and swap):
  - a patch conflicts only on a field the Planner changed from the base to a value other than mine; if every patched
    field already has my value it is dropped as done;
  - a move conflicts when the Planner changed the status to one other than my target, or archived or restored the
    item; an archive or restore already in the wanted state is dropped; a review mark is always sent;
  - a settings write conflicts on keys both sides changed differently; otherwise the Planner's current settings are
    sent with my changed keys applied.
  A conflict sends nothing: the entry becomes `conflict` with the field names and the Planner's current item or
  settings, and a notice names it. `resolveQueued(id, 'keep_mine')` rebases it on that current version and sends
  it; `'discard'` drops it. A Planner `revision_conflict` re-runs the comparison once; `invalid`, `not_found` and
  `order_conflict` make the entry `rejected`. A lost answer moves the write to the unconfirmed queue as today.
- **Durability.** Queued writes and unconfirmed writes, each unconfirmed one with the adapter's exported
  `RecoveryIntent`, are saved through `registerWorkDurability(port, persistence)` after every change, and an entry is
  marked `sending` and saved before it is sent. On the next start the first Work session for that Planner restores
  them: queued writes flush when the Planner answers; a write that was `sending` becomes unconfirmed (never re-sent);
  and unconfirmed writes are re-adopted into the adapter so Check and Apply work again. An intent that cannot be
  adopted is shown as `no_intent`. A replay baseline newer than the store is `store_changed`. A document that cannot
  be read is never overwritten in that session (`durable: 'failed'`).
- **Desktop storage.** A new closed `hqServices.workLocal` transport (`load`, and `save` with an expected revision and
  the `binding` that `load` returned) on channel `hq:svc:work-local`. Main keeps one JSON document per configured Work
  endpoint under `<userData>/work-local/<sha256 of the origin>.json` (directory 0700, file 0600, atomic write, 16 MiB
  cap). The renderer never learns the path or the address. The binding is an opaque token per address for the main
  process, so a session that loaded one address's document cannot write into another's after the address changes
  (G11).

### What the Work UI shows

| Store state | Suggested indicator |
| --- | --- |
| `connection.status === 'offline'`, `reason: 'unreachable'` | Offline status: "Planner unreachable", last synced time, Try again. With durability, edits stay allowed and are kept on this device ("changes kept on this device" rather than "changes paused") |
| `reason: 'refused'` | "The Planner refused this address. Start it with `--allowed-host` for it, or change the address in Settings." |
| `reason: 'incompatible'` / `'server_error'` | "This address is not a compatible Planner" / "The Planner reported an error" |
| `connection.limits` includes `no_replay` | Inline note on unconfirmed rows: they can only be read back |
| `save.kind === 'queued'` or `offline.queued` | "N changes queued on this device" chip with Send now |
| `queued[i].state === 'conflict'` | Inline on the card or row: "Changed in the Planner while offline" with Keep mine / Discard |
| `queued[i].state === 'rejected'` | Inline: the Planner's reason, with Discard |
| `durable === 'failed'` | Warning: "Queued changes are kept for this session only" |
| `unconfirmed`, `held`, `conflicts`, `notices` | Unchanged |

`connection` and `PlannerLive.health()` are also the Work inputs for the shell's observed service status
(cross-app finding X3 in `docs/design/hq-cross-app-flow-assessment-20261103.md`, lane F1): `connection` follows every
read and write the module makes, and `health()` is a read-only check for launch or focus.

## Test plan

- Unit: wire decoding of `api` and retention; failure classification; `probePlanner`; intent export and adoption;
  queue projection, ordering, compare-and-swap rebase, conflict, rejection, persistence round trip and restore;
  main-process `work-local` storage (paths, modes, atomicity, revision guard, caps, endpoint binding).
- Real Planner (always on in the foundation Vitest run; scratch under the OS temporary directory, never the
  checkout): every Work route through the actual main bridge and endpoint settings; revision and order conflicts
  against a second client; external change picked up by polling; Planner stopped and restarted; lost write checked
  and applied exactly once; queued edits flushed after reconnect with and without conflicts; unconfirmed and queued
  writes surviving a simulated restart; and Settings health against the real service.
- Planner and CLI suites run serially from `services/planner` and `tools/hq-cli` as `services/README.md` describes.

## Delivery

- `work/hq-backend-planner-20261103`: this assessment and the B1 Work live connection changes, against
  `work/hq-foundation`.
- A composite integration-successor branch for the land-ready HQR pull requests, against `work/hq-foundation`.
- A #85 successor carrying its Work-live re-pin, held for owner acceptance.

Merges into `work/hq-foundation` or `main`, deployment, installation and running-service changes are not part of
this work.

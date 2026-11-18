# HQ Work module boundary and Planner adapter: proposals for T1

Artifact Type: `design-proposal`

Artifact ID: `proposal.hq-work-adapter-boundary`

Purpose: Give the Social/Work implementation planner (T1) the Work-specific boundary, adapter semantics, gaps and questions found while designing Work.

Governing artifact: `brief.hq-work-design`; `spec.hq-social-work` at `78c3cf370b26babd09eb31140cd99e6303e3c2b9` (`iface.work-port.001`, `iface.service-bridge.001`, `req.work-*`)

Decision owner: M Jones (product), the HQ root coordinator (shared contracts), T1 (plan)

Consumers: T1, WRK-P, WRK-B, the HQ root coordinator

Authority effect: none. These are proposals. This document edits no production source, shared contract or plan.

## Bindings

| Source | Identity |
| --- | --- |
| HQ T0 candidate | `Jones-Systems/HQ` `work/hq-foundation` at `33dfe44d6786b40ac8a5dcb5442d85c20da38c67` (draft PR #2). `packages/contracts/src/index.ts` SHA-256 `41b966869d8af365a5db07afb632b7f4f8f08e9e000052c015c1e54fb00923c4`. |
| T1 plan | `Jones-Systems/HQ` `work/hq-social-work-plan` at `78c3cf370b26babd09eb31140cd99e6303e3c2b9` (PR #3), `docs/engineering-specs/hq-social-work.md` |
| Manual Planner | Private `Jones-Systems/Codex-V3` at `4beb491c44551b6e4207adcc7459c4b11407bcbc`, `apps/manual-planner/`. Source only; no data read. See the [inventory](planner-behavior-inventory.md). |

## Summary

T1's `PlannerPort`, two-adapter design, root-owned main-process bridge and
module layout fit the Planner and the mockup. **This document does not propose
a competing port.** It proposes:

- five behavior rules for the state layer (P-1 to P-5);
- two small clarifications to the port (P-6, P-7);
- one destination addition (P-8);
- the schema v2 shapes behind owner decisions D-3 and D-4 (P-9, P-10).

It also lists the real gaps.

## Module boundary (as T1 planned, confirmed)

```
modules/work/
  core/      WRK-P   port.ts (PlannerPort, types), validation, pure logic,
                     fixture adapter, conformance suite, module-level store
  views/     WRK-P   Glance, List, Calendar, Timeline, Review, Archive, By date
  live/      WRK-P   bridge adapter (after D-2)
  board/     WRK-B   status board, drag engine, move menu, keyboard model
  detail/    WRK-B   card detail panel, notes autosave, conflict UI
  capture/   WRK-B   quick capture, device drafts
  nav/       WRK-B   Work navigation, destination parsing
  index.tsx  WRK-B   ComponentType<ModulePort>
```

Work imports only `@hq/contracts` and `@hq/ui` across package boundaries. It
receives `context`, `destination`, `appearance`, `desktop` and `navigate` from
`ModulePort`. It never reads the OS theme, never touches another domain's
state, and has no execution-class call.

The **By date** board maps to T1's RV-5 Lists view. It belongs in `views/`
(WRK-P) because it is a read-only derived grouping, even though it is reached
from the board switcher. The **Weekly plan** board stays unbuilt until D-3.

## Transport (as T1 planned, with Planner-specific notes)

T0's renderer CSP sets `connect-src 'none'`. The Planner also refuses a
mutation whose `Origin` differs from `Host` (`planning/server.py:203-220`).
Direct renderer fetches are therefore impossible twice over. T1's
`iface.service-bridge.001` solves this correctly. Notes for the root's bridge
implementer:

- A main-process Node request sends no `Origin` and no `Sec-Fetch-Site`, so
  the Planner's same-origin guard passes. The bridge must still send
  `Content-Type: application/json` and `X-Planning-Request: 1` on mutations.
- `Host` must be loopback, or added to the Planner's `--allowed-host`. The
  endpoint is user-entered, kept main-only, and never committed or logged.
- Pass the caller's `X-Request-Id` through unchanged. Surface `X-Replayed: 1`
  as `replayed: true` in `WriteResult`.
- Disable redirects. Time out a mutation as `unknown`, never `unavailable`.
- The Work route set in T1 is enough for phase 1. The export routes
  (`export`, `export.md`) wait for D-2, as T1 says.

## Proposals

### P-1. Every status change is a `move`

The detail status pills and the List view's status select call
`move(id, rev, status, { place: 'top' })`, not `patch({ status })`. The server
effect is the same: a patch also puts the item at the top of the new column
(`planning/store.py:218`). The difference is undo. A move records a restore
anchor, so undo puts the card back exactly where it was. A patch-undo lands at
the top. `ItemPatch` should exclude `status` at the type level so this cannot
regress.

### P-2. Compare-and-swap field undo

An undo entry for a patch records the patched fields' **post-action values**.
On undo, the current item is compared field by field with those values:

- **Equal:** send the inverse patch at the current revision.
- **Different:** write nothing. Show *"Not undone: … was changed again since;
  the newer value was kept."*

The Planner's own client sends the inverse unconditionally
(`public/js/actions.js:90`, `:99-108`), which can overwrite another device's
edit. P-2 is a client-only change: no service change, and the same port.

### P-3. Undo stack and pending state live in the module-level store

T0 remounts a module on every domain switch. The undo stack (40 entries), the
pending projections, the unconfirmed queue and unsaved detail text therefore
live in the module-level store from T1's `iface.domain-module.001`, not in
React state. The stack is one per Work session, not per project, because
Planner items are not project-scoped. Undo entries run at most once: the toast
action and Ctrl/⌘+Z share the entry, and each removes it.

### P-4. Unconfirmed writes survive a restart, carefully

The Planner client keeps unconfirmed writes in memory only
(`public/js/state.js:23`, `:145`). HQ should persist
`{ requestId, route, body, attemptedAt }` once T1's G-3 storage member exists.
Until then the queue is in-session only, and it says so.

On re-send after a restart:

- **`patch`, `move`, archive and restore** carry a base revision. If the
  Planner's 2,000-entry replay record has been evicted, the worst outcome is a
  safe 409 `revision_conflict`.
- **`create`** carries no revision. If its replay record has been evicted, a
  blind re-send can create a duplicate. Before re-sending a create older than
  the current session, look in the snapshot for an item with the same title
  created at or after `attemptedAt`. If one exists, show *"Possibly already
  saved"* and let the user choose. Never auto-resend.

### P-5. Device drafts are HQ's own

The Planner's device drafts are stored per origin
(`planning.drafts.v1`, `public/js/state.js:12`). HQ cannot read them and must
not try: they are private data under another origin. HQ's offline captures are
separate HQ drafts. They are labelled as not in the Planner, sent explicitly,
and persisted only once G-3 storage exists.

### P-6. Port clarifications

These are small and match the current Planner:

- `create(fields, requestId)` always places the item at the top of its status.
  Name this in the port docs. HQ's inline "Add a card" composer sits at the top
  of the column for the same reason, so no create-then-move pair is needed.
- `markReviewed` and `history` are already in T1's port. In the Planner,
  "Mark reviewed" is its own explicit action (`public/js/actions.js:185`), and
  `reviewed_at` resets the staleness clock (`public/js/model.js:128`). Review's
  other one-tap actions are ordinary `patch` or `move` calls.
- The fixture adapter mirrors `order_conflict` for a missing anchor and
  `request_id_reused` for a reused ID with a different body. The mockup's
  fixture implements `order_conflict`, the revision guard, request-ID logging
  and 420 ms latency. It does **not** implement replay or `request_id_reused`.
  WRK-P's fixture must add both (T1's RW-4).

### P-7. Export and import stay with the Planner in phase 1

Phase 1 shows **Export** as a pointer to the Planner's own export, with
read-only text in HQ. After D-2, `exportJson` and `exportMarkdown` become bridge
read routes. The main process writes the bytes through a native save dialog,
unmodified (`jones-planning-export` v1). **Import and restore stay in the
Planner's own tools.** Replace-import is destructive. It is guarded there by
full validation, a `confirm: "replace"` field and a server-side backup
(`planning/store.py:386-445`, `:665-692`). Re-implementing that guard in HQ
adds risk for no gain. This is consistent with T1's RW-6.

### P-8. Destinations

T1's Work destinations are kept. Add `board/by-date` and treat T1's `lists` as
an alias for it. Reserve `board/plan/<listBoardId>` for D-3. `item/<itemId>`
opens the detail panel over the last view. Every destination passes
`isDestination` and never dispatches work. On `home`, T1 chose Board while the
Planner lands on Glance; the owner question is Q-1 in the design spec.

### P-9. Schema v2 sketch for D-3 (editable lists, multiple boards)

This needs the Planner owner's change. It is not in this campaign, and it is
described only so the decision is concrete.

- New tables `boards { id, name, position }`, `lists { id, board_id, name,
  position, archived_at }` and `placements { item_id, list_id, position }`.
  An item can be on at most one list per board.
- **Placement is not status.** Moving a card on a custom board changes only its
  placement, through `POST /api/items/{id}/place` with `{ list_id, after_id |
  before_id | place }`, guarded by a placement revision. Status, horizon and
  dates are untouched.
- Export becomes v2 with `boards`, `lists` and `placements`. A v1 export still
  imports. Clients that ignore placements keep working.
- Multi-labels, if wanted, are a separate `labels[]` field. `area` stays a
  single free-text field.

### P-10. Schema v2 sketch for D-4 (HQ references on items)

Planner references accept only `http(s)` URLs (`planning/validation.py:140`).
An HQ `ReferenceEnvelope` therefore cannot be stored losslessly today.

| Option | Effect | Recommendation |
| --- | --- | --- |
| A. Not stored (T1 default) | Cross-domain links appear only where the other domain stores them. | Phase 1 |
| B. A new reference kind `hq` with an `envelope` object, validated like `parseReference` | Lossless, exportable and Planner-owned | After D-4, with the reference-envelope owner |
| C. HQ-side link store keyed by Planner item ID | Makes HQ a second store for planning data | Avoid |

Design annotations and Jones requests stay **distinct kinds** inside option B.
A request's observed state is never written back as card status.

## Pure logic to port (behavior-compatible)

The logic to port lives in `public/js/ordering.js`, `dates.js` and `model.js`
(D-1 decides whether to import or re-implement):

- **Ordering:** `anchorsForDrop`, `anchorsToRestore`, `stepAnchors` and the
  pending-move projection.
- **Dates:** period bounds for all five precisions, ISO week parsing,
  the primary date, date state (overdue, passed, today, current, upcoming) and
  relative text.
- **Validation:** the enums, limits and URL rule from `planning/validation.py`
  and `dates.py`, including the DST-gap rejection.
- **Groupings:** Review buckets and the By date groups (`dateGroup` in the
  mockup).

The mockup contains small JavaScript versions of the ordering and date helpers
so the fixture behaves correctly. They are a design reference only. Builders
write their own TypeScript with parity tests.

## Conformance tests the port suite should include

1. A move with each anchor form, a missing anchor (`order_conflict`), a stale
   revision (`revision_conflict` with the current item) and a cross-status
   move all renumber only the target status.
2. Same request ID and same body returns the replay with `replayed: true`.
   Same ID with a different body returns `request_id_reused`.
3. A create always lands at the top. A create with a date keeps its kind and
   precision exactly.
4. P-1: the type system rejects `patch({ status })`.
5. P-2: CAS undo refuses after a concurrent same-field change and succeeds
   after a different-field change.
6. The port surface has no execution-class method. Assert the key set.
7. The By date grouping, at fixed dates, covers the today, overdue, this-week,
   coarse-period and undated cases.

## Gaps that are real today

| ID | Gap | Holds | Owner |
| --- | --- | --- | --- |
| GW-1 | The bridge (`iface.service-bridge.001`) is unapproved (D-2) and unbuilt. HQ cannot reach the Planner at all yet. | Live adapter only | Owner, root |
| GW-2 | `ModulePort` has no storage member (T1 G-3). Undo, drafts and unconfirmed writes are lost on restart. | P-4, P-5 persistence | Root |
| GW-3 | D-1 (import or re-implement the pure modules) is undecided. | WRK-P speed, not correctness | Owner |
| GW-4 | D-3 and D-4 are undecided. Weekly plan and Linked across HQ stay mock-only. | Those two features | Owner, root |
| GW-5 | "This week" boundary: ISO (T1) or Planner `week_start` (Q-3). | By date grouping | Owner, T1 |
| GW-6 | Project scope: Planner items have no project (Q-2). | Project chip behavior | Owner |
| GW-7 | Nothing here was run against a real Planner service. The fixture mirrors the cited source. Live verification needs a task-owned scratch Planner with synthetic data (T1's RX-4). | Live acceptance | WRK-P |

## Recommendations for T1

1. Adopt P-1 to P-3 now. They are client-only and cheap, and they remove two
   data-loss paths that the Planner's own client has.
2. Add P-4's create guard to the live-adapter task, and P-5's labelling to
   capture.
3. Use P-8's destinations, and keep import and restore out of HQ (P-7).
4. Reconcile the WRK-B layouts against [`mockups/work-hq.html`](mockups/work-hq.html)
   and the evidence screenshots. Treat Weekly plan and Linked across HQ as
   proposals, not acceptance targets.

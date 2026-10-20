# WRK-P evidence: Work core (`task.work-core.001`)

Authority effect: none. This is lane-local continuity and evidence for `spec.hq-social-work#ac.work-core.001`. Checks listed here are local runs, not CI.

## Lane binding

| Item | Value |
| --- | --- |
| Lane | WRK-P (Work planner), Claude Opus 5.5 at high effort, no descendants, no model or provider switch |
| Model-selection mode | `claude_frontier` from `explicit_workstream` (read-only `status`, preference revision 1; nothing written) |
| Repository and branch | `Jones-Systems/HQ`, `work/hq-work-planner`, its own linked worktree |
| Base | R1 `cfdab378e28940662ddb6e731264afca164a1957`; accepted foundation `35f9a3e` is an ancestor |
| Parent PR | #3 (`work/hq-social-work-plan`), head `d5a34d74b3474fa8d259c4230e58f7f50ee505a5`, which adds only R0/R1 evidence and work-note lines on top of R1 |
| Plan | `docs/engineering-specs/hq-social-work.md` at R1, read through the section reader |
| Released scope | `modules/work/core/**` and this directory only |

## Guidance read at startup

- **Codex V3 root `AGENTS.md`.** Read in full (445 lines). Commit `4beb491c44551b6e4207adcc7459c4b11407bcbc`, blob `3402719bc3a09e7e08ed113425d7137818eda25c`, 30,716 bytes, SHA-256 `1238a90adbf10ea8f2359f90ed0c7bf99fc1121589dcde5b99881fd247e87ce6`. All four identities were rechecked against the checkout.
- **Guides loaded on trigger:** temporary test and scratch practice; the model-selection precedence section; the CPU telemetry skill; the section reader skill; the `codex-v3-builder` profile text, carried in the prompt only. The profile's isolation is not enforced by the native launcher, so none is claimed.
- **HQ.** `AGENTS.md`, `CLAUDE.md`, `docs/engineering-specs/hq-bootstrap.md` and `docs/design/hq-shared-foundation.md`. There are no nested `AGENTS.md` files on the touched paths.
- **Shared enrollment.** `.agents/shared-guidance.md` is absent on this baseline, so shared enrollment is **unavailable**. Nothing was installed.
- **Plan sections read at R1:** `task.work-core.001`, `iface.work-port.001`, `req.work-core.001`, `req.safety.001`, `ctx.d1-import.001`, `ctx.work-design-binding.001`, `ac.work-core.001`, `test.work-core.001`, `ctx.launch-preflight.001`, `ctx.change-surface.001`, `ctx.stop-recovery-delivery.001`, `iface.references.001`, `iface.service-reference-extensions.001`, `iface.domain-module.001`, `req.work-views.001`, `req.references.001`, `ctx.check-catalog.001`, `ctx.test-plan.001`, `ctx.lane-capsules.001`.
- **Other inputs.** The R0/R1 evidence blobs at `d5a34d7` (`a8b68053…`, `998f540c…`). T4's `docs/design/work/` at `1bb550de4069ff6b0e1666844896b1a6c2cb03e9`. T4 is design input only; its mocked statuses are not service proof.

**Conflicts, and how they were resolved:**

1. V3's default is to delegate to sub-agents. The explicit owner rule of no descendants governs, so all work was done in this one thread.
2. V3's default delivery includes merge. The merge hold governs: this lane publishes one PR and does not merge.
3. The task's literal `write_scope` is `modules/work/core`. The launch also releases `docs/evidence/hq-social-work/work-planner/**`, and the writer map assigns it to WRK-P. Both paths are used.

## D-1 import binding

The bytes were bound independently before the copy, from the Codex V3 checkout at `4beb491c…`. Each Git blob, SHA-256, size and last-change commit `41503af8f1d143de54063ee70effb00ffdd399b1` was checked, along with the MIT `LICENSE` and the source's own `provenance.json`. All of them match `ctx.d1-import.001`.

The files were copied with `git cat-file blob`. `git hash-object` on the copies reproduces the source blob IDs. No other private file was copied. Interface research read these Git objects only: `planning/validation.py`, `planning/dates.py`, `planning/store.py` and `planning/server.py`. No data, SQLite store, backup or live instance was opened.

## What the core provides

All paths are under `modules/work/core/`. Consumers import from `index.ts`.

| File | Contents |
| --- | --- |
| `types.ts` | RW-1 item model and enums; `Settings`; `NewItemFields`; `ItemPatch` (no `status`, enforced at the type level); `ItemReference` with the `hq` variant; `HQ_REFERENCES_FEATURE`; `LIMITS` |
| `port.ts` | `PlannerPort`, `Snapshot` (with `features`), `WriteResult`, `Anchor`, `PlannerError`, `PlannerPortError`, `PLANNER_PORT_KEYS`, `plannerErrorOf`, `isRequestId`, `newRequestId`. There are no execution, export, import or backup members. |
| `validation.ts` | A hand-written mirror of the Planner's validation, with the service's messages and field names: `normalizeFields`, `normalizeSettings`, `isSafeUrl`, `isValidTimezone`, `wallTimeToInstant` (DST gap → null; an ambiguous time resolves to its first occurrence), `checkPeriod`, `stripDerived` |
| `planning.ts` | Wrappers over the upstream logic, plus re-exports: `plannerToday` (the zone comes from settings), `weekBounds`/`plannerMonthGrid` (honor `week_start`), `reviewBucketsFor`, `statusOrder`, `restoreAnchor`, By date `byDateGroup`/`groupByDate`/`BY_DATE_GROUPS`, and the filters |
| `store.ts` | `createWorkStore(port)` and `sharedWorkStore(key, create)`. Details follow this table. |
| `hook.ts` | `useWorkState(store, { pollMs })`. It loads on first use and polls the version while the document is visible. Unmounting stops polling and keeps all state. |
| `fixtures/adapter.ts` | `createFixturePlanner()` returns `{ port, control }`, an in-memory stand-in for the service. Details follow this table. |
| `fixtures/faults.ts` | `withFaults(port)`: lost response, drop, deferred delivery and `unavailable`, for tests and previews |
| `fixtures/examples.ts` | Fictional example items, dated relative to a given day |
| `upstream/manual-planner/` | The three verbatim copies, hand-written `.d.ts` siblings and `PROVENANCE.md` |

**`store.ts`.** The store is module-level, so it survives T0's remount on a domain switch. It provides:

- optimistic projection with rollback;
- per-item serialized writes;
- save states (`saveLabel`: Saving… / Saved · time / N unconfirmed / Offline · not saving);
- conflicts, notices and an in-session unconfirmed queue;
- a 40-entry undo stack whose entries are consumed once.

Status changes go through `move` only. Undo of a field patch is compare-and-swap; it re-checks once against the current item after a stale-revision conflict. Undo of a move restores the exact neighbor anchor, and undo of a create archives the item.

**`fixtures/adapter.ts`.** It mirrors `store.py` at the D-1 commit:

- revision guard, `revision_conflict` (with the current item), `order_conflict`;
- top-of-status create, and target-only renumbering without neighbor revision bumps;
- no-op moves and archives;
- a `state_version` increment on every successful mutation;
- history;
- **actual replay** (`replayed: true`) and `request_id_reused`, with a 2,000-ID FIFO record. Failed calls record nothing.

Derived `instant`, `end_instant` and `tz_abbr` are added on read. The `hq` reference variant is accepted only when the fixture's `features` include `hq-references-v1`.

**Reconciliation (RW-9) as built:**

- An `unknown` write stays unconfirmed, with its projection kept and marked. It is resolved only by re-sending the stored request ID and body:
  - a replay confirms it;
  - a first apply confirms it;
  - a conflict is removed from the queue and shown as "may or may not include your change";
  - `request_id_reused` holds the whole queue until the entry is dismissed.
- `patch`, `move`, archive and review carry a revision, so they are re-sent automatically on poll.
- `create` and `updateSettings` carry no revision. They are re-sent automatically only while the replay record is provably kept: the fresh `version()` minus the base version is below 2,000. Past that point the entry becomes `awaiting_decision`, and only an explicit `retryUnconfirmed` re-sends it.
- Snapshot contents never resolve an entry. A same-title item created since the attempt is listed in `possiblySavedIds` as a flag only.

## Checks (local, this worktree, 2026-10-20)

Telemetry admission was taken before each test or build command. The samples read 8.75% to 19.94% CPU used, 40.06 to 43.62 GiB available, and a serial ceiling of 1.

The first `npm ci` in this fresh worktree added 149 packages from the unchanged lockfile. The dependency, lockfile and root configuration are untouched.

| Command | Result |
| --- | --- |
| `npx vitest run modules/work --no-file-parallelism` (the projected `work-module` group: `modules/work/**/*.test.ts(x)`) | 7 files, 194 tests pass |
| `npx vitest run --no-file-parallelism` (full discovery) | 12 files, 222 tests pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass. Output went only to the ignored `apps/desktop/dist/` and `dist-electron/` directories. Removing them was blocked by the host's destructive-command guard, so they remain, ignored and uncommitted. |
| `tsc --ignoreConfig --strict --skipLibCheck false … upstream/manual-planner/*.d.ts` | Pass. Root `skipLibCheck` skips `.d.ts` bodies, so the declarations were checked separately. |

One earlier `npm test` used Vitest's default parallel file workers; it also passed (222 tests). Every other run, including the final ones above, was serial.

The test files are `upstream-integrity.test.ts`, `validation.test.ts` (with `parity-cases.ts`), `planning.test.ts`, `conformance.test.ts`, `store.test.ts` and `hook.test.tsx`, all under `modules/work/core/test/`.

**Acceptance mapping (`ac.work-core.001`):**

| Requirement | Where it is tested |
| --- | --- |
| Parity for every enum and limit, each date precision, time/zone and DST-gap rule, and the URL rule | `validation.test.ts`: 100 field cases and 8 settings cases |
| Ordering, `week_start` periods, review buckets and filters | `planning.test.ts` |
| T4 conformance cases 1–6 | `conformance.test.ts`. Case 4 is a `@ts-expect-error` that `tsc` verifies. |
| T4 conformance case 7, By date at fixed dates under both `week_start` values | `planning.test.ts` |
| Same-request reconciliation, possibly-saved flag, exact undo anchors, consume-once undo and CAS undo | `store.test.ts` |
| Remount survival | `hook.test.tsx` |

**Planner-rule oracle.** The test intent says expectations must not be derived from the TypeScript. Every parity expectation was written from the Python rules. They were then run through the Planner's own `normalize_fields` and `normalize_settings`, executed in memory from the Git objects at `4beb491c…` with the deterministic id generator. Nothing private was written to disk. Result: **108 cases, 0 mismatches**, on the host's Python 3.13.5.

The proposed `hq` cases have no service implementation and cannot be checked this way; they are labeled proposed-schema behavior.

**Mutation checks**, each restored afterwards. Each mutation was caught by the intended test:

- removing the replay-window guard;
- removing the CAS refusal;
- reporting replays as `replayed: false`;
- disabling the possibly-saved flag.

## Known gaps (not claimed)

- **Time zone membership is host-dependent.** HQ accepts a case-exact IANA name known to the runtime's ICU database. The service checks its own host's zoneinfo, which differs at the edges: this host's Python lacks some backward aliases and accepts `Factory`/`localtime`. The service stays authoritative.
- **Python-only edge forms are not mirrored.** The client is stricter on Unicode digits in date values and on bracketed-host validation. It treats `[]`/`{}` as empty where the service's `or` default does.
- **`tz_abbr` from the fixture uses ICU short names.** For example, `GMT+1` appears where Python says `CET`. This is display-only fixture data.
- **`WriteResult.changed` is the item list the port contract defines.** A live adapter must derive it, for example by reading back the snapshot, because the service returns field names.
- **Out of scope here:** RW-10 HQ device drafts (owned by capture), the live adapter and bridge (D-2 is unapproved), views, D-3 lists and boards, and persistence across restart (G-3). The unconfirmed queue says it is session-only (`UNCONFIRMED_SCOPE_NOTE`).
- **No CI** is configured on this base. Native Electron and the installed app are unverified. There is no independent review; self-review only.
- **The affected-check claim is a projection.** `tests/check-groups.toml` is Design-owned, and the proposed `work-module` group is not integrated. The literal globs above were run instead.

## Deferred findings (recorded, not implemented)

- **P3.** The move-undo compare-and-swap checks status only. A same-status reorder by another device is overwritten by the restore anchor; the revision guard catches only a stale local view.
- **P3.** The projected `archived_at`/`reviewed_at` for an in-flight write takes a fresh timestamp on each recompute. It is display-only and replaced on confirmation.
- **P4.** `sharedWorkStore` entries live for the session, with no disposal. This is intended for one Work session per window.

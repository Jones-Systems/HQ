# @hq/design-store (T9 / HQD-08)

A Node-only, file-backed `StoragePort` for HQ Design. Root integration wires it into the Electron
main process and typed IPC; renderer code never imports this package. It covers task
`spec.hq-design#task.store.001`. It is a first deliverable, not proof of the integrated or
installed app.

## What it provides

- **Namespaced documents.** Each document is written to a temp file, fsynced, renamed into place,
  and then its directory is fsynced. Every write increments a revision, and `expectedRevision`
  gives optimistic concurrency. Values are RFC 8785 canonical JSON with a SHA-256 digest, checked
  on every read.
- **Multi-document transactions** (`commit`). Each new document is first written to a fsynced
  staging file. One manifest is then published by an atomic rename; that rename is the commit
  point. When a read-write store opens, it finishes any committed manifest and discards staging
  files that have no manifest. Read-only opens show such a transaction as applied, without writing
  anything.
- **Content-addressed blobs** (`sha256:<hex>`). If you pass `expectedDigest` and the bytes don't
  match, the blob is rejected and nothing is written. Every read re-checks the digest.
  `deleteBlob` works only in evictable namespaces; authoritative blobs are immutable.
- **Append-only event streams.** Records are canonical JSON lines linked by a hash chain, and each
  append is fsynced before it is acknowledged. A `clientEventId` makes an append idempotent:
  replaying the same payload does nothing, and a different payload is a conflict. Projections fold
  the events and save checkpoints, which are rebuilt if the reducer version or the chain anchor no
  longer matches.
- **Fail-closed journals.** If a stream ends in a torn line, or has a broken link before the end,
  it refuses new appends and is never truncated automatically. `repairTornTail` is a separate,
  explicit action: it saves the original bytes under `quarantine/` and then removes only the
  incomplete last line.
- **Storage classes.** `workspace` is `authoritative`: corruption is reported and never silently
  repaired. `cache` is `evictable`: it has a byte budget, evicts the least recently used items,
  and treats a corrupt entry as a cache miss. Cache eviction never touches workspace data.
  `adoptBlob` copies a cached digest into workspace before eviction can drop it. Bundles,
  exports and backups (owned by imports) must exclude evictable namespaces.
- **Generations and migrations.** `CURRENT` points at the live `generations/gNNNNNN`. To migrate,
  the store:
  1. copies the live generation into a snapshot under `snapshots/`, recording a digest for every
     file;
  2. writes a durable `MIGRATION.json` marker;
  3. runs each `n → n+1` step on a working copy;
  4. switches `CURRENT` atomically.

  If a migration fails, the live generation is checked against the snapshot and restored
  byte-for-byte if it differs. A crash mid-migration is resolved the same way on the next open.
  Snapshots and failed working copies are kept; nothing is pruned or truncated automatically.
- **Future schemas.** If the stored schema is newer than `schemaVersion`, the store opens
  read-only. It takes no lock, runs no recovery and no migration, and makes no filesystem writes.
  An unknown layout or pointer format is rejected without any write.
- **Single-writer lock.** The lock file is written in full, then hard-linked into place. A lock
  whose process is gone is reclaimed. Read-only opens skip the lock.

## Use

```ts
import { documentKey, namespaceId, openFileStore } from './src/index.ts';

const { store, report } = await openFileStore({ root: '/absolute/path/to/design-store', schemaVersion: 1 });
await store.putDocument(namespaceId('workspace'), documentKey('projects/p1'), { title: 'Example' });
await store.close();
```

`src/contract.ts` holds the section-local port types proposed for promotion to `@hq/contracts`.
`src/fault-fs.ts` is a **labelled test fake**. It models a process kill (calls that finished stay
visible; a crashing write can be torn) and records the order of fsync, rename and other calls.

## Checks

Run from this directory with Node 24. These checks aren't in the root `npm test` yet.

```sh
node --test --test-concurrency=1 test/*.test.ts
tsc -p tsconfig.json   # TypeScript 7.0.2; needs @types/node (installed at the HQ root)
```

- `crash.test.ts` crashes every mutating filesystem call of a document replace, a multi-document
  transaction, a blob write, an event append and a cache write, both clean and torn. After each
  crash it reopens the store and requires exactly the old state or the new state. It also crashes
  recovery after each commit crash point, and crashes first-time initialization.
- `kill.test.ts` SIGKILLs a real child writer process before every mutating call of a put, a
  commit and an append.
- `migration.test.ts` covers a successful migration with a retained snapshot; a failed migration
  that restores exact v1 data; restoring from the snapshot after live damage; a missing step being
  rejected without writes; and a crash at every migration call.
- `readonly.test.ts` checks that a future-schema store opens read-only with zero mutating calls
  and unchanged file contents and mtimes, and shows the pending-transaction overlay.
- `blobs.test.ts`, `events.test.ts`, `documents.test.ts`, `lock.test.ts` and `jcs.test.ts` cover
  the remaining invariants, including the RFC 8785 golden vectors.

## Not proved here

- **Power loss.** The fault fake models a process kill, not lost unsynced data. Fsync ordering is
  checked from the call trace instead. On macOS, `fsync` does not issue `F_FULLFSYNC`. Where a
  platform can't fsync a directory, `health().directoryFsync` reports `unsupported`.
- **Not yet built:** main-process/IPC wiring, the Electron runtime, the Mac filesystem, and
  multi-process lock contention beyond stale-PID reclaim. SQLite is deferred until after S2.
- **Disk use.** A migration keeps the old generation, the snapshot and any failed working copy.
  Deleting any of them is a separate, owner-authorized retention decision.

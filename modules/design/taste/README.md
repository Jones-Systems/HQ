# HQ Design · Taste (T7 / HQD-06)

Clean-room taste journal, profile and rating controls for HQ Design. Plan:
`spec.hq-design#task.taste.001`, context `#ctx.taste.001`, checks
`#test.taste.001` in `docs/engineering-specs/design.md`. Built from the public
plan only, with synthetic fixtures. No legacy engine code or data was opened or
copied.

## What is here

| Path | Side | Purpose |
| --- | --- | --- |
| `src/contract.ts` | shared | Branded IDs, taste events, journal record, ports, profile and snapshot shapes. Section-local until root promotes it. |
| `src/jcs.ts` | shared | RFC 8785 canonical JSON used for record hashes, payload digests and exports. |
| `src/events.ts` | shared | Strict event parsers. Unknown keys, out-of-range values and "overall description" are rejected. |
| `src/journal.ts` | main | Append-only, hash-chained JSONL journal with single-writer lock, sync before acknowledgement, `clientEventId` idempotency and fail-closed handling. |
| `src/service.ts` | main | Domain rules (supersede, ID reuse, references) run inside the journal's serialized append; exposes the `TasteClientPort` shape. |
| `src/node-file-system.ts` | main | Node `TasteFileSystem` adapter and `node:crypto` SHA-256. |
| `src/profile.ts` | shared | Pure projection, profiles, sample-limit labels and profile export. |
| `src/flags.ts` | shared | Feature flags; guidance and legacy reuse are fixed off. |
| `src/fake-file-system.ts` | test/review | **Labelled fake**, in-memory and fault-injecting. Not durable. |
| `src/web-digest.ts` | renderer | WebCrypto SHA-256 for renderer-side fakes. |
| `src/ui/` | renderer | `TastePanel` rating controls, pure view-model and styles. |
| `preview/` | review only | Browser harness over the labelled fake. Delete freely; nothing imports it. |

Entry points: `src/index.ts` is renderer-safe (no Node imports);
`src/main.ts` is for the main process.

## Journal format

One record per line, each line the JCS form of
`{v:1, seq, prev, clientEventId, recordedAt, payloadDigest, payload, hash}`.
`payloadDigest` is SHA-256 of JCS(payload); `hash` is SHA-256 of JCS(record
without `hash`); `prev` is the previous record's hash (64 zeros for the
first). On open every line is checked: UTF-8, JSON, exact canonical bytes,
schema, contiguous `seq`, `prev` link, both digests and unique
`clientEventId`. A final line without its newline is a torn append.

Any fault leaves the journal **fail-closed**: the verified prefix stays
readable, appends are refused, and the file is never truncated, repaired or
rewritten. Recovering a fail-closed journal is an owner decision and is not
implemented.

An append is acknowledged only after `write` hands over every byte and `sync`
succeeds (plus a directory sync the first time the file is created). A short
write, throw or failed sync fails the journal closed and is not acknowledged.
Because replay is idempotent, an unacknowledged command can be resent after
reopen: the same `clientEventId` with the same payload returns `duplicate`; a
different payload returns `conflict` and writes nothing.

The lock is an exclusively created file holding an opaque token, pid and time.
A second writer gets `locked`. A stale lock is reclaimed only when the caller
asks and the holder is provably gone (`ESRCH`); an unknown holder counts as
alive.

The hash chain detects edits, removals and reordering inside the file. It
cannot detect a complete rewrite with recomputed hashes; anchoring the exported
`journalHead` elsewhere is a root/owner decision.

## Taste semantics

- **Scopes.** General taste and each project's taste are separate. A project
  feeds the general profile only after an explicit
  `project-contribution.set {contributesToGeneral: true}`; setting it false
  removes it again. A project profile never reads general entries.
- **Liking versus description.** `liking` answers "how much do you like it";
  `descriptive` answers "how strongly does it show this quality" and must
  target an aspect. They never share a summary.
- **Ratings.** Overall and per-aspect, integers 1–5. A re-rating must name the
  current assessment in its slot (scope, subject, judgment, target); a stale or
  missing supersede is rejected. History is preserved and counted as
  `superseded`.
- **Notes and counterevidence** are separate events. Counterevidence attaches
  to a judgment and target and is counted per summary, never averaged away.
- **Sample limits.** Every summary and profile carries
  `sample {limited, count, threshold, label}`. Under the threshold (default 5)
  the label reads, for example, `Limited sample: 2 ratings, fewer than 5`.
- **Imported examples** are `example.imported` events. They can carry ratings
  claimed by their source, are listed and counted separately
  (`importedExamples.ownerJudgment: false`) and never enter statistics.
- **Export** (`hq.design.taste-profile-export/v1`) is the JCS profile plus a
  SHA-256 digest. Notes and counterevidence are excluded unless chosen; history,
  imported example content and the journal itself are always omitted and listed
  in `omitted`.
- Saving a rating only appends. Nothing changes model defaults or activates
  guidance.

## Flags

`DEFAULT_TASTE_FLAGS = {ratingControls: true, automaticGuidance: false,
legacyJournalReuse: false}`. The plan amendment to `ctx.taste.001` replaces the
original blanket "UI off" with renderable rating controls for owner
acceptance; the other two stay off and are typed as `false`.
`resolveTasteFlags` ignores and reports attempts to enable them. Mounting the
panel in the HQ shell remains root's integration step (owner disposition C1).

## Integration notes for root

- Main: open `TasteJournal` with `createNodeTasteFileSystem()`, `nodeSha256`, a
  clock and root-chosen paths in the editable `workspace` namespace (not
  `cache`). Wrap it in `TasteService` and expose `snapshot`, `submit` and
  `exportProfile` over a typed channel. Validate inbound values with
  `parseTasteCommand` / `parseExportOptions`.
- Renderer: mount `TastePanel` with a `TasteClientPort` adapter, the
  current `ProjectId` (or null) and a `TasteSubject` bound to an exact version.
- A thrown `submit` is shown as unknown and offers a retry of the identical
  command; the journal's idempotency makes that safe.

## Checks

From the HQ repository root:

```sh
node --test --test-concurrency=1 'modules/design/taste/test/*.test.ts'
npx vitest run --config modules/design/taste/vitest.config.ts
npx tsc -p modules/design/taste/tsconfig.json
```

`node --test` covers the journal, Node adapter (in a removed temporary
directory), profile semantics, flags and view-model. Vitest checks
server-rendered markup; it does not prove browser layout or interaction.

Review harness: `npx vite --config modules/design/taste/preview/vite.config.ts`
serves the panel at `http://127.0.0.1:5187/` over the labelled fake.

## Not done here

- Differential conformance against the old engine (needs public-safety
  approval or an owner decision).
- Reuse of any legacy journal (fixed off).
- Fail-closed recovery tooling.
- Electron/IPC wiring, shell mount and installed-app evidence (root).

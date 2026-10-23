# Design reference provider

`createDesignReferenceProvider(reads, now): ReferenceProvider` implements the landed
canonical contract for `project`, `version`, `request`, and `reference`. It has no
registration, persistence, navigation or execution capability. CL1b owns its later
app export and integration adapters.

`DesignReferenceReads` supplies `list(projectId)` and
`read(kind, entityId, projectId)`. Records are current authoritative projections,
with explicit project membership, stable identity, title, optional revision and
workspace, archive state and an optional T14 destination. This is a projection
boundary, not a new store. The integration adapter owns mapping lane records
(including reference uses and tombstones) and resolving moves. A stale or partial
read must report `unknown` or `unavailable`; only authoritative absence is `missing`.
Search errors propagate so callers can distinguish failure from an empty result.

Search filters project, kind, case-insensitive title and positive safe-integer
limit, deduplicates identities, and omits archived, malformed or unopenable records.
It returns fresh canonical envelopes, without mutating existing source snapshots.
Resolution compares title and any supplied source revision. If a snapshot revision
cannot be compared, status is unknown. Archived records remain archived; a changed
project is reported as moved with `targetProjectId`, leaving project-switch handling
to the shell. Failed reads are unavailable. Every resolution receives a new
`observedAt` from the injected clock after the read.

Destinations must round-trip exactly through the existing T14 parser/formatter.
No entity routes are invented. Destinations are omitted for missing, archived,
forbidden, unavailable or unknown targets. T14 syntax validity does not claim that
a later section descriptor or entity-selection route has been mounted.

Synthetic tests cover all four kinds, all eight statuses, query bounds, failures,
T14 destinations, source-byte preservation, and write/execution recorders. A static
runtime import walk checks renderer safety. No runtime registration or reference
round-trip qualification is claimed.

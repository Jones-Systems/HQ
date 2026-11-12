# HQ updater qualification

Artifact Type: acceptance-record
Artifact ID: acceptance.hq-updater-source-20261112
Purpose: Record compatibility, diagnostic retention and refusal provenance repairs, keeping portable source evidence distinct from native and operational acceptance.
Consumers: HQ updater maintainer and integration owner
Authority effect: none

## Source and integration boundary

The receiving source is foundation `8945d156585510fbdf1515fad01798f416146b4e`.
[Updater #141](https://github.com/Jones-Systems/HQ/pull/141) includes
[signing #142](https://github.com/Jones-Systems/HQ/pull/142); signing merge
`ed7af03c3be21a909bf1a0e7cc1464308724dcec` is an ancestor of this foundation.
The separate [foundation-to-main PR #2](https://github.com/Jones-Systems/HQ/pull/2)
retains its combined-runtime acceptance hold. The original #212 repair targets
foundation; the refusal-provenance child targets #212's branch. Neither promotes
foundation to main nor accepts other product lanes.

## Compatibility repair and evidence

At the receiving source, `node tools/updater/packaging/compatibility.cjs`
refused four unregistered persistence references. Reviewing the registered
sources also found five changed store fingerprints since registry revision
`f7f84e104ae1db90492513014faa3942db2437a4`:

- Wiki now refreshes indexes in background generations and bounds snapshot retention.
- Sources includes immutable generations, binding custody and retained-byte storage.
- Design includes enabled storage construction, import routes, the Taste journal and refreshed Compare versions.
- The service contract includes import and source-generation routes.
- Renderer persistence moved from `App.tsx` into `PresentationShell.tsx`.

The registry now includes `PresentationShell.tsx` among profile writers.
The browser preview's `environment.ts` installs memory-backed local/session
storage before `main.ts` imports and invokes `mount.tsx`; the preview build
script writes its explicit artifact directory. Those three files are registered
with that non-profile ownership explanation. No discovery exclusion or
compatibility guard was relaxed.

Reviewed store fingerprints produce the new epoch
`hq1-8f6fcfeb0959d23a6e113502e48d9a78c2eb896d432375c042e369813fc3717c`
with 143 registered sources. This deliberately refuses an ordinary update
across the previous epoch. It does not establish a migration or compatibility
with a previously installed profile. A later foundation change must pass the
same source inventory and fingerprint checks again.

Portable verification on Node **24.19.0** passed all **139** updater/package
tests, with **zero failures, cancellations or skips**, after the registry repair:

```sh
node --test --test-concurrency=1 tools/updater/test/*.test.cjs tools/updater/packaging/test/*.test.cjs
node tools/updater/packaging/compatibility.cjs
git diff --check
```

The first command covers installer/bootstrap, journal interruption, exact
process leases, binary recovery, profile-write preservation, signed-policy
refusals, package layout and the synthetic native scenario plan. Its native
adapters are synthetic. It does not execute macOS installation or prove a
cryptographic signature. Root renderer compilation and full source discovery
remain the receiving PR's required CI obligations.

## Native failure and diagnostic retention

Root independently qualified the unchanged inventory source at candidate
`493035cf60355735816a3a95448f6cfc00f7544b`: one ARM64 compile and one production
adapter call returned `complete:true`, processCount 935, exit 0, with child,
process-group, EOF and owned-root closure. This is a source/host-point proof;
fresh complete inventory is required for each later native journey.

The subsequently authorized single ARM64 package/journey attempt at that source
produced strictly verified archive SHA256
`35620cef47c18ab8cb9465e953cfc4fb644af600844d1dfffb3dbf28b56de53a`.
Storage admission and complete prelaunch inventory passed. Installer exit 0
proved handoff only: the first lifecycle commit wait failed after 49.86 seconds
of native execution, with **0/10 checks** and the second scenario unreached.
Process, group, EOF and lock custody closed and source remained clean. This
archive is evidence for that failed source-point attempt, not a package for
the diagnostic repair or a native-ready candidate. Its causal records were
removed during guarded cleanup, so the native cause remains **unproved**.
Preserve the original failed result; no timeout, production algorithm or
compatibility guard is changed by this repair.

The portable VM seam reproduced code-zero installer handoff followed by a
noncommitted journal and the unchanged 45-second wait. Before this fix it
failed because cleanup inventory began without a primary diagnostic snapshot.
The harness now writes one exclusive `native-smoke-primary-failure.json` in
the invocation's package output, outside `hq-native-*`, **before** drain/removal.
It binds source/tree/archive, active scenario/journey/build sequence, projected
journal phase/sequence/resume state/reason, launch/profile/health flags and
finite fixture helper/bootstrap/main/renderer milestones or explicit unavailable
results. A synthetic bootstrap wrapper observes the unmodified production
function, including failures before main import. Installer stderr is reduced
to an observed boolean; arbitrary stderr/error text, paths, full installation
records and profile contents are excluded.

Only exact known records are read: UID-owned regular files with O_NOFOLLOW,
nonsymlink ancestors and bounded input (64 KiB per input, conservatively 32 KiB
total input and at most 32 KiB output). Missing, malformed, oversized, unsafe or
over-budget inputs become finite unavailable categories without fallback scans.
Fixture checkpoints and the primary snapshot use exclusive creation. If
capture/persistence fails or an existing snapshot collides, scratch remains
owned and retained; complete process closure guards still run and are never
bypassed. The primary snapshot stays unchanged; the separate post-cleanup
failure receipt reports capture availability and scratch removal. The original
exception/nonpass is preserved. Neither this snapshot nor successful cleanup
establishes a native root cause or turns the run into a pass.

Focused portable regressions cover snapshot-before-drain/removal, the still
failing 45-second wait, privacy sentinel exclusion, finite pre-main errors,
missing/malformed/oversized/symlink/aggregate-limit inputs, exclusive evidence,
and retention on capture error with complete native closure. These use fakes
and temporary files, with no real Electron, process launch, signing or macOS
operation. The final deduplicated updater/package union passes **144 tests**
on real Node **24.19.0**, with zero failures, cancellations or skips. The actual
compatibility guard still reports the same epoch and **143 registered sources**;
the final diff check passes. No production updater, dependency, workflow or
registry change accompanies this diagnostic repair.

## Bootstrap refusal provenance

The subsequent attempt at exact source
`eff942d5aae8d4c5610772f11a123e460c8f7ced` produced archive SHA256
`b691f429ab316fd489cd98b80dd80270fa230fe59c43fc17447c799017db9bb0`.
Assembly, inventory and prelaunch admission passed; the first fresh lifecycle
wait still failed before health after 50.4943 seconds. The primary snapshot
binds an awaiting-health journal at sequence 7 with launchAttempted true,
helper present, no registered launch/profile-opened/health, and a bootstrap
`busy` error before main import. This localizes the refusal but does not
identify its guard. The failed-health scenario remained unreached. Process,
group, EOF, inventory and lock closure were verified separately. The attempt's
authorization is consumed; this source repair grants no native rerun.

State and bootstrap now attach finite guard identifiers at existing gate,
reconciliation, singleton, writer and session refusals. The error object and
category, guard predicates, retries, gate custody and launch ordering remain
authoritative and unchanged. Annotation is best effort: an annotation failure
cannot substitute another error or supply success. The fixture reporter and
primary-before-drain snapshot project only allowlisted guard, launch-binding,
singleton, owner/helper relation, liveness and writer-relation enums. Invalid
provenance becomes unavailable; arbitrary properties and exception text are
excluded. Existing nofollow, ownership, byte limits, exclusive persistence,
capture placement and failure-retention rules remain in force.

Owner relation compares the rejected identity with the caller's known identity
or allowed identities; helper relation uses the already available journal
helper. Writer relation distinguishes an owned-root executable, a session lease
and a descendant. Unknown evidence stays `unknown`. In particular, bootstrap
has not read the journal when gate acquisition refuses, so helper relation is
unknown at that guard; no additional read or process probe guesses that role.

A deterministic Linux-safe regression uses the existing fresh fixture and real
helper/transaction/state/bootstrap functions with distinct immutable synthetic
helper/app identities. A deferred after-launch checkpoint holds the helper's
gate at durable sequence 7 while bootstrap runs once. The unchanged assertion
failed on the parent source because the reporter/snapshot omitted the guard;
separate singleton and writer cases failed for the same missing provenance.
After repair, those cases discriminate the guards while still refusing before
registration, main import or health, preserving the journal and gate owner.
Existing regressions additionally cover session claims with unknown liveness,
external descendants, a frozen original error, malformed provenance, both
runtime-build snapshot routes and privacy sentinel exclusion. The barrier is
released in finally; framework-owned fixture roots are removed after success
and failure. No real app or process, sleep, protected state or native service
participates.

The final deduplicated portable command above passed **148 tests** on the
existing checksum-verified Node **24.19.0** runtime in **14.25 seconds**, with
zero failures, cancellations or skips. Fresh same-host telemetry admitted one
serial test process before each check. The actual compatibility guard passed
with the unchanged epoch above and **143 registered sources**. No registry,
fingerprint, epoch, deadline, process exclusion or acceptance policy changed.
The diff check passed and invocation fixture roots closed with no retained
files. These are portable source results only; the original native failures,
first-adoption/compatibility limits and parent/integration holds remain.

## Native acceptance still required

The previous [ARM64 native package job](https://github.com/Jones-Systems/HQ/actions/runs/39981843129/job/120510857410)
failed at process-inventory `path-before`, errno 2, zero path result and
`same-live`. This did not prove a process was safe to omit. Production inventory
admission and the unknown-process cleanup fence remain unchanged. The earlier
unqualified artifacts and retained scratch are not adopted or removed here.

The next native operation requires a new explicitly bound Apple Silicon capsule
and slot. Inventory preflight uses the unchanged `process-inventory.c` and
`native.cjs` parser; the diagnostic source requires a newly bound package.
Bind exact source and helper hashes, one owned build/output directory, a shared
serial compiler lock, fresh same-host CPU/memory and filesystem admission,
bounded compilation/execution, and exact cleanup ownership before starting.
Publish only `complete`/count or the adapter's closed `inventoryFailure` record;
never publish raw process inventory. Missing evidence holds with zero app launches.
The earlier native attempt consumed its single authorization; this source
publication grants no new native attempt or disposable signing operation.

Only complete inventory admits the packaged synthetic journey matrix in
[`native-smoke.cjs`](native-smoke.cjs): fresh install, first health, exact
next-launch scheduling, retained prior identity, interrupted-stage recovery,
failed-health binary restoration and preserved synthetic profile writes.
[`native-storage.cjs`](native-storage.cjs) measures the receiving filesystem
before ten bundle copies plus its documented allowance and reserve. Bind the
exact archive/source/architecture, isolated bundle identity and empty synthetic
profile; verify all owned processes drained and scratch cleanup completed.
An unknown process result retains scratch and stops the run. No installed HQ
profile or running application participates. Intel qualification is not a
completion requirement.

Named foundation integration custody remains unproved and PR #212 stays held;
PR #2 stays draft under its cross-owner/main hold. The independent compatibility
judgment supports the registry repair and conservative cross-epoch refusal as
source evidence only. Initial cross-epoch migration remains forbidden by the
accepted specification; first-adoption P1, real-profile compatibility, old quit/
unsaved-work and permission continuity remain separate unproved boundaries.

## Three-app signing and permission continuity

**HQ source:** #142's policy is present on foundation.
[`signing.cjs`](../signing.cjs) fixes Team `2CUPSQS986` and identifier
`org.jones-systems.hq.local`; [`developer-id.cjs`](developer-id.cjs) and the
package workflow require explicit activation and trusted canonical main.
Portable tests exercise stable requirements, no ad-hoc fallback, notarization
failure handling, provenance and compatible signed binary rollback. They do
not prove a real signed release. HQ still needs integration-owner acceptance,
native inventory/journeys, protected-environment enrollment and review, an
authorized signed/notarized/stapled artifact, and measured update/rollback
continuity. Legacy adoption additionally needs exact old source hashes,
retained binary, safe departure and the externally supplied profile pins.
The old quit/unsaved-work problem is not solved by updater scheduling.

**Jones Code source:** [#546](https://github.com/Jones-Systems/Jones-Code/pull/546)
merged as `5e32fa0175ec0abe42f36b7fc00da0ca865e2f98`.
Its [signing guide at that merge](https://github.com/Jones-Systems/Jones-Code/blob/5e32fa0175ec0abe42f36b7fc00da0ca865e2f98/docs/operations/macos-signing.md)
defines production `com.jonessystems.jonescode`, protected main-only signing,
stable component requirements, signed-update refusal and retained rollback
checks. Baseline signing and optional browser-passkey capability are separate.
Enrollment/activation state is not inferred from source. Real signed artifact
acceptance, authorized legacy-identity bootstrap, actual app/child synthetic
resource access and continuity across signed update/compatible rollback remain
separate proofs. Existing installed Jones apps and services are outside this
qualification. The ChatGPT helper attribution/policy remains unresolved here.

**CodexBar Jones source:** [#26](https://github.com/Jones-Systems/CodexBar/pull/26)
merged as `c314d5b6a30ef9c4888ccb120d35150fa545e61c`.
Its [identity contract](https://github.com/Jones-Systems/CodexBar/blob/c314d5b6a30ef9c4888ccb120d35150fa545e61c/docs/jones/IDENTITY.md)
and [protected signing workflow](https://github.com/Jones-Systems/CodexBar/blob/c314d5b6a30ef9c4888ccb120d35150fa545e61c/.github/workflows/jones-macos-signing.yml)
separate Jones identity/state from upstream and guard signing behind canonical
main and explicit activation. #47 qualification belongs to its independent
delivery lane. Signed delivery still needs its exact app/widget app-group and
iCloud profile/capability prerequisites, trusted updater metadata, authorized
bootstrap and actual state/permission continuity. Source metadata is not
evidence that protected profiles or grants exist.

Across all three apps, the completed backup-custody handoff is preserved;
no protected store was reopened or key re-exported for this record. Certificate
and notary enrollment, environment activation, release publication, installation,
owner consent and continuity tests remain distinct operations. The acceptance
sequence is: qualify exact signed identity/seal/notary/provenance; reject
tampered/wrong-team/wrong-ID candidates before swap; bind narrowly authorized
synthetic resources to the actual app/child context; then prove relaunch,
changed-CDHash signed update and compatible signed rollback preserve access
and state. Do not read TCC databases or change permissions to manufacture proof.
